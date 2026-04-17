-- Module: Suppliers (Nhà cung cấp)
-- New table for tracking supplier information

CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  category text,
  contact_name text,
  phone text,
  email text,
  address text,
  tax_code text,
  bank_account text,
  bank_name text,
  payment_terms text DEFAULT 'NET30',
  rating numeric DEFAULT 0,
  notes text,
  is_verified boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(org_id, code)
);
CREATE INDEX idx_suppliers_org ON suppliers(org_id);

-- RLS
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view suppliers"
  ON suppliers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Owner/Manager can manage suppliers"
  ON suppliers FOR ALL
  TO authenticated
  USING (public.user_role() IN ('owner', 'manager', 'warehouse'));

GRANT SELECT ON public.suppliers TO authenticated;

-- Link stock_entries to suppliers (optional FK, add column)
ALTER TABLE stock_entries ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL;
