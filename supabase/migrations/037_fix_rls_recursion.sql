-- ====================================================================
-- 037_fix_rls_recursion
--
-- 🚨 EMERGENCY FIX — 500 error on /rest/v1/customers and
-- /rest/v1/customer_assignments.
--
-- Root cause: migration 033's customers policy added a subquery on
-- customer_assignments. customer_assignments has its own RLS policy
-- (mig 002 / 008) that subqueries customers. When Postgres evaluates
-- either side it bounces back to the other → infinite recursion →
-- 500 Internal Server Error from PostgREST.
--
-- Fix: hoist the assignment lookup into a SECURITY DEFINER helper
-- function. SECURITY DEFINER runs as the table owner and BYPASSES
-- RLS on the underlying table. Same pattern as public.user_role()
-- and public.user_org_id() in mig 002.
--
-- Idempotent. Safe to re-run.
-- ====================================================================

-- ---------------------------------------------------------------------
-- Helper: list of customer_ids the calling user is actively assigned
-- to. SECURITY DEFINER bypasses customer_assignments RLS so we never
-- bounce back into customers RLS.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_assigned_customer_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT customer_id
  FROM public.customer_assignments
  WHERE user_id = auth.uid()
    AND status = 'active';
$$;

REVOKE EXECUTE ON FUNCTION public.user_assigned_customer_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_assigned_customer_ids() TO authenticated;

-- ---------------------------------------------------------------------
-- Re-create customers SELECT policy for sales using the helper.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  -- Drop both possible names (idempotent)
  EXECUTE 'DROP POLICY IF EXISTS "Sales see own customers" ON customers';
  EXECUTE 'DROP POLICY IF EXISTS "Sales see assigned customers" ON customers';

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customers'
      AND column_name = 'created_by'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY "Sales see own customers" ON customers
        FOR SELECT
        USING (
          org_id = public.user_org_id()
          AND public.user_role() = 'sales'
          AND (
            created_by = auth.uid()
            OR id IN (SELECT public.user_assigned_customer_ids())
          )
        );
    $POL$;
  ELSE
    EXECUTE $POL$
      CREATE POLICY "Sales see assigned customers" ON customers
        FOR SELECT
        USING (
          org_id = public.user_org_id()
          AND public.user_role() = 'sales'
          AND id IN (SELECT public.user_assigned_customer_ids())
        );
    $POL$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- customer_assignments policy from mig 002/008 also subqueries
-- customers. Replace it with a non-recursive version that uses
-- public.user_org_id() directly via a SECURITY DEFINER lookup of the
-- customer's org instead of a subquery.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_org_id(p_customer_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT org_id FROM public.customers WHERE id = p_customer_id;
$$;

REVOKE EXECUTE ON FUNCTION public.customer_org_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_org_id(uuid) TO authenticated;

DO $$
BEGIN
  -- Drop ALL existing customer_assignments policies (idempotent)
  EXECUTE 'DROP POLICY IF EXISTS "Org members can view assignments" ON customer_assignments';
  EXECUTE 'DROP POLICY IF EXISTS "Owner/Manager can manage assignments" ON customer_assignments';
  EXECUTE 'DROP POLICY IF EXISTS "Authenticated can view assignments" ON customer_assignments';
  EXECUTE 'DROP POLICY IF EXISTS "View assignments in org" ON customer_assignments';
  EXECUTE 'DROP POLICY IF EXISTS "Owner/Manager manage assignments" ON customer_assignments';

  EXECUTE $POL$
    CREATE POLICY "View assignments in org" ON customer_assignments
      FOR SELECT
      TO authenticated
      USING (
        public.customer_org_id(customer_id) = public.user_org_id()
        OR user_id = auth.uid()
      );
  $POL$;

  EXECUTE $POL$
    CREATE POLICY "Owner/Manager manage assignments" ON customer_assignments
      FOR ALL
      TO authenticated
      USING (
        public.user_role() IN ('owner', 'manager')
        AND public.customer_org_id(customer_id) = public.user_org_id()
      )
      WITH CHECK (
        public.user_role() IN ('owner', 'manager')
        AND public.customer_org_id(customer_id) = public.user_org_id()
      );
  $POL$;
END $$;

-- ---------------------------------------------------------------------
-- Force PostgREST to reload schema cache so the new functions are
-- callable from the API immediately.
-- ---------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
