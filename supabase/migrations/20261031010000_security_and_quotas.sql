-- Migration: Enforce quotas (5 pages, 5 categories, 500 entries), fix XSS/search_path, and mask shared metadata
-- Safe, idempotent script for Supabase

-- 1. Tighten payload size limit to 256 KB and validate JSONB structure
CREATE OR REPLACE FUNCTION public.validate_readings_payload(payload_json JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    cat JSONB;
BEGIN
    -- Must be a JSON array
    IF jsonb_typeof(payload_json) <> 'array' THEN
        RETURN FALSE;
    END IF;

    -- Max 5 categories per page
    IF jsonb_array_length(payload_json) > 5 THEN
        RETURN FALSE;
    END IF;

    -- Each category must have <= 500 entries
    FOR cat IN SELECT * FROM jsonb_array_elements(payload_json) LOOP
        IF jsonb_typeof(cat->'entries') = 'array' THEN
            IF jsonb_array_length(cat->'entries') > 500 THEN
                RETURN FALSE;
            END IF;
        END IF;
    END LOOP;

    RETURN TRUE;
END;
$$;

DO $$
BEGIN
    -- Update payload check constraint to 256KB and structure validation
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_payload_size') THEN
        ALTER TABLE public.user_readings DROP CONSTRAINT check_payload_size;
    END IF;
    ALTER TABLE public.user_readings
        ADD CONSTRAINT check_payload_size CHECK (pg_column_size(payload) <= 262144);

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_payload_structure') THEN
        ALTER TABLE public.user_readings
            ADD CONSTRAINT check_payload_structure CHECK (public.validate_readings_payload(payload));
    END IF;

    -- Limit shared_users length to max 20 entries
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_shared_users_max_count') THEN
        ALTER TABLE public.user_readings
            ADD CONSTRAINT check_shared_users_max_count CHECK (jsonb_array_length(shared_users) <= 20);
    END IF;
END $$;

-- 2. Update page limit trigger: max 5 pages per user account
CREATE OR REPLACE FUNCTION public.check_user_readings_limit()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF (SELECT COUNT(*) FROM public.user_readings WHERE user_id = NEW.user_id AND id != NEW.id) >= 5 THEN
        RAISE EXCEPTION 'Account storage limit reached (Max 5 pages per user).';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_user_readings_limit ON public.user_readings;
CREATE TRIGGER enforce_user_readings_limit
    BEFORE INSERT ON public.user_readings
    FOR EACH ROW
    EXECUTE FUNCTION public.check_user_readings_limit();

-- 3. Harden permission check function and updates trigger
CREATE OR REPLACE FUNCTION public.has_page_access(shared_users JSONB, required_role TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(shared_users) elem
        WHERE auth.jwt()->>'email' IS NOT NULL 
          AND length(trim(auth.jwt()->>'email')) > 0
          AND lower(elem->>'email') = lower(auth.jwt()->>'email')
          AND (required_role IS NULL OR elem->>'role' = required_role OR elem->>'role' = 'edit')
    );
$$;

CREATE OR REPLACE FUNCTION public.check_user_readings_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- If user is the owner, full updates are permitted
    IF auth.uid() = OLD.user_id THEN
        RETURN NEW;
    END IF;

    -- If user is an invited editor, protect metadata fields
    IF public.has_page_access(OLD.shared_users, 'edit') THEN
        IF NEW.user_id <> OLD.user_id 
           OR NEW.id <> OLD.id 
           OR NEW.data_key <> OLD.data_key 
           OR NEW.title <> OLD.title 
           OR NEW.share_token IS DISTINCT FROM OLD.share_token 
           OR NEW.shared_users IS DISTINCT FROM OLD.shared_users THEN
            RAISE EXCEPTION 'Shared editors may only update readings data, not ownership or permissions.';
        END IF;
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Permission denied.';
END;
$$;

-- 4. RPC to securely retrieve pages with masked metadata for invited users
CREATE OR REPLACE FUNCTION public.get_user_pages()
RETURNS TABLE (
    id UUID,
    user_id UUID,
    data_key VARCHAR(50),
    title VARCHAR(100),
    payload JSONB,
    share_token UUID,
    shared_users JSONB,
    updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT 
        ur.id,
        ur.user_id,
        ur.data_key,
        ur.title,
        ur.payload,
        CASE 
            WHEN ur.user_id = auth.uid() THEN ur.share_token 
            ELSE NULL 
        END AS share_token,
        CASE 
            WHEN ur.user_id = auth.uid() THEN ur.shared_users 
            ELSE (
                SELECT coalesce(jsonb_agg(elem), '[]'::jsonb)
                FROM jsonb_array_elements(ur.shared_users) elem
                WHERE lower(elem->>'email') = lower(coalesce(auth.jwt()->>'email', ''))
            )
        END AS shared_users,
        ur.updated_at
    FROM public.user_readings ur
    WHERE ur.user_id = auth.uid()
       OR public.has_page_access(ur.shared_users)
    ORDER BY ur.updated_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_pages() TO authenticated;
