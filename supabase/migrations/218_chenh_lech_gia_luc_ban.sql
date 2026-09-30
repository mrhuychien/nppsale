-- ====================================================================
-- 218 — BÁO CÁO BÁN THEO NHÂN VIÊN: CHÊNH LỆCH THEO GIÁ LÚC BÁN, CÓ CHÊNH TRẢ
--
-- VÌ SAO — chủ nhà 30/09/2026: "quét lại cho tao báo cáo bán hàng theo nhân viên, phần chênh
--   lệch, từng nhân viên" → quét thấy chênh lệch ăn cả VAT và lấy bảng giá chung HIỆN TẠI.
--   Chốt: giá niêm yết = giá của khách LÚC BÁN · "TÍnh cho tao cả phần chênh trả về nữa, vì lúc đi
--   đã ăn chênh, lúc về phải trả chênh" · "Hàng trả về và Hàng đi: Nhân viên sửa giá loại nào ->
--   tính phần chênh số lượng X (giá sửa - giá gốc). Phần giảm giá cả đơn tính riêng (tính theo đơn)".
--
-- CÁCH LÀM: `bao_cao_so_ban` (mig 204) trả thêm dữ liệu thô — phép tính ở TypeScript
--   (`src/lib/analytics/chenh-lech.ts`), như mig 204:
--   - dòng hoá đơn: `line_discount`, `order_line_id`;
--   - `dong_don`: dòng đơn gốc (đơn giá, chiết khấu, SL, đơn vị) — ⚠ chiết khấu chép sang hoá đơn
--     là của CẢ dòng đơn, không chia theo SL xuất, nên giá niêm yết phải tính từ dòng đơn;
--   - `dong_hd_goc`: dòng của hoá đơn gốc mà phiếu trả trong kỳ gắn vào (có thể ngoài kỳ);
--   - dòng trả: `unit_price` (giá sửa của hàng trả, trước thuế; `line_total` đã gồm VAT).
-- ⚠ SECURITY INVOKER như mig 204 — RLS áp như đọc bảng; không phải hàm nội bộ (luật 166 không áp).
-- ⚠ Chưa chạy migration này thì báo cáo vẫn chạy, chênh lệch lùi về bảng giá chung hiện tại.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.bao_cao_so_ban(p_tu date, p_den date)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $fn$
  WITH
  hd AS (
    SELECT i.id, i.invoice_code, i.invoice_date, i.order_id, i.status, i.total, i.subtotal, i.vat,
           i.customer_id, i.sales_user_id, i.posted_by, i.payment_terms
      FROM sales_invoices i
     WHERE i.org_id = public.user_org_id()
       AND i.status = 'posted'
       AND i.invoice_date BETWEEN p_tu AND p_den
  ),
  tra AS (
    -- Như fetchReturnsRowsDu (mig 192): theo ngày trừ doanh số, không lọc trạng thái.
    SELECT r.id, r.status, r.customer_id, r.invoice_id, r.credit_note_amount, r.created_at,
           r.revenue_date, r.sales_user_id, r.reason, r.credit_with_invoice,
           -- Số phiếu TH- (mig 193): sổ chưa chạy 193 thì chỉ mất số, không vỡ hàm.
           to_jsonb(r) ->> 'return_code' AS ma
      FROM returns r
     WHERE r.org_id = public.user_org_id()
       AND r.revenue_date BETWEEN p_tu AND p_den
  ),
  xuat AS (
    SELECT e.id
      FROM stock_entries e
     WHERE e.org_id = public.user_org_id()
       AND e.status = 'posted'
       AND e.type = 'export'
       AND e.posted_at >= (p_tu::text || 'T00:00:00+07:00')::timestamptz
       AND e.posted_at <= (p_den::text || 'T23:59:59.999+07:00')::timestamptz
  ),
  gv AS (
    -- Như soLuongCoSoDongKho / giaTriDongKho: SL cơ sở ưu tiên qty_in_base_uom.
    SELECT l.product_id,
           sum(CASE WHEN l.qty_in_base_uom IS NOT NULL THEN abs(l.qty_in_base_uom)
                    ELSE abs(COALESCE(l.quantity, 0)) * CASE WHEN l.conversion_factor_snapshot > 0 THEN l.conversion_factor_snapshot ELSE 1 END
               END) AS sl,
           sum((CASE WHEN l.qty_in_base_uom IS NOT NULL THEN abs(l.qty_in_base_uom)
                     ELSE abs(COALESCE(l.quantity, 0)) * CASE WHEN l.conversion_factor_snapshot > 0 THEN l.conversion_factor_snapshot ELSE 1 END
                END) * COALESCE(l.unit_cost, 0)) AS tien
      FROM stock_entry_lines l
      JOIN xuat x ON x.id = l.entry_id
     GROUP BY l.product_id
  ),
  gv_tra AS (
    -- Như fetchReturnCosts: phiếu nhập "Nhập lại từ phiếu trả <id>" đã ghi sổ.
    SELECT t.id AS return_id, l.product_id,
           sum(abs(COALESCE(l.qty_in_base_uom, COALESCE(l.quantity, 0) * COALESCE(NULLIF(l.conversion_factor_snapshot, 0), 1)))
               * COALESCE(l.unit_cost, 0)) AS tien
      FROM tra t
      JOIN stock_entries e ON e.type = 'import' AND e.status = 'posted'
                          AND e.notes = 'Nhập lại từ phiếu trả ' || t.id::text
      JOIN stock_entry_lines l ON l.entry_id = e.id
     GROUP BY t.id, l.product_id
  )
  SELECT jsonb_build_object(
    'hd', COALESCE((SELECT jsonb_agg(to_jsonb(h)) FROM hd h), '[]'::jsonb),
    'dong_hd', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', l.id, 'invoice_id', l.invoice_id, 'product_id', l.product_id, 'unit_name', l.unit_name,
               'conversion_factor', l.conversion_factor, 'quantity', l.quantity, 'unit_price', l.unit_price,
               'line_total', l.line_total, 'is_exchange', l.is_exchange,
               -- (mig 218) giá niêm yết lúc bán: chiết khấu chụp trên dòng + dòng đơn gốc
               'line_discount', l.line_discount, 'order_line_id', l.order_line_id) ORDER BY l.id)
        FROM sales_invoice_lines l JOIN hd h ON h.id = l.invoice_id), '[]'::jsonb),
    -- (mig 218) Dòng của HOÁ ĐƠN GỐC mà phiếu trả trong kỳ gắn vào (có thể nằm ngoài kỳ) —
    --   để tính "chênh trả" theo giá niêm yết lúc bán.
    'dong_hd_goc', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', l.id, 'invoice_id', l.invoice_id, 'product_id', l.product_id, 'unit_name', l.unit_name,
               'conversion_factor', l.conversion_factor, 'quantity', l.quantity, 'unit_price', l.unit_price,
               'line_total', l.line_total, 'is_exchange', l.is_exchange,
               'line_discount', l.line_discount, 'order_line_id', l.order_line_id) ORDER BY l.id)
        FROM sales_invoice_lines l
       WHERE l.invoice_id IN (SELECT t.invoice_id FROM tra t WHERE t.invoice_id IS NOT NULL)
         AND NOT COALESCE(l.is_exchange, false)), '[]'::jsonb),
    -- (mig 218) Dòng ĐƠN gốc của các dòng hoá đơn trên — chiết khấu trên dòng hoá đơn là của CẢ
    --   dòng đơn (không chia theo SL xuất), nên giá niêm yết lấy từ dòng đơn.
    'dong_don', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', s.id, 'unit_name', s.unit_name, 'conversion_factor', s.conversion_factor,
               'quantity', s.quantity, 'unit_price', s.unit_price, 'line_discount', s.line_discount))
        FROM sales_order_lines s
       WHERE s.id IN (
         SELECT l.order_line_id FROM sales_invoice_lines l JOIN hd h ON h.id = l.invoice_id WHERE l.order_line_id IS NOT NULL
         UNION
         SELECT l.order_line_id FROM sales_invoice_lines l
          WHERE l.order_line_id IS NOT NULL
            AND l.invoice_id IN (SELECT t.invoice_id FROM tra t WHERE t.invoice_id IS NOT NULL))), '[]'::jsonb),
    'tra', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM tra t), '[]'::jsonb),
    'dong_tra', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'return_id', l.return_id, 'product_id', l.product_id, 'unit_name', l.unit_name,
               'quantity', l.quantity, 'line_total', l.line_total,
               'unit_price', l.unit_price) ORDER BY l.id)
        FROM return_lines l JOIN tra t ON t.id = l.return_id
       WHERE l.is_exchange = false), '[]'::jsonb),
    'gv', COALESCE((SELECT jsonb_agg(jsonb_build_object('product_id', g.product_id, 'sl', g.sl, 'tien', g.tien)) FROM gv g), '[]'::jsonb),
    'gv_tra', COALESCE((SELECT jsonb_agg(jsonb_build_object('return_id', g.return_id, 'product_id', g.product_id, 'tien', g.tien)) FROM gv_tra g), '[]'::jsonb)
  )
$fn$;

REVOKE ALL ON FUNCTION public.bao_cao_so_ban(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bao_cao_so_ban(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 218: báo cáo bán trả giá niêm yết lúc bán + chênh trả' AS buoc,
       CASE WHEN position('dong_hd_goc' IN pg_get_functiondef('public.bao_cao_so_ban(date, date)'::regprocedure)) > 0
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua;
