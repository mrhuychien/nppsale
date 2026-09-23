-- ====================================================================
-- DÒ DÒNG HÓA ĐƠN CÓ ĐƠN VỊ KHÔNG CÒN TRONG DANH MỤC — CHỈ ĐỌC
--
-- Mig 174 báo 42 dòng hóa đơn còn hiệu lực có đơn vị không nằm trong
-- `product_units` (và không phải đơn vị cơ sở). Với các đơn vị ấy máy chủ
-- KHÔNG tra được hệ số, nên vẫn tin số trình duyệt gửi lên.
--
-- Mỗi dòng dưới đây là một cặp (mặt hàng, đơn vị) — gộp các dòng hóa đơn:
--   · don_vi_tren_hoa_don  — đúng chữ đang ghi trên dòng hóa đơn
--   · he_so_da_ghi         — các hệ số đang ghi (vd "24" hoặc "1, 24")
--   · khop_neu_bo_hoa_thuong — đơn vị trong danh mục trùng chữ nếu bỏ
--     hoa/thường, dấu cách thừa (vd "Thùng " ↔ "thùng"); RỖNG = không có
--   · gan_giong_bo_dau     — đơn vị trong danh mục BẮT ĐẦU giống vậy khi bỏ
--     cả dấu tiếng Việt (vd "thùng" ↔ "Thung 24"); RỖNG = không có
--   · don_vi_danh_muc_hien_co — danh mục hiện có những đơn vị nào
-- ====================================================================
SELECT
  p.sku,
  p.name                                      AS ten_hang,
  p.base_unit                                 AS don_vi_co_so,
  sil.unit_name                               AS don_vi_tren_hoa_don,
  count(*)                                    AS so_dong,
  string_agg(DISTINCT trim_scale(sil.conversion_factor)::text, ', ') AS he_so_da_ghi,
  (SELECT string_agg(pu2.unit_name || ' ×' || pu2.conversion, ', ')
     FROM product_units pu2
    WHERE pu2.product_id = p.id
      AND lower(btrim(pu2.unit_name)) = lower(btrim(sil.unit_name))) AS khop_neu_bo_hoa_thuong,
  -- Bỏ dấu tiếng Việt + hoa/thường + dấu cách: "thùng" ↔ "Thung 24" thì khớp ở đây.
  (SELECT string_agg(pu4.unit_name || ' ×' || pu4.conversion, ', ')
     FROM product_units pu4
    WHERE pu4.product_id = p.id
      AND translate(lower(btrim(pu4.unit_name)), 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')
          LIKE translate(lower(btrim(sil.unit_name)), 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd') || '%') AS gan_giong_bo_dau,
  (SELECT string_agg(pu3.unit_name || ' ×' || pu3.conversion, ', ' ORDER BY pu3.conversion)
     FROM product_units pu3 WHERE pu3.product_id = p.id)             AS don_vi_danh_muc_hien_co,
  min(si.invoice_date)                        AS hoa_don_som_nhat,
  max(si.invoice_date)                        AS hoa_don_muon_nhat
FROM sales_invoice_lines sil
JOIN sales_invoices si ON si.id = sil.invoice_id AND si.status = 'posted'
JOIN products p        ON p.id = sil.product_id
LEFT JOIN product_units pu ON pu.product_id = sil.product_id AND pu.unit_name = sil.unit_name
WHERE sil.unit_name <> p.base_unit
  AND pu.product_id IS NULL
GROUP BY p.id, p.sku, p.name, p.base_unit, sil.unit_name
ORDER BY so_dong DESC, p.sku;
