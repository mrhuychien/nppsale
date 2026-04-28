-- ====================================================================
-- 023_products_extras
--
-- Adds the extra fields needed for the KiotViet-style product editor:
-- description, warranty info, cost/sell price, serial tracking, stock
-- thresholds, shelf location, weight, "direct sale" toggle, and an
-- image gallery (URLs in jsonb so the column doesn't bloat).
-- ====================================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS warranty_info text,
  ADD COLUMN IF NOT EXISTS cost_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sell_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS track_serial boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_stock numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_stock numeric,
  ADD COLUMN IF NOT EXISTS shelf_location text,
  ADD COLUMN IF NOT EXISTS weight numeric,
  ADD COLUMN IF NOT EXISTS weight_unit text NOT NULL DEFAULT 'g',
  ADD COLUMN IF NOT EXISTS direct_sale boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN products.cost_price IS 'Giá vốn mặc định (đồng).';
COMMENT ON COLUMN products.sell_price IS 'Giá bán mặc định (đồng).';
COMMENT ON COLUMN products.min_stock IS 'Định mức tồn thấp nhất - cảnh báo khi xuống dưới.';
COMMENT ON COLUMN products.max_stock IS 'Định mức tồn cao nhất - cảnh báo khi vượt qua.';
COMMENT ON COLUMN products.weight IS 'Trọng lượng (theo weight_unit).';
COMMENT ON COLUMN products.direct_sale IS 'Cho phép bán trực tiếp tại cửa hàng / quầy.';
COMMENT ON COLUMN products.images IS 'Mảng URL ảnh sản phẩm.';
