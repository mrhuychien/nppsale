-- ====================================================================
-- T-14: Row-level customer filtering
--
-- NV Sales chỉ thấy KH được assigned cho mình. Override quyền
-- "customer.view_all" cho các vai trò admin / supervisor được hết.
--
-- customer_assignments table đã tồn tại (mig 001). Mig 037 đã có
-- public.user_assigned_customer_ids() (SECURITY DEFINER, bypasses RLS
-- to prevent recursion). T-14 chỉ cần xếp lại policies với resolver
-- mới + extend tới sales_orders.
-- ====================================================================

-- ---------------------------------------------------------------------
-- customers SELECT — admin OR own customers OR view_all override
-- ---------------------------------------------------------------------
DO $$
BEGIN
  -- Drop ALL existing select policies to install a clean unified one
  EXECUTE 'DROP POLICY IF EXISTS "Admin roles can view all customers" ON customers';
  EXECUTE 'DROP POLICY IF EXISTS "Sales see own customers" ON customers';
  EXECUTE 'DROP POLICY IF EXISTS "Sales see assigned customers" ON customers';
  EXECUTE 'DROP POLICY IF EXISTS customer_select ON customers';
END $$;

CREATE POLICY customer_select ON customers
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND (
      public.user_role() IN ('owner', 'manager', 'accountant')
      OR public.user_has_permission(auth.uid(), 'customer.view_all')
      OR (
        EXISTS (
          SELECT 1 FROM customer_assignments ca
          WHERE ca.customer_id = customers.id
            AND ca.user_id = auth.uid()
            AND ca.status = 'active'
        )
      )
      OR (
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'customers' AND column_name = 'created_by'
        ) AND created_by = auth.uid()
      )
    )
  );

-- ---------------------------------------------------------------------
-- sales_orders SELECT — same pattern: admin OR own assignments OR
-- view_all override
-- ---------------------------------------------------------------------
DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "Admin roles can view all orders" ON sales_orders';
  EXECUTE 'DROP POLICY IF EXISTS "Sales see own orders" ON sales_orders';
  EXECUTE 'DROP POLICY IF EXISTS "Driver sees delivery orders" ON sales_orders';
  EXECUTE 'DROP POLICY IF EXISTS sales_order_select ON sales_orders';
END $$;

CREATE POLICY sales_order_select ON sales_orders
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND (
      public.user_role() IN ('owner', 'manager', 'accountant', 'warehouse')
      OR public.user_has_permission(auth.uid(), 'customer.view_all')
      OR sales_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM customer_assignments ca
        WHERE ca.customer_id = sales_orders.customer_id
          AND ca.user_id = auth.uid()
          AND ca.status = 'active'
      )
      OR (
        public.user_role() = 'driver'
        AND id IN (
          SELECT dl.order_id FROM delivery_lines dl
          JOIN deliveries d ON d.id = dl.delivery_id
          WHERE d.driver_id = auth.uid()
        )
      )
    )
  );

NOTIFY pgrst, 'reload schema';
