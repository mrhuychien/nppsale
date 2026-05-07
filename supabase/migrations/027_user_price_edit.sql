-- ====================================================================
-- 027_user_price_edit
--
-- Update #2 v2 — Section 4.6. Quyền sửa giá là per-user (lưu trên
-- bảng users) thay vì per-product (migration 025) hoặc per-org
-- (pricing_rules — migration 021).
--
-- 3 ràng buộc khi NV sửa giá:
--   1) Đơn bán: giá ≥ giá list (không bán dưới list).
--   2) Đơn bán: giá ≤ giá list × (1 + max_increase_pct/100).
--   3) Đơn trả: giá ≤ giá đã bán trong đơn gốc tham chiếu (fallback
--      về giá list nếu không có đơn gốc).
-- ====================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS allow_price_edit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_edit_max_increase_pct numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN users.allow_price_edit IS
  'Cho phép user này sửa giá khi tạo / sửa đơn (sales hoặc warehouse khi sửa đơn ở bước xuất).';
COMMENT ON COLUMN users.price_edit_max_increase_pct IS
  'Ngưỡng % tăng giá tối đa so với giá list. VD 10 = giá tối đa = list × 1.10. Chỉ có hiệu lực khi allow_price_edit=true.';

-- Owner và accountant mặc định có quyền free (đặt allow_price_edit=true,
-- không giới hạn % trên — UI bỏ qua check). Sales và warehouse mặc định
-- false; Chủ NPP có thể bật lại trong form Tạo/Sửa NV.
UPDATE users SET allow_price_edit = true
WHERE role IN ('owner', 'accountant');
