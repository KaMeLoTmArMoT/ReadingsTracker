-- 1. Create dedicated keep-alive table
CREATE TABLE IF NOT EXISTS public._keep_alive (
    id INT PRIMARY KEY DEFAULT 1,
    last_ping TIMESTAMPTZ NOT NULL DEFAULT now(),
    ping_count BIGINT NOT NULL DEFAULT 1
);

-- Seed initial row
INSERT INTO public._keep_alive (id, last_ping, ping_count)
VALUES (1, now(), 1)
ON CONFLICT (id) DO NOTHING;

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public._keep_alive ENABLE ROW LEVEL SECURITY;

-- 3. Allow read access to anon and authenticated
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = '_keep_alive' AND policyname = 'Allow public read keep_alive') THEN
        CREATE POLICY "Allow public read keep_alive" ON public._keep_alive FOR SELECT TO anon, authenticated USING (true);
    END IF;
END $$;

-- 4. Stored procedure / RPC function to perform real write activity
CREATE OR REPLACE FUNCTION public.ping_keep_alive()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_ping_count BIGINT;
    v_last_ping TIMESTAMPTZ;
BEGIN
    UPDATE public._keep_alive
    SET last_ping = now(),
        ping_count = ping_count + 1
    WHERE id = 1
    RETURNING ping_count, last_ping INTO v_ping_count, v_last_ping;

    RETURN json_build_object(
        'status', 'ok',
        'ping_count', v_ping_count,
        'timestamp', v_last_ping
    );
END;
$$;

-- 5. Grant execute permissions to anon and authenticated
GRANT EXECUTE ON FUNCTION public.ping_keep_alive() TO anon, authenticated;
