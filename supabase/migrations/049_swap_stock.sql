-- ====================================================================
-- T-12: Phiếu xuất "hàng đem đi đổi" (swap stock)
--
-- The driver / sales rep takes spare stock along on a route to handle
-- in-the-field exchanges. We need to:
--   1. Reserve the qty out of sale_stock at picking time (FIFO consume)
--   2. Print it on the export slip alongside the order goods
--   3. When the driver returns, T-07 driver handover lists the unused
--      portion so it can flow back into stock with the user picking
--      Kho bán vs Kho date as destination.
--
-- Spec maps shipment_id → deliveries.id, but in this codebase picking
-- creates a stock_entry first; deliveries land later. We therefore key
-- on stock_entry_id (the "shipment" of goods leaving the warehouse).
-- ====================================================================

CREATE TABLE IF NOT EXISTS swap_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  /* The export stock_entry that recorded this swap reservation. */
  stock_entry_id uuid NOT NULL REFERENCES stock_entries(id) ON DELETE CASCADE,
  /* Optional: if the driver was attached to a delivery row. */
  delivery_id uuid REFERENCES deliveries(id),
  product_id uuid NOT NULL REFERENCES products(id),
  qty numeric(18, 6) NOT NULL CHECK (qty > 0),
  unit_name text NOT NULL,
  conversion_factor numeric(18, 6) NOT NULL DEFAULT 1,
  qty_in_base_uom numeric(18, 6) NOT NULL CHECK (qty_in_base_uom > 0),
  reason text,
  /* The stock_entry_line that physically removed the qty (so T-07 can
     trace the FIFO cost when restocking unused items). */
  out_line_id uuid REFERENCES stock_entry_lines(id),
  /* Snapshot of fifo_consumptions for this reservation — array of
     {layer_id, qty, unit_cost}. Lets the handover RPC re-create
     equivalent layers when unused stock comes back. */
  fifo_consumptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  /* Tracks how much has already been put back. Decrements when T-07
     handover row of source_type='unused_swap_stock' confirms. */
  qty_returned_in_base_uom numeric(18, 6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_swap_entry ON swap_stock_movements (stock_entry_id);
CREATE INDEX IF NOT EXISTS idx_swap_delivery ON swap_stock_movements (delivery_id);
CREATE INDEX IF NOT EXISTS idx_swap_open
  ON swap_stock_movements (org_id, stock_entry_id)
  WHERE qty_returned_in_base_uom < qty_in_base_uom;

ALTER TABLE swap_stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_iso_swap ON swap_stock_movements
  USING (org_id = public.user_org_id())
  WITH CHECK (org_id = public.user_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON swap_stock_movements TO authenticated;

COMMENT ON TABLE swap_stock_movements IS
  'T-12: spare stock the driver took on a route just-in-case for customer exchanges. Created at picking time, consumed FIFO from sale_stock. T-07 driver handover lists the unused portion (qty_in_base_uom - qty_returned_in_base_uom > 0) for restock.';
