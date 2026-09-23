-- ====================================================================
-- DÒ HÓA ĐƠN LẬP LẠI BỊ GHI HỆ SỐ QUY ĐỔI = 1 (lỗi màn POS Sửa hóa đơn)
--
-- CHỈ ĐỌC — không sửa gì. Chạy trong Supabase SQL Editor.
--
-- ⚠ LỖI: trước bản sửa 23/09/2026, màn POS "Sửa hóa đơn" nạp lại mọi dòng
--   với hệ số 1 rồi gửi xuống `reissue_invoice`. `post_invoice` ghi và trừ
--   kho `quantity × conversion_factor` đúng như màn gửi — dòng "2 thùng"
--   (×24) chỉ trừ 2 hộp. Tiền trên hóa đơn vẫn đúng (giá × số thùng);
--   chỉ KHO (và giá vốn) sai.
--
-- ⚠ CHỈ TÍNH HÓA ĐƠN CÒN HIỆU LỰC (`posted`). Hóa đơn lỗi đã bị huỷ thì
--   lần huỷ hoàn về đúng số nó đã trừ — hai cái sai triệt tiêu nhau.
--
-- Cột `kho_da_tru_that` đọc từ chính phiếu xuất của hóa đơn — là bằng
-- chứng, không phải suy ra. `thieu_tru` > 0 nghĩa là tồn kho trên sổ
-- đang DƯ đúng chừng ấy (đơn vị cơ sở).
-- ====================================================================

WITH dong_nghi AS (
  SELECT
    si.id              AS invoice_id,
    si.invoice_code,
    si.invoice_date,
    goc.invoice_code   AS lap_lai_tu,
    si.stock_entry_id,
    sil.product_id,
    p.sku,
    p.name             AS ten_hang,
    p.base_unit,
    sil.unit_name,
    sil.quantity,
    sil.conversion_factor          AS he_so_da_ghi,
    pu.conversion                  AS he_so_dung,
    sil.quantity * sil.conversion_factor AS da_tru_theo_hoa_don,
    sil.quantity * pu.conversion         AS le_ra_phai_tru
  FROM sales_invoices si
  JOIN sales_invoice_lines sil ON sil.invoice_id = si.id
  JOIN products p              ON p.id = sil.product_id
  JOIN product_units pu        ON pu.product_id = sil.product_id AND pu.unit_name = sil.unit_name
  LEFT JOIN sales_invoices goc ON goc.id = si.replaced_from
  WHERE si.org_id = public.user_org_id()
    AND si.status = 'posted'
    AND si.replaced_from IS NOT NULL          -- chỉ hóa đơn LẬP LẠI
    AND sil.unit_name <> p.base_unit
    AND pu.conversion > 1
    AND sil.conversion_factor <> pu.conversion
)
SELECT
  d.invoice_code                          AS hoa_don,
  d.invoice_date                          AS ngay,
  d.lap_lai_tu,
  d.sku,
  d.ten_hang,
  d.quantity || ' ' || d.unit_name        AS so_luong,
  trim_scale(d.he_so_da_ghi)             AS he_so_da_ghi,
  d.he_so_dung,
  trim_scale(d.le_ra_phai_tru)           AS le_ra_tru,
  trim_scale(d.da_tru_theo_hoa_don)      AS hoa_don_ghi_tru,
  trim_scale((SELECT COALESCE(sum(COALESCE(sel.qty_in_base_uom, sel.quantity)), 0)
     FROM stock_entry_lines sel
    WHERE sel.entry_id = d.stock_entry_id
      AND sel.product_id = d.product_id)) AS kho_da_tru_that,
  trim_scale(d.le_ra_phai_tru - d.da_tru_theo_hoa_don) AS thieu_tru,
  d.base_unit                             AS don_vi_co_so
FROM dong_nghi d
ORDER BY d.invoice_date DESC, d.invoice_code, d.sku;
