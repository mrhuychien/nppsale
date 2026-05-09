-- ====================================================================
-- Q6 (T-03): order_activity_log — audit trail for sales_order_lines
-- mutations during the editable window.
--
-- Each row captures one mutation (INSERT / UPDATE / DELETE) on a
-- sales_order_line. We keep this minimal — full diff stored as jsonb
-- so callers can render before/after pairs without joining other
-- tables. Triggers populate it; the JS layer only reads.
--
-- The DB-level enforce_picked_line_lock() trigger from mig 044
-- prevents bad mutations; this trigger logs the ones that did go
-- through.
-- ====================================================================

CREATE TABLE IF NOT EXISTS order_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  order_line_id uuid,
  action text NOT NULL CHECK (action IN ('add_line', 'edit_line', 'remove_line')),
  /* Stage at the moment the mutation happened — useful for triage. */
  workflow_stage text,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oal_order ON order_activity_log (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oal_actor ON order_activity_log (actor_id, created_at DESC);

ALTER TABLE order_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_iso_oal ON order_activity_log
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());

-- INSERTs are made by the trigger only (SECURITY DEFINER), so direct
-- writes are blocked.
CREATE POLICY oal_no_direct_writes ON order_activity_log
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

GRANT SELECT ON order_activity_log TO authenticated;

-- --------------------------------------------------------------------
-- Trigger function: log INSERT / UPDATE / DELETE on sales_order_lines.
-- For UPDATE, only writes a row when at least one tracked column
-- changed (quantity / unit_price / line_discount / line_total /
-- product_id / unit_name).
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_sales_order_line_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org    uuid;
  v_stage  text;
  v_diff   jsonb := '{}'::jsonb;
  v_action text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT org_id, current_workflow_stage
      INTO v_org, v_stage
    FROM sales_orders WHERE id = OLD.order_id;
    v_diff := jsonb_build_object(
      'product_id', OLD.product_id,
      'unit_name', OLD.unit_name,
      'quantity', OLD.quantity,
      'unit_price', OLD.unit_price,
      'line_total', OLD.line_total
    );
    INSERT INTO order_activity_log (
      org_id, order_id, order_line_id, action, workflow_stage,
      changes, actor_id
    ) VALUES (
      v_org, OLD.order_id, OLD.id, 'remove_line', v_stage,
      v_diff, auth.uid()
    );
    RETURN OLD;
  END IF;

  SELECT org_id, current_workflow_stage
    INTO v_org, v_stage
  FROM sales_orders WHERE id = NEW.order_id;

  IF TG_OP = 'INSERT' THEN
    v_diff := jsonb_build_object(
      'product_id', NEW.product_id,
      'unit_name', NEW.unit_name,
      'quantity', NEW.quantity,
      'unit_price', NEW.unit_price,
      'line_total', NEW.line_total
    );
    v_action := 'add_line';
  ELSIF TG_OP = 'UPDATE' THEN
    -- Only log when something actually changed.
    IF NEW.product_id IS NOT DISTINCT FROM OLD.product_id
       AND NEW.unit_name IS NOT DISTINCT FROM OLD.unit_name
       AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity
       AND NEW.unit_price IS NOT DISTINCT FROM OLD.unit_price
       AND NEW.line_discount IS NOT DISTINCT FROM OLD.line_discount
       AND NEW.line_total IS NOT DISTINCT FROM OLD.line_total THEN
      RETURN NEW;
    END IF;
    v_diff := jsonb_strip_nulls(jsonb_build_object(
      'product_id', CASE WHEN NEW.product_id IS DISTINCT FROM OLD.product_id
        THEN jsonb_build_object('from', OLD.product_id, 'to', NEW.product_id) END,
      'unit_name', CASE WHEN NEW.unit_name IS DISTINCT FROM OLD.unit_name
        THEN jsonb_build_object('from', OLD.unit_name, 'to', NEW.unit_name) END,
      'quantity', CASE WHEN NEW.quantity IS DISTINCT FROM OLD.quantity
        THEN jsonb_build_object('from', OLD.quantity, 'to', NEW.quantity) END,
      'unit_price', CASE WHEN NEW.unit_price IS DISTINCT FROM OLD.unit_price
        THEN jsonb_build_object('from', OLD.unit_price, 'to', NEW.unit_price) END,
      'line_total', CASE WHEN NEW.line_total IS DISTINCT FROM OLD.line_total
        THEN jsonb_build_object('from', OLD.line_total, 'to', NEW.line_total) END
    ));
    v_action := 'edit_line';
  END IF;

  INSERT INTO order_activity_log (
    org_id, order_id, order_line_id, action, workflow_stage,
    changes, actor_id
  ) VALUES (
    v_org, NEW.order_id, NEW.id, v_action, v_stage,
    v_diff, auth.uid()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_sales_order_line ON sales_order_lines;
CREATE TRIGGER trg_log_sales_order_line
  AFTER INSERT OR UPDATE OR DELETE ON sales_order_lines
  FOR EACH ROW EXECUTE FUNCTION log_sales_order_line_change();

COMMENT ON TABLE order_activity_log IS
  'Q6 (T-03): per-line audit trail. Auto-populated by trg_log_sales_order_line. RLS reads only.';
