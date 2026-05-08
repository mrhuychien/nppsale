-- ====================================================================
-- T-05: Workflow state persistence ("Việc đang dở")
--
-- Spec: when a user starts a multi-step workflow (xuất kho, giao hàng,
-- thu tiền, bàn giao), persist a session row so they can resume from
-- another tab/device. Dashboard widget surfaces all open sessions.
--
-- entity_type values map to actual tables (Q1):
--   'sales_order'      → sales_orders.id (edit / pre-pick)
--   'stock_entry'      → stock_entries.id (picking flow + driver-cash settle)
--   'delivery'         → deliveries.id (in-flight giao hàng)
--   'driver_handover'  → driver_handovers.id (T-07; future)
--
-- The `stage` text disambiguates a single entity_type into specific
-- screen states (e.g. picking_in_progress vs collecting_payment).
-- ====================================================================

CREATE TABLE IF NOT EXISTS workflow_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN (
    'sales_order',
    'stock_entry',
    'delivery',
    'driver_handover'
  )),
  entity_id uuid NOT NULL,
  /* Free-form workflow stage (page-defined). Examples:
       'picking_started', 'picking_in_progress',
       'delivering', 'collecting_payment',
       'handover_failed_orders', 'handover_received_goods' */
  stage text NOT NULL,
  /* URL the user should land on to resume. */
  last_url text NOT NULL,
  /* In-memory form draft. Saved every ~10s (debounced) by the hook. */
  form_draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  /* Optional human label for the dashboard widget — caller fills in
     "Đơn DH001" or "Chuyến giao XYZ" so we don't need a join. */
  entity_label text,
  last_action_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz NULL
);

-- One open session per (user, entity) — closing the previous is part
-- of the upsert flow.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_workflow_session_open
  ON workflow_sessions (user_id, entity_type, entity_id)
  WHERE closed_at IS NULL;

-- Hot path: dashboard widget loads "my open sessions, newest first".
CREATE INDEX IF NOT EXISTS idx_ws_user_open
  ON workflow_sessions (user_id, last_action_at DESC)
  WHERE closed_at IS NULL;

-- Auto-bump last_action_at whenever the row updates (form_draft etc).
CREATE OR REPLACE FUNCTION bump_workflow_session_action()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Don't bump on close-only updates so we keep the original action time.
  IF OLD.closed_at IS NULL AND NEW.closed_at IS NULL THEN
    NEW.last_action_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_ws_action ON workflow_sessions;
CREATE TRIGGER trg_bump_ws_action
  BEFORE UPDATE ON workflow_sessions
  FOR EACH ROW EXECUTE FUNCTION bump_workflow_session_action();

ALTER TABLE workflow_sessions ENABLE ROW LEVEL SECURITY;

-- User can only see their own sessions; owner/manager can see all in org
-- (useful for "ai đang làm gì" overview).
CREATE POLICY ws_select ON workflow_sessions FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND (
      user_id = (SELECT auth.uid())
      OR public.user_role() IN ('owner', 'manager')
    )
  );

-- User can only insert/update/delete their own session rows.
CREATE POLICY ws_write ON workflow_sessions FOR ALL
  USING (
    org_id = public.user_org_id()
    AND user_id = (SELECT auth.uid())
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND user_id = (SELECT auth.uid())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_sessions TO authenticated;

COMMENT ON TABLE workflow_sessions IS
  'T-05: open multi-step workflow sessions per user. Powers the "Việc đang dở" dashboard widget and form-draft restore.';
