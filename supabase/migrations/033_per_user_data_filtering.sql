-- ====================================================================
-- 033_per_user_data_filtering
--
-- Update #2 v2 §1.2 — Tinh chỉnh RLS để mỗi NV chỉ thấy dữ liệu của
-- mình. Phần lớn policy đã đúng từ mig 002; bổ sung các trường hợp:
--
-- 1. customers: sales rep cũng thấy được khách mình tạo (created_by =
--    auth.uid()) — không cần đợi customer_assignment được thêm.
-- 2. payments: sales chỉ thấy thanh toán cho đơn của mình.
-- 3. notifications: user chỉ thấy thông báo của mình (đã có nhưng
--    confirm).
-- 4. order_status_history: user thấy lịch sử của đơn mình thấy được
--    (theo policy sales_orders).
-- ====================================================================

-- ---------------------------------------------------------------------
-- 1. Extend customers SELECT for sales: own assignments OR own creations
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Sales see assigned customers" ON customers;
CREATE POLICY "Sales see own customers" ON customers
  FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'sales'
    AND (
      created_by = auth.uid()
      OR id IN (
        SELECT customer_id FROM customer_assignments
        WHERE user_id = auth.uid() AND status = 'active'
      )
    )
  );

-- ---------------------------------------------------------------------
-- 2. payments: sales rep see only payments for own orders
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'payments') THEN
    DROP POLICY IF EXISTS "Sales see own order payments" ON payments;
    EXECUTE $POL$
      CREATE POLICY "Sales see own order payments" ON payments
        FOR SELECT
        USING (
          public.user_role() = 'sales'
          AND EXISTS (
            SELECT 1 FROM receivables r
            JOIN sales_orders so ON so.id = r.order_id
            WHERE r.id = payments.receivable_id
              AND so.sales_user_id = auth.uid()
          )
        );
    $POL$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. notifications: user sees only own notifications. Most installs
--    already enforce this via user_id = auth.uid(); add a defensive
--    policy DROP+CREATE so the rule is unambiguous.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'notifications') THEN
    DROP POLICY IF EXISTS "Users see own notifications" ON notifications;
    EXECUTE $POL$
      CREATE POLICY "Users see own notifications" ON notifications
        FOR SELECT
        USING (user_id = auth.uid());
    $POL$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4. order_status_history: visibility piggy-backs on sales_orders RLS
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'order_status_history') THEN
    DROP POLICY IF EXISTS "View history of visible orders" ON order_status_history;
    EXECUTE $POL$
      CREATE POLICY "View history of visible orders" ON order_status_history
        FOR SELECT
        USING (
          EXISTS (
            SELECT 1 FROM sales_orders so
            WHERE so.id = order_status_history.order_id
          )
        );
    $POL$;
  END IF;
END $$;
