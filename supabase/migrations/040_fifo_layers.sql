-- ====================================================================
-- T-02: FIFO costing infrastructure
--
-- Mỗi lần nhập kho tạo 1 fifo_layer (giá vốn snapshot). Xuất kho
-- consume layer cũ nhất trước (FIFO). fifo_consumptions ghi mapping
-- "stock_entry_line nào consume layer nào, bao nhiêu".
--
-- Spec table → actual:
--   stock_ledger_entries → stock_entry_lines (Q1).
--   warehouse 'sale_stock'|'date_stock' → warehouse_zone 'sale'|'date'
--   (batches.warehouse_zone từ mig 028).
-- ====================================================================

CREATE TABLE IF NOT EXISTS fifo_layers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_zone text NOT NULL CHECK (warehouse_zone IN ('sale', 'date')),
  /* nullable cho backfill (no source ledger). New layers reference
     the import stock_entry_line that created them. */
  source_line_id uuid REFERENCES stock_entry_lines(id),
  qty_in_base_uom_remaining numeric(18, 6) NOT NULL,
  unit_cost numeric(18, 6) NOT NULL,
  posting_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_fifo_consume
  ON fifo_layers (org_id, product_id, warehouse_zone, posting_at)
  WHERE closed_at IS NULL AND qty_in_base_uom_remaining > 0;

CREATE TABLE IF NOT EXISTS fifo_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  out_line_id uuid NOT NULL REFERENCES stock_entry_lines(id) ON DELETE CASCADE,
  layer_id uuid NOT NULL REFERENCES fifo_layers(id) ON DELETE CASCADE,
  qty_consumed numeric(18, 6) NOT NULL,
  unit_cost numeric(18, 6) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fifo_cons_out ON fifo_consumptions(out_line_id);
CREATE INDEX IF NOT EXISTS idx_fifo_cons_layer ON fifo_consumptions(layer_id);

ALTER TABLE fifo_layers ENABLE ROW LEVEL SECURITY;
ALTER TABLE fifo_consumptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_iso_fifo_layers ON fifo_layers
  USING (org_id = public.user_org_id());
CREATE POLICY org_iso_fifo_consumptions ON fifo_consumptions
  USING (org_id = public.user_org_id());

GRANT SELECT, INSERT, UPDATE ON fifo_layers TO authenticated;
GRANT SELECT, INSERT ON fifo_consumptions TO authenticated;

-- --------------------------------------------------------------------
-- Atomic consume helper (SECURITY DEFINER) — locks layers FOR UPDATE
-- and applies FIFO. Returns total cost + per-layer breakdown.
--
-- Usage from RPC:
--   select * from fifo_consume(
--     p_org_id => '...',
--     p_product_id => '...',
--     p_warehouse_zone => 'sale',
--     p_qty_needed => 40,
--     p_out_line_id => '...'
--   );
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fifo_consume(
  p_org_id uuid,
  p_product_id uuid,
  p_warehouse_zone text,
  p_qty_needed numeric,
  p_out_line_id uuid
) RETURNS TABLE (total_cost numeric, layers_used int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining numeric := p_qty_needed;
  v_total_cost numeric := 0;
  v_layers_used int := 0;
  v_take numeric;
  r record;
BEGIN
  IF p_qty_needed <= 0 THEN
    RETURN QUERY SELECT 0::numeric, 0::int;
    RETURN;
  END IF;

  FOR r IN
    SELECT id, qty_in_base_uom_remaining, unit_cost
    FROM fifo_layers
    WHERE org_id = p_org_id
      AND product_id = p_product_id
      AND warehouse_zone = p_warehouse_zone
      AND closed_at IS NULL
      AND qty_in_base_uom_remaining > 0
    ORDER BY posting_at ASC, created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(r.qty_in_base_uom_remaining, v_remaining);

    UPDATE fifo_layers
    SET qty_in_base_uom_remaining = qty_in_base_uom_remaining - v_take,
        closed_at = CASE
          WHEN qty_in_base_uom_remaining - v_take <= 0 THEN now()
          ELSE NULL
        END
    WHERE id = r.id;

    INSERT INTO fifo_consumptions (
      org_id, out_line_id, layer_id, qty_consumed, unit_cost
    ) VALUES (
      p_org_id, p_out_line_id, r.id, v_take, r.unit_cost
    );

    v_total_cost := v_total_cost + (v_take * r.unit_cost);
    v_remaining := v_remaining - v_take;
    v_layers_used := v_layers_used + 1;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'FIFO_INSUFFICIENT_STOCK: cần thêm % đơn vị cho SP %',
      v_remaining, p_product_id;
  END IF;

  RETURN QUERY SELECT v_total_cost, v_layers_used;
END;
$$;

REVOKE EXECUTE ON FUNCTION fifo_consume(uuid, uuid, text, numeric, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fifo_consume(uuid, uuid, text, numeric, uuid) TO authenticated;

-- --------------------------------------------------------------------
-- Backfill: create 1 layer per (product, zone) from existing batches
-- with qty_on_hand > 0. unit_cost = max(batches.unit_cost, products.cost_price, 0).
-- Per spec section 3.3 — log to docs/pack3-fifo-backfill-report.md if needed.
-- --------------------------------------------------------------------
INSERT INTO fifo_layers (
  org_id, product_id, warehouse_zone,
  qty_in_base_uom_remaining, unit_cost, posting_at
)
SELECT
  b.org_id,
  b.product_id,
  COALESCE(b.warehouse_zone, 'sale'),
  SUM(b.qty_on_hand)::numeric,
  COALESCE(
    AVG(NULLIF(b.unit_cost, 0)),
    MAX(p.cost_price),
    0
  )::numeric,
  MIN(b.created_at)
FROM batches b
JOIN products p ON p.id = b.product_id
WHERE b.qty_on_hand > 0
GROUP BY b.org_id, b.product_id, COALESCE(b.warehouse_zone, 'sale')
ON CONFLICT DO NOTHING;
