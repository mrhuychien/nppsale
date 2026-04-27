-- =====================================================================
-- Migration 020: Cash receipts (phiếu thu)
-- =====================================================================
-- After a driver settles a route, the system creates a cash receipt
-- header that the accountant / NPP owner can confirm. The receipt
-- references the source delivery and breaks out the amount per order
-- so the accountant can audit before marking it received.

CREATE TABLE IF NOT EXISTS cash_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  receipt_code text NOT NULL,
  receipt_date date NOT NULL DEFAULT CURRENT_DATE,
  source_type text NOT NULL DEFAULT 'delivery_settle'
    CHECK (source_type IN ('delivery_settle', 'manual')),
  source_id uuid, -- delivery.id when source_type = 'delivery_settle'
  collected_by uuid REFERENCES users(id), -- driver who collected the cash
  submitted_amount numeric(15, 2) NOT NULL DEFAULT 0,
  expected_amount numeric(15, 2) NOT NULL DEFAULT 0,
  notes text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'received', 'voided')),
  received_by uuid REFERENCES users(id), -- accountant / owner
  received_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, receipt_code)
);

CREATE INDEX IF NOT EXISTS idx_cash_receipts_org ON cash_receipts(org_id, status);
CREATE INDEX IF NOT EXISTS idx_cash_receipts_source ON cash_receipts(source_type, source_id);

CREATE TABLE IF NOT EXISTS cash_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES cash_receipts(id) ON DELETE CASCADE,
  order_id uuid REFERENCES sales_orders(id),
  receivable_id uuid REFERENCES receivables(id),
  payment_id uuid REFERENCES payments(id),
  amount numeric(15, 2) NOT NULL,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_cash_receipt_lines_receipt ON cash_receipt_lines(receipt_id);

ALTER TABLE cash_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_receipt_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cash_receipts_select" ON cash_receipts
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());

CREATE POLICY "cash_receipts_insert" ON cash_receipts
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant', 'warehouse', 'driver')
  );

CREATE POLICY "cash_receipts_update" ON cash_receipts
  FOR UPDATE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  );

CREATE POLICY "cash_receipts_delete" ON cash_receipts
  FOR DELETE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  );

-- Lines inherit access via parent (cascade delete handles cleanup)
CREATE POLICY "cash_receipt_lines_select" ON cash_receipt_lines
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM cash_receipts r
    WHERE r.id = cash_receipt_lines.receipt_id
      AND r.org_id = public.user_org_id()
  ));

CREATE POLICY "cash_receipt_lines_insert" ON cash_receipt_lines
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM cash_receipts r
    WHERE r.id = cash_receipt_lines.receipt_id
      AND r.org_id = public.user_org_id()
  ));

CREATE POLICY "cash_receipt_lines_update" ON cash_receipt_lines
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM cash_receipts r
    WHERE r.id = cash_receipt_lines.receipt_id
      AND r.org_id = public.user_org_id()
      AND public.user_role() IN ('owner', 'manager', 'accountant')
  ));

CREATE POLICY "cash_receipt_lines_delete" ON cash_receipt_lines
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM cash_receipts r
    WHERE r.id = cash_receipt_lines.receipt_id
      AND r.org_id = public.user_org_id()
      AND public.user_role() IN ('owner', 'manager')
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON cash_receipts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON cash_receipt_lines TO authenticated;
