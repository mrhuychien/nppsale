-- ====================================================================
-- BÁO CÁO TỔNG HỢP: ĐỌC SỐ MỘT LƯỢT Ở MÁY CHỦ
--
-- VÌ SAO — chủ nhà 27/09/2026: "rà cách đọc dữ liệu cho nhanh hơn" → "muốn nhanh hơn nữa".
--   Mỗi màn báo cáo đang đọc 8–10 bảng từ trình duyệt, nhiều lượt nối đuôi nhau (hoá đơn →
--   dòng hoá đơn theo lô 150 id; phiếu xuất → dòng phiếu xuất; phiếu trả → dòng trả → phiếu
--   nhập hàng trả → dòng của nó…). Mỗi lượt là một vòng VN ↔ Singapore.
--   Ba hàm dưới trả ĐÚNG CÁC DÒNG THÔ mà trình duyệt vẫn đọc (cùng cột, cùng điều kiện) trong
--   MỘT lượt; phần cộng / phân bổ / quy đổi vẫn là mã TypeScript cũ — số ra y hệt.
--
-- ⚠ SECURITY INVOKER: chạy với quyền người gọi, RLS áp y như khi đọc bảng từ trình duyệt.
--   Không vượt quyền gì — không phải hàm nội bộ SECURITY DEFINER (luật mig 166 không áp).
-- ⚠ Trả một `jsonb` duy nhất nên không bị trần `max_rows` 1.000 dòng của PostgREST cắt.
-- ⚠ Chưa chạy migration này thì giao diện tự lùi về cách đọc cũ (không hỏng màn).
-- ====================================================================

-- 1) Số bán của kỳ [p_tu, p_den] — thay fetchRevenueInvoicesDu + fetchInvoiceLines +
--    fetchReturnsRowsDu + fetchReturnLines + fetchReturnCosts + fetchCogsForRange + đọc lý do /
--    mã phiếu trả.
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
               'line_total', l.line_total, 'is_exchange', l.is_exchange) ORDER BY l.id)
        FROM sales_invoice_lines l JOIN hd h ON h.id = l.invoice_id), '[]'::jsonb),
    'tra', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM tra t), '[]'::jsonb),
    'dong_tra', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'return_id', l.return_id, 'product_id', l.product_id, 'unit_name', l.unit_name,
               'quantity', l.quantity, 'line_total', l.line_total) ORDER BY l.id)
        FROM return_lines l JOIN tra t ON t.id = l.return_id
       WHERE l.is_exchange = false), '[]'::jsonb),
    'gv', COALESCE((SELECT jsonb_agg(jsonb_build_object('product_id', g.product_id, 'sl', g.sl, 'tien', g.tien)) FROM gv g), '[]'::jsonb),
    'gv_tra', COALESCE((SELECT jsonb_agg(jsonb_build_object('return_id', g.return_id, 'product_id', g.product_id, 'tien', g.tien)) FROM gv_tra g), '[]'::jsonb)
  )
$fn$;

-- 2) Công nợ tính lùi về ngày X — thay 3 lượt đọc của napCongNo.
CREATE OR REPLACE FUNCTION public.bao_cao_cong_no(p_tu_thu date, p_tu_90 date)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $fn$
  WITH phieu AS (
    SELECT r.id, r.customer_id, r.sales_user_id, r.invoice_id, r.return_id, r.amount, r.paid,
           r.due_date, r.status, r.created_at,
           CASE WHEN i.id IS NULL THEN NULL
                ELSE jsonb_build_object('invoice_code', i.invoice_code, 'invoice_date', i.invoice_date) END AS invoice
      FROM receivables r
      LEFT JOIN sales_invoices i ON i.id = r.invoice_id
     WHERE r.org_id = public.user_org_id()
  )
  SELECT jsonb_build_object(
    'mo', COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM phieu p WHERE p.status <> 'paid'), '[]'::jsonb),
    'gan90', COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM phieu p
                        WHERE p.created_at >= (p_tu_90::text || 'T00:00:00+07:00')::timestamptz), '[]'::jsonb),
    'thu', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', t.id, 'amount', t.amount, 'method', t.method, 'collected_at', t.collected_at,
               'receivable_id', t.receivable_id, 'receivable', to_jsonb(p)))
        FROM payments t
        LEFT JOIN phieu p ON p.id = t.receivable_id
       WHERE t.collected_at >= (p_tu_thu::text || 'T00:00:00+07:00')::timestamptz), '[]'::jsonb)
  )
$fn$;

-- 3) Tồn kho + dòng bán 90 ngày (bán TB / ngày, ngày bán gần nhất) — thay 3 lượt đọc của napTonKho.
CREATE OR REPLACE FUNCTION public.bao_cao_ton_kho(p_tu date, p_den date)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $fn$
  SELECT jsonb_build_object(
    'lo', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', b.id, 'product_id', b.product_id, 'batch_code', b.batch_code, 'qty_on_hand', b.qty_on_hand,
               'unit_cost', b.unit_cost, 'expires_at', b.expires_at, 'created_at', b.created_at) ORDER BY b.id)
        FROM batches b
       WHERE b.org_id = public.user_org_id() AND b.qty_on_hand > 0), '[]'::jsonb),
    'dong', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'ngay', i.invoice_date, 'invoice_id', l.invoice_id, 'product_id', l.product_id,
               'unit_name', l.unit_name, 'conversion_factor', l.conversion_factor, 'quantity', l.quantity,
               'is_exchange', l.is_exchange))
        FROM sales_invoice_lines l
        JOIN sales_invoices i ON i.id = l.invoice_id
       WHERE i.org_id = public.user_org_id()
         AND i.status = 'posted'
         AND i.invoice_date BETWEEN p_tu AND p_den), '[]'::jsonb)
  )
$fn$;

REVOKE ALL ON FUNCTION public.bao_cao_so_ban(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bao_cao_cong_no(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bao_cao_ton_kho(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bao_cao_so_ban(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bao_cao_cong_no(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bao_cao_ton_kho(date, date) TO authenticated;

COMMENT ON FUNCTION public.bao_cao_so_ban(date, date) IS
  'Báo cáo tổng hợp: dòng thô số bán của kỳ trong một lượt (mig 204, SECURITY INVOKER).';
COMMENT ON FUNCTION public.bao_cao_cong_no(date, date) IS
  'Báo cáo tổng hợp: phiếu nợ + khoản thu để tính công nợ lùi về ngày X (mig 204, SECURITY INVOKER).';
COMMENT ON FUNCTION public.bao_cao_ton_kho(date, date) IS
  'Báo cáo tổng hợp: lô tồn + dòng bán gần đây (mig 204, SECURITY INVOKER).';

-- Chỉ mục cho các điều kiện lọc của ba hàm (có sẵn thì bỏ qua).
CREATE INDEX IF NOT EXISTS idx_sales_invoices_org_status_date ON public.sales_invoices (org_id, status, invoice_date);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_invoice ON public.sales_invoice_lines (invoice_id);
CREATE INDEX IF NOT EXISTS idx_returns_org_revenue_date ON public.returns (org_id, revenue_date);
CREATE INDEX IF NOT EXISTS idx_return_lines_return ON public.return_lines (return_id);
CREATE INDEX IF NOT EXISTS idx_stock_entries_org_type_posted ON public.stock_entries (org_id, type, status, posted_at);
CREATE INDEX IF NOT EXISTS idx_stock_entries_notes_import ON public.stock_entries (notes) WHERE type = 'import';
CREATE INDEX IF NOT EXISTS idx_stock_entry_lines_entry ON public.stock_entry_lines (entry_id);
CREATE INDEX IF NOT EXISTS idx_payments_collected_at ON public.payments (collected_at);

NOTIFY pgrst, 'reload schema';

SELECT 'Báo cáo đọc một lượt' AS hang_muc,
       (to_regprocedure('public.bao_cao_so_ban(date, date)') IS NOT NULL
        AND to_regprocedure('public.bao_cao_cong_no(date, date)') IS NOT NULL
        AND to_regprocedure('public.bao_cao_ton_kho(date, date)') IS NOT NULL) AS da_co_du_ba_ham;
