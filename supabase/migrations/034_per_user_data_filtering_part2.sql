-- ====================================================================
-- 034_per_user_data_filtering_part2
--
-- Update #2 v2 §1.2 (tiếp theo) — Tinh chỉnh RLS các bảng tài chính
-- nhập-vào (supplier-side):
--
--   • payables / payable_payments: chỉ owner / manager / accountant
--     thấy. Sales / warehouse / driver KHÔNG thấy danh sách công nợ NCC.
--   • purchase_orders / purchase_order_lines / purchase_invoices: chỉ
--     owner / manager / warehouse / accountant thấy. Sales / driver
--     KHÔNG thấy giá vốn nhập.
--   • cash_receipts: lái xe / NV bán hàng chỉ thấy phiếu mình tạo
--     (collected_by = auth.uid()) hoặc chứng từ liên quan đơn của họ.
--
-- Migration 002 + 010 + 012 + 020 + 033 đã thiết lập policy tổng;
-- migration này siết thêm theo nguyên tắc tối thiểu.
-- ====================================================================

-- ---------------------------------------------------------------------
-- 1. payables — restrict SELECT to financial roles
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "View payables" ON payables;
CREATE POLICY "Financial roles view payables" ON payables
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  );

DROP POLICY IF EXISTS "View payable payments" ON payable_payments;
CREATE POLICY "Financial roles view payable payments" ON payable_payments
  FOR SELECT TO authenticated
  USING (
    public.user_role() IN ('owner', 'manager', 'accountant')
    AND EXISTS (
      SELECT 1 FROM payables p
      WHERE p.id = payable_id AND p.org_id = public.user_org_id()
    )
  );

-- ---------------------------------------------------------------------
-- 2. purchase_orders / lines / invoices — restrict to operational
--    roles. Sales/driver have no business reason to see cost prices.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "View POs" ON purchase_orders;
CREATE POLICY "Ops roles view POs" ON purchase_orders
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'warehouse', 'accountant')
  );

DROP POLICY IF EXISTS "View PO lines" ON purchase_order_lines;
CREATE POLICY "Ops roles view PO lines" ON purchase_order_lines
  FOR SELECT TO authenticated
  USING (
    public.user_role() IN ('owner', 'manager', 'warehouse', 'accountant')
    AND EXISTS (
      SELECT 1 FROM purchase_orders po
      WHERE po.id = po_id AND po.org_id = public.user_org_id()
    )
  );

DROP POLICY IF EXISTS "View purchase invoices" ON purchase_invoices;
CREATE POLICY "Financial roles view purchase invoices" ON purchase_invoices
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  );

-- ---------------------------------------------------------------------
-- 3. cash_receipts — narrow SELECT for sales/driver to own collections
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "cash_receipts_select" ON cash_receipts;
CREATE POLICY "cash_receipts_select_admin" ON cash_receipts
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  );

CREATE POLICY "cash_receipts_select_own" ON cash_receipts
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('sales', 'driver', 'warehouse')
    AND collected_by = auth.uid()
  );
