-- ====================================================================
-- DÒNG HÓA ĐƠN CÓ ĐƠN VỊ RỖNG — CHỈ ĐỌC
--
-- Câu dò trước cho thấy 42 dòng hóa đơn còn hiệu lực có `unit_name` RỖNG,
-- hệ số ghi 1 — kho đã trừ theo đơn vị cơ sở. Câu này đoán ĐƠN VỊ THẬT
-- của từng dòng từ những gì còn lại:
--   · don_gia            — đơn giá trên dòng hóa đơn
--   · gia_le             — giá đơn vị cơ sở (bảng giá chung, hoặc sell_price)
--   · gia_thung / he_so_thung — giá và hệ số của đơn vị lớn (bảng giá chung)
--   · doan               — "LẺ" nếu đơn giá gần giá lẻ, "THÙNG" nếu gần giá
--                           thùng, "?" nếu không gần cái nào
--   · dv_dong_don / he_so_dong_don — dòng ĐƠN HÀNG gốc ghi gì
--   · lap_lai            — hóa đơn này có phải bản LẬP LẠI (sửa hóa đơn) không
--   · kho_da_tru / le_ra_tru_neu_la_thung — số đơn vị cơ sở
-- ====================================================================
WITH dong AS (
  SELECT
    si.invoice_code, si.invoice_date, si.replaced_from IS NOT NULL AS lap_lai,
    p.id AS product_id, p.sku, p.name, p.base_unit, p.sell_price,
    sil.quantity, sil.unit_price, sil.conversion_factor, sil.is_exchange,
    sol.unit_name AS dv_dong_don, sol.conversion_factor AS he_so_dong_don
  FROM sales_invoice_lines sil
  JOIN sales_invoices si ON si.id = sil.invoice_id AND si.status = 'posted'
  JOIN products p ON p.id = sil.product_id
  LEFT JOIN sales_order_lines sol ON sol.id = sil.order_line_id
  WHERE btrim(coalesce(sil.unit_name, '')) = ''
),
gia AS (
  SELECT d.*,
    coalesce(
      (SELECT pl.price FROM price_lists pl
        WHERE pl.product_id = d.product_id AND pl.group_id IS NULL AND pl.unit_name = d.base_unit
        ORDER BY pl.effective_from DESC NULLS LAST LIMIT 1),
      d.sell_price) AS gia_le,
    (SELECT pu.unit_name FROM product_units pu
      WHERE pu.product_id = d.product_id AND pu.unit_name <> d.base_unit
      ORDER BY pu.conversion DESC LIMIT 1) AS dv_lon,
    (SELECT pu.conversion FROM product_units pu
      WHERE pu.product_id = d.product_id AND pu.unit_name <> d.base_unit
      ORDER BY pu.conversion DESC LIMIT 1) AS he_so_thung
  FROM dong d
),
gia2 AS (
  SELECT g.*,
    coalesce(
      (SELECT pl.price FROM price_lists pl
        WHERE pl.product_id = g.product_id AND pl.group_id IS NULL AND pl.unit_name = g.dv_lon
        ORDER BY pl.effective_from DESC NULLS LAST LIMIT 1),
      g.gia_le * g.he_so_thung) AS gia_thung
  FROM gia g
)
SELECT
  invoice_code AS hoa_don, invoice_date AS ngay, lap_lai, sku, name AS ten_hang,
  trim_scale(quantity) AS sl, trim_scale(unit_price) AS don_gia,
  trim_scale(gia_le) AS gia_le, dv_lon, he_so_thung, trim_scale(gia_thung) AS gia_thung,
  CASE
    WHEN unit_price IS NULL OR unit_price = 0 THEN '?'
    WHEN gia_thung > 0 AND abs(unit_price - gia_thung) <= abs(unit_price - coalesce(gia_le, 0))
         AND unit_price > gia_thung * 0.5 THEN 'THÙNG'
    WHEN gia_le > 0 AND abs(unit_price - gia_le) <= gia_le * 0.5 THEN 'LẺ'
    ELSE '?'
  END AS doan,
  nullif(dv_dong_don, '') AS dv_dong_don, trim_scale(he_so_dong_don) AS he_so_dong_don,
  is_exchange AS hang_doi,
  trim_scale(quantity * coalesce(conversion_factor, 1)) AS kho_da_tru,
  trim_scale(quantity * coalesce(he_so_thung, 1)) AS le_ra_tru_neu_la_thung
FROM gia2
ORDER BY invoice_date, invoice_code, sku;
