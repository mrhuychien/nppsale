-- QUÉT "CHÊNH LỆCH" CỦA BÁO CÁO BÁN HÀNG THEO NHÂN VIÊN (chủ nhà 30/09/2026: "quét lại cho tao báo
-- cáo bán hàng theo nhân viên, phần chênh lệch, từng nhân viên").
--
-- CHỈ ĐỌC — chạy được trên Supabase (SQL Editor). Đổi kỳ ở CTE `ky` (mặc định: tháng này, giờ VN).
--
-- LUẬT MỚI (mig 218, `src/lib/analytics/chenh-lech.ts`) — chủ nhà 30/09/2026: "Hàng trả về và Hàng
-- đi: Nhân viên sửa giá loại nào -> tính phần chênh số lượng X (giá sửa - giá gốc). Phần giảm giá cả
-- đơn tính riêng (tính theo đơn)":
--   chênh bán   = Σ SL × (giá sửa − giá gốc)   giá gốc / đơn vị cơ sở = (đơn giá + chiết khấu / SL) của
--                                              DÒNG ĐƠN ÷ hệ số (giá của khách lúc bán)
--   chênh trả   = Σ SL trả × (giá trả − giá gốc trên HĐ gốc)
--   chênh thuần = chênh bán − chênh trả
--   giảm giá đơn = Σ (tiền hàng − subtotal) theo hoá đơn — cột RIÊNG
-- Cột `chenh_cu_bao_cao` = số màn hình hiện TRƯỚC khi sửa (tiền HĐ gồm VAT − bảng giá chung hiện tại)
-- để đối chiếu.
WITH ky AS (
  SELECT date_trunc('month', (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::date AS tu,
         (date_trunc('month', (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')) + interval '1 month - 1 day')::date AS den
),
hd AS (
  SELECT si.* FROM sales_invoices si, ky
  WHERE si.status = 'posted' AND si.invoice_date BETWEEN ky.tu AND ky.den
),
-- Giá niêm yết lúc bán / đơn vị cơ sở của MỌI dòng hoá đơn (dùng cho cả bán lẫn trả).
gia_dong AS (
  SELECT l.id, l.invoice_id, l.product_id, l.unit_name, l.quantity, l.unit_price, l.line_total,
         CASE WHEN l.unit_name = p.base_unit THEN 1 ELSE COALESCE(NULLIF(l.conversion_factor, 0),
              (SELECT pu.conversion FROM product_units pu WHERE pu.product_id = l.product_id AND pu.unit_name = l.unit_name LIMIT 1), 1) END AS he_so,
         CASE
           WHEN s.id IS NOT NULL AND s.quantity > 0 THEN
             (s.unit_price + GREATEST(COALESCE(s.line_discount, 0), 0) / s.quantity)
             / CASE WHEN s.unit_name = p.base_unit THEN 1 ELSE COALESCE(NULLIF(s.conversion_factor, 0),
                    (SELECT pu.conversion FROM product_units pu WHERE pu.product_id = l.product_id AND pu.unit_name = s.unit_name LIMIT 1), 1) END
           WHEN l.order_line_id IS NULL AND l.quantity > 0 AND l.line_discount IS NOT NULL THEN
             (l.unit_price + GREATEST(l.line_discount, 0) / l.quantity)
             / CASE WHEN l.unit_name = p.base_unit THEN 1 ELSE COALESCE(NULLIF(l.conversion_factor, 0), 1) END
         END AS gia_ny_co_so,
         -- bảng giá chung hiện tại của đơn vị dòng (luật cũ)
         COALESCE(
           (SELECT pl.price FROM price_lists pl WHERE pl.product_id = l.product_id AND pl.unit_name = l.unit_name
              AND pl.group_id IS NULL AND pl.price > 0 ORDER BY pl.effective_from DESC NULLS LAST LIMIT 1),
           COALESCE((SELECT pl.price FROM price_lists pl WHERE pl.product_id = l.product_id AND pl.unit_name = p.base_unit
              AND pl.group_id IS NULL AND pl.price > 0 ORDER BY pl.effective_from DESC NULLS LAST LIMIT 1), NULLIF(p.sell_price, 0))
           * CASE WHEN l.unit_name = p.base_unit THEN 1 ELSE COALESCE(NULLIF(l.conversion_factor, 0), 1) END,
           l.unit_price) AS gia_bang_hien_tai
  FROM sales_invoice_lines l
  LEFT JOIN products p ON p.id = l.product_id
  LEFT JOIN sales_order_lines s ON s.id = l.order_line_id
  WHERE NOT COALESCE(l.is_exchange, false)
),
ban AS (
  SELECT hd.sales_user_id AS nv, hd.id AS hd_id, hd.total, hd.subtotal,
         SUM(g.line_total) OVER (PARTITION BY hd.id) AS tien_hang_hd,
         g.line_total, g.quantity, g.he_so, g.unit_price, g.gia_ny_co_so, g.gia_bang_hien_tai
  FROM hd JOIN gia_dong g ON g.invoice_id = hd.id
),
ban2 AS (
  SELECT nv, hd_id, total, subtotal, tien_hang_hd,
         line_total AS ban_truoc_thue,
         CASE WHEN gia_ny_co_so IS NOT NULL THEN quantity * he_so * gia_ny_co_so ELSE quantity * gia_bang_hien_tai END AS ny_luc_ban,
         quantity * gia_bang_hien_tai AS ny_bang_hien_tai,
         line_total * CASE WHEN tien_hang_hd > 0 THEN total / tien_hang_hd ELSE 0 END AS tien_hd_phan_bo,
         (gia_ny_co_so IS NULL) AS lui_bang_gia
  FROM ban
),
-- NV của phiếu trả: tên trên phiếu, rồi NV của HĐ gắn (báo cáo còn đoán theo HĐ gần nhất của khách
-- cho phiếu cũ chưa gán — câu này bỏ bước đoán đó, xếp "(không gán NV)").
tra AS (
  SELECT r.id, r.invoice_id, r.sales_user_id AS nv
  FROM returns r, ky
  WHERE r.revenue_date BETWEEN ky.tu AND ky.den
),
tra2 AS (
  SELECT COALESCE(t.nv, h.sales_user_id) AS nv, rl.quantity, rl.unit_price, rl.line_total, rl.product_id,
         CASE WHEN rl.unit_name = p.base_unit OR rl.unit_name IS NULL THEN 1
              ELSE COALESCE((SELECT pu.conversion FROM product_units pu WHERE pu.product_id = rl.product_id AND pu.unit_name = rl.unit_name LIMIT 1), 1) END AS he_so,
         (SELECT SUM(g.quantity * g.he_so * g.gia_ny_co_so) / NULLIF(SUM(g.quantity * g.he_so), 0)
            FROM gia_dong g WHERE g.invoice_id = t.invoice_id AND g.product_id = rl.product_id AND g.gia_ny_co_so IS NOT NULL) AS gia_ny_co_so
  FROM tra t
  JOIN return_lines rl ON rl.return_id = t.id AND NOT COALESCE(rl.is_exchange, false)
  LEFT JOIN sales_invoices h ON h.id = t.invoice_id
  LEFT JOIN products p ON p.id = rl.product_id
),
tong_ban AS (
  SELECT nv, COUNT(DISTINCT hd_id) AS so_hd, SUM(ban_truoc_thue) AS ban_tt, SUM(ny_luc_ban) AS ny,
         (SELECT SUM(GREATEST(x.tien_hang_hd - x.subtotal, 0)) FROM (SELECT DISTINCT hd_id, tien_hang_hd, subtotal FROM ban2 b2 WHERE b2.nv = ban2.nv) x) AS giam_don,
         SUM(tien_hd_phan_bo - ny_bang_hien_tai) AS chenh_cu, COUNT(*) FILTER (WHERE lui_bang_gia) AS dong_lui
  FROM ban2 GROUP BY nv
),
tong_tra AS (
  SELECT nv, SUM(quantity * unit_price) AS tra_tt,
         SUM(CASE WHEN gia_ny_co_so IS NOT NULL THEN quantity * he_so * gia_ny_co_so ELSE quantity * unit_price END) AS ny_tra,
         COUNT(*) FILTER (WHERE gia_ny_co_so IS NULL) AS dong_tra_khong_gia
  FROM tra2 GROUP BY nv
)
SELECT COALESCE(u.full_name, '(không gán NV)') AS nhan_vien,
       COALESCE(b.so_hd, 0) AS so_hd,
       ROUND(COALESCE(b.ny, 0)) AS niem_yet_luc_ban,
       ROUND(COALESCE(b.ban_tt, 0)) AS tien_theo_gia_sua,
       ROUND(COALESCE(b.ban_tt, 0) - COALESCE(b.ny, 0)) AS chenh_ban,
       ROUND(COALESCE(b.giam_don, 0)) AS giam_gia_don,
       ROUND(COALESCE(t.tra_tt, 0)) AS tra_truoc_thue,
       ROUND(COALESCE(t.tra_tt, 0) - COALESCE(t.ny_tra, 0)) AS chenh_tra,
       ROUND((COALESCE(b.ban_tt, 0) - COALESCE(b.ny, 0)) - (COALESCE(t.tra_tt, 0) - COALESCE(t.ny_tra, 0))) AS chenh_thuan,
       ROUND(COALESCE(b.chenh_cu, 0)) AS chenh_cu_bao_cao,
       COALESCE(b.dong_lui, 0) AS dong_ban_lui_bang_gia,
       COALESCE(t.dong_tra_khong_gia, 0) AS dong_tra_khong_ro_gia
FROM tong_ban b
FULL JOIN tong_tra t ON t.nv = b.nv
LEFT JOIN users u ON u.id = COALESCE(b.nv, t.nv)
ORDER BY chenh_thuan;
