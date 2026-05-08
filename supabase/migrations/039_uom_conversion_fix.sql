-- ====================================================================
-- T-01: UOM conversion fix
--
-- Bug: 1 thùng = 10 hộp. Đơn xuất 4 thùng → batches.qty_on_hand chỉ
-- giảm 4 thay vì 40, vì các call site `update qty_on_hand = qty_on_hand
-- - take` truyền raw `sales_order_lines.quantity` (đã trong UOM giao
-- dịch — thùng) thay vì trong base UOM (hộp).
--
-- Fix:
--   • sales_order_lines.conversion_factor: snapshot tại lúc tạo đơn.
--   • stock_entry_lines: thêm base/transaction split columns.
--   • Backfill từ product_units; rows cũ → factor=1 (không gây regression).
--   • Audit view v_uom_audit cho rows nghi ngờ.
--
-- Spec mapping (xem docs/pack3-questions.md Q1):
--   spec stock_ledger_entries → actual stock_entry_lines.
-- ====================================================================

-- ---------------------------------------------------------------------
-- 1. sales_order_lines: snapshot conversion factor
-- ---------------------------------------------------------------------
ALTER TABLE sales_order_lines
  ADD COLUMN IF NOT EXISTS conversion_factor numeric(18, 6) NOT NULL DEFAULT 1;

COMMENT ON COLUMN sales_order_lines.conversion_factor IS
  'Snapshot product_units.conversion lúc tạo line. quantity là theo unit_name; quantity_in_base = quantity * conversion_factor.';

-- Backfill: lookup product_units by (product_id, unit_name).
-- Nếu unit_name = product.base_unit hoặc không tìm thấy → 1.
UPDATE sales_order_lines sol
SET conversion_factor = COALESCE(
  (SELECT pu.conversion FROM product_units pu
    WHERE pu.product_id = sol.product_id
      AND pu.unit_name = sol.unit_name
    LIMIT 1),
  1
)
WHERE conversion_factor = 1;

-- ---------------------------------------------------------------------
-- 2. stock_entry_lines: split base / transaction UOM
-- ---------------------------------------------------------------------
ALTER TABLE stock_entry_lines
  ADD COLUMN IF NOT EXISTS qty_in_base_uom        numeric(18, 6),
  ADD COLUMN IF NOT EXISTS qty_in_transaction_uom numeric(18, 6),
  ADD COLUMN IF NOT EXISTS transaction_uom        text,
  ADD COLUMN IF NOT EXISTS conversion_factor_snapshot numeric(18, 6);

COMMENT ON COLUMN stock_entry_lines.qty_in_base_uom IS
  'Số lượng trong base UOM (vd: hộp). Cộng/trừ trực tiếp với batches.qty_on_hand.';
COMMENT ON COLUMN stock_entry_lines.transaction_uom IS
  'UOM giao dịch (vd: thùng). Hiển thị trên phiếu in.';

-- Backfill: rows cũ → snapshot quantity ở cả 2 cột; transaction_uom = unit_name; factor = lookup product_units (default 1).
UPDATE stock_entry_lines sel
SET conversion_factor_snapshot = COALESCE(
  (SELECT pu.conversion FROM product_units pu
    WHERE pu.product_id = sel.product_id
      AND pu.unit_name = sel.unit_name
    LIMIT 1),
  1
)
WHERE conversion_factor_snapshot IS NULL;

UPDATE stock_entry_lines
SET qty_in_transaction_uom = quantity,
    qty_in_base_uom        = quantity * conversion_factor_snapshot,
    transaction_uom        = unit_name
WHERE qty_in_base_uom IS NULL;

ALTER TABLE stock_entry_lines
  ALTER COLUMN qty_in_base_uom SET NOT NULL;

-- ---------------------------------------------------------------------
-- 3. Audit view: rows that look stale (qty != qty_in_base_uom and no
--    transaction_uom set). Caller checks count per spec section 3.3.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_uom_audit AS
SELECT
  sel.id,
  se.org_id,
  sel.entry_id,
  sel.product_id,
  sel.quantity,
  sel.qty_in_base_uom,
  sel.qty_in_transaction_uom,
  sel.transaction_uom,
  sel.conversion_factor_snapshot
FROM stock_entry_lines sel
JOIN stock_entries se ON se.id = sel.entry_id
WHERE sel.quantity != sel.qty_in_base_uom
  AND sel.transaction_uom IS NULL;

-- ---------------------------------------------------------------------
-- 4. Performance: speed up balance + history queries by warehouse zone
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sel_product_entry_org
  ON stock_entry_lines (product_id, entry_id);
