-- ====================================================================
-- 025_products_price_edit
--
-- Per-product override for sales-rep price editing. The org-level
-- pricing_rules table (migration 021) already controls a master switch
-- and a global discount cap; this migration lets distributors loosen or
-- tighten that on a per-SKU basis.
--
-- Quy tắc nghiệp vụ (enforced ở UI khi tạo/sửa đơn):
--   - allow_price_edit = false  → giá đơn = sell_price, NV không sửa được.
--   - allow_price_edit = true   → NV được nhập giá khác, nhưng bị cap:
--       * Đơn bán: giá ≥ sell_price, lệch ≤ price_edit_max
--                  (nếu max_type='percent', so với sell_price)
--       * Đơn trả: giá ≤ sell_price, lệch ≤ price_edit_max (chiều âm)
-- ====================================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS allow_price_edit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_edit_max_type text
    NOT NULL DEFAULT 'percent'
    CHECK (price_edit_max_type IN ('percent', 'value')),
  ADD COLUMN IF NOT EXISTS price_edit_max numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN products.allow_price_edit IS
  'Cho phép nhân viên sửa giá khi tạo đơn cho SKU này.';
COMMENT ON COLUMN products.price_edit_max_type IS
  'Đơn vị của trần điều chỉnh: ''percent'' (%) hoặc ''value'' (VND).';
COMMENT ON COLUMN products.price_edit_max IS
  'Trần được phép sửa: % giá bán hoặc giá trị tuyệt đối tùy max_type.';
