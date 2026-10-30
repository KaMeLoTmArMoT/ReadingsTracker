-- Migration: Add multi-page support, safe email sharing, and secret link access
-- Safe, idempotent script for Supabase

-- 1. Add new columns to public.user_readings if they do not exist
ALTER TABLE public.user_readings 
    ADD COLUMN IF NOT EXISTS title VARCHAR(100) NOT NULL DEFAULT 'Main',
    ADD COLUMN IF NOT EXISTS share_token UUID DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS shared_users JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Constraints
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'check_shared_users_array'
    ) THEN
        ALTER TABLE public.user_readings
            ADD CONSTRAINT check_shared_users_array CHECK (jsonb_typeof(shared_users) = 'array');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'check_shared_users_size'
    ) THEN
        ALTER TABLE public.user_readings
            ADD CONSTRAINT check_shared_users_size CHECK (pg_column_size(shared_users) <= 32768);
    END IF;
END $$;

-- Unique index on share_token (allowing nulls)
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_readings_share_token 
    ON public.user_readings (share_token) 
    WHERE share_token IS NOT NULL;

-- 2. Helper functions to check permissions without exposing users table
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
        WHERE lower(elem->>'email') = lower(coalesce(auth.jwt()->>'email', ''))
          AND (required_role IS NULL OR elem->>'role' = required_role OR elem->>'role' = 'edit')
    );
$$;

-- 3. Trigger to restrict updates by shared users (editors can ONLY change payload and updated_at)
CREATE OR REPLACE FUNCTION public.check_user_readings_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
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

DROP TRIGGER IF EXISTS trg_protect_shared_page_updates ON public.user_readings;
CREATE TRIGGER trg_protect_shared_page_updates
    BEFORE UPDATE ON public.user_readings
    FOR EACH ROW
    EXECUTE FUNCTION public.check_user_readings_update();

-- 4. Update RLS policies
DROP POLICY IF EXISTS "Users can select own data" ON public.user_readings;
DROP POLICY IF EXISTS "Users can update own data" ON public.user_readings;
DROP POLICY IF EXISTS "Users and shared members can select data" ON public.user_readings;
DROP POLICY IF EXISTS "Users and shared editors can update data" ON public.user_readings;

CREATE POLICY "Users and shared members can select data" 
    ON public.user_readings 
    FOR SELECT 
    USING (
        auth.uid() = user_id 
        OR public.has_page_access(shared_users)
    );

CREATE POLICY "Users and shared editors can update data" 
    ON public.user_readings 
    FOR UPDATE 
    USING (
        auth.uid() = user_id 
        OR public.has_page_access(shared_users, 'edit')
    )
    WITH CHECK (
        auth.uid() = user_id 
        OR public.has_page_access(shared_users, 'edit')
    );

-- 5. RPC function to safely load a page by share_token without exposing user_id or shared_users
CREATE OR REPLACE FUNCTION public.get_shared_page_by_token(token_input UUID)
RETURNS TABLE (
    id UUID,
    title VARCHAR(100),
    payload JSONB,
    updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT 
        ur.id,
        ur.title,
        ur.payload,
        ur.updated_at
    FROM public.user_readings ur
    WHERE ur.share_token = token_input
    LIMIT 1;
$$;

-- Grant execution to anon and authenticated
GRANT EXECUTE ON FUNCTION public.has_page_access(JSONB, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_shared_page_by_token(UUID) TO anon, authenticated;
