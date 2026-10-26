-- Supabase (since 2026-10-30) no longer grants Data API access to newly
-- created tables in "public". Explicit grants keep schema recreation
-- (new project, preview branch, "supabase db reset") working.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_readings
    TO anon, authenticated, service_role;

GRANT SELECT ON public._keep_alive
    TO anon, authenticated;
