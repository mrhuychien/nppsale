-- ====================================================================
-- BÁO CÁO ĐỌC NHANH — tắt JIT ngay trên các hàm báo cáo; bao_cao_so_ban bỏ hai phần app không còn đọc
--
-- VÌ SAO — chủ nhà 29/10/2026 (Báo cáo tổng hợp › Bán hàng): "sao nó cứ dĩnh lỗi này nhỉ — Không đọc được số liệu ·
--   Đọc số bán hàng hỏng: Mạng chậm hoặc máy chủ đang bận: đọc số bán: AbortError: Máy chủ chưa trả lời sau 10 giây".
--   Đo trên sổ thử 40.000 HĐ / 320.000 dòng HĐ / 307.000 dòng phiếu kho (tháng 9: 1.568 HĐ, 12.544 dòng), đúng vai
--   `authenticated` + RLS của chủ NPP:
--     · bao_cao_so_ban tháng 9 — JIT tắt 0,5–0,6 giây; JIT BẬT 3,4–4,1 giây. Chi phí ƯỚC LƯỢNG của câu ≈ 1,09 triệu, vượt
--       ngưỡng tối ưu JIT (500.000) nên lần gọi nào Postgres cũng ngồi biên dịch ~3 giây. Máy chủ Supabase chậm hơn máy
--       thử → quá 10 giây, trình duyệt bỏ chờ.
--     · Mig 251 / 252 tắt JIT theo VAI (authenticated / authenticator). Sổ chưa chạy 252, hoặc kết nối cũ của PostgREST
--       chưa mở lại, thì JIT vẫn bật. `SET jit = off` ĐẶT TRÊN HÀM thì Postgres áp ngay lúc gọi hàm — không phụ thuộc vai,
--       PostgREST hay kết nối nào.
--     · Kết quả trả về 7,2 MB một tháng; trong đó `dong_don` (1,9 MB) và `dong_hd_goc` (0,2 MB) là dữ liệu "giá lúc bán" của
--       mig 218 — app KHÔNG còn đọc từ khi chủ nhà chốt lại luật chênh lệch 01/10/2026 (so với bảng giá cùng đơn vị). Bỏ đi
--       là bớt hai lượt nối dòng đơn qua RLS và ~30% dung lượng.
--
-- LÀM GÌ
--   1. bao_cao_so_ban: thân như mig 228, BỎ `dong_hd_goc` + `dong_don`; `user_org_id()` tính MỘT lần mỗi câu
--      (`(SELECT …)`, luật mig 250); thêm `SET jit = off`. Vẫn STABLE SECURITY INVOKER — RLS tự lọc như cũ. Các phần app đọc
--      (hd, dong_hd, tra, dong_tra, gv, gv_tra) giữ nguyên từng dòng, từng cột.
--   2. Các hàm báo cáo nặng khác: ALTER FUNCTION … SET jit = off (hàm nào sổ chưa có thì bỏ qua).
--   Chỉ đổi CÁCH CHẠY + bỏ phần thừa, không đổi con số nào app hiện.
-- ⚠ Muốn bật lại JIT cho một hàm: ALTER FUNCTION <tên>(<kiểu>) RESET jit;
-- ====================================================================

CREATE OR REPLACE FUNCTION public.bao_cao_so_ban(p_tu date, p_den date)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public SET jit = off AS $fn$
  WITH
  hd AS (
    SELECT i.id, i.invoice_code, i.invoice_date, i.order_id, i.status, i.total, i.subtotal, i.vat,
           i.customer_id, i.sales_user_id, i.posted_by, i.payment_terms
      FROM sales_invoices i
     WHERE i.org_id = (SELECT public.user_org_id())
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
     WHERE r.org_id = (SELECT public.user_org_id())
       AND r.revenue_date BETWEEN p_tu AND p_den
  ),
  xuat AS (
    SELECT e.id
      FROM stock_entries e
     WHERE e.org_id = (SELECT public.user_org_id())
       AND e.status = 'posted'
       AND e.type = 'export'
       AND e.posted_at >= (p_tu::text || 'T00:00:00+07:00')::timestamptz
       AND e.posted_at <= (p_den::text || 'T23:59:59.999+07:00')::timestamptz
       -- (mig 228) Chỉ phiếu xuất của hàng THẬT SỰ BÁN: bỏ phiếu đảo của phiếu trả đã huỷ và phiếu xuất của HĐ đã huỷ.
       AND COALESCE(e.notes, '') NOT LIKE 'Đảo phiếu trả %'
       AND NOT EXISTS (SELECT 1 FROM sales_invoices si
                        WHERE si.stock_entry_id = e.id AND si.status = 'cancelled')
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
               'line_discount', l.line_discount, 'order_line_id', l.order_line_id) ORDER BY l.id)
        FROM sales_invoice_lines l JOIN hd h ON h.id = l.invoice_id), '[]'::jsonb),
    -- (mig 256) Bỏ `dong_hd_goc` + `dong_don` (giá lúc bán, mig 218) — app không đọc từ luật chênh 01/10/2026.
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

-- 2. Các hàm báo cáo nặng khác: tắt JIT ngay trên hàm. Sổ thiếu hàm nào thì bỏ qua (không làm hỏng cả tệp).
DO $jit$
DECLARE
  v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'public.bao_cao_cong_no(date, date)',
    'public.bao_cao_ton_kho(date, date)',
    'public.dashboard_summary(date)',
    'public.dashboard_top_customers(date, integer)',
    'public.dashboard_channel_revenue(date)',
    'public.finance_pnl(date, date)',
    'public.finance_cash_flow(date, date)',
    'public.finance_balance_sheet(date)'
  ] LOOP
    IF to_regprocedure(v) IS NULL THEN
      RAISE NOTICE 'Sổ chưa có hàm % — bỏ qua', v;
    ELSE
      EXECUTE format('ALTER FUNCTION %s SET jit = off', to_regprocedure(v));
    END IF;
  END LOOP;
END
$jit$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Tóm tắt — chỉ đọc. Mong đợi: mọi hàm báo cáo "jit=off"; bao_cao_so_ban không còn dong_don / dong_hd_goc.
-- ---------------------------------------------------------------------
SELECT p.oid::regprocedure::text AS ham,
       CASE WHEN 'jit=off' = ANY (coalesce(p.proconfig, '{}')) THEN 'jit=off' ELSE 'CHƯA tắt JIT' END AS jit,
       CASE WHEN p.proname = 'bao_cao_so_ban'
            THEN CASE WHEN position('''dong_don''' IN pg_get_functiondef(p.oid)) = 0 THEN 'đã bỏ dong_don / dong_hd_goc' ELSE 'CÒN dong_don' END
            ELSE '' END AS ghi_chu
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('bao_cao_so_ban', 'bao_cao_cong_no', 'bao_cao_ton_kho', 'dashboard_summary', 'dashboard_top_customers',
                     'dashboard_channel_revenue', 'finance_pnl', 'finance_cash_flow', 'finance_balance_sheet')
 ORDER BY 1;
