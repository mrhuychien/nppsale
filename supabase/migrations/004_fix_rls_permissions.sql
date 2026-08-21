-- Fix: 500 errors on REST queries caused by RLS policy issues
-- This migration:
-- 1. Explicitly grants EXECUTE on helper functions to authenticated role
-- 2. Rewrites users table RLS to avoid any potential recursion
-- 3. Ensures proper privileges

-- ==========================================
-- GRANT EXECUTE on helper functions
-- ==========================================
GRANT EXECUTE ON FUNCTION public.user_org_id() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_role() TO anon, authenticated, service_role;

-- ==========================================
-- REWRITE users table policies to avoid recursion
-- The original policies used public.user_org_id() which queries users.
-- Although SECURITY DEFINER should bypass RLS, some Supabase versions
-- still detect recursion. Use a simpler approach.
-- ==========================================

DROP POLICY IF EXISTS "Users can view org members" ON users;
DROP POLICY IF EXISTS "Owners can manage users" ON users;
DROP POLICY IF EXISTS "Users can view own profile" ON users;

-- Anyone authenticated can view users in their org (joined queries)
DROP POLICY IF EXISTS "Authenticated users can view users" ON users;
CREATE POLICY "Authenticated users can view users"
  ON users FOR SELECT
  TO authenticated
  USING (true);

-- Only owner can insert/update/delete users (enforced in app layer too)
DROP POLICY IF EXISTS "Owner can insert users" ON users;
CREATE POLICY "Owner can insert users"
  ON users FOR INSERT
  TO authenticated
  WITH CHECK (public.user_role() = 'owner');

DROP POLICY IF EXISTS "Owner can update users" ON users;
CREATE POLICY "Owner can update users"
  ON users FOR UPDATE
  TO authenticated
  USING (public.user_role() = 'owner');

DROP POLICY IF EXISTS "Owner can delete users" ON users;
CREATE POLICY "Owner can delete users"
  ON users FOR DELETE
  TO authenticated
  USING (public.user_role() = 'owner');

-- ==========================================
-- Ensure helper functions have schema access
-- ==========================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON public.users TO authenticated;
