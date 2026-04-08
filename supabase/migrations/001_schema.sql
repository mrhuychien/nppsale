-- npp.sale Schema Migration
-- All tables for Mini ERP NPP

-- Organizations (multi-tenant)
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  settings jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Users
CREATE TABLE users (
  id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','manager','accountant','sales','warehouse','driver')),
  phone text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_users_org ON users(org_id);
CREATE INDEX idx_users_role ON users(org_id, role);

-- Customer Groups
CREATE TABLE customer_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_customer_groups_org ON customer_groups(org_id);

-- Customers (M2)
CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_name text NOT NULL,
  owner_name text NOT NULL,
  phone text NOT NULL,
  address text NOT NULL,
  province text,
  district text,
  ward text,
  channel text CHECK (channel IN ('GT','MT','HORECA')),
  group_id uuid REFERENCES customer_groups(id) ON DELETE SET NULL,
  credit_limit numeric DEFAULT 0,
  payment_terms text DEFAULT 'COD',
  status text DEFAULT 'active' CHECK (status IN ('active','suspended','locked')),
  gps_lat numeric,
  gps_lng numeric,
  created_at timestamptz DEFAULT now(),
  UNIQUE(org_id, phone)
);
CREATE INDEX idx_customers_org ON customers(org_id);
CREATE INDEX idx_customers_group ON customers(group_id);
CREATE INDEX idx_customers_status ON customers(org_id, status);

-- Customer Assignments (M2)
CREATE TABLE customer_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text DEFAULT 'primary' CHECK (role IN ('primary','secondary')),
  assigned_at date DEFAULT CURRENT_DATE,
  status text DEFAULT 'active',
  UNIQUE(customer_id, user_id)
);
CREATE INDEX idx_assignments_user ON customer_assignments(user_id);
CREATE INDEX idx_assignments_customer ON customer_assignments(customer_id);

-- Products (M6)
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sku text NOT NULL,
  name text NOT NULL,
  category text,
  brand text,
  barcode text,
  base_unit text NOT NULL,
  vat_rate numeric DEFAULT 0.1,
  shelf_life_days integer,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  UNIQUE(org_id, sku)
);
CREATE INDEX idx_products_org ON products(org_id);
CREATE INDEX idx_products_category ON products(org_id, category);

-- Product Units (M6 - Multi-unit)
CREATE TABLE product_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_name text NOT NULL,
  conversion integer NOT NULL,
  UNIQUE(product_id, unit_name)
);
CREATE INDEX idx_product_units_product ON product_units(product_id);

-- Price Lists (M6)
CREATE TABLE price_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  group_id uuid REFERENCES customer_groups(id) ON DELETE SET NULL,
  unit_name text NOT NULL,
  price numeric NOT NULL,
  effective_from date,
  effective_to date
);
CREATE INDEX idx_price_lists_product ON price_lists(product_id);
CREATE INDEX idx_price_lists_group ON price_lists(group_id);

-- Batches (M3)
CREATE TABLE batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  batch_code text NOT NULL,
  manufactured_at date,
  expires_at date NOT NULL,
  location text,
  qty_initial integer NOT NULL,
  qty_on_hand integer NOT NULL,
  status text DEFAULT 'available',
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_batches_org ON batches(org_id);
CREATE INDEX idx_batches_product ON batches(product_id);
CREATE INDEX idx_batches_expiry ON batches(org_id, expires_at);

-- Stock Entries (M3)
CREATE TABLE stock_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entry_code text NOT NULL,
  type text NOT NULL CHECK (type IN ('import','export','transfer','stocktake')),
  created_by uuid REFERENCES users(id),
  notes text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_stock_entries_org ON stock_entries(org_id);

-- Stock Entry Lines (M3)
CREATE TABLE stock_entry_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES stock_entries(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  batch_id uuid REFERENCES batches(id),
  unit_name text NOT NULL,
  quantity integer NOT NULL,
  notes text
);
CREATE INDEX idx_stock_entry_lines_entry ON stock_entry_lines(entry_id);

-- Sales Orders (M1)
CREATE TABLE sales_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_code text UNIQUE NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id),
  sales_user_id uuid NOT NULL REFERENCES users(id),
  order_date date DEFAULT CURRENT_DATE,
  expected_delivery date,
  status text DEFAULT 'draft' CHECK (status IN ('draft','confirmed','picking','delivering','delivered','cancelled')),
  payment_terms text,
  subtotal numeric DEFAULT 0,
  discount numeric DEFAULT 0,
  vat numeric DEFAULT 0,
  total numeric DEFAULT 0,
  merged_into uuid REFERENCES sales_orders(id),
  notes text,
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_orders_org ON sales_orders(org_id);
CREATE INDEX idx_orders_customer ON sales_orders(customer_id);
CREATE INDEX idx_orders_sales_user ON sales_orders(sales_user_id);
CREATE INDEX idx_orders_status ON sales_orders(org_id, status);
CREATE INDEX idx_orders_date ON sales_orders(org_id, order_date);

-- Sales Order Lines (M1)
CREATE TABLE sales_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  unit_name text NOT NULL,
  quantity numeric NOT NULL,
  unit_price numeric NOT NULL,
  line_discount numeric DEFAULT 0,
  line_total numeric NOT NULL,
  batch_id uuid REFERENCES batches(id)
);
CREATE INDEX idx_order_lines_order ON sales_order_lines(order_id);

-- Merged Orders (M1)
CREATE TABLE merged_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merged_order_id uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  source_order_id uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

-- Commission Policies (M5)
CREATE TABLE commission_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('percentage','fixed','tiered')),
  tiers jsonb,
  applies_to text DEFAULT 'all',
  effective_from date,
  effective_to date,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_commission_policies_org ON commission_policies(org_id);

-- Commission Wallets (M5)
CREATE TABLE commission_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period text NOT NULL,
  earned numeric DEFAULT 0,
  paid numeric DEFAULT 0,
  balance numeric GENERATED ALWAYS AS (earned - paid) STORED,
  UNIQUE(user_id, period)
);
CREATE INDEX idx_commission_wallets_user ON commission_wallets(user_id);

-- Receivables (M7)
CREATE TABLE receivables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id uuid REFERENCES sales_orders(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  sales_user_id uuid REFERENCES users(id),
  amount numeric NOT NULL,
  paid numeric DEFAULT 0,
  due_date date,
  status text DEFAULT 'open' CHECK (status IN ('open','partial','paid','overdue')),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_receivables_org ON receivables(org_id);
CREATE INDEX idx_receivables_customer ON receivables(customer_id);
CREATE INDEX idx_receivables_sales_user ON receivables(sales_user_id);
CREATE INDEX idx_receivables_status ON receivables(org_id, status);

-- Payments (M7)
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receivable_id uuid NOT NULL REFERENCES receivables(id) ON DELETE CASCADE,
  collected_by uuid NOT NULL REFERENCES users(id),
  amount numeric NOT NULL,
  method text CHECK (method IN ('cash','transfer','ewallet')),
  collected_at timestamptz DEFAULT now(),
  verified_by uuid REFERENCES users(id),
  verified_at timestamptz
);
CREATE INDEX idx_payments_receivable ON payments(receivable_id);

-- Deliveries (M8)
CREATE TABLE deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES users(id),
  vehicle text,
  route_name text,
  status text DEFAULT 'pending' CHECK (status IN ('pending','in_transit','completed','cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_deliveries_org ON deliveries(org_id);
CREATE INDEX idx_deliveries_driver ON deliveries(driver_id);

-- Delivery Lines (M8)
CREATE TABLE delivery_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES sales_orders(id),
  status text DEFAULT 'pending' CHECK (status IN ('pending','delivered','partial','failed')),
  pod_photo_url text,
  pod_signature text,
  delivered_at timestamptz,
  notes text
);
CREATE INDEX idx_delivery_lines_delivery ON delivery_lines(delivery_id);

-- Promotions (M9)
CREATE TABLE promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('trade_discount','buy_x_get_y','payment_discount','cumulative','display')),
  rules jsonb NOT NULL DEFAULT '{}',
  priority integer DEFAULT 0,
  target_groups uuid[],
  starts_at date,
  ends_at date,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_promotions_org ON promotions(org_id);

-- Invoices (M10)
CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id uuid REFERENCES sales_orders(id),
  invoice_number text,
  customer_name text NOT NULL,
  customer_address text,
  customer_tax_code text,
  subtotal numeric DEFAULT 0,
  vat numeric DEFAULT 0,
  total numeric DEFAULT 0,
  status text DEFAULT 'draft' CHECK (status IN ('draft','issued','cancelled')),
  issued_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_invoices_org ON invoices(org_id);

-- Returns (M11)
CREATE TABLE returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id uuid REFERENCES sales_orders(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  requested_by uuid NOT NULL REFERENCES users(id),
  reason text CHECK (reason IN ('damaged','wrong_item','near_expiry','expired','refused')),
  status text DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','completed')),
  approved_by uuid REFERENCES users(id),
  credit_note_amount numeric,
  photo_url text,
  notes text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_returns_org ON returns(org_id);

-- Return Lines (M11)
CREATE TABLE return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  unit_name text NOT NULL,
  quantity numeric NOT NULL,
  unit_price numeric NOT NULL,
  line_total numeric NOT NULL
);
CREATE INDEX idx_return_lines_return ON return_lines(return_id);

-- Reports Config (M12)
CREATE TABLE reports_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  report_type text NOT NULL,
  config jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
