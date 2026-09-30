-- QUÉT "CHÊNH LỆCH" CỦA BÁO CÁO BÁN HÀNG THEO NHÂN VIÊN (chủ nhà 30/09/2026: "quét lại cho tao báo
-- cáo bán hàng theo nhân viên, phần chênh lệch, từng nhân viên").
--
-- CHỈ ĐỌC — chạy được trên Supabase (SQL Editor). Đổi kỳ ở CTE `ky` (mặc định: tháng này, giờ VN).
--
-- Báo cáo tổng hợp > Bán hàng > Theo nhân viên đang tính:
--     Chênh lệch = Doanh thu − Giá trị niêm yết
--       Doanh thu      = tiền HOÁ ĐƠN (sales_invoices.total) chia về từng dòng theo line_total
--                        → ĐÃ CỘNG VAT và ĐÃ TRỪ giảm giá cả đơn
--       Niêm yết       = SL dòng × giá bảng giá CHUNG HIỆN TẠI của đơn vị dòng
--                        (không có giá bảng → đơn giá trên dòng, chênh 0)
-- Bảng dưới tách con số đó ra từng phần để thấy nó đến từ đâu:
--     chenh_bao_cao  ≈ (tien_hang − niem_yet)  − giam_gia_don + vat
--     tien_hang − niem_yet = chênh giá bán so với bảng giá chung hiện tại (gồm cả giá nhóm khách,
--                            sửa giá, giảm dòng, và giá đã đổi sau ngày bán)
--     ck_luc_ban     = Σ line_discount — giảm so với giá bảng CỦA KHÁCH đúng lúc bán (chụp trên dòng)
WITH ky AS (
  SELECT date_trunc('month', (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::date AS tu,
         (date_trunc('month', (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')) + interval '1 month - 1 day')::date AS den
),
hd AS (
  SELECT si.* FROM sales_invoices si, ky
  WHERE si.status = 'posted' AND si.invoice_date BETWEEN ky.tu AND ky.den
),
dong AS (
  SELECT l.*, hd.sales_user_id, hd.invoice_code, p.base_unit, p.sell_price,
         -- hệ số: chụp trên dòng trước, rồi danh mục (như heSoQuyDoi)
         CASE WHEN l.unit_name = p.base_unit THEN 1
              ELSE COALESCE(NULLIF(l.conversion_factor, 0),
                            (SELECT pu.conversion FROM product_units pu WHERE pu.product_id = l.product_id AND pu.unit_name = l.unit_name LIMIT 1), 1)
         END AS he_so,
         (SELECT pl.price FROM price_lists pl
           WHERE pl.product_id = l.product_id AND pl.unit_name = l.unit_name AND pl.group_id IS NULL AND pl.price > 0
           ORDER BY pl.effective_from DESC NULLS LAST LIMIT 1) AS gia_bang_dv,
         (SELECT pl.price FROM price_lists pl
           WHERE pl.product_id = l.product_id AND pl.unit_name = p.base_unit AND pl.group_id IS NULL AND pl.price > 0
           ORDER BY pl.effective_from DESC NULLS LAST LIMIT 1) AS gia_bang_co_so
  FROM sales_invoice_lines l
  JOIN hd ON hd.id = l.invoice_id
  LEFT JOIN products p ON p.id = l.product_id
  WHERE NOT COALESCE(l.is_exchange, false)
),
dong2 AS (
  SELECT d.*,
         CASE WHEN d.gia_bang_dv > 0 THEN d.gia_bang_dv
              WHEN COALESCE(d.gia_bang_co_so, d.sell_price, 0) > 0 THEN COALESCE(d.gia_bang_co_so, d.sell_price) * d.he_so
              ELSE NULL END AS gia_niem_yet
  FROM dong d
),
dong3 AS (
  SELECT d.*,
         d.quantity * COALESCE(d.gia_niem_yet, d.unit_price) AS niem_yet,
         (d.gia_niem_yet IS NULL) AS khong_co_gia
  FROM dong2 d
),
theo_hd AS (
  SELECT hd.id, hd.sales_user_id, hd.total, hd.subtotal, hd.vat,
         COALESCE(SUM(d.line_total), 0) AS tien_hang,
         COALESCE(SUM(d.niem_yet), 0) AS niem_yet,
         COALESCE(SUM(d.line_discount), 0) AS ck_luc_ban,
         COUNT(d.id) AS so_dong,
         COUNT(d.id) FILTER (WHERE d.khong_co_gia) AS so_dong_khong_gia
  FROM hd LEFT JOIN dong3 d ON d.invoice_id = hd.id
  GROUP BY hd.id, hd.sales_user_id, hd.total, hd.subtotal, hd.vat
)
SELECT COALESCE(u.full_name, '(không gán NV)') AS nhan_vien,
       COUNT(*) AS so_hd,
       ROUND(SUM(t.tien_hang)) AS tien_hang,
       ROUND(SUM(t.niem_yet)) AS niem_yet,
       ROUND(SUM(t.tien_hang - t.niem_yet)) AS chenh_gia_ban_vs_bang,
       ROUND(SUM(t.ck_luc_ban)) AS ck_luc_ban,
       ROUND(SUM(GREATEST(t.tien_hang - t.subtotal, 0))) AS giam_gia_don,
       ROUND(SUM(t.vat)) AS vat,
       ROUND(SUM(t.total)) AS doanh_thu_hd,
       -- số báo cáo đang hiện (chỉ HĐ có dòng — HĐ không dòng không có niêm yết)
       ROUND(SUM(CASE WHEN t.so_dong > 0 THEN t.total - t.niem_yet ELSE 0 END)) AS chenh_bao_cao,
       COUNT(*) FILTER (WHERE t.so_dong = 0) AS hd_khong_dong,
       SUM(t.so_dong_khong_gia) AS dong_khong_gia_niem_yet
FROM theo_hd t
LEFT JOIN users u ON u.id = t.sales_user_id
GROUP BY u.full_name
ORDER BY chenh_bao_cao;

-- 30 dòng lệch giá nhiều nhất (bán so với bảng giá chung hiện tại) — soi lỗi đơn vị / giá nhập nhầm.
WITH ky AS (
  SELECT date_trunc('month', (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::date AS tu,
         (date_trunc('month', (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')) + interval '1 month - 1 day')::date AS den
)
SELECT COALESCE(u.full_name, '(không gán NV)') AS nhan_vien, si.invoice_code, si.invoice_date,
       p.sku, p.name, l.unit_name, l.quantity, l.unit_price, l.line_discount,
       x.gia_niem_yet, ROUND(l.quantity * x.gia_niem_yet) AS niem_yet, l.line_total,
       ROUND(l.line_total - l.quantity * x.gia_niem_yet) AS chenh
FROM sales_invoice_lines l
JOIN sales_invoices si ON si.id = l.invoice_id AND si.status = 'posted'
JOIN ky ON si.invoice_date BETWEEN ky.tu AND ky.den
JOIN products p ON p.id = l.product_id
LEFT JOIN users u ON u.id = si.sales_user_id
CROSS JOIN LATERAL (
  SELECT COALESCE(
    (SELECT pl.price FROM price_lists pl WHERE pl.product_id = l.product_id AND pl.unit_name = l.unit_name
       AND pl.group_id IS NULL AND pl.price > 0 ORDER BY pl.effective_from DESC NULLS LAST LIMIT 1),
    COALESCE((SELECT pl.price FROM price_lists pl WHERE pl.product_id = l.product_id AND pl.unit_name = p.base_unit
       AND pl.group_id IS NULL AND pl.price > 0 ORDER BY pl.effective_from DESC NULLS LAST LIMIT 1), NULLIF(p.sell_price, 0))
    * CASE WHEN l.unit_name = p.base_unit THEN 1 ELSE COALESCE(NULLIF(l.conversion_factor, 0), 1) END
  ) AS gia_niem_yet
) x
WHERE NOT COALESCE(l.is_exchange, false) AND x.gia_niem_yet IS NOT NULL
ORDER BY abs(l.line_total - l.quantity * x.gia_niem_yet) DESC
LIMIT 30;
