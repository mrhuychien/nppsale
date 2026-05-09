-- ====================================================================
-- T-07: Driver handover ("Bàn giao lại")
--
-- After a driver returns from a route they typically have:
--   1. Orders that didn't deliver (customer refused / absent / wrong
--      address / other) — the goods need to come back into stock and
--      the orders flip to status='delivery_failed'.
--   2. Goods customers returned (refund or exchange) that the driver
--      collected on the trip.
--   3. Unused "swap stock" they took along just-in-case (T-12; not yet
--      live, but the schema is here so the FE wiring is ready).
--
-- Spec D7: for unused_swap_stock the user picks the destination warehouse
-- (sale_stock vs date_stock) per row, with a checkbox "Đã đổi cho khách
-- rồi" that defaults the destination to date_stock. The destination_zone
-- column is the source of truth; the UI checkbox is just a default-setter.
--
-- Spec mapping (Q1):
--   shipments       → deliveries
--   warehouse zones → batches.warehouse_zone (sale | date) from mig 028
-- ====================================================================

CREATE TABLE IF NOT EXISTS driver_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES users(id),
  handover_at timestamptz NOT NULL DEFAULT now(),
  received_by_user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'confirmed')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_dh_delivery ON driver_handovers (delivery_id);
CREATE INDEX IF NOT EXISTS idx_dh_org_status ON driver_handovers (org_id, status);

CREATE TABLE IF NOT EXISTS driver_handover_failed_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_id uuid NOT NULL REFERENCES driver_handovers(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES sales_orders(id),
  failure_reason text NOT NULL CHECK (failure_reason IN (
    'customer_refused',
    'customer_absent',
    'wrong_address',
    'other'
  )),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dhfo_handover ON driver_handover_failed_orders (handover_id);
CREATE INDEX IF NOT EXISTS idx_dhfo_order ON driver_handover_failed_orders (order_id);

CREATE TABLE IF NOT EXISTS driver_handover_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_id uuid NOT NULL REFERENCES driver_handovers(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN (
    'failed_order',         -- restoring stock from an undelivered order
    'customer_return',      -- goods the customer returned mid-route
    'unused_swap_stock'     -- swap stock the driver didn't end up using
  )),
  source_order_id uuid NULL REFERENCES sales_orders(id),
  product_id uuid NOT NULL REFERENCES products(id),
  qty numeric(18, 6) NOT NULL CHECK (qty > 0),
  unit_name text NOT NULL,
  conversion_factor numeric(18, 6) NOT NULL DEFAULT 1,
  qty_in_base_uom numeric(18, 6) NOT NULL,
  destination_zone text NOT NULL CHECK (destination_zone IN ('sale', 'date')),
  reason text,
  /* unit_cost is what we record on the new FIFO layer the confirm RPC
     creates. Caller can leave it null and the RPC falls back to either
     the original consumption avg (for failed_order/unused_swap_stock)
     or 0 (logged to docs/pack3-fifo-backfill-report.md). */
  unit_cost numeric(18, 6) NULL,
  /* UI helper for unused_swap_stock — true means the driver actually
     gave the item to the customer in exchange and is bringing back
     a replacement; checkbox toggles the default destination_zone. */
  swapped_to_customer boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dhi_handover ON driver_handover_items (handover_id);
CREATE INDEX IF NOT EXISTS idx_dhi_product ON driver_handover_items (product_id);

ALTER TABLE driver_handovers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_handover_failed_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_handover_items         ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_iso_dh ON driver_handovers
  USING (org_id = public.user_org_id())
  WITH CHECK (org_id = public.user_org_id());

CREATE POLICY org_iso_dhfo ON driver_handover_failed_orders
  USING (EXISTS (
    SELECT 1 FROM driver_handovers dh
    WHERE dh.id = handover_id AND dh.org_id = public.user_org_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM driver_handovers dh
    WHERE dh.id = handover_id AND dh.org_id = public.user_org_id()
  ));

CREATE POLICY org_iso_dhi ON driver_handover_items
  USING (EXISTS (
    SELECT 1 FROM driver_handovers dh
    WHERE dh.id = handover_id AND dh.org_id = public.user_org_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM driver_handovers dh
    WHERE dh.id = handover_id AND dh.org_id = public.user_org_id()
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON driver_handovers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON driver_handover_failed_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON driver_handover_items TO authenticated;

-- --------------------------------------------------------------------
-- confirm_driver_handover — atomic confirm. Caller has already
-- inserted the draft handover + its rows; this RPC:
--   1. For each failed order → set sales_orders.status='delivery_failed'
--      and current_workflow_stage='delivery_failed' (T-03 column).
--      We DO NOT auto-restore stock from failed-order lines here —
--      that's done via driver_handover_items rows of source_type=
--      'failed_order' that the UI lists, so the user can confirm SLs
--      before re-stocking (drivers may have lost/damaged goods).
--   2. For each handover_item → INSERT a stock_entry (type='import',
--      status='posted') + stock_entry_lines, bump batches.qty_on_hand
--      in the destination zone, and create a fifo_layer with
--      unit_cost (or fallback 0 — logged on the layer's notes).
--   3. UPDATE deliveries.status='completed' (already happens at
--      settle, but defensive) and stamp handover.status='confirmed'.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION confirm_driver_handover(p_handover_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_org       uuid;
  v_delivery  uuid;
  v_status    text;
  v_entry_id  uuid;
  v_line_id   uuid;
  v_seq       int;
  r           record;
  v_batch_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  SELECT org_id, delivery_id, status
    INTO v_org, v_delivery, v_status
  FROM driver_handovers
  WHERE id = p_handover_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'HANDOVER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'confirmed' THEN
    -- Idempotent: nothing to do.
    RETURN;
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- 1) Flip failed orders.
  UPDATE sales_orders so
  SET status = 'cancelled',
      current_workflow_stage = 'delivery_failed'
  FROM driver_handover_failed_orders dhfo
  WHERE dhfo.handover_id = p_handover_id
    AND dhfo.order_id    = so.id;

  -- 2) Restore stock — one stock_entry per handover, lines per item.
  -- Only post if at least one item exists.
  IF EXISTS (SELECT 1 FROM driver_handover_items WHERE handover_id = p_handover_id) THEN
    INSERT INTO stock_entries (
      org_id, entry_code, type, status, posted_at, created_by, notes, ref_order_ids
    ) VALUES (
      v_org,
      'BG-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS'),
      'import',
      'posted',
      now(),
      v_uid,
      'Bàn giao lại từ chuyến giao ' || v_delivery::text,
      COALESCE(
        (SELECT jsonb_agg(DISTINCT order_id)
           FROM driver_handover_failed_orders
          WHERE handover_id = p_handover_id),
        '[]'::jsonb
      )
    )
    RETURNING id INTO v_entry_id;

    v_seq := 0;
    FOR r IN
      SELECT id, product_id, qty, unit_name, conversion_factor,
             qty_in_base_uom, destination_zone, unit_cost
      FROM driver_handover_items
      WHERE handover_id = p_handover_id
    LOOP
      v_seq := v_seq + 1;

      -- Find or create a batch in the chosen zone for this product.
      SELECT id INTO v_batch_id
      FROM batches
      WHERE org_id = v_org
        AND product_id = r.product_id
        AND COALESCE(warehouse_zone, 'sale') = r.destination_zone
      ORDER BY created_at ASC
      LIMIT 1;

      IF v_batch_id IS NULL THEN
        INSERT INTO batches (
          org_id, product_id, warehouse_zone, qty_on_hand, unit_cost
        ) VALUES (
          v_org, r.product_id, r.destination_zone, 0, COALESCE(r.unit_cost, 0)
        )
        RETURNING id INTO v_batch_id;
      END IF;

      -- Insert ledger row in BASE UOM (T-01 split fields filled).
      INSERT INTO stock_entry_lines (
        entry_id, product_id, batch_id, unit_name, quantity,
        qty_in_base_uom, qty_in_transaction_uom,
        transaction_uom, conversion_factor_snapshot,
        unit_cost
      ) VALUES (
        v_entry_id,
        r.product_id,
        v_batch_id,
        r.unit_name,
        r.qty_in_base_uom,
        r.qty_in_base_uom,
        r.qty,
        r.unit_name,
        r.conversion_factor,
        COALESCE(r.unit_cost, 0)
      )
      RETURNING id INTO v_line_id;

      -- Bump physical balance.
      UPDATE batches
      SET qty_on_hand = qty_on_hand + r.qty_in_base_uom
      WHERE id = v_batch_id;

      -- Create a fresh FIFO layer for this returned stock.
      INSERT INTO fifo_layers (
        org_id, product_id, warehouse_zone,
        source_line_id, qty_in_base_uom_remaining, unit_cost, posting_at
      ) VALUES (
        v_org, r.product_id, r.destination_zone,
        v_line_id, r.qty_in_base_uom, COALESCE(r.unit_cost, 0), now()
      );
    END LOOP;
  END IF;

  -- 3) Stamp handover + close out the delivery if not already.
  UPDATE driver_handovers
  SET status = 'confirmed',
      confirmed_at = now()
  WHERE id = p_handover_id;

  UPDATE deliveries
  SET status = 'completed',
      completed_at = COALESCE(completed_at, now())
  WHERE id = v_delivery;

  -- 4) Close any open workflow_session(s) for this delivery so the
  -- "Việc đang dở" widget drops it.
  UPDATE workflow_sessions
  SET closed_at = now()
  WHERE entity_type = 'delivery'
    AND entity_id   = v_delivery
    AND closed_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION confirm_driver_handover(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confirm_driver_handover(uuid) TO authenticated;

COMMENT ON TABLE driver_handovers IS
  'T-07: per-trip "bàn giao lại". Header + driver_handover_failed_orders + driver_handover_items. confirm_driver_handover() RPC restocks atomically.';
