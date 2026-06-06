-- ====================================================================
-- 084_invoices_sales_scope
--
-- Sales (NV bán hàng) chỉ thấy hoá đơn liên quan đến đơn hàng do mình
-- tạo (sales_orders.sales_user_id = auth.uid()). Owner/manager/
-- accountant vẫn thấy tất cả. Hoá đơn tay (không gắn order) → ẩn
-- với sales.
-- ====================================================================

DROP POLICY IF EXISTS "Org members can view invoices" ON invoices;
DROP POLICY IF EXISTS "Admin roles can view all invoices" ON invoices;
DROP POLICY IF EXISTS "Sales see own invoices" ON invoices;

CREATE POLICY "Admin roles can view all invoices"
  ON invoices FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  );

CREATE POLICY "Sales see own invoices"
  ON invoices FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'sales'
    AND order_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM sales_orders so
      WHERE so.id = invoices.order_id
        AND so.sales_user_id = (SELECT auth.uid())
    )
  );
