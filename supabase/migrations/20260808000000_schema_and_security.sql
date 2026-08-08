-- 1. Create table with column-level size constraints
CREATE TABLE IF NOT EXISTS public.user_readings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    data_key VARCHAR(50) NOT NULL DEFAULT 'readings_data',
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now(),

    -- CONSTRAINT 1: Key length limit
    CONSTRAINT check_key_length CHECK (char_length(data_key) <= 50),
    
    -- CONSTRAINT 2: Hard payload size limit (~500 KB per row)
    CONSTRAINT check_payload_size CHECK (pg_column_size(payload) <= 524288)
);

-- Unique constraint for upsert
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_readings_user_key ON public.user_readings(user_id, data_key);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.user_readings ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies: Strict user isolation (Users can only access their own rows)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_readings' AND policyname = 'Users can select own data') THEN
        CREATE POLICY "Users can select own data" ON public.user_readings FOR SELECT USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_readings' AND policyname = 'Users can insert own data') THEN
        CREATE POLICY "Users can insert own data" ON public.user_readings FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_readings' AND policyname = 'Users can update own data') THEN
        CREATE POLICY "Users can update own data" ON public.user_readings FOR UPDATE USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_readings' AND policyname = 'Users can delete own data') THEN
        CREATE POLICY "Users can delete own data" ON public.user_readings FOR DELETE USING (auth.uid() = user_id);
    END IF;
END $$;

-- 4. Trigger: Hard record limit per user (Max 20 records per account)
CREATE OR REPLACE FUNCTION check_user_readings_limit()
RETURNS TRIGGER AS $$
BEGIN
    IF (SELECT COUNT(*) FROM public.user_readings WHERE user_id = NEW.user_id AND id != NEW.id) >= 20 THEN
        RAISE EXCEPTION 'Account storage limit reached (Max 20 data blocks per user).';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_user_readings_limit ON public.user_readings;
CREATE TRIGGER enforce_user_readings_limit
    BEFORE INSERT ON public.user_readings
    FOR EACH ROW
    EXECUTE FUNCTION check_user_readings_limit();
