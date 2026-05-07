-- ====================================================================
-- 032_customers_created_by
--
-- Update #2 v2 §2.3 — Cần biết NV nào tạo khách hàng mới để tính KPI
-- "khách hàng mới" trong tháng. Thêm cột tracking + backfill từ
-- customer_assignments (NV phụ trách hiện tại) cho dữ liệu cũ.
-- ====================================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_created_by
  ON customers(org_id, created_by, created_at)
  WHERE created_by IS NOT NULL;

COMMENT ON COLUMN customers.created_by IS
  'NV tạo khách hàng. Dùng cho KPI khách-hàng-mới (§2.3).';

-- Backfill: dùng NV phụ trách đầu tiên trong customer_assignments
WITH first_assignment AS (
  SELECT DISTINCT ON (customer_id) customer_id, user_id
  FROM customer_assignments
  ORDER BY customer_id, assigned_at NULLS LAST
)
UPDATE customers c
SET created_by = fa.user_id
FROM first_assignment fa
WHERE c.id = fa.customer_id
  AND c.created_by IS NULL;
