-- Purchase Orders
CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  po_code text UNIQUE NOT NULL,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  order_date date DEFAULT CURRENT_DATE,
  expected_delivery date,
  status text DEFAULT 'draft' CHECK (status IN ('draft','confirmed','received','partial','cancelled')),
  payment_terms text,
  subtotal numeric DEFAULT 0,
  vat numeric DEFAULT 0,
  total numeric DEFAULT 0,
  notes text,
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_po_org ON purchase_orders(org_id);
CREATE INDEX idx_po_supplier ON purchase_orders(supplier_id);

-- Purchase Order Lines
CREATE TABLE purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  unit_name text NOT NULL,
  quantity numeric NOT NULL,
  unit_price numeric NOT NULL,
  vat_rate numeric DEFAULT 0.1,
  line_discount numeric DEFAULT 0,
  line_total numeric NOT NULL,
  received_qty numeric DEFAULT 0
);
CREATE INDEX idx_po_lines ON purchase_order_lines(po_id);

-- Purchase Invoices (Hóa đơn mua hàng)
CREATE TABLE purchase_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  po_id uuid REFERENCES purchase_orders(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  invoice_number text,
  invoice_date date DEFAULT CURRENT_DATE,
  subtotal numeric DEFAULT 0,
  vat numeric DEFAULT 0,
  total numeric DEFAULT 0,
  status text DEFAULT 'draft' CHECK (status IN ('draft','confirmed','paid','cancelled')),
  payable_id uuid REFERENCES payables(id),
  notes text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_pinv_org ON purchase_invoices(org_id);

-- RLS
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View POs" ON purchase_orders FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());
CREATE POLICY "Manage POs" ON purchase_orders FOR ALL TO authenticated
  USING (public.user_role() IN ('owner', 'manager', 'warehouse'));

CREATE POLICY "View PO lines" ON purchase_order_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = po_id AND po.org_id = public.user_org_id()));
CREATE POLICY "Manage PO lines" ON purchase_order_lines FOR ALL TO authenticated
  USING (public.user_role() IN ('owner', 'manager', 'warehouse'));

CREATE POLICY "View purchase invoices" ON purchase_invoices FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());
CREATE POLICY "Manage purchase invoices" ON purchase_invoices FOR ALL TO authenticated
  USING (public.user_role() IN ('owner', 'accountant'));

GRANT SELECT ON purchase_orders TO authenticated;
GRANT SELECT ON purchase_order_lines TO authenticated;
GRANT SELECT ON purchase_invoices TO authenticated;
