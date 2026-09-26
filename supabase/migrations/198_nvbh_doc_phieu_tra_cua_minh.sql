-- ====================================================================
-- NVBH ĐỌC ĐƯỢC PHIẾU TRẢ THUỘC VỀ MÌNH (không chỉ phiếu mình tự lập)
--
-- VÌ SAO — chủ nhà 26/09/2026: "fix trong màn trang chủ của nhân viên bán hàng, doanh thu
--   của nhân viên chưa trừ hàng trả lại".
--   Chính sách đọc từ mig 002: NVBH chỉ thấy phiếu trả `requested_by = mình`. Phiếu trả TỰ
--   SINH lúc xuất hóa đơn (kho / kế toán bấm), phiếu lập ở POS, phiếu NPP lập hộ… đứng tên
--   NVBH, trừ vào doanh số và công nợ của NVBH, nhưng NVBH đọc không thấy → trang chủ, báo
--   cáo bán hàng, chi tiết khách của NVBH ra doanh số CHƯA trừ hàng trả (lệch công nợ).
--   Luật mới: phiếu mình lập, HOẶC phiếu đứng tên mình, HOẶC gắn hóa đơn / đơn của mình.
--   Dòng phiếu trả (`return_lines`) đọc theo phiếu nên tự mở theo.
-- ====================================================================

DROP POLICY IF EXISTS "Sales see own returns" ON public.returns;
CREATE POLICY "Sales see own returns" ON public.returns
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'sales'
    AND (
      requested_by = (SELECT auth.uid())
      OR sales_user_id = (SELECT auth.uid())
      OR EXISTS (SELECT 1 FROM public.sales_invoices si
                 WHERE si.id = returns.invoice_id AND si.sales_user_id = (SELECT auth.uid()))
      OR EXISTS (SELECT 1 FROM public.sales_orders so
                 WHERE so.id = returns.order_id AND so.sales_user_id = (SELECT auth.uid()))
    )
  );

NOTIFY pgrst, 'reload schema';

SELECT 'NVBH đọc phiếu trả đứng tên mình' AS hang_muc,
       CASE WHEN position('sales_user_id' IN regexp_replace(qual, '\s+', ' ', 'g')) > 0
            THEN 'có' ELSE 'CHƯA' END AS trang_thai
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'returns' AND policyname = 'Sales see own returns';
