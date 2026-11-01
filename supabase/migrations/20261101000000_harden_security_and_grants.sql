-- Migration: Harden permissions on user_readings and ping_keep_alive
-- Safe, idempotent script for Supabase

-- 1. Ensure ping_keep_alive has an explicit, safe search_path
ALTER FUNCTION public.ping_keep_alive() SET search_path = public;

-- 2. Revoke table-level data modification rights from anonymous role
-- Anonymous users should not have table access to user_readings directly.
-- Data access is strictly reserved for authenticated users and service_role,
-- with public link sharing proxied safely through the get_shared_page_by_token RPC.
REVOKE INSERT, UPDATE, DELETE ON public.user_readings FROM anon;
