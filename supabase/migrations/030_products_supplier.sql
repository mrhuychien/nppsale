-- ====================================================================
-- 030_products_supplier
--
-- Update #2 v2 §3.2 — Bộ lọc theo NCC trong báo cáo. Để báo cáo lọc
-- được theo NCC (đặc biệt là kho hàng và doanh số sản phẩm), gắn 1
-- NCC chính cho mỗi sản phẩm. Quy tắc: NCC chính là NCC nhập SP về
-- kho lần gần nhất; admin có thể chỉnh tay.
-- ====================================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS primary_supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_supplier
  ON products(org_id, primary_supplier_id)
  WHERE primary_supplier_id IS NOT NULL;

COMMENT ON COLUMN products.primary_supplier_id IS
  'NCC chính của SP (default = NCC nhập gần nhất). Dùng cho báo cáo NCC.';

-- Backfill: set primary_supplier_id from the most recent stock_entry
-- of type=import that brought the product in.
WITH latest_supplier AS (
  SELECT DISTINCT ON (l.product_id)
    l.product_id,
    e.supplier_id,
    e.org_id
  FROM stock_entry_lines l
  JOIN stock_entries e ON e.id = l.entry_id
  WHERE e.type = 'import'
    AND e.supplier_id IS NOT NULL
  ORDER BY l.product_id, e.posted_at DESC NULLS LAST, e.created_at DESC
)
UPDATE products p
SET primary_supplier_id = ls.supplier_id
FROM latest_supplier ls
WHERE ls.product_id = p.id
  AND ls.org_id = p.org_id
  AND p.primary_supplier_id IS NULL;
