-- ====================================================================
-- TỔNG CỦA DANH SÁCH CỘNG NGAY TRÊN MÁY CHỦ — tiền "còn lại" của hoá đơn; tồn kho bán theo mặt hàng một câu
--
-- VÌ SAO — chủ nhà 01/11/2026: "em rà soát xem thêm 1 số thao tác như tìm kiếm trong danh sách (đơn hàng, hóa đơn...)
--   nhiều khi còn chậm hoặc mở đơn hàng, sửa đơn hàng, hóa đơn... ở pos còn chậm".
--   Đo bằng app bản build production + PostgREST 12.2 thật trên sổ thử 40.000 HĐ (đúng RLS, JIT tắt như mig 251/252):
--     · Dải "Tổng tiền" của danh sách Hoá đơn là số CÒN LẠI sau hàng trả (mig 192). Trình duyệt tải id + tiền của MỌI hoá
--       đơn khớp bộ lọc (1.000 dòng một câu, trần 20.000), rồi tra hàng trả 200 hoá đơn một câu, NỐI ĐUÔI. NVBH 13.333 HĐ,
--       kỳ "Tất cả": mở danh sách 86–100 câu / 66–68 đợt — máy tính 4,7 giây, điện thoại 4G ~10 giây. Chủ NPP 38.000 HĐ: 20
--       câu rồi chạm trần → dải tổng hiện "—". Gõ tìm một chữ rộng (tên khách) là chạy lại cả chùm.
--     · Một câu gộp trên view dưới đây: 40–80 ms cho 38.000 HĐ (chủ NPP), 65–130 ms cho 25.000 HĐ (NVBH) — kể cả khi ô tìm
--       khớp gần hết sổ.
--     · Tồn kho ở POS / bán hàng (`docLoBan`): tải từng lô kho bán (5.000 lô = 5 câu, 2 đợt, ~300 KB) rồi cộng ở máy, MỖI
--       lần mở đơn / sửa đơn / sửa hoá đơn. Hàm dưới trả sẵn tồn theo mặt hàng trong MỘT câu.
--
-- LÀM GÌ
--   1. View `v_hoa_don_con_lai` (security_invoker — chạy bằng RLS của NGƯỜI GỌI, như đọc thẳng bảng): mọi cột của
--      `sales_invoices` + `con_lai` = total − khoản trừ của phiếu trả gắn hoá đơn, ĐÚNG luật `creditCounted` /
--      `creditOnInvoice` (src/lib/orders/invoice-credit.ts): phiếu đi cùng HĐ trừ khi submitted / completed, phiếu độc lập
--      khi completed, mỗi phiếu max(0, credit_note_amount) — bản sao luật của `_wf2b_recompute_receivable` (mig 133).
--      Khoản trừ là truy vấn con THEO TỪNG TỜ, đi chỉ mục `idx_returns_invoice` (mig 124) — kế hoạch không phụ thuộc ước
--      lượng. Bản "gộp hàng trả một lần rồi LEFT JOIN" để Postgres đoán sai khi ô tìm khớp rộng (đoán 5.745 tờ / thật 38.000;
--      nhóm phiếu trả đoán 47 / thật 1.870) → nối vòng lặp lồng 69 triệu phép so: chủ NPP 3,3 giây, NVBH 2 giây; truy vấn
--      con: 83 / 131 ms. Không tìm thì hai bản ngang nhau (41–65 ms).
--   2. `ton_ban_theo_hang()` → {product_id: tồn} của lô KHO BÁN còn hàng — đúng `docLoBan` + `stockMapFrom`
--      (src/lib/sell/ref-data.ts). STABLE SECURITY INVOKER (RLS lô hàng như cũ), JIT tắt trên hàm (luật mig 256).
--   App dùng hai thứ này khi có, sổ chưa chạy 257 thì lùi về cách cũ (không sai số, chỉ chậm như trước).
-- ⚠ View PHẢI security_invoker: view thường chạy bằng quyền chủ view, BỎ QUA RLS — NVBH sẽ cộng được tiền của cả NPP
--   (luật mig 092). `i.*` chốt danh sách cột lúc tạo; bảng hoá đơn thêm cột sau này thì chạy lại tệp này.
-- ⚠ Đổi luật trừ hàng trả thì sửa CẢ BA chỗ: view này, `creditCounted` và `_wf2b_recompute_receivable`.
-- ====================================================================

-- 1. Tiền còn lại của từng hoá đơn (DROP + CREATE: CREATE OR REPLACE không thêm được cột mới của `sales_invoices` vào
--    giữa `i.*` và `con_lai`).
DROP VIEW IF EXISTS public.v_hoa_don_con_lai;
CREATE VIEW public.v_hoa_don_con_lai WITH (security_invoker = true) AS
SELECT i.*,
       i.total - COALESCE((
         SELECT sum(GREATEST(0, COALESCE(r.credit_note_amount, 0)))
           FROM public.returns r
          WHERE r.invoice_id = i.id
            AND ((r.credit_with_invoice IS TRUE AND r.status IN ('submitted', 'completed'))
                 OR (r.credit_with_invoice IS NOT TRUE AND r.status = 'completed'))
       ), 0) AS con_lai
  FROM public.sales_invoices i;
COMMENT ON VIEW public.v_hoa_don_con_lai IS
  'Hoá đơn + con_lai (total − hàng trả đã trừ, luật creditCounted). security_invoker: RLS của người gọi. Mig 257.';
REVOKE ALL ON public.v_hoa_don_con_lai FROM PUBLIC, anon;
GRANT SELECT ON public.v_hoa_don_con_lai TO authenticated;

-- 2. Tồn kho bán theo mặt hàng — một câu thay cho tải từng lô.
CREATE OR REPLACE FUNCTION public.ton_ban_theo_hang()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public SET jit = off AS $fn$
  SELECT COALESCE(jsonb_object_agg(t.product_id, t.sl), '{}'::jsonb)
    FROM (
      SELECT b.product_id, sum(b.qty_on_hand) AS sl
        FROM batches b
       WHERE b.org_id = (SELECT public.user_org_id())
         AND b.qty_on_hand > 0
         AND b.warehouse_zone = 'sale'
       GROUP BY b.product_id
    ) t
$fn$;
REVOKE ALL ON FUNCTION public.ton_ban_theo_hang() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ton_ban_theo_hang() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Tóm tắt — chỉ đọc. Mong đợi: view có security_invoker=true; hàm STABLE, không definer, jit=off.
-- ---------------------------------------------------------------------
SELECT 'View v_hoa_don_con_lai' AS hang_muc,
       CASE WHEN c.oid IS NULL THEN 'CHƯA CÓ'
            WHEN 'security_invoker=true' = ANY (coalesce(c.reloptions, '{}')) THEN 'security_invoker=true'
            ELSE 'THIẾU security_invoker — KHÔNG ĐƯỢC DÙNG' END AS gia_tri
  FROM (SELECT to_regclass('public.v_hoa_don_con_lai') AS r) x
  LEFT JOIN pg_class c ON c.oid = x.r
UNION ALL
SELECT 'Hàm ton_ban_theo_hang()',
       coalesce((SELECT CASE WHEN p.provolatile = 's' AND NOT p.prosecdef AND 'jit=off' = ANY (coalesce(p.proconfig, '{}'))
                             THEN 'STABLE · invoker · jit=off' ELSE 'LỆCH cấu hình' END
                   FROM pg_proc p WHERE p.oid = to_regprocedure('public.ton_ban_theo_hang()')), 'CHƯA CÓ');
