-- ====================================================================
-- 110 — Thuế VAT mặc định của sản phẩm: 8% → 0%
-- ====================================================================
--
-- Mig 108 đổi mặc định từ 10% sang 8%. Chủ NPP chốt lại: hàng ở đây xuất
-- KHÔNG kèm VAT, nên 0 mới là con số đúng — để 8% là bắt người ta sửa tay
-- mỗi lần tạo sản phẩm, mà sửa tay thì có lần quên.
--
-- ⚠ 0 Ở ĐÂY LÀ MỘT LỰA CHỌN, KHÔNG PHẢI CHỖ CHƯA ĐIỀN.
--
-- Mã nguồn từng có một phép kiểm mang tên "VAT trống thì mặc định 8%,
-- không phải 0", lý do ghi kèm là "mặc định 0 sẽ làm mọi hoá đơn thiếu
-- thuế". Phép kiểm ấy đã được đổi có chủ ý, không phải bị bỏ quên. Ghi
-- lại ở đây để người sau đọc migration đừng "sửa" nó về 8%.
--
-- Mặt hàng nào có chịu thuế thì khai trên chính sản phẩm đó — mặc định
-- chỉ là điểm xuất phát cho dòng mới.
--
-- ⚠ CHỈ ĐỔI MẶC ĐỊNH CHO DÒNG MỚI. Không đụng sản phẩm đang có. Mig 109
-- vừa đặt toàn bộ danh mục về 8%; muốn kéo cả danh mục về 0% thì đó là
-- một bước RIÊNG, có in ra số dòng bị động tới — xem mig 109 để biết
-- khuôn mẫu, đừng gộp vào đây.
--
-- KHÔNG đụng `purchase_orders` (mặc định 0.1). Đó là thuế ĐẦU VÀO do nhà
-- cung cấp thu, không phải thuế mình xuất ra — hai con số khác nhau và
-- không có lý do để đi cùng nhau.
-- ====================================================================

ALTER TABLE products
  ALTER COLUMN vat_rate SET DEFAULT 0;

COMMENT ON COLUMN products.vat_rate IS
  'Thuế suất VAT, lưu dạng tỉ lệ (0 = 0%, 0.08 = 8%). Mặc định 0 từ mig '
  '110 — hàng xuất không kèm VAT; mặt hàng nào chịu thuế thì khai riêng '
  'trên sản phẩm đó. Đồng bộ với DEFAULT_VAT_RATE trong '
  'src/lib/constants.ts.';
