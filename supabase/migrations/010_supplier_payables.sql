CREATE TABLE payables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  stock_entry_id uuid REFERENCES stock_entries(id),
  invoice_number text,
  amount numeric NOT NULL,
  paid numeric DEFAULT 0,
  due_date date,
  status text DEFAULT 'open' CHECK (status IN ('open','partial','paid','overdue')),
  notes text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_payables_org ON payables(org_id);
CREATE INDEX idx_payables_supplier ON payables(supplier_id);

CREATE TABLE payable_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payable_id uuid NOT NULL REFERENCES payables(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  method text CHECK (method IN ('cash','transfer','offset')),
  paid_by uuid REFERENCES users(id),
  paid_at timestamptz DEFAULT now(),
  verified_by uuid REFERENCES users(id),
  verified_at timestamptz,
  notes text
);
CREATE INDEX idx_payable_payments ON payable_payments(payable_id);

ALTER TABLE payables ENABLE ROW LEVEL SECURITY;
ALTER TABLE payable_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View payables" ON payables FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());
CREATE POLICY "Manage payables" ON payables FOR ALL TO authenticated
  USING (public.user_role() IN ('owner', 'accountant'));

CREATE POLICY "View payable payments" ON payable_payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM payables p WHERE p.id = payable_id AND p.org_id = public.user_org_id()));
CREATE POLICY "Manage payable payments" ON payable_payments FOR ALL TO authenticated
  USING (public.user_role() IN ('owner', 'accountant'));

GRANT SELECT ON payables TO authenticated;
GRANT SELECT ON payable_payments TO authenticated;
