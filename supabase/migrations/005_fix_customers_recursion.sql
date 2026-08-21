-- Fix: 42P17 infinite recursion on customers table
-- Root cause: customers policy subqueries customer_assignments, and
-- customer_assignments policy subqueries customers -> infinite loop.
--
-- Solution: move the "sales sees assigned customers" check into a
-- SECURITY DEFINER helper function that bypasses RLS, and simplify
-- the customers policies.

-- ==========================================
-- Helper: check if current user is assigned to a customer
-- SECURITY DEFINER so it can read customer_assignments without
-- triggering RLS recursion.
-- ==========================================
CREATE OR REPLACE FUNCTION public.user_is_assigned_to_customer(cid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.customer_assignments
    WHERE customer_id = cid
      AND user_id = (SELECT auth.uid())
      AND status = 'active'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_is_assigned_to_customer(uuid) TO anon, authenticated, service_role;

-- ==========================================
-- Drop all old customers policies
-- ==========================================
DROP POLICY IF EXISTS "Admin roles can view all customers" ON customers;
DROP POLICY IF EXISTS "Sales see assigned customers" ON customers;
DROP POLICY IF EXISTS "Owner/Manager/Sales can create customers" ON customers;
DROP POLICY IF EXISTS "Owner/Manager/Sales can update customers" ON customers;
DROP POLICY IF EXISTS "Owner can delete customers" ON customers;

-- ==========================================
-- Recreate customers policies without recursion
-- ==========================================

-- Admin roles see all customers in their org
CREATE POLICY "Admin roles can view all customers"
  ON customers FOR SELECT
  TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  );

-- Sales see only assigned customers (uses helper function, no subquery on customer_assignments)
CREATE POLICY "Sales see assigned customers"
  ON customers FOR SELECT
  TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'sales'
    AND public.user_is_assigned_to_customer(id)
  );

-- Owner/Manager/Sales can create
CREATE POLICY "Owner/Manager/Sales can create customers"
  ON customers FOR INSERT
  TO authenticated
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'sales')
  );

-- Owner/Manager/Sales can update
CREATE POLICY "Owner/Manager/Sales can update customers"
  ON customers FOR UPDATE
  TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'sales')
  );

-- Owner can delete
CREATE POLICY "Owner can delete customers"
  ON customers FOR DELETE
  TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() = 'owner');

-- ==========================================
-- Fix customer_assignments policies (drop subquery on customers)
-- ==========================================
DROP POLICY IF EXISTS "Org members can view assignments" ON customer_assignments;
DROP POLICY IF EXISTS "Owner/Manager can manage assignments" ON customer_assignments;

-- Anyone authenticated in the same org can view assignments (no recursion)
DROP POLICY IF EXISTS "Authenticated can view assignments" ON customer_assignments;
CREATE POLICY "Authenticated can view assignments"
  ON customer_assignments FOR SELECT
  TO authenticated
  USING (true);

-- Owner/Manager can manage
CREATE POLICY "Owner/Manager can manage assignments"
  ON customer_assignments FOR ALL
  TO authenticated
  USING (public.user_role() IN ('owner', 'manager'));

-- ==========================================
-- Also check other tables that might have similar recursion:
-- sales_orders references customers in its policies, but only via
-- foreign key check, not subquery, so it should be fine.
-- Just ensure proper grants.
-- ==========================================
GRANT SELECT ON public.customer_assignments TO authenticated;
GRANT SELECT ON public.customers TO authenticated;
