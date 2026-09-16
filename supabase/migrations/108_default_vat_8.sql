-- ====================================================================
-- 108 — Thuế VAT mặc định của sản phẩm: 10% → 8%
-- ====================================================================
--
-- `products.vat_rate` để mặc định 0.1 từ mig 001. Phần lớn hàng FMCG đang
-- chịu 8%, nên mặc định cũ khiến mỗi sản phẩm mới phải sửa tay một lần —
-- và sửa tay thì có lần quên.
--
-- ⚠ CHỈ ĐỔI MẶC ĐỊNH CHO DÒNG MỚI. Không đụng một dòng nào đang có.
--
-- Cám dỗ ở đây là chạy luôn `UPDATE products SET vat_rate = 0.08`. Không
-- làm, vì không phân biệt được hai trường hợp:
--   • sản phẩm nhập từ file KHÔNG có cột thuế → nhận 10% do mặc định cũ,
--     đúng là nên đổi;
--   • sản phẩm người ta CỐ Ý khai 10% (vẫn còn mặt hàng chịu 10%), đổi đi
--     là ghi đè số người ta nhập tay.
--
-- Hai trường hợp đó nhìn giống hệt nhau trong cơ sở dữ liệu. Muốn đổi
-- hàng loạt thì xem hai câu ở cuối file: câu thứ nhất ĐẾM xem đang có
-- bao nhiêu, câu thứ hai mới đổi — và chạy tay sau khi đã nhìn con số.
-- ====================================================================

ALTER TABLE products
  ALTER COLUMN vat_rate SET DEFAULT 0.08;

COMMENT ON COLUMN products.vat_rate IS
  'Thuế suất VAT, lưu dạng tỉ lệ (0.08 = 8%). Mặc định 0.08 từ mig 108. '
  'Giá trị đồng bộ với DEFAULT_VAT_RATE trong src/lib/constants.ts.';

-- --------------------------------------------------------------------
-- KHÔNG PHẢI PHẦN CỦA MIGRATION — hai câu để chạy tay nếu muốn
-- --------------------------------------------------------------------
--
-- 1) Xem đang có bao nhiêu sản phẩm ở mỗi mức thuế:
--
--      SELECT vat_rate, count(*) AS so_san_pham
--      FROM products
--      GROUP BY vat_rate
--      ORDER BY vat_rate;
--
-- 2) Nếu con số ở trên cho thấy TẤT CẢ đang là 0.1 do mặc định cũ (tức
--    là file nhập không có cột thuế), và ta muốn chuyển hết sang 8%:
--
--      UPDATE products SET vat_rate = 0.08 WHERE vat_rate = 0.1;
--
--    Chỉ chạy khi đã nhìn kết quả câu 1 và chắc rằng trong đó không có
--    mặt hàng nào cố ý để 10%.
