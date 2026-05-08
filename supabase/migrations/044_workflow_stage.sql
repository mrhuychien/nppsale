-- ====================================================================
-- T-03: Workflow stage + edit-while-picking helper view
--
-- Spec D10: edit-while-picking is allowed with rules. Picked SP cannot
-- be reduced/removed, UOM cannot be changed. Rules are enforced by a
-- pure JS validator (lib/orders/edit-validator.ts) which needs to know
-- per-line picked qty.
--
-- This migration:
--   1. Adds sales_orders.current_workflow_stage with the richer enum
--      from the spec (draft/pending_approval/approved/picking/...
--      collecting/handover/closed/failed/delivery_failed). Existing
--      `status` column stays — workflow_stage is kept in sync via a
--      BEFORE-UPDATE trigger.
--   2. Creates v_sales_order_line_picked: per-order-line picked qty
--      (in base UOM) summed from stock_entry_lines of non-cancelled
--      export entries that reference the order. Used by the validator
--      to lock reductions on picked lines.
--
-- Spec mapping (Q1):
--   spec orders.current_workflow_stage   → sales_orders.current_workflow_stage
--   spec picking_session_items.picked_qty → derived from stock_entry_lines
--                                           via ref_order_ids match
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. current_workflow_stage column
-- --------------------------------------------------------------------
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS current_workflow_stage text;

-- Backfill from existing status. cancelled → failed because the spec's
-- 'cancelled' equivalent in the new enum is 'failed'.
UPDATE sales_orders
SET current_workflow_stage = CASE status
  WHEN 'draft'      THEN 'draft'
  WHEN 'confirmed'  THEN 'approved'
  WHEN 'picking'    THEN 'picking'
  WHEN 'delivering' THEN 'delivering'
  WHEN 'delivered'  THEN 'closed'
  WHEN 'cancelled'  THEN 'failed'
  ELSE 'draft'
END
WHERE current_workflow_stage IS NULL;

ALTER TABLE sales_orders
  ALTER COLUMN current_workflow_stage SET DEFAULT 'draft',
  ALTER COLUMN current_workflow_stage SET NOT NULL;

-- Drop+re-add CHECK so we can iterate without manual cleanup if it
-- already existed (idempotent migration).
ALTER TABLE sales_orders
  DROP CONSTRAINT IF EXISTS chk_sales_orders_workflow_stage;
ALTER TABLE sales_orders
  ADD CONSTRAINT chk_sales_orders_workflow_stage CHECK (
    current_workflow_stage IN (
      'draft',
      'pending_approval',
      'approved',
      'picking',
      'delivering',
      'collecting',
      'handover',
      'closed',
      'failed',
      'delivery_failed'
    )
  );

COMMENT ON COLUMN sales_orders.current_workflow_stage IS
  'T-03: Granular workflow stage (Pack3 spec D10). Auto-synced from `status` via trigger; richer states (collecting/handover/delivery_failed) populated by Pack3 features T-07/T-08.';

-- --------------------------------------------------------------------
-- 2. Trigger: keep current_workflow_stage in sync when status changes
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_sales_order_workflow_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only sync when status changed AND caller didn't explicitly set
  -- workflow_stage to a richer value in the same UPDATE.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.current_workflow_stage IS NOT DISTINCT FROM OLD.current_workflow_stage THEN
    NEW.current_workflow_stage := CASE NEW.status
      WHEN 'draft'      THEN 'draft'
      WHEN 'confirmed'  THEN 'approved'
      WHEN 'picking'    THEN 'picking'
      WHEN 'delivering' THEN 'delivering'
      WHEN 'delivered'  THEN 'closed'
      WHEN 'cancelled'  THEN 'failed'
      ELSE NEW.current_workflow_stage
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_workflow_stage ON sales_orders;
CREATE TRIGGER trg_sync_workflow_stage
  BEFORE UPDATE OF status ON sales_orders
  FOR EACH ROW
  EXECUTE FUNCTION sync_sales_order_workflow_stage();

-- --------------------------------------------------------------------
-- 3. v_sales_order_line_picked: picked qty per (order_line) in base UOM
--
-- Logic: a stock_entry_line "belongs" to order O if its parent
-- stock_entry has ref_order_ids @> [O::text]. We can't tell which
-- order in a merged pick consumed how much, so we treat the SKU+unit
-- match as evidence-of-picking. Conservative: over-locks (a merged
-- pick locks the line on every order in the merge) but never under-
-- locks. Acceptable per D10 (rule is "anything picked → can't reduce").
--
-- qty_in_base_uom is set by T-01 mig 039 — backfilled for legacy rows.
-- Cancelled entries are excluded.
-- --------------------------------------------------------------------
CREATE OR REPLACE VIEW v_sales_order_line_picked AS
SELECT
  sol.id          AS order_line_id,
  sol.order_id,
  sol.product_id,
  sol.unit_name,
  sol.quantity    AS ordered_qty,
  COALESCE((
    SELECT SUM(sel.qty_in_base_uom)::numeric
    FROM stock_entry_lines sel
    JOIN stock_entries se ON se.id = sel.entry_id
    WHERE se.type = 'export'
      AND COALESCE(se.status, 'posted') <> 'cancelled'
      AND se.ref_order_ids @> jsonb_build_array(sol.order_id::text)
      AND sel.product_id = sol.product_id
      AND sel.unit_name  = sol.unit_name
  ), 0)::numeric AS picked_qty_in_base_uom
FROM sales_order_lines sol;

COMMENT ON VIEW v_sales_order_line_picked IS
  'T-03: per sales_order_line, qty already picked (base UOM). Derived from non-cancelled export stock_entry_lines whose parent entry references the order_id. Drives the edit-while-picking validator.';

GRANT SELECT ON v_sales_order_line_picked TO authenticated;

-- --------------------------------------------------------------------
-- 4. Server-side guard: enforce D10 rules on sales_order_lines so
-- direct API calls (and future migrations) can't bypass the JS
-- validator. Mirrors the validator's logic.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_picked_line_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_stage   text;
  v_picked  numeric;
  v_factor  numeric;
  v_qtybase numeric;
  v_order   uuid;
  v_pid     uuid;
  v_unit    text;
BEGIN
  -- Resolve order_id + line shape depending on operation.
  IF TG_OP = 'DELETE' THEN
    v_order := OLD.order_id;
    v_pid   := OLD.product_id;
    v_unit  := OLD.unit_name;
  ELSE
    v_order := NEW.order_id;
    v_pid   := NEW.product_id;
    v_unit  := NEW.unit_name;
  END IF;

  SELECT current_workflow_stage INTO v_stage
  FROM sales_orders WHERE id = v_order;

  -- After picking → all line-level mutations blocked.
  IF v_stage IN ('delivering','collecting','handover','closed','failed','delivery_failed') THEN
    RAISE EXCEPTION 'ORDER_LOCKED: đơn đã chuyển sang giao hàng — không thể sửa dòng đơn.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Before picking → unrestricted.
  IF v_stage IS DISTINCT FROM 'picking' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Stage = 'picking'. INSERT (add new SP) is allowed.
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- For UPDATE / DELETE, look up picked qty for the OLD (product, unit) tuple.
  SELECT COALESCE(SUM(sel.qty_in_base_uom), 0) INTO v_picked
  FROM stock_entry_lines sel
  JOIN stock_entries se ON se.id = sel.entry_id
  WHERE se.type = 'export'
    AND COALESCE(se.status, 'posted') <> 'cancelled'
    AND se.ref_order_ids @> jsonb_build_array(v_order::text)
    AND sel.product_id = OLD.product_id
    AND sel.unit_name  = OLD.unit_name;

  IF v_picked <= 0 THEN
    -- Unpicked line — anything goes.
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Picked > 0.
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PICKED_LINE_LOCKED: không thể xoá dòng đã pick (đã xuất % base UOM).', v_picked
      USING ERRCODE = 'P0001';
  END IF;

  -- UPDATE: enforce product/unit/qty rules.
  IF NEW.product_id IS DISTINCT FROM OLD.product_id THEN
    RAISE EXCEPTION 'PICKED_LINE_LOCKED: không thể đổi sản phẩm trên dòng đã pick.'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.unit_name IS DISTINCT FROM OLD.unit_name THEN
    RAISE EXCEPTION 'PICKED_LINE_LOCKED: không thể đổi đơn vị tính trên dòng đã pick.'
      USING ERRCODE = 'P0001';
  END IF;

  v_factor  := COALESCE(NEW.conversion_factor, 1);
  v_qtybase := COALESCE(NEW.quantity, 0) * v_factor;
  IF v_qtybase + 1e-9 < v_picked THEN
    RAISE EXCEPTION 'PICKED_LINE_LOCKED: đã pick %, không thể giảm SL xuống dưới mức đã pick.', v_picked
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_picked_line_lock ON sales_order_lines;
CREATE TRIGGER trg_enforce_picked_line_lock
  BEFORE INSERT OR UPDATE OR DELETE ON sales_order_lines
  FOR EACH ROW
  EXECUTE FUNCTION enforce_picked_line_lock();

COMMENT ON FUNCTION enforce_picked_line_lock() IS
  'T-03: server-side mirror of lib/orders/edit-validator.ts. Blocks reductions/removals on picked lines and any line edit past stage=picking. RAISE codes are P0001 — caller surfaces the message verbatim.';
