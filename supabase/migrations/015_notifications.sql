-- =====================================================================
-- Migration 015: Notifications
-- =====================================================================
-- Per-user notification feed. Rows are created by application code
-- (see src/lib/notifications.ts) whenever a user-visible event occurs:
--   - An order is pending approval (target: managers/owners)
--   - An order was approved/rejected (target: the sales rep who created it)
--   - A payment was recorded on a receivable (target: sales rep)
--   - A customer visit was logged (target: managers/primary assignee)
-- Rows are read by the header bell popover and the /notifications page.

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Categorical type so UI can pick an icon/color
  type text NOT NULL CHECK (type IN (
    'order_pending_approval',
    'order_approved',
    'order_cancelled',
    'payment_received',
    'receivable_overdue',
    'visit_logged',
    'info'
  )),

  title text NOT NULL,
  body text,
  link_url text,

  -- is_read true once the user has acknowledged it
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,

  -- Freeform metadata (order_id, receivable_id, customer_id, etc.)
  metadata jsonb DEFAULT '{}'::jsonb,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_recent
  ON notifications(user_id, created_at DESC);

-- RLS: users only see their own notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select_own" ON notifications
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Any authenticated user in the org can create notifications for other
-- users in the same org (they can't forge notifications for other orgs).
CREATE POLICY "notifications_insert_org" ON notifications
  FOR INSERT TO authenticated
  WITH CHECK (org_id = public.user_org_id());

-- Users can update (mark read) their own notifications
CREATE POLICY "notifications_update_own" ON notifications
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Users can delete their own notifications
CREATE POLICY "notifications_delete_own" ON notifications
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO authenticated;
