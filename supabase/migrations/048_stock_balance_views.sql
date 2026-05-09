-- ====================================================================
-- T-09: Tab "Tồn kho hiện tại" — split by warehouse_zone + FIFO valuation
--
-- Powers components/inventory/stock-balance-table.tsx and the
-- per-product history drawer. The view rolls up:
--   - qty_on_hand per (product, zone) from batches (base UOM)
--   - inventory value per (product, zone) from active fifo_layers
--     (qty_remaining × unit_cost). Falls back to batches.unit_cost ×
--     qty_on_hand when no FIFO layer is yet present (T-02 backfill).
--
-- Spec requires: Mã SP / Tên SP / Kho bán SL+Giá trị / Kho date SL+Giá
-- trị / Tổng SL+Giá trị. The view returns one row per (product, zone);
-- the FE pivots to wide format.
-- ====================================================================

CREATE OR REPLACE VIEW v_stock_balance_by_zone AS
SELECT
  b.org_id,
  b.product_id,
  COALESCE(b.warehouse_zone, 'sale') AS warehouse_zone,
  SUM(b.qty_on_hand)::numeric AS qty_in_base_uom,
  -- Prefer FIFO valuation; fallback to batch weighted-avg.
  COALESCE(
    (
      SELECT SUM(fl.qty_in_base_uom_remaining * fl.unit_cost)::numeric
      FROM fifo_layers fl
      WHERE fl.org_id = b.org_id
        AND fl.product_id = b.product_id
        AND fl.warehouse_zone = COALESCE(b.warehouse_zone, 'sale')
        AND fl.closed_at IS NULL
    ),
    SUM(b.qty_on_hand * COALESCE(b.unit_cost, 0))::numeric
  ) AS value
FROM batches b
WHERE b.qty_on_hand > 0
GROUP BY b.org_id, b.product_id, COALESCE(b.warehouse_zone, 'sale');

COMMENT ON VIEW v_stock_balance_by_zone IS
  'T-09: per (product, warehouse_zone) qty + FIFO-valued cost. One row per zone (sale/date) per product with positive on-hand.';

GRANT SELECT ON v_stock_balance_by_zone TO authenticated;

-- --------------------------------------------------------------------
-- Movement history view — drives the drill-down drawer. Each row is a
-- single stock_entry_line decorated with parent entry meta + a running
-- balance. Postgres window functions keep the running calc sane.
-- --------------------------------------------------------------------
CREATE OR REPLACE VIEW v_stock_movements AS
SELECT
  sel.id,
  se.org_id,
  sel.product_id,
  COALESCE(b.warehouse_zone, 'sale') AS warehouse_zone,
  se.posted_at,
  se.created_at,
  se.type AS entry_type,
  se.status AS entry_status,
  se.entry_code,
  se.id AS entry_id,
  sel.unit_name AS transaction_uom,
  sel.qty_in_transaction_uom,
  sel.qty_in_base_uom,
  sel.conversion_factor_snapshot AS conversion_factor,
  sel.unit_cost,
  -- Sign: imports +, exports −, transfer/stocktake keep raw sign.
  CASE se.type
    WHEN 'import' THEN sel.qty_in_base_uom
    WHEN 'export' THEN -sel.qty_in_base_uom
    ELSE sel.qty_in_base_uom
  END AS signed_qty_in_base_uom,
  se.ref_order_ids
FROM stock_entry_lines sel
JOIN stock_entries     se ON se.id = sel.entry_id
LEFT JOIN batches      b  ON b.id  = sel.batch_id
WHERE se.status <> 'cancelled';

COMMENT ON VIEW v_stock_movements IS
  'T-09: every stock_entry_line decorated with entry header and signed base-UOM qty (import +, export −). Drives the drill-down history drawer.';

GRANT SELECT ON v_stock_movements TO authenticated;
