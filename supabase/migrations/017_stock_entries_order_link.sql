-- =====================================================================
-- Migration 017: Link stock entries to source orders
-- =====================================================================
-- When a stock-out entry fulfils one or more sales orders (e.g. the
-- "merge and pick" flow), record the order ids so the order detail page
-- can display a stock history tab. Legacy entries stay empty.

ALTER TABLE stock_entries
  ADD COLUMN IF NOT EXISTS ref_order_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

-- GIN index so "contains this order id" queries stay fast
CREATE INDEX IF NOT EXISTS idx_stock_entries_ref_orders
  ON stock_entries USING gin (ref_order_ids);

COMMENT ON COLUMN stock_entries.ref_order_ids IS
  'Array of sales_orders.id the entry was created for (stock-out / picking). Empty for imports.';
