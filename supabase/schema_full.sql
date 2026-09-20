-- ================================================================
-- npp.sale — SCHEMA GỘP (tự sinh, KHÔNG sửa tay)
-- Gộp tất cả migration trong supabase/migrations theo thứ tự,
-- TRỪ 003_seed (dữ liệu demo — xem supabase/seed_demo.sql).
-- Dùng cho CÀI MỚI: dán toàn bộ file này vào Supabase SQL Editor
-- và chạy 1 lần trên database TRỐNG.
-- Sinh lại bằng: bash scripts/build-combined-migration.sh
-- ================================================================


-- ####################################################################
-- # 001_schema.sql
-- ####################################################################

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


-- ####################################################################
-- # 002_rls_policies.sql
-- ####################################################################

-- npp.sale RLS Policies
-- Row Level Security for all tables

-- Helper function to get user org_id
CREATE OR REPLACE FUNCTION public.user_org_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN (SELECT org_id FROM public.users WHERE id = (SELECT auth.uid()));
END;
$$;

-- Helper function to get user role
CREATE OR REPLACE FUNCTION public.user_role()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN (SELECT role FROM public.users WHERE id = (SELECT auth.uid()));
END;
$$;

-- ==========================================
-- ORGANIZATIONS
-- ==========================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own org" ON organizations;
CREATE POLICY "Users can view their own org"
  ON organizations FOR SELECT
  USING (id = public.user_org_id());

DROP POLICY IF EXISTS "Owners can update their org" ON organizations;
CREATE POLICY "Owners can update their org"
  ON organizations FOR UPDATE
  USING (id = public.user_org_id() AND public.user_role() = 'owner');

-- ==========================================
-- USERS
-- ==========================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view org members" ON users;
CREATE POLICY "Users can view org members"
  ON users FOR SELECT
  USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS "Owners can manage users" ON users;
CREATE POLICY "Owners can manage users"
  ON users FOR ALL
  USING (org_id = public.user_org_id() AND public.user_role() = 'owner');

DROP POLICY IF EXISTS "Users can view own profile" ON users;
CREATE POLICY "Users can view own profile"
  ON users FOR SELECT
  USING (id = auth.uid());

-- ==========================================
-- CUSTOMER GROUPS
-- ==========================================
ALTER TABLE customer_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view customer groups" ON customer_groups;
CREATE POLICY "Org members can view customer groups"
  ON customer_groups FOR SELECT
  USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS "Owner/Manager can manage customer groups" ON customer_groups;
CREATE POLICY "Owner/Manager can manage customer groups"
  ON customer_groups FOR ALL
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'manager'));

-- ==========================================
-- CUSTOMERS
-- ==========================================
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- Owner, Manager, Accountant see all customers in org
DROP POLICY IF EXISTS "Admin roles can view all customers" ON customers;
CREATE POLICY "Admin roles can view all customers"
  ON customers FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  );

-- Sales only see assigned customers
DROP POLICY IF EXISTS "Sales see assigned customers" ON customers;
CREATE POLICY "Sales see assigned customers"
  ON customers FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'sales'
    AND id IN (
      SELECT customer_id FROM customer_assignments
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

DROP POLICY IF EXISTS "Owner/Manager/Sales can create customers" ON customers;
CREATE POLICY "Owner/Manager/Sales can create customers"
  ON customers FOR INSERT
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'sales')
  );

DROP POLICY IF EXISTS "Owner/Manager/Sales can update customers" ON customers;
CREATE POLICY "Owner/Manager/Sales can update customers"
  ON customers FOR UPDATE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'sales')
  );

DROP POLICY IF EXISTS "Owner can delete customers" ON customers;
CREATE POLICY "Owner can delete customers"
  ON customers FOR DELETE
  USING (org_id = public.user_org_id() AND public.user_role() = 'owner');

-- ==========================================
-- CUSTOMER ASSIGNMENTS
-- ==========================================
ALTER TABLE customer_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view assignments" ON customer_assignments;
CREATE POLICY "Org members can view assignments"
  ON customer_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM customers c
      WHERE c.id = customer_id AND c.org_id = public.user_org_id()
    )
  );

DROP POLICY IF EXISTS "Owner/Manager can manage assignments" ON customer_assignments;
CREATE POLICY "Owner/Manager can manage assignments"
  ON customer_assignments FOR ALL
  USING (
    public.user_role() IN ('owner', 'manager')
    AND EXISTS (
      SELECT 1 FROM customers c
      WHERE c.id = customer_id AND c.org_id = public.user_org_id()
    )
  );

-- ==========================================
-- PRODUCTS
-- ==========================================
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view products" ON products;
CREATE POLICY "Org members can view products"
  ON products FOR SELECT
  USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS "Owner/Manager can manage products" ON products;
CREATE POLICY "Owner/Manager can manage products"
  ON products FOR ALL
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'manager'));

-- ==========================================
-- PRODUCT UNITS
-- ==========================================
ALTER TABLE product_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view product units" ON product_units;
CREATE POLICY "Org members can view product units"
  ON product_units FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM products p WHERE p.id = product_id AND p.org_id = public.user_org_id()
    )
  );

DROP POLICY IF EXISTS "Owner/Manager can manage product units" ON product_units;
CREATE POLICY "Owner/Manager can manage product units"
  ON product_units FOR ALL
  USING (
    public.user_role() IN ('owner', 'manager')
    AND EXISTS (
      SELECT 1 FROM products p WHERE p.id = product_id AND p.org_id = public.user_org_id()
    )
  );

-- ==========================================
-- PRICE LISTS
-- ==========================================
ALTER TABLE price_lists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view price lists" ON price_lists;
CREATE POLICY "Org members can view price lists"
  ON price_lists FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM products p WHERE p.id = product_id AND p.org_id = public.user_org_id()
    )
  );

DROP POLICY IF EXISTS "Owner/Manager can manage price lists" ON price_lists;
CREATE POLICY "Owner/Manager can manage price lists"
  ON price_lists FOR ALL
  USING (
    public.user_role() IN ('owner', 'manager')
    AND EXISTS (
      SELECT 1 FROM products p WHERE p.id = product_id AND p.org_id = public.user_org_id()
    )
  );

-- ==========================================
-- BATCHES
-- ==========================================
ALTER TABLE batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view batches" ON batches;
CREATE POLICY "Org members can view batches"
  ON batches FOR SELECT
  USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS "Owner/Warehouse can manage batches" ON batches;
CREATE POLICY "Owner/Warehouse can manage batches"
  ON batches FOR ALL
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'warehouse'));

-- ==========================================
-- STOCK ENTRIES
-- ==========================================
ALTER TABLE stock_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view stock entries" ON stock_entries;
CREATE POLICY "Org members can view stock entries"
  ON stock_entries FOR SELECT
  USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS "Owner/Warehouse can manage stock entries" ON stock_entries;
CREATE POLICY "Owner/Warehouse can manage stock entries"
  ON stock_entries FOR ALL
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'warehouse'));

-- ==========================================
-- STOCK ENTRY LINES
-- ==========================================
ALTER TABLE stock_entry_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view stock entry lines" ON stock_entry_lines;
CREATE POLICY "Org members can view stock entry lines"
  ON stock_entry_lines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM stock_entries se WHERE se.id = entry_id AND se.org_id = public.user_org_id()
    )
  );

DROP POLICY IF EXISTS "Owner/Warehouse can manage stock entry lines" ON stock_entry_lines;
CREATE POLICY "Owner/Warehouse can manage stock entry lines"
  ON stock_entry_lines FOR ALL
  USING (
    public.user_role() IN ('owner', 'warehouse')
    AND EXISTS (
      SELECT 1 FROM stock_entries se WHERE se.id = entry_id AND se.org_id = public.user_org_id()
    )
  );

-- ==========================================
-- SALES ORDERS
-- ==========================================
ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;

-- Owner, Manager, Accountant, Warehouse see all orders
DROP POLICY IF EXISTS "Admin roles can view all orders" ON sales_orders;
CREATE POLICY "Admin roles can view all orders"
  ON sales_orders FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant', 'warehouse')
  );

-- Sales only see own orders
DROP POLICY IF EXISTS "Sales see own orders" ON sales_orders;
CREATE POLICY "Sales see own orders"
  ON sales_orders FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'sales'
    AND sales_user_id = auth.uid()
  );

-- Driver sees orders assigned to their deliveries
DROP POLICY IF EXISTS "Driver sees delivery orders" ON sales_orders;
CREATE POLICY "Driver sees delivery orders"
  ON sales_orders FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'driver'
    AND id IN (
      SELECT dl.order_id FROM delivery_lines dl
      JOIN deliveries d ON d.id = dl.delivery_id
      WHERE d.driver_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owner/Manager/Sales can create orders" ON sales_orders;
CREATE POLICY "Owner/Manager/Sales can create orders"
  ON sales_orders FOR INSERT
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'sales')
  );

DROP POLICY IF EXISTS "Owner/Manager can update orders" ON sales_orders;
CREATE POLICY "Owner/Manager can update orders"
  ON sales_orders FOR UPDATE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  );

DROP POLICY IF EXISTS "Sales can update own draft orders" ON sales_orders;
CREATE POLICY "Sales can update own draft orders"
  ON sales_orders FOR UPDATE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'sales'
    AND sales_user_id = auth.uid()
    AND status = 'draft'
  );

-- ==========================================
-- SALES ORDER LINES
-- ==========================================
ALTER TABLE sales_order_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view order lines of visible orders" ON sales_order_lines;
CREATE POLICY "Users can view order lines of visible orders"
  ON sales_order_lines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM sales_orders so WHERE so.id = order_id
    )
  );

DROP POLICY IF EXISTS "Owner/Manager/Sales can manage order lines" ON sales_order_lines;
CREATE POLICY "Owner/Manager/Sales can manage order lines"
  ON sales_order_lines FOR ALL
  USING (
    public.user_role() IN ('owner', 'manager', 'sales')
    AND EXISTS (
      SELECT 1 FROM sales_orders so
      WHERE so.id = order_id AND so.org_id = public.user_org_id()
    )
  );

-- ==========================================
-- MERGED ORDERS
-- ==========================================
ALTER TABLE merged_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view merged orders" ON merged_orders;
CREATE POLICY "Org members can view merged orders"
  ON merged_orders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM sales_orders so
      WHERE so.id = merged_order_id AND so.org_id = public.user_org_id()
    )
  );

DROP POLICY IF EXISTS "Owner/Manager can manage merged orders" ON merged_orders;
CREATE POLICY "Owner/Manager can manage merged orders"
  ON merged_orders FOR ALL
  USING (
    public.user_role() IN ('owner', 'manager')
  );

-- ==========================================
-- COMMISSION POLICIES
-- ==========================================
ALTER TABLE commission_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view commission policies" ON commission_policies;
CREATE POLICY "Org members can view commission policies"
  ON commission_policies FOR SELECT
  USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS "Owner can manage commission policies" ON commission_policies;
CREATE POLICY "Owner can manage commission policies"
  ON commission_policies FOR ALL
  USING (org_id = public.user_org_id() AND public.user_role() = 'owner');

-- ==========================================
-- COMMISSION WALLETS
-- ==========================================
ALTER TABLE commission_wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own wallet" ON commission_wallets;
CREATE POLICY "Users can view own wallet"
  ON commission_wallets FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Owner/Accountant can view all wallets" ON commission_wallets;
CREATE POLICY "Owner/Accountant can view all wallets"
  ON commission_wallets FOR SELECT
  USING (
    public.user_role() IN ('owner', 'accountant')
    AND EXISTS (
      SELECT 1 FROM users u WHERE u.id = user_id AND u.org_id = public.user_org_id()
    )
  );

DROP POLICY IF EXISTS "Owner/Accountant can manage wallets" ON commission_wallets;
CREATE POLICY "Owner/Accountant can manage wallets"
  ON commission_wallets FOR ALL
  USING (
    public.user_role() IN ('owner', 'accountant')
    AND EXISTS (
      SELECT 1 FROM users u WHERE u.id = user_id AND u.org_id = public.user_org_id()
    )
  );

-- ==========================================
-- RECEIVABLES
-- ==========================================
ALTER TABLE receivables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin roles can view all receivables" ON receivables;
CREATE POLICY "Admin roles can view all receivables"
  ON receivables FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  );

DROP POLICY IF EXISTS "Sales see own receivables" ON receivables;
CREATE POLICY "Sales see own receivables"
  ON receivables FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'sales'
    AND sales_user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Driver see assigned receivables" ON receivables;
CREATE POLICY "Driver see assigned receivables"
  ON receivables FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'driver'
    AND order_id IN (
      SELECT dl.order_id FROM delivery_lines dl
      JOIN deliveries d ON d.id = dl.delivery_id
      WHERE d.driver_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Authorized roles can create receivables" ON receivables;
CREATE POLICY "Authorized roles can create receivables"
  ON receivables FOR INSERT
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'accountant', 'sales')
  );

DROP POLICY IF EXISTS "Accountant/Owner can update receivables" ON receivables;
CREATE POLICY "Accountant/Owner can update receivables"
  ON receivables FOR UPDATE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'accountant')
  );

-- ==========================================
-- PAYMENTS
-- ==========================================
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view payments" ON payments;
CREATE POLICY "Org members can view payments"
  ON payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM receivables r WHERE r.id = receivable_id AND r.org_id = public.user_org_id()
    )
  );

DROP POLICY IF EXISTS "Sales/Driver/Accountant can create payments" ON payments;
CREATE POLICY "Sales/Driver/Accountant can create payments"
  ON payments FOR INSERT
  WITH CHECK (
    public.user_role() IN ('owner', 'accountant', 'sales', 'driver')
    AND EXISTS (
      SELECT 1 FROM receivables r WHERE r.id = receivable_id AND r.org_id = public.user_org_id()
    )
  );

DROP POLICY IF EXISTS "Accountant can verify payments" ON payments;
CREATE POLICY "Accountant can verify payments"
  ON payments FOR UPDATE
  USING (
    public.user_role() IN ('owner', 'accountant')
    AND EXISTS (
      SELECT 1 FROM receivables r WHERE r.id = receivable_id AND r.org_id = public.user_org_id()
    )
  );

-- ==========================================
-- DELIVERIES
-- ==========================================
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin roles can view all deliveries" ON deliveries;
CREATE POLICY "Admin roles can view all deliveries"
  ON deliveries FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'warehouse')
  );

DROP POLICY IF EXISTS "Driver sees own deliveries" ON deliveries;
CREATE POLICY "Driver sees own deliveries"
  ON deliveries FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'driver'
    AND driver_id = auth.uid()
  );

DROP POLICY IF EXISTS "Owner/Manager/Warehouse can manage deliveries" ON deliveries;
CREATE POLICY "Owner/Manager/Warehouse can manage deliveries"
  ON deliveries FOR ALL
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'warehouse')
  );

DROP POLICY IF EXISTS "Driver can update own deliveries" ON deliveries;
CREATE POLICY "Driver can update own deliveries"
  ON deliveries FOR UPDATE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'driver'
    AND driver_id = auth.uid()
  );

-- ==========================================
-- DELIVERY LINES
-- ==========================================
ALTER TABLE delivery_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view delivery lines" ON delivery_lines;
CREATE POLICY "Users can view delivery lines"
  ON delivery_lines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM deliveries d WHERE d.id = delivery_id AND d.org_id = public.user_org_id()
    )
  );

DROP POLICY IF EXISTS "Authorized roles can manage delivery lines" ON delivery_lines;
CREATE POLICY "Authorized roles can manage delivery lines"
  ON delivery_lines FOR ALL
  USING (
    public.user_role() IN ('owner', 'manager', 'warehouse', 'driver')
    AND EXISTS (
      SELECT 1 FROM deliveries d WHERE d.id = delivery_id AND d.org_id = public.user_org_id()
    )
  );

-- ==========================================
-- PROMOTIONS
-- ==========================================
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view promotions" ON promotions;
CREATE POLICY "Org members can view promotions"
  ON promotions FOR SELECT
  USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS "Owner/Manager can manage promotions" ON promotions;
CREATE POLICY "Owner/Manager can manage promotions"
  ON promotions FOR ALL
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'manager'));

-- ==========================================
-- INVOICES
-- ==========================================
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view invoices" ON invoices;
CREATE POLICY "Org members can view invoices"
  ON invoices FOR SELECT
  USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS "Owner/Accountant can manage invoices" ON invoices;
CREATE POLICY "Owner/Accountant can manage invoices"
  ON invoices FOR ALL
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'accountant'));

-- ==========================================
-- RETURNS
-- ==========================================
ALTER TABLE returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin roles can view all returns" ON returns;
CREATE POLICY "Admin roles can view all returns"
  ON returns FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant', 'warehouse')
  );

DROP POLICY IF EXISTS "Sales see own returns" ON returns;
CREATE POLICY "Sales see own returns"
  ON returns FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'sales'
    AND requested_by = auth.uid()
  );

DROP POLICY IF EXISTS "Sales can create returns" ON returns;
CREATE POLICY "Sales can create returns"
  ON returns FOR INSERT
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'sales')
  );

DROP POLICY IF EXISTS "Owner/Manager can approve returns" ON returns;
CREATE POLICY "Owner/Manager can approve returns"
  ON returns FOR UPDATE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  );

-- ==========================================
-- RETURN LINES
-- ==========================================
ALTER TABLE return_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view return lines" ON return_lines;
CREATE POLICY "Users can view return lines"
  ON return_lines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM returns r WHERE r.id = return_id AND r.org_id = public.user_org_id()
    )
  );

DROP POLICY IF EXISTS "Authorized roles can manage return lines" ON return_lines;
CREATE POLICY "Authorized roles can manage return lines"
  ON return_lines FOR ALL
  USING (
    public.user_role() IN ('owner', 'manager', 'sales')
    AND EXISTS (
      SELECT 1 FROM returns r WHERE r.id = return_id AND r.org_id = public.user_org_id()
    )
  );

-- ==========================================
-- REPORTS CONFIG
-- ==========================================
ALTER TABLE reports_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view reports config" ON reports_config;
CREATE POLICY "Org members can view reports config"
  ON reports_config FOR SELECT
  USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS "Owner can manage reports config" ON reports_config;
CREATE POLICY "Owner can manage reports config"
  ON reports_config FOR ALL
  USING (org_id = public.user_org_id() AND public.user_role() = 'owner');


-- ####################################################################
-- # 004_fix_rls_permissions.sql
-- ####################################################################

-- Fix: 500 errors on REST queries caused by RLS policy issues
-- This migration:
-- 1. Explicitly grants EXECUTE on helper functions to authenticated role
-- 2. Rewrites users table RLS to avoid any potential recursion
-- 3. Ensures proper privileges

-- ==========================================
-- GRANT EXECUTE on helper functions
-- ==========================================
GRANT EXECUTE ON FUNCTION public.user_org_id() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_role() TO anon, authenticated, service_role;

-- ==========================================
-- REWRITE users table policies to avoid recursion
-- The original policies used public.user_org_id() which queries users.
-- Although SECURITY DEFINER should bypass RLS, some Supabase versions
-- still detect recursion. Use a simpler approach.
-- ==========================================

DROP POLICY IF EXISTS "Users can view org members" ON users;
DROP POLICY IF EXISTS "Owners can manage users" ON users;
DROP POLICY IF EXISTS "Users can view own profile" ON users;

-- Anyone authenticated can view users in their org (joined queries)
DROP POLICY IF EXISTS "Authenticated users can view users" ON users;
CREATE POLICY "Authenticated users can view users"
  ON users FOR SELECT
  TO authenticated
  USING (true);

-- Only owner can insert/update/delete users (enforced in app layer too)
DROP POLICY IF EXISTS "Owner can insert users" ON users;
CREATE POLICY "Owner can insert users"
  ON users FOR INSERT
  TO authenticated
  WITH CHECK (public.user_role() = 'owner');

DROP POLICY IF EXISTS "Owner can update users" ON users;
CREATE POLICY "Owner can update users"
  ON users FOR UPDATE
  TO authenticated
  USING (public.user_role() = 'owner');

DROP POLICY IF EXISTS "Owner can delete users" ON users;
CREATE POLICY "Owner can delete users"
  ON users FOR DELETE
  TO authenticated
  USING (public.user_role() = 'owner');

-- ==========================================
-- Ensure helper functions have schema access
-- ==========================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON public.users TO authenticated;


-- ####################################################################
-- # 005_fix_customers_recursion.sql
-- ####################################################################

-- Fix: 42P17 infinite recursion on customers table
-- Root cause: customers policy subqueries customer_assignments, and
-- customer_assignments policy subqueries customers -> infinite loop.
--
-- Solution: move the "sales sees assigned customers" check into a
-- SECURITY DEFINER helper function that bypasses RLS, and simplify
-- the customers policies.

-- ==========================================
-- Helper: check if current user is assigned to a customer
-- SECURITY DEFINER so it can read customer_assignments without
-- triggering RLS recursion.
-- ==========================================
CREATE OR REPLACE FUNCTION public.user_is_assigned_to_customer(cid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.customer_assignments
    WHERE customer_id = cid
      AND user_id = (SELECT auth.uid())
      AND status = 'active'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_is_assigned_to_customer(uuid) TO anon, authenticated, service_role;

-- ==========================================
-- Drop all old customers policies
-- ==========================================
DROP POLICY IF EXISTS "Admin roles can view all customers" ON customers;
DROP POLICY IF EXISTS "Sales see assigned customers" ON customers;
DROP POLICY IF EXISTS "Owner/Manager/Sales can create customers" ON customers;
DROP POLICY IF EXISTS "Owner/Manager/Sales can update customers" ON customers;
DROP POLICY IF EXISTS "Owner can delete customers" ON customers;

-- ==========================================
-- Recreate customers policies without recursion
-- ==========================================

-- Admin roles see all customers in their org
CREATE POLICY "Admin roles can view all customers"
  ON customers FOR SELECT
  TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  );

-- Sales see only assigned customers (uses helper function, no subquery on customer_assignments)
CREATE POLICY "Sales see assigned customers"
  ON customers FOR SELECT
  TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'sales'
    AND public.user_is_assigned_to_customer(id)
  );

-- Owner/Manager/Sales can create
CREATE POLICY "Owner/Manager/Sales can create customers"
  ON customers FOR INSERT
  TO authenticated
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'sales')
  );

-- Owner/Manager/Sales can update
CREATE POLICY "Owner/Manager/Sales can update customers"
  ON customers FOR UPDATE
  TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'sales')
  );

-- Owner can delete
CREATE POLICY "Owner can delete customers"
  ON customers FOR DELETE
  TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() = 'owner');

-- ==========================================
-- Fix customer_assignments policies (drop subquery on customers)
-- ==========================================
DROP POLICY IF EXISTS "Org members can view assignments" ON customer_assignments;
DROP POLICY IF EXISTS "Owner/Manager can manage assignments" ON customer_assignments;

-- Anyone authenticated in the same org can view assignments (no recursion)
DROP POLICY IF EXISTS "Authenticated can view assignments" ON customer_assignments;
CREATE POLICY "Authenticated can view assignments"
  ON customer_assignments FOR SELECT
  TO authenticated
  USING (true);

-- Owner/Manager can manage
CREATE POLICY "Owner/Manager can manage assignments"
  ON customer_assignments FOR ALL
  TO authenticated
  USING (public.user_role() IN ('owner', 'manager'));

-- ==========================================
-- Also check other tables that might have similar recursion:
-- sales_orders references customers in its policies, but only via
-- foreign key check, not subquery, so it should be fine.
-- Just ensure proper grants.
-- ==========================================
GRANT SELECT ON public.customer_assignments TO authenticated;
GRANT SELECT ON public.customers TO authenticated;


-- ####################################################################
-- # 006_suppliers.sql
-- ####################################################################

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

DROP POLICY IF EXISTS "Authenticated can view suppliers" ON suppliers;
CREATE POLICY "Authenticated can view suppliers"
  ON suppliers FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Owner/Manager can manage suppliers" ON suppliers;
CREATE POLICY "Owner/Manager can manage suppliers"
  ON suppliers FOR ALL
  TO authenticated
  USING (public.user_role() IN ('owner', 'manager', 'warehouse'));

GRANT SELECT ON public.suppliers TO authenticated;

-- Link stock_entries to suppliers (optional FK, add column)
ALTER TABLE stock_entries ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL;


-- ####################################################################
-- # 007_hr_module.sql
-- ####################################################################

-- Module HR: Chấm công, Tính lương, Cơ chế thưởng
-- Tables for attendance, payroll, salary structure, bonus tiers

-- ==========================================
-- 1. Cấu hình lương cơ bản (salary structure)
-- ==========================================
CREATE TABLE hr_salary_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Cấu hình mặc định',
  base_salary numeric NOT NULL DEFAULT 3700000,
  gas_allowance numeric NOT NULL DEFAULT 1000000,
  phone_allowance numeric NOT NULL DEFAULT 300000,
  working_days_per_month integer NOT NULL DEFAULT 26,
  -- Tiered target bonuses (% of target reached → bonus amount)
  target_tiers jsonb NOT NULL DEFAULT '[
    {"min_percent": 70, "bonus": 1000000, "label": "Đạt 70%"},
    {"min_percent": 80, "bonus": 1000000, "label": "Đạt 80%"},
    {"min_percent": 90, "bonus": 1000000, "label": "Đạt 90%"},
    {"min_percent": 100, "bonus": 1000000, "label": "Đạt 100%"}
  ]',
  -- Over 100% bonus
  over_target_percent numeric NOT NULL DEFAULT 5,
  -- Under-performance rules
  under_70_rule text DEFAULT 'base_only',
  under_60_percent numeric DEFAULT 6,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_hr_salary_config_org ON hr_salary_config(org_id);

-- ==========================================
-- 2. Thưởng doanh số theo tháng (monthly bonus tiers)
-- ==========================================
CREATE TABLE hr_monthly_bonus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period text NOT NULL,
  tiers jsonb NOT NULL DEFAULT '[
    {"min_revenue": 150000000, "bonus": 1000000},
    {"min_revenue": 200000000, "bonus": 1500000},
    {"min_revenue": 250000000, "bonus": 2000000},
    {"min_revenue": 300000000, "bonus": 2500000},
    {"min_revenue": 350000000, "bonus": 3000000}
  ]',
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(org_id, period)
);
CREATE INDEX idx_hr_monthly_bonus_org ON hr_monthly_bonus(org_id);

-- ==========================================
-- 3. Chấm công (attendance)
-- ==========================================
CREATE TABLE hr_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  status text NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'absent', 'half_day', 'leave', 'holiday')),
  check_in time,
  check_out time,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, work_date)
);
CREATE INDEX idx_hr_attendance_org ON hr_attendance(org_id);
CREATE INDEX idx_hr_attendance_user ON hr_attendance(user_id, work_date);

-- ==========================================
-- 4. Bảng lương (payroll)
-- ==========================================
CREATE TABLE hr_payroll (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period text NOT NULL,
  -- Attendance
  working_days integer DEFAULT 0,
  absent_days integer DEFAULT 0,
  -- Revenue
  total_revenue numeric DEFAULT 0,
  target_amount numeric DEFAULT 0,
  target_percent numeric DEFAULT 0,
  -- Salary breakdown
  base_salary numeric DEFAULT 0,
  gas_allowance numeric DEFAULT 0,
  phone_allowance numeric DEFAULT 0,
  target_bonus numeric DEFAULT 0,
  over_target_bonus numeric DEFAULT 0,
  monthly_revenue_bonus numeric DEFAULT 0,
  deductions numeric DEFAULT 0,
  total_salary numeric DEFAULT 0,
  -- Breakdown JSON for audit
  breakdown jsonb DEFAULT '{}',
  -- Status
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'paid')),
  confirmed_by uuid REFERENCES users(id),
  confirmed_at timestamptz,
  paid_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, period)
);
CREATE INDEX idx_hr_payroll_org ON hr_payroll(org_id);
CREATE INDEX idx_hr_payroll_user ON hr_payroll(user_id);

-- ==========================================
-- RLS
-- ==========================================
ALTER TABLE hr_salary_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_monthly_bonus ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_payroll ENABLE ROW LEVEL SECURITY;

-- Config: owner can manage, all authenticated can view
DROP POLICY IF EXISTS "View salary config" ON hr_salary_config;
CREATE POLICY "View salary config" ON hr_salary_config FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Manage salary config" ON hr_salary_config;
CREATE POLICY "Manage salary config" ON hr_salary_config FOR ALL TO authenticated USING (public.user_role() = 'owner');

-- Monthly bonus: same as config
DROP POLICY IF EXISTS "View monthly bonus" ON hr_monthly_bonus;
CREATE POLICY "View monthly bonus" ON hr_monthly_bonus FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Manage monthly bonus" ON hr_monthly_bonus;
CREATE POLICY "Manage monthly bonus" ON hr_monthly_bonus FOR ALL TO authenticated USING (public.user_role() = 'owner');

-- Attendance: all can view (for the grid), owner/manager can manage
DROP POLICY IF EXISTS "View attendance" ON hr_attendance;
CREATE POLICY "View attendance" ON hr_attendance FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Manage attendance" ON hr_attendance;
CREATE POLICY "Manage attendance" ON hr_attendance FOR ALL TO authenticated
  USING (public.user_role() IN ('owner', 'manager'));

-- Payroll: owner/accountant can manage, employees see own
DROP POLICY IF EXISTS "View own payroll" ON hr_payroll;
CREATE POLICY "View own payroll" ON hr_payroll FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.user_role() IN ('owner', 'accountant', 'manager'));
DROP POLICY IF EXISTS "Manage payroll" ON hr_payroll;
CREATE POLICY "Manage payroll" ON hr_payroll FOR ALL TO authenticated
  USING (public.user_role() IN ('owner', 'accountant'));

-- Grants
GRANT SELECT ON hr_salary_config TO authenticated;
GRANT SELECT ON hr_monthly_bonus TO authenticated;
GRANT SELECT ON hr_attendance TO authenticated;
GRANT SELECT ON hr_payroll TO authenticated;

-- ==========================================
-- Seed default salary config
-- ==========================================
-- ⚠ Hai lệnh dưới đây trước kia là `VALUES ('a0000000-…-0001', …)` — gắn
-- cứng UUID của org DEMO do 003_seed.sql tạo. Hệ quả đo được: cài mới mà
-- BỎ QUA 003_seed (đúng cách cài cho bản giao, vì 003 kèm 6 tài khoản demo
-- mật khẩu công khai) thì migration này ĐỨT ở đây với lỗi khoá ngoại —
-- người cài tưởng schema hỏng, trong khi thứ thiếu chỉ là dữ liệu mẫu.
--
-- Nay dùng `SELECT … FROM organizations WHERE id = …`: có org demo thì
-- chèn y như cũ, không có thì chèn 0 dòng và đi tiếp. Không nới lỏng gì —
-- vẫn đúng một org đó, không đụng org thật của ai.
INSERT INTO hr_salary_config (org_id, name, base_salary, gas_allowance, phone_allowance, target_tiers)
SELECT
  o.id,
  'Cấu hình lương NVBH',
  3700000, 1000000, 300000,
  '[
    {"min_percent": 70, "bonus": 1000000, "label": "Đạt 70%"},
    {"min_percent": 80, "bonus": 1000000, "label": "Đạt 80%"},
    {"min_percent": 90, "bonus": 1000000, "label": "Đạt 90%"},
    {"min_percent": 100, "bonus": 1000000, "label": "Đạt 100%"}
  ]'
FROM organizations o
WHERE o.id = 'a0000000-0000-0000-0000-000000000001';

-- Seed April 2026 bonus tiers
INSERT INTO hr_monthly_bonus (org_id, period, tiers, notes)
SELECT
  o.id,
  '2026-04',
  '[
    {"min_revenue": 150000000, "bonus": 1000000},
    {"min_revenue": 200000000, "bonus": 1500000},
    {"min_revenue": 250000000, "bonus": 2000000},
    {"min_revenue": 300000000, "bonus": 2500000},
    {"min_revenue": 350000000, "bonus": 3000000}
  ]',
  'Thưởng doanh số tháng 4/2026'
FROM organizations o
WHERE o.id = 'a0000000-0000-0000-0000-000000000001';


-- ####################################################################
-- # 008_fix_security_audit.sql
-- ####################################################################

-- Migration 008: Fix P0 security issues + P1 audit trail
-- Must run AFTER migrations 001-007

-- ==========================================
-- P0-1: Fix users RLS cross-tenant leak
-- Migration 004 set USING(true) to avoid recursion.
-- Fix: use org_id check via SECURITY DEFINER function (no recursion)
-- ==========================================
DROP POLICY IF EXISTS "Authenticated users can view users" ON users;
DROP POLICY IF EXISTS "Owner can insert users" ON users;
DROP POLICY IF EXISTS "Owner can update users" ON users;
DROP POLICY IF EXISTS "Owner can delete users" ON users;

DROP POLICY IF EXISTS "Users view own org" ON users;
CREATE POLICY "Users view own org"
  ON users FOR SELECT
  TO authenticated
  USING (org_id = public.user_org_id() OR id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Owner insert users" ON users;
CREATE POLICY "Owner insert users"
  ON users FOR INSERT
  TO authenticated
  WITH CHECK (public.user_role() = 'owner' AND org_id = public.user_org_id());

DROP POLICY IF EXISTS "Owner update users" ON users;
CREATE POLICY "Owner update users"
  ON users FOR UPDATE
  TO authenticated
  USING (public.user_role() = 'owner' AND org_id = public.user_org_id());

DROP POLICY IF EXISTS "Owner delete users" ON users;
CREATE POLICY "Owner delete users"
  ON users FOR DELETE
  TO authenticated
  USING (public.user_role() = 'owner' AND org_id = public.user_org_id());

-- ==========================================
-- P0-2: Fix customer_assignments RLS cross-tenant
-- ==========================================
DROP POLICY IF EXISTS "Authenticated can view assignments" ON customer_assignments;
DROP POLICY IF EXISTS "Owner/Manager can manage assignments" ON customer_assignments;

DROP POLICY IF EXISTS "View assignments in org" ON customer_assignments;
CREATE POLICY "View assignments in org"
  ON customer_assignments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM customers c
      WHERE c.id = customer_id AND c.org_id = public.user_org_id()
    )
    OR user_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS "Owner/Manager manage assignments" ON customer_assignments;
CREATE POLICY "Owner/Manager manage assignments"
  ON customer_assignments FOR ALL
  TO authenticated
  USING (public.user_role() IN ('owner', 'manager'));

-- ==========================================
-- P0-3: Server-side approval enforcement via DB function
-- Prevents client-side bypass of approval thresholds
-- ==========================================
CREATE OR REPLACE FUNCTION public.check_order_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text;
  auto_threshold numeric := 20000000;
  manager_threshold numeric := 50000000;
BEGIN
  -- Only check when status changes
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  caller_role := public.user_role();

  -- Validate transitions
  IF OLD.status = 'draft' AND NEW.status NOT IN ('confirmed', 'cancelled') THEN
    RAISE EXCEPTION 'Không thể chuyển từ nháp sang %', NEW.status;
  END IF;
  IF OLD.status = 'confirmed' AND NEW.status NOT IN ('picking', 'cancelled') THEN
    RAISE EXCEPTION 'Không thể chuyển từ đã duyệt sang %', NEW.status;
  END IF;
  IF OLD.status = 'picking' AND NEW.status NOT IN ('delivering', 'cancelled') THEN
    RAISE EXCEPTION 'Không thể chuyển từ đang lấy sang %', NEW.status;
  END IF;
  IF OLD.status = 'delivering' AND NEW.status NOT IN ('delivered') THEN
    RAISE EXCEPTION 'Không thể chuyển từ đang giao sang %', NEW.status;
  END IF;
  IF OLD.status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'Đơn đã hoàn tất/hủy, không thể đổi trạng thái';
  END IF;

  -- Approval check: draft → confirmed
  IF OLD.status = 'draft' AND NEW.status = 'confirmed' THEN
    IF OLD.total >= manager_threshold AND caller_role != 'owner' THEN
      RAISE EXCEPTION 'Đơn >= 50 triệu cần Chủ NPP duyệt';
    END IF;
    IF OLD.total >= auto_threshold AND caller_role NOT IN ('owner', 'manager') THEN
      RAISE EXCEPTION 'Đơn >= 20 triệu cần Quản lý hoặc Chủ NPP duyệt';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_order_status ON sales_orders;
CREATE TRIGGER trg_check_order_status
  BEFORE UPDATE OF status ON sales_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.check_order_status_transition();

-- ==========================================
-- P1-5: Order status history (audit log)
-- ==========================================
CREATE TABLE IF NOT EXISTS order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  from_status text NOT NULL,
  to_status text NOT NULL,
  changed_by uuid REFERENCES users(id),
  changed_at timestamptz DEFAULT now(),
  notes text
);
CREATE INDEX idx_order_history_order ON order_status_history(order_id);

-- Trigger to auto-log status changes
CREATE OR REPLACE FUNCTION public.log_order_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO order_status_history (order_id, from_status, to_status, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, (SELECT auth.uid()));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_order_status ON sales_orders;
CREATE TRIGGER trg_log_order_status
  AFTER UPDATE OF status ON sales_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.log_order_status_change();

-- RLS for history
ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "View order history" ON order_status_history;
CREATE POLICY "View order history" ON order_status_history FOR SELECT
  TO authenticated USING (true);

GRANT SELECT ON order_status_history TO authenticated;

-- ==========================================
-- P1-8: Auto-create stock_entry on return approval
-- ==========================================
CREATE OR REPLACE FUNCTION public.auto_restock_on_return()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry_id uuid;
  v_entry_code text;
BEGIN
  -- Only when status changes to 'completed'
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status != 'completed' THEN
    RETURN NEW;
  END IF;

  -- Generate entry code
  v_entry_code := 'RTN-' || to_char(now(), 'YYYYMMDD') || '-' || floor(random()*9000+1000)::text;

  -- Create stock_entry type='import' for returned goods
  INSERT INTO stock_entries (org_id, entry_code, type, created_by, notes)
  VALUES (NEW.org_id, v_entry_code, 'import', (SELECT auth.uid()), 'Nhập trả hàng từ phiếu trả #' || NEW.id)
  RETURNING id INTO v_entry_id;

  -- Create stock_entry_lines from return_lines
  INSERT INTO stock_entry_lines (entry_id, product_id, unit_name, quantity, notes)
  SELECT v_entry_id, rl.product_id, rl.unit_name, rl.quantity, 'Trả hàng'
  FROM return_lines rl
  WHERE rl.return_id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_restock_return ON returns;
CREATE TRIGGER trg_auto_restock_return
  AFTER UPDATE OF status ON returns
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_restock_on_return();

-- ==========================================
-- P1-9: Add org_id to commission_wallets
-- ==========================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'commission_wallets' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE commission_wallets ADD COLUMN org_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
    UPDATE commission_wallets SET org_id = (
      SELECT u.org_id FROM users u WHERE u.id = commission_wallets.user_id
    );
  END IF;
END $$;


-- ####################################################################
-- # 009_business_flow_p1.sql
-- ####################################################################

-- Migration 009: P1 Business Flow - Cash reconciliation, PJP, delivery split
-- Must run AFTER migration 008

-- ==========================================
-- P1-7: Cash Collections & End-of-day reconciliation
-- ==========================================
CREATE TABLE cash_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES users(id),
  work_date date NOT NULL DEFAULT CURRENT_DATE,
  -- Amounts
  total_collected numeric DEFAULT 0,
  total_submitted numeric DEFAULT 0,
  discrepancy numeric GENERATED ALWAYS AS (total_collected - total_submitted) STORED,
  -- Verification
  verified_by uuid REFERENCES users(id),
  verified_at timestamptz,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'verified', 'discrepancy')),
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(driver_id, work_date)
);
CREATE INDEX idx_cash_collections_org ON cash_collections(org_id);
CREATE INDEX idx_cash_collections_driver ON cash_collections(driver_id, work_date);

ALTER TABLE cash_collections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "View cash collections" ON cash_collections;
CREATE POLICY "View cash collections" ON cash_collections FOR SELECT
  TO authenticated USING (
    org_id = public.user_org_id() AND (
      driver_id = (SELECT auth.uid())
      OR public.user_role() IN ('owner', 'manager', 'accountant')
    )
  );
DROP POLICY IF EXISTS "Driver submit cash" ON cash_collections;
CREATE POLICY "Driver submit cash" ON cash_collections FOR INSERT
  TO authenticated WITH CHECK (
    org_id = public.user_org_id()
    AND driver_id = (SELECT auth.uid())
    AND public.user_role() = 'driver'
  );
DROP POLICY IF EXISTS "Accountant verify cash" ON cash_collections;
CREATE POLICY "Accountant verify cash" ON cash_collections FOR UPDATE
  TO authenticated USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'accountant')
  );
GRANT SELECT ON cash_collections TO authenticated;

-- ==========================================
-- P1-11: Per-stop payment on delivery_lines
-- ==========================================
ALTER TABLE delivery_lines ADD COLUMN IF NOT EXISTS payment_method text
  CHECK (payment_method IN ('cod_cash', 'cod_transfer', 'credit', 'partial'));
ALTER TABLE delivery_lines ADD COLUMN IF NOT EXISTS amount_collected numeric DEFAULT 0;

-- ==========================================
-- P1-10: PJP (Permanent Journey Plan) + Visit tracking
-- ==========================================
CREATE TABLE pjp_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sales_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  visit_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(sales_user_id, day_of_week, customer_id)
);
CREATE INDEX idx_pjp_routes_user ON pjp_routes(sales_user_id, day_of_week);

CREATE TABLE visit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sales_user_id uuid NOT NULL REFERENCES users(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  visit_date date NOT NULL DEFAULT CURRENT_DATE,
  check_in_at timestamptz,
  check_out_at timestamptz,
  check_in_lat numeric,
  check_in_lng numeric,
  result text CHECK (result IN ('order_placed', 'no_order', 'closed', 'not_visited')),
  order_id uuid REFERENCES sales_orders(id),
  notes text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_visit_logs_user ON visit_logs(sales_user_id, visit_date);
CREATE INDEX idx_visit_logs_customer ON visit_logs(customer_id, visit_date);

-- RLS for PJP
ALTER TABLE pjp_routes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "View own PJP" ON pjp_routes;
CREATE POLICY "View own PJP" ON pjp_routes FOR SELECT
  TO authenticated USING (
    org_id = public.user_org_id() AND (
      sales_user_id = (SELECT auth.uid())
      OR public.user_role() IN ('owner', 'manager')
    )
  );
DROP POLICY IF EXISTS "Manager manage PJP" ON pjp_routes;
CREATE POLICY "Manager manage PJP" ON pjp_routes FOR ALL
  TO authenticated USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  );

-- RLS for visit logs
ALTER TABLE visit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "View visits" ON visit_logs;
CREATE POLICY "View visits" ON visit_logs FOR SELECT
  TO authenticated USING (
    org_id = public.user_org_id() AND (
      sales_user_id = (SELECT auth.uid())
      OR public.user_role() IN ('owner', 'manager')
    )
  );
DROP POLICY IF EXISTS "Sales log visits" ON visit_logs;
CREATE POLICY "Sales log visits" ON visit_logs FOR INSERT
  TO authenticated WITH CHECK (
    org_id = public.user_org_id()
    AND sales_user_id = (SELECT auth.uid())
  );
DROP POLICY IF EXISTS "Sales update own visits" ON visit_logs;
CREATE POLICY "Sales update own visits" ON visit_logs FOR UPDATE
  TO authenticated USING (
    sales_user_id = (SELECT auth.uid())
  );

GRANT SELECT ON pjp_routes TO authenticated;
GRANT SELECT ON visit_logs TO authenticated;
GRANT SELECT ON cash_collections TO authenticated;

-- ==========================================
-- P1-6: Warehouse→Driver handoff confirmation
-- ==========================================
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS warehouse_confirmed_by uuid REFERENCES users(id);
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS warehouse_confirmed_at timestamptz;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS driver_confirmed_by uuid REFERENCES users(id);
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS driver_confirmed_at timestamptz;


-- ####################################################################
-- # 010_supplier_payables.sql
-- ####################################################################

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

DROP POLICY IF EXISTS "View payables" ON payables;
CREATE POLICY "View payables" ON payables FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());
DROP POLICY IF EXISTS "Manage payables" ON payables;
CREATE POLICY "Manage payables" ON payables FOR ALL TO authenticated
  USING (public.user_role() IN ('owner', 'accountant'));

DROP POLICY IF EXISTS "View payable payments" ON payable_payments;
CREATE POLICY "View payable payments" ON payable_payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM payables p WHERE p.id = payable_id AND p.org_id = public.user_org_id()));
DROP POLICY IF EXISTS "Manage payable payments" ON payable_payments;
CREATE POLICY "Manage payable payments" ON payable_payments FOR ALL TO authenticated
  USING (public.user_role() IN ('owner', 'accountant'));

GRANT SELECT ON payables TO authenticated;
GRANT SELECT ON payable_payments TO authenticated;


-- ####################################################################
-- # 011_misa_invoice.sql
-- ####################################################################

-- Customer billing fields for VAT invoice
ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_name text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tax_code text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_address text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_email text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_method_label text DEFAULT 'Chuyển khoản';

-- Invoice MISA integration fields
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS misa_invoice_id text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS misa_invoice_url text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS misa_status text CHECK (misa_status IN ('pending','sent','signed','error'));
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS misa_error text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS misa_sent_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS misa_signed_at timestamptz;


-- ####################################################################
-- # 012_purchase_orders.sql
-- ####################################################################

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

DROP POLICY IF EXISTS "View POs" ON purchase_orders;
CREATE POLICY "View POs" ON purchase_orders FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());
DROP POLICY IF EXISTS "Manage POs" ON purchase_orders;
CREATE POLICY "Manage POs" ON purchase_orders FOR ALL TO authenticated
  USING (public.user_role() IN ('owner', 'manager', 'warehouse'));

DROP POLICY IF EXISTS "View PO lines" ON purchase_order_lines;
CREATE POLICY "View PO lines" ON purchase_order_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = po_id AND po.org_id = public.user_org_id()));
DROP POLICY IF EXISTS "Manage PO lines" ON purchase_order_lines;
CREATE POLICY "Manage PO lines" ON purchase_order_lines FOR ALL TO authenticated
  USING (public.user_role() IN ('owner', 'manager', 'warehouse'));

DROP POLICY IF EXISTS "View purchase invoices" ON purchase_invoices;
CREATE POLICY "View purchase invoices" ON purchase_invoices FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());
DROP POLICY IF EXISTS "Manage purchase invoices" ON purchase_invoices;
CREATE POLICY "Manage purchase invoices" ON purchase_invoices FOR ALL TO authenticated
  USING (public.user_role() IN ('owner', 'accountant'));

GRANT SELECT ON purchase_orders TO authenticated;
GRANT SELECT ON purchase_order_lines TO authenticated;
GRANT SELECT ON purchase_invoices TO authenticated;


-- ####################################################################
-- # 013_approval_rules.sql
-- ####################################################################

-- =====================================================================
-- Migration 013: Auto-approval rules for sales orders
-- =====================================================================
-- Replaces the hardcoded APPROVAL_THRESHOLDS constants with org-scoped
-- configurable rules that factor in: order value, customer debt,
-- customer overdue debt, sales rep portfolio debt.
-- Adds approval_reason to sales_orders so pending orders can surface
-- WHY they were not auto-approved.

CREATE TABLE IF NOT EXISTS approval_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Auto-approve when order total is strictly less than this
  auto_approve_max numeric NOT NULL DEFAULT 20000000,

  -- Manager role can approve up to this amount (orders above need owner)
  manager_approve_max numeric NOT NULL DEFAULT 50000000,

  -- Block auto-approve if outstanding debt of this customer exceeds this
  -- (0 = disabled)
  customer_debt_max numeric NOT NULL DEFAULT 0,

  -- Block auto-approve if overdue debt of this customer exceeds this
  -- (0 = disabled)
  customer_overdue_max numeric NOT NULL DEFAULT 0,

  -- Block auto-approve if the sales rep's managed portfolio debt exceeds this
  -- (0 = disabled)
  rep_portfolio_debt_max numeric NOT NULL DEFAULT 0,

  -- If customer's credit_limit > 0 and current debt + this order would exceed
  -- it, require approval. Always on when credit_limit is set.
  enforce_credit_limit boolean NOT NULL DEFAULT true,

  -- Freeform note visible in settings UI
  notes text,

  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- One active rule set per org
  UNIQUE (org_id)
);

CREATE INDEX IF NOT EXISTS idx_approval_rules_org ON approval_rules(org_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION approval_rules_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_approval_rules_touch ON approval_rules;
CREATE TRIGGER trg_approval_rules_touch
  BEFORE UPDATE ON approval_rules
  FOR EACH ROW EXECUTE FUNCTION approval_rules_touch();

-- RLS: only owner/manager can read/write rules
ALTER TABLE approval_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "approval_rules_select" ON approval_rules;
CREATE POLICY "approval_rules_select" ON approval_rules
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  );

DROP POLICY IF EXISTS "approval_rules_insert" ON approval_rules;
CREATE POLICY "approval_rules_insert" ON approval_rules
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  );

DROP POLICY IF EXISTS "approval_rules_update" ON approval_rules;
CREATE POLICY "approval_rules_update" ON approval_rules
  FOR UPDATE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  );

GRANT SELECT, INSERT, UPDATE ON approval_rules TO authenticated;

-- Seed a default rule row for every existing organization
INSERT INTO approval_rules (org_id)
SELECT id FROM organizations
ON CONFLICT (org_id) DO NOTHING;

-- =====================================================================
-- sales_orders: approval_reason
-- =====================================================================
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS approval_reason text;

COMMENT ON COLUMN sales_orders.approval_reason IS
  'Why this order is pending manual approval (e.g. value exceeds threshold, customer debt over limit).';


-- ####################################################################
-- # 014_visit_photos.sql
-- ####################################################################

-- =====================================================================
-- Migration 014: Visit photos + extended result codes
-- =====================================================================
-- Extends visit_logs so check-in can attach a photo and a free-text note.
-- Photos are stored in the Supabase Storage bucket `visit-photos`.

ALTER TABLE visit_logs
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS check_in_address text;

-- Storage bucket for visit photos (idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('visit-photos', 'visit-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: any authenticated user of the org can upload to their
-- own folder (<org_id>/...); anyone authenticated can read (bucket is public
-- for simple CDN delivery but we still restrict writes via RLS).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'visit_photos_insert'
  ) THEN
    CREATE POLICY "visit_photos_insert" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'visit-photos'
        AND (split_part(name, '/', 1))::uuid = public.user_org_id()
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'visit_photos_select'
  ) THEN
    CREATE POLICY "visit_photos_select" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'visit-photos');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'visit_photos_delete'
  ) THEN
    CREATE POLICY "visit_photos_delete" ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id = 'visit-photos'
        AND (split_part(name, '/', 1))::uuid = public.user_org_id()
      );
  END IF;
END $$;


-- ####################################################################
-- # 015_notifications.sql
-- ####################################################################

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

DROP POLICY IF EXISTS "notifications_select_own" ON notifications;
CREATE POLICY "notifications_select_own" ON notifications
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Any authenticated user in the org can create notifications for other
-- users in the same org (they can't forge notifications for other orgs).
DROP POLICY IF EXISTS "notifications_insert_org" ON notifications;
CREATE POLICY "notifications_insert_org" ON notifications
  FOR INSERT TO authenticated
  WITH CHECK (org_id = public.user_org_id());

-- Users can update (mark read) their own notifications
DROP POLICY IF EXISTS "notifications_update_own" ON notifications;
CREATE POLICY "notifications_update_own" ON notifications
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Users can delete their own notifications
DROP POLICY IF EXISTS "notifications_delete_own" ON notifications;
CREATE POLICY "notifications_delete_own" ON notifications
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO authenticated;


-- ####################################################################
-- # 016_inventory_costs_expenses.sql
-- ####################################################################

-- =====================================================================
-- Migration 016: Inventory cost tracking + expenses
-- =====================================================================
-- Enables:
--   1. Draft vs posted stock entries (needed to show "pending" stock)
--   2. Cost tracking on each stock line + weighted-avg cost per batch
--   3. General expenses (overhead) for the finance reports
--   4. Stocktake differences posted as an expense

-- ---------------------------------------------------------------------
-- 1. Stock entries status
-- ---------------------------------------------------------------------
-- 'draft'  : created but not yet affecting on-hand; visible as "pending"
-- 'posted' : committed, has already moved batches.qty_on_hand
-- Existing rows are treated as 'posted' (default).

ALTER TABLE stock_entries
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'posted'
    CHECK (status IN ('draft', 'posted', 'cancelled'));

ALTER TABLE stock_entries
  ADD COLUMN IF NOT EXISTS posted_at timestamptz;

-- Backfill posted_at for historical rows so reports can order correctly.
UPDATE stock_entries
SET posted_at = COALESCE(posted_at, created_at)
WHERE status = 'posted' AND posted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_stock_entries_status_type
  ON stock_entries(status, type, created_at DESC);

-- ---------------------------------------------------------------------
-- 2. Line-level cost tracking
-- ---------------------------------------------------------------------
-- For imports: unit_cost is the purchase cost we paid per base unit.
-- For exports: unit_cost mirrors the batch's weighted cost at export time
-- (captured so COGS is deterministic even if later imports change avg cost).

ALTER TABLE stock_entry_lines
  ADD COLUMN IF NOT EXISTS unit_cost numeric NOT NULL DEFAULT 0;

-- Batch weighted-average cost (in the base unit). Computed from imports;
-- kept on the row so queries don't need a subquery every time.
ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS unit_cost numeric NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------
-- 3. Expenses (general operating overhead)
-- ---------------------------------------------------------------------
-- A simple expense ledger: rent, utilities, marketing, stocktake loss, etc.
-- Used by the P&L and cash flow reports.

CREATE TABLE IF NOT EXISTS expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  -- Accounting bucket for the report
  bucket text NOT NULL DEFAULT 'operating'
    CHECK (bucket IN ('cogs', 'operating', 'hr', 'financial', 'tax', 'other')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(org_id, code)
);

CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category_id uuid REFERENCES expense_categories(id),
  -- Event date this expense belongs to (for report periods)
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL CHECK (amount >= 0),
  description text,
  -- Free-form reference (invoice number, receipt number, stocktake entry id...)
  reference_code text,
  -- For traceability when generated from other modules (e.g. stocktake loss)
  source_type text,
  source_id uuid,
  -- If the expense has been paid (affects cash flow statement)
  is_paid boolean NOT NULL DEFAULT false,
  paid_at timestamptz,
  payment_method text CHECK (payment_method IN ('cash', 'transfer', 'ewallet')),

  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_org_date
  ON expenses(org_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category
  ON expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_source
  ON expenses(source_type, source_id);

-- Touch trigger for expenses.updated_at
CREATE OR REPLACE FUNCTION expenses_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_expenses_touch ON expenses;
CREATE TRIGGER trg_expenses_touch
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION expenses_touch();

-- RLS
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "expense_categories_all" ON expense_categories;
CREATE POLICY "expense_categories_all" ON expense_categories
  FOR ALL TO authenticated
  USING (org_id = public.user_org_id())
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  );

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "expenses_select" ON expenses;
CREATE POLICY "expenses_select" ON expenses
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  );

DROP POLICY IF EXISTS "expenses_insert" ON expenses;
CREATE POLICY "expenses_insert" ON expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  );

DROP POLICY IF EXISTS "expenses_update" ON expenses;
CREATE POLICY "expenses_update" ON expenses
  FOR UPDATE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  );

DROP POLICY IF EXISTS "expenses_delete" ON expenses;
CREATE POLICY "expenses_delete" ON expenses
  FOR DELETE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON expense_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON expenses TO authenticated;

-- Seed default expense categories for every org
INSERT INTO expense_categories (org_id, code, name, bucket)
SELECT id, 'COGS_ADJ', 'Điều chỉnh kiểm kê (giá vốn)', 'cogs' FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO expense_categories (org_id, code, name, bucket)
SELECT id, 'RENT', 'Tiền thuê mặt bằng', 'operating' FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO expense_categories (org_id, code, name, bucket)
SELECT id, 'UTIL', 'Điện nước', 'operating' FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO expense_categories (org_id, code, name, bucket)
SELECT id, 'FUEL', 'Xăng xe / vận chuyển', 'operating' FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO expense_categories (org_id, code, name, bucket)
SELECT id, 'MKT', 'Marketing / khuyến mãi', 'operating' FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO expense_categories (org_id, code, name, bucket)
SELECT id, 'SALARY', 'Lương', 'hr' FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO expense_categories (org_id, code, name, bucket)
SELECT id, 'TAX', 'Thuế', 'tax' FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO expense_categories (org_id, code, name, bucket)
SELECT id, 'OTHER', 'Chi phí khác', 'other' FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;


-- ####################################################################
-- # 017_stock_entries_order_link.sql
-- ####################################################################

-- =====================================================================
-- Migration 017: Link stock entries to source orders
-- =====================================================================
-- When a stock-out entry fulfils one or more sales orders (e.g. the
-- "merge and pick" flow), record the order ids so the order detail page
-- can display a stock history tab. Legacy entries stay empty.

ALTER TABLE stock_entries
  ADD COLUMN IF NOT EXISTS ref_order_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

-- GIN index so "contains this order id" queries stay fast
CREATE INDEX IF NOT EXISTS idx_stock_entries_ref_orders
  ON stock_entries USING gin (ref_order_ids);

COMMENT ON COLUMN stock_entries.ref_order_ids IS
  'Array of sales_orders.id the entry was created for (stock-out / picking). Empty for imports.';


-- ####################################################################
-- # 018_sales_routes.sql
-- ####################################################################

-- =====================================================================
-- Migration 018: Sales routes (tuyến bán hàng)
-- =====================================================================
-- Replaces the free-form customers.channel text with a proper lookup
-- table the distributor can CRUD. We keep customers.channel as a text
-- column that stores the route's `code` so existing rows still work
-- and reports that group by channel keep running.

CREATE TABLE IF NOT EXISTS sales_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Short code shown on cards (GT, MT, HORECA, TUYEN1, …)
  code text NOT NULL,
  -- Longer human label
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (org_id, code)
);

CREATE INDEX IF NOT EXISTS idx_sales_routes_org ON sales_routes(org_id, is_active);

CREATE OR REPLACE FUNCTION sales_routes_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_routes_touch ON sales_routes;
CREATE TRIGGER trg_sales_routes_touch
  BEFORE UPDATE ON sales_routes
  FOR EACH ROW EXECUTE FUNCTION sales_routes_touch();

-- RLS
ALTER TABLE sales_routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_routes_select" ON sales_routes;
CREATE POLICY "sales_routes_select" ON sales_routes
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS "sales_routes_insert" ON sales_routes;
CREATE POLICY "sales_routes_insert" ON sales_routes
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  );

DROP POLICY IF EXISTS "sales_routes_update" ON sales_routes;
CREATE POLICY "sales_routes_update" ON sales_routes
  FOR UPDATE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  );

DROP POLICY IF EXISTS "sales_routes_delete" ON sales_routes;
CREATE POLICY "sales_routes_delete" ON sales_routes
  FOR DELETE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON sales_routes TO authenticated;

-- Seed default routes for every existing org so the dropdown on /customers
-- and the filter on /inventory/pending are populated out of the box.
INSERT INTO sales_routes (org_id, code, name, sort_order)
SELECT id, 'GT', 'General Trade', 1 FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO sales_routes (org_id, code, name, sort_order)
SELECT id, 'MT', 'Modern Trade', 2 FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO sales_routes (org_id, code, name, sort_order)
SELECT id, 'HORECA', 'Khách sạn / Nhà hàng', 3 FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;


-- ####################################################################
-- # 019_delivery_settlement.sql
-- ####################################################################

-- =====================================================================
-- Migration 019: Delivery settlement (quyết toán chuyến giao)
-- =====================================================================
-- Adds two columns to deliveries so the warehouse can record the cash
-- amount the driver returned and the timestamp of the settlement. The
-- settle screen (/deliveries/[id]/settle) writes these after the driver
-- finishes a route.

ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_amount numeric(15, 2);


-- ####################################################################
-- # 020_cash_receipts.sql
-- ####################################################################

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

DROP POLICY IF EXISTS "cash_receipts_select" ON cash_receipts;
CREATE POLICY "cash_receipts_select" ON cash_receipts
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS "cash_receipts_insert" ON cash_receipts;
CREATE POLICY "cash_receipts_insert" ON cash_receipts
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant', 'warehouse', 'driver')
  );

DROP POLICY IF EXISTS "cash_receipts_update" ON cash_receipts;
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

DROP POLICY IF EXISTS "cash_receipts_delete" ON cash_receipts;
CREATE POLICY "cash_receipts_delete" ON cash_receipts
  FOR DELETE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  );

-- Lines inherit access via parent (cascade delete handles cleanup)
DROP POLICY IF EXISTS "cash_receipt_lines_select" ON cash_receipt_lines;
CREATE POLICY "cash_receipt_lines_select" ON cash_receipt_lines
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM cash_receipts r
    WHERE r.id = cash_receipt_lines.receipt_id
      AND r.org_id = public.user_org_id()
  ));

DROP POLICY IF EXISTS "cash_receipt_lines_insert" ON cash_receipt_lines;
CREATE POLICY "cash_receipt_lines_insert" ON cash_receipt_lines
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM cash_receipts r
    WHERE r.id = cash_receipt_lines.receipt_id
      AND r.org_id = public.user_org_id()
  ));

DROP POLICY IF EXISTS "cash_receipt_lines_update" ON cash_receipt_lines;
CREATE POLICY "cash_receipt_lines_update" ON cash_receipt_lines
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM cash_receipts r
    WHERE r.id = cash_receipt_lines.receipt_id
      AND r.org_id = public.user_org_id()
      AND public.user_role() IN ('owner', 'manager', 'accountant')
  ));

DROP POLICY IF EXISTS "cash_receipt_lines_delete" ON cash_receipt_lines;
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


-- ####################################################################
-- # 021_pricing_rules.sql
-- ####################################################################

-- =====================================================================
-- Migration 021: Pricing rules (cài đặt giá cho nhân viên)
-- =====================================================================
-- Single row per org. Owner/manager toggles whether sales reps can
-- override the unit price on order/return lines, and how far they can
-- deviate from the default price-list value.
--
-- Sale order:    rep may LOWER price; min = default - max(sale_min_pct, sale_min_value)
-- Return order:  rep may RAISE price; max = default + max(return_max_pct, return_max_value)
--
-- A NULL/0 limit means "no override allowed in that direction" so the
-- default rules are conservative (no override at all).

CREATE TABLE IF NOT EXISTS pricing_rules (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  -- Master switch: when false, sales reps can't edit price at all
  allow_sales_override boolean NOT NULL DEFAULT false,
  -- Sale-order rule: cap the discount the rep can give
  sale_min_pct numeric(5, 2) NOT NULL DEFAULT 0,    -- 0..100, % off default
  sale_min_value numeric(15, 2) NOT NULL DEFAULT 0, -- absolute đ off default
  -- Return-order rule: cap the markup the rep can apply
  return_max_pct numeric(5, 2) NOT NULL DEFAULT 0,    -- 0..100, % above default
  return_max_value numeric(15, 2) NOT NULL DEFAULT 0, -- absolute đ above default
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id)
);

CREATE OR REPLACE FUNCTION pricing_rules_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pricing_rules_touch ON pricing_rules;
CREATE TRIGGER trg_pricing_rules_touch
  BEFORE UPDATE ON pricing_rules
  FOR EACH ROW EXECUTE FUNCTION pricing_rules_touch();

ALTER TABLE pricing_rules ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read (so the order form can validate input)
DROP POLICY IF EXISTS "pricing_rules_select" ON pricing_rules;
CREATE POLICY "pricing_rules_select" ON pricing_rules
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS "pricing_rules_insert" ON pricing_rules;
CREATE POLICY "pricing_rules_insert" ON pricing_rules
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  );

DROP POLICY IF EXISTS "pricing_rules_update" ON pricing_rules;
CREATE POLICY "pricing_rules_update" ON pricing_rules
  FOR UPDATE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  );

GRANT SELECT, INSERT, UPDATE ON pricing_rules TO authenticated;

-- Seed an empty rule for every existing org so the order form's
-- "fetch single row" never returns null.
INSERT INTO pricing_rules (org_id)
SELECT id FROM organizations
ON CONFLICT (org_id) DO NOTHING;


-- ####################################################################
-- # 022_role_permissions.sql
-- ####################################################################

-- ====================================================================
-- 022_role_permissions
--
-- Detailed role-based access control. Each org can override the static
-- permission matrix per (role, module, action). When a row is missing
-- the client falls back to the built-in DEFAULT_PERMISSION_MAP, so this
-- migration is purely additive — existing orgs keep working unchanged.
-- ====================================================================

CREATE TABLE IF NOT EXISTS role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','manager','accountant','sales','warehouse','driver')),
  module text NOT NULL CHECK (module IN (
    'orders','customers','inventory','products','commissions',
    'receivables','deliveries','promotions','invoices','returns',
    'reports','settings'
  )),
  action text NOT NULL CHECK (action IN ('read','create','update','delete','approve','export')),
  allowed boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, role, module, action)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_org_role
  ON role_permissions(org_id, role);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- Every org member can read so the client can enforce UI visibility.
DROP POLICY IF EXISTS "role_permissions_select" ON role_permissions;
CREATE POLICY "role_permissions_select" ON role_permissions
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());

-- Only owners can mutate the matrix.
DROP POLICY IF EXISTS "role_permissions_owner_write" ON role_permissions;
CREATE POLICY "role_permissions_owner_write" ON role_permissions
  FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() = 'owner')
  WITH CHECK (org_id = public.user_org_id() AND public.user_role() = 'owner');

-- Auto-bump updated_at on UPDATE.
CREATE OR REPLACE FUNCTION public.touch_role_permissions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_role_permissions_touch ON role_permissions;
CREATE TRIGGER trg_role_permissions_touch
  BEFORE UPDATE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_role_permissions_updated_at();

COMMENT ON TABLE role_permissions IS
  'Per-org overrides for the role-based permission matrix. Missing rows fall back to DEFAULT_PERMISSION_MAP in src/lib/permissions.ts.';


-- ####################################################################
-- # 023_products_extras.sql
-- ####################################################################

-- ====================================================================
-- 023_products_extras
--
-- Adds the extra fields needed for the KiotViet-style product editor:
-- description, warranty info, cost/sell price, serial tracking, stock
-- thresholds, shelf location, weight, "direct sale" toggle, and an
-- image gallery (URLs in jsonb so the column doesn't bloat).
-- ====================================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS warranty_info text,
  ADD COLUMN IF NOT EXISTS cost_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sell_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS track_serial boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_stock numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_stock numeric,
  ADD COLUMN IF NOT EXISTS shelf_location text,
  ADD COLUMN IF NOT EXISTS weight numeric,
  ADD COLUMN IF NOT EXISTS weight_unit text NOT NULL DEFAULT 'g',
  ADD COLUMN IF NOT EXISTS direct_sale boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN products.cost_price IS 'Giá vốn mặc định (đồng).';
COMMENT ON COLUMN products.sell_price IS 'Giá bán mặc định (đồng).';
COMMENT ON COLUMN products.min_stock IS 'Định mức tồn thấp nhất - cảnh báo khi xuống dưới.';
COMMENT ON COLUMN products.max_stock IS 'Định mức tồn cao nhất - cảnh báo khi vượt qua.';
COMMENT ON COLUMN products.weight IS 'Trọng lượng (theo weight_unit).';
COMMENT ON COLUMN products.direct_sale IS 'Cho phép bán trực tiếp tại cửa hàng / quầy.';
COMMENT ON COLUMN products.images IS 'Mảng URL ảnh sản phẩm.';


-- ####################################################################
-- # 024_permissions_features.sql
-- ####################################################################

-- ====================================================================
-- 024_permissions_features
--
-- Loosens role_permissions.module so it can hold either a module name
-- ("orders", "customers", …) OR a finer-grained feature key
-- ("customers.analytics", "purchasing.invoices", …). The default
-- permission map in src/lib/permissions.ts still uses module-level
-- entries, but the UI can now grant or revoke individual menu items.
-- ====================================================================

ALTER TABLE role_permissions
  DROP CONSTRAINT IF EXISTS role_permissions_module_check;

-- Replace with a much looser shape check so we still reject obviously
-- bad data without enumerating every feature. Format: lowercase ascii
-- words separated by dots, max 64 chars.
--
-- LƯU Ý: dùng MỘT dấu gạch chéo ( \. ) cho dấu chấm. Postgres mặc định
-- standard_conforming_strings = on nên \ trong '...' là ký tự literal;
-- viết \\. sẽ thành "backslash + ký tự bất kỳ" và chặn nhầm mọi khoá
-- tính năng có dấu chấm (xem migration 090 đã sửa lỗi này).
ALTER TABLE role_permissions
  ADD CONSTRAINT role_permissions_module_check
  CHECK (
    char_length(module) BETWEEN 1 AND 64
    AND module ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'
  );

COMMENT ON COLUMN role_permissions.module IS
  'Feature or module key. Module-level keys ("orders") cover an entire menu group; feature keys ("customers.analytics") override a specific menu item.';


-- ####################################################################
-- # 025_products_price_edit.sql
-- ####################################################################

-- ====================================================================
-- 025_products_price_edit
--
-- Per-product override for sales-rep price editing. The org-level
-- pricing_rules table (migration 021) already controls a master switch
-- and a global discount cap; this migration lets distributors loosen or
-- tighten that on a per-SKU basis.
--
-- Quy tắc nghiệp vụ (enforced ở UI khi tạo/sửa đơn):
--   - allow_price_edit = false  → giá đơn = sell_price, NV không sửa được.
--   - allow_price_edit = true   → NV được nhập giá khác, nhưng bị cap:
--       * Đơn bán: giá ≥ sell_price, lệch ≤ price_edit_max
--                  (nếu max_type='percent', so với sell_price)
--       * Đơn trả: giá ≤ sell_price, lệch ≤ price_edit_max (chiều âm)
-- ====================================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS allow_price_edit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_edit_max_type text
    NOT NULL DEFAULT 'percent'
    CHECK (price_edit_max_type IN ('percent', 'value')),
  ADD COLUMN IF NOT EXISTS price_edit_max numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN products.allow_price_edit IS
  'Cho phép nhân viên sửa giá khi tạo đơn cho SKU này.';
COMMENT ON COLUMN products.price_edit_max_type IS
  'Đơn vị của trần điều chỉnh: ''percent'' (%) hoặc ''value'' (VND).';
COMMENT ON COLUMN products.price_edit_max IS
  'Trần được phép sửa: % giá bán hoặc giá trị tuyệt đối tùy max_type.';


-- ####################################################################
-- # 026_salary_bypass_attendance.sql
-- ####################################################################

-- ====================================================================
-- 026_salary_bypass_attendance
--
-- Update #2 v2 — Section 2.4. NV Bán hàng được đo bằng kết quả (đơn,
-- doanh số, KPI), không đo bằng có mặt. Khi tính lương, không nhân hệ
-- số ngày công cho các role được liệt kê trong cột mới.
-- ====================================================================

ALTER TABLE hr_salary_config
  ADD COLUMN IF NOT EXISTS bypass_attendance_roles jsonb
    NOT NULL DEFAULT '["sales"]'::jsonb;

COMMENT ON COLUMN hr_salary_config.bypass_attendance_roles IS
  'Mảng JSON role name (vd. ["sales","manager"]) sẽ bỏ qua chấm công khi tính lương — lương = base + thưởng, không nhân hệ số ngày công.';

-- Backfill: nếu org đã có config cũ với bypass_attendance_roles=null
-- thì gán sales (mặc định an toàn). NOT NULL DEFAULT phía trên đã
-- handle nhưng giữ thêm tầng dữ liệu cho rõ.
UPDATE hr_salary_config
SET bypass_attendance_roles = '["sales"]'::jsonb
WHERE bypass_attendance_roles IS NULL OR jsonb_array_length(bypass_attendance_roles) = 0;


-- ####################################################################
-- # 027_user_price_edit.sql
-- ####################################################################

-- ====================================================================
-- 027_user_price_edit
--
-- Update #2 v2 — Section 4.6. Quyền sửa giá là per-user (lưu trên
-- bảng users) thay vì per-product (migration 025) hoặc per-org
-- (pricing_rules — migration 021).
--
-- 3 ràng buộc khi NV sửa giá:
--   1) Đơn bán: giá ≥ giá list (không bán dưới list).
--   2) Đơn bán: giá ≤ giá list × (1 + max_increase_pct/100).
--   3) Đơn trả: giá ≤ giá đã bán trong đơn gốc tham chiếu (fallback
--      về giá list nếu không có đơn gốc).
-- ====================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS allow_price_edit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_edit_max_increase_pct numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN users.allow_price_edit IS
  'Cho phép user này sửa giá khi tạo / sửa đơn (sales hoặc warehouse khi sửa đơn ở bước xuất).';
COMMENT ON COLUMN users.price_edit_max_increase_pct IS
  'Ngưỡng % tăng giá tối đa so với giá list. VD 10 = giá tối đa = list × 1.10. Chỉ có hiệu lực khi allow_price_edit=true.';

-- Owner và accountant mặc định có quyền free (đặt allow_price_edit=true,
-- không giới hạn % trên — UI bỏ qua check). Sales và warehouse mặc định
-- false; Chủ NPP có thể bật lại trong form Tạo/Sửa NV.
UPDATE users SET allow_price_edit = true
WHERE role IN ('owner', 'accountant');


-- ####################################################################
-- # 028_warehouse_zones.sql
-- ####################################################################

-- ====================================================================
-- 028_warehouse_zones
--
-- Update #2 v2 §7 — Tách 2 kho hàng:
--   • "sale" — Kho hàng bán (hàng tươi, còn xa hạn)
--   • "date" — Kho hàng date (gần hạn, NV gom lại để bán xả)
--
-- Mỗi batch thuộc đúng 1 zone tại 1 thời điểm. Mặc định batch mới =
-- 'sale'; trigger tự động chuyển sang 'date' khi expires_at - now() ≤
-- threshold (mặc định 30 ngày, lưu trên pricing_rules để admin chỉnh).
--
-- Có thể chuyển zone thủ công khi cần (VD: sale rep gom hàng date sớm
-- để bán xả) — trigger không revert lại.
-- ====================================================================

ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS warehouse_zone text NOT NULL DEFAULT 'sale'
    CHECK (warehouse_zone IN ('sale', 'date')),
  ADD COLUMN IF NOT EXISTS zone_moved_at timestamptz,
  ADD COLUMN IF NOT EXISTS zone_moved_by uuid REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_batches_zone
  ON batches(org_id, warehouse_zone, expires_at);

ALTER TABLE pricing_rules
  ADD COLUMN IF NOT EXISTS date_warehouse_threshold_days integer NOT NULL DEFAULT 30
    CHECK (date_warehouse_threshold_days >= 0 AND date_warehouse_threshold_days <= 365);

COMMENT ON COLUMN pricing_rules.date_warehouse_threshold_days IS
  'Ngưỡng số ngày trước hạn để batch tự chuyển sang kho hàng date.';

COMMENT ON COLUMN batches.warehouse_zone IS
  'Zone của batch: sale (hàng bán bình thường) hoặc date (hàng gần hạn).';

-- ----- Auto-classify trigger ------------------------------------------
-- Dùng pricing_rules.date_warehouse_threshold_days nếu có, fallback 30.
-- Chỉ auto-set khi INSERT (zone chưa được đặt thủ công); trên UPDATE
-- nếu expires_at thay đổi và zone vẫn là 'sale' thì re-evaluate.

CREATE OR REPLACE FUNCTION batches_auto_zone()
RETURNS TRIGGER AS $$
DECLARE
  threshold integer;
BEGIN
  SELECT date_warehouse_threshold_days INTO threshold
  FROM pricing_rules
  WHERE org_id = NEW.org_id;

  IF threshold IS NULL THEN
    threshold := 30;
  END IF;

  -- Nếu trigger không có expires_at thì để default 'sale'
  IF NEW.expires_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Chỉ auto-promote sang 'date'; không bao giờ tự động revert.
  IF NEW.warehouse_zone = 'sale'
     AND NEW.expires_at <= CURRENT_DATE + (threshold || ' days')::interval
  THEN
    NEW.warehouse_zone := 'date';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_batches_auto_zone_ins ON batches;
CREATE TRIGGER trg_batches_auto_zone_ins
  BEFORE INSERT ON batches
  FOR EACH ROW EXECUTE FUNCTION batches_auto_zone();

DROP TRIGGER IF EXISTS trg_batches_auto_zone_upd ON batches;
CREATE TRIGGER trg_batches_auto_zone_upd
  BEFORE UPDATE OF expires_at ON batches
  FOR EACH ROW EXECUTE FUNCTION batches_auto_zone();

-- ----- Bulk re-evaluation function ------------------------------------
-- Owner/manager có thể chạy lại để gom các batch đã quá ngưỡng vào
-- kho date (vd. khi đổi threshold). Trả về số batch chuyển zone.

CREATE OR REPLACE FUNCTION refresh_warehouse_zones(p_org_id uuid)
RETURNS integer AS $$
DECLARE
  threshold integer;
  moved integer;
BEGIN
  SELECT date_warehouse_threshold_days INTO threshold
  FROM pricing_rules
  WHERE org_id = p_org_id;

  IF threshold IS NULL THEN
    threshold := 30;
  END IF;

  WITH updated AS (
    UPDATE batches
    SET warehouse_zone = 'date',
        zone_moved_at = now()
    WHERE org_id = p_org_id
      AND warehouse_zone = 'sale'
      AND expires_at IS NOT NULL
      AND expires_at <= CURRENT_DATE + (threshold || ' days')::interval
      AND qty_on_hand > 0
    RETURNING 1
  )
  SELECT COUNT(*) INTO moved FROM updated;

  RETURN COALESCE(moved, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION refresh_warehouse_zones(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refresh_warehouse_zones(uuid) TO authenticated;

-- ----- Backfill: classify existing batches ----------------------------
SELECT refresh_warehouse_zones(id) FROM organizations;


-- ####################################################################
-- # 029_line_notes.sql
-- ####################################################################

-- ====================================================================
-- 029_line_notes
--
-- Update #2 v2 §4.1 — Ghi chú per-dòng-SP.
--
-- Mỗi dòng đơn bán / đơn trả có 1 trường note để NV ghi yêu cầu cụ
-- thể (vd. "Khách yêu cầu hàng SX sau 03/2025", "Đóng riêng thùng",
-- "Lấy đúng lô A123"...). Hiển thị trên phiếu giao và phiếu xuất kho.
-- ====================================================================

ALTER TABLE sales_order_lines
  ADD COLUMN IF NOT EXISTS note text;

ALTER TABLE return_lines
  ADD COLUMN IF NOT EXISTS note text;

COMMENT ON COLUMN sales_order_lines.note IS
  'Ghi chú riêng cho dòng SP (in trên phiếu giao, phiếu xuất).';
COMMENT ON COLUMN return_lines.note IS
  'Ghi chú riêng cho dòng SP trả (lý do trả, tình trạng...).';


-- ####################################################################
-- # 030_products_supplier.sql
-- ####################################################################

-- ====================================================================
-- 030_products_supplier
--
-- Update #2 v2 §3.2 — Bộ lọc theo NCC trong báo cáo. Để báo cáo lọc
-- được theo NCC (đặc biệt là kho hàng và doanh số sản phẩm), gắn 1
-- NCC chính cho mỗi sản phẩm. Quy tắc: NCC chính là NCC nhập SP về
-- kho lần gần nhất; admin có thể chỉnh tay.
-- ====================================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS primary_supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_supplier
  ON products(org_id, primary_supplier_id)
  WHERE primary_supplier_id IS NOT NULL;

COMMENT ON COLUMN products.primary_supplier_id IS
  'NCC chính của SP (default = NCC nhập gần nhất). Dùng cho báo cáo NCC.';

-- Backfill: set primary_supplier_id from the most recent stock_entry
-- of type=import that brought the product in.
WITH latest_supplier AS (
  SELECT DISTINCT ON (l.product_id)
    l.product_id,
    e.supplier_id,
    e.org_id
  FROM stock_entry_lines l
  JOIN stock_entries e ON e.id = l.entry_id
  WHERE e.type = 'import'
    AND e.supplier_id IS NOT NULL
  ORDER BY l.product_id, e.posted_at DESC NULLS LAST, e.created_at DESC
)
UPDATE products p
SET primary_supplier_id = ls.supplier_id
FROM latest_supplier ls
WHERE ls.product_id = p.id
  AND ls.org_id = p.org_id
  AND p.primary_supplier_id IS NULL;


-- ####################################################################
-- # 031_hr_bonus_extensions.sql
-- ####################################################################

-- ====================================================================
-- 031_hr_bonus_extensions
--
-- Update #2 v2 §2.1 / §2.2 / §2.3 — Mở rộng cơ chế thưởng:
--   §2.1 Thưởng đầu thùng (per-unit bonus): X đồng / 1 thùng SP Y bán
--        ra trong kỳ. Lưu jsonb [{product_id, unit_name, bonus}, …].
--        product_id = null = áp dụng cho mọi SP.
--   §2.2 Thưởng đơn hàng (milestone): bậc thang theo số đơn DELIVERED
--        trong kỳ. [{min_orders, bonus, label}, …].
--   §2.3 Thưởng KPI tháng: 5 metrics (số khách mới, %visit-cover, AOV,
--        tỉ lệ trả, % đơn vượt list) — mỗi metric có bậc thang riêng.
--
-- Cùng nằm trên hr_monthly_bonus để 1 row = trọn bộ cấu hình thưởng
-- của 1 (org, period). Các trường default = '[]' nên có thể nâng cấp
-- không phá vỡ org cũ.
-- ====================================================================

ALTER TABLE hr_monthly_bonus
  ADD COLUMN IF NOT EXISTS per_unit_bonuses jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS order_milestone_tiers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS kpi_metrics jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN hr_monthly_bonus.per_unit_bonuses IS
  '§2.1: [{product_id|null, unit_name, bonus}] — thưởng/đầu thùng SP bán ra.';
COMMENT ON COLUMN hr_monthly_bonus.order_milestone_tiers IS
  '§2.2: [{min_orders, bonus, label}] — bậc thang số đơn hoàn tất.';
COMMENT ON COLUMN hr_monthly_bonus.kpi_metrics IS
  '§2.3: [{key, label, tiers:[{min, bonus}]}] — bậc thang theo từng KPI.';


-- ####################################################################
-- # 032_customers_created_by.sql
-- ####################################################################

-- ====================================================================
-- 032_customers_created_by
--
-- Update #2 v2 §2.3 — Cần biết NV nào tạo khách hàng mới để tính KPI
-- "khách hàng mới" trong tháng. Thêm cột tracking + backfill từ
-- customer_assignments (NV phụ trách hiện tại) cho dữ liệu cũ.
-- ====================================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_created_by
  ON customers(org_id, created_by, created_at)
  WHERE created_by IS NOT NULL;

COMMENT ON COLUMN customers.created_by IS
  'NV tạo khách hàng. Dùng cho KPI khách-hàng-mới (§2.3).';

-- Backfill: dùng NV phụ trách đầu tiên trong customer_assignments
WITH first_assignment AS (
  SELECT DISTINCT ON (customer_id) customer_id, user_id
  FROM customer_assignments
  ORDER BY customer_id, assigned_at NULLS LAST
)
UPDATE customers c
SET created_by = fa.user_id
FROM first_assignment fa
WHERE c.id = fa.customer_id
  AND c.created_by IS NULL;


-- ####################################################################
-- # 033_per_user_data_filtering.sql
-- ####################################################################

-- ====================================================================
-- 033_per_user_data_filtering
--
-- Update #2 v2 §1.2 — Tinh chỉnh RLS để mỗi NV chỉ thấy dữ liệu của
-- mình. Phần lớn policy đã đúng từ mig 002; bổ sung các trường hợp:
--
-- 1. customers: sales rep cũng thấy được khách mình tạo (created_by =
--    auth.uid()) — không cần đợi customer_assignment được thêm.
-- 2. payments: sales chỉ thấy thanh toán cho đơn của mình.
-- 3. notifications: user chỉ thấy thông báo của mình.
-- 4. order_status_history: user thấy lịch sử của đơn mình thấy được.
--
-- TOÀN BỘ migration được wrap trong DO $$..$$ blocks và idempotent:
-- chạy lại nhiều lần không fail. Mỗi block kiểm tra trước khi apply
-- để tránh phá nếu migration phụ thuộc (032) chưa chạy.
-- ====================================================================

-- ---------------------------------------------------------------------
-- 1. Extend customers SELECT for sales: own assignments OR own creations
--    Chỉ chạy nếu created_by column TỒN TẠI (mig 032 đã apply).
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers' AND column_name = 'created_by'
  ) THEN
    DROP POLICY IF EXISTS "Sales see assigned customers" ON customers;
    DROP POLICY IF EXISTS "Sales see own customers" ON customers;
    EXECUTE $POL$
      CREATE POLICY "Sales see own customers" ON customers
        FOR SELECT
        USING (
          org_id = public.user_org_id()
          AND public.user_role() = 'sales'
          AND (
            created_by = auth.uid()
            OR id IN (
              SELECT customer_id FROM customer_assignments
              WHERE user_id = auth.uid() AND status = 'active'
            )
          )
        );
    $POL$;
  ELSE
    -- Mig 032 chưa chạy. Đảm bảo policy gốc tồn tại để sales vẫn
    -- thấy được customers theo assignment.
    DROP POLICY IF EXISTS "Sales see assigned customers" ON customers;
    EXECUTE $POL$
      CREATE POLICY "Sales see assigned customers" ON customers
        FOR SELECT
        USING (
          org_id = public.user_org_id()
          AND public.user_role() = 'sales'
          AND id IN (
            SELECT customer_id FROM customer_assignments
            WHERE user_id = auth.uid() AND status = 'active'
          )
        );
    $POL$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. payments: sales rep see only payments for own orders
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'payments') THEN
    DROP POLICY IF EXISTS "Sales see own order payments" ON payments;
    EXECUTE $POL$
      CREATE POLICY "Sales see own order payments" ON payments
        FOR SELECT
        USING (
          public.user_role() = 'sales'
          AND EXISTS (
            SELECT 1 FROM receivables r
            JOIN sales_orders so ON so.id = r.order_id
            WHERE r.id = payments.receivable_id
              AND so.sales_user_id = auth.uid()
          )
        );
    $POL$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. notifications: user sees only own notifications.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'notifications') THEN
    DROP POLICY IF EXISTS "Users see own notifications" ON notifications;
    EXECUTE $POL$
      CREATE POLICY "Users see own notifications" ON notifications
        FOR SELECT
        USING (user_id = auth.uid());
    $POL$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4. order_status_history: visibility piggy-backs on sales_orders RLS
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'order_status_history') THEN
    DROP POLICY IF EXISTS "View history of visible orders" ON order_status_history;
    EXECUTE $POL$
      CREATE POLICY "View history of visible orders" ON order_status_history
        FOR SELECT
        USING (
          EXISTS (
            SELECT 1 FROM sales_orders so
            WHERE so.id = order_status_history.order_id
          )
        );
    $POL$;
  END IF;
END $$;


-- ####################################################################
-- # 034_per_user_data_filtering_part2.sql
-- ####################################################################

-- ====================================================================
-- 034_per_user_data_filtering_part2
--
-- Update #2 v2 §1.2 (tiếp theo) — Tinh chỉnh RLS các bảng tài chính
-- nhập-vào (supplier-side):
--
--   • payables / payable_payments: chỉ owner / manager / accountant
--     thấy. Sales / warehouse / driver KHÔNG thấy danh sách công nợ NCC.
--   • purchase_orders / purchase_order_lines / purchase_invoices: chỉ
--     owner / manager / warehouse / accountant thấy. Sales / driver
--     KHÔNG thấy giá vốn nhập.
--   • cash_receipts: lái xe / NV bán hàng chỉ thấy phiếu mình tạo
--     (collected_by = auth.uid()) hoặc chứng từ liên quan đơn của họ.
--
-- Migration 002 + 010 + 012 + 020 + 033 đã thiết lập policy tổng;
-- migration này siết thêm theo nguyên tắc tối thiểu.
-- ====================================================================

-- ---------------------------------------------------------------------
-- 1. payables — restrict SELECT to financial roles
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "View payables" ON payables;
DROP POLICY IF EXISTS "Financial roles view payables" ON payables;
CREATE POLICY "Financial roles view payables" ON payables
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  );

DROP POLICY IF EXISTS "View payable payments" ON payable_payments;
DROP POLICY IF EXISTS "Financial roles view payable payments" ON payable_payments;
CREATE POLICY "Financial roles view payable payments" ON payable_payments
  FOR SELECT TO authenticated
  USING (
    public.user_role() IN ('owner', 'manager', 'accountant')
    AND EXISTS (
      SELECT 1 FROM payables p
      WHERE p.id = payable_id AND p.org_id = public.user_org_id()
    )
  );

-- ---------------------------------------------------------------------
-- 2. purchase_orders / lines / invoices — restrict to operational
--    roles. Sales/driver have no business reason to see cost prices.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "View POs" ON purchase_orders;
DROP POLICY IF EXISTS "Ops roles view POs" ON purchase_orders;
CREATE POLICY "Ops roles view POs" ON purchase_orders
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'warehouse', 'accountant')
  );

DROP POLICY IF EXISTS "View PO lines" ON purchase_order_lines;
DROP POLICY IF EXISTS "Ops roles view PO lines" ON purchase_order_lines;
CREATE POLICY "Ops roles view PO lines" ON purchase_order_lines
  FOR SELECT TO authenticated
  USING (
    public.user_role() IN ('owner', 'manager', 'warehouse', 'accountant')
    AND EXISTS (
      SELECT 1 FROM purchase_orders po
      WHERE po.id = po_id AND po.org_id = public.user_org_id()
    )
  );

DROP POLICY IF EXISTS "View purchase invoices" ON purchase_invoices;
DROP POLICY IF EXISTS "Financial roles view purchase invoices" ON purchase_invoices;
CREATE POLICY "Financial roles view purchase invoices" ON purchase_invoices
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  );

-- ---------------------------------------------------------------------
-- 3. cash_receipts — narrow SELECT for sales/driver to own collections
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "cash_receipts_select" ON cash_receipts;
DROP POLICY IF EXISTS "cash_receipts_select_admin" ON cash_receipts;
CREATE POLICY "cash_receipts_select_admin" ON cash_receipts
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  );

DROP POLICY IF EXISTS "cash_receipts_select_own" ON cash_receipts;
CREATE POLICY "cash_receipts_select_own" ON cash_receipts
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('sales', 'driver', 'warehouse')
    AND collected_by = auth.uid()
  );


-- ####################################################################
-- # 035_return_exchange.sql
-- ####################################################################

-- ====================================================================
-- 035_return_exchange
--
-- Cho phép NV tick "Đổi hàng" trên dòng hàng trả: dòng trả là 1 SP
-- khách trả lại (vì hư / sai / muốn đổi), nhưng KHÔNG trừ vào công
-- nợ — chỉ xuất hiện trên phiếu giao để lái xe biết cần thu lại.
--
-- Quy tắc:
--   • is_exchange = true: dòng trả là phần đổi hàng, value KHÔNG cộng
--     vào credit_note_amount của bảng returns.
--   • is_exchange = false (default): dòng trả thật, sẽ trừ công nợ.
--
-- Khi tạo đơn, OrderForm tự tính credit_note_amount = sum(line_total)
-- của các dòng KHÔNG đổi-hàng. Trigger bên dưới đảm bảo invariant ngay
-- cả nếu UI quên tính.
-- ====================================================================

ALTER TABLE return_lines
  ADD COLUMN IF NOT EXISTS is_exchange boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN return_lines.is_exchange IS
  'True = đổi hàng (in trên phiếu giao, không trừ công nợ). False = trả tiền.';

CREATE INDEX IF NOT EXISTS idx_return_lines_exchange
  ON return_lines(return_id, is_exchange) WHERE is_exchange = true;

-- Recompute credit_note_amount on returns whenever its lines change.
CREATE OR REPLACE FUNCTION sync_return_credit_amount()
RETURNS TRIGGER AS $$
DECLARE
  v_return_id uuid;
  v_total numeric;
BEGIN
  v_return_id := COALESCE(NEW.return_id, OLD.return_id);
  SELECT COALESCE(SUM(line_total), 0) INTO v_total
  FROM return_lines
  WHERE return_id = v_return_id
    AND is_exchange = false;
  UPDATE returns SET credit_note_amount = v_total WHERE id = v_return_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_return_lines_sync_credit ON return_lines;
CREATE TRIGGER trg_return_lines_sync_credit
  AFTER INSERT OR UPDATE OR DELETE ON return_lines
  FOR EACH ROW EXECUTE FUNCTION sync_return_credit_amount();


-- ####################################################################
-- # 036_rls_repair.sql
-- ####################################################################

-- ====================================================================
-- 036_rls_repair
--
-- EMERGENCY REPAIR — chạy migration này nếu sau khi deploy thấy các
-- list trống (đơn hàng, khách hàng) hoặc không tạo được khách hàng.
-- Idempotent: chạy bao nhiêu lần cũng không hỏng dữ liệu.
--
-- Migration này KHÔNG xoá dữ liệu, chỉ tái thiết lập RLS policies về
-- trạng thái an toàn (giống mig 002 + 033 + 034 đã chuẩn). Dùng khi
-- nghi ngờ policies bị xoá / đổi tên / mất sync.
-- ====================================================================

-- ---------------------------------------------------------------------
-- CUSTOMERS — đảm bảo cả 4 policies đầy đủ
-- ---------------------------------------------------------------------
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- Owner / Manager / Accountant: thấy tất cả khách hàng trong org
DROP POLICY IF EXISTS "Admin roles can view all customers" ON customers;
CREATE POLICY "Admin roles can view all customers" ON customers
  FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  );

-- Sales: thấy khách được assign HOẶC khách mình tạo (nếu có created_by)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers' AND column_name = 'created_by'
  ) THEN
    DROP POLICY IF EXISTS "Sales see own customers" ON customers;
    DROP POLICY IF EXISTS "Sales see assigned customers" ON customers;
    EXECUTE $POL$
      CREATE POLICY "Sales see own customers" ON customers
        FOR SELECT
        USING (
          org_id = public.user_org_id()
          AND public.user_role() = 'sales'
          AND (
            created_by = auth.uid()
            OR id IN (
              SELECT customer_id FROM customer_assignments
              WHERE user_id = auth.uid() AND status = 'active'
            )
          )
        );
    $POL$;
  ELSE
    DROP POLICY IF EXISTS "Sales see assigned customers" ON customers;
    EXECUTE $POL$
      CREATE POLICY "Sales see assigned customers" ON customers
        FOR SELECT
        USING (
          org_id = public.user_org_id()
          AND public.user_role() = 'sales'
          AND id IN (
            SELECT customer_id FROM customer_assignments
            WHERE user_id = auth.uid() AND status = 'active'
          )
        );
    $POL$;
  END IF;
END $$;

-- INSERT: owner / manager / sales được tạo
DROP POLICY IF EXISTS "Owner/Manager/Sales can create customers" ON customers;
CREATE POLICY "Owner/Manager/Sales can create customers" ON customers
  FOR INSERT
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'sales')
  );

-- UPDATE: owner / manager / sales được sửa
DROP POLICY IF EXISTS "Owner/Manager/Sales can update customers" ON customers;
CREATE POLICY "Owner/Manager/Sales can update customers" ON customers
  FOR UPDATE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'sales')
  );

-- ---------------------------------------------------------------------
-- SALES ORDERS — đảm bảo 4 policies đầy đủ
-- ---------------------------------------------------------------------
ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin roles can view all orders" ON sales_orders;
CREATE POLICY "Admin roles can view all orders" ON sales_orders
  FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant', 'warehouse')
  );

DROP POLICY IF EXISTS "Sales see own orders" ON sales_orders;
CREATE POLICY "Sales see own orders" ON sales_orders
  FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'sales'
    AND sales_user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Driver sees delivery orders" ON sales_orders;
CREATE POLICY "Driver sees delivery orders" ON sales_orders
  FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'driver'
    AND id IN (
      SELECT dl.order_id FROM delivery_lines dl
      JOIN deliveries d ON d.id = dl.delivery_id
      WHERE d.driver_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owner/Manager/Sales can create orders" ON sales_orders;
CREATE POLICY "Owner/Manager/Sales can create orders" ON sales_orders
  FOR INSERT
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'sales')
  );

DROP POLICY IF EXISTS "Owner/Manager can update orders" ON sales_orders;
CREATE POLICY "Owner/Manager can update orders" ON sales_orders
  FOR UPDATE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'warehouse')
  );

DROP POLICY IF EXISTS "Sales can update own draft orders" ON sales_orders;
CREATE POLICY "Sales can update own draft orders" ON sales_orders
  FOR UPDATE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'sales'
    AND sales_user_id = auth.uid()
    AND status = 'draft'
  );

-- ---------------------------------------------------------------------
-- SALES ORDER LINES — đảm bảo có thể xem dòng của các đơn nhìn thấy
-- ---------------------------------------------------------------------
ALTER TABLE sales_order_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view order lines of visible orders" ON sales_order_lines;
CREATE POLICY "Users can view order lines of visible orders" ON sales_order_lines
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM sales_orders so WHERE so.id = order_id)
  );

DROP POLICY IF EXISTS "Owner/Manager/Sales can manage order lines" ON sales_order_lines;
CREATE POLICY "Owner/Manager/Sales can manage order lines" ON sales_order_lines
  FOR ALL
  USING (
    public.user_role() IN ('owner', 'manager', 'sales', 'warehouse')
    AND EXISTS (
      SELECT 1 FROM sales_orders so
      WHERE so.id = order_id AND so.org_id = public.user_org_id()
    )
  );

-- ---------------------------------------------------------------------
-- Force PostgREST to reload schema cache so new columns become visible
-- ngay lập tức (Supabase tự gọi sau migration nhưng đôi khi chậm).
-- ---------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';


-- ####################################################################
-- # 037_fix_rls_recursion.sql
-- ####################################################################

-- ====================================================================
-- 037_fix_rls_recursion
--
-- 🚨 EMERGENCY FIX — 500 error on /rest/v1/customers and
-- /rest/v1/customer_assignments.
--
-- Root cause: migration 033's customers policy added a subquery on
-- customer_assignments. customer_assignments has its own RLS policy
-- (mig 002 / 008) that subqueries customers. When Postgres evaluates
-- either side it bounces back to the other → infinite recursion →
-- 500 Internal Server Error from PostgREST.
--
-- Fix: hoist the assignment lookup into a SECURITY DEFINER helper
-- function. SECURITY DEFINER runs as the table owner and BYPASSES
-- RLS on the underlying table. Same pattern as public.user_role()
-- and public.user_org_id() in mig 002.
--
-- Idempotent. Safe to re-run.
-- ====================================================================

-- ---------------------------------------------------------------------
-- Helper: list of customer_ids the calling user is actively assigned
-- to. SECURITY DEFINER bypasses customer_assignments RLS so we never
-- bounce back into customers RLS.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_assigned_customer_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT customer_id
  FROM public.customer_assignments
  WHERE user_id = auth.uid()
    AND status = 'active';
$$;

REVOKE EXECUTE ON FUNCTION public.user_assigned_customer_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_assigned_customer_ids() TO authenticated;

-- ---------------------------------------------------------------------
-- Re-create customers SELECT policy for sales using the helper.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  -- Drop both possible names (idempotent)
  EXECUTE 'DROP POLICY IF EXISTS "Sales see own customers" ON customers';
  EXECUTE 'DROP POLICY IF EXISTS "Sales see assigned customers" ON customers';

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customers'
      AND column_name = 'created_by'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY "Sales see own customers" ON customers
        FOR SELECT
        USING (
          org_id = public.user_org_id()
          AND public.user_role() = 'sales'
          AND (
            created_by = auth.uid()
            OR id IN (SELECT public.user_assigned_customer_ids())
          )
        );
    $POL$;
  ELSE
    EXECUTE $POL$
      CREATE POLICY "Sales see assigned customers" ON customers
        FOR SELECT
        USING (
          org_id = public.user_org_id()
          AND public.user_role() = 'sales'
          AND id IN (SELECT public.user_assigned_customer_ids())
        );
    $POL$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- customer_assignments policy from mig 002/008 also subqueries
-- customers. Replace it with a non-recursive version that uses
-- public.user_org_id() directly via a SECURITY DEFINER lookup of the
-- customer's org instead of a subquery.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_org_id(p_customer_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT org_id FROM public.customers WHERE id = p_customer_id;
$$;

REVOKE EXECUTE ON FUNCTION public.customer_org_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_org_id(uuid) TO authenticated;

DO $$
BEGIN
  -- Drop ALL existing customer_assignments policies (idempotent)
  EXECUTE 'DROP POLICY IF EXISTS "Org members can view assignments" ON customer_assignments';
  EXECUTE 'DROP POLICY IF EXISTS "Owner/Manager can manage assignments" ON customer_assignments';
  EXECUTE 'DROP POLICY IF EXISTS "Authenticated can view assignments" ON customer_assignments';
  EXECUTE 'DROP POLICY IF EXISTS "View assignments in org" ON customer_assignments';
  EXECUTE 'DROP POLICY IF EXISTS "Owner/Manager manage assignments" ON customer_assignments';

  EXECUTE $POL$
    CREATE POLICY "View assignments in org" ON customer_assignments
      FOR SELECT
      TO authenticated
      USING (
        public.customer_org_id(customer_id) = public.user_org_id()
        OR user_id = auth.uid()
      );
  $POL$;

  EXECUTE $POL$
    CREATE POLICY "Owner/Manager manage assignments" ON customer_assignments
      FOR ALL
      TO authenticated
      USING (
        public.user_role() IN ('owner', 'manager')
        AND public.customer_org_id(customer_id) = public.user_org_id()
      )
      WITH CHECK (
        public.user_role() IN ('owner', 'manager')
        AND public.customer_org_id(customer_id) = public.user_org_id()
      );
  $POL$;
END $$;

-- ---------------------------------------------------------------------
-- Force PostgREST to reload schema cache so the new functions are
-- callable from the API immediately.
-- ---------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';


-- ####################################################################
-- # 038_delivery_goods_handover.sql
-- ####################################################################

-- ====================================================================
-- 038_delivery_goods_handover
--
-- Khi tài xế giao về kho, ngoài "Bàn giao tiền" cần thêm "Bàn giao
-- hàng" — thủ kho xác nhận đã nhận lại các SP khách trả / đổi.
-- Mig này thêm cột tracking cho deliveries.
-- ====================================================================

ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS goods_handover_at timestamptz,
  ADD COLUMN IF NOT EXISTS goods_handover_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS goods_handover_notes text;

COMMENT ON COLUMN deliveries.goods_handover_at IS
  'Thời điểm thủ kho xác nhận nhận lại hàng trả / đổi từ tài xế.';
COMMENT ON COLUMN deliveries.goods_handover_by IS
  'Thủ kho / người nhận hàng về.';


-- ####################################################################
-- # 039_uom_conversion_fix.sql
-- ####################################################################

-- ====================================================================
-- T-01: UOM conversion fix
--
-- Bug: 1 thùng = 10 hộp. Đơn xuất 4 thùng → batches.qty_on_hand chỉ
-- giảm 4 thay vì 40, vì các call site `update qty_on_hand = qty_on_hand
-- - take` truyền raw `sales_order_lines.quantity` (đã trong UOM giao
-- dịch — thùng) thay vì trong base UOM (hộp).
--
-- Fix:
--   • sales_order_lines.conversion_factor: snapshot tại lúc tạo đơn.
--   • stock_entry_lines: thêm base/transaction split columns.
--   • Backfill từ product_units; rows cũ → factor=1 (không gây regression).
--   • Audit view v_uom_audit cho rows nghi ngờ.
--
-- Spec mapping (xem docs/pack3-questions.md Q1):
--   spec stock_ledger_entries → actual stock_entry_lines.
-- ====================================================================

-- ---------------------------------------------------------------------
-- 1. sales_order_lines: snapshot conversion factor
-- ---------------------------------------------------------------------
ALTER TABLE sales_order_lines
  ADD COLUMN IF NOT EXISTS conversion_factor numeric(18, 6) NOT NULL DEFAULT 1;

COMMENT ON COLUMN sales_order_lines.conversion_factor IS
  'Snapshot product_units.conversion lúc tạo line. quantity là theo unit_name; quantity_in_base = quantity * conversion_factor.';

-- Backfill: lookup product_units by (product_id, unit_name).
-- Nếu unit_name = product.base_unit hoặc không tìm thấy → 1.
UPDATE sales_order_lines sol
SET conversion_factor = COALESCE(
  (SELECT pu.conversion FROM product_units pu
    WHERE pu.product_id = sol.product_id
      AND pu.unit_name = sol.unit_name
    LIMIT 1),
  1
)
WHERE conversion_factor = 1;

-- ---------------------------------------------------------------------
-- 2. stock_entry_lines: split base / transaction UOM
-- ---------------------------------------------------------------------
ALTER TABLE stock_entry_lines
  ADD COLUMN IF NOT EXISTS qty_in_base_uom        numeric(18, 6),
  ADD COLUMN IF NOT EXISTS qty_in_transaction_uom numeric(18, 6),
  ADD COLUMN IF NOT EXISTS transaction_uom        text,
  ADD COLUMN IF NOT EXISTS conversion_factor_snapshot numeric(18, 6);

COMMENT ON COLUMN stock_entry_lines.qty_in_base_uom IS
  'Số lượng trong base UOM (vd: hộp). Cộng/trừ trực tiếp với batches.qty_on_hand.';
COMMENT ON COLUMN stock_entry_lines.transaction_uom IS
  'UOM giao dịch (vd: thùng). Hiển thị trên phiếu in.';

-- Backfill: rows cũ → snapshot quantity ở cả 2 cột; transaction_uom = unit_name; factor = lookup product_units (default 1).
UPDATE stock_entry_lines sel
SET conversion_factor_snapshot = COALESCE(
  (SELECT pu.conversion FROM product_units pu
    WHERE pu.product_id = sel.product_id
      AND pu.unit_name = sel.unit_name
    LIMIT 1),
  1
)
WHERE conversion_factor_snapshot IS NULL;

UPDATE stock_entry_lines
SET qty_in_transaction_uom = quantity,
    qty_in_base_uom        = quantity * conversion_factor_snapshot,
    transaction_uom        = unit_name
WHERE qty_in_base_uom IS NULL;

ALTER TABLE stock_entry_lines
  ALTER COLUMN qty_in_base_uom SET NOT NULL;

-- ---------------------------------------------------------------------
-- 3. Audit view: rows that look stale (qty != qty_in_base_uom and no
--    transaction_uom set). Caller checks count per spec section 3.3.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_uom_audit AS
SELECT
  sel.id,
  se.org_id,
  sel.entry_id,
  sel.product_id,
  sel.quantity,
  sel.qty_in_base_uom,
  sel.qty_in_transaction_uom,
  sel.transaction_uom,
  sel.conversion_factor_snapshot
FROM stock_entry_lines sel
JOIN stock_entries se ON se.id = sel.entry_id
WHERE sel.quantity != sel.qty_in_base_uom
  AND sel.transaction_uom IS NULL;

-- ---------------------------------------------------------------------
-- 4. Performance: speed up balance + history queries by warehouse zone
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sel_product_entry_org
  ON stock_entry_lines (product_id, entry_id);


-- ####################################################################
-- # 040_fifo_layers.sql
-- ####################################################################

-- ====================================================================
-- T-02: FIFO costing infrastructure
--
-- Mỗi lần nhập kho tạo 1 fifo_layer (giá vốn snapshot). Xuất kho
-- consume layer cũ nhất trước (FIFO). fifo_consumptions ghi mapping
-- "stock_entry_line nào consume layer nào, bao nhiêu".
--
-- Spec table → actual:
--   stock_ledger_entries → stock_entry_lines (Q1).
--   warehouse 'sale_stock'|'date_stock' → warehouse_zone 'sale'|'date'
--   (batches.warehouse_zone từ mig 028).
-- ====================================================================

CREATE TABLE IF NOT EXISTS fifo_layers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_zone text NOT NULL CHECK (warehouse_zone IN ('sale', 'date')),
  /* nullable cho backfill (no source ledger). New layers reference
     the import stock_entry_line that created them. */
  source_line_id uuid REFERENCES stock_entry_lines(id),
  qty_in_base_uom_remaining numeric(18, 6) NOT NULL,
  unit_cost numeric(18, 6) NOT NULL,
  posting_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_fifo_consume
  ON fifo_layers (org_id, product_id, warehouse_zone, posting_at)
  WHERE closed_at IS NULL AND qty_in_base_uom_remaining > 0;

CREATE TABLE IF NOT EXISTS fifo_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  out_line_id uuid NOT NULL REFERENCES stock_entry_lines(id) ON DELETE CASCADE,
  layer_id uuid NOT NULL REFERENCES fifo_layers(id) ON DELETE CASCADE,
  qty_consumed numeric(18, 6) NOT NULL,
  unit_cost numeric(18, 6) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fifo_cons_out ON fifo_consumptions(out_line_id);
CREATE INDEX IF NOT EXISTS idx_fifo_cons_layer ON fifo_consumptions(layer_id);

ALTER TABLE fifo_layers ENABLE ROW LEVEL SECURITY;
ALTER TABLE fifo_consumptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_iso_fifo_layers ON fifo_layers
  USING (org_id = public.user_org_id());
CREATE POLICY org_iso_fifo_consumptions ON fifo_consumptions
  USING (org_id = public.user_org_id());

GRANT SELECT, INSERT, UPDATE ON fifo_layers TO authenticated;
GRANT SELECT, INSERT ON fifo_consumptions TO authenticated;

-- --------------------------------------------------------------------
-- Atomic consume helper (SECURITY DEFINER) — locks layers FOR UPDATE
-- and applies FIFO. Returns total cost + per-layer breakdown.
--
-- Usage from RPC:
--   select * from fifo_consume(
--     p_org_id => '...',
--     p_product_id => '...',
--     p_warehouse_zone => 'sale',
--     p_qty_needed => 40,
--     p_out_line_id => '...'
--   );
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fifo_consume(
  p_org_id uuid,
  p_product_id uuid,
  p_warehouse_zone text,
  p_qty_needed numeric,
  p_out_line_id uuid
) RETURNS TABLE (total_cost numeric, layers_used int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining numeric := p_qty_needed;
  v_total_cost numeric := 0;
  v_layers_used int := 0;
  v_take numeric;
  r record;
BEGIN
  IF p_qty_needed <= 0 THEN
    RETURN QUERY SELECT 0::numeric, 0::int;
    RETURN;
  END IF;

  FOR r IN
    SELECT id, qty_in_base_uom_remaining, unit_cost
    FROM fifo_layers
    WHERE org_id = p_org_id
      AND product_id = p_product_id
      AND warehouse_zone = p_warehouse_zone
      AND closed_at IS NULL
      AND qty_in_base_uom_remaining > 0
    ORDER BY posting_at ASC, created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(r.qty_in_base_uom_remaining, v_remaining);

    UPDATE fifo_layers
    SET qty_in_base_uom_remaining = qty_in_base_uom_remaining - v_take,
        closed_at = CASE
          WHEN qty_in_base_uom_remaining - v_take <= 0 THEN now()
          ELSE NULL
        END
    WHERE id = r.id;

    INSERT INTO fifo_consumptions (
      org_id, out_line_id, layer_id, qty_consumed, unit_cost
    ) VALUES (
      p_org_id, p_out_line_id, r.id, v_take, r.unit_cost
    );

    v_total_cost := v_total_cost + (v_take * r.unit_cost);
    v_remaining := v_remaining - v_take;
    v_layers_used := v_layers_used + 1;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'FIFO_INSUFFICIENT_STOCK: cần thêm % đơn vị cho SP %',
      v_remaining, p_product_id;
  END IF;

  RETURN QUERY SELECT v_total_cost, v_layers_used;
END;
$$;

REVOKE EXECUTE ON FUNCTION fifo_consume(uuid, uuid, text, numeric, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fifo_consume(uuid, uuid, text, numeric, uuid) TO authenticated;

-- --------------------------------------------------------------------
-- Backfill: create 1 layer per (product, zone) from existing batches
-- with qty_on_hand > 0. unit_cost = max(batches.unit_cost, products.cost_price, 0).
-- Per spec section 3.3 — log to docs/pack3-fifo-backfill-report.md if needed.
-- --------------------------------------------------------------------
INSERT INTO fifo_layers (
  org_id, product_id, warehouse_zone,
  qty_in_base_uom_remaining, unit_cost, posting_at
)
SELECT
  b.org_id,
  b.product_id,
  COALESCE(b.warehouse_zone, 'sale'),
  SUM(b.qty_on_hand)::numeric,
  COALESCE(
    AVG(NULLIF(b.unit_cost, 0)),
    MAX(p.cost_price),
    0
  )::numeric,
  MIN(b.created_at)
FROM batches b
JOIN products p ON p.id = b.product_id
WHERE b.qty_on_hand > 0
GROUP BY b.org_id, b.product_id, COALESCE(b.warehouse_zone, 'sale')
ON CONFLICT DO NOTHING;


-- ####################################################################
-- # 041_user_permission_overrides.sql
-- ####################################################################

-- ====================================================================
-- T-13: Per-user permission overrides
--
-- Existing permission system (mig 022/024) defines a role-based
-- matrix in TS lib/permissions.ts. This adds a per-user override
-- layer: explicit grant/revoke per (user, permission_key) takes
-- precedence over the role default.
--
-- Resolver helper user_has_permission(user_id, perm) consults the
-- override first, then falls back to the role matrix. RLS policies
-- in T-14 use this helper.
-- ====================================================================

CREATE TABLE IF NOT EXISTS user_permission_overrides (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  granted boolean NOT NULL,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_upo_user ON user_permission_overrides(user_id);

ALTER TABLE user_permission_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_iso_upo_select ON user_permission_overrides
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());
CREATE POLICY org_iso_upo_write ON user_permission_overrides
  FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'manager'))
  WITH CHECK (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON user_permission_overrides TO authenticated;

-- --------------------------------------------------------------------
-- Resolver: override > role default. Role default lives in
-- role_permissions table from mig 022 (if present); otherwise we
-- return false and let the TS resolver decide.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_has_permission(p_user_id uuid, p_perm text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_override boolean;
  v_role_grant boolean;
  v_user_role text;
BEGIN
  -- 1. Explicit override wins.
  SELECT granted INTO v_override
  FROM user_permission_overrides
  WHERE user_id = p_user_id AND permission_key = p_perm;
  IF FOUND THEN
    RETURN v_override;
  END IF;

  -- 2. Role default from role_permissions (if mig 022 was applied).
  SELECT u.role INTO v_user_role FROM users u WHERE u.id = p_user_id;
  IF v_user_role IS NULL THEN RETURN false; END IF;
  IF v_user_role = 'owner' THEN RETURN true; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'role_permissions')
  THEN
    SELECT EXISTS (
      SELECT 1 FROM role_permissions rp
      WHERE rp.role = v_user_role AND rp.permission_key = p_perm
    ) INTO v_role_grant;
    RETURN COALESCE(v_role_grant, false);
  END IF;

  RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.user_has_permission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_permission(uuid, text) TO authenticated;


-- ####################################################################
-- # 042_customer_row_level.sql
-- ####################################################################

-- ====================================================================
-- T-14: Row-level customer filtering
--
-- NV Sales chỉ thấy KH được assigned cho mình. Override quyền
-- "customer.view_all" cho các vai trò admin / supervisor được hết.
--
-- customer_assignments table đã tồn tại (mig 001). Mig 037 đã có
-- public.user_assigned_customer_ids() (SECURITY DEFINER, bypasses RLS
-- to prevent recursion). T-14 chỉ cần xếp lại policies với resolver
-- mới + extend tới sales_orders.
-- ====================================================================

-- ---------------------------------------------------------------------
-- customers SELECT — admin OR own customers OR view_all override
-- ---------------------------------------------------------------------
DO $$
BEGIN
  -- Drop ALL existing select policies to install a clean unified one
  EXECUTE 'DROP POLICY IF EXISTS "Admin roles can view all customers" ON customers';
  EXECUTE 'DROP POLICY IF EXISTS "Sales see own customers" ON customers';
  EXECUTE 'DROP POLICY IF EXISTS "Sales see assigned customers" ON customers';
  EXECUTE 'DROP POLICY IF EXISTS customer_select ON customers';
END $$;

CREATE POLICY customer_select ON customers
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND (
      public.user_role() IN ('owner', 'manager', 'accountant')
      OR public.user_has_permission(auth.uid(), 'customer.view_all')
      OR (
        EXISTS (
          SELECT 1 FROM customer_assignments ca
          WHERE ca.customer_id = customers.id
            AND ca.user_id = auth.uid()
            AND ca.status = 'active'
        )
      )
      OR (
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'customers' AND column_name = 'created_by'
        ) AND created_by = auth.uid()
      )
    )
  );

-- ---------------------------------------------------------------------
-- sales_orders SELECT — same pattern: admin OR own assignments OR
-- view_all override
-- ---------------------------------------------------------------------
DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "Admin roles can view all orders" ON sales_orders';
  EXECUTE 'DROP POLICY IF EXISTS "Sales see own orders" ON sales_orders';
  EXECUTE 'DROP POLICY IF EXISTS "Driver sees delivery orders" ON sales_orders';
  EXECUTE 'DROP POLICY IF EXISTS sales_order_select ON sales_orders';
END $$;

CREATE POLICY sales_order_select ON sales_orders
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND (
      public.user_role() IN ('owner', 'manager', 'accountant', 'warehouse')
      OR public.user_has_permission(auth.uid(), 'customer.view_all')
      OR sales_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM customer_assignments ca
        WHERE ca.customer_id = sales_orders.customer_id
          AND ca.user_id = auth.uid()
          AND ca.status = 'active'
      )
      OR (
        public.user_role() = 'driver'
        AND id IN (
          SELECT dl.order_id FROM delivery_lines dl
          JOIN deliveries d ON d.id = dl.delivery_id
          WHERE d.driver_id = auth.uid()
        )
      )
    )
  );

NOTIFY pgrst, 'reload schema';


-- ####################################################################
-- # 043_payroll_per_user_bonuses.sql
-- ####################################################################

-- ====================================================================
-- T-15: Per-user salary KPI tiers + order-count bonus + activity bonus
--
-- Mig 031 đã có per-org bonus jsonb columns trên hr_monthly_bonus
-- (tiers / per_unit_bonuses / order_milestone_tiers / kpi_metrics).
-- Pack3 thêm 3 tables PER-USER cho overrides chi tiết hơn.
-- ====================================================================

-- ---------------------------------------------------------------------
-- 1. KPI tiers theo tháng (bậc thang doanh số per-user)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS salary_kpi_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  month date NOT NULL,
  min_revenue numeric(18, 2) NOT NULL,
  bonus_type text NOT NULL CHECK (bonus_type IN ('percent', 'fixed')),
  bonus_value numeric(18, 2) NOT NULL,
  order_index int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kpi_user_month ON salary_kpi_tiers(user_id, month);
CREATE INDEX IF NOT EXISTS idx_kpi_org_month ON salary_kpi_tiers(org_id, month);

ALTER TABLE salary_kpi_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_iso_kpi_select ON salary_kpi_tiers
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());
CREATE POLICY org_iso_kpi_write ON salary_kpi_tiers
  FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'accountant'))
  WITH CHECK (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'accountant'));

GRANT SELECT, INSERT, UPDATE, DELETE ON salary_kpi_tiers TO authenticated;

-- ---------------------------------------------------------------------
-- 2. Order-count bonus configs (D9: thưởng theo số đơn pass cả 2
--    ngưỡng count + value trong period)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS salary_order_count_bonus_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  period text NOT NULL CHECK (period IN ('week', 'month')),
  min_order_count int NOT NULL,
  min_order_value numeric(18, 2) NOT NULL,
  bonus_per_order numeric(18, 2) NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ocbc_user_eff
  ON salary_order_count_bonus_configs(user_id, effective_from, effective_to);

ALTER TABLE salary_order_count_bonus_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_iso_ocbc_select ON salary_order_count_bonus_configs
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());
CREATE POLICY org_iso_ocbc_write ON salary_order_count_bonus_configs
  FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'accountant'))
  WITH CHECK (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'accountant'));

GRANT SELECT, INSERT, UPDATE, DELETE ON salary_order_count_bonus_configs TO authenticated;

-- ---------------------------------------------------------------------
-- 3. Activity bonus per tháng (kế toán nhập tay, không rule-based — D11)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_activity_bonuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month date NOT NULL,
  amount numeric(18, 2) NOT NULL,
  note text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_mab_org_month
  ON monthly_activity_bonuses(org_id, month);

ALTER TABLE monthly_activity_bonuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_iso_mab_select ON monthly_activity_bonuses
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND (
      public.user_role() IN ('owner', 'accountant', 'manager')
      OR user_id = auth.uid()
    )
  );
CREATE POLICY org_iso_mab_write ON monthly_activity_bonuses
  FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'accountant'))
  WITH CHECK (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'accountant'));

GRANT SELECT, INSERT, UPDATE, DELETE ON monthly_activity_bonuses TO authenticated;


-- ####################################################################
-- # 044_workflow_stage.sql
-- ####################################################################

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


-- ####################################################################
-- # 045_workflow_sessions.sql
-- ####################################################################

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


-- ####################################################################
-- # 046_entity_locks.sql
-- ####################################################################

-- ====================================================================
-- T-06: Hard-lock concurrency (pessimistic, with heartbeat)
--
-- Spec D5: when a user opens a record for editing, take a DB lock so
-- nobody else can. UI shows "🔒 [Tên] đang sửa" + readonly. Locks are
-- released by the holder explicitly OR auto-expire after 10 minutes
-- of no heartbeat (stale-cleanup runs lazily on every acquire attempt
-- — pg_cron not assumed available).
--
-- entity_type values mirror workflow_sessions where they overlap:
--   'sales_order' | 'stock_entry' | 'delivery' | 'driver_handover'
-- but the table accepts free-form text so other surfaces (returns,
-- customers…) can re-use the lock primitive.
-- ====================================================================

CREATE TABLE IF NOT EXISTS entity_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  locked_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  locked_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_entity_lock UNIQUE (entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_locks_heartbeat
  ON entity_locks (last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_entity_locks_holder
  ON entity_locks (locked_by);

ALTER TABLE entity_locks ENABLE ROW LEVEL SECURITY;

-- Read all locks in your org so the UI can show "đang khoá bởi X".
CREATE POLICY entity_locks_select ON entity_locks FOR SELECT
  USING (org_id = public.user_org_id());

-- Mutations only via the helper functions (SECURITY DEFINER) below.
CREATE POLICY entity_locks_no_direct_writes ON entity_locks FOR ALL
  USING (false)
  WITH CHECK (false);

GRANT SELECT ON entity_locks TO authenticated;

-- --------------------------------------------------------------------
-- Stale-lock cleanup. Runs lazily inside acquire/heartbeat. 10-minute
-- threshold per spec D5.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION release_stale_entity_locks()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int;
BEGIN
  DELETE FROM entity_locks
  WHERE last_heartbeat_at < now() - interval '10 minutes';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION release_stale_entity_locks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION release_stale_entity_locks() TO authenticated;

-- --------------------------------------------------------------------
-- acquire_entity_lock — atomic. Returns one row:
--   ok=true  + holder=auth.uid() when the caller now holds the lock.
--   ok=false + holder=<current> when someone else holds it.
-- Existing lock by the SAME user is treated as success and bumps the
-- heartbeat (idempotent re-mount).
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION acquire_entity_lock(
  p_entity_type text,
  p_entity_id   uuid
) RETURNS TABLE (
  ok boolean,
  holder_id uuid,
  holder_name text,
  locked_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_org     uuid := public.user_org_id();
  v_existing record;
BEGIN
  IF v_uid IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  -- Lazy stale cleanup so a crashed tab doesn't permanently lock a row.
  PERFORM release_stale_entity_locks();

  SELECT el.locked_by, el.locked_at, u.full_name
    INTO v_existing
  FROM entity_locks el
  JOIN users u ON u.id = el.locked_by
  WHERE el.entity_type = p_entity_type
    AND el.entity_id   = p_entity_id;

  IF FOUND THEN
    IF v_existing.locked_by = v_uid THEN
      -- Re-acquire by same user → bump heartbeat.
      UPDATE entity_locks
      SET last_heartbeat_at = now()
      WHERE entity_type = p_entity_type AND entity_id = p_entity_id;

      RETURN QUERY
      SELECT true, v_uid, v_existing.full_name, v_existing.locked_at;
      RETURN;
    END IF;

    -- Held by someone else.
    RETURN QUERY
    SELECT false, v_existing.locked_by, v_existing.full_name, v_existing.locked_at;
    RETURN;
  END IF;

  -- No existing lock → take it.
  INSERT INTO entity_locks (org_id, entity_type, entity_id, locked_by)
  VALUES (v_org, p_entity_type, p_entity_id, v_uid);

  RETURN QUERY
  SELECT
    true,
    v_uid,
    (SELECT full_name FROM users WHERE id = v_uid),
    now()::timestamptz;
END;
$$;

REVOKE EXECUTE ON FUNCTION acquire_entity_lock(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION acquire_entity_lock(text, uuid) TO authenticated;

-- --------------------------------------------------------------------
-- heartbeat_entity_lock — bump last_heartbeat_at if you're the holder.
-- Returns true if your heartbeat was applied; false if the lock was
-- stolen / expired (caller should re-acquire or readonly the form).
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION heartbeat_entity_lock(
  p_entity_type text,
  p_entity_id   uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rows int;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;

  -- Cleanup stales first so a long-since-stale lock doesn't reappear.
  PERFORM release_stale_entity_locks();

  UPDATE entity_locks
  SET last_heartbeat_at = now()
  WHERE entity_type = p_entity_type
    AND entity_id   = p_entity_id
    AND locked_by   = v_uid;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION heartbeat_entity_lock(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION heartbeat_entity_lock(text, uuid) TO authenticated;

-- --------------------------------------------------------------------
-- release_entity_lock — only the current holder can release.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION release_entity_lock(
  p_entity_type text,
  p_entity_id   uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rows int;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;

  DELETE FROM entity_locks
  WHERE entity_type = p_entity_type
    AND entity_id   = p_entity_id
    AND locked_by   = v_uid;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION release_entity_lock(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION release_entity_lock(text, uuid) TO authenticated;

COMMENT ON TABLE entity_locks IS
  'T-06: pessimistic per-record edit locks. Mutations only via acquire_/heartbeat_/release_entity_lock SECURITY DEFINER functions. Stales reaped at 10 minutes of no heartbeat.';


-- ####################################################################
-- # 047_driver_handovers.sql
-- ####################################################################

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


-- ####################################################################
-- # 048_stock_balance_views.sql
-- ####################################################################

-- ====================================================================
-- T-09: Tab "Tồn kho hiện tại" — split by warehouse_zone + FIFO valuation
--
-- Powers components/inventory/stock-balance-table.tsx and the
-- per-product history drawer. The view rolls up:
--   - qty_on_hand per (product, zone) from batches (base UOM)
--   - inventory value per (product, zone) from active fifo_layers
--     (qty_remaining × unit_cost). Falls back to batches.unit_cost ×
--     qty_on_hand when no FIFO layer is yet present (T-02 backfill).
--
-- Spec requires: Mã SP / Tên SP / Kho bán SL+Giá trị / Kho date SL+Giá
-- trị / Tổng SL+Giá trị. The view returns one row per (product, zone);
-- the FE pivots to wide format.
-- ====================================================================

-- Normalize the COALESCE(warehouse_zone, 'sale') in a CTE so the outer
-- GROUP BY references a real column (n.warehouse_zone) — Postgres won't
-- accept the ungrouped `b.warehouse_zone` deep in the subquery if the
-- outer GROUP BY only carries the COALESCE expression.
CREATE OR REPLACE VIEW v_stock_balance_by_zone AS
WITH normalized AS (
  SELECT
    b.org_id,
    b.product_id,
    COALESCE(b.warehouse_zone, 'sale') AS warehouse_zone,
    b.qty_on_hand,
    b.unit_cost
  FROM batches b
  WHERE b.qty_on_hand > 0
)
SELECT
  n.org_id,
  n.product_id,
  n.warehouse_zone,
  SUM(n.qty_on_hand)::numeric AS qty_in_base_uom,
  -- Prefer FIFO valuation; fallback to batch weighted-avg.
  COALESCE(
    (
      SELECT SUM(fl.qty_in_base_uom_remaining * fl.unit_cost)::numeric
      FROM fifo_layers fl
      WHERE fl.org_id = n.org_id
        AND fl.product_id = n.product_id
        AND fl.warehouse_zone = n.warehouse_zone
        AND fl.closed_at IS NULL
    ),
    SUM(n.qty_on_hand * COALESCE(n.unit_cost, 0))::numeric
  ) AS value
FROM normalized n
GROUP BY n.org_id, n.product_id, n.warehouse_zone;

COMMENT ON VIEW v_stock_balance_by_zone IS
  'T-09: per (product, warehouse_zone) qty + FIFO-valued cost. One row per zone (sale/date) per product with positive on-hand.';

GRANT SELECT ON v_stock_balance_by_zone TO authenticated;

-- --------------------------------------------------------------------
-- Movement history view — drives the drill-down drawer. Each row is a
-- single stock_entry_line decorated with parent entry meta + a running
-- balance. Postgres window functions keep the running calc sane.
-- --------------------------------------------------------------------
CREATE OR REPLACE VIEW v_stock_movements AS
SELECT
  sel.id,
  se.org_id,
  sel.product_id,
  COALESCE(b.warehouse_zone, 'sale') AS warehouse_zone,
  se.posted_at,
  se.created_at,
  se.type AS entry_type,
  se.status AS entry_status,
  se.entry_code,
  se.id AS entry_id,
  sel.unit_name AS transaction_uom,
  sel.qty_in_transaction_uom,
  sel.qty_in_base_uom,
  sel.conversion_factor_snapshot AS conversion_factor,
  sel.unit_cost,
  -- Sign: imports +, exports −, transfer/stocktake keep raw sign.
  CASE se.type
    WHEN 'import' THEN sel.qty_in_base_uom
    WHEN 'export' THEN -sel.qty_in_base_uom
    ELSE sel.qty_in_base_uom
  END AS signed_qty_in_base_uom,
  se.ref_order_ids
FROM stock_entry_lines sel
JOIN stock_entries     se ON se.id = sel.entry_id
LEFT JOIN batches      b  ON b.id  = sel.batch_id
WHERE se.status <> 'cancelled';

COMMENT ON VIEW v_stock_movements IS
  'T-09: every stock_entry_line decorated with entry header and signed base-UOM qty (import +, export −). Drives the drill-down history drawer.';

GRANT SELECT ON v_stock_movements TO authenticated;


-- ####################################################################
-- # 049_swap_stock.sql
-- ####################################################################

-- ====================================================================
-- T-12: Phiếu xuất "hàng đem đi đổi" (swap stock)
--
-- The driver / sales rep takes spare stock along on a route to handle
-- in-the-field exchanges. We need to:
--   1. Reserve the qty out of sale_stock at picking time (FIFO consume)
--   2. Print it on the export slip alongside the order goods
--   3. When the driver returns, T-07 driver handover lists the unused
--      portion so it can flow back into stock with the user picking
--      Kho bán vs Kho date as destination.
--
-- Spec maps shipment_id → deliveries.id, but in this codebase picking
-- creates a stock_entry first; deliveries land later. We therefore key
-- on stock_entry_id (the "shipment" of goods leaving the warehouse).
-- ====================================================================

CREATE TABLE IF NOT EXISTS swap_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  /* The export stock_entry that recorded this swap reservation. */
  stock_entry_id uuid NOT NULL REFERENCES stock_entries(id) ON DELETE CASCADE,
  /* Optional: if the driver was attached to a delivery row. */
  delivery_id uuid REFERENCES deliveries(id),
  product_id uuid NOT NULL REFERENCES products(id),
  qty numeric(18, 6) NOT NULL CHECK (qty > 0),
  unit_name text NOT NULL,
  conversion_factor numeric(18, 6) NOT NULL DEFAULT 1,
  qty_in_base_uom numeric(18, 6) NOT NULL CHECK (qty_in_base_uom > 0),
  reason text,
  /* The stock_entry_line that physically removed the qty (so T-07 can
     trace the FIFO cost when restocking unused items). */
  out_line_id uuid REFERENCES stock_entry_lines(id),
  /* Snapshot of fifo_consumptions for this reservation — array of
     {layer_id, qty, unit_cost}. Lets the handover RPC re-create
     equivalent layers when unused stock comes back. */
  fifo_consumptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  /* Tracks how much has already been put back. Decrements when T-07
     handover row of source_type='unused_swap_stock' confirms. */
  qty_returned_in_base_uom numeric(18, 6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_swap_entry ON swap_stock_movements (stock_entry_id);
CREATE INDEX IF NOT EXISTS idx_swap_delivery ON swap_stock_movements (delivery_id);
CREATE INDEX IF NOT EXISTS idx_swap_open
  ON swap_stock_movements (org_id, stock_entry_id)
  WHERE qty_returned_in_base_uom < qty_in_base_uom;

ALTER TABLE swap_stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_iso_swap ON swap_stock_movements
  USING (org_id = public.user_org_id())
  WITH CHECK (org_id = public.user_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON swap_stock_movements TO authenticated;

COMMENT ON TABLE swap_stock_movements IS
  'T-12: spare stock the driver took on a route just-in-case for customer exchanges. Created at picking time, consumed FIFO from sale_stock. T-07 driver handover lists the unused portion (qty_in_base_uom - qty_returned_in_base_uom > 0) for restock.';


-- ####################################################################
-- # 050_payroll.sql
-- ####################################################################

-- ====================================================================
-- T-16: Bảng lương — payroll_runs + payroll_run_items
--
-- Header (payroll_runs) = one (org, month) period; items = per-user
-- breakdown. Sits alongside the existing legacy hr_payroll table — the
-- Pack3 flow stores the canonical breakdown here and uses the existing
-- hr_payroll row only for display compatibility with the legacy
-- /hr/payroll page.
--
-- Compute pulls from:
--   - hr_attendance / hr_salary_config (existing)
--   - salary_kpi_tiers              (T-15 mig 043)
--   - salary_order_count_bonus_configs (T-15 mig 043)
--   - monthly_activity_bonuses       (T-15 mig 043)
--   - sales_orders                   (revenue per user per month)
-- ====================================================================

CREATE TABLE IF NOT EXISTS payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  /* First day of the period (yyyy-mm-01 by convention). */
  month date NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'locked')),
  computed_at timestamptz,
  locked_at timestamptz,
  locked_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  UNIQUE (org_id, month)
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_status
  ON payroll_runs (org_id, status, month DESC);

CREATE TABLE IF NOT EXISTS payroll_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  base_salary numeric(18, 2) NOT NULL DEFAULT 0,
  standard_workdays numeric(6, 2) NOT NULL DEFAULT 0,
  actual_workdays numeric(6, 2) NOT NULL DEFAULT 0,
  prorated_base numeric(18, 2) NOT NULL DEFAULT 0,
  kpi_bonus numeric(18, 2) NOT NULL DEFAULT 0,
  order_count_bonus numeric(18, 2) NOT NULL DEFAULT 0,
  activity_bonus numeric(18, 2) NOT NULL DEFAULT 0,
  overtime numeric(18, 2) NOT NULL DEFAULT 0,
  deductions numeric(18, 2) NOT NULL DEFAULT 0,
  social_insurance numeric(18, 2) NOT NULL DEFAULT 0,
  manual_adjustment numeric(18, 2) NOT NULL DEFAULT 0,
  net_salary numeric(18, 2) NOT NULL DEFAULT 0,
  notes text,
  computed_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payroll_run_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_items_user
  ON payroll_run_items (user_id);

ALTER TABLE payroll_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_run_items  ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_iso_pr ON payroll_runs
  USING (org_id = public.user_org_id()
         AND public.user_role() IN ('owner','manager'))
  WITH CHECK (org_id = public.user_org_id()
              AND public.user_role() IN ('owner','manager'));

CREATE POLICY org_iso_pri ON payroll_run_items
  USING (EXISTS (
    SELECT 1 FROM payroll_runs pr
    WHERE pr.id = payroll_run_id
      AND pr.org_id = public.user_org_id()
      AND public.user_role() IN ('owner','manager')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM payroll_runs pr
    WHERE pr.id = payroll_run_id
      AND pr.org_id = public.user_org_id()
      AND public.user_role() IN ('owner','manager')
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_run_items TO authenticated;

-- --------------------------------------------------------------------
-- compute_payroll_run — recompute all items for a run from current
-- attendance / KPI tiers / order-count config / activity bonuses /
-- monthly revenue. Idempotent: deletes existing items first.
-- Cannot run on a locked run.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION compute_payroll_run(p_run_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org      uuid;
  v_month    date;
  v_status   text;
  v_period_start date;
  v_period_end   date;
  u          record;
  v_revenue  numeric;
  v_base_salary numeric;
  v_std_days numeric;
  v_act_days numeric;
  v_prorated numeric;
  v_kpi      numeric;
  v_kpi_tier record;
  v_oc_cfg   record;
  v_oc_count int;
  v_oc_bonus numeric;
  v_activity numeric;
  v_si       numeric;
  v_net      numeric;
  v_count    int := 0;
BEGIN
  SELECT org_id, month, status INTO v_org, v_month, v_status
  FROM payroll_runs WHERE id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYROLL_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'locked' THEN
    RAISE EXCEPTION 'PAYROLL_RUN_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  v_period_start := v_month;
  v_period_end := (v_month + interval '1 month - 1 day')::date;

  -- Wipe & recompute.
  DELETE FROM payroll_run_items WHERE payroll_run_id = p_run_id;

  -- hr_salary_config is org-scoped (one active row per org). Pull
  -- base_salary + working_days_per_month once per run.
  SELECT
    COALESCE(MAX(base_salary), 0)::numeric AS base,
    COALESCE(MAX(working_days_per_month), 26)::numeric AS std
  INTO v_base_salary, v_std_days
  FROM hr_salary_config
  WHERE org_id = v_org
    AND COALESCE(is_active, true) = true;

  FOR u IN
    SELECT id, full_name, role
    FROM users
    WHERE org_id = v_org
      AND COALESCE(is_active, true) = true
  LOOP
    -- Actual days from per-user attendance rows in the period.
    SELECT
      COUNT(*) FILTER (WHERE status IN ('present','holiday'))::numeric
      + 0.5 * COUNT(*) FILTER (WHERE status = 'half_day')::numeric
    INTO v_act_days
    FROM hr_attendance
    WHERE user_id = u.id
      AND work_date BETWEEN v_period_start AND v_period_end;
    v_act_days := COALESCE(v_act_days, 0);

    IF v_std_days > 0 THEN
      v_prorated := round((v_base_salary / v_std_days) * v_act_days, 0);
    ELSE
      v_prorated := 0;
    END IF;

    -- Monthly revenue (paid + delivered orders within period).
    SELECT COALESCE(SUM(total), 0) INTO v_revenue
    FROM sales_orders
    WHERE sales_user_id = u.id
      AND status IN ('delivered','confirmed')
      AND order_date BETWEEN v_period_start AND v_period_end;

    -- KPI tier — pick highest tier whose min_revenue is met.
    v_kpi := 0;
    SELECT min_revenue, bonus_type, bonus_value
      INTO v_kpi_tier
    FROM salary_kpi_tiers
    WHERE user_id = u.id AND month = v_month
      AND min_revenue <= v_revenue
    ORDER BY min_revenue DESC
    LIMIT 1;
    IF FOUND THEN
      IF v_kpi_tier.bonus_type = 'percent' THEN
        v_kpi := round(v_revenue * v_kpi_tier.bonus_value / 100, 0);
      ELSE
        v_kpi := v_kpi_tier.bonus_value;
      END IF;
    END IF;

    -- Order-count bonus — apply latest config that overlaps this month.
    v_oc_bonus := 0;
    SELECT min_order_count, min_order_value, bonus_per_order, period
      INTO v_oc_cfg
    FROM salary_order_count_bonus_configs
    WHERE user_id = u.id
      AND effective_from <= v_period_end
      AND (effective_to IS NULL OR effective_to >= v_period_start)
    ORDER BY effective_from DESC
    LIMIT 1;
    IF FOUND THEN
      SELECT count(*) INTO v_oc_count
      FROM sales_orders
      WHERE sales_user_id = u.id
        AND status IN ('delivered','confirmed')
        AND order_date BETWEEN v_period_start AND v_period_end
        AND total >= v_oc_cfg.min_order_value;
      IF v_oc_count >= v_oc_cfg.min_order_count THEN
        v_oc_bonus := v_oc_count * v_oc_cfg.bonus_per_order;
      END IF;
    END IF;

    -- Activity bonus (manual entry per user/month).
    SELECT COALESCE(SUM(amount), 0) INTO v_activity
    FROM monthly_activity_bonuses
    WHERE user_id = u.id AND month = v_month;

    -- Social insurance — flat 10.5% of base salary (BHXH 8 + BHYT 1.5 + BHTN 1).
    v_si := round(v_base_salary * 0.105, 0);

    v_net := v_prorated + v_kpi + v_oc_bonus + v_activity - v_si;

    INSERT INTO payroll_run_items (
      payroll_run_id, user_id,
      base_salary, standard_workdays, actual_workdays, prorated_base,
      kpi_bonus, order_count_bonus, activity_bonus,
      overtime, deductions, social_insurance,
      manual_adjustment, net_salary,
      computed_breakdown
    ) VALUES (
      p_run_id, u.id,
      v_base_salary, v_std_days, v_act_days, v_prorated,
      v_kpi, v_oc_bonus, v_activity,
      0, 0, v_si,
      0, v_net,
      jsonb_build_object(
        'revenue', v_revenue,
        'kpi_tier_min_revenue', COALESCE(v_kpi_tier.min_revenue, 0),
        'kpi_bonus_type', v_kpi_tier.bonus_type,
        'kpi_bonus_value', v_kpi_tier.bonus_value,
        'oc_count', COALESCE(v_oc_count, 0),
        'oc_min_count', COALESCE(v_oc_cfg.min_order_count, 0),
        'oc_min_value', COALESCE(v_oc_cfg.min_order_value, 0),
        'oc_bonus_per_order', COALESCE(v_oc_cfg.bonus_per_order, 0)
      )
    );
    v_count := v_count + 1;
  END LOOP;

  UPDATE payroll_runs
  SET computed_at = now()
  WHERE id = p_run_id;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION compute_payroll_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compute_payroll_run(uuid) TO authenticated;

-- --------------------------------------------------------------------
-- lock_payroll_run — final sign-off; once locked, items are read-only.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lock_payroll_run(p_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM payroll_runs WHERE id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYROLL_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  UPDATE payroll_runs
  SET status = 'locked',
      locked_at = now(),
      locked_by = auth.uid()
  WHERE id = p_run_id
    AND status = 'draft';
END;
$$;

REVOKE EXECUTE ON FUNCTION lock_payroll_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_payroll_run(uuid) TO authenticated;

-- --------------------------------------------------------------------
-- Trigger: block any UPDATE/DELETE on items once run is locked.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_payroll_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
  v_run uuid;
BEGIN
  v_run := COALESCE(NEW.payroll_run_id, OLD.payroll_run_id);
  SELECT status INTO v_status FROM payroll_runs WHERE id = v_run;
  IF v_status = 'locked' THEN
    RAISE EXCEPTION 'PAYROLL_RUN_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_payroll_lock ON payroll_run_items;
CREATE TRIGGER trg_enforce_payroll_lock
  BEFORE UPDATE OR DELETE ON payroll_run_items
  FOR EACH ROW EXECUTE FUNCTION enforce_payroll_lock();


-- ####################################################################
-- # 051_handover_swap_link.sql
-- ####################################################################

-- ====================================================================
-- T-07/T-12 follow-up (Q7): link driver_handover_items rows of
-- source_type='unused_swap_stock' back to the originating
-- swap_stock_movements row so the confirm RPC can bump
-- qty_returned_in_base_uom and the next handover view knows what's
-- still unused.
-- ====================================================================

ALTER TABLE driver_handover_items
  ADD COLUMN IF NOT EXISTS swap_movement_id uuid
    REFERENCES swap_stock_movements(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dhi_swap
  ON driver_handover_items(swap_movement_id)
  WHERE swap_movement_id IS NOT NULL;

-- --------------------------------------------------------------------
-- Update confirm_driver_handover to also increment qty_returned on
-- the linked swap_stock_movements row when the item is from an
-- unused_swap_stock source.
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
      SELECT id, source_type, swap_movement_id,
             product_id, qty, unit_name, conversion_factor,
             qty_in_base_uom, destination_zone, unit_cost
      FROM driver_handover_items
      WHERE handover_id = p_handover_id
    LOOP
      v_seq := v_seq + 1;

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

      UPDATE batches
      SET qty_on_hand = qty_on_hand + r.qty_in_base_uom
      WHERE id = v_batch_id;

      INSERT INTO fifo_layers (
        org_id, product_id, warehouse_zone,
        source_line_id, qty_in_base_uom_remaining, unit_cost, posting_at
      ) VALUES (
        v_org, r.product_id, r.destination_zone,
        v_line_id, r.qty_in_base_uom, COALESCE(r.unit_cost, 0), now()
      );

      -- Q7: when this row was 'unused_swap_stock', bump the linked
      -- movement's returned-qty so future handover views drop it.
      IF r.source_type = 'unused_swap_stock' AND r.swap_movement_id IS NOT NULL THEN
        UPDATE swap_stock_movements
        SET qty_returned_in_base_uom = qty_returned_in_base_uom + r.qty_in_base_uom
        WHERE id = r.swap_movement_id;
      END IF;
    END LOOP;
  END IF;

  -- 3) Stamp handover + close out the delivery.
  UPDATE driver_handovers
  SET status = 'confirmed',
      confirmed_at = now()
  WHERE id = p_handover_id;

  UPDATE deliveries
  SET status = 'completed',
      completed_at = COALESCE(completed_at, now())
  WHERE id = v_delivery;

  -- 4) Close any open workflow_session(s) for this delivery.
  UPDATE workflow_sessions
  SET closed_at = now()
  WHERE entity_type = 'delivery'
    AND entity_id   = v_delivery
    AND closed_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION confirm_driver_handover(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confirm_driver_handover(uuid) TO authenticated;


-- ####################################################################
-- # 052_order_activity_log.sql
-- ####################################################################

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


-- ####################################################################
-- # 053_entity_locks_cron.sql
-- ####################################################################

-- ====================================================================
-- T-06 follow-up: schedule pg_cron job to release stale entity_locks
-- without relying on user activity.
--
-- Mig 046 already implements lazy cleanup inside acquire_entity_lock /
-- heartbeat_entity_lock — that handles 99% of cases (active users
-- always trigger sweeps). This migration adds a passive once-per-minute
-- sweep so locks held by a tab that crashed without any peers ever
-- trying to acquire still get released within ~10-11 min.
--
-- Idempotent + tolerant: skip the cron schedule when the pg_cron
-- extension isn't available (self-hosted Supabase without it,
-- local dev). Lazy cleanup keeps everything functional in that case.
-- ====================================================================

DO $$
DECLARE
  v_has_cron boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) INTO v_has_cron;

  IF NOT v_has_cron THEN
    RAISE NOTICE 'pg_cron extension not installed — skipping schedule. Lazy cleanup in acquire/heartbeat continues to work.';
    RETURN;
  END IF;

  -- Unschedule previous version if it exists (idempotent rerun).
  PERFORM cron.unschedule('release-stale-entity-locks')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'release-stale-entity-locks'
  );

  PERFORM cron.schedule(
    'release-stale-entity-locks',
    '* * * * *',
    $cron$ SELECT public.release_stale_entity_locks(); $cron$
  );

  RAISE NOTICE 'Scheduled release-stale-entity-locks (every minute).';
END $$;


-- ####################################################################
-- # 054_user_has_permission_fix.sql
-- ####################################################################

-- ====================================================================
-- Bugfix: user_has_permission() resolver in mig 041 referenced
-- role_permissions.permission_key but the table (mig 022) only has
-- (role, module, action) columns. The original lookup raised
-- "column rp.permission_key does not exist" whenever the override
-- table didn't have an entry — so every fallback to role defaults
-- failed at runtime.
--
-- Rewrite to:
--   1. Override table wins exactly as before.
--   2. Fall back to role_permissions only when the requested key has
--      the shape "<module>.<action>" — split it back into the two
--      columns and check `allowed=true`.
--   3. Spec-flat keys ("customer.view_all", "warehouse.handover", …)
--      have no role_permissions row by design; for those, only the
--      override grants. Default = false.
-- Owner role still implicitly true (mig 041 already does that).
-- ====================================================================

CREATE OR REPLACE FUNCTION public.user_has_permission(p_user_id uuid, p_perm text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_override   boolean;
  v_role       text;
  v_module     text;
  v_action     text;
  v_dot        int;
BEGIN
  -- 1. Explicit override wins.
  SELECT granted INTO v_override
  FROM user_permission_overrides
  WHERE user_id = p_user_id AND permission_key = p_perm;
  IF FOUND THEN
    RETURN v_override;
  END IF;

  -- 2. Owner is always allowed (matches DEFAULT_PERMISSION_MAP).
  SELECT u.role INTO v_role FROM users u WHERE u.id = p_user_id;
  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role = 'owner' THEN RETURN true; END IF;

  -- 3. role_permissions fallback only when the key looks like
  --    "module.action" with EXACTLY one dot. Split + lookup.
  v_dot := position('.' IN p_perm);
  IF v_dot > 0 AND position('.' IN substring(p_perm FROM v_dot + 1)) = 0 THEN
    v_module := substring(p_perm FROM 1 FOR v_dot - 1);
    v_action := substring(p_perm FROM v_dot + 1);

    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'role_permissions'
    ) THEN
      RETURN COALESCE(
        (SELECT allowed FROM role_permissions rp
          WHERE rp.role = v_role
            AND rp.module = v_module
            AND rp.action = v_action
          LIMIT 1),
        false
      );
    END IF;
  END IF;

  -- Spec-flat keys ("customer.view_all", "warehouse.handover", …)
  -- have no role default — only override grants.
  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.user_has_permission(uuid, text) IS
  'Resolver — override > role_permissions[module,action] > false. Spec-flat keys without a "." or with multiple dots are override-only.';

REVOKE EXECUTE ON FUNCTION public.user_has_permission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_permission(uuid, text) TO authenticated;


-- ####################################################################
-- # 055_return_credit_excludes_exchange.sql
-- ####################################################################

-- ====================================================================
-- Bugfix: returns.credit_note_amount must EXCLUDE return_lines where
-- is_exchange=true. Đổi hàng = vật chất ra/vào, không động đến công nợ.
--
-- Hiện tượng người dùng báo: "có 1 mã đổi hàng + 1 mã trả hàng trừ
-- công nợ, nhưng tính cả 2 là trừ công nợ". Nguyên nhân: credit_note_
-- amount được set thủ công ở một số path (mig 035 chưa enforce auto-
-- compute), nên các phiếu cũ hoặc nhập tay có thể sai.
--
-- Fix:
--   1. SQL function compute_return_credit(return_id) tính sum line_total
--      của các return_lines KHÔNG phải exchange.
--   2. Trigger trên return_lines (INSERT/UPDATE/DELETE) recompute
--      credit_note_amount của return parent. Trở thành source-of-truth
--      cho mọi flow tạo/sửa return.
--   3. One-time backfill: cập nhật mọi returns hiện tại theo công thức
--      trên — sẽ giảm credit_note_amount của các return có lines
--      is_exchange=true.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. Compute helper. Returns 0 when the return has no lines (returns
--    can also be header-only credit notes — those keep their manually-
--    set credit_note_amount; trigger only kicks in when lines exist).
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION compute_return_credit(p_return_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    SUM(
      CASE
        WHEN COALESCE(rl.is_exchange, false) THEN 0
        ELSE COALESCE(rl.line_total, COALESCE(rl.unit_price, 0) * COALESCE(rl.quantity, 0))
      END
    ),
    0
  )::numeric
  FROM return_lines rl
  WHERE rl.return_id = p_return_id;
$$;

COMMENT ON FUNCTION compute_return_credit(uuid) IS
  'Bugfix: tổng line_total của return_lines KHÔNG đánh dấu is_exchange. Đổi hàng không trừ công nợ.';

-- --------------------------------------------------------------------
-- 2. Trigger: recompute credit_note_amount whenever lines change.
--    Only sets credit_note_amount when at least 1 line exists — header-
--    only credit notes (no lines) keep manual value.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_return_credit_note_amount()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_return_id uuid;
  v_line_count int;
  v_credit numeric;
BEGIN
  v_return_id := COALESCE(NEW.return_id, OLD.return_id);
  IF v_return_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  SELECT COUNT(*) INTO v_line_count
  FROM return_lines WHERE return_id = v_return_id;

  IF v_line_count = 0 THEN
    -- All lines deleted — leave credit_note_amount alone (could be a
    -- header-only credit note now).
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  v_credit := compute_return_credit(v_return_id);

  UPDATE returns
  SET credit_note_amount = v_credit
  WHERE id = v_return_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_return_credit ON return_lines;
CREATE TRIGGER trg_sync_return_credit
  AFTER INSERT OR UPDATE OR DELETE ON return_lines
  FOR EACH ROW
  EXECUTE FUNCTION sync_return_credit_note_amount();

-- --------------------------------------------------------------------
-- 3. One-time backfill — recompute every return that has at least 1
--    line. Header-only credit notes keep manual amount.
-- --------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_old numeric;
  v_new numeric;
  v_diff_count int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT return_id FROM return_lines
  LOOP
    SELECT credit_note_amount INTO v_old FROM returns WHERE id = r.return_id;
    v_new := compute_return_credit(r.return_id);
    IF v_old IS DISTINCT FROM v_new THEN
      UPDATE returns SET credit_note_amount = v_new WHERE id = r.return_id;
      v_diff_count := v_diff_count + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Backfilled credit_note_amount for % returns', v_diff_count;
END $$;

-- --------------------------------------------------------------------
-- 4. Recompute receivables for every order whose return changed —
--    keep AR consistent with the new credit_note_amount.
--    We touch only orders that have at least 1 return.
-- --------------------------------------------------------------------
DO $$
DECLARE
  o record;
  v_total numeric;
  v_credits numeric;
  v_paid numeric;
  v_net numeric;
  v_status text;
BEGIN
  FOR o IN
    SELECT DISTINCT so.id AS order_id, so.total
    FROM sales_orders so
    JOIN returns r ON r.order_id = so.id
  LOOP
    SELECT COALESCE(SUM(credit_note_amount), 0)
      INTO v_credits
    FROM returns
    WHERE order_id = o.order_id
      AND status IN ('approved', 'completed');

    v_net := GREATEST(0, COALESCE(o.total, 0) - v_credits);

    SELECT COALESCE(paid, 0) INTO v_paid
    FROM receivables
    WHERE order_id = o.order_id
    LIMIT 1;
    v_paid := COALESCE(v_paid, 0);

    v_status := CASE
      WHEN v_paid >= v_net THEN 'paid'
      WHEN v_paid > 0      THEN 'partial'
      ELSE 'open'
    END;

    UPDATE receivables
    SET amount = v_net,
        status = v_status
    WHERE order_id = o.order_id;
  END LOOP;
END $$;


-- ####################################################################
-- # 056_deliveries_source_stock_entry.sql
-- ####################################################################

-- ====================================================================
-- Self-deliver flow tạo 1 delivery row để T-07 handover dùng được
-- sau khi thu tiền (User feedback: "Bước Nhận bàn giao lại từ lái xe
-- chưa thấy" sau bước thu tiền + in phiếu thu trong flow tự giao).
--
-- Cột mới deliveries.source_stock_entry_id liên kết delivery với
-- stock_entry gốc (idempotent — re-self-deliver cùng entry không
-- duplicate). Nullable cho legacy deliveries.
-- ====================================================================

ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS source_stock_entry_id uuid
    REFERENCES stock_entries(id) ON DELETE SET NULL;

-- 1 delivery per stock_entry; lookup nhanh khi self-deliver retry.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_deliveries_source_stock_entry
  ON deliveries (source_stock_entry_id)
  WHERE source_stock_entry_id IS NOT NULL;

COMMENT ON COLUMN deliveries.source_stock_entry_id IS
  'Self-deliver flow (NPP/chủ xe tự giao) tạo delivery này từ 1 stock_entry. UNIQUE để re-trigger không duplicate. Legacy deliveries (lái xe) → null.';


-- ####################################################################
-- # 057_handover_batch_code_fix.sql
-- ####################################################################

-- ====================================================================
-- Fix confirm_driver_handover RPC: tạo batch mới khi cần restock
-- nhưng INSERT thiếu các cột NOT NULL của bảng batches:
--   • batch_code   → "BG-<entry_code>-<short_pid>"
--   • expires_at   → '2099-12-31' (sentinel cho "không hết hạn")
--   • qty_initial  → bằng qty_on_hand vào lúc tạo
-- Lỗi user gặp ở UI:
--   "null value in column \"batch_code\" of relation \"batches\"
--    violates not-null constraint"
-- ====================================================================

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
  v_entry_code text;
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
  IF EXISTS (SELECT 1 FROM driver_handover_items WHERE handover_id = p_handover_id) THEN
    v_entry_code := 'BG-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS');
    INSERT INTO stock_entries (
      org_id, entry_code, type, status, posted_at, created_by, notes, ref_order_ids
    ) VALUES (
      v_org,
      v_entry_code,
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
      SELECT id, source_type, swap_movement_id,
             product_id, qty, unit_name, conversion_factor,
             qty_in_base_uom, destination_zone, unit_cost
      FROM driver_handover_items
      WHERE handover_id = p_handover_id
    LOOP
      v_seq := v_seq + 1;

      SELECT id INTO v_batch_id
      FROM batches
      WHERE org_id = v_org
        AND product_id = r.product_id
        AND COALESCE(warehouse_zone, 'sale') = r.destination_zone
      ORDER BY created_at ASC
      LIMIT 1;

      IF v_batch_id IS NULL THEN
        -- Schema yêu cầu batch_code + expires_at + qty_initial NOT NULL.
        -- Sentinel expires_at='2099-12-31' = "không hết hạn / không
        -- track date". Code giải mã: BG-<entry_code>-<seq>-<pid_4>.
        INSERT INTO batches (
          org_id, product_id, warehouse_zone,
          batch_code, expires_at,
          qty_initial, qty_on_hand, unit_cost
        ) VALUES (
          v_org, r.product_id, r.destination_zone,
          v_entry_code || '-' || lpad(v_seq::text, 2, '0') || '-' || substr(r.product_id::text, 1, 4),
          '2099-12-31',
          0, 0, COALESCE(r.unit_cost, 0)
        )
        RETURNING id INTO v_batch_id;
      END IF;

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

      UPDATE batches
      SET qty_on_hand = qty_on_hand + r.qty_in_base_uom,
          qty_initial = qty_initial + r.qty_in_base_uom
      WHERE id = v_batch_id;

      INSERT INTO fifo_layers (
        org_id, product_id, warehouse_zone,
        source_line_id, qty_in_base_uom_remaining, unit_cost, posting_at
      ) VALUES (
        v_org, r.product_id, r.destination_zone,
        v_line_id, r.qty_in_base_uom, COALESCE(r.unit_cost, 0), now()
      );

      -- Q7: when this row was 'unused_swap_stock', bump the linked
      -- movement's returned-qty so future handover views drop it.
      IF r.source_type = 'unused_swap_stock' AND r.swap_movement_id IS NOT NULL THEN
        UPDATE swap_stock_movements
        SET qty_returned_in_base_uom = qty_returned_in_base_uom + r.qty_in_base_uom
        WHERE id = r.swap_movement_id;
      END IF;
    END LOOP;
  END IF;

  -- 3) Stamp handover + close out the delivery.
  UPDATE driver_handovers
  SET status = 'confirmed',
      confirmed_at = now()
  WHERE id = p_handover_id;

  UPDATE deliveries
  SET status = 'completed',
      completed_at = COALESCE(completed_at, now())
  WHERE id = v_delivery;

  -- 4) Close any open workflow_session(s) for this delivery.
  UPDATE workflow_sessions
  SET closed_at = now()
  WHERE entity_type = 'delivery'
    AND entity_id   = v_delivery
    AND closed_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION confirm_driver_handover(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confirm_driver_handover(uuid) TO authenticated;


-- ####################################################################
-- # 058_user_has_permission_split_last_dot.sql
-- ####################################################################

-- ====================================================================
-- Bugfix: user_has_permission resolver phải split key trên dấu chấm
-- CUỐI để hỗ trợ feature-level keys.
--
-- Mig 022 cho phép role_permissions.module chứa feature key có dot
-- (vd "customers.analytics"). Khi user override với key
-- "customers.analytics.read", mig 054 split trên dot ĐẦU (module=
-- "customers", action="analytics.read") — sai.
--
-- Fix: split trên dot cuối → module="customers.analytics", action="read".
-- Vẫn cover keys 1-dot bình thường (orders.read → orders/read).
-- Spec-flat keys (customer.view_all, warehouse.handover…) không có
-- row trong role_permissions nên fallback trả false — override-only
-- behavior được giữ nguyên.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.user_has_permission(p_user_id uuid, p_perm text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_override   boolean;
  v_role       text;
  v_module     text;
  v_action     text;
  v_last_dot   int;
BEGIN
  -- 1. Explicit override wins.
  SELECT granted INTO v_override
  FROM user_permission_overrides
  WHERE user_id = p_user_id AND permission_key = p_perm;
  IF FOUND THEN
    RETURN v_override;
  END IF;

  -- 2. Owner is always allowed.
  SELECT u.role INTO v_role FROM users u WHERE u.id = p_user_id;
  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role = 'owner' THEN RETURN true; END IF;

  -- 3. role_permissions fallback. Split p_perm trên dot CUỐI để
  --    feature keys như "customers.analytics.read" parse đúng:
  --      module  = "customers.analytics"
  --      action  = "read"
  --    Keys 1-dot vẫn ok (orders.read → "orders" / "read").
  --    Keys không có dot không có fallback (return false).
  v_last_dot := length(p_perm) - position('.' IN reverse(p_perm)) + 1;
  IF v_last_dot > 1 AND v_last_dot < length(p_perm) THEN
    v_module := substring(p_perm FROM 1 FOR v_last_dot - 1);
    v_action := substring(p_perm FROM v_last_dot + 1);

    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'role_permissions'
    ) THEN
      RETURN COALESCE(
        (SELECT allowed FROM role_permissions rp
          WHERE rp.role = v_role
            AND rp.module = v_module
            AND rp.action = v_action
          LIMIT 1),
        false
      );
    END IF;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.user_has_permission(uuid, text) IS
  'Resolver — override > role_permissions[<feature_or_module>, <action>] > false. Split trên dot cuối để feature keys (customers.analytics.read) parse đúng.';

REVOKE EXECUTE ON FUNCTION public.user_has_permission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_permission(uuid, text) TO authenticated;


-- ####################################################################
-- # 059_allow_delivering_to_cancelled.sql
-- ####################################################################

-- ====================================================================
-- Fix: handover RPC fails when failed orders are still in 'delivering'.
--
-- The check_order_status_transition trigger from mig 008 blocked
--   delivering → cancelled
-- which made confirm_driver_handover (mig 047) raise:
--   "Không thể chuyển từ đang giao sang cancelled"
-- whenever the user marked at least one order as giao thất bại on
-- the bàn-giao-lại screen.
--
-- The handover-back flow is exactly that semantic: driver returns,
-- order didn't deliver, status flips to 'cancelled' +
-- current_workflow_stage = 'delivery_failed'. Allow it.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.check_order_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text;
  auto_threshold numeric := 20000000;
  manager_threshold numeric := 50000000;
BEGIN
  -- Only check when status changes
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  caller_role := public.user_role();

  -- Validate transitions
  IF OLD.status = 'draft' AND NEW.status NOT IN ('confirmed', 'cancelled') THEN
    RAISE EXCEPTION 'Không thể chuyển từ nháp sang %', NEW.status;
  END IF;
  IF OLD.status = 'confirmed' AND NEW.status NOT IN ('picking', 'cancelled') THEN
    RAISE EXCEPTION 'Không thể chuyển từ đã duyệt sang %', NEW.status;
  END IF;
  IF OLD.status = 'picking' AND NEW.status NOT IN ('delivering', 'cancelled') THEN
    RAISE EXCEPTION 'Không thể chuyển từ đang lấy sang %', NEW.status;
  END IF;
  -- delivering → delivered (giao thành công) hoặc cancelled (giao thất bại,
  -- bàn giao lại). Cả hai đều hợp lệ trong nghiệp vụ.
  IF OLD.status = 'delivering' AND NEW.status NOT IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'Không thể chuyển từ đang giao sang %', NEW.status;
  END IF;
  IF OLD.status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'Đơn đã hoàn tất/hủy, không thể đổi trạng thái';
  END IF;

  -- Approval check: draft → confirmed
  IF OLD.status = 'draft' AND NEW.status = 'confirmed' THEN
    IF OLD.total >= manager_threshold AND caller_role != 'owner' THEN
      RAISE EXCEPTION 'Đơn >= 50 triệu cần Chủ NPP duyệt';
    END IF;
    IF OLD.total >= auto_threshold AND caller_role NOT IN ('owner', 'manager') THEN
      RAISE EXCEPTION 'Đơn >= 20 triệu cần Quản lý hoặc Chủ NPP duyệt';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


-- ####################################################################
-- # 060_payroll_skip_attendance.sql
-- ####################################################################

-- ====================================================================
-- Lương tính không cần chấm công (per user feedback).
--
-- Trước: compute_payroll_run prorate base_salary theo số ngày công
-- thực tế trong hr_attendance:
--   prorated = base / std_days * actual_days
-- Sau: bỏ phần proration, lấy nguyên base_salary cho mọi NV active
-- trong kỳ. Cột actual_workdays vẫn ghi để audit nhưng không ảnh
-- hưởng lương.
-- ====================================================================

CREATE OR REPLACE FUNCTION compute_payroll_run(p_run_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org      uuid;
  v_month    date;
  v_status   text;
  v_period_start date;
  v_period_end   date;
  u          record;
  v_revenue  numeric;
  v_base_salary numeric;
  v_std_days numeric;
  v_act_days numeric;
  v_prorated numeric;
  v_kpi      numeric;
  v_kpi_tier record;
  v_oc_cfg   record;
  v_oc_count int;
  v_oc_bonus numeric;
  v_activity numeric;
  v_si       numeric;
  v_net      numeric;
  v_count    int := 0;
BEGIN
  SELECT org_id, month, status INTO v_org, v_month, v_status
  FROM payroll_runs WHERE id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYROLL_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'locked' THEN
    RAISE EXCEPTION 'PAYROLL_RUN_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  v_period_start := v_month;
  v_period_end := (v_month + interval '1 month - 1 day')::date;

  DELETE FROM payroll_run_items WHERE payroll_run_id = p_run_id;

  SELECT
    COALESCE(MAX(base_salary), 0)::numeric AS base,
    COALESCE(MAX(working_days_per_month), 26)::numeric AS std
  INTO v_base_salary, v_std_days
  FROM hr_salary_config
  WHERE org_id = v_org
    AND COALESCE(is_active, true) = true;

  FOR u IN
    SELECT id, full_name, role
    FROM users
    WHERE org_id = v_org
      AND COALESCE(is_active, true) = true
  LOOP
    -- Vẫn đếm số ngày công thực tế để audit (hiển thị trong payroll
    -- breakdown), nhưng KHÔNG dùng để prorate lương cơ bản.
    SELECT
      COUNT(*) FILTER (WHERE status IN ('present','holiday'))::numeric
      + 0.5 * COUNT(*) FILTER (WHERE status = 'half_day')::numeric
    INTO v_act_days
    FROM hr_attendance
    WHERE user_id = u.id
      AND work_date BETWEEN v_period_start AND v_period_end;
    v_act_days := COALESCE(v_act_days, 0);

    -- Lương cơ bản FULL — không prorate theo chấm công.
    v_prorated := v_base_salary;

    SELECT COALESCE(SUM(total), 0) INTO v_revenue
    FROM sales_orders
    WHERE sales_user_id = u.id
      AND status IN ('delivered','confirmed')
      AND order_date BETWEEN v_period_start AND v_period_end;

    v_kpi := 0;
    SELECT min_revenue, bonus_type, bonus_value
      INTO v_kpi_tier
    FROM salary_kpi_tiers
    WHERE user_id = u.id AND month = v_month
      AND min_revenue <= v_revenue
    ORDER BY min_revenue DESC
    LIMIT 1;
    IF FOUND THEN
      IF v_kpi_tier.bonus_type = 'percent' THEN
        v_kpi := round(v_revenue * v_kpi_tier.bonus_value / 100, 0);
      ELSE
        v_kpi := v_kpi_tier.bonus_value;
      END IF;
    END IF;

    v_oc_bonus := 0;
    SELECT min_order_count, min_order_value, bonus_per_order, period
      INTO v_oc_cfg
    FROM salary_order_count_bonus_configs
    WHERE user_id = u.id
      AND effective_from <= v_period_end
      AND (effective_to IS NULL OR effective_to >= v_period_start)
    ORDER BY effective_from DESC
    LIMIT 1;
    IF FOUND THEN
      SELECT count(*) INTO v_oc_count
      FROM sales_orders
      WHERE sales_user_id = u.id
        AND status IN ('delivered','confirmed')
        AND order_date BETWEEN v_period_start AND v_period_end
        AND total >= v_oc_cfg.min_order_value;
      IF v_oc_count >= v_oc_cfg.min_order_count THEN
        v_oc_bonus := v_oc_count * v_oc_cfg.bonus_per_order;
      END IF;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_activity
    FROM monthly_activity_bonuses
    WHERE user_id = u.id AND month = v_month;

    v_si := round(v_base_salary * 0.105, 0);

    v_net := v_prorated + v_kpi + v_oc_bonus + v_activity - v_si;

    INSERT INTO payroll_run_items (
      payroll_run_id, user_id,
      base_salary, standard_workdays, actual_workdays, prorated_base,
      kpi_bonus, order_count_bonus, activity_bonus,
      overtime, deductions, social_insurance,
      manual_adjustment, net_salary,
      computed_breakdown
    ) VALUES (
      p_run_id, u.id,
      v_base_salary, v_std_days, v_act_days, v_prorated,
      v_kpi, v_oc_bonus, v_activity,
      0, 0, v_si,
      0, v_net,
      jsonb_build_object(
        'revenue', v_revenue,
        'kpi_tier_min_revenue', COALESCE(v_kpi_tier.min_revenue, 0),
        'kpi_bonus_type', v_kpi_tier.bonus_type,
        'kpi_bonus_value', v_kpi_tier.bonus_value,
        'oc_count', COALESCE(v_oc_count, 0),
        'oc_min_count', COALESCE(v_oc_cfg.min_order_count, 0),
        'oc_min_value', COALESCE(v_oc_cfg.min_order_value, 0),
        'oc_bonus_per_order', COALESCE(v_oc_cfg.bonus_per_order, 0),
        'attendance_skipped', true
      )
    );
    v_count := v_count + 1;
  END LOOP;

  UPDATE payroll_runs
  SET computed_at = now()
  WHERE id = p_run_id;

  RETURN v_count;
END;
$$;


-- ####################################################################
-- # 061_hr_salary_kpi_target_revenue.sql
-- ####################################################################

-- ====================================================================
-- Mức thưởng KPI: 1 ô doanh số chung A + bậc thưởng cộng dồn theo
-- % của A (per user feedback).
--
-- Trước: mỗi tier có min_revenue / min_percent riêng.
-- Sau: hr_salary_config.kpi_target_revenue = mức doanh số chung A.
--   target_tiers = [{min_percent, bonus, label}, ...] — bonus cộng
--   dồn. Đạt 70% A → +bonus(70). Đạt 80% A → +bonus(70)+bonus(80).
--   v.v.
-- ====================================================================

ALTER TABLE hr_salary_config
  ADD COLUMN IF NOT EXISTS kpi_target_revenue numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN hr_salary_config.kpi_target_revenue IS
  'Mức doanh số chung A để tính % KPI. Bậc trong target_tiers dùng min_percent so với A; bonus cộng dồn.';


-- ####################################################################
-- # 062_payroll_kpi_cumulative.sql
-- ####################################################################

-- ====================================================================
-- Payroll: thưởng KPI tính CỘNG DỒN theo % của doanh số chung A
-- (hr_salary_config.kpi_target_revenue + target_tiers).
--
-- Mô hình mới (per user feedback):
--   pct = doanh_số_NV / A * 100
--   kpi_bonus = SUM(bonus) của mọi bậc có min_percent <= pct
--   → Đạt 70%A: +x1. Đạt 80%A: +x1+x2. Đạt 90%A: +x1+x2+x3. v.v.
--
-- Per-user salary_kpi_tiers (mig 043) vẫn còn để override nếu org
-- muốn cấu hình riêng cho 1 NV — khi NV có dòng tiers riêng cho
-- tháng đó thì dùng dòng đó (model cũ: pick bậc cao nhất). Mặc định
-- (không có dòng riêng) → dùng org config cộng dồn.
-- ====================================================================

CREATE OR REPLACE FUNCTION compute_payroll_run(p_run_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org      uuid;
  v_month    date;
  v_status   text;
  v_period_start date;
  v_period_end   date;
  u          record;
  v_revenue  numeric;
  v_base_salary numeric;
  v_std_days numeric;
  v_act_days numeric;
  v_prorated numeric;
  v_kpi      numeric;
  v_kpi_tier record;
  v_kpi_per_user bool;
  v_kpi_target numeric;
  v_kpi_tiers  jsonb;
  v_kpi_pct    numeric;
  v_oc_cfg   record;
  v_oc_count int;
  v_oc_bonus numeric;
  v_activity numeric;
  v_si       numeric;
  v_net      numeric;
  v_count    int := 0;
BEGIN
  SELECT org_id, month, status INTO v_org, v_month, v_status
  FROM payroll_runs WHERE id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYROLL_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'locked' THEN
    RAISE EXCEPTION 'PAYROLL_RUN_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  v_period_start := v_month;
  v_period_end := (v_month + interval '1 month - 1 day')::date;

  DELETE FROM payroll_run_items WHERE payroll_run_id = p_run_id;

  -- Org-level config: base salary + KPI target A + cumulative tiers.
  SELECT
    COALESCE(MAX(base_salary), 0)::numeric,
    COALESCE(MAX(working_days_per_month), 26)::numeric,
    COALESCE(MAX(kpi_target_revenue), 0)::numeric,
    (SELECT target_tiers FROM hr_salary_config
       WHERE org_id = v_org AND COALESCE(is_active, true) = true
       ORDER BY created_at DESC LIMIT 1)
  INTO v_base_salary, v_std_days, v_kpi_target, v_kpi_tiers
  FROM hr_salary_config
  WHERE org_id = v_org
    AND COALESCE(is_active, true) = true;
  v_kpi_tiers := COALESCE(v_kpi_tiers, '[]'::jsonb);

  FOR u IN
    SELECT id, full_name, role
    FROM users
    WHERE org_id = v_org
      AND COALESCE(is_active, true) = true
  LOOP
    -- Ngày công thực tế (chỉ để audit, không prorate — mig 060).
    SELECT
      COUNT(*) FILTER (WHERE status IN ('present','holiday'))::numeric
      + 0.5 * COUNT(*) FILTER (WHERE status = 'half_day')::numeric
    INTO v_act_days
    FROM hr_attendance
    WHERE user_id = u.id
      AND work_date BETWEEN v_period_start AND v_period_end;
    v_act_days := COALESCE(v_act_days, 0);

    v_prorated := v_base_salary;

    -- Doanh số NV trong kỳ.
    SELECT COALESCE(SUM(total), 0) INTO v_revenue
    FROM sales_orders
    WHERE sales_user_id = u.id
      AND status IN ('delivered','confirmed')
      AND order_date BETWEEN v_period_start AND v_period_end;

    -- KPI bonus.
    v_kpi := 0;
    v_kpi_per_user := false;

    -- 1) Nếu NV có cấu hình tiers riêng cho tháng này → model cũ
    --    (pick bậc cao nhất pass min_revenue).
    SELECT min_revenue, bonus_type, bonus_value
      INTO v_kpi_tier
    FROM salary_kpi_tiers
    WHERE user_id = u.id AND month = v_month
      AND min_revenue <= v_revenue
    ORDER BY min_revenue DESC
    LIMIT 1;
    IF FOUND THEN
      v_kpi_per_user := true;
      IF v_kpi_tier.bonus_type = 'percent' THEN
        v_kpi := round(v_revenue * v_kpi_tier.bonus_value / 100, 0);
      ELSE
        v_kpi := v_kpi_tier.bonus_value;
      END IF;
    ELSIF v_kpi_target > 0 THEN
      -- 2) Mặc định: org config cộng dồn theo % của A.
      v_kpi_pct := v_revenue / v_kpi_target * 100;
      SELECT COALESCE(SUM((t->>'bonus')::numeric), 0)
        INTO v_kpi
      FROM jsonb_array_elements(v_kpi_tiers) AS t
      WHERE COALESCE((t->>'min_percent')::numeric, 0) <= v_kpi_pct;
      v_kpi := COALESCE(v_kpi, 0);
    END IF;

    -- Order-count bonus (không đổi).
    v_oc_bonus := 0;
    SELECT min_order_count, min_order_value, bonus_per_order, period
      INTO v_oc_cfg
    FROM salary_order_count_bonus_configs
    WHERE user_id = u.id
      AND effective_from <= v_period_end
      AND (effective_to IS NULL OR effective_to >= v_period_start)
    ORDER BY effective_from DESC
    LIMIT 1;
    IF FOUND THEN
      SELECT count(*) INTO v_oc_count
      FROM sales_orders
      WHERE sales_user_id = u.id
        AND status IN ('delivered','confirmed')
        AND order_date BETWEEN v_period_start AND v_period_end
        AND total >= v_oc_cfg.min_order_value;
      IF v_oc_count >= v_oc_cfg.min_order_count THEN
        v_oc_bonus := v_oc_count * v_oc_cfg.bonus_per_order;
      END IF;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_activity
    FROM monthly_activity_bonuses
    WHERE user_id = u.id AND month = v_month;

    v_si := round(v_base_salary * 0.105, 0);

    v_net := v_prorated + v_kpi + v_oc_bonus + v_activity - v_si;

    INSERT INTO payroll_run_items (
      payroll_run_id, user_id,
      base_salary, standard_workdays, actual_workdays, prorated_base,
      kpi_bonus, order_count_bonus, activity_bonus,
      overtime, deductions, social_insurance,
      manual_adjustment, net_salary,
      computed_breakdown
    ) VALUES (
      p_run_id, u.id,
      v_base_salary, v_std_days, v_act_days, v_prorated,
      v_kpi, v_oc_bonus, v_activity,
      0, 0, v_si,
      0, v_net,
      jsonb_build_object(
        'revenue', v_revenue,
        'kpi_target_revenue', v_kpi_target,
        'kpi_pct', CASE WHEN v_kpi_target > 0 THEN round(v_revenue / v_kpi_target * 100, 1) ELSE NULL END,
        'kpi_model', CASE WHEN v_kpi_per_user THEN 'per_user_tier' ELSE 'org_cumulative' END,
        'oc_count', COALESCE(v_oc_count, 0),
        'oc_min_count', COALESCE(v_oc_cfg.min_order_count, 0),
        'oc_min_value', COALESCE(v_oc_cfg.min_order_value, 0),
        'oc_bonus_per_order', COALESCE(v_oc_cfg.bonus_per_order, 0),
        'attendance_skipped', true
      )
    );
    v_count := v_count + 1;
  END LOOP;

  UPDATE payroll_runs
  SET computed_at = now()
  WHERE id = p_run_id;

  RETURN v_count;
END;
$$;


-- ####################################################################
-- # 063_payroll_low_perf_rules_vs_target.sql
-- ####################################################################

-- ====================================================================
-- Payroll: quy tắc hiệu suất thấp / vượt chỉ tiêu — cũng quy chiếu
-- theo mức doanh số chung A (hr_salary_config.kpi_target_revenue).
--
--   pct = doanh_số_NV / A * 100
--   - pct < 60%A  → KHÔNG có lương CB; lương = doanh_số × under_60_percent%
--                   ; không thưởng KPI.
--   - 60% ≤ pct < 70%A → giữ lương CB nhưng KHÔNG thưởng KPI.
--   - 70% ≤ pct ≤ 100%A → lương CB + thưởng KPI cộng dồn (mig 062).
--   - pct > 100%A → lương CB + thưởng KPI cộng dồn + (doanh_số − A) ×
--                   over_target_percent%.
--
-- Nếu NV có cấu hình salary_kpi_tiers riêng cho tháng đó → dùng model
-- cũ (pick bậc cao nhất pass min_revenue), KHÔNG áp các quy tắc trên.
-- ====================================================================

CREATE OR REPLACE FUNCTION compute_payroll_run(p_run_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org      uuid;
  v_month    date;
  v_status   text;
  v_period_start date;
  v_period_end   date;
  u          record;
  v_revenue  numeric;
  v_base_salary numeric;
  v_std_days numeric;
  v_act_days numeric;
  v_prorated numeric;
  v_kpi      numeric;
  v_kpi_tier record;
  v_kpi_per_user bool;
  v_kpi_target numeric;
  v_kpi_tiers  jsonb;
  v_kpi_pct    numeric;
  v_over_pct   numeric;
  v_under_60_pct numeric;
  v_low_perf   text;
  v_oc_cfg   record;
  v_oc_count int;
  v_oc_bonus numeric;
  v_activity numeric;
  v_si       numeric;
  v_net      numeric;
  v_count    int := 0;
BEGIN
  SELECT org_id, month, status INTO v_org, v_month, v_status
  FROM payroll_runs WHERE id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYROLL_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'locked' THEN
    RAISE EXCEPTION 'PAYROLL_RUN_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  v_period_start := v_month;
  v_period_end := (v_month + interval '1 month - 1 day')::date;

  DELETE FROM payroll_run_items WHERE payroll_run_id = p_run_id;

  SELECT
    COALESCE(MAX(base_salary), 0)::numeric,
    COALESCE(MAX(working_days_per_month), 26)::numeric,
    COALESCE(MAX(kpi_target_revenue), 0)::numeric,
    (SELECT target_tiers FROM hr_salary_config
       WHERE org_id = v_org AND COALESCE(is_active, true) = true
       ORDER BY created_at DESC LIMIT 1),
    COALESCE(MAX(over_target_percent), 0)::numeric,
    COALESCE(MAX(under_60_percent), 0)::numeric
  INTO v_base_salary, v_std_days, v_kpi_target, v_kpi_tiers, v_over_pct, v_under_60_pct
  FROM hr_salary_config
  WHERE org_id = v_org
    AND COALESCE(is_active, true) = true;
  v_kpi_tiers := COALESCE(v_kpi_tiers, '[]'::jsonb);

  FOR u IN
    SELECT id, full_name, role
    FROM users
    WHERE org_id = v_org
      AND COALESCE(is_active, true) = true
  LOOP
    SELECT
      COUNT(*) FILTER (WHERE status IN ('present','holiday'))::numeric
      + 0.5 * COUNT(*) FILTER (WHERE status = 'half_day')::numeric
    INTO v_act_days
    FROM hr_attendance
    WHERE user_id = u.id
      AND work_date BETWEEN v_period_start AND v_period_end;
    v_act_days := COALESCE(v_act_days, 0);

    SELECT COALESCE(SUM(total), 0) INTO v_revenue
    FROM sales_orders
    WHERE sales_user_id = u.id
      AND status IN ('delivered','confirmed')
      AND order_date BETWEEN v_period_start AND v_period_end;

    v_prorated := v_base_salary;   -- lương CB (mig 060: không prorate chấm công)
    v_kpi := 0;
    v_kpi_per_user := false;
    v_kpi_pct := NULL;
    v_low_perf := 'normal';

    -- 1) Per-user override (model cũ).
    SELECT min_revenue, bonus_type, bonus_value
      INTO v_kpi_tier
    FROM salary_kpi_tiers
    WHERE user_id = u.id AND month = v_month
      AND min_revenue <= v_revenue
    ORDER BY min_revenue DESC
    LIMIT 1;
    IF FOUND THEN
      v_kpi_per_user := true;
      IF v_kpi_tier.bonus_type = 'percent' THEN
        v_kpi := round(v_revenue * v_kpi_tier.bonus_value / 100, 0);
      ELSE
        v_kpi := v_kpi_tier.bonus_value;
      END IF;

    -- 2) Org config theo mức doanh số chung A.
    ELSIF v_kpi_target > 0 THEN
      v_kpi_pct := v_revenue / v_kpi_target * 100;

      IF v_kpi_pct < 60 THEN
        -- Dưới 60% A: không có lương CB, lương = doanh số × under_60%.
        v_low_perf := 'under_60';
        v_prorated := round(v_revenue * v_under_60_pct / 100, 0);
        v_kpi := 0;
      ELSIF v_kpi_pct < 70 THEN
        -- 60%–<70% A: giữ lương CB, không thưởng KPI.
        v_low_perf := 'under_70';
        v_kpi := 0;
      ELSE
        -- ≥70% A: lương CB + thưởng KPI cộng dồn.
        SELECT COALESCE(SUM((t->>'bonus')::numeric), 0)
          INTO v_kpi
        FROM jsonb_array_elements(v_kpi_tiers) AS t
        WHERE COALESCE((t->>'min_percent')::numeric, 0) <= v_kpi_pct;
        v_kpi := COALESCE(v_kpi, 0);
        -- Vượt 100% A: + (doanh số − A) × over_target%.
        IF v_kpi_pct > 100 AND v_over_pct > 0 THEN
          v_low_perf := 'over_100';
          v_kpi := v_kpi + round((v_revenue - v_kpi_target) * v_over_pct / 100, 0);
        END IF;
      END IF;
    END IF;

    -- Order-count bonus (không đổi).
    v_oc_bonus := 0;
    SELECT min_order_count, min_order_value, bonus_per_order, period
      INTO v_oc_cfg
    FROM salary_order_count_bonus_configs
    WHERE user_id = u.id
      AND effective_from <= v_period_end
      AND (effective_to IS NULL OR effective_to >= v_period_start)
    ORDER BY effective_from DESC
    LIMIT 1;
    IF FOUND THEN
      SELECT count(*) INTO v_oc_count
      FROM sales_orders
      WHERE sales_user_id = u.id
        AND status IN ('delivered','confirmed')
        AND order_date BETWEEN v_period_start AND v_period_end
        AND total >= v_oc_cfg.min_order_value;
      IF v_oc_count >= v_oc_cfg.min_order_count THEN
        v_oc_bonus := v_oc_count * v_oc_cfg.bonus_per_order;
      END IF;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_activity
    FROM monthly_activity_bonuses
    WHERE user_id = u.id AND month = v_month;

    -- BHXH 10.5% — tính trên phần "lương cơ bản hiệu lực" (v_prorated)
    -- để case dưới-60% không bị âm net.
    v_si := round(v_prorated * 0.105, 0);

    v_net := v_prorated + v_kpi + v_oc_bonus + v_activity - v_si;

    INSERT INTO payroll_run_items (
      payroll_run_id, user_id,
      base_salary, standard_workdays, actual_workdays, prorated_base,
      kpi_bonus, order_count_bonus, activity_bonus,
      overtime, deductions, social_insurance,
      manual_adjustment, net_salary,
      computed_breakdown
    ) VALUES (
      p_run_id, u.id,
      v_base_salary, v_std_days, v_act_days, v_prorated,
      v_kpi, v_oc_bonus, v_activity,
      0, 0, v_si,
      0, v_net,
      jsonb_build_object(
        'revenue', v_revenue,
        'kpi_target_revenue', v_kpi_target,
        'kpi_pct', CASE WHEN v_kpi_target > 0 THEN round(v_revenue / v_kpi_target * 100, 1) ELSE NULL END,
        'kpi_model', CASE WHEN v_kpi_per_user THEN 'per_user_tier' ELSE 'org_cumulative' END,
        'low_perf', v_low_perf,
        'over_target_percent', v_over_pct,
        'under_60_percent', v_under_60_pct,
        'oc_count', COALESCE(v_oc_count, 0),
        'oc_min_count', COALESCE(v_oc_cfg.min_order_count, 0),
        'oc_min_value', COALESCE(v_oc_cfg.min_order_value, 0),
        'oc_bonus_per_order', COALESCE(v_oc_cfg.bonus_per_order, 0),
        'attendance_skipped', true
      )
    );
    v_count := v_count + 1;
  END LOOP;

  UPDATE payroll_runs
  SET computed_at = now()
  WHERE id = p_run_id;

  RETURN v_count;
END;
$$;


-- ####################################################################
-- # 064_payroll_allowances_and_breakdown.sql
-- ####################################################################

-- ====================================================================
-- Payroll: thêm phụ cấp (xăng xe + điện thoại) vào lương + làm giàu
-- computed_breakdown để phiếu lương hiển thị chi tiết cách tính +
-- tham chiếu đơn hàng.
--
-- mig này:
--   1. ALTER payroll_run_items ADD COLUMN allowances.
--   2. compute_payroll_run:
--      - v_allowances = gas_allowance + phone_allowance (org config).
--      - net = prorated_base + allowances + kpi + oc + activity − si.
--      - computed_breakdown thêm: gas_allowance, phone_allowance,
--        kpi_tier_breakdown (mảng {min_percent, bonus, label, passed}),
--        oc_count, oc_min_count, oc_min_value, oc_bonus_per_order,
--        period_start/period_end. Danh sách đơn cụ thể: trang phiếu
--        lương tự query (period + sales_user_id).
-- ====================================================================

ALTER TABLE payroll_run_items
  ADD COLUMN IF NOT EXISTS allowances numeric(18, 2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION compute_payroll_run(p_run_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org      uuid;
  v_month    date;
  v_status   text;
  v_period_start date;
  v_period_end   date;
  u          record;
  v_revenue  numeric;
  v_base_salary numeric;
  v_gas      numeric;
  v_phone    numeric;
  v_allowances numeric;
  v_std_days numeric;
  v_act_days numeric;
  v_prorated numeric;
  v_kpi      numeric;
  v_kpi_partial numeric;
  v_kpi_tier record;
  v_kpi_per_user bool;
  v_kpi_target numeric;
  v_kpi_tiers  jsonb;
  v_kpi_pct    numeric;
  v_kpi_breakdown jsonb;
  v_over_pct   numeric;
  v_under_60_pct numeric;
  v_low_perf   text;
  v_oc_cfg   record;
  v_oc_count int;
  v_oc_bonus numeric;
  v_activity numeric;
  v_si       numeric;
  v_net      numeric;
  v_count    int := 0;
BEGIN
  SELECT org_id, month, status INTO v_org, v_month, v_status
  FROM payroll_runs WHERE id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYROLL_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'locked' THEN
    RAISE EXCEPTION 'PAYROLL_RUN_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  v_period_start := v_month;
  v_period_end := (v_month + interval '1 month - 1 day')::date;

  DELETE FROM payroll_run_items WHERE payroll_run_id = p_run_id;

  SELECT
    COALESCE(MAX(base_salary), 0)::numeric,
    COALESCE(MAX(gas_allowance), 0)::numeric,
    COALESCE(MAX(phone_allowance), 0)::numeric,
    COALESCE(MAX(working_days_per_month), 26)::numeric,
    COALESCE(MAX(kpi_target_revenue), 0)::numeric,
    (SELECT target_tiers FROM hr_salary_config
       WHERE org_id = v_org AND COALESCE(is_active, true) = true
       ORDER BY created_at DESC LIMIT 1),
    COALESCE(MAX(over_target_percent), 0)::numeric,
    COALESCE(MAX(under_60_percent), 0)::numeric
  INTO v_base_salary, v_gas, v_phone, v_std_days, v_kpi_target, v_kpi_tiers, v_over_pct, v_under_60_pct
  FROM hr_salary_config
  WHERE org_id = v_org
    AND COALESCE(is_active, true) = true;
  v_kpi_tiers := COALESCE(v_kpi_tiers, '[]'::jsonb);
  v_allowances := v_gas + v_phone;

  FOR u IN
    SELECT id, full_name, role
    FROM users
    WHERE org_id = v_org
      AND COALESCE(is_active, true) = true
  LOOP
    SELECT
      COUNT(*) FILTER (WHERE status IN ('present','holiday'))::numeric
      + 0.5 * COUNT(*) FILTER (WHERE status = 'half_day')::numeric
    INTO v_act_days
    FROM hr_attendance
    WHERE user_id = u.id
      AND work_date BETWEEN v_period_start AND v_period_end;
    v_act_days := COALESCE(v_act_days, 0);

    SELECT COALESCE(SUM(total), 0) INTO v_revenue
    FROM sales_orders
    WHERE sales_user_id = u.id
      AND status IN ('delivered','confirmed')
      AND order_date BETWEEN v_period_start AND v_period_end;

    v_prorated := v_base_salary;   -- lương CB (mig 060: không prorate chấm công)
    v_kpi := 0;
    v_kpi_per_user := false;
    v_kpi_pct := NULL;
    v_low_perf := 'normal';
    v_kpi_breakdown := '[]'::jsonb;

    -- 1) Per-user override (model cũ).
    SELECT min_revenue, bonus_type, bonus_value
      INTO v_kpi_tier
    FROM salary_kpi_tiers
    WHERE user_id = u.id AND month = v_month
      AND min_revenue <= v_revenue
    ORDER BY min_revenue DESC
    LIMIT 1;
    IF FOUND THEN
      v_kpi_per_user := true;
      IF v_kpi_tier.bonus_type = 'percent' THEN
        v_kpi := round(v_revenue * v_kpi_tier.bonus_value / 100, 0);
      ELSE
        v_kpi := v_kpi_tier.bonus_value;
      END IF;

    -- 2) Org config theo mức doanh số chung A + cộng dồn.
    ELSIF v_kpi_target > 0 THEN
      v_kpi_pct := v_revenue / v_kpi_target * 100;

      IF v_kpi_pct < 60 THEN
        v_low_perf := 'under_60';
        v_prorated := round(v_revenue * v_under_60_pct / 100, 0);
        v_kpi := 0;
      ELSIF v_kpi_pct < 70 THEN
        v_low_perf := 'under_70';
        v_kpi := 0;
      ELSE
        -- Cộng dồn bonus của mọi bậc có min_percent <= pct + ghi
        -- breakdown từng bậc (passed true/false).
        SELECT
          COALESCE(SUM(CASE WHEN COALESCE((elem->>'min_percent')::numeric, 0) <= v_kpi_pct
                            THEN COALESCE((elem->>'bonus')::numeric, 0) ELSE 0 END), 0),
          COALESCE(jsonb_agg(jsonb_build_object(
            'min_percent', COALESCE((elem->>'min_percent')::numeric, 0),
            'bonus', COALESCE((elem->>'bonus')::numeric, 0),
            'label', elem->>'label',
            'passed', COALESCE((elem->>'min_percent')::numeric, 0) <= v_kpi_pct
          ) ORDER BY COALESCE((elem->>'min_percent')::numeric, 0)), '[]'::jsonb)
        INTO v_kpi_partial, v_kpi_breakdown
        FROM jsonb_array_elements(v_kpi_tiers) AS arr(elem);
        v_kpi := COALESCE(v_kpi_partial, 0);

        IF v_kpi_pct > 100 AND v_over_pct > 0 THEN
          v_low_perf := 'over_100';
          v_kpi := v_kpi + round((v_revenue - v_kpi_target) * v_over_pct / 100, 0);
        END IF;
      END IF;
    END IF;

    -- Order-count bonus.
    v_oc_bonus := 0;
    v_oc_count := 0;
    SELECT min_order_count, min_order_value, bonus_per_order, period
      INTO v_oc_cfg
    FROM salary_order_count_bonus_configs
    WHERE user_id = u.id
      AND effective_from <= v_period_end
      AND (effective_to IS NULL OR effective_to >= v_period_start)
    ORDER BY effective_from DESC
    LIMIT 1;
    IF FOUND THEN
      SELECT count(*) INTO v_oc_count
      FROM sales_orders
      WHERE sales_user_id = u.id
        AND status IN ('delivered','confirmed')
        AND order_date BETWEEN v_period_start AND v_period_end
        AND total >= v_oc_cfg.min_order_value;
      IF v_oc_count >= v_oc_cfg.min_order_count THEN
        v_oc_bonus := v_oc_count * v_oc_cfg.bonus_per_order;
      END IF;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_activity
    FROM monthly_activity_bonuses
    WHERE user_id = u.id AND month = v_month;

    -- BHXH 10.5% trên phần lương CB hiệu lực (không trên phụ cấp).
    v_si := round(v_prorated * 0.105, 0);

    v_net := v_prorated + v_allowances + v_kpi + v_oc_bonus + v_activity - v_si;

    INSERT INTO payroll_run_items (
      payroll_run_id, user_id,
      base_salary, standard_workdays, actual_workdays, prorated_base,
      allowances, kpi_bonus, order_count_bonus, activity_bonus,
      overtime, deductions, social_insurance,
      manual_adjustment, net_salary,
      computed_breakdown
    ) VALUES (
      p_run_id, u.id,
      v_base_salary, v_std_days, v_act_days, v_prorated,
      v_allowances, v_kpi, v_oc_bonus, v_activity,
      0, 0, v_si,
      0, v_net,
      jsonb_build_object(
        'period_start', v_period_start,
        'period_end', v_period_end,
        'revenue', v_revenue,
        'gas_allowance', v_gas,
        'phone_allowance', v_phone,
        'kpi_target_revenue', v_kpi_target,
        'kpi_pct', CASE WHEN v_kpi_target > 0 THEN round(v_revenue / v_kpi_target * 100, 1) ELSE NULL END,
        'kpi_model', CASE WHEN v_kpi_per_user THEN 'per_user_tier' ELSE 'org_cumulative' END,
        'kpi_tier_breakdown', v_kpi_breakdown,
        'low_perf', v_low_perf,
        'over_target_percent', v_over_pct,
        'under_60_percent', v_under_60_pct,
        'oc_count', COALESCE(v_oc_count, 0),
        'oc_min_count', COALESCE(v_oc_cfg.min_order_count, 0),
        'oc_min_value', COALESCE(v_oc_cfg.min_order_value, 0),
        'oc_bonus_per_order', COALESCE(v_oc_cfg.bonus_per_order, 0),
        'attendance_skipped', true
      )
    );
    v_count := v_count + 1;
  END LOOP;

  UPDATE payroll_runs
  SET computed_at = now()
  WHERE id = p_run_id;

  RETURN v_count;
END;
$$;


-- ####################################################################
-- # 065_purchase_invoice_simplified.sql
-- ####################################################################

-- ====================================================================
-- Mua hàng đơn giản hoá: hoá đơn nhập hàng đứng độc lập (không bắt
-- buộc qua đơn mua hàng PO).
--
-- Mô hình mới:
--   purchase_invoices: status ∈ ('draft','completed','cancelled')
--     - Lưu lần đầu → 'draft' (có thể sửa thoải mái).
--     - Từ draft bấm "Hoàn thành" → complete_purchase_invoice RPC:
--         + tạo công nợ NCC (payables)
--         + nhập kho (stock_entries type='import' status='posted' +
--           stock_entry_lines + bump/khởi tạo batches + cập nhật
--           unit_cost bình quân gia quyền)
--         + invoice.status = 'completed', set completed_at, payable_id,
--           stock_entry_id.
--     - completed → bất biến (không sửa).
--   purchase_invoice_lines: chi tiết hàng (SP, ĐVT, SL, đơn giá, VAT).
--
-- mig này cũng migrate trạng thái legacy: confirmed/paid → completed.
-- ====================================================================

-- 1) Cột bổ sung trên purchase_invoices ----------------------------------
ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS stock_entry_id uuid REFERENCES stock_entries(id);

-- Migrate legacy status rồi siết CHECK mới.
UPDATE purchase_invoices SET status = 'completed' WHERE status IN ('confirmed', 'paid');

-- Drop mọi CHECK constraint hiện có liên quan tới cột status.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'purchase_invoices'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE purchase_invoices DROP CONSTRAINT %I;', r.conname);
  END LOOP;
END $$;

ALTER TABLE purchase_invoices
  ADD CONSTRAINT purchase_invoices_status_chk
  CHECK (status IN ('draft', 'completed', 'cancelled'));

-- 2) Bảng chi tiết hoá đơn nhập ------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  unit_name text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit_price numeric NOT NULL DEFAULT 0,
  vat_rate numeric NOT NULL DEFAULT 0,
  -- Hệ số quy đổi sang base unit (1 thùng = 20 hộp → conversion_factor = 20)
  conversion_factor numeric NOT NULL DEFAULT 1,
  line_total numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pinv_lines_invoice ON purchase_invoice_lines(invoice_id);

ALTER TABLE purchase_invoice_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View pinv lines" ON purchase_invoice_lines;
CREATE POLICY "View pinv lines" ON purchase_invoice_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM purchase_invoices pi WHERE pi.id = invoice_id AND pi.org_id = public.user_org_id()));
DROP POLICY IF EXISTS "Manage pinv lines" ON purchase_invoice_lines;
CREATE POLICY "Manage pinv lines" ON purchase_invoice_lines FOR ALL TO authenticated
  USING (public.user_role() IN ('owner', 'manager', 'accountant', 'warehouse'));
GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_invoice_lines TO authenticated;

-- 3) Mở rộng quyền manage purchase_invoices (cũ chỉ owner/accountant) ----
DROP POLICY IF EXISTS "Manage purchase invoices" ON purchase_invoices;
CREATE POLICY "Manage purchase invoices" ON purchase_invoices FOR ALL TO authenticated
  USING (public.user_role() IN ('owner', 'manager', 'accountant', 'warehouse'));
GRANT INSERT, UPDATE, DELETE ON purchase_invoices TO authenticated;

-- 4) RPC: hoàn thành hoá đơn nhập ----------------------------------------
CREATE OR REPLACE FUNCTION complete_purchase_invoice(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_status text;
  v_supplier uuid;
  v_inv_number text;
  v_inv_date date;
  v_total numeric;
  v_uid uuid := auth.uid();
  v_entry_id uuid;
  v_payable_id uuid;
  v_seq int := 0;
  v_batch_id uuid;
  v_base_qty numeric;
  v_unit_cost numeric;
  v_old_qty numeric;
  v_old_cost numeric;
  v_new_qty numeric;
  v_new_cost numeric;
  v_shelf int;
  r record;
BEGIN
  SELECT org_id, status, supplier_id, invoice_number, invoice_date, total
    INTO v_org, v_status, v_supplier, v_inv_number, v_inv_date, v_total
  FROM purchase_invoices WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PURCHASE_INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'completed' THEN
    RETURN p_invoice_id;  -- idempotent
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'INVOICE_NOT_DRAFT' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM purchase_invoice_lines WHERE invoice_id = p_invoice_id) THEN
    RAISE EXCEPTION 'INVOICE_HAS_NO_LINES' USING ERRCODE = 'P0001';
  END IF;

  -- 4.1 Phiếu nhập kho
  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, supplier_id, notes)
  VALUES (
    v_org,
    'NK-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS'),
    'import', 'posted', now(), v_uid, v_supplier,
    'Nhập kho từ hoá đơn mua ' || COALESCE(v_inv_number, p_invoice_id::text)
  )
  RETURNING id INTO v_entry_id;

  v_seq := 0;
  FOR r IN
    SELECT l.id, l.product_id, l.unit_name, l.quantity, l.unit_price,
           l.conversion_factor, p.base_unit, p.shelf_life_days
    FROM purchase_invoice_lines l
    JOIN products p ON p.id = l.product_id
    WHERE l.invoice_id = p_invoice_id
  LOOP
    v_seq := v_seq + 1;
    v_base_qty := COALESCE(r.quantity, 0) * COALESCE(r.conversion_factor, 1);
    -- Đơn giá theo base unit để tính unit_cost.
    v_unit_cost := CASE WHEN COALESCE(r.conversion_factor, 1) > 0
                        THEN COALESCE(r.unit_price, 0) / COALESCE(r.conversion_factor, 1)
                        ELSE COALESCE(r.unit_price, 0) END;
    v_shelf := COALESCE(r.shelf_life_days, 0);

    -- Tạo batch mới cho lần nhập này (1 hoá đơn = 1 batch / SP).
    INSERT INTO batches (
      org_id, product_id, batch_code, manufactured_at, expires_at,
      qty_initial, qty_on_hand, status, unit_cost
    ) VALUES (
      v_org, r.product_id,
      'B-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD') || '-' || lpad(v_seq::text, 3, '0'),
      CURRENT_DATE,
      CASE WHEN v_shelf > 0 THEN CURRENT_DATE + v_shelf ELSE DATE '2099-12-31' END,
      v_base_qty, v_base_qty, 'available', v_unit_cost
    )
    RETURNING id INTO v_batch_id;

    INSERT INTO stock_entry_lines (entry_id, product_id, batch_id, unit_name, quantity, unit_cost)
    VALUES (v_entry_id, r.product_id, v_batch_id, r.unit_name, v_base_qty, v_unit_cost);
  END LOOP;

  -- 4.2 Công nợ NCC
  INSERT INTO payables (org_id, supplier_id, stock_entry_id, invoice_number, amount, paid, status, notes)
  VALUES (
    v_org, v_supplier, v_entry_id, v_inv_number, COALESCE(v_total, 0), 0, 'open',
    'Hoá đơn mua hàng ' || COALESCE(v_inv_number, p_invoice_id::text)
  )
  RETURNING id INTO v_payable_id;

  -- 4.3 Đóng hoá đơn
  UPDATE purchase_invoices
  SET status = 'completed', completed_at = now(),
      stock_entry_id = v_entry_id, payable_id = v_payable_id
  WHERE id = p_invoice_id;

  RETURN p_invoice_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION complete_purchase_invoice(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_purchase_invoice(uuid) TO authenticated;

COMMENT ON FUNCTION complete_purchase_invoice(uuid) IS
  'Hoàn thành hoá đơn nhập: tạo payables + stock_entries (import,posted) + batches, chuyển status sang completed.';


-- ####################################################################
-- # 066_payroll_sales_only.sql
-- ####################################################################

-- ====================================================================
-- Payroll: tạm thời CHỈ tính lương cho nhân viên bán hàng (role = 'sales').
--
-- Trước: compute_payroll_run tạo dòng lương cho mọi user active trong
-- org (owner / manager / accountant / warehouse / driver / sales).
-- Sau: chỉ lặp qua user có role = 'sales'. Các phần còn lại (KPI cộng
-- dồn, quy tắc hiệu suất thấp, phụ cấp, BHXH, breakdown) giữ nguyên
-- như mig 064.
-- ====================================================================

CREATE OR REPLACE FUNCTION compute_payroll_run(p_run_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org      uuid;
  v_month    date;
  v_status   text;
  v_period_start date;
  v_period_end   date;
  u          record;
  v_revenue  numeric;
  v_base_salary numeric;
  v_gas      numeric;
  v_phone    numeric;
  v_allowances numeric;
  v_std_days numeric;
  v_act_days numeric;
  v_prorated numeric;
  v_kpi      numeric;
  v_kpi_partial numeric;
  v_kpi_tier record;
  v_kpi_per_user bool;
  v_kpi_target numeric;
  v_kpi_tiers  jsonb;
  v_kpi_pct    numeric;
  v_kpi_breakdown jsonb;
  v_over_pct   numeric;
  v_under_60_pct numeric;
  v_low_perf   text;
  v_oc_cfg   record;
  v_oc_count int;
  v_oc_bonus numeric;
  v_activity numeric;
  v_si       numeric;
  v_net      numeric;
  v_count    int := 0;
BEGIN
  SELECT org_id, month, status INTO v_org, v_month, v_status
  FROM payroll_runs WHERE id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYROLL_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'locked' THEN
    RAISE EXCEPTION 'PAYROLL_RUN_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  v_period_start := v_month;
  v_period_end := (v_month + interval '1 month - 1 day')::date;

  DELETE FROM payroll_run_items WHERE payroll_run_id = p_run_id;

  SELECT
    COALESCE(MAX(base_salary), 0)::numeric,
    COALESCE(MAX(gas_allowance), 0)::numeric,
    COALESCE(MAX(phone_allowance), 0)::numeric,
    COALESCE(MAX(working_days_per_month), 26)::numeric,
    COALESCE(MAX(kpi_target_revenue), 0)::numeric,
    (SELECT target_tiers FROM hr_salary_config
       WHERE org_id = v_org AND COALESCE(is_active, true) = true
       ORDER BY created_at DESC LIMIT 1),
    COALESCE(MAX(over_target_percent), 0)::numeric,
    COALESCE(MAX(under_60_percent), 0)::numeric
  INTO v_base_salary, v_gas, v_phone, v_std_days, v_kpi_target, v_kpi_tiers, v_over_pct, v_under_60_pct
  FROM hr_salary_config
  WHERE org_id = v_org
    AND COALESCE(is_active, true) = true;
  v_kpi_tiers := COALESCE(v_kpi_tiers, '[]'::jsonb);
  v_allowances := v_gas + v_phone;

  FOR u IN
    SELECT id, full_name, role
    FROM users
    WHERE org_id = v_org
      AND COALESCE(is_active, true) = true
      AND role = 'sales'   -- tạm thời chỉ tính lương NV bán hàng
  LOOP
    SELECT
      COUNT(*) FILTER (WHERE status IN ('present','holiday'))::numeric
      + 0.5 * COUNT(*) FILTER (WHERE status = 'half_day')::numeric
    INTO v_act_days
    FROM hr_attendance
    WHERE user_id = u.id
      AND work_date BETWEEN v_period_start AND v_period_end;
    v_act_days := COALESCE(v_act_days, 0);

    SELECT COALESCE(SUM(total), 0) INTO v_revenue
    FROM sales_orders
    WHERE sales_user_id = u.id
      AND status IN ('delivered','confirmed')
      AND order_date BETWEEN v_period_start AND v_period_end;

    v_prorated := v_base_salary;   -- lương CB (mig 060: không prorate chấm công)
    v_kpi := 0;
    v_kpi_per_user := false;
    v_kpi_pct := NULL;
    v_low_perf := 'normal';
    v_kpi_breakdown := '[]'::jsonb;

    -- 1) Per-user override (model cũ).
    SELECT min_revenue, bonus_type, bonus_value
      INTO v_kpi_tier
    FROM salary_kpi_tiers
    WHERE user_id = u.id AND month = v_month
      AND min_revenue <= v_revenue
    ORDER BY min_revenue DESC
    LIMIT 1;
    IF FOUND THEN
      v_kpi_per_user := true;
      IF v_kpi_tier.bonus_type = 'percent' THEN
        v_kpi := round(v_revenue * v_kpi_tier.bonus_value / 100, 0);
      ELSE
        v_kpi := v_kpi_tier.bonus_value;
      END IF;

    -- 2) Org config theo mức doanh số chung A + cộng dồn.
    ELSIF v_kpi_target > 0 THEN
      v_kpi_pct := v_revenue / v_kpi_target * 100;

      IF v_kpi_pct < 60 THEN
        v_low_perf := 'under_60';
        v_prorated := round(v_revenue * v_under_60_pct / 100, 0);
        v_kpi := 0;
      ELSIF v_kpi_pct < 70 THEN
        v_low_perf := 'under_70';
        v_kpi := 0;
      ELSE
        SELECT
          COALESCE(SUM(CASE WHEN COALESCE((elem->>'min_percent')::numeric, 0) <= v_kpi_pct
                            THEN COALESCE((elem->>'bonus')::numeric, 0) ELSE 0 END), 0),
          COALESCE(jsonb_agg(jsonb_build_object(
            'min_percent', COALESCE((elem->>'min_percent')::numeric, 0),
            'bonus', COALESCE((elem->>'bonus')::numeric, 0),
            'label', elem->>'label',
            'passed', COALESCE((elem->>'min_percent')::numeric, 0) <= v_kpi_pct
          ) ORDER BY COALESCE((elem->>'min_percent')::numeric, 0)), '[]'::jsonb)
        INTO v_kpi_partial, v_kpi_breakdown
        FROM jsonb_array_elements(v_kpi_tiers) AS arr(elem);
        v_kpi := COALESCE(v_kpi_partial, 0);

        IF v_kpi_pct > 100 AND v_over_pct > 0 THEN
          v_low_perf := 'over_100';
          v_kpi := v_kpi + round((v_revenue - v_kpi_target) * v_over_pct / 100, 0);
        END IF;
      END IF;
    END IF;

    -- Order-count bonus.
    v_oc_bonus := 0;
    v_oc_count := 0;
    SELECT min_order_count, min_order_value, bonus_per_order, period
      INTO v_oc_cfg
    FROM salary_order_count_bonus_configs
    WHERE user_id = u.id
      AND effective_from <= v_period_end
      AND (effective_to IS NULL OR effective_to >= v_period_start)
    ORDER BY effective_from DESC
    LIMIT 1;
    IF FOUND THEN
      SELECT count(*) INTO v_oc_count
      FROM sales_orders
      WHERE sales_user_id = u.id
        AND status IN ('delivered','confirmed')
        AND order_date BETWEEN v_period_start AND v_period_end
        AND total >= v_oc_cfg.min_order_value;
      IF v_oc_count >= v_oc_cfg.min_order_count THEN
        v_oc_bonus := v_oc_count * v_oc_cfg.bonus_per_order;
      END IF;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_activity
    FROM monthly_activity_bonuses
    WHERE user_id = u.id AND month = v_month;

    -- BHXH 10.5% trên phần lương CB hiệu lực (không trên phụ cấp).
    v_si := round(v_prorated * 0.105, 0);

    v_net := v_prorated + v_allowances + v_kpi + v_oc_bonus + v_activity - v_si;

    INSERT INTO payroll_run_items (
      payroll_run_id, user_id,
      base_salary, standard_workdays, actual_workdays, prorated_base,
      allowances, kpi_bonus, order_count_bonus, activity_bonus,
      overtime, deductions, social_insurance,
      manual_adjustment, net_salary,
      computed_breakdown
    ) VALUES (
      p_run_id, u.id,
      v_base_salary, v_std_days, v_act_days, v_prorated,
      v_allowances, v_kpi, v_oc_bonus, v_activity,
      0, 0, v_si,
      0, v_net,
      jsonb_build_object(
        'period_start', v_period_start,
        'period_end', v_period_end,
        'revenue', v_revenue,
        'gas_allowance', v_gas,
        'phone_allowance', v_phone,
        'kpi_target_revenue', v_kpi_target,
        'kpi_pct', CASE WHEN v_kpi_target > 0 THEN round(v_revenue / v_kpi_target * 100, 1) ELSE NULL END,
        'kpi_model', CASE WHEN v_kpi_per_user THEN 'per_user_tier' ELSE 'org_cumulative' END,
        'kpi_tier_breakdown', v_kpi_breakdown,
        'low_perf', v_low_perf,
        'over_target_percent', v_over_pct,
        'under_60_percent', v_under_60_pct,
        'oc_count', COALESCE(v_oc_count, 0),
        'oc_min_count', COALESCE(v_oc_cfg.min_order_count, 0),
        'oc_min_value', COALESCE(v_oc_cfg.min_order_value, 0),
        'oc_bonus_per_order', COALESCE(v_oc_cfg.bonus_per_order, 0),
        'attendance_skipped', true
      )
    );
    v_count := v_count + 1;
  END LOOP;

  UPDATE payroll_runs
  SET computed_at = now()
  WHERE id = p_run_id;

  RETURN v_count;
END;
$$;


-- ####################################################################
-- # 067_payroll_no_allowance_when_under_60.sql
-- ####################################################################

-- ====================================================================
-- Payroll: NV không đạt doanh số để hưởng "lương cứng" (đạt dưới 60%
-- mức doanh số chung A) thì cũng KHÔNG có phụ cấp.
--
-- Trước (mig 064/066): case under_60 → lương CB thay bằng doanh số ×
-- under_60_percent, nhưng vẫn cộng phụ cấp (xăng xe + điện thoại).
-- Sau: case under_60 → phụ cấp = 0 (kéo theo allowances, gas, phone
-- trong breakdown về 0). Các case khác (≥60% A trở lên — vẫn hưởng
-- lương cứng) giữ nguyên phụ cấp.
--
-- Vẫn chỉ tính lương cho NV bán hàng (role = 'sales' — mig 066).
-- ====================================================================

CREATE OR REPLACE FUNCTION compute_payroll_run(p_run_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org      uuid;
  v_month    date;
  v_status   text;
  v_period_start date;
  v_period_end   date;
  u          record;
  v_revenue  numeric;
  v_base_salary numeric;
  v_gas      numeric;
  v_phone    numeric;
  v_allowances numeric;
  v_emp_gas   numeric;
  v_emp_phone numeric;
  v_emp_allowances numeric;
  v_std_days numeric;
  v_act_days numeric;
  v_prorated numeric;
  v_kpi      numeric;
  v_kpi_partial numeric;
  v_kpi_tier record;
  v_kpi_per_user bool;
  v_kpi_target numeric;
  v_kpi_tiers  jsonb;
  v_kpi_pct    numeric;
  v_kpi_breakdown jsonb;
  v_over_pct   numeric;
  v_under_60_pct numeric;
  v_low_perf   text;
  v_oc_cfg   record;
  v_oc_count int;
  v_oc_bonus numeric;
  v_activity numeric;
  v_si       numeric;
  v_net      numeric;
  v_count    int := 0;
BEGIN
  SELECT org_id, month, status INTO v_org, v_month, v_status
  FROM payroll_runs WHERE id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYROLL_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'locked' THEN
    RAISE EXCEPTION 'PAYROLL_RUN_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  v_period_start := v_month;
  v_period_end := (v_month + interval '1 month - 1 day')::date;

  DELETE FROM payroll_run_items WHERE payroll_run_id = p_run_id;

  SELECT
    COALESCE(MAX(base_salary), 0)::numeric,
    COALESCE(MAX(gas_allowance), 0)::numeric,
    COALESCE(MAX(phone_allowance), 0)::numeric,
    COALESCE(MAX(working_days_per_month), 26)::numeric,
    COALESCE(MAX(kpi_target_revenue), 0)::numeric,
    (SELECT target_tiers FROM hr_salary_config
       WHERE org_id = v_org AND COALESCE(is_active, true) = true
       ORDER BY created_at DESC LIMIT 1),
    COALESCE(MAX(over_target_percent), 0)::numeric,
    COALESCE(MAX(under_60_percent), 0)::numeric
  INTO v_base_salary, v_gas, v_phone, v_std_days, v_kpi_target, v_kpi_tiers, v_over_pct, v_under_60_pct
  FROM hr_salary_config
  WHERE org_id = v_org
    AND COALESCE(is_active, true) = true;
  v_kpi_tiers := COALESCE(v_kpi_tiers, '[]'::jsonb);
  v_allowances := v_gas + v_phone;

  FOR u IN
    SELECT id, full_name, role
    FROM users
    WHERE org_id = v_org
      AND COALESCE(is_active, true) = true
      AND role = 'sales'   -- tạm thời chỉ tính lương NV bán hàng
  LOOP
    SELECT
      COUNT(*) FILTER (WHERE status IN ('present','holiday'))::numeric
      + 0.5 * COUNT(*) FILTER (WHERE status = 'half_day')::numeric
    INTO v_act_days
    FROM hr_attendance
    WHERE user_id = u.id
      AND work_date BETWEEN v_period_start AND v_period_end;
    v_act_days := COALESCE(v_act_days, 0);

    SELECT COALESCE(SUM(total), 0) INTO v_revenue
    FROM sales_orders
    WHERE sales_user_id = u.id
      AND status IN ('delivered','confirmed')
      AND order_date BETWEEN v_period_start AND v_period_end;

    v_prorated := v_base_salary;   -- lương CB (mig 060: không prorate chấm công)
    v_emp_gas := v_gas;
    v_emp_phone := v_phone;
    v_emp_allowances := v_allowances;
    v_kpi := 0;
    v_kpi_per_user := false;
    v_kpi_pct := NULL;
    v_low_perf := 'normal';
    v_kpi_breakdown := '[]'::jsonb;

    -- 1) Per-user override (model cũ).
    SELECT min_revenue, bonus_type, bonus_value
      INTO v_kpi_tier
    FROM salary_kpi_tiers
    WHERE user_id = u.id AND month = v_month
      AND min_revenue <= v_revenue
    ORDER BY min_revenue DESC
    LIMIT 1;
    IF FOUND THEN
      v_kpi_per_user := true;
      IF v_kpi_tier.bonus_type = 'percent' THEN
        v_kpi := round(v_revenue * v_kpi_tier.bonus_value / 100, 0);
      ELSE
        v_kpi := v_kpi_tier.bonus_value;
      END IF;

    -- 2) Org config theo mức doanh số chung A + cộng dồn.
    ELSIF v_kpi_target > 0 THEN
      v_kpi_pct := v_revenue / v_kpi_target * 100;

      IF v_kpi_pct < 60 THEN
        -- Dưới 60% A: không hưởng lương cứng → lương = doanh số ×
        -- under_60%; KHÔNG có phụ cấp; không thưởng KPI.
        v_low_perf := 'under_60';
        v_prorated := round(v_revenue * v_under_60_pct / 100, 0);
        v_emp_gas := 0;
        v_emp_phone := 0;
        v_emp_allowances := 0;
        v_kpi := 0;
      ELSIF v_kpi_pct < 70 THEN
        v_low_perf := 'under_70';
        v_kpi := 0;
      ELSE
        SELECT
          COALESCE(SUM(CASE WHEN COALESCE((elem->>'min_percent')::numeric, 0) <= v_kpi_pct
                            THEN COALESCE((elem->>'bonus')::numeric, 0) ELSE 0 END), 0),
          COALESCE(jsonb_agg(jsonb_build_object(
            'min_percent', COALESCE((elem->>'min_percent')::numeric, 0),
            'bonus', COALESCE((elem->>'bonus')::numeric, 0),
            'label', elem->>'label',
            'passed', COALESCE((elem->>'min_percent')::numeric, 0) <= v_kpi_pct
          ) ORDER BY COALESCE((elem->>'min_percent')::numeric, 0)), '[]'::jsonb)
        INTO v_kpi_partial, v_kpi_breakdown
        FROM jsonb_array_elements(v_kpi_tiers) AS arr(elem);
        v_kpi := COALESCE(v_kpi_partial, 0);

        IF v_kpi_pct > 100 AND v_over_pct > 0 THEN
          v_low_perf := 'over_100';
          v_kpi := v_kpi + round((v_revenue - v_kpi_target) * v_over_pct / 100, 0);
        END IF;
      END IF;
    END IF;

    -- Order-count bonus.
    v_oc_bonus := 0;
    v_oc_count := 0;
    SELECT min_order_count, min_order_value, bonus_per_order, period
      INTO v_oc_cfg
    FROM salary_order_count_bonus_configs
    WHERE user_id = u.id
      AND effective_from <= v_period_end
      AND (effective_to IS NULL OR effective_to >= v_period_start)
    ORDER BY effective_from DESC
    LIMIT 1;
    IF FOUND THEN
      SELECT count(*) INTO v_oc_count
      FROM sales_orders
      WHERE sales_user_id = u.id
        AND status IN ('delivered','confirmed')
        AND order_date BETWEEN v_period_start AND v_period_end
        AND total >= v_oc_cfg.min_order_value;
      IF v_oc_count >= v_oc_cfg.min_order_count THEN
        v_oc_bonus := v_oc_count * v_oc_cfg.bonus_per_order;
      END IF;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_activity
    FROM monthly_activity_bonuses
    WHERE user_id = u.id AND month = v_month;

    -- BHXH 10.5% trên phần lương CB hiệu lực (không trên phụ cấp).
    v_si := round(v_prorated * 0.105, 0);

    v_net := v_prorated + v_emp_allowances + v_kpi + v_oc_bonus + v_activity - v_si;

    INSERT INTO payroll_run_items (
      payroll_run_id, user_id,
      base_salary, standard_workdays, actual_workdays, prorated_base,
      allowances, kpi_bonus, order_count_bonus, activity_bonus,
      overtime, deductions, social_insurance,
      manual_adjustment, net_salary,
      computed_breakdown
    ) VALUES (
      p_run_id, u.id,
      v_base_salary, v_std_days, v_act_days, v_prorated,
      v_emp_allowances, v_kpi, v_oc_bonus, v_activity,
      0, 0, v_si,
      0, v_net,
      jsonb_build_object(
        'period_start', v_period_start,
        'period_end', v_period_end,
        'revenue', v_revenue,
        'gas_allowance', v_emp_gas,
        'phone_allowance', v_emp_phone,
        'allowance_dropped', (v_emp_allowances = 0 AND v_allowances > 0),
        'kpi_target_revenue', v_kpi_target,
        'kpi_pct', CASE WHEN v_kpi_target > 0 THEN round(v_revenue / v_kpi_target * 100, 1) ELSE NULL END,
        'kpi_model', CASE WHEN v_kpi_per_user THEN 'per_user_tier' ELSE 'org_cumulative' END,
        'kpi_tier_breakdown', v_kpi_breakdown,
        'low_perf', v_low_perf,
        'over_target_percent', v_over_pct,
        'under_60_percent', v_under_60_pct,
        'oc_count', COALESCE(v_oc_count, 0),
        'oc_min_count', COALESCE(v_oc_cfg.min_order_count, 0),
        'oc_min_value', COALESCE(v_oc_cfg.min_order_value, 0),
        'oc_bonus_per_order', COALESCE(v_oc_cfg.bonus_per_order, 0),
        'attendance_skipped', true
      )
    );
    v_count := v_count + 1;
  END LOOP;

  UPDATE payroll_runs
  SET computed_at = now()
  WHERE id = p_run_id;

  RETURN v_count;
END;
$$;


-- ####################################################################
-- # 068_supplier_returns.sql
-- ####################################################################

-- ====================================================================
-- Hoá đơn trả hàng NCC (supplier returns).
--
-- Mô hình mirror purchase_invoices nhưng đảo chiều:
--   supplier_returns:
--     status ∈ ('draft','completed','cancelled')
--     warehouse_zone ∈ ('sale','date')  — mặc định 'date' (kho hàng date)
--     Draft → bấm "Gửi phiếu" → complete_supplier_return RPC:
--       + xuất kho (stock_entries type='export' status='posted') —
--         FIFO theo expires_at trong zone đã chọn; trừ qty_on_hand;
--         tạo 1 stock_entry_line cho mỗi batch tiêu thụ.
--       + ghi giảm công nợ NCC: tạo payables row amount=-total,
--         status='open', paid=0 — net balance NCC sẽ giảm theo.
--       + return.status = 'completed', set completed_at,
--         stock_entry_id, payable_credit_id.
--     completed → bất biến.
--   supplier_return_lines: chi tiết SP (giống purchase_invoice_lines).
-- ====================================================================

-- 1) Bảng header --------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  return_code text,                       -- "TH-YYMMDD-####" tự sinh khi gửi
  return_date date NOT NULL DEFAULT CURRENT_DATE,
  reason text,                            -- damaged / near_expiry / wrong_item / other
  notes text,
  subtotal numeric NOT NULL DEFAULT 0,
  vat numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'completed', 'cancelled')),
  -- Xuất từ kho nào (zone của batch): 'sale' hoặc 'date'.
  warehouse_zone text NOT NULL DEFAULT 'date'
    CHECK (warehouse_zone IN ('sale', 'date')),
  -- Liên kết sau khi complete:
  stock_entry_id uuid REFERENCES stock_entries(id),
  payable_credit_id uuid REFERENCES payables(id),
  completed_at timestamptz,
  completed_by uuid REFERENCES users(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sup_returns_org ON supplier_returns(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sup_returns_supplier ON supplier_returns(supplier_id);
CREATE INDEX IF NOT EXISTS idx_sup_returns_status ON supplier_returns(status);

-- 2) Bảng line ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES supplier_returns(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  unit_name text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit_price numeric NOT NULL DEFAULT 0,
  vat_rate numeric NOT NULL DEFAULT 0,
  -- 1 thùng = 20 hộp → conversion_factor = 20; qty trên batch tính bằng
  -- base unit nên cần factor để quy đổi.
  conversion_factor numeric NOT NULL DEFAULT 1,
  line_total numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sup_return_lines_return ON supplier_return_lines(return_id);

-- 3) RLS ----------------------------------------------------------------
ALTER TABLE supplier_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_return_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View supplier returns" ON supplier_returns;
CREATE POLICY "View supplier returns" ON supplier_returns FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());
DROP POLICY IF EXISTS "Manage supplier returns" ON supplier_returns;
CREATE POLICY "Manage supplier returns" ON supplier_returns FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner','manager','accountant','warehouse'));

DROP POLICY IF EXISTS "View supplier return lines" ON supplier_return_lines;
CREATE POLICY "View supplier return lines" ON supplier_return_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM supplier_returns r WHERE r.id = return_id AND r.org_id = public.user_org_id()));
DROP POLICY IF EXISTS "Manage supplier return lines" ON supplier_return_lines;
CREATE POLICY "Manage supplier return lines" ON supplier_return_lines FOR ALL TO authenticated
  USING (public.user_role() IN ('owner','manager','accountant','warehouse'));

GRANT SELECT, INSERT, UPDATE, DELETE ON supplier_returns TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON supplier_return_lines TO authenticated;

-- 4) RPC: hoàn thành phiếu trả ------------------------------------------
CREATE OR REPLACE FUNCTION complete_supplier_return(p_return_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_status text;
  v_supplier uuid;
  v_zone text;
  v_total numeric;
  v_return_code text;
  v_uid uuid := auth.uid();
  v_entry_id uuid;
  v_payable_id uuid;
  v_seq int := 0;
  v_base_qty numeric;
  v_need numeric;
  v_take numeric;
  v_batch record;
  r record;
BEGIN
  SELECT org_id, status, supplier_id, warehouse_zone, total, return_code
    INTO v_org, v_status, v_supplier, v_zone, v_total, v_return_code
  FROM supplier_returns WHERE id = p_return_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPPLIER_RETURN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'completed' THEN
    RETURN p_return_id;  -- idempotent
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'RETURN_NOT_DRAFT' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM supplier_return_lines WHERE return_id = p_return_id) THEN
    RAISE EXCEPTION 'RETURN_HAS_NO_LINES' USING ERRCODE = 'P0001';
  END IF;

  -- Sinh return_code nếu chưa có
  IF v_return_code IS NULL OR v_return_code = '' THEN
    v_return_code := 'TH-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS');
    UPDATE supplier_returns SET return_code = v_return_code WHERE id = p_return_id;
  END IF;

  -- 4.1 Tạo phiếu xuất kho
  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, supplier_id, notes)
  VALUES (
    v_org,
    'XK-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS'),
    'export', 'posted', now(), v_uid, v_supplier,
    'Xuất kho trả NCC — phiếu ' || v_return_code || ' (zone: ' || v_zone || ')'
  )
  RETURNING id INTO v_entry_id;

  -- 4.2 Trừ kho theo FIFO trong zone đã chọn
  FOR r IN
    SELECT l.id, l.product_id, l.unit_name, l.quantity, l.conversion_factor
    FROM supplier_return_lines l
    WHERE l.return_id = p_return_id
  LOOP
    v_base_qty := COALESCE(r.quantity, 0) * COALESCE(r.conversion_factor, 1);
    v_need := v_base_qty;
    IF v_need <= 0 THEN
      CONTINUE;
    END IF;

    FOR v_batch IN
      SELECT id, qty_on_hand, unit_cost
      FROM batches
      WHERE org_id = v_org
        AND product_id = r.product_id
        AND warehouse_zone = v_zone
        AND COALESCE(status, 'available') = 'available'
        AND qty_on_hand > 0
      ORDER BY expires_at NULLS LAST, created_at
      FOR UPDATE
    LOOP
      EXIT WHEN v_need <= 0;
      v_take := LEAST(v_need, v_batch.qty_on_hand);

      UPDATE batches
      SET qty_on_hand = qty_on_hand - v_take
      WHERE id = v_batch.id;

      v_seq := v_seq + 1;
      INSERT INTO stock_entry_lines (entry_id, product_id, batch_id, unit_name, quantity, unit_cost)
      VALUES (v_entry_id, r.product_id, v_batch.id, r.unit_name, v_take, COALESCE(v_batch.unit_cost, 0));

      v_need := v_need - v_take;
    END LOOP;

    IF v_need > 0 THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING
        ERRCODE = 'P0001',
        DETAIL = format('product_id=%s zone=%s thiếu %s đơn vị cơ sở', r.product_id, v_zone, v_need);
    END IF;
  END LOOP;

  -- 4.3 Ghi giảm công nợ NCC (credit memo)
  INSERT INTO payables (org_id, supplier_id, stock_entry_id, invoice_number, amount, paid, status, notes)
  VALUES (
    v_org, v_supplier, v_entry_id, v_return_code,
    -COALESCE(v_total, 0), 0, 'open',
    'Hoàn trả NCC — phiếu ' || v_return_code
  )
  RETURNING id INTO v_payable_id;

  -- 4.4 Đóng phiếu trả
  UPDATE supplier_returns
  SET status = 'completed',
      completed_at = now(),
      completed_by = v_uid,
      stock_entry_id = v_entry_id,
      payable_credit_id = v_payable_id
  WHERE id = p_return_id;

  RETURN p_return_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION complete_supplier_return(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_supplier_return(uuid) TO authenticated;

COMMENT ON FUNCTION complete_supplier_return(uuid) IS
  'Hoàn thành phiếu trả NCC: xuất kho FIFO trong zone đã chọn + tạo credit memo giảm công nợ NCC.';


-- ####################################################################
-- # 069_return_lines_vat.sql
-- ####################################################################

-- ====================================================================
-- return_lines.vat_rate — cho phép NV chọn thuế VAT cho mỗi dòng hàng
-- trả lại (giống dòng bán). Mặc định 0 (rows cũ + handover auto = 0%).
--
-- Quy ước: vat_rate lưu dạng phân số (0, 0.05, 0.08, 0.10 — chuẩn VN).
-- line_total = qty × unit_price × (1 + vat_rate) — gross, đã gồm VAT.
-- Trigger sync_return_credit_amount (mig 035) tổng line_total nên
-- credit_note_amount sẽ tự gồm VAT mà không cần đổi trigger.
-- ====================================================================

ALTER TABLE return_lines
  ADD COLUMN IF NOT EXISTS vat_rate numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN return_lines.vat_rate IS
  'Thuế VAT của dòng hàng trả (phân số 0-1, vd 0.10 = 10%). line_total đã gồm VAT.';


-- ####################################################################
-- # 070_supplier_return_stock_line_uom.sql
-- ####################################################################

-- ====================================================================
-- Fix complete_supplier_return: insert stock_entry_lines THIẾU các cột
-- split UOM (mig 039 đặt qty_in_base_uom NOT NULL) → 23502 NULL VIOLATION
-- khi gửi phiếu trả NCC. Bổ sung qty_in_base_uom / qty_in_transaction_
-- uom / transaction_uom / conversion_factor_snapshot.
--
-- v_take được tính theo base unit ngay từ đầu (= quantity × cf), nên
-- snapshot factor = 1; transaction_uom = r.unit_name của line trả.
-- ====================================================================

CREATE OR REPLACE FUNCTION complete_supplier_return(p_return_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_status text;
  v_supplier uuid;
  v_zone text;
  v_total numeric;
  v_return_code text;
  v_uid uuid := auth.uid();
  v_entry_id uuid;
  v_payable_id uuid;
  v_seq int := 0;
  v_base_qty numeric;
  v_need numeric;
  v_take numeric;
  v_batch record;
  r record;
BEGIN
  SELECT org_id, status, supplier_id, warehouse_zone, total, return_code
    INTO v_org, v_status, v_supplier, v_zone, v_total, v_return_code
  FROM supplier_returns WHERE id = p_return_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPPLIER_RETURN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'completed' THEN
    RETURN p_return_id;
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'RETURN_NOT_DRAFT' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM supplier_return_lines WHERE return_id = p_return_id) THEN
    RAISE EXCEPTION 'RETURN_HAS_NO_LINES' USING ERRCODE = 'P0001';
  END IF;

  IF v_return_code IS NULL OR v_return_code = '' THEN
    v_return_code := 'TH-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS');
    UPDATE supplier_returns SET return_code = v_return_code WHERE id = p_return_id;
  END IF;

  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, supplier_id, notes)
  VALUES (
    v_org,
    'XK-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS'),
    'export', 'posted', now(), v_uid, v_supplier,
    'Xuất kho trả NCC — phiếu ' || v_return_code || ' (zone: ' || v_zone || ')'
  )
  RETURNING id INTO v_entry_id;

  FOR r IN
    SELECT l.id, l.product_id, l.unit_name, l.quantity, l.conversion_factor
    FROM supplier_return_lines l
    WHERE l.return_id = p_return_id
  LOOP
    v_base_qty := COALESCE(r.quantity, 0) * COALESCE(r.conversion_factor, 1);
    v_need := v_base_qty;
    IF v_need <= 0 THEN
      CONTINUE;
    END IF;

    FOR v_batch IN
      SELECT id, qty_on_hand, unit_cost
      FROM batches
      WHERE org_id = v_org
        AND product_id = r.product_id
        AND warehouse_zone = v_zone
        AND COALESCE(status, 'available') = 'available'
        AND qty_on_hand > 0
      ORDER BY expires_at NULLS LAST, created_at
      FOR UPDATE
    LOOP
      EXIT WHEN v_need <= 0;
      v_take := LEAST(v_need, v_batch.qty_on_hand);

      UPDATE batches
      SET qty_on_hand = qty_on_hand - v_take
      WHERE id = v_batch.id;

      v_seq := v_seq + 1;
      INSERT INTO stock_entry_lines (
        entry_id, product_id, batch_id, unit_name, quantity,
        qty_in_base_uom, qty_in_transaction_uom, transaction_uom,
        conversion_factor_snapshot, unit_cost
      ) VALUES (
        v_entry_id, r.product_id, v_batch.id, r.unit_name, v_take,
        v_take, v_take, r.unit_name,
        1, COALESCE(v_batch.unit_cost, 0)
      );

      v_need := v_need - v_take;
    END LOOP;

    IF v_need > 0 THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING
        ERRCODE = 'P0001',
        DETAIL = format('product_id=%s zone=%s thiếu %s đơn vị cơ sở', r.product_id, v_zone, v_need);
    END IF;
  END LOOP;

  INSERT INTO payables (org_id, supplier_id, stock_entry_id, invoice_number, amount, paid, status, notes)
  VALUES (
    v_org, v_supplier, v_entry_id, v_return_code,
    -COALESCE(v_total, 0), 0, 'open',
    'Hoàn trả NCC — phiếu ' || v_return_code
  )
  RETURNING id INTO v_payable_id;

  UPDATE supplier_returns
  SET status = 'completed',
      completed_at = now(),
      completed_by = v_uid,
      stock_entry_id = v_entry_id,
      payable_credit_id = v_payable_id
  WHERE id = p_return_id;

  RETURN p_return_id;
END;
$$;


-- ####################################################################
-- # 071_supplier_return_better_stock_error.sql
-- ####################################################################

-- ====================================================================
-- Cải thiện lỗi INSUFFICIENT_STOCK của complete_supplier_return: kèm
-- tên sản phẩm, số lượng còn thiếu, tồn ở zone đã chọn và zone còn
-- lại — để NV biết phải đổi kho hay nhập đủ trước khi gửi.
--
-- Message format (frontend split bằng " | " để hiển thị đẹp):
--   "Không đủ tồn để xuất | <SP>: cần X <base>, kho <zone> còn Y, kho
--    còn lại còn Z"
-- Vẫn giữ prefix "INSUFFICIENT_STOCK" trong DETAIL cho ai cần match.
-- ====================================================================

CREATE OR REPLACE FUNCTION complete_supplier_return(p_return_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_status text;
  v_supplier uuid;
  v_zone text;
  v_other_zone text;
  v_total numeric;
  v_return_code text;
  v_uid uuid := auth.uid();
  v_entry_id uuid;
  v_payable_id uuid;
  v_seq int := 0;
  v_base_qty numeric;
  v_need numeric;
  v_take numeric;
  v_batch record;
  v_pname text;
  v_punit text;
  v_avail_zone numeric;
  v_avail_other numeric;
  r record;
BEGIN
  SELECT org_id, status, supplier_id, warehouse_zone, total, return_code
    INTO v_org, v_status, v_supplier, v_zone, v_total, v_return_code
  FROM supplier_returns WHERE id = p_return_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPPLIER_RETURN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'completed' THEN
    RETURN p_return_id;
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'RETURN_NOT_DRAFT' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM supplier_return_lines WHERE return_id = p_return_id) THEN
    RAISE EXCEPTION 'RETURN_HAS_NO_LINES' USING ERRCODE = 'P0001';
  END IF;

  v_other_zone := CASE WHEN v_zone = 'sale' THEN 'date' ELSE 'sale' END;

  IF v_return_code IS NULL OR v_return_code = '' THEN
    v_return_code := 'TH-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS');
    UPDATE supplier_returns SET return_code = v_return_code WHERE id = p_return_id;
  END IF;

  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, supplier_id, notes)
  VALUES (
    v_org,
    'XK-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS'),
    'export', 'posted', now(), v_uid, v_supplier,
    'Xuất kho trả NCC — phiếu ' || v_return_code || ' (zone: ' || v_zone || ')'
  )
  RETURNING id INTO v_entry_id;

  FOR r IN
    SELECT l.id, l.product_id, l.unit_name, l.quantity, l.conversion_factor
    FROM supplier_return_lines l
    WHERE l.return_id = p_return_id
  LOOP
    v_base_qty := COALESCE(r.quantity, 0) * COALESCE(r.conversion_factor, 1);
    v_need := v_base_qty;
    IF v_need <= 0 THEN
      CONTINUE;
    END IF;

    FOR v_batch IN
      SELECT id, qty_on_hand, unit_cost
      FROM batches
      WHERE org_id = v_org
        AND product_id = r.product_id
        AND warehouse_zone = v_zone
        AND COALESCE(status, 'available') = 'available'
        AND qty_on_hand > 0
      ORDER BY expires_at NULLS LAST, created_at
      FOR UPDATE
    LOOP
      EXIT WHEN v_need <= 0;
      v_take := LEAST(v_need, v_batch.qty_on_hand);

      UPDATE batches
      SET qty_on_hand = qty_on_hand - v_take
      WHERE id = v_batch.id;

      v_seq := v_seq + 1;
      INSERT INTO stock_entry_lines (
        entry_id, product_id, batch_id, unit_name, quantity,
        qty_in_base_uom, qty_in_transaction_uom, transaction_uom,
        conversion_factor_snapshot, unit_cost
      ) VALUES (
        v_entry_id, r.product_id, v_batch.id, r.unit_name, v_take,
        v_take, v_take, r.unit_name,
        1, COALESCE(v_batch.unit_cost, 0)
      );

      v_need := v_need - v_take;
    END LOOP;

    IF v_need > 0 THEN
      SELECT name, base_unit INTO v_pname, v_punit FROM products WHERE id = r.product_id;
      SELECT COALESCE(SUM(qty_on_hand), 0) INTO v_avail_zone
      FROM batches
      WHERE org_id = v_org AND product_id = r.product_id
        AND warehouse_zone = v_zone
        AND COALESCE(status, 'available') = 'available';
      SELECT COALESCE(SUM(qty_on_hand), 0) INTO v_avail_other
      FROM batches
      WHERE org_id = v_org AND product_id = r.product_id
        AND warehouse_zone = v_other_zone
        AND COALESCE(status, 'available') = 'available';

      RAISE EXCEPTION
        'INSUFFICIENT_STOCK | % (%): cần %, kho % còn %, kho % còn %',
        COALESCE(v_pname, r.product_id::text),
        COALESCE(v_punit, 'đv cơ sở'),
        v_base_qty,
        CASE WHEN v_zone = 'date' THEN 'hàng date' ELSE 'hàng bán' END,
        v_avail_zone,
        CASE WHEN v_other_zone = 'date' THEN 'hàng date' ELSE 'hàng bán' END,
        v_avail_other
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  INSERT INTO payables (org_id, supplier_id, stock_entry_id, invoice_number, amount, paid, status, notes)
  VALUES (
    v_org, v_supplier, v_entry_id, v_return_code,
    -COALESCE(v_total, 0), 0, 'open',
    'Hoàn trả NCC — phiếu ' || v_return_code
  )
  RETURNING id INTO v_payable_id;

  UPDATE supplier_returns
  SET status = 'completed',
      completed_at = now(),
      completed_by = v_uid,
      stock_entry_id = v_entry_id,
      payable_credit_id = v_payable_id
  WHERE id = p_return_id;

  RETURN p_return_id;
END;
$$;


-- ####################################################################
-- # 072_einvoice_misa.sql
-- ####################################################################

-- ====================================================================
-- MISA meInvoice — hoá đơn điện tử (e-invoice) GTGT.
--
-- 1) company_einvoice_config: cấu hình tài khoản MISA theo từng NPP
--    (org). Username/password lưu mã hoá (AES-256-GCM, key =
--    EINVOICE_ENC_KEY) — cột *_enc chứa ciphertext base64.
-- 2) einvoice_logs: audit trail MỌI lần gọi MISA (success/failed/
--    pending) — nguồn debug duy nhất khi MISA trả lỗi.
-- 3) invoices.misa_lookup_code: mã tra cứu MISA (idempotency flag).
-- ====================================================================

-- 1) Cấu hình MISA theo NPP --------------------------------------------
CREATE TABLE IF NOT EXISTS company_einvoice_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'misa',
  api_base text NOT NULL DEFAULT 'https://app.meinvoice.vn',
  -- Thông tin người bán in trên hoá đơn
  tax_code text,                       -- MST người bán
  seller_name text,                    -- tên công ty (fallback: org.name)
  seller_address text,
  -- Định danh MISA meInvoice
  misa_company_id text,                -- vd 156217
  misa_org_unit_id text,
  misa_template_id text,
  misa_user_id text,
  misa_inv_series text,                -- vd 1C26THG (kí hiệu theo năm)
  misa_inv_template_no text NOT NULL DEFAULT '1',
  -- Credentials (mã hoá at rest)
  username_enc text,
  password_enc text,
  sandbox boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE company_einvoice_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View einvoice config" ON company_einvoice_config;
CREATE POLICY "View einvoice config" ON company_einvoice_config FOR SELECT TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner','accountant','manager'));
DROP POLICY IF EXISTS "Manage einvoice config" ON company_einvoice_config;
CREATE POLICY "Manage einvoice config" ON company_einvoice_config FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner','accountant'))
  WITH CHECK (org_id = public.user_org_id() AND public.user_role() IN ('owner','accountant'));

GRANT SELECT, INSERT, UPDATE, DELETE ON company_einvoice_config TO authenticated;

-- 2) Audit log mọi lần gọi MISA ----------------------------------------
CREATE TABLE IF NOT EXISTS einvoice_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  order_id uuid REFERENCES sales_orders(id) ON DELETE SET NULL,
  attempt_at timestamptz NOT NULL DEFAULT now(),
  request_payload jsonb,
  response_payload jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('success','failed','pending')),
  error_message text,
  misa_lookup_code text,
  misa_inv_no text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_einvoice_logs_org ON einvoice_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_einvoice_logs_invoice ON einvoice_logs(invoice_id);
CREATE INDEX IF NOT EXISTS idx_einvoice_logs_order ON einvoice_logs(order_id);

ALTER TABLE einvoice_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View einvoice logs" ON einvoice_logs;
CREATE POLICY "View einvoice logs" ON einvoice_logs FOR SELECT TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner','accountant','manager'));
DROP POLICY IF EXISTS "Manage einvoice logs" ON einvoice_logs;
CREATE POLICY "Manage einvoice logs" ON einvoice_logs FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner','accountant','manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON einvoice_logs TO authenticated;

-- 3) Mã tra cứu MISA trên invoices (idempotency) -----------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS misa_lookup_code text,
  ADD COLUMN IF NOT EXISTS misa_published_at timestamptz;

COMMENT ON COLUMN invoices.misa_lookup_code IS
  'Mã tra cứu hoá đơn MISA — cờ idempotency: đã có thì không phát hành lại.';


-- ####################################################################
-- # 073_drop_customers_channel_check.sql
-- ####################################################################

-- ====================================================================
-- fix: customers.channel CHECK chặn update.
--
-- Mig 001 đặt: channel text CHECK (channel IN ('GT','MT','HORECA')).
-- UI hiện tại đã chuyển channel sang lưu MÃ TUYẾN BÁN (sales_routes.
-- code, vd "R001") → mọi update mới đều vi phạm CHECK → form khách
-- hàng "không cập nhật được". Bỏ CHECK; cột vẫn text tự do.
-- ====================================================================

ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS customers_channel_check;

COMMENT ON COLUMN customers.channel IS
  'Mã tuyến bán của khách (sales_routes.code). Tên cột giữ legacy "channel".';


-- ####################################################################
-- # 074_drop_pricing_price_columns.sql
-- ####################################################################

-- =====================================================================
-- Migration 074: Drop org-level price-edit columns from pricing_rules
-- =====================================================================
-- Lý do: cấu hình "cho phép NV sửa giá + sàn/trần %/VND" giờ được
-- quản lý PER-NHÂN-VIÊN qua users.allow_price_edit +
-- users.price_edit_max_increase_pct (migration 027). UI /settings/pricing
-- đã gỡ; setup wizard step "pricing" rename thành "warehouse" và chỉ
-- cấu hình ngưỡng kho date.
--
-- Cột date_warehouse_threshold_days GIỮ NGUYÊN vì 2 SQL function
-- batches_auto_promote_zone_trigger + promote_batches_to_date_warehouse
-- (mig 028) vẫn đang dùng nó.
--
-- An toàn: chỉ DROP COLUMN, không DROP TABLE. RLS + index khác không
-- liên quan đến các cột này nên không cần đụng tới.

ALTER TABLE pricing_rules DROP COLUMN IF EXISTS allow_sales_override;
ALTER TABLE pricing_rules DROP COLUMN IF EXISTS sale_min_pct;
ALTER TABLE pricing_rules DROP COLUMN IF EXISTS sale_min_value;
ALTER TABLE pricing_rules DROP COLUMN IF EXISTS return_max_pct;
ALTER TABLE pricing_rules DROP COLUMN IF EXISTS return_max_value;
-- updated_by + updated_at giữ lại làm audit metadata cho ngưỡng kho date.

COMMENT ON TABLE pricing_rules IS
  'Cấu hình warehouse-date threshold per org. Cột giá đã chuyển sang per-user (users.allow_price_edit + users.price_edit_max_increase_pct) tại migration 074.';


-- ####################################################################
-- # 075_einvoice_misa_paths.sql
-- ####################################################################

-- ====================================================================
-- MISA meInvoice — cho phép cấu hình API endpoint paths qua UI.
--
-- Lý do: path /auth/token & /api/v1/invoices ở client.ts là placeholder
-- (doc MISA Step 6 nói "verify bằng sandbox"). Tenant khác nhau dùng path
-- khác nhau (Connect API v3 vs Open API v1 vs OEM). Đẩy ra config để
-- kế toán tự nhập theo doc MISA → không cần redeploy code khi MISA đổi.
-- ====================================================================

ALTER TABLE company_einvoice_config
  ADD COLUMN IF NOT EXISTS token_path text,
  ADD COLUMN IF NOT EXISTS publish_path text;

COMMENT ON COLUMN company_einvoice_config.token_path IS
  'Endpoint lấy access_token, vd: /api/Account/Login hoặc /api/v3/Auth/login.';
COMMENT ON COLUMN company_einvoice_config.publish_path IS
  'Endpoint phát hành hoá đơn, vd: /api/InvoiceWS/Publish hoặc /api/v3/invoices.';


-- ####################################################################
-- # 076_einvoice_misa_appid_signtype.sql
-- ####################################################################

-- ====================================================================
-- MISA meInvoice — bổ sung trường khớp doc tích hợp thật:
-- - misa_app_id: AppID do MISA cấp (khác Company ID), dùng cho token.
-- - sign_type: SignType khi phát hành (1=USB/file, 2=HSM, 3=HSM async,
--   4=vé không ký, 5=POS không ký). Mặc định 1.
-- ====================================================================

ALTER TABLE company_einvoice_config
  ADD COLUMN IF NOT EXISTS misa_app_id text,
  ADD COLUMN IF NOT EXISTS sign_type smallint NOT NULL DEFAULT 1;

COMMENT ON COLUMN company_einvoice_config.misa_app_id IS
  'AppID do MISA cấp (request body token: appid).';
COMMENT ON COLUMN company_einvoice_config.sign_type IS
  'SignType MISA: 1=USB/file, 2=HSM, 3=HSM async, 4=vé không ký, 5=POS không ký.';


-- ####################################################################
-- # 077_einvoice_webapi_v2.sql
-- ####################################################################

-- ====================================================================
-- MISA meInvoice WebAPI v2 — pivot sang flow nháp (Insert) đơn giản.
--
-- User chỉ cần đẩy data → MISA tạo HĐ nháp → user vào web duyệt + ký
-- thủ công. KHÔNG cần AppID (chỉ dùng cho Integration API trả phí),
-- KHÔNG cần SignType (vì không ký qua API).
--
-- Đổi default api_base/token_path/publish_path. Cột misa_app_id và
-- sign_type giữ lại (đã insert ở 076) nhưng không dùng — sau này nếu
-- cần Integration API trả phí thì bật lại.
-- ====================================================================

ALTER TABLE company_einvoice_config
  ALTER COLUMN api_base SET DEFAULT 'https://testapp.meinvoice.vn/api/v2';

COMMENT ON COLUMN company_einvoice_config.api_base IS
  'Base URL MISA WebAPI v2. Sandbox: https://testapp.meinvoice.vn/api/v2 ; production: https://app.meinvoice.vn/api/v2.';

-- Reset path NULL hiện tại sang default WebAPI (chỉ cập nhật row chưa
-- nhập tay; ai đã nhập path cũ để Integration API → giữ nguyên).
UPDATE company_einvoice_config
SET
  token_path = '/oauth',
  publish_path = '/SAInvoice/Insert'
WHERE token_path IS NULL OR token_path = '';

COMMENT ON COLUMN company_einvoice_config.token_path IS
  'WebAPI v2: /oauth (form-encoded grant_type=password, MST ở header taxcode).';
COMMENT ON COLUMN company_einvoice_config.publish_path IS
  'WebAPI v2: /SAInvoice/Insert (push HĐ nháp; user vào web duyệt + ký).';


-- ####################################################################
-- # 078_einvoice_v3sainvoice.sql
-- ####################################################################

-- ====================================================================
-- MISA WebAPI v2 — sync code với doc HDGTGT.html:
-- - publish_path đổi default sang /v3sainvoice (không phải SAInvoice/Insert).
-- - Thêm invoice_type (int, default 1 = HĐ GTGT bán hàng).
-- - Thêm is_inherit_from_old_template (bool, default false).
-- ====================================================================

ALTER TABLE company_einvoice_config
  ADD COLUMN IF NOT EXISTS invoice_type smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_inherit_from_old_template boolean NOT NULL DEFAULT false;

-- Reset publish_path NULL hoặc đang trỏ tới SAInvoice/Insert (sai) → v3sainvoice.
UPDATE company_einvoice_config
SET publish_path = '/v3sainvoice'
WHERE publish_path IS NULL OR publish_path = '' OR publish_path LIKE '%SAInvoice/Insert%';

COMMENT ON COLUMN company_einvoice_config.invoice_type IS
  'InvoiceType MISA: 1=HĐ GTGT bán hàng (mặc định). Lấy từ "Lấy danh sách mẫu HD".';
COMMENT ON COLUMN company_einvoice_config.is_inherit_from_old_template IS
  'IsInheritFromOldTemplate: theo response "Lấy danh sách mẫu HD".';
COMMENT ON COLUMN company_einvoice_config.publish_path IS
  'Endpoint đẩy HĐ nháp WebAPI v2 — mặc định /v3sainvoice. Dùng /v3sainvoice/Code nếu HĐ có mã CQT.';


-- ####################################################################
-- # 079_einvoice_misa_with_code.sql
-- ####################################################################

-- ====================================================================
-- MISA WebAPI v2 — thêm cờ "có mã CQT".
--
-- Lấy từ response /oauth (field IsInvoiceWithCode). Quyết định path:
-- - true  → /v3sainvoice/Code
-- - false → /v3sainvoice
-- Tự fill khi user bấm Test kết nối, không cần nhập tay.
-- ====================================================================

ALTER TABLE company_einvoice_config
  ADD COLUMN IF NOT EXISTS misa_is_invoice_with_code boolean DEFAULT false;

COMMENT ON COLUMN company_einvoice_config.misa_is_invoice_with_code IS
  'Cờ "hoá đơn có mã CQT" — lấy tự động từ response /oauth.';


-- ####################################################################
-- # 080_user_suppliers.sql
-- ####################################################################

-- ====================================================================
-- 080_user_suppliers
--
-- Phân quyền sales theo NCC. Many-to-many giữa users (role=sales) và
-- suppliers. Một NV có thể phụ trách nhiều NCC, một NCC có thể có
-- nhiều NV phụ trách.
--
-- Owner/Manager quản lý gán; sales chỉ thấy NCC mình được gán + thấy
-- products thuộc NCC đó (RLS bổ sung ở migration 081).
-- ====================================================================

CREATE TABLE IF NOT EXISTS user_suppliers (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, supplier_id)
);

CREATE INDEX IF NOT EXISTS idx_user_suppliers_user ON user_suppliers(user_id);
CREATE INDEX IF NOT EXISTS idx_user_suppliers_supplier ON user_suppliers(supplier_id);
CREATE INDEX IF NOT EXISTS idx_user_suppliers_org ON user_suppliers(org_id);

COMMENT ON TABLE user_suppliers IS
  'Many-to-many: NV bán hàng (sales) phụ trách NCC nào. Owner/Manager quản lý.';

ALTER TABLE user_suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members view user_suppliers" ON user_suppliers;
CREATE POLICY "Org members view user_suppliers" ON user_suppliers FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS "Owner/Manager manage user_suppliers" ON user_suppliers;
CREATE POLICY "Owner/Manager manage user_suppliers" ON user_suppliers FOR ALL TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON user_suppliers TO authenticated;


-- ####################################################################
-- # 081_products_supplier_scope.sql
-- ####################################################################

-- ====================================================================
-- 081_products_supplier_scope
--
-- Sales chỉ thấy products thuộc NCC được gán trong user_suppliers
-- (migration 080). Owner/manager/accountant/warehouse/driver vẫn
-- thấy tất cả. SP có primary_supplier_id NULL → ai cũng thấy (legacy).
-- ====================================================================

DROP POLICY IF EXISTS "Org members can view products" ON products;
DROP POLICY IF EXISTS "View products (sales scoped by supplier)" ON products;

CREATE POLICY "View products (sales scoped by supplier)"
  ON products FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND (
      public.user_role() <> 'sales'
      OR primary_supplier_id IS NULL
      OR EXISTS (
        SELECT 1 FROM user_suppliers us
        WHERE us.user_id = (SELECT auth.uid())
          AND us.supplier_id = products.primary_supplier_id
      )
    )
  );


-- ####################################################################
-- # 082_search_customer_dupes.sql
-- ####################################################################

-- ====================================================================
-- 082_search_customer_dupes
--
-- RPC tìm KH trùng theo SĐT/địa chỉ/tên, scope toàn org (bypass RLS).
-- Sales role hiện chỉ thấy KH được gán → tìm trùng sẽ trả 0 → NV
-- tạo trùng. RPC SECURITY DEFINER trả về basic info đủ để NV nhận diện
-- và biết KH đang do ai phụ trách.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.search_customer_dupes(p_q text)
RETURNS TABLE (
  id uuid,
  store_name text,
  owner_name text,
  phone text,
  address text,
  ward text,
  primary_user_name text,
  has_my_assignment boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.user_org_id();
  v_uid uuid := (SELECT auth.uid());
  v_q text := lower(trim(coalesce(p_q, '')));
BEGIN
  IF v_org IS NULL OR length(v_q) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.store_name,
    c.owner_name,
    c.phone,
    c.address,
    c.ward,
    u.full_name AS primary_user_name,
    EXISTS (
      SELECT 1 FROM customer_assignments
      WHERE customer_id = c.id AND user_id = v_uid AND status = 'active'
    ) AS has_my_assignment
  FROM customers c
  LEFT JOIN customer_assignments ca
    ON ca.customer_id = c.id AND ca.role = 'primary' AND ca.status = 'active'
  LEFT JOIN users u ON u.id = ca.user_id
  WHERE c.org_id = v_org
    AND (
      lower(c.phone) LIKE '%' || v_q || '%'
      OR lower(coalesce(c.address, '')) LIKE '%' || v_q || '%'
      OR lower(c.store_name) LIKE '%' || v_q || '%'
      OR lower(c.owner_name) LIKE '%' || v_q || '%'
    )
  ORDER BY
    -- Priority: exact phone → phone partial → address → tên
    CASE
      WHEN lower(c.phone) = v_q THEN 0
      WHEN lower(c.phone) LIKE '%' || v_q || '%' THEN 1
      WHEN lower(coalesce(c.address, '')) LIKE '%' || v_q || '%' THEN 2
      ELSE 3
    END,
    c.store_name
  LIMIT 20;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_customer_dupes(text) TO authenticated;

COMMENT ON FUNCTION public.search_customer_dupes(text) IS
  'Tìm KH trùng toàn org. Sales dùng để check trước khi tạo mới.';


-- ####################################################################
-- # 083_claim_customer_for_me.sql
-- ####################################################################

-- ====================================================================
-- 083_claim_customer_for_me
--
-- Cho phép NV sales tự thêm 1 KH vào danh sách phụ trách (qua bảng
-- customer_assignments). RLS hiện tại chỉ owner/manager được INSERT
-- assignments → cần RPC SECURITY DEFINER.
--
-- Logic role mới:
--   - KH chưa có primary nào → claim với role='primary'
--   - KH đã có primary của NV khác → claim với role='secondary'
--   - User đã có assignment active rồi → no-op
-- ====================================================================

CREATE OR REPLACE FUNCTION public.claim_customer_for_me(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.user_org_id();
  v_role text := public.user_role();
  v_uid uuid := (SELECT auth.uid());
  v_has_primary boolean;
  v_new_role text;
BEGIN
  IF v_role <> 'sales' THEN
    RAISE EXCEPTION 'Chỉ vai trò sales mới được tự thêm khách hàng vào danh sách của mình';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id AND org_id = v_org) THEN
    RAISE EXCEPTION 'Khách hàng không tồn tại trong tổ chức';
  END IF;

  IF EXISTS (
    SELECT 1 FROM customer_assignments
    WHERE customer_id = p_customer_id AND user_id = v_uid AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('status', 'already_assigned');
  END IF;

  v_has_primary := EXISTS (
    SELECT 1 FROM customer_assignments
    WHERE customer_id = p_customer_id AND role = 'primary' AND status = 'active'
  );
  v_new_role := CASE WHEN v_has_primary THEN 'secondary' ELSE 'primary' END;

  INSERT INTO customer_assignments (customer_id, user_id, role, status, assigned_at)
  VALUES (p_customer_id, v_uid, v_new_role, 'active', CURRENT_DATE);

  RETURN jsonb_build_object('status', 'claimed', 'role', v_new_role);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_customer_for_me(uuid) TO authenticated;

COMMENT ON FUNCTION public.claim_customer_for_me(uuid) IS
  'NV sales tự thêm 1 KH vào danh sách của mình. Auto chọn role primary/secondary.';


-- ####################################################################
-- # 084_invoices_sales_scope.sql
-- ####################################################################

-- ====================================================================
-- 084_invoices_sales_scope
--
-- Sales (NV bán hàng) chỉ thấy hoá đơn liên quan đến đơn hàng do mình
-- tạo (sales_orders.sales_user_id = auth.uid()). Owner/manager/
-- accountant vẫn thấy tất cả. Hoá đơn tay (không gắn order) → ẩn
-- với sales.
-- ====================================================================

DROP POLICY IF EXISTS "Org members can view invoices" ON invoices;
DROP POLICY IF EXISTS "Admin roles can view all invoices" ON invoices;
DROP POLICY IF EXISTS "Sales see own invoices" ON invoices;

CREATE POLICY "Admin roles can view all invoices"
  ON invoices FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  );

CREATE POLICY "Sales see own invoices"
  ON invoices FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'sales'
    AND order_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM sales_orders so
      WHERE so.id = invoices.order_id
        AND so.sales_user_id = (SELECT auth.uid())
    )
  );


-- ####################################################################
-- # 085_login_by_username_phone.sql
-- ####################################################################

-- ====================================================================
-- 085_login_by_username_phone
--
-- Cho phép đăng nhập bằng username hoặc số điện thoại thay vì email.
-- Supabase Auth dùng email làm key — ta tra ngược identifier → email
-- qua RPC SECURITY DEFINER, rồi client gọi signInWithPassword({email,
-- password}) như cũ.
--
-- Schema:
--   - users.username text: tài khoản đăng nhập (chữ + số), không bắt buộc.
--   - Unique partial index trên LOWER(username), WHERE NOT NULL.
--   - Unique partial index trên phone (đã có cột), WHERE NOT NULL.
-- ====================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS username text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique
  ON users (LOWER(username))
  WHERE username IS NOT NULL AND length(trim(username)) > 0;

-- Phone unique để identifier không ambiguous khi login.
-- Nếu data hiện có trùng phone → migration sẽ fail; cleanup trước khi
-- chạy hoặc tạm bỏ index này và dedupe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique
  ON users (regexp_replace(phone, '\s+', '', 'g'))
  WHERE phone IS NOT NULL AND length(trim(phone)) > 0;

COMMENT ON COLUMN users.username IS
  'Tài khoản đăng nhập (alias). Chữ + số + dấu chấm/gạch, không khoảng trắng.';

-- --------------------------------------------------------------------
-- RPC: tra email từ identifier (username | phone | email). Trả NULL
-- nếu không match — client xử lý báo lỗi chung "sai tài khoản hoặc
-- mật khẩu" để không leak chi tiết identifier tồn tại hay không.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_email_by_identifier(p_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_id text := lower(trim(coalesce(p_id, '')));
  v_id_no_space text := regexp_replace(coalesce(p_id, ''), '\s+', '', 'g');
  v_email text;
BEGIN
  IF length(v_id) < 2 THEN RETURN NULL; END IF;

  -- Nếu là email rồi → trả thẳng (vẫn check tồn tại để không trả random).
  IF v_id LIKE '%@%' THEN
    SELECT au.email INTO v_email
    FROM auth.users au
    WHERE lower(au.email) = v_id
    LIMIT 1;
    RETURN v_email;
  END IF;

  -- Tra theo username (case-insensitive) hoặc phone (bỏ khoảng trắng).
  SELECT au.email INTO v_email
  FROM public.users u
  JOIN auth.users au ON au.id = u.id
  WHERE
    (u.username IS NOT NULL AND lower(u.username) = v_id)
    OR (u.phone IS NOT NULL AND regexp_replace(u.phone, '\s+', '', 'g') = v_id_no_space)
  LIMIT 1;

  RETURN v_email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_email_by_identifier(text) TO anon, authenticated;

COMMENT ON FUNCTION public.lookup_email_by_identifier(text) IS
  'Tra email từ username hoặc phone để đăng nhập. Public — chỉ trả email khi identifier match.';


-- ####################################################################
-- # 086_allow_oversell.sql
-- ####################################################################

-- ====================================================================
-- 086_allow_oversell
--
-- Cho phép NPP bật/tắt khả năng tạo đơn vượt tồn kho. Mặc định false
-- (chặn như trước). Khi bật, order-form sẽ chỉ cảnh báo (amber) thay
-- vì chặn submit — đơn vẫn được tạo, tồn sẽ về âm khi kho pick.
--
-- Cờ ở cấp tổ chức, không cấp user — owner/manager quyết định cho cả
-- NPP. RLS không cần đổi: read settings vốn dĩ open cho member.
-- ====================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS allow_oversell boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN organizations.allow_oversell IS
  'Cho phép tạo đơn bán vượt tồn kho. false (mặc định) = chặn ở UI; true = chỉ cảnh báo.';


-- ####################################################################
-- # 087_qr_login.sql
-- ####################################################################

-- ====================================================================
-- 087_qr_login
--
-- Đăng nhập bằng mã QR cho nhân viên.
--
-- Ý tưởng: mỗi nhân viên được cấp 1 token bí mật dài (qr_login_token).
-- Token này được nhúng vào 1 URL và in thành mã QR. Nhân viên dùng
-- camera điện thoại quét QR → mở URL /qr-login?t=<token> → server đối
-- chiếu token (service_role), phát hành phiên đăng nhập Supabase và đưa
-- thẳng vào app. Không cần gõ email/mật khẩu.
--
-- Bảo mật:
--   - Token = chuỗi ngẫu nhiên >=32 byte, đối chiếu server-side bằng
--     service_role. KHÔNG expose qua RPC public để tránh dò token.
--   - Chủ sở hữu có thể xoay (rotate) token → QR cũ hết hiệu lực ngay.
--   - Token chỉ hợp lệ khi user is_active = true (kiểm ở tầng API).
--   - QR = "chìa khoá" nên phải phát qua kênh tin cậy; rò rỉ QR thì
--     xoay token để vô hiệu hoá.
-- ====================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS qr_login_token text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS qr_login_issued_at timestamptz;

-- Token phải là duy nhất toàn hệ thống để tra ngược 1-1.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_qr_login_token_unique
  ON users (qr_login_token)
  WHERE qr_login_token IS NOT NULL AND length(trim(qr_login_token)) > 0;

COMMENT ON COLUMN users.qr_login_token IS
  'Token bí mật nhúng trong mã QR đăng nhập. NULL = không bật QR login. Đối chiếu server-side (service_role) — không expose public.';
COMMENT ON COLUMN users.qr_login_issued_at IS
  'Thời điểm phát/xoay token QR gần nhất. Dùng để hiển thị và audit.';


-- ####################################################################
-- # 088_qr_token_isolation.sql
-- ####################################################################

-- ====================================================================
-- 088_qr_token_isolation
--
-- SỬA LỖI BẢO MẬT: 087 đặt qr_login_token trong bảng users, nhưng RLS
-- của users cho phép MỌI thành viên org SELECT (policy "org_id =
-- user_org_id()"). Nghĩa là nhân viên thường đọc được token của Chủ sở
-- hữu và chiếm tài khoản.
--
-- Khắc phục: chuyển token sang bảng riêng qr_login_tokens, bật RLS và
-- KHÔNG tạo policy nào → chỉ service_role (bypass RLS) đọc/ghi được.
-- Toàn bộ thao tác token đều đi qua API server-side sẵn có.
-- ====================================================================

CREATE TABLE IF NOT EXISTS qr_login_tokens (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_qr_login_tokens_token
  ON qr_login_tokens (token);

-- RLS bật, không policy: anon/authenticated bị chặn hoàn toàn.
ALTER TABLE qr_login_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qr_login_tokens FROM anon, authenticated;

COMMENT ON TABLE qr_login_tokens IS
  'Token đăng nhập QR — service_role only. Không thêm policy RLS cho bảng này.';

-- Di trú dữ liệu từ 087 (nếu có) rồi gỡ cột khỏi users.
INSERT INTO qr_login_tokens (user_id, token, issued_at)
SELECT id, qr_login_token, COALESCE(qr_login_issued_at, now())
FROM users
WHERE qr_login_token IS NOT NULL AND length(trim(qr_login_token)) > 0
ON CONFLICT (user_id) DO NOTHING;

DROP INDEX IF EXISTS idx_users_qr_login_token_unique;
ALTER TABLE users DROP COLUMN IF EXISTS qr_login_token;
ALTER TABLE users DROP COLUMN IF EXISTS qr_login_issued_at;


-- ####################################################################
-- # 089_order_client_request_id.sql
-- ####################################################################

-- ====================================================================
-- 089_order_client_request_id
--
-- Hỗ trợ tạo đơn OFFLINE: máy lưu đơn cục bộ khi mất mạng rồi đẩy lên
-- khi có mạng. Mỗi đơn offline mang 1 client_request_id (UUID sinh ở
-- máy). Khi đồng bộ có thể thử lại nhiều lần (mạng chập chờn) → cần
-- chống tạo trùng: unique index trên client_request_id đảm bảo cùng 1
-- đơn chỉ vào DB đúng 1 lần.
-- ====================================================================

ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS client_request_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_orders_client_request_id
  ON sales_orders (client_request_id)
  WHERE client_request_id IS NOT NULL;

COMMENT ON COLUMN sales_orders.client_request_id IS
  'UUID sinh tại thiết bị cho đơn tạo offline. Unique để đồng bộ idempotent (thử lại không tạo trùng). NULL cho đơn tạo online thông thường.';


-- ####################################################################
-- # 090_fix_role_permissions_module_check.sql
-- ####################################################################

-- ====================================================================
-- 090_fix_role_permissions_module_check
--
-- SỬA LỖI: "new row for relation role_permissions violates check
-- constraint role_permissions_module_check" khi lưu phân quyền.
--
-- NGUYÊN NHÂN GỐC (bug trong migration 024):
-- 024 định nghĩa constraint bằng chuỗi regex có HAI dấu gạch chéo:
--     module ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$'
-- Postgres mặc định standard_conforming_strings = on, nên dấu \ trong
-- chuỗi '...' là ký tự LITERAL, không phải ký tự thoát. Regex nhận được
-- do đó là  \\.  nghĩa là "một dấu backslash thật, rồi ký tự bất kỳ"
-- — chứ KHÔNG phải "một dấu chấm" như ý định ban đầu.
--
-- Hậu quả: khoá cấp module không dấu chấm ('orders', 'settings') thì
-- lọt, nhưng MỌI khoá tính năng có dấu chấm đều bị chặn:
--     settings.users, analytics.business, reports.end_of_day,
--     finance.cash_receipts, purchasing.invoices, einvoice.config, ...
-- Vì vậy trang Phân quyền lưu thất bại ngay khi có bất kỳ dòng phân
-- quyền chi tiết nào.
--
-- CÁCH SỬA: viết lại constraint với MỘT dấu gạch chéo ( \. = dấu chấm ).
-- An toàn: chỉ NỚI LỎNG điều kiện (mọi giá trị đang hợp lệ vẫn hợp lệ),
-- không đụng dữ liệu, không xoá dòng nào. Idempotent.
-- ====================================================================

ALTER TABLE role_permissions
  DROP CONSTRAINT IF EXISTS role_permissions_module_check;

ALTER TABLE role_permissions
  ADD CONSTRAINT role_permissions_module_check
  CHECK (
    char_length(module) BETWEEN 1 AND 64
    AND module ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'
  );

COMMENT ON COLUMN role_permissions.module IS
  'Khoá module hoặc tính năng. Khoá cấp module ("orders") bao trùm cả nhóm menu; khoá tính năng ("settings.users") ghi đè riêng một mục menu. Định dạng: các từ thường a-z0-9_ ngăn cách bởi dấu chấm, tối đa 64 ký tự.';

-- --------------------------------------------------------------------
-- KIỂM TRA SAU KHI CHẠY — cả 8 dòng phải trả về true.
-- --------------------------------------------------------------------
-- SELECT
--   'orders'                ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$' AS module_don,
--   'settings.users'        ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$' AS tinh_nang,
--   'reports.end_of_day'    ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$' AS co_gach_duoi,
--   'finance.cash_receipts' ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$' AS co_gach_duoi_2,
--   NOT ('Orders'           ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$') AS chan_hoa,
--   NOT ('.orders'          ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$') AS chan_dau_cham,
--   NOT ('orders.'          ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$') AS chan_cuoi_cham,
--   NOT ('a b'              ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$') AS chan_khoang_trang;


-- ####################################################################
-- # 091_backfill_missing_objects.sql
-- ####################################################################

-- ====================================================================
-- 091_backfill_missing_objects
--
-- BÙ CÁC ĐỐI TƯỢNG SCHEMA CÒN THIẾU trên database production.
--
-- Căn cứ: kết quả chạy supabase/diagnostics/check_migration_drift.sql
-- ngày 2026-08-21 trên DB production. Kết quả đó liệt kê 14 migration
-- "thiếu", nhưng sau khi rà từng cái thì PHẦN LỚN LÀ BÁO ĐỘNG GIẢ —
-- đối tượng bị migration SAU cố ý xoá/thay thế:
--
--   • 087 (users.qr_login_token…)  → 088 CỐ Ý xoá, chuyển sang bảng
--     riêng qr_login_tokens. Thiếu là ĐÚNG.
--   • 002/004 policy bảng users    → 004 rồi 008 thay thế lần lượt.
--   • 005/033/036/037 policy       → 042_customer_row_level thay thế.
--   • 010/012/020 policy           → 034 thay thế.
--   • 014 policy visit_photos      → nằm ở schema `storage`, công cụ dò
--     lại tìm trong schema `public` nên báo nhầm (đã sửa công cụ; xem
--     phần KIỂM TRA THÊM ở cuối file).
--
-- CHỈ 3 MỤC DƯỚI ĐÂY LÀ THIẾU THẬT. Migration này bù đúng 3 mục đó.
-- Toàn bộ đều idempotent — chạy lại nhiều lần không sao.
-- ====================================================================


-- --------------------------------------------------------------------
-- 1. products: 3 cột của migration 025 (NGUYÊN NHÂN GỐC lỗi trang
--    Sản phẩm không hiện danh sách).
--
--    Ứng dụng SELECT các cột này; thiếu chúng thì PostgREST trả lỗi 400
--    và danh sách rỗng. Hiện trang vẫn chạy được là nhờ cơ chế dự phòng
--    tự chuyển sang select('*') — nhưng đó chỉ cứu việc ĐỌC. Thao tác
--    GHI vào các cột này vẫn hỏng cho tới khi chạy migration này.
-- --------------------------------------------------------------------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS allow_price_edit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_edit_max_type text
    NOT NULL DEFAULT 'percent',
  ADD COLUMN IF NOT EXISTS price_edit_max numeric NOT NULL DEFAULT 0;

-- CHECK tách riêng để chạy lại không lỗi "constraint already exists".
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_price_edit_max_type_check;
ALTER TABLE products
  ADD CONSTRAINT products_price_edit_max_type_check
  CHECK (price_edit_max_type IN ('percent', 'value'));

COMMENT ON COLUMN products.allow_price_edit IS
  'Cho phép nhân viên sửa giá khi tạo đơn cho SKU này.';
COMMENT ON COLUMN products.price_edit_max_type IS
  'Đơn vị của trần điều chỉnh: ''percent'' (%) hoặc ''value'' (VND).';
COMMENT ON COLUMN products.price_edit_max IS
  'Trần được phép sửa: % giá bán hoặc giá trị tuyệt đối tùy max_type.';


-- --------------------------------------------------------------------
-- 2. sales_orders.client_request_id — migration 089.
--
--    Thiếu cột này thì đơn tạo NGOẠI TUYẾN không đẩy lên được: đơn nằm
--    lại trong hàng chờ trên máy nhân viên vô thời hạn. Index unique là
--    thứ bảo đảm đồng bộ lại nhiều lần không tạo đơn trùng.
-- --------------------------------------------------------------------
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS client_request_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_orders_client_request_id
  ON sales_orders (client_request_id)
  WHERE client_request_id IS NOT NULL;

COMMENT ON COLUMN sales_orders.client_request_id IS
  'UUID sinh tại thiết bị cho đơn tạo offline. Unique để đồng bộ idempotent (thử lại không tạo trùng). NULL cho đơn tạo online thông thường.';


-- --------------------------------------------------------------------
-- 3. Index tra cứu nhà cung cấp theo tổ chức — migration 006.
--    Chỉ ảnh hưởng tốc độ, không ảnh hưởng đúng/sai.
-- --------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_suppliers_org ON suppliers(org_id);


-- ====================================================================
-- KIỂM TRA SAU KHI CHẠY — cả 3 dòng phải trả về true.
-- ====================================================================
-- SELECT
--   (SELECT count(*) = 3 FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='products'
--       AND column_name IN ('allow_price_edit','price_edit_max_type','price_edit_max')
--   ) AS cot_products_du,
--   (SELECT count(*) = 1 FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='sales_orders'
--       AND column_name='client_request_id'
--   ) AS cot_offline_du,
--   (SELECT count(*) = 1 FROM pg_indexes
--     WHERE schemaname='public' AND indexname='idx_suppliers_org'
--   ) AS index_ncc_du;

-- --------------------------------------------------------------------
-- KIỂM TRA THÊM (không bắt buộc): policy ảnh chuyến thăm nằm ở schema
-- `storage`. Nếu trả về ít hơn 3 dòng thì chức năng chụp ảnh viếng thăm
-- khách hàng đang hỏng — khi đó chạy lại migration 014_visit_photos.sql.
-- --------------------------------------------------------------------
-- SELECT policyname FROM pg_policies
-- WHERE schemaname='storage' AND tablename='objects'
--   AND policyname LIKE 'visit_photos%';


-- ####################################################################
-- # 092_rls_hardening.sql
-- ####################################################################

-- ====================================================================
-- 092_rls_hardening
--
-- Vá 3 lỗ hổng RLS đã được KIỂM CHỨNG TỪNG CÁI trên mã nguồn.
--
-- Bối cảnh: triển khai 1 TỔ CHỨC / 1 DATABASE. Vì vậy các sửa đổi dưới
-- đây gần như KHÔNG đổi hành vi hiện tại — chúng là phòng vệ chiều sâu,
-- chặn sự cố nếu sau này có tổ chức thứ hai dùng chung database.
--
-- ĐÃ LOẠI BỎ SAU KHI KIỂM CHỨNG (đừng "sửa" lại, không phải lỗi):
--   • Bảng users: migration 008 ĐÃ siết org_id
--     (USING org_id = user_org_id() OR id = auth.uid()). Cảnh báo trước
--     đây dựa vào migration 004 vốn đã bị 008 thay thế.
--     Điều này cũng chứng minh nỗi lo "đệ quy khi policy trên users gọi
--     user_org_id()" là KHÔNG có cơ sở — nó đang chạy tốt trên production.
--   • Bảng customers (042): tưởng khoá warehouse/driver, nhưng policy có
--     nhánh user_has_permission(auth.uid(), 'customer.view_all') nên hai
--     vai trò này vẫn xem được. Chủ sở hữu đã xác nhận thực tế đúng vậy.
-- ====================================================================


-- --------------------------------------------------------------------
-- 1. suppliers — thêm lọc org_id.
--
-- Policy cũ (migration 006) dùng USING (true): MỌI người đã đăng nhập
-- thấy nhà cung cấp của MỌI tổ chức. Với 1 tổ chức/1 DB thì không rò rỉ
-- gì, nhưng đây là quả bom hẹn giờ nếu gộp nhiều tổ chức về sau.
--
-- KHÔNG ĐỔI HÀNH VI: mọi dòng đều cùng một org_id.
-- Không có nguy cơ đệ quy: user_org_id() truy vấn bảng users, khác bảng.
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can view suppliers" ON suppliers;
CREATE POLICY "Authenticated can view suppliers"
  ON suppliers FOR SELECT
  TO authenticated
  USING (org_id = public.user_org_id());


-- --------------------------------------------------------------------
-- 2. Bật security_invoker cho 4 view.
--
-- Postgres 15+ mặc định chạy view bằng quyền CHỦ SỞ HỮU view, nghĩa là
-- chúng BỎ QUA HOÀN TOÀN RLS của các bảng bên dưới. Bật security_invoker
-- khiến view chạy bằng quyền người gọi → RLS được áp dụng đúng.
--
-- ĐÃ KIỂM TÁC ĐỘNG TỪNG VIEW trước khi bật (đây là chỗ dễ gây sự cố
-- ngầm nhất: view luôn trả 200 + [] nên nếu vỡ thì KHÔNG BAO GIỜ có lỗi
-- để hiển thị):
--   • v_stock_balance_by_zone, v_stock_movements → đọc bảng batches.
--     Policy SELECT của batches là `org_id = user_org_id()`, KHÔNG giới
--     hạn vai trò → mọi vai trò vẫn thấy đủ như trước.
--   • v_sales_order_line_picked → đọc sales_order_lines/stock_entry_lines.
--     Chỉ dùng trong trang chi tiết đơn, nơi người dùng vốn đã xem được
--     đơn đó, nên RLS cho qua.
--   • v_uom_audit → không được dùng ở bất kỳ đâu trong src/.
--
-- HOÀN TÁC nếu có trang nào bỗng rỗng (dán vào SQL Editor):
--   ALTER VIEW public.v_stock_balance_by_zone   SET (security_invoker = false);
--   ALTER VIEW public.v_stock_movements         SET (security_invoker = false);
--   ALTER VIEW public.v_sales_order_line_picked SET (security_invoker = false);
--   ALTER VIEW public.v_uom_audit               SET (security_invoker = false);
-- --------------------------------------------------------------------
DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'v_stock_balance_by_zone',
    'v_stock_movements',
    'v_sales_order_line_picked',
    'v_uom_audit'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.views
      WHERE table_schema = 'public' AND table_name = v
    ) THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
    END IF;
  END LOOP;
END $$;


-- --------------------------------------------------------------------
-- 3. payments — cho ý đồ siết quyền của migration 033 có hiệu lực.
--
-- 033 tạo policy "Sales see own order payments" nhằm giới hạn nhân viên
-- bán hàng chỉ thấy phiếu thu của đơn mình tạo. Nhưng policy rộng của
-- 002 ("Org members can view payments") KHÔNG bị gỡ, mà nhiều policy
-- SELECT được cộng dồn bằng OR → ý đồ của 033 bị vô hiệu hoàn toàn.
--
-- Cách sửa: policy rộng loại trừ vai trò 'sales'; nhân viên bán hàng đi
-- theo policy riêng của 033.
--
-- ĐÂY LÀ THAY ĐỔI HÀNH VI THẬT (khác mục 1 và 2):
--   • owner / manager / accountant / warehouse / driver: KHÔNG đổi.
--   • sales: từ nay chỉ thấy phiếu thu thuộc đơn DO MÌNH TẠO.
-- Nếu nghiệp vụ cần nhân viên bán hàng xem phiếu thu của đồng nghiệp,
-- HOÀN TÁC bằng cách chạy:
--   DROP POLICY IF EXISTS "Org members can view payments" ON payments;
--   CREATE POLICY "Org members can view payments" ON payments FOR SELECT
--     USING (EXISTS (SELECT 1 FROM receivables r
--                    WHERE r.id = receivable_id AND r.org_id = public.user_org_id()));
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Org members can view payments" ON payments;
CREATE POLICY "Org members can view payments"
  ON payments FOR SELECT
  USING (
    public.user_role() <> 'sales'
    AND EXISTS (
      SELECT 1 FROM receivables r
      WHERE r.id = receivable_id AND r.org_id = public.user_org_id()
    )
  );

-- Đảm bảo policy dành cho sales của 033 thực sự tồn tại (nếu 033 chưa
-- chạy thì nhân viên bán hàng sẽ mất sạch quyền xem phiếu thu).
DROP POLICY IF EXISTS "Sales see own order payments" ON payments;
CREATE POLICY "Sales see own order payments"
  ON payments FOR SELECT
  USING (
    public.user_role() = 'sales'
    AND EXISTS (
      SELECT 1 FROM receivables r
      JOIN sales_orders so ON so.id = r.order_id
      WHERE r.id = payments.receivable_id
        AND so.sales_user_id = (SELECT auth.uid())
    )
  );


-- ====================================================================
-- KIỂM TRA SAU KHI CHẠY
-- ====================================================================
-- 1) Ba thay đổi đã vào chưa — cả 3 phải true:
-- SELECT
--   (SELECT count(*) = 1 FROM pg_policies
--     WHERE tablename='suppliers' AND policyname='Authenticated can view suppliers'
--       AND qual LIKE '%user_org_id%')                        AS suppliers_da_loc_org,
--   (SELECT count(*) = 2 FROM pg_policies
--     WHERE tablename='payments'
--       AND policyname IN ('Org members can view payments','Sales see own order payments'))
--                                                             AS payments_du_2_policy,
--   (SELECT count(*) >= 3 FROM pg_views v
--     JOIN pg_class c ON c.relname = v.viewname
--     WHERE v.schemaname='public' AND v.viewname LIKE 'v_%'
--       AND c.reloptions::text LIKE '%security_invoker=true%') AS view_da_bat_invoker;
--
-- 2) QUAN TRỌNG — sau khi chạy, nhờ một nhân viên MỖI VAI TRÒ mở thử:
--    kho (trang Kho hàng + lịch sử xuất nhập), kế toán (Phiếu thu),
--    bán hàng (Công nợ). Nếu có trang nào bỗng rỗng → dùng lệnh HOÀN TÁC
--    tương ứng ở phần comment phía trên.


-- ####################################################################
-- # 093_aggregate_functions.sql
-- ####################################################################

-- ====================================================================
-- 093_aggregate_functions
--
-- Cộng số Ở PHÍA DATABASE thay vì tải dữ liệu về trình duyệt rồi cộng.
--
-- BỐI CẢNH
-- `db.max_rows` của dự án là 1.000. Trước đây các trang tổng hợp tải cả
-- bảng về rồi cộng bằng JavaScript, nên khi vượt trần thì API trả 200
-- kèm đúng 1.000 dòng, KHÔNG có lỗi — trang hiện một con số trông bình
-- thường nhưng thiếu. Lớp `src/lib/supabase/aggregate.ts` đã vá bằng cách
-- chia trang lấy đủ, nhưng đó vẫn là hàng chục request và vài MB dữ liệu
-- chỉ để ra một con số.
--
-- Các hàm dưới đây trả về SẴN kết quả đã cộng: một request, vài chục byte,
-- và chính xác tuyệt đối vì Postgres cộng trên toàn bộ dữ liệu.
--
-- BẢO MẬT — ĐỌC KỸ TRƯỚC KHI SỬA
-- Tất cả đều để SECURITY INVOKER (mặc định), tức là chạy bằng quyền NGƯỜI
-- GỌI nên RLS của các bảng bên dưới vẫn được áp dụng. Nhân viên bán hàng
-- gọi `receivables_by_rep()` chỉ cộng được trên những dòng RLS cho họ thấy.
--
--   ⚠️ TUYỆT ĐỐI KHÔNG đổi sang SECURITY DEFINER để "cho tiện".
--      Làm vậy là mở toang toàn bộ số liệu tài chính cho mọi vai trò,
--      và sẽ không có lỗi nào báo cho bạn biết.
--
-- Ngoại lệ có chủ đích: `public.user_org_id()` vốn đã là SECURITY DEFINER
-- (từ migration 002) vì nó phải đọc bảng users để biết người gọi thuộc tổ
-- chức nào. Đó là hàm chỉ trả về org_id của CHÍNH người gọi.
--
-- QUY ƯỚC
-- Mỗi hàm đều lọc `org_id = public.user_org_id()` — phòng vệ chiều sâu,
-- không phụ thuộc hoàn toàn vào RLS.
-- Idempotent: DROP trước CREATE (xem bài học ở migration 091).
-- ====================================================================


-- --------------------------------------------------------------------
-- 1. receivables_summary — tổng công nợ phải thu + phân nhóm tuổi nợ.
--
-- Dùng ở trang /receivables. Ngưỡng chia nhóm PHẢI khớp với
-- `getAgingStatus()` trong src/lib/utils.ts:
--     <= 0 ngày quá hạn → current
--     <= 30             → warning
--     <= 60             → overdue
--     > 60              → critical
-- Sửa một bên mà quên bên kia là hai chỗ ra hai con số khác nhau.
--
-- Trả về 1 dòng.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.receivables_summary();
CREATE FUNCTION public.receivables_summary()
RETURNS TABLE (
  total_outstanding  numeric,
  current_amount     numeric,
  current_count      bigint,
  warning_amount     numeric,
  warning_count      bigint,
  overdue_amount     numeric,
  overdue_count      bigint,
  critical_amount    numeric,
  critical_count     bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH r AS (
    SELECT
      GREATEST(0, COALESCE(amount, 0) - COALESCE(paid, 0)) AS remaining,
      CASE
        WHEN due_date IS NULL THEN 'current'
        WHEN (CURRENT_DATE - due_date) <= 0  THEN 'current'
        WHEN (CURRENT_DATE - due_date) <= 30 THEN 'warning'
        WHEN (CURRENT_DATE - due_date) <= 60 THEN 'overdue'
        ELSE 'critical'
      END AS bucket
    FROM receivables
    WHERE org_id = public.user_org_id()
      AND status <> 'paid'
  )
  SELECT
    COALESCE(SUM(remaining), 0),
    COALESCE(SUM(remaining) FILTER (WHERE bucket = 'current'),  0),
    COUNT(*)                FILTER (WHERE bucket = 'current'),
    COALESCE(SUM(remaining) FILTER (WHERE bucket = 'warning'),  0),
    COUNT(*)                FILTER (WHERE bucket = 'warning'),
    COALESCE(SUM(remaining) FILTER (WHERE bucket = 'overdue'),  0),
    COUNT(*)                FILTER (WHERE bucket = 'overdue'),
    COALESCE(SUM(remaining) FILTER (WHERE bucket = 'critical'), 0),
    COUNT(*)                FILTER (WHERE bucket = 'critical')
  FROM r;
$$;


-- --------------------------------------------------------------------
-- 2. receivables_by_rep — công nợ gộp theo nhân viên bán hàng.
--
-- Dùng ở /receivables/by-rep. Số dòng trả về = số nhân viên, không phải
-- số dòng công nợ.
--
-- Lưu ý về DSO: chỉ tính trên các dòng CHƯA thanh toán xong, và số ngày
-- quá hạn ép sàn về 0 (chưa đến hạn không được kéo trung bình xuống âm) —
-- giống hệt logic cũ ở trình duyệt.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.receivables_by_rep();
CREATE FUNCTION public.receivables_by_rep()
RETURNS TABLE (
  user_id             uuid,
  full_name           text,
  customer_count      bigint,
  customers_with_debt bigint,
  total_debt          numeric,
  total_paid          numeric,
  total_amount        numeric,
  overdue_amount      numeric,
  collection_rate     integer,
  dso                 integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH r AS (
    SELECT
      rc.sales_user_id,
      rc.customer_id,
      COALESCE(rc.amount, 0) AS amount,
      COALESCE(rc.paid, 0)   AS paid,
      COALESCE(rc.amount, 0) - COALESCE(rc.paid, 0) AS remaining,
      rc.status,
      rc.status <> 'paid' AS has_debt,
      GREATEST(0, CURRENT_DATE - COALESCE(rc.due_date, CURRENT_DATE)) AS aging_days
    FROM receivables rc
    WHERE rc.org_id = public.user_org_id()
      AND rc.sales_user_id IS NOT NULL
  )
  SELECT
    r.sales_user_id,
    COALESCE(u.full_name, '-'),
    COUNT(DISTINCT r.customer_id),
    COUNT(DISTINCT r.customer_id) FILTER (WHERE r.has_debt),
    COALESCE(SUM(r.remaining), 0),
    COALESCE(SUM(r.paid), 0),
    COALESCE(SUM(r.amount), 0),
    COALESCE(SUM(r.remaining) FILTER (WHERE r.status = 'overdue'), 0),
    CASE WHEN COALESCE(SUM(r.amount), 0) > 0
         THEN ROUND(SUM(r.paid) / SUM(r.amount) * 100)::integer
         ELSE 0 END,
    CASE WHEN COUNT(*) FILTER (WHERE r.has_debt) > 0
         THEN ROUND(
                AVG(r.aging_days) FILTER (WHERE r.has_debt)
              )::integer
         ELSE 0 END
  FROM r
  LEFT JOIN users u ON u.id = r.sales_user_id
  GROUP BY r.sales_user_id, u.full_name
  ORDER BY COALESCE(SUM(r.remaining), 0) DESC;
$$;


-- --------------------------------------------------------------------
-- 3. receivables_by_customer — công nợ gộp theo khách hàng.
--
-- Dùng ở /receivables/by-customer. Chỉ tính dòng CHƯA thanh toán xong,
-- đúng như truy vấn cũ (`.neq("status", "paid")`).
--
-- `rep_name` lấy theo người phụ trách chính (customer_assignments role =
-- 'primary'); không có thì lấy nhân viên trên dòng công nợ — đúng thứ tự
-- ưu tiên của mã cũ.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.receivables_by_customer();
CREATE FUNCTION public.receivables_by_customer()
RETURNS TABLE (
  customer_id    uuid,
  store_name     text,
  phone          text,
  rep_name       text,
  total_debt     numeric,
  total_paid     numeric,
  remaining      numeric,
  overdue_amount numeric,
  credit_limit   numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH r AS (
    SELECT
      rc.customer_id,
      COALESCE(rc.amount, 0) AS amount,
      COALESCE(rc.paid, 0)   AS paid,
      COALESCE(rc.amount, 0) - COALESCE(rc.paid, 0) AS remaining,
      rc.status,
      rc.sales_user_id
    FROM receivables rc
    WHERE rc.org_id = public.user_org_id()
      AND rc.status <> 'paid'
  ),
  agg AS (
    SELECT
      r.customer_id,
      SUM(r.amount)     AS total_debt,
      SUM(r.paid)       AS total_paid,
      SUM(r.remaining)  AS remaining,
      COALESCE(SUM(r.remaining) FILTER (WHERE r.status = 'overdue'), 0) AS overdue_amount,
      -- Lấy một sales_user_id bất kỳ làm phương án dự phòng cho rep_name.
      MIN(r.sales_user_id::text)::uuid AS any_sales_user_id
    FROM r
    GROUP BY r.customer_id
  )
  SELECT
    agg.customer_id,
    COALESCE(c.store_name, '-'),
    COALESCE(c.phone, '-'),
    COALESCE(pa.full_name, su.full_name, '-'),
    agg.total_debt,
    agg.total_paid,
    agg.remaining,
    agg.overdue_amount,
    COALESCE(c.credit_limit, 0)
  FROM agg
  LEFT JOIN customers c ON c.id = agg.customer_id
  LEFT JOIN LATERAL (
    SELECT u.full_name
    FROM customer_assignments ca
    JOIN users u ON u.id = ca.user_id
    WHERE ca.customer_id = agg.customer_id AND ca.role = 'primary'
    LIMIT 1
  ) pa ON true
  LEFT JOIN users su ON su.id = agg.any_sales_user_id
  ORDER BY agg.remaining DESC;
$$;


-- --------------------------------------------------------------------
-- 4. payables_by_supplier — công nợ phải trả gộp theo nhà cung cấp.
--    Dùng ở /payables/by-supplier.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.payables_by_supplier();
CREATE FUNCTION public.payables_by_supplier()
RETURNS TABLE (
  supplier_id    uuid,
  supplier_name  text,
  supplier_code  text,
  invoice_count  bigint,
  total_debt     numeric,
  total_paid     numeric,
  remaining      numeric,
  overdue_count  bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    p.supplier_id,
    COALESCE(s.name, '-'),
    COALESCE(s.code, '-'),
    COUNT(*),
    COALESCE(SUM(p.amount), 0),
    COALESCE(SUM(p.paid), 0),
    COALESCE(SUM(COALESCE(p.amount, 0) - COALESCE(p.paid, 0)), 0),
    COUNT(*) FILTER (WHERE p.status = 'overdue')
  FROM payables p
  LEFT JOIN suppliers s ON s.id = p.supplier_id
  WHERE p.org_id = public.user_org_id()
    AND p.status <> 'paid'
  GROUP BY p.supplier_id, s.name, s.code
  ORDER BY COALESCE(SUM(COALESCE(p.amount, 0) - COALESCE(p.paid, 0)), 0) DESC;
$$;


-- --------------------------------------------------------------------
-- 5. payables_summary — tổng công nợ phải trả + tổng nhập trong kỳ.
--    Dùng ở /purchasing.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.payables_summary(timestamptz);
CREATE FUNCTION public.payables_summary(p_since timestamptz)
RETURNS TABLE (
  open_payables numeric,
  month_total   numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE((
      SELECT SUM(GREATEST(0, COALESCE(amount, 0) - COALESCE(paid, 0)))
      FROM payables
      WHERE org_id = public.user_org_id() AND status <> 'paid'
    ), 0),
    COALESCE((
      SELECT SUM(COALESCE(amount, 0))
      FROM payables
      WHERE org_id = public.user_org_id()
        AND created_at >= p_since
        AND stock_entry_id IS NOT NULL
    ), 0);
$$;


-- --------------------------------------------------------------------
-- 6. stock_value_summary — giá trị tồn kho theo giá vốn lô.
--    Dùng ở /reports/finance và bảng cân đối kế toán.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.stock_value_summary();
CREATE FUNCTION public.stock_value_summary()
RETURNS TABLE (
  inventory_value numeric,
  batch_count     bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(COALESCE(qty_on_hand, 0) * COALESCE(unit_cost, 0)), 0),
    COUNT(*)
  FROM batches
  WHERE org_id = public.user_org_id()
    AND COALESCE(qty_on_hand, 0) > 0;
$$;


-- --------------------------------------------------------------------
-- 7. finance_pnl — báo cáo lãi lỗ cho một khoảng ngày.
--
-- Doanh thu = tổng đơn đã giao trong kỳ (theo order_date).
-- Giá vốn   = tổng |quantity| × unit_cost của các dòng thuộc phiếu XUẤT
--             đã ghi sổ trong kỳ (theo posted_at).
-- Chi phí   = bảng expenses, gộp theo bucket của danh mục.
--
-- Trả chi phí theo từng bucket thành cột riêng thay vì JSON, để phía
-- TypeScript đọc thẳng không phải parse.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.finance_pnl(date, date);
CREATE FUNCTION public.finance_pnl(p_from date, p_to date)
RETURNS TABLE (
  revenue        numeric,
  order_count    bigint,
  cogs           numeric,
  exp_cogs       numeric,
  exp_operating  numeric,
  exp_hr         numeric,
  exp_financial  numeric,
  exp_tax        numeric,
  exp_other      numeric,
  total_expenses numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH rev AS (
    SELECT COALESCE(SUM(COALESCE(total, 0)), 0) AS revenue, COUNT(*) AS order_count
    FROM sales_orders
    WHERE org_id = public.user_org_id()
      AND status = 'delivered'
      AND order_date >= p_from
      AND order_date <= p_to
  ),
  cogs AS (
    SELECT COALESCE(SUM(ABS(COALESCE(l.quantity, 0)) * COALESCE(l.unit_cost, 0)), 0) AS cogs
    FROM stock_entry_lines l
    JOIN stock_entries e ON e.id = l.entry_id
    WHERE e.org_id = public.user_org_id()
      AND e.type = 'export'
      AND e.status = 'posted'
      AND e.posted_at >= p_from::timestamptz
      AND e.posted_at <  (p_to + 1)::timestamptz
  ),
  exp AS (
    SELECT
      -- Danh mục không có bucket thì rơi vào 'other', giống mã cũ.
      COALESCE(ec.bucket, 'other') AS bucket,
      SUM(COALESCE(x.amount, 0))   AS amt
    FROM expenses x
    LEFT JOIN expense_categories ec ON ec.id = x.category_id
    WHERE x.org_id = public.user_org_id()
      AND x.expense_date >= p_from
      AND x.expense_date <= p_to
    GROUP BY COALESCE(ec.bucket, 'other')
  )
  SELECT
    rev.revenue,
    rev.order_count,
    cogs.cogs,
    COALESCE((SELECT amt FROM exp WHERE bucket = 'cogs'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'operating'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'hr'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'financial'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'tax'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'other'), 0),
    COALESCE((SELECT SUM(amt) FROM exp), 0)
  FROM rev, cogs;
$$;


-- --------------------------------------------------------------------
-- 8. finance_balance_sheet — bảng cân đối kế toán tại một ngày.
--
-- Giữ NGUYÊN công thức đơn giản hoá của mã cũ, kể cả những chỗ chưa
-- chuẩn mực kế toán, để con số không đổi khi chuyển sang cộng ở database:
--   Tiền     = tiền đã thu − chi trả NCC − chi phí đã trả
--   Phải thu = tổng (amount − paid) của công nợ chưa tất toán
--   Tồn kho  = Σ qty_on_hand × unit_cost
--   Phải trả = tổng (amount − paid) của công nợ NCC chưa tất toán
--   Chi phí chưa trả = tổng expenses có is_paid = false
--   Vốn chủ sở hữu = tài sản − nợ phải trả (số chốt)
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.finance_balance_sheet(date);
CREATE FUNCTION public.finance_balance_sheet(p_as_of date)
RETURNS TABLE (
  cash                 numeric,
  accounts_receivable  numeric,
  inventory            numeric,
  accounts_payable     numeric,
  unpaid_expenses      numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH
  cash_in AS (
    SELECT COALESCE(SUM(COALESCE(p.amount, 0)), 0) AS v
    FROM payments p
    JOIN receivables r ON r.id = p.receivable_id
    WHERE r.org_id = public.user_org_id()
      AND p.collected_at < (p_as_of + 1)::timestamptz
  ),
  paid_payables AS (
    SELECT COALESCE(SUM(COALESCE(pp.amount, 0)), 0) AS v
    FROM payable_payments pp
    JOIN payables pa ON pa.id = pp.payable_id
    WHERE pa.org_id = public.user_org_id()
      AND pp.paid_at < (p_as_of + 1)::timestamptz
  ),
  exp AS (
    SELECT
      COALESCE(SUM(COALESCE(amount, 0)) FILTER (WHERE is_paid), 0)     AS paid,
      COALESCE(SUM(COALESCE(amount, 0)) FILTER (WHERE NOT is_paid), 0) AS unpaid
    FROM expenses
    WHERE org_id = public.user_org_id()
      AND expense_date <= p_as_of
  ),
  ar AS (
    SELECT COALESCE(SUM(GREATEST(0, COALESCE(amount, 0) - COALESCE(paid, 0))), 0) AS v
    FROM receivables
    WHERE org_id = public.user_org_id() AND status <> 'paid'
  ),
  inv AS (
    SELECT COALESCE(SUM(COALESCE(qty_on_hand, 0) * COALESCE(unit_cost, 0)), 0) AS v
    FROM batches
    WHERE org_id = public.user_org_id() AND COALESCE(qty_on_hand, 0) > 0
  ),
  ap AS (
    SELECT COALESCE(SUM(GREATEST(0, COALESCE(amount, 0) - COALESCE(paid, 0))), 0) AS v
    FROM payables
    WHERE org_id = public.user_org_id() AND status <> 'paid'
  )
  SELECT
    cash_in.v - paid_payables.v - exp.paid,
    ar.v,
    inv.v,
    ap.v,
    exp.unpaid
  FROM cash_in, paid_payables, exp, ar, inv, ap;
$$;


-- --------------------------------------------------------------------
-- 9. finance_cash_flow — lưu chuyển tiền tệ (chỉ phần hoạt động kinh doanh).
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.finance_cash_flow(date, date);
CREATE FUNCTION public.finance_cash_flow(p_from date, p_to date)
RETURNS TABLE (
  cash_from_customers numeric,
  cash_to_suppliers   numeric,
  cash_to_expenses    numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE((
      SELECT SUM(COALESCE(p.amount, 0))
      FROM payments p
      JOIN receivables r ON r.id = p.receivable_id
      WHERE r.org_id = public.user_org_id()
        AND p.collected_at >= p_from::timestamptz
        AND p.collected_at <  (p_to + 1)::timestamptz
    ), 0),
    COALESCE((
      SELECT SUM(COALESCE(pp.amount, 0))
      FROM payable_payments pp
      JOIN payables pa ON pa.id = pp.payable_id
      WHERE pa.org_id = public.user_org_id()
        AND pp.paid_at >= p_from::timestamptz
        AND pp.paid_at <  (p_to + 1)::timestamptz
    ), 0),
    COALESCE((
      SELECT SUM(COALESCE(amount, 0))
      FROM expenses
      WHERE org_id = public.user_org_id()
        AND is_paid = true
        AND paid_at >= p_from::timestamptz
        AND paid_at <  (p_to + 1)::timestamptz
    ), 0);
$$;


-- --------------------------------------------------------------------
-- 10. dashboard_summary — các con số trên trang Tổng quan.
--
-- `p_period_start` là mốc đầu kỳ do giao diện chọn (hôm nay / tuần / tháng
-- / quý), truyền vào để trang chủ và hàm này luôn cùng một mốc.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.dashboard_summary(date);
CREATE FUNCTION public.dashboard_summary(p_period_start date)
RETURNS TABLE (
  period_revenue    numeric,
  period_orders     bigint,
  open_receivables  numeric,
  overdue_count     bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE((
      SELECT SUM(COALESCE(total, 0)) FROM sales_orders
      WHERE org_id = public.user_org_id() AND order_date >= p_period_start
    ), 0),
    COALESCE((
      SELECT COUNT(*) FROM sales_orders
      WHERE org_id = public.user_org_id() AND order_date >= p_period_start
    ), 0),
    COALESCE((
      SELECT SUM(GREATEST(0, COALESCE(amount, 0) - COALESCE(paid, 0)))
      FROM receivables
      WHERE org_id = public.user_org_id() AND status <> 'paid'
    ), 0),
    COALESCE((
      SELECT COUNT(*) FROM receivables
      WHERE org_id = public.user_org_id() AND status = 'overdue'
    ), 0);
$$;


-- --------------------------------------------------------------------
-- 11. dashboard_top_customers — top khách hàng theo doanh thu trong kỳ.
--     Trả về đúng `p_limit` dòng thay vì cả bảng đơn hàng.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.dashboard_top_customers(date, integer);
CREATE FUNCTION public.dashboard_top_customers(p_period_start date, p_limit integer DEFAULT 5)
RETURNS TABLE (
  customer_id uuid,
  store_name  text,
  total       numeric,
  order_count bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    o.customer_id,
    COALESCE(c.store_name, 'N/A'),
    COALESCE(SUM(COALESCE(o.total, 0)), 0),
    COUNT(*)
  FROM sales_orders o
  LEFT JOIN customers c ON c.id = o.customer_id
  WHERE o.org_id = public.user_org_id()
    AND o.order_date >= p_period_start
    AND o.customer_id IS NOT NULL
  GROUP BY o.customer_id, c.store_name
  ORDER BY COALESCE(SUM(COALESCE(o.total, 0)), 0) DESC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;


-- --------------------------------------------------------------------
-- 12. dashboard_channel_revenue — doanh thu theo kênh khách hàng.
--     Khách không gắn kênh gộp vào "Khác", giống mã cũ.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.dashboard_channel_revenue(date);
CREATE FUNCTION public.dashboard_channel_revenue(p_period_start date)
RETURNS TABLE (
  channel text,
  total   numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE(NULLIF(c.channel, ''), 'Khác'),
    COALESCE(SUM(COALESCE(o.total, 0)), 0)
  FROM sales_orders o
  LEFT JOIN customers c ON c.id = o.customer_id
  WHERE o.org_id = public.user_org_id()
    AND o.order_date >= p_period_start
  GROUP BY COALESCE(NULLIF(c.channel, ''), 'Khác')
  ORDER BY COALESCE(SUM(COALESCE(o.total, 0)), 0) DESC;
$$;


-- --------------------------------------------------------------------
-- 13. cash_received_total — tổng tiền mặt đã nhận trong kỳ.
--     Chỉ tính phiếu thu đã được kế toán xác nhận (status = 'received').
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cash_received_total(date, date);
CREATE FUNCTION public.cash_received_total(p_from date, p_to date)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(COALESCE(submitted_amount, 0)), 0)
  FROM cash_receipts
  WHERE org_id = public.user_org_id()
    AND status = 'received'
    AND receipt_date >= p_from
    AND receipt_date <= p_to;
$$;


-- --------------------------------------------------------------------
-- Quyền gọi. `authenticated` là đủ — RLS vẫn chặn ở tầng bảng.
-- KHÔNG cấp cho `anon`: người chưa đăng nhập không có org_id nên hàm sẽ
-- trả 0, nhưng không việc gì phải để lộ bề mặt gọi được.
-- --------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.receivables_summary()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.receivables_by_rep()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.receivables_by_customer()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_by_supplier()           TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_summary(timestamptz)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.stock_value_summary()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_pnl(date, date)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_balance_sheet(date)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_cash_flow(date, date)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_summary(date)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_top_customers(date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_channel_revenue(date)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.cash_received_total(date, date)  TO authenticated;


-- ====================================================================
-- KIỂM TRA SAU KHI CHẠY
-- ====================================================================
-- 1) Cả 13 hàm đã tạo chưa — phải ra đúng 13 dòng:
-- SELECT proname FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND proname IN (
--    'receivables_summary','receivables_by_rep','receivables_by_customer',
--    'payables_by_supplier','payables_summary','stock_value_summary',
--    'finance_pnl','finance_balance_sheet','finance_cash_flow',
--    'dashboard_summary','dashboard_top_customers','dashboard_channel_revenue',
--    'cash_received_total')
--  ORDER BY proname;
--
-- 2) KHÔNG hàm nào được là SECURITY DEFINER — phải ra 0 dòng:
-- SELECT proname FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.prosecdef
--    AND proname IN ('receivables_summary','receivables_by_rep',
--      'receivables_by_customer','payables_by_supplier','payables_summary',
--      'stock_value_summary','finance_pnl','finance_balance_sheet',
--      'finance_cash_flow','dashboard_summary','dashboard_top_customers',
--      'dashboard_channel_revenue','cash_received_total');
--
-- 3) Đối chiếu số cũ và số mới — hai cột phải BẰNG NHAU:
-- SELECT
--   (SELECT total_outstanding FROM public.receivables_summary()) AS ham_moi,
--   (SELECT COALESCE(SUM(GREATEST(0, amount - paid)), 0)
--      FROM receivables
--     WHERE org_id = public.user_org_id() AND status <> 'paid') AS cong_tay;
-- ====================================================================


-- ####################################################################
-- # 094_payroll_revenue_and_manual_edits.sql
-- ####################################################################

-- ====================================================================
-- 094 — Sửa 5 lỗi bảng lương & doanh thu chạm trực tiếp vào tiền
--
-- Tất cả đều đã được đọc mã và tái hiện, không phải suy đoán. Mỗi mục
-- ghi rõ bằng chứng để người sau kiểm lại được.
--
--  1. DOANH SỐ BỎ SÓT ĐƠN ĐANG GIAO (067:112)
--     Bộ lọc cũ: status IN ('delivered','confirmed').
--     Nhưng vòng đời đơn có 6 trạng thái (001_schema.sql:167) và
--     'picking' / 'delivering' nằm ĐÚNG GIỮA 'confirmed' và 'delivered'
--     (stock-out/page.tsx:703 đặt 'picking'; entries/[id]/page.tsx:300
--     đặt 'delivering'). Nghĩa là mọi đơn đều PHẢI đi qua hai trạng thái
--     bị bỏ sót đó.
--     Hậu quả: đơn được tính khi mới chốt, BIẾN MẤT lúc kho soạn hàng,
--     rồi hiện lại khi giao xong. Cùng một tháng, bấm "Tính lại" ở hai
--     thời điểm khác nhau ra hai bảng lương khác nhau — và vì lương có
--     ngưỡng 60%/70%, một nhân viên đủ chỉ tiêu có thể rơi xuống nhánh
--     phạt chỉ vì hàng đang trên đường giao.
--     Sửa: doanh số = đơn đã chốt và chưa huỷ.
--
--  2. CẤU HÌNH THƯỞNG THEO TUẦN BỊ BỎ QUA (067:181)
--     `period` được SELECT vào v_oc_cfg rồi KHÔNG đọc lại lần nào
--     (grep v_oc_cfg trong 067: chỉ dùng min_order_count, min_order_value,
--     bonus_per_order). Cột này NOT NULL CHECK IN ('week','month')
--     (043:47) và "Tuần" là lựa chọn thật trên giao diện
--     (settings/users/[id]/salary/page.tsx:477).
--     Hậu quả: chọn "Tuần" thì ngưỡng số đơn được đem so với số đơn CẢ
--     THÁNG, rồi nhân thưởng cho toàn bộ đơn trong tháng — trả thừa
--     khoảng 4,3 lần, im lặng.
--     Sửa: gom đơn theo tuần, mỗi tuần xét ngưỡng riêng.
--
--  3. "TÍNH LẠI" XOÁ TRẮNG SỐ KẾ TOÁN ĐÃ SỬA TAY (067:73)
--     `DELETE FROM payroll_run_items` rồi INSERT lại với
--     manual_adjustment = 0, deductions = 0, notes = NULL.
--     Hậu quả: kế toán trừ tạm ứng 2 triệu, ai đó bấm "Tính lại" —
--     khoản trừ biến mất, thực lĩnh vọt lên đúng 2 triệu, không cảnh báo,
--     không phục hồi được.
--     Sửa: đổi sang UPSERT, chỉ ghi đè các cột do MÁY tính; giữ nguyên
--     manual_adjustment / deductions / overtime / notes.
--
--  4. AI CŨNG GỌI ĐƯỢC HÀM TÍNH LƯƠNG (050:265)
--     compute_payroll_run và lock_payroll_run là SECURITY DEFINER,
--     GRANT cho `authenticated`, và bên trong chỉ kiểm org + trạng thái
--     khoá — KHÔNG kiểm vai trò.
--     Hậu quả: một tài khoản bán hàng hoặc lái xe gọi thẳng RPC là tính
--     lại (hoặc khoá cứng) bảng lương của cả công ty.
--     Sửa: chỉ owner / manager / accountant.
--
--  5. DOANH THU TRÊN TRANG TỔNG QUAN TÍNH CẢ ĐƠN NHÁP VÀ ĐƠN ĐÃ HUỶ
--     (093:536, :579, :606 — ba hàm dashboard không có mệnh đề status
--     nào). Mã chạy trước 093 cũng vậy nên đây là lỗi có sẵn được bê
--     nguyên vào SQL, không phải lỗi mới; nhưng giờ nó nằm ở một chỗ
--     nên sửa một lần là xong.
--     Hậu quả: huỷ một đơn 50 triệu, doanh thu trên trang chủ không đổi.
--     Sửa: dùng cùng một định nghĩa doanh thu với bảng lương.
--
-- CÒN LẠI, CỐ Ý KHÔNG SỬA Ở ĐÂY (cần chủ NPP quyết, không phải lỗi kỹ thuật):
--   • Doanh số tính lương đang là doanh số GỘP — hàng trả lại không bị
--     trừ, trong khi báo cáo nhân viên thì có trừ. Hai màn hình cùng
--     ghi "doanh số của NV X" ra hai số khác nhau. Trả lương trên gộp
--     hay trên thuần là chính sách, không phải bug — nêu ra để chốt.
-- ====================================================================


-- --------------------------------------------------------------------
-- Định nghĩa doanh thu dùng chung: đơn đã chốt và chưa huỷ.
-- Đặt thành hàm để bốn chỗ đang đếm doanh thu không trôi khỏi nhau nữa.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.is_revenue_status(text);
CREATE FUNCTION public.is_revenue_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_status, '') NOT IN ('draft', 'cancelled');
$$;

COMMENT ON FUNCTION public.is_revenue_status(text) IS
  'Đơn có được tính vào doanh thu không. Đã chốt và chưa huỷ = có. '
  'Bao gồm picking/delivering: hàng đã xuất kho, đang trên đường giao, '
  'không thể biến mất khỏi doanh số chỉ vì chưa bấm nút giao xong.';


-- --------------------------------------------------------------------
-- 1+2+3+4. compute_payroll_run
--
-- Thân hàm dưới đây là BẢN 067 NGUYÊN VĂN, chỉ vá đúng 4 chỗ đánh dấu
-- [1] [2] [3] [4]. Cố ý không gõ lại từ đầu: lần thử đầu tiên tôi chép
-- tay phần thưởng KPI và đã đặt nhầm công thức (lấy 'bonus_percent' ×
-- lương CB trong khi 067 dùng trường 'bonus' là số tiền tuyệt đối), sai
-- luôn tên cột cấu hình ngày công. Với hàm tính tiền thì chép tay là
-- cách chắc chắn nhất để tạo ra một lỗi mới trong lúc sửa lỗi cũ.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION compute_payroll_run(p_run_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org      uuid;
  v_month    date;
  v_status   text;
  v_period_start date;
  v_period_end   date;
  u          record;
  v_revenue  numeric;
  v_base_salary numeric;
  v_gas      numeric;
  v_phone    numeric;
  v_allowances numeric;
  v_emp_gas   numeric;
  v_emp_phone numeric;
  v_emp_allowances numeric;
  v_std_days numeric;
  v_act_days numeric;
  v_prorated numeric;
  v_kpi      numeric;
  v_kpi_partial numeric;
  v_kpi_tier record;
  v_kpi_per_user bool;
  v_kpi_target numeric;
  v_kpi_tiers  jsonb;
  v_kpi_pct    numeric;
  v_kpi_breakdown jsonb;
  v_over_pct   numeric;
  v_under_60_pct numeric;
  v_low_perf   text;
  v_oc_cfg   record;
  v_oc_count int;
  v_oc_bonus numeric;
  v_activity numeric;
  v_si       numeric;
  v_net      numeric;
  v_count    int := 0;
  v_role     text;
  v_oc_paid  int;
  v_touched  uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT org_id, month, status INTO v_org, v_month, v_status
  FROM payroll_runs WHERE id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYROLL_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'locked' THEN
    RAISE EXCEPTION 'PAYROLL_RUN_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- [4] Hàm là SECURITY DEFINER + GRANT cho `authenticated`, mà trước đây
  --     chỉ kiểm org và trạng thái khoá. Không chặn ở đây thì một tài
  --     khoản bán hàng hoặc lái xe gọi thẳng RPC là tính lại được bảng
  --     lương của cả công ty.
  SELECT role INTO v_role FROM users WHERE id = auth.uid();
  IF COALESCE(v_role, '') NOT IN ('owner', 'manager', 'accountant') THEN
    RAISE EXCEPTION 'FORBIDDEN_ROLE' USING ERRCODE = 'P0001';
  END IF;

  v_period_start := v_month;
  v_period_end := (v_month + interval '1 month - 1 day')::date;

  -- [3] KHÔNG xoá dòng lương ở đây nữa. Bước DELETE + INSERT cũ thổi
  --     bay cả manual_adjustment, deductions và notes do kế toán nhập
  --     tay. Thay bằng UPSERT ở cuối vòng lặp, rồi dọn dòng thừa sau.

  SELECT
    COALESCE(MAX(base_salary), 0)::numeric,
    COALESCE(MAX(gas_allowance), 0)::numeric,
    COALESCE(MAX(phone_allowance), 0)::numeric,
    COALESCE(MAX(working_days_per_month), 26)::numeric,
    COALESCE(MAX(kpi_target_revenue), 0)::numeric,
    (SELECT target_tiers FROM hr_salary_config
       WHERE org_id = v_org AND COALESCE(is_active, true) = true
       ORDER BY created_at DESC LIMIT 1),
    COALESCE(MAX(over_target_percent), 0)::numeric,
    COALESCE(MAX(under_60_percent), 0)::numeric
  INTO v_base_salary, v_gas, v_phone, v_std_days, v_kpi_target, v_kpi_tiers, v_over_pct, v_under_60_pct
  FROM hr_salary_config
  WHERE org_id = v_org
    AND COALESCE(is_active, true) = true;
  v_kpi_tiers := COALESCE(v_kpi_tiers, '[]'::jsonb);
  v_allowances := v_gas + v_phone;

  FOR u IN
    SELECT id, full_name, role
    FROM users
    WHERE org_id = v_org
      AND COALESCE(is_active, true) = true
      AND role = 'sales'   -- tạm thời chỉ tính lương NV bán hàng
  LOOP
    SELECT
      COUNT(*) FILTER (WHERE status IN ('present','holiday'))::numeric
      + 0.5 * COUNT(*) FILTER (WHERE status = 'half_day')::numeric
    INTO v_act_days
    FROM hr_attendance
    WHERE user_id = u.id
      AND work_date BETWEEN v_period_start AND v_period_end;
    v_act_days := COALESCE(v_act_days, 0);

    SELECT COALESCE(SUM(total), 0) INTO v_revenue
    FROM sales_orders
    WHERE sales_user_id = u.id
      AND public.is_revenue_status(status)
      AND order_date BETWEEN v_period_start AND v_period_end;

    v_prorated := v_base_salary;   -- lương CB (mig 060: không prorate chấm công)
    v_emp_gas := v_gas;
    v_emp_phone := v_phone;
    v_emp_allowances := v_allowances;
    v_kpi := 0;
    v_kpi_per_user := false;
    v_kpi_pct := NULL;
    v_low_perf := 'normal';
    v_kpi_breakdown := '[]'::jsonb;

    -- 1) Per-user override (model cũ).
    SELECT min_revenue, bonus_type, bonus_value
      INTO v_kpi_tier
    FROM salary_kpi_tiers
    WHERE user_id = u.id AND month = v_month
      AND min_revenue <= v_revenue
    ORDER BY min_revenue DESC
    LIMIT 1;
    IF FOUND THEN
      v_kpi_per_user := true;
      IF v_kpi_tier.bonus_type = 'percent' THEN
        v_kpi := round(v_revenue * v_kpi_tier.bonus_value / 100, 0);
      ELSE
        v_kpi := v_kpi_tier.bonus_value;
      END IF;

    -- 2) Org config theo mức doanh số chung A + cộng dồn.
    ELSIF v_kpi_target > 0 THEN
      v_kpi_pct := v_revenue / v_kpi_target * 100;

      IF v_kpi_pct < 60 THEN
        -- Dưới 60% A: không hưởng lương cứng → lương = doanh số ×
        -- under_60%; KHÔNG có phụ cấp; không thưởng KPI.
        v_low_perf := 'under_60';
        v_prorated := round(v_revenue * v_under_60_pct / 100, 0);
        v_emp_gas := 0;
        v_emp_phone := 0;
        v_emp_allowances := 0;
        v_kpi := 0;
      ELSIF v_kpi_pct < 70 THEN
        v_low_perf := 'under_70';
        v_kpi := 0;
      ELSE
        SELECT
          COALESCE(SUM(CASE WHEN COALESCE((elem->>'min_percent')::numeric, 0) <= v_kpi_pct
                            THEN COALESCE((elem->>'bonus')::numeric, 0) ELSE 0 END), 0),
          COALESCE(jsonb_agg(jsonb_build_object(
            'min_percent', COALESCE((elem->>'min_percent')::numeric, 0),
            'bonus', COALESCE((elem->>'bonus')::numeric, 0),
            'label', elem->>'label',
            'passed', COALESCE((elem->>'min_percent')::numeric, 0) <= v_kpi_pct
          ) ORDER BY COALESCE((elem->>'min_percent')::numeric, 0)), '[]'::jsonb)
        INTO v_kpi_partial, v_kpi_breakdown
        FROM jsonb_array_elements(v_kpi_tiers) AS arr(elem);
        v_kpi := COALESCE(v_kpi_partial, 0);

        IF v_kpi_pct > 100 AND v_over_pct > 0 THEN
          v_low_perf := 'over_100';
          v_kpi := v_kpi + round((v_revenue - v_kpi_target) * v_over_pct / 100, 0);
        END IF;
      END IF;
    END IF;

    -- Order-count bonus.
    v_oc_bonus := 0;
    v_oc_count := 0;
    SELECT min_order_count, min_order_value, bonus_per_order, period
      INTO v_oc_cfg
    FROM salary_order_count_bonus_configs
    WHERE user_id = u.id
      AND effective_from <= v_period_end
      AND (effective_to IS NULL OR effective_to >= v_period_start)
    ORDER BY effective_from DESC
    LIMIT 1;
    v_oc_paid := 0;
    IF FOUND THEN
      IF v_oc_cfg.period = 'week' THEN
        -- [2] Cấu hình "Tuần" (043:47 CHECK IN ('week','month'), giao diện
        --     settings/users/[id]/salary/page.tsx:477 cho chọn): gom đơn
        --     theo tuần, MỖI TUẦN xét ngưỡng riêng, chỉ tuần nào đạt mới
        --     được thưởng. Trước đây nhánh này không tồn tại — cột period
        --     được SELECT rồi vứt đi — nên ngưỡng tuần bị đem so với số
        --     đơn CẢ THÁNG rồi thưởng cho toàn bộ đơn trong tháng.
        SELECT
          COALESCE(SUM(wk.cnt), 0),
          COALESCE(SUM(wk.cnt) FILTER (WHERE wk.cnt >= v_oc_cfg.min_order_count), 0)
        INTO v_oc_count, v_oc_paid
        FROM (
          SELECT date_trunc('week', order_date) AS w, count(*) AS cnt
          FROM sales_orders
          WHERE sales_user_id = u.id
            AND public.is_revenue_status(status)
            AND order_date BETWEEN v_period_start AND v_period_end
            AND total >= v_oc_cfg.min_order_value
          GROUP BY 1
        ) wk;
      ELSE
        SELECT count(*) INTO v_oc_count
        FROM sales_orders
        WHERE sales_user_id = u.id
          AND public.is_revenue_status(status)
          AND order_date BETWEEN v_period_start AND v_period_end
          AND total >= v_oc_cfg.min_order_value;
        IF v_oc_count >= v_oc_cfg.min_order_count THEN
          v_oc_paid := v_oc_count;
        END IF;
      END IF;
      v_oc_bonus := v_oc_paid * v_oc_cfg.bonus_per_order;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_activity
    FROM monthly_activity_bonuses
    WHERE user_id = u.id AND month = v_month;

    -- BHXH 10.5% trên phần lương CB hiệu lực (không trên phụ cấp).
    v_si := round(v_prorated * 0.105, 0);

    v_net := v_prorated + v_emp_allowances + v_kpi + v_oc_bonus + v_activity - v_si;

    INSERT INTO payroll_run_items (
      payroll_run_id, user_id,
      base_salary, standard_workdays, actual_workdays, prorated_base,
      allowances, kpi_bonus, order_count_bonus, activity_bonus,
      overtime, deductions, social_insurance,
      manual_adjustment, net_salary,
      computed_breakdown
    ) VALUES (
      p_run_id, u.id,
      v_base_salary, v_std_days, v_act_days, v_prorated,
      v_emp_allowances, v_kpi, v_oc_bonus, v_activity,
      0, 0, v_si,
      0, v_net,
      jsonb_build_object(
        'period_start', v_period_start,
        'period_end', v_period_end,
        'revenue', v_revenue,
        'gas_allowance', v_emp_gas,
        'phone_allowance', v_emp_phone,
        'allowance_dropped', (v_emp_allowances = 0 AND v_allowances > 0),
        'kpi_target_revenue', v_kpi_target,
        'kpi_pct', CASE WHEN v_kpi_target > 0 THEN round(v_revenue / v_kpi_target * 100, 1) ELSE NULL END,
        'kpi_model', CASE WHEN v_kpi_per_user THEN 'per_user_tier' ELSE 'org_cumulative' END,
        'kpi_tier_breakdown', v_kpi_breakdown,
        'low_perf', v_low_perf,
        'over_target_percent', v_over_pct,
        'under_60_percent', v_under_60_pct,
        'oc_count', COALESCE(v_oc_count, 0),
        'oc_paid_count', COALESCE(v_oc_paid, 0),
        'oc_period', COALESCE(v_oc_cfg.period, 'month'),
        'oc_min_count', COALESCE(v_oc_cfg.min_order_count, 0),
        'oc_min_value', COALESCE(v_oc_cfg.min_order_value, 0),
        'oc_bonus_per_order', COALESCE(v_oc_cfg.bonus_per_order, 0),
        'attendance_skipped', true
      )
    )
    -- [3] Các cột do NGƯỜI nhập (overtime, deductions, manual_adjustment,
    --     notes) cố ý KHÔNG nằm trong danh sách SET, nên "Tính lại" không
    --     còn xoá được chúng. Công thức net dưới đây khớp với
    --     src/lib/payroll/run.ts:126-134 để hai đường ghi không cho ra hai
    --     con số khác nhau trên cùng một dòng lương.
    ON CONFLICT (payroll_run_id, user_id) DO UPDATE SET
      base_salary        = EXCLUDED.base_salary,
      standard_workdays  = EXCLUDED.standard_workdays,
      actual_workdays    = EXCLUDED.actual_workdays,
      prorated_base      = EXCLUDED.prorated_base,
      allowances         = EXCLUDED.allowances,
      kpi_bonus          = EXCLUDED.kpi_bonus,
      order_count_bonus  = EXCLUDED.order_count_bonus,
      activity_bonus     = EXCLUDED.activity_bonus,
      social_insurance   = EXCLUDED.social_insurance,
      computed_breakdown = EXCLUDED.computed_breakdown,
      updated_at         = now(),
      net_salary         = EXCLUDED.prorated_base
                         + EXCLUDED.allowances
                         + EXCLUDED.kpi_bonus
                         + EXCLUDED.order_count_bonus
                         + EXCLUDED.activity_bonus
                         + payroll_run_items.overtime
                         + payroll_run_items.manual_adjustment
                         - payroll_run_items.deductions
                         - EXCLUDED.social_insurance;

    v_touched := v_touched || u.id;
    v_count := v_count + 1;
  END LOOP;

  -- Nhân sự đã nghỉ hoặc đổi vai trò thì bỏ dòng lương đi. Trước đây bước
  -- DELETE ở đầu hàm lo việc này; giờ UPSERT không xoá nên phải dọn ở đây.
  DELETE FROM payroll_run_items
  WHERE payroll_run_id = p_run_id
    AND NOT (user_id = ANY (v_touched));

  UPDATE payroll_runs
  SET computed_at = now()
  WHERE id = p_run_id;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_payroll_run(uuid) TO authenticated;


-- --------------------------------------------------------------------
-- 4. lock_payroll_run — cùng lỗ hổng vai trò. Cũng là bản 050 nguyên văn
--    cộng đúng một khối kiểm vai trò.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lock_payroll_run(p_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org  uuid;
  v_role text;
BEGIN
  SELECT org_id INTO v_org FROM payroll_runs WHERE id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYROLL_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- [4] Cùng lỗ hổng với compute_payroll_run: SECURITY DEFINER, GRANT cho
  --     `authenticated`, không kiểm vai trò — tài xế cũng khoá cứng được
  --     kỳ lương, và khoá rồi thì không ai sửa lại được nữa.
  SELECT role INTO v_role FROM users WHERE id = auth.uid();
  IF COALESCE(v_role, '') NOT IN ('owner', 'manager', 'accountant') THEN
    RAISE EXCEPTION 'FORBIDDEN_ROLE' USING ERRCODE = 'P0001';
  END IF;

  UPDATE payroll_runs
  SET status = 'locked',
      locked_at = now(),
      locked_by = auth.uid()
  WHERE id = p_run_id
    AND status = 'draft';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lock_payroll_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_payroll_run(uuid) TO authenticated;


-- --------------------------------------------------------------------
-- 5. Ba hàm tổng quan: dùng cùng định nghĩa doanh thu với bảng lương.
--    Trước đây không có mệnh đề status nào — huỷ đơn 50 triệu mà doanh
--    thu trang chủ không đổi.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.dashboard_summary(date);
CREATE FUNCTION public.dashboard_summary(p_period_start date)
RETURNS TABLE (
  period_revenue    numeric,
  period_orders     bigint,
  open_receivables  numeric,
  overdue_count     bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE((
      SELECT SUM(COALESCE(total, 0)) FROM sales_orders
      WHERE org_id = public.user_org_id()
        AND order_date >= p_period_start
        AND public.is_revenue_status(status)
    ), 0),
    COALESCE((
      SELECT COUNT(*) FROM sales_orders
      WHERE org_id = public.user_org_id()
        AND order_date >= p_period_start
        AND public.is_revenue_status(status)
    ), 0),
    COALESCE((
      SELECT SUM(GREATEST(0, COALESCE(amount, 0) - COALESCE(paid, 0)))
      FROM receivables
      WHERE org_id = public.user_org_id() AND status <> 'paid'
    ), 0),
    COALESCE((
      SELECT COUNT(*) FROM receivables
      WHERE org_id = public.user_org_id() AND status = 'overdue'
    ), 0);
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_summary(date) TO authenticated;


DROP FUNCTION IF EXISTS public.dashboard_top_customers(date, integer);
CREATE FUNCTION public.dashboard_top_customers(p_period_start date, p_limit integer DEFAULT 5)
RETURNS TABLE (
  customer_id uuid,
  store_name  text,
  total       numeric,
  order_count bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    o.customer_id,
    COALESCE(c.store_name, 'N/A'),
    COALESCE(SUM(COALESCE(o.total, 0)), 0),
    COUNT(*)
  FROM sales_orders o
  LEFT JOIN customers c ON c.id = o.customer_id
  WHERE o.org_id = public.user_org_id()
    AND o.order_date >= p_period_start
    AND o.customer_id IS NOT NULL
    AND public.is_revenue_status(o.status)
  GROUP BY o.customer_id, c.store_name
  ORDER BY COALESCE(SUM(COALESCE(o.total, 0)), 0) DESC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_top_customers(date, integer) TO authenticated;


DROP FUNCTION IF EXISTS public.dashboard_channel_revenue(date);
CREATE FUNCTION public.dashboard_channel_revenue(p_period_start date)
RETURNS TABLE (
  channel text,
  total   numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE(NULLIF(c.channel, ''), 'Khác'),
    COALESCE(SUM(COALESCE(o.total, 0)), 0)
  FROM sales_orders o
  LEFT JOIN customers c ON c.id = o.customer_id
  WHERE o.org_id = public.user_org_id()
    AND o.order_date >= p_period_start
    AND public.is_revenue_status(o.status)
  GROUP BY COALESCE(NULLIF(c.channel, ''), 'Khác')
  ORDER BY COALESCE(SUM(COALESCE(o.total, 0)), 0) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_channel_revenue(date) TO authenticated;


-- ####################################################################
-- # 095_payroll_net_revenue.sql
-- ####################################################################

-- ====================================================================
-- 095 — Doanh số tính lương chuyển sang DOANH SỐ THUẦN (trừ hàng trả lại)
--
-- Chủ NPP đã chốt: lương trả trên doanh số thuần, không phải doanh số gộp.
-- Trước migration này, bảng lương cộng thẳng sales_orders.total còn báo cáo
-- nhân viên thì có trừ hàng trả — hai màn hình cùng ghi "doanh số của NV X"
-- ra hai con số khác nhau.
--
-- BỐN QUYẾT ĐỊNH, ĐỀU ĐÃ CHẠY THỬ TRÊN POSTGRES 16
--
--  1. TRỪ BAO NHIÊU → returns.credit_note_amount
--     Không tự cộng lại return_lines. Trigger trg_return_lines_sync_credit
--     (mig 035:44) đã giữ credit_note_amount = SUM(line_total) WHERE
--     is_exchange = false, tức ĐÃ tự loại dòng đổi hàng. Đổi hàng là giao
--     hàng khác thay thế, khách không được hoàn tiền, nên không phải khoản
--     giảm doanh số.
--     Chạy thử: phiếu trả 10 hộp đổi (100.000) + 3 hộp trả (30.000)
--     → trừ 30.000, không trừ 130.000.
--     Phiếu trả tạo tay ở /returns/new không có dòng nào; trigger không
--     chạy, credit_note_amount là số kế toán gõ (có thể NULL → COALESCE 0).
--
--  2. PHIẾU NÀO TÍNH → status IN ('approved','completed')
--     Đúng bằng bộ lọc công nợ đang dùng (src/lib/returns.ts:220) và báo
--     cáo nhân viên (src/lib/analytics/sales.ts:162). Phiếu 'pending' mới
--     là đề nghị, 'rejected' đã bị từ chối — trừ vào lương là trừ oan.
--
--  3. QUY VỀ NHÂN VIÊN NÀO → theo đơn gốc, thiếu thì theo đơn gần nhất
--     Bảng returns KHÔNG có cột sales_user_id (001_schema.sql:328). Có
--     order_id thì lấy sales_orders.sales_user_id — chính xác tuyệt đối.
--     Phiếu tạo tay ở /returns/new không gắn order_id
--     (returns/new/page.tsx:50-59) nên phải suy ra: lấy NV của đơn GẦN
--     NHẤT phục vụ khách đó TÍNH ĐẾN NGÀY TẠO PHIẾU.
--     Khác báo cáo nhân viên một điểm CÓ CHỦ ĐÍCH: báo cáo lấy đơn mới
--     nhất bất kể thời gian (reports/employees/page.tsx:321-322), nên một
--     phiếu trả tháng 4 có thể bị quy cho NV mới nhận khách vào tháng 6 —
--     trừ tiền người chưa từng bán đơn đó. Ở đây chặn bằng
--     `order_date <= ngày tạo phiếu`.
--
--  4. TÍNH VÀO KỲ NÀO → theo ngày tạo phiếu, GIỜ VIỆT NAM
--     Phiếu trả tháng 5 cho đơn tháng 4 trừ vào kỳ THÁNG 5. Nếu trừ ngược
--     vào tháng 4 thì kỳ lương đã chốt/đã khoá phải tính lại — không làm
--     được, và cũng không đúng: tiền tháng 4 đã trả rồi.
--
--     CÁI BẪY MÚI GIỜ: returns.created_at là timestamptz còn database chạy
--     UTC. `created_at::date` cho phiếu tạo lúc 3h sáng ngày 1/5 giờ Việt
--     Nam ra ngày 30/4 — rơi nhầm sang kỳ trước, kỳ có thể đã khoá.
--     Đã chạy thử: cùng bộ dữ liệu, dùng ::date theo UTC trừ nhầm
--     34.000.000 vào tháng 4 thay vì 25.000.000.
--     Phải AT TIME ZONE 'Asia/Ho_Chi_Minh' trước khi ::date.
--
--  CHẶN SỐ ÂM (bắt buộc, không phải tuỳ chọn)
--     Doanh số thuần có thể âm khi khách trả hàng của tháng trước. Công
--     thức nhánh dưới 60% là `lương = doanh số × under_60_percent`, nên
--     doanh số -40tr cho ra lương cơ bản -400.000, BHXH -42.000 và thực
--     lĩnh -358.000 đ — công ty ghi nhận nhân viên NỢ lương. Đã chạy thử
--     ra đúng con số đó. Kẹp doanh số về 0; số thật vẫn ghi trong
--     breakdown (revenue_net_raw, revenue_clamped) để phiếu lương giải
--     thích được vì sao.
--
--  CỐ Ý KHÔNG ĐỔI
--     Thưởng theo SỐ ĐƠN vẫn xét trên giá trị đơn gốc. Ngưỡng
--     min_order_value hỏi "đơn này có đủ lớn không" — là câu hỏi về đơn
--     hàng, không phải về doanh số kỳ. Trả một phần hàng không làm đơn
--     đó chưa từng xảy ra. Nếu chủ NPP muốn khác thì nói, sửa một dòng.
-- ====================================================================


-- --------------------------------------------------------------------
-- Tiền hàng trả lại quy về một nhân viên trong một kỳ.
--
-- Tách hàm riêng để test được và để báo cáo dùng lại cùng một định nghĩa,
-- thay vì mỗi màn hình tự cộng một kiểu như hiện nay.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.payroll_returns_for(uuid, uuid, date, date);
CREATE FUNCTION public.payroll_returns_for(
  p_user  uuid,
  p_org   uuid,
  p_start date,
  p_end   date
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(COALESCE(r.credit_note_amount, 0)), 0)
  FROM returns r
  LEFT JOIN sales_orders o ON o.id = r.order_id
  WHERE r.org_id = p_org
    AND r.status IN ('approved', 'completed')
    -- Giờ Việt Nam, không phải UTC. Xem mục 4 ở đầu file.
    AND ((r.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
        BETWEEN p_start AND p_end
    AND COALESCE(
          o.sales_user_id,
          (SELECT o2.sales_user_id
             FROM sales_orders o2
            WHERE o2.customer_id = r.customer_id
              AND o2.org_id = r.org_id
              AND public.is_revenue_status(o2.status)
              AND o2.order_date <= ((r.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
            ORDER BY o2.order_date DESC, o2.created_at DESC
            LIMIT 1)
        ) = p_user;
$$;

COMMENT ON FUNCTION public.payroll_returns_for(uuid, uuid, date, date) IS
  'Tiền hàng trả lại (credit note) quy về một NV trong một kỳ, dùng để tính '
  'doanh số thuần trả lương. Chỉ tính phiếu approved/completed. Gom theo '
  'ngày tạo phiếu GIỜ VIỆT NAM. Phiếu không gắn đơn thì quy về NV của đơn '
  'gần nhất phục vụ khách đó tính đến ngày tạo phiếu.';

GRANT EXECUTE ON FUNCTION public.payroll_returns_for(uuid, uuid, date, date) TO authenticated;


-- --------------------------------------------------------------------
-- compute_payroll_run — bản 094 NGUYÊN VĂN, vá đúng 3 chỗ:
--   • doanh số gộp  → doanh số thuần (kèm chặn số âm)
--   • khai báo thêm 3 biến
--   • breakdown ghi thêm gộp / đã trừ / thuần thật / có bị kẹp không
-- Vẫn không chép tay: xem ghi chú cùng chủ đề ở đầu migration 094.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION compute_payroll_run(p_run_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org      uuid;
  v_month    date;
  v_status   text;
  v_period_start date;
  v_period_end   date;
  u          record;
  v_revenue  numeric;
  v_base_salary numeric;
  v_gas      numeric;
  v_phone    numeric;
  v_allowances numeric;
  v_emp_gas   numeric;
  v_emp_phone numeric;
  v_emp_allowances numeric;
  v_std_days numeric;
  v_act_days numeric;
  v_prorated numeric;
  v_kpi      numeric;
  v_kpi_partial numeric;
  v_kpi_tier record;
  v_kpi_per_user bool;
  v_kpi_target numeric;
  v_kpi_tiers  jsonb;
  v_kpi_pct    numeric;
  v_kpi_breakdown jsonb;
  v_over_pct   numeric;
  v_under_60_pct numeric;
  v_low_perf   text;
  v_oc_cfg   record;
  v_oc_count int;
  v_oc_bonus numeric;
  v_activity numeric;
  v_si       numeric;
  v_net      numeric;
  v_count    int := 0;
  v_role     text;
  v_oc_paid  int;
  v_touched  uuid[] := ARRAY[]::uuid[];
  v_gross    numeric;
  v_returns  numeric;
  v_net_raw  numeric;
BEGIN
  SELECT org_id, month, status INTO v_org, v_month, v_status
  FROM payroll_runs WHERE id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYROLL_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'locked' THEN
    RAISE EXCEPTION 'PAYROLL_RUN_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- [4] Hàm là SECURITY DEFINER + GRANT cho `authenticated`, mà trước đây
  --     chỉ kiểm org và trạng thái khoá. Không chặn ở đây thì một tài
  --     khoản bán hàng hoặc lái xe gọi thẳng RPC là tính lại được bảng
  --     lương của cả công ty.
  SELECT role INTO v_role FROM users WHERE id = auth.uid();
  IF COALESCE(v_role, '') NOT IN ('owner', 'manager', 'accountant') THEN
    RAISE EXCEPTION 'FORBIDDEN_ROLE' USING ERRCODE = 'P0001';
  END IF;

  v_period_start := v_month;
  v_period_end := (v_month + interval '1 month - 1 day')::date;

  -- [3] KHÔNG xoá dòng lương ở đây nữa. Bước DELETE + INSERT cũ thổi
  --     bay cả manual_adjustment, deductions và notes do kế toán nhập
  --     tay. Thay bằng UPSERT ở cuối vòng lặp, rồi dọn dòng thừa sau.

  SELECT
    COALESCE(MAX(base_salary), 0)::numeric,
    COALESCE(MAX(gas_allowance), 0)::numeric,
    COALESCE(MAX(phone_allowance), 0)::numeric,
    COALESCE(MAX(working_days_per_month), 26)::numeric,
    COALESCE(MAX(kpi_target_revenue), 0)::numeric,
    (SELECT target_tiers FROM hr_salary_config
       WHERE org_id = v_org AND COALESCE(is_active, true) = true
       ORDER BY created_at DESC LIMIT 1),
    COALESCE(MAX(over_target_percent), 0)::numeric,
    COALESCE(MAX(under_60_percent), 0)::numeric
  INTO v_base_salary, v_gas, v_phone, v_std_days, v_kpi_target, v_kpi_tiers, v_over_pct, v_under_60_pct
  FROM hr_salary_config
  WHERE org_id = v_org
    AND COALESCE(is_active, true) = true;
  v_kpi_tiers := COALESCE(v_kpi_tiers, '[]'::jsonb);
  v_allowances := v_gas + v_phone;

  FOR u IN
    SELECT id, full_name, role
    FROM users
    WHERE org_id = v_org
      AND COALESCE(is_active, true) = true
      AND role = 'sales'   -- tạm thời chỉ tính lương NV bán hàng
  LOOP
    SELECT
      COUNT(*) FILTER (WHERE status IN ('present','holiday'))::numeric
      + 0.5 * COUNT(*) FILTER (WHERE status = 'half_day')::numeric
    INTO v_act_days
    FROM hr_attendance
    WHERE user_id = u.id
      AND work_date BETWEEN v_period_start AND v_period_end;
    v_act_days := COALESCE(v_act_days, 0);

    SELECT COALESCE(SUM(total), 0) INTO v_gross
    FROM sales_orders
    WHERE sales_user_id = u.id
      AND public.is_revenue_status(status)
      AND order_date BETWEEN v_period_start AND v_period_end;

    v_returns := public.payroll_returns_for(u.id, v_org, v_period_start, v_period_end);
    v_net_raw := v_gross - v_returns;

    -- [G] CHẶN SỐ ÂM. Trả nhiều hơn bán (khách trả hàng tồn của tháng trước,
    --     hoặc NV nghỉ giữa tháng) thì doanh số thuần âm. Không chặn ở đây
    --     thì nhánh dưới 60% cho ra lương ÂM: đã chạy thử, doanh số -40tr
    --     → lương cơ bản -400.000 và BHXH -42.000 → thực lĩnh -358.000 đ,
    --     tức công ty ghi nhận nhân viên NỢ lương. Kẹp về 0 và ghi lại số
    --     thật trong breakdown để phiếu lương vẫn giải thích được.
    v_revenue := GREATEST(0, v_net_raw);

    v_prorated := v_base_salary;   -- lương CB (mig 060: không prorate chấm công)
    v_emp_gas := v_gas;
    v_emp_phone := v_phone;
    v_emp_allowances := v_allowances;
    v_kpi := 0;
    v_kpi_per_user := false;
    v_kpi_pct := NULL;
    v_low_perf := 'normal';
    v_kpi_breakdown := '[]'::jsonb;

    -- 1) Per-user override (model cũ).
    SELECT min_revenue, bonus_type, bonus_value
      INTO v_kpi_tier
    FROM salary_kpi_tiers
    WHERE user_id = u.id AND month = v_month
      AND min_revenue <= v_revenue
    ORDER BY min_revenue DESC
    LIMIT 1;
    IF FOUND THEN
      v_kpi_per_user := true;
      IF v_kpi_tier.bonus_type = 'percent' THEN
        v_kpi := round(v_revenue * v_kpi_tier.bonus_value / 100, 0);
      ELSE
        v_kpi := v_kpi_tier.bonus_value;
      END IF;

    -- 2) Org config theo mức doanh số chung A + cộng dồn.
    ELSIF v_kpi_target > 0 THEN
      v_kpi_pct := v_revenue / v_kpi_target * 100;

      IF v_kpi_pct < 60 THEN
        -- Dưới 60% A: không hưởng lương cứng → lương = doanh số ×
        -- under_60%; KHÔNG có phụ cấp; không thưởng KPI.
        v_low_perf := 'under_60';
        v_prorated := round(v_revenue * v_under_60_pct / 100, 0);
        v_emp_gas := 0;
        v_emp_phone := 0;
        v_emp_allowances := 0;
        v_kpi := 0;
      ELSIF v_kpi_pct < 70 THEN
        v_low_perf := 'under_70';
        v_kpi := 0;
      ELSE
        SELECT
          COALESCE(SUM(CASE WHEN COALESCE((elem->>'min_percent')::numeric, 0) <= v_kpi_pct
                            THEN COALESCE((elem->>'bonus')::numeric, 0) ELSE 0 END), 0),
          COALESCE(jsonb_agg(jsonb_build_object(
            'min_percent', COALESCE((elem->>'min_percent')::numeric, 0),
            'bonus', COALESCE((elem->>'bonus')::numeric, 0),
            'label', elem->>'label',
            'passed', COALESCE((elem->>'min_percent')::numeric, 0) <= v_kpi_pct
          ) ORDER BY COALESCE((elem->>'min_percent')::numeric, 0)), '[]'::jsonb)
        INTO v_kpi_partial, v_kpi_breakdown
        FROM jsonb_array_elements(v_kpi_tiers) AS arr(elem);
        v_kpi := COALESCE(v_kpi_partial, 0);

        IF v_kpi_pct > 100 AND v_over_pct > 0 THEN
          v_low_perf := 'over_100';
          v_kpi := v_kpi + round((v_revenue - v_kpi_target) * v_over_pct / 100, 0);
        END IF;
      END IF;
    END IF;

    -- Order-count bonus.
    v_oc_bonus := 0;
    v_oc_count := 0;
    SELECT min_order_count, min_order_value, bonus_per_order, period
      INTO v_oc_cfg
    FROM salary_order_count_bonus_configs
    WHERE user_id = u.id
      AND effective_from <= v_period_end
      AND (effective_to IS NULL OR effective_to >= v_period_start)
    ORDER BY effective_from DESC
    LIMIT 1;
    v_oc_paid := 0;
    IF FOUND THEN
      IF v_oc_cfg.period = 'week' THEN
        -- [2] Cấu hình "Tuần" (043:47 CHECK IN ('week','month'), giao diện
        --     settings/users/[id]/salary/page.tsx:477 cho chọn): gom đơn
        --     theo tuần, MỖI TUẦN xét ngưỡng riêng, chỉ tuần nào đạt mới
        --     được thưởng. Trước đây nhánh này không tồn tại — cột period
        --     được SELECT rồi vứt đi — nên ngưỡng tuần bị đem so với số
        --     đơn CẢ THÁNG rồi thưởng cho toàn bộ đơn trong tháng.
        SELECT
          COALESCE(SUM(wk.cnt), 0),
          COALESCE(SUM(wk.cnt) FILTER (WHERE wk.cnt >= v_oc_cfg.min_order_count), 0)
        INTO v_oc_count, v_oc_paid
        FROM (
          SELECT date_trunc('week', order_date) AS w, count(*) AS cnt
          FROM sales_orders
          WHERE sales_user_id = u.id
            AND public.is_revenue_status(status)
            AND order_date BETWEEN v_period_start AND v_period_end
            AND total >= v_oc_cfg.min_order_value
          GROUP BY 1
        ) wk;
      ELSE
        SELECT count(*) INTO v_oc_count
        FROM sales_orders
        WHERE sales_user_id = u.id
          AND public.is_revenue_status(status)
          AND order_date BETWEEN v_period_start AND v_period_end
          AND total >= v_oc_cfg.min_order_value;
        IF v_oc_count >= v_oc_cfg.min_order_count THEN
          v_oc_paid := v_oc_count;
        END IF;
      END IF;
      v_oc_bonus := v_oc_paid * v_oc_cfg.bonus_per_order;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_activity
    FROM monthly_activity_bonuses
    WHERE user_id = u.id AND month = v_month;

    -- BHXH 10.5% trên phần lương CB hiệu lực (không trên phụ cấp).
    v_si := round(v_prorated * 0.105, 0);

    v_net := v_prorated + v_emp_allowances + v_kpi + v_oc_bonus + v_activity - v_si;

    INSERT INTO payroll_run_items (
      payroll_run_id, user_id,
      base_salary, standard_workdays, actual_workdays, prorated_base,
      allowances, kpi_bonus, order_count_bonus, activity_bonus,
      overtime, deductions, social_insurance,
      manual_adjustment, net_salary,
      computed_breakdown
    ) VALUES (
      p_run_id, u.id,
      v_base_salary, v_std_days, v_act_days, v_prorated,
      v_emp_allowances, v_kpi, v_oc_bonus, v_activity,
      0, 0, v_si,
      0, v_net,
      jsonb_build_object(
        'period_start', v_period_start,
        'period_end', v_period_end,
        'revenue', v_revenue,
        'revenue_gross', v_gross,
        'returns_deducted', v_returns,
        'revenue_net_raw', v_net_raw,
        'revenue_clamped', (v_net_raw < 0),
        'gas_allowance', v_emp_gas,
        'phone_allowance', v_emp_phone,
        'allowance_dropped', (v_emp_allowances = 0 AND v_allowances > 0),
        'kpi_target_revenue', v_kpi_target,
        'kpi_pct', CASE WHEN v_kpi_target > 0 THEN round(v_revenue / v_kpi_target * 100, 1) ELSE NULL END,
        'kpi_model', CASE WHEN v_kpi_per_user THEN 'per_user_tier' ELSE 'org_cumulative' END,
        'kpi_tier_breakdown', v_kpi_breakdown,
        'low_perf', v_low_perf,
        'over_target_percent', v_over_pct,
        'under_60_percent', v_under_60_pct,
        'oc_count', COALESCE(v_oc_count, 0),
        'oc_paid_count', COALESCE(v_oc_paid, 0),
        'oc_period', COALESCE(v_oc_cfg.period, 'month'),
        'oc_min_count', COALESCE(v_oc_cfg.min_order_count, 0),
        'oc_min_value', COALESCE(v_oc_cfg.min_order_value, 0),
        'oc_bonus_per_order', COALESCE(v_oc_cfg.bonus_per_order, 0),
        'attendance_skipped', true
      )
    )
    -- [3] Các cột do NGƯỜI nhập (overtime, deductions, manual_adjustment,
    --     notes) cố ý KHÔNG nằm trong danh sách SET, nên "Tính lại" không
    --     còn xoá được chúng. Công thức net dưới đây khớp với
    --     src/lib/payroll/run.ts:126-134 để hai đường ghi không cho ra hai
    --     con số khác nhau trên cùng một dòng lương.
    ON CONFLICT (payroll_run_id, user_id) DO UPDATE SET
      base_salary        = EXCLUDED.base_salary,
      standard_workdays  = EXCLUDED.standard_workdays,
      actual_workdays    = EXCLUDED.actual_workdays,
      prorated_base      = EXCLUDED.prorated_base,
      allowances         = EXCLUDED.allowances,
      kpi_bonus          = EXCLUDED.kpi_bonus,
      order_count_bonus  = EXCLUDED.order_count_bonus,
      activity_bonus     = EXCLUDED.activity_bonus,
      social_insurance   = EXCLUDED.social_insurance,
      computed_breakdown = EXCLUDED.computed_breakdown,
      updated_at         = now(),
      net_salary         = EXCLUDED.prorated_base
                         + EXCLUDED.allowances
                         + EXCLUDED.kpi_bonus
                         + EXCLUDED.order_count_bonus
                         + EXCLUDED.activity_bonus
                         + payroll_run_items.overtime
                         + payroll_run_items.manual_adjustment
                         - payroll_run_items.deductions
                         - EXCLUDED.social_insurance;

    v_touched := v_touched || u.id;
    v_count := v_count + 1;
  END LOOP;

  -- Nhân sự đã nghỉ hoặc đổi vai trò thì bỏ dòng lương đi. Trước đây bước
  -- DELETE ở đầu hàm lo việc này; giờ UPSERT không xoá nên phải dọn ở đây.
  DELETE FROM payroll_run_items
  WHERE payroll_run_id = p_run_id
    AND NOT (user_id = ANY (v_touched));

  UPDATE payroll_runs
  SET computed_at = now()
  WHERE id = p_run_id;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_payroll_run(uuid) TO authenticated;


-- ####################################################################
-- # 096_payroll_net_revenue_fixes.sql
-- ####################################################################

-- ====================================================================
-- 096 — Ba chỗ hở còn lại của doanh số thuần (mig 095)
--
-- 095 chuyển lương sang doanh số thuần. Rà lại bằng nhiều góc nhìn độc
-- lập thì lộ ra ba chỗ hở, một trong đó là lỗi tiền thật do chính 095
-- tạo ra. Ghi rõ ở đây vì người sau sẽ hỏi "sao vừa viết xong đã sửa".
--
--  1. TRỪ HAI LẦN CHO MỘT GIAO DỊCH KHÔNG TỒN TẠI  ← lỗi thật của 095
--     payroll_returns_for không xét trạng thái ĐƠN GỐC của phiếu trả.
--     Doanh số gộp đã loại đơn 'draft'/'cancelled' bằng is_revenue_status,
--     nhưng phiếu trả gắn vào chính những đơn đó vẫn bị trừ.
--     Chạy thử trên Postgres 16:
--         đơn A 100tr đã giao + đơn B 50tr ĐÃ HUỶ, phiếu trả 10tr của đơn B
--         095 → gộp 100tr, trừ 10tr, thuần 90tr   ← sai
--         096 → gộp 100tr, trừ  0đ,  thuần 100tr  ← đúng
--     Nhân viên mất 10tr doanh số cho một đơn chưa từng được tính cho họ.
--     Phiếu KHÔNG gắn đơn (tạo tay ở /returns/new) không có đơn gốc để
--     xét nên vẫn tính như cũ.
--
--  2. PHẦN HÀNG TRẢ VƯỢT BỊ NUỐT IM LẶNG
--     095 kẹp doanh số thuần về 0 để không ra lương âm — vẫn đúng. Nhưng
--     phần vượt thì biến mất khỏi mọi báo cáo: bán 10tr, trả 40tr thì 30tr
--     không còn dấu vết ở đâu. Ghi 'returns_excess' vào breakdown.
--     KHÔNG tự động chuyển phần vượt sang kỳ sau — đó là chính sách, phải
--     do chủ NPP quyết, không phải việc migration tự nghĩ ra.
--
--  3. THIẾU LỌC org_id TRONG HÀM BỎ QUA RLS
--     compute_payroll_run là SECURITY DEFINER nên RLS không áp dụng. Câu
--     tính doanh số gộp chỉ lọc sales_user_id — hiện an toàn nhờ ăn may
--     (nhân viên luôn cùng org với đơn của mình). Trong một hàm đã bỏ qua
--     RLS thì không nên dựa vào bất biến ngầm. Thêm org_id = v_org.
--
-- GHI NHẬN THÊM, KHÔNG SỬA Ở ĐÂY
--   • return_lines đang có HAI trigger cùng đồng bộ credit_note_amount:
--     trg_return_lines_sync_credit (035:45) và trg_sync_return_credit
--     (055:88). Cả hai cùng loại dòng is_exchange nên ra cùng một số,
--     chỉ thừa chứ chưa sai. Gỡ bớt là việc dọn dẹp riêng, không gộp vào
--     một migration đang đổi tiền lương.
-- ====================================================================


-- --------------------------------------------------------------------
-- 1. payroll_returns_for — thêm điều kiện trạng thái đơn gốc.
--    Bản 095 nguyên văn, chỉ chèn đúng một mệnh đề AND.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_returns_for(
  p_user  uuid,
  p_org   uuid,
  p_start date,
  p_end   date
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(COALESCE(r.credit_note_amount, 0)), 0)
  FROM returns r
  LEFT JOIN sales_orders o ON o.id = r.order_id
  WHERE r.org_id = p_org
    AND r.status IN ('approved', 'completed')
    -- Giờ Việt Nam, không phải UTC. Xem mục 4 ở đầu file.
    AND ((r.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
        BETWEEN p_start AND p_end
    -- [096] Phiếu trả gắn vào đơn NHÁP hoặc ĐÃ HUỶ thì không trừ. Đơn đó
    --       chưa từng được cộng vào doanh số gộp (is_revenue_status), nên
    --       trừ credit của nó là phạt nhân viên hai lần cho một giao dịch
    --       không tồn tại. Phiếu KHÔNG gắn đơn (tạo tay ở /returns/new)
    --       không có đơn gốc để xét nên vẫn tính.
    AND (r.order_id IS NULL OR public.is_revenue_status(o.status))
    AND COALESCE(
          o.sales_user_id,
          (SELECT o2.sales_user_id
             FROM sales_orders o2
            WHERE o2.customer_id = r.customer_id
              AND o2.org_id = r.org_id
              AND public.is_revenue_status(o2.status)
              AND o2.order_date <= ((r.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
            ORDER BY o2.order_date DESC, o2.created_at DESC
            LIMIT 1)
        ) = p_user;
$$;

GRANT EXECUTE ON FUNCTION public.payroll_returns_for(uuid, uuid, date, date) TO authenticated;


-- --------------------------------------------------------------------
-- 2+3. compute_payroll_run — bản 095 nguyên văn, vá đúng hai chỗ:
--      lọc org_id cho câu doanh số gộp, và ghi returns_excess.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION compute_payroll_run(p_run_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org      uuid;
  v_month    date;
  v_status   text;
  v_period_start date;
  v_period_end   date;
  u          record;
  v_revenue  numeric;
  v_base_salary numeric;
  v_gas      numeric;
  v_phone    numeric;
  v_allowances numeric;
  v_emp_gas   numeric;
  v_emp_phone numeric;
  v_emp_allowances numeric;
  v_std_days numeric;
  v_act_days numeric;
  v_prorated numeric;
  v_kpi      numeric;
  v_kpi_partial numeric;
  v_kpi_tier record;
  v_kpi_per_user bool;
  v_kpi_target numeric;
  v_kpi_tiers  jsonb;
  v_kpi_pct    numeric;
  v_kpi_breakdown jsonb;
  v_over_pct   numeric;
  v_under_60_pct numeric;
  v_low_perf   text;
  v_oc_cfg   record;
  v_oc_count int;
  v_oc_bonus numeric;
  v_activity numeric;
  v_si       numeric;
  v_net      numeric;
  v_count    int := 0;
  v_role     text;
  v_oc_paid  int;
  v_touched  uuid[] := ARRAY[]::uuid[];
  v_gross    numeric;
  v_returns  numeric;
  v_net_raw  numeric;
BEGIN
  SELECT org_id, month, status INTO v_org, v_month, v_status
  FROM payroll_runs WHERE id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYROLL_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'locked' THEN
    RAISE EXCEPTION 'PAYROLL_RUN_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- [4] Hàm là SECURITY DEFINER + GRANT cho `authenticated`, mà trước đây
  --     chỉ kiểm org và trạng thái khoá. Không chặn ở đây thì một tài
  --     khoản bán hàng hoặc lái xe gọi thẳng RPC là tính lại được bảng
  --     lương của cả công ty.
  SELECT role INTO v_role FROM users WHERE id = auth.uid();
  IF COALESCE(v_role, '') NOT IN ('owner', 'manager', 'accountant') THEN
    RAISE EXCEPTION 'FORBIDDEN_ROLE' USING ERRCODE = 'P0001';
  END IF;

  v_period_start := v_month;
  v_period_end := (v_month + interval '1 month - 1 day')::date;

  -- [3] KHÔNG xoá dòng lương ở đây nữa. Bước DELETE + INSERT cũ thổi
  --     bay cả manual_adjustment, deductions và notes do kế toán nhập
  --     tay. Thay bằng UPSERT ở cuối vòng lặp, rồi dọn dòng thừa sau.

  SELECT
    COALESCE(MAX(base_salary), 0)::numeric,
    COALESCE(MAX(gas_allowance), 0)::numeric,
    COALESCE(MAX(phone_allowance), 0)::numeric,
    COALESCE(MAX(working_days_per_month), 26)::numeric,
    COALESCE(MAX(kpi_target_revenue), 0)::numeric,
    (SELECT target_tiers FROM hr_salary_config
       WHERE org_id = v_org AND COALESCE(is_active, true) = true
       ORDER BY created_at DESC LIMIT 1),
    COALESCE(MAX(over_target_percent), 0)::numeric,
    COALESCE(MAX(under_60_percent), 0)::numeric
  INTO v_base_salary, v_gas, v_phone, v_std_days, v_kpi_target, v_kpi_tiers, v_over_pct, v_under_60_pct
  FROM hr_salary_config
  WHERE org_id = v_org
    AND COALESCE(is_active, true) = true;
  v_kpi_tiers := COALESCE(v_kpi_tiers, '[]'::jsonb);
  v_allowances := v_gas + v_phone;

  FOR u IN
    SELECT id, full_name, role
    FROM users
    WHERE org_id = v_org
      AND COALESCE(is_active, true) = true
      AND role = 'sales'   -- tạm thời chỉ tính lương NV bán hàng
  LOOP
    SELECT
      COUNT(*) FILTER (WHERE status IN ('present','holiday'))::numeric
      + 0.5 * COUNT(*) FILTER (WHERE status = 'half_day')::numeric
    INTO v_act_days
    FROM hr_attendance
    WHERE user_id = u.id
      AND work_date BETWEEN v_period_start AND v_period_end;
    v_act_days := COALESCE(v_act_days, 0);

    -- [096] Thêm lọc org_id. Hàm là SECURITY DEFINER nên RLS KHÔNG áp
    --       dụng; trước đây câu này chỉ lọc sales_user_id và an toàn nhờ
    --       ăn may (NV luôn cùng org với đơn của mình). Trong một hàm bỏ
    --       qua RLS thì không nên dựa vào bất biến ngầm như vậy.
    SELECT COALESCE(SUM(total), 0) INTO v_gross
    FROM sales_orders
    WHERE sales_user_id = u.id
      AND org_id = v_org
      AND public.is_revenue_status(status)
      AND order_date BETWEEN v_period_start AND v_period_end;

    v_returns := public.payroll_returns_for(u.id, v_org, v_period_start, v_period_end);
    v_net_raw := v_gross - v_returns;

    -- [G] CHẶN SỐ ÂM. Trả nhiều hơn bán (khách trả hàng tồn của tháng trước,
    --     hoặc NV nghỉ giữa tháng) thì doanh số thuần âm. Không chặn ở đây
    --     thì nhánh dưới 60% cho ra lương ÂM: đã chạy thử, doanh số -40tr
    --     → lương cơ bản -400.000 và BHXH -42.000 → thực lĩnh -358.000 đ,
    --     tức công ty ghi nhận nhân viên NỢ lương. Kẹp về 0 và ghi lại số
    --     thật trong breakdown để phiếu lương vẫn giải thích được.
    v_revenue := GREATEST(0, v_net_raw);

    v_prorated := v_base_salary;   -- lương CB (mig 060: không prorate chấm công)
    v_emp_gas := v_gas;
    v_emp_phone := v_phone;
    v_emp_allowances := v_allowances;
    v_kpi := 0;
    v_kpi_per_user := false;
    v_kpi_pct := NULL;
    v_low_perf := 'normal';
    v_kpi_breakdown := '[]'::jsonb;

    -- 1) Per-user override (model cũ).
    SELECT min_revenue, bonus_type, bonus_value
      INTO v_kpi_tier
    FROM salary_kpi_tiers
    WHERE user_id = u.id AND month = v_month
      AND min_revenue <= v_revenue
    ORDER BY min_revenue DESC
    LIMIT 1;
    IF FOUND THEN
      v_kpi_per_user := true;
      IF v_kpi_tier.bonus_type = 'percent' THEN
        v_kpi := round(v_revenue * v_kpi_tier.bonus_value / 100, 0);
      ELSE
        v_kpi := v_kpi_tier.bonus_value;
      END IF;

    -- 2) Org config theo mức doanh số chung A + cộng dồn.
    ELSIF v_kpi_target > 0 THEN
      v_kpi_pct := v_revenue / v_kpi_target * 100;

      IF v_kpi_pct < 60 THEN
        -- Dưới 60% A: không hưởng lương cứng → lương = doanh số ×
        -- under_60%; KHÔNG có phụ cấp; không thưởng KPI.
        v_low_perf := 'under_60';
        v_prorated := round(v_revenue * v_under_60_pct / 100, 0);
        v_emp_gas := 0;
        v_emp_phone := 0;
        v_emp_allowances := 0;
        v_kpi := 0;
      ELSIF v_kpi_pct < 70 THEN
        v_low_perf := 'under_70';
        v_kpi := 0;
      ELSE
        SELECT
          COALESCE(SUM(CASE WHEN COALESCE((elem->>'min_percent')::numeric, 0) <= v_kpi_pct
                            THEN COALESCE((elem->>'bonus')::numeric, 0) ELSE 0 END), 0),
          COALESCE(jsonb_agg(jsonb_build_object(
            'min_percent', COALESCE((elem->>'min_percent')::numeric, 0),
            'bonus', COALESCE((elem->>'bonus')::numeric, 0),
            'label', elem->>'label',
            'passed', COALESCE((elem->>'min_percent')::numeric, 0) <= v_kpi_pct
          ) ORDER BY COALESCE((elem->>'min_percent')::numeric, 0)), '[]'::jsonb)
        INTO v_kpi_partial, v_kpi_breakdown
        FROM jsonb_array_elements(v_kpi_tiers) AS arr(elem);
        v_kpi := COALESCE(v_kpi_partial, 0);

        IF v_kpi_pct > 100 AND v_over_pct > 0 THEN
          v_low_perf := 'over_100';
          v_kpi := v_kpi + round((v_revenue - v_kpi_target) * v_over_pct / 100, 0);
        END IF;
      END IF;
    END IF;

    -- Order-count bonus.
    v_oc_bonus := 0;
    v_oc_count := 0;
    SELECT min_order_count, min_order_value, bonus_per_order, period
      INTO v_oc_cfg
    FROM salary_order_count_bonus_configs
    WHERE user_id = u.id
      AND effective_from <= v_period_end
      AND (effective_to IS NULL OR effective_to >= v_period_start)
    ORDER BY effective_from DESC
    LIMIT 1;
    v_oc_paid := 0;
    IF FOUND THEN
      IF v_oc_cfg.period = 'week' THEN
        -- [2] Cấu hình "Tuần" (043:47 CHECK IN ('week','month'), giao diện
        --     settings/users/[id]/salary/page.tsx:477 cho chọn): gom đơn
        --     theo tuần, MỖI TUẦN xét ngưỡng riêng, chỉ tuần nào đạt mới
        --     được thưởng. Trước đây nhánh này không tồn tại — cột period
        --     được SELECT rồi vứt đi — nên ngưỡng tuần bị đem so với số
        --     đơn CẢ THÁNG rồi thưởng cho toàn bộ đơn trong tháng.
        SELECT
          COALESCE(SUM(wk.cnt), 0),
          COALESCE(SUM(wk.cnt) FILTER (WHERE wk.cnt >= v_oc_cfg.min_order_count), 0)
        INTO v_oc_count, v_oc_paid
        FROM (
          SELECT date_trunc('week', order_date) AS w, count(*) AS cnt
          FROM sales_orders
          WHERE sales_user_id = u.id
            AND public.is_revenue_status(status)
            AND order_date BETWEEN v_period_start AND v_period_end
            AND total >= v_oc_cfg.min_order_value
          GROUP BY 1
        ) wk;
      ELSE
        SELECT count(*) INTO v_oc_count
        FROM sales_orders
        WHERE sales_user_id = u.id
          AND public.is_revenue_status(status)
          AND order_date BETWEEN v_period_start AND v_period_end
          AND total >= v_oc_cfg.min_order_value;
        IF v_oc_count >= v_oc_cfg.min_order_count THEN
          v_oc_paid := v_oc_count;
        END IF;
      END IF;
      v_oc_bonus := v_oc_paid * v_oc_cfg.bonus_per_order;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_activity
    FROM monthly_activity_bonuses
    WHERE user_id = u.id AND month = v_month;

    -- BHXH 10.5% trên phần lương CB hiệu lực (không trên phụ cấp).
    v_si := round(v_prorated * 0.105, 0);

    v_net := v_prorated + v_emp_allowances + v_kpi + v_oc_bonus + v_activity - v_si;

    INSERT INTO payroll_run_items (
      payroll_run_id, user_id,
      base_salary, standard_workdays, actual_workdays, prorated_base,
      allowances, kpi_bonus, order_count_bonus, activity_bonus,
      overtime, deductions, social_insurance,
      manual_adjustment, net_salary,
      computed_breakdown
    ) VALUES (
      p_run_id, u.id,
      v_base_salary, v_std_days, v_act_days, v_prorated,
      v_emp_allowances, v_kpi, v_oc_bonus, v_activity,
      0, 0, v_si,
      0, v_net,
      jsonb_build_object(
        'period_start', v_period_start,
        'period_end', v_period_end,
        'revenue', v_revenue,
        'revenue_gross', v_gross,
        'returns_deducted', v_returns,
        'revenue_net_raw', v_net_raw,
        'revenue_clamped', (v_net_raw < 0),
        -- [096] Phần hàng trả KHÔNG trừ được vì doanh số đã về 0. Kẹp im
        --       lặng là giấu tiền: trả 40tr trên nền bán 10tr thì 30tr
        --       biến mất khỏi mọi báo cáo. Ghi ra để còn nhìn thấy.
        'returns_excess', GREATEST(0, -v_net_raw),
        'gas_allowance', v_emp_gas,
        'phone_allowance', v_emp_phone,
        'allowance_dropped', (v_emp_allowances = 0 AND v_allowances > 0),
        'kpi_target_revenue', v_kpi_target,
        'kpi_pct', CASE WHEN v_kpi_target > 0 THEN round(v_revenue / v_kpi_target * 100, 1) ELSE NULL END,
        'kpi_model', CASE WHEN v_kpi_per_user THEN 'per_user_tier' ELSE 'org_cumulative' END,
        'kpi_tier_breakdown', v_kpi_breakdown,
        'low_perf', v_low_perf,
        'over_target_percent', v_over_pct,
        'under_60_percent', v_under_60_pct,
        'oc_count', COALESCE(v_oc_count, 0),
        'oc_paid_count', COALESCE(v_oc_paid, 0),
        'oc_period', COALESCE(v_oc_cfg.period, 'month'),
        'oc_min_count', COALESCE(v_oc_cfg.min_order_count, 0),
        'oc_min_value', COALESCE(v_oc_cfg.min_order_value, 0),
        'oc_bonus_per_order', COALESCE(v_oc_cfg.bonus_per_order, 0),
        'attendance_skipped', true
      )
    )
    -- [3] Các cột do NGƯỜI nhập (overtime, deductions, manual_adjustment,
    --     notes) cố ý KHÔNG nằm trong danh sách SET, nên "Tính lại" không
    --     còn xoá được chúng. Công thức net dưới đây khớp với
    --     src/lib/payroll/run.ts:126-134 để hai đường ghi không cho ra hai
    --     con số khác nhau trên cùng một dòng lương.
    ON CONFLICT (payroll_run_id, user_id) DO UPDATE SET
      base_salary        = EXCLUDED.base_salary,
      standard_workdays  = EXCLUDED.standard_workdays,
      actual_workdays    = EXCLUDED.actual_workdays,
      prorated_base      = EXCLUDED.prorated_base,
      allowances         = EXCLUDED.allowances,
      kpi_bonus          = EXCLUDED.kpi_bonus,
      order_count_bonus  = EXCLUDED.order_count_bonus,
      activity_bonus     = EXCLUDED.activity_bonus,
      social_insurance   = EXCLUDED.social_insurance,
      computed_breakdown = EXCLUDED.computed_breakdown,
      updated_at         = now(),
      net_salary         = EXCLUDED.prorated_base
                         + EXCLUDED.allowances
                         + EXCLUDED.kpi_bonus
                         + EXCLUDED.order_count_bonus
                         + EXCLUDED.activity_bonus
                         + payroll_run_items.overtime
                         + payroll_run_items.manual_adjustment
                         - payroll_run_items.deductions
                         - EXCLUDED.social_insurance;

    v_touched := v_touched || u.id;
    v_count := v_count + 1;
  END LOOP;

  -- Nhân sự đã nghỉ hoặc đổi vai trò thì bỏ dòng lương đi. Trước đây bước
  -- DELETE ở đầu hàm lo việc này; giờ UPSERT không xoá nên phải dọn ở đây.
  DELETE FROM payroll_run_items
  WHERE payroll_run_id = p_run_id
    AND NOT (user_id = ANY (v_touched));

  UPDATE payroll_runs
  SET computed_at = now()
  WHERE id = p_run_id;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_payroll_run(uuid) TO authenticated;


-- ####################################################################
-- # 097_returns_credited_at.sql
-- ####################################################################

-- ====================================================================
-- 097 — Phiếu trả lập cuối tháng, duyệt sang tháng sau thì tiền BIẾN MẤT
--
-- LỖ THỦNG (095/096 chưa xử, tìm ra khi rà lại và đã dựng lại được)
--
-- payroll_returns_for gom phiếu trả theo `created_at`. Nhưng phiếu trả từ
-- màn soạn đơn được tạo ở trạng thái 'pending' (order-form.tsx:816) và chỉ
-- thành 'completed' khi thủ kho bấm nhập lại hàng ở màn hình khác
-- (inventory/pending/page.tsx:373) — bước đó KHÔNG ghi lại thời điểm, và
-- bảng returns không hề có cột nào kiểu approved_at.
--
-- Nên phiếu lập cuối tháng, duyệt đầu tháng sau, rơi vào khoảng trống:
--
--   28/09  bán 30tr, khách trả 25tr → phiếu 'pending'
--   01/10  chốt lương T9  → phiếu còn 'pending', trừ 0
--   03/10  thủ kho nhập lại hàng → phiếu 'completed'
--   05/10  khoá kỳ T9
--   01/11  chốt lương T10 → không thấy, vì created_at nằm ở tháng 9
--
-- Đã chạy đúng kịch bản này trên Postgres 16:
--   T9  → gộp 30.000.000, trừ 0
--   T10 → gộp 0,          trừ 0
--   tính lại T9 → ERROR: PAYROLL_RUN_LOCKED
-- 25.000.000 đ không được trừ vào đâu cả, và không có cảnh báo nào.
--
-- Cuối tháng là lúc trả hàng nhiều nhất, nên đây không phải ca hiếm.
--
-- CÁCH SỬA
-- Ghi lại THỜI ĐIỂM PHIẾU TRỞ NÊN ĐÁNG TÍNH, rồi gom theo mốc đó thay vì
-- theo ngày lập. Phiếu duyệt tháng 10 thì trừ vào lương tháng 10 — đúng cả
-- về nghiệp vụ (lúc đó mới chắc chắn mất tiền) lẫn về kỹ thuật (không phải
-- mở lại kỳ đã khoá).
--
-- Không đổi cách gom của phiếu tạo tay ở /returns/new: chúng vào thẳng
-- 'completed' ngay khi INSERT nên credited_at = created_at, y như cũ.
-- ====================================================================


-- --------------------------------------------------------------------
-- 1. Cột mốc.
-- --------------------------------------------------------------------
ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS credited_at timestamptz;

COMMENT ON COLUMN returns.credited_at IS
  'Thời điểm phiếu trả trở nên đáng tính tiền (status vào approved/completed). '
  'Dùng để gom phiếu vào đúng kỳ lương / kỳ báo cáo. NULL nghĩa là phiếu chưa '
  'được duyệt, chưa trừ vào đâu cả. Do trigger trg_returns_credited_at giữ, '
  'đừng ghi tay.';

CREATE INDEX IF NOT EXISTS idx_returns_credited_at
  ON returns (org_id, credited_at)
  WHERE credited_at IS NOT NULL;


-- --------------------------------------------------------------------
-- 2. Trigger giữ cột đó.
--
-- Đặt ở tầng database chứ không ở tầng ứng dụng vì có ÍT NHẤT NĂM chỗ
-- ghi vào returns.status (order-form.tsx:810, handover/page.tsx:678,
-- inventory/pending/page.tsx:373, returns/new/page.tsx:50,
-- returns/[id]/page.tsx:88, lib/returns.ts:178). Nhớ sửa đủ năm chỗ là
-- điều sẽ không xảy ra.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_return_credited_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('approved', 'completed') THEN
    -- Đóng dấu lần đầu phiếu được duyệt. Đã có dấu thì giữ nguyên — duyệt
    -- rồi sửa ghi chú không được đẩy khoản trừ sang kỳ khác.
    IF NEW.credited_at IS NULL THEN
      NEW.credited_at := now();
    END IF;
  ELSE
    -- Quay về 'pending' hoặc bị 'rejected' thì phiếu không còn đáng tính.
    -- Xoá dấu để nếu sau này được duyệt lại thì tính vào kỳ duyệt lại,
    -- không phải kỳ duyệt lần đầu.
    NEW.credited_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_returns_credited_at ON returns;
CREATE TRIGGER trg_returns_credited_at
  BEFORE INSERT OR UPDATE OF status ON returns
  FOR EACH ROW EXECUTE FUNCTION public.sync_return_credited_at();


-- --------------------------------------------------------------------
-- 3. Bù dữ liệu cũ.
--
-- Phiếu đã duyệt từ trước không có mốc thật để lấy. `created_at` là ước
-- lượng tốt nhất còn lại, và cũng đúng bằng cách 095/096 đang gom, nên bù
-- như vậy KHÔNG làm đổi số của bất kỳ kỳ lương nào đã tính.
-- --------------------------------------------------------------------
UPDATE returns
   SET credited_at = created_at
 WHERE credited_at IS NULL
   AND status IN ('approved', 'completed');


-- --------------------------------------------------------------------
-- 4. payroll_returns_for gom theo mốc mới.
--
-- COALESCE(credited_at, created_at) chứ không phải credited_at trần: nếu
-- migration này chạy trên database mà bước bù ở trên vì lý do nào đó chưa
-- xong, phiếu cũ vẫn được tính như trước thay vì im lặng biến mất — đúng
-- cái lỗi mà migration này đang đi sửa.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_returns_for(
  p_user  uuid,
  p_org   uuid,
  p_start date,
  p_end   date
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(COALESCE(r.credit_note_amount, 0)), 0)
  FROM returns r
  LEFT JOIN sales_orders o ON o.id = r.order_id
  WHERE r.org_id = p_org
    AND r.status IN ('approved', 'completed')
    -- Giờ Việt Nam, không phải UTC: database chạy UTC nên ::date trần đẩy
    -- phiếu lập 0h–7h ngày mùng 1 sang kỳ trước (mig 095, mục 4).
    AND ((COALESCE(r.credited_at, r.created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
        BETWEEN p_start AND p_end
    -- Phiếu gắn vào đơn NHÁP / ĐÃ HUỶ thì không trừ: đơn đó chưa từng được
    -- cộng vào doanh số gộp nên trừ credit của nó là phạt hai lần (mig 096).
    AND (r.order_id IS NULL OR public.is_revenue_status(o.status))
    AND COALESCE(
          o.sales_user_id,
          (SELECT o2.sales_user_id
             FROM sales_orders o2
            WHERE o2.customer_id = r.customer_id
              AND o2.org_id = r.org_id
              AND public.is_revenue_status(o2.status)
              AND o2.order_date <= ((COALESCE(r.credited_at, r.created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
            ORDER BY o2.order_date DESC, o2.created_at DESC
            LIMIT 1)
        ) = p_user;
$$;

GRANT EXECUTE ON FUNCTION public.payroll_returns_for(uuid, uuid, date, date) TO authenticated;


-- --------------------------------------------------------------------
-- 5. Phiếu trả đã duyệt mà chưa trừ vào kỳ nào — để giao diện cảnh báo
--    trước khi khoá kỳ.
--
-- Sửa cách gom chỉ chặn lỗ thủng cho phiếu duyệt TỪ NAY. Phiếu đã kẹt sẵn
-- trong dữ liệu cũ thì phải nhìn thấy mới xử được, nên có hàm này.
-- SECURITY INVOKER (mặc định) để RLS vẫn áp dụng.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.payroll_unbilled_returns(date);
CREATE FUNCTION public.payroll_unbilled_returns(p_month date)
RETURNS TABLE (
  return_id      uuid,
  order_code     text,
  store_name     text,
  credit_amount  numeric,
  created_day    date,
  credited_day   date
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    r.id,
    o.order_code,
    c.store_name,
    COALESCE(r.credit_note_amount, 0),
    (r.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
    (COALESCE(r.credited_at, r.created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
  FROM returns r
  LEFT JOIN sales_orders o ON o.id = r.order_id
  LEFT JOIN customers c ON c.id = r.customer_id
  WHERE r.org_id = public.user_org_id()
    AND r.status IN ('approved', 'completed')
    AND COALESCE(r.credit_note_amount, 0) > 0
    -- Phiếu LẬP trong kỳ này nhưng mốc tính đã rơi sang kỳ SAU: khoá kỳ bây
    -- giờ thì khoản trừ sẽ vào lương kỳ sau, không mất — nhưng người duyệt
    -- nên biết trước thay vì phát hiện lúc nhân viên thắc mắc.
    AND (r.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
        BETWEEN p_month AND (p_month + interval '1 month - 1 day')::date
    AND (COALESCE(r.credited_at, r.created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
        > (p_month + interval '1 month - 1 day')::date
  ORDER BY 5;
$$;

COMMENT ON FUNCTION public.payroll_unbilled_returns(date) IS
  'Phiếu trả LẬP trong kỳ nhưng được duyệt SAU kỳ, nên khoản trừ rơi vào kỳ '
  'sau. Dùng để cảnh báo trước khi khoá bảng lương.';

GRANT EXECUTE ON FUNCTION public.payroll_unbilled_returns(date) TO authenticated;


-- ####################################################################
-- # 098_stock_value_zero_fallback.sql
-- ####################################################################

-- ====================================================================
-- 098 — Giá trị tồn kho hiện 0đ dù kho còn hàng (sổ lỗi NPP-03)
--
-- CƠ CHẾ (đã đọc mã và dựng lại được)
--
-- View v_stock_balance_by_zone (mig 048:36-47) tính giá trị tồn như sau:
--
--     COALESCE(
--       (SELECT SUM(fl.qty_in_base_uom_remaining * fl.unit_cost)
--          FROM fifo_layers fl WHERE … AND fl.closed_at IS NULL),
--       SUM(n.qty_on_hand * COALESCE(n.unit_cost, 0))   -- lùi về giá lô
--     )
--
-- Ý đồ đúng: ưu tiên giá vốn FIFO, không có thì lùi về giá vốn theo lô.
-- Nhưng `COALESCE` chỉ lùi khi truy vấn con trả về NULL. `SUM` trên các
-- dòng có unit_cost = 0 trả về **0**, không phải NULL — và
-- `COALESCE(0, giá_lô)` cho ra **0**. Giá vốn theo lô vẫn đúng nhưng bị
-- ghi đè.
--
-- VÌ SAO unit_cost = 0 XẢY RA THƯỜNG XUYÊN, KHÔNG PHẢI CA HIẾM
-- fifo_layers chỉ được ghi ở một chỗ: nhánh nhận hàng chưa dùng về từ
-- tài xế (mig 047/051/057). Câu insert dùng `COALESCE(r.unit_cost, 0)`
-- (057:143), mà `r.unit_cost` lấy từ stock_entry_lines — nơi giá vốn chỉ
-- được đóng ở nhánh "Tự giao hàng" (xem
-- supabase/diagnostics/check_stock_not_deducted.sql, sổ lỗi NPP-01).
-- Nên đơn giao qua tài xế sinh ra lô có giá vốn 0, và từ đó mọi sản phẩm
-- ấy hiện giá trị tồn 0đ.
--
-- Hậu quả: thẻ KPI "Tổng giá trị tồn kho" ra 0đ trong khi các trang khác
-- (đọc thẳng batches.unit_cost) hiện số thật — đúng như sổ lỗi ghi "ba
-- chỗ trong cùng phân hệ Kho đưa ra ba giá trị tồn, thẻ KPI to nhất lại
-- là 0đ".
--
-- CÁCH SỬA
-- Đổi `COALESCE(x, y)` thành `COALESCE(NULLIF(x, 0), y)`.
-- Giá vốn FIFO bằng đúng 0 cho lượng hàng ĐANG CÒN nghĩa là "không có
-- thông tin giá", không phải "hàng không có giá trị" — nên phải lùi về
-- giá vốn theo lô, giống như khi không có lô FIFO nào.
--
-- Không sửa nhánh xuất kho ở đây: đó là NPP-01, cần chốt nghiệp vụ trước
-- (xem check_stock_not_deducted.sql). Migration này chỉ làm cho con số
-- hiển thị thôi hết sai — hàng tồn thật không đổi.
--
-- Phần còn lại của view giữ NGUYÊN VĂN mig 048.
-- ====================================================================

DROP VIEW IF EXISTS v_stock_balance_by_zone;

CREATE OR REPLACE VIEW v_stock_balance_by_zone AS
WITH normalized AS (
  SELECT
    b.org_id,
    b.product_id,
    COALESCE(b.warehouse_zone, 'sale') AS warehouse_zone,
    b.qty_on_hand,
    b.unit_cost
  FROM batches b
  WHERE b.qty_on_hand > 0
)
SELECT
  n.org_id,
  n.product_id,
  n.warehouse_zone,
  SUM(n.qty_on_hand)::numeric AS qty_in_base_uom,
  -- Prefer FIFO valuation; fallback to batch weighted-avg.
  -- [098] NULLIF(…, 0) là chỗ DUY NHẤT được sửa so với mig 048.
  --       Tổng FIFO bằng 0 (do lô nhận về từ tài xế có unit_cost = 0)
  --       trước đây ghi đè mất giá vốn theo lô, làm giá trị tồn hiện 0đ.
  COALESCE(
    NULLIF(
      (
        SELECT SUM(fl.qty_in_base_uom_remaining * fl.unit_cost)::numeric
        FROM fifo_layers fl
        WHERE fl.org_id = n.org_id
          AND fl.product_id = n.product_id
          AND fl.warehouse_zone = n.warehouse_zone
          AND fl.closed_at IS NULL
      ),
      0
    ),
    SUM(n.qty_on_hand * COALESCE(n.unit_cost, 0))::numeric
  ) AS value
FROM normalized n
GROUP BY n.org_id, n.product_id, n.warehouse_zone;

-- Mig 092 bật security_invoker cho view này để RLS vẫn áp dụng. DROP +
-- CREATE làm mất thuộc tính đó, nên phải đặt lại — bỏ quên là mở toàn bộ
-- số liệu tồn kho cho mọi vai trò mà không có lỗi nào báo ra.
ALTER VIEW v_stock_balance_by_zone SET (security_invoker = true);

COMMENT ON VIEW v_stock_balance_by_zone IS
  'T-09: per (product, warehouse_zone) qty + FIFO-valued cost. One row per '
  'zone (sale/date) per product with positive on-hand. Giá vốn FIFO bằng 0 '
  'được coi là KHÔNG CÓ THÔNG TIN và lùi về giá vốn theo lô (mig 098).';

GRANT SELECT ON v_stock_balance_by_zone TO authenticated;


-- ####################################################################
-- # 099_einvoice_refid_split.sql
-- ####################################################################

-- ====================================================================
-- 099 — Tách RefID khỏi số hoá đơn MISA
--
-- LỖI ĐANG CHẠY
-- `invoices.misa_invoice_id` đang kiêm HAI vai, và vai sau xoá mất vai
-- trước:
--
--   publish/route.ts:307  ghi RefID (GUID mình sinh) vào cột này
--   refresh-status:110    ghi InvNo (số hoá đơn MISA cấp) ĐÈ LÊN
--
-- Dây chuyền hậu quả:
--   1. Lần refresh đầu chạy đúng, ghi InvNo đè GUID.
--   2. Lần refresh thứ hai gọi ?refID=<số hoá đơn> → MISA không biết →
--      "MISA không trả về dữ liệu HD." Câu đó chỉ người dùng đi soi MISA,
--      trong khi lỗi nằm ở chính chỗ này.
--   3. Mất khoá là mất đường hỏi: KHÔNG BAO GIỜ biết hoá đơn bị huỷ hay
--      bị thay thế trên MISA sau đó.
--   4. Deep-link MISA (src/lib/misa/web-url.ts) gãy.
--   5. Đã có người vá ở chỗ DÙNG thay vì chỗ GÂY RA: cả
--      publish/route.ts:84 lẫn invoices/[id]/page.tsx:231 đều phải
--      `uuidRe.test(misa_invoice_id)` để đoán xem cột này lúc này đang
--      giữ vai nào.
--
-- CÁCH SỬA: hai khoá, hai cột. Đây là ràng buộc kiến trúc, không phải
-- chuyện đặt tên.
--
--   misa_ref_id      GUID mình sinh, BẤT BIẾN     — chỉ publish ghi
--   misa_inv_no      số hoá đơn MISA cấp          — chỉ refresh ghi
--   misa_inv_series  ký hiệu (vd 1C25MHG)         — chỉ refresh ghi
--   misa_lookup_code TransactionID                — chỉ refresh ghi
--
-- BACKFILL — đọc kỹ phần này
-- Dòng nào `misa_invoice_id` còn đúng khuôn UUID thì RefID vẫn còn:
-- chép sang `misa_ref_id`. Dòng nào KHÔNG đúng khuôn UUID thì refresh đã
-- ghi đè mất RefID: chép giá trị đó sang `misa_inv_no` (nó là số hoá đơn),
-- để `misa_ref_id = NULL`, và ĐÁNH DẤU vào `misa_note`.
--
-- Không dọn im lặng. Những hoá đơn đó cần phát hành lại hoặc gán tay
-- RefID; không ai biết là bao nhiêu tờ thì không ai làm. Migration
-- RAISE NOTICE số lượng, và `misa_note` giữ dấu vết để tra lại bất cứ lúc
-- nào (xem supabase/diagnostics/einvoice_lost_refid.sql).
--
-- KHÔNG đụng RLS: invoices đã bật RLS ở mức DÒNG (mig 002/084), cột mới
-- tự nằm trong policy sẵn có. Cũng không có GRANT theo danh sách cột nào
-- trên bảng này nên cột mới thừa hưởng quyền hiện tại.
-- ====================================================================

-- --- 1. Cột mới -----------------------------------------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS misa_ref_id text,
  ADD COLUMN IF NOT EXISTS misa_inv_no text,
  ADD COLUMN IF NOT EXISTS misa_inv_series text,
  ADD COLUMN IF NOT EXISTS misa_inv_date date,
  ADD COLUMN IF NOT EXISTS misa_invoice_code text,
  ADD COLUMN IF NOT EXISTS misa_relation text,
  ADD COLUMN IF NOT EXISTS misa_org_ref_id text,
  ADD COLUMN IF NOT EXISTS misa_last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS misa_note text,
  ADD COLUMN IF NOT EXISTS misa_no_locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN invoices.misa_ref_id IS
  'RefID (GUID) mình sinh lúc đẩy hoá đơn. BẤT BIẾN — chỉ publish được '
  'ghi. Đây là khoá DUY NHẤT để hỏi lại MISA về hoá đơn này; ghi đè nó là '
  'cắt đường hỏi.';
COMMENT ON COLUMN invoices.misa_inv_no IS
  'Số hoá đơn MISA cấp (InvNo). Chỉ vòng refresh/sync được ghi.';
COMMENT ON COLUMN invoices.misa_inv_series IS
  'Ký hiệu hoá đơn (vd 1C25MHG). Số hoá đơn KHÔNG định danh được nếu '
  'thiếu ký hiệu — hai ký hiệu khác nhau dùng chung dải số là chuyện '
  'thường.';
COMMENT ON COLUMN invoices.misa_inv_date IS
  'Ngày phát hành trên MISA (InvDate). Khác ngày ghi sổ — thiếu nó thì '
  'không biết kỳ thuế.';
COMMENT ON COLUMN invoices.misa_invoice_code IS
  'Mã cơ quan thuế cấp (InvoiceCode). Chỉ đơn vị dùng hoá đơn CÓ MÃ mới '
  'có; xem company_einvoice_config.misa_is_invoice_with_code.';
COMMENT ON COLUMN invoices.misa_relation IS
  'Trục QUAN HỆ, đọc từ EInvoiceStatus: new/replacement/adjustment/'
  'replaced/adjusted. Khác hẳn trục phát hành (PublishStatus) — hai trục '
  'nằm ở hai field.';
COMMENT ON COLUMN invoices.misa_org_ref_id IS
  'RefID của hoá đơn GỐC khi tờ này là bản thay thế/điều chỉnh.';
COMMENT ON COLUMN invoices.misa_no_locked IS
  'true = số hoá đơn do người GÁN TAY. Vòng quét không được ghi đè: '
  'misa_ref_id trên hoá đơn đó thường trỏ về tờ ĐÃ CHẾT, quét tiếp là ghi '
  'số chết đè lên số người vừa gán, lặng lẽ, mỗi lần chạy.';

-- --- 2. Nới CHECK của misa_status -----------------------------------
-- Ràng buộc gốc nằm ở mig 011, thêm KÈM cột bằng
-- `ADD COLUMN IF NOT EXISTS ... CHECK (...)`. Nếu cột đã tồn tại từ trước
-- thì cả câu lệnh bị bỏ qua — CHECK bao gồm. Nên KHÔNG được đoán tên
-- ràng buộc, cũng không được cho rằng nó tồn tại: tra trong catalog rồi
-- mới xử lý.
DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'invoices'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%misa_status%'
  LOOP
    EXECUTE format('ALTER TABLE invoices DROP CONSTRAINT %I', v_name);
    RAISE NOTICE 'Đã bỏ ràng buộc cũ trên misa_status: %', v_name;
  END LOOP;
END $$;

ALTER TABLE invoices
  ADD CONSTRAINT invoices_misa_status_check CHECK (
    misa_status IS NULL OR misa_status IN (
      'pending',          -- đang đẩy lên
      'sent',             -- đã đẩy, MISA chưa cấp số
      'waiting_code',     -- đã cấp số, chờ cơ quan thuế cấp mã
      'signed',           -- đã phát hành (PublishStatus = 3, hoặc đã có mã CQT)
      'replaced',         -- BỊ thay thế → hết hiệu lực
      'cancelled',        -- bị huỷ trên MISA
      'amount_mismatch',  -- số tiền MISA khác sổ
      'error'
    )
  );

-- --- 3. Trục quan hệ: giá trị hợp lệ --------------------------------
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_misa_relation_check;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_misa_relation_check CHECK (
    misa_relation IS NULL OR misa_relation IN (
      'new',          -- 1 = hoá đơn mới
      'replacement',  -- 3 = hoá đơn thay thế (tờ này thay cho tờ khác)
      'adjustment',   -- 4 = hoá đơn điều chỉnh (tờ này điều chỉnh tờ khác)
      'replaced',     -- 7 = BỊ thay thế → hết hiệu lực
      'adjusted',     -- 8 = BỊ điều chỉnh → VẪN CÒN hiệu lực
      'unknown'       -- MISA trả giá trị lạ: KHÔNG ĐOÁN
    )
  );

-- --- 4. Backfill ----------------------------------------------------
DO $$
DECLARE
  v_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_kept    integer;
  v_lost    integer;
BEGIN
  -- 4a. Còn đúng khuôn UUID → RefID vẫn nguyên.
  UPDATE invoices
     SET misa_ref_id = misa_invoice_id
   WHERE misa_ref_id IS NULL
     AND misa_invoice_id IS NOT NULL
     AND misa_invoice_id ~* v_uuid_re;
  GET DIAGNOSTICS v_kept = ROW_COUNT;

  -- 4b. Không đúng khuôn UUID → refresh đã ghi đè mất RefID. Giá trị
  --     đang nằm đó là SỐ HOÁ ĐƠN, chuyển sang đúng cột của nó.
  --     Bỏ qua rác cũ '<Chưa cấp số>' (bug cũ đã fix, xem publish:82).
  --
  --     `misa_inv_no IS NULL` KHÔNG thừa. Thiếu nó thì chạy lại migration
  --     lần hai vẫn khớp đúng những dòng đó (misa_ref_id còn NULL,
  --     misa_invoice_id còn nguyên) và nối thêm đoạn ghi chú lần nữa —
  --     đã đo: lần 2 báo "2 hoá đơn MẤT RefID" y như lần 1. Nó cũng
  --     chặn việc đè số cũ lên số mà vòng refresh đã ghi đúng.
  UPDATE invoices
     SET misa_inv_no = misa_invoice_id,
         misa_note = COALESCE(misa_note || E'\n', '')
                     || 'MẤT RefID: cột misa_invoice_id cũ đã bị số hoá đơn ghi đè '
                     || '(mig 099). Không tra cứu lại được trên MISA — cần phát hành '
                     || 'lại hoặc gán tay RefID.'
   WHERE misa_ref_id IS NULL
     AND misa_inv_no IS NULL
     AND misa_invoice_id IS NOT NULL
     AND misa_invoice_id !~* v_uuid_re
     AND misa_invoice_id NOT LIKE '<%';
  GET DIAGNOSTICS v_lost = ROW_COUNT;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'BACKFILL 099';
  RAISE NOTICE '  % hoá đơn giữ được RefID.', v_kept;
  RAISE NOTICE '  % hoá đơn MẤT RefID — đã đánh dấu vào misa_note.', v_lost;
  IF v_lost > 0 THEN
    RAISE NOTICE '  Những tờ này KHÔNG hỏi lại MISA được. Liệt kê bằng:';
    RAISE NOTICE '    supabase/diagnostics/einvoice_lost_refid.sql';
  END IF;
  RAISE NOTICE '=====================================================';
END $$;

-- --- 5. Hai hoá đơn cùng số là lỗi, chặn ở tầng DB ------------------
-- Partial: chỉ ràng buộc khi đã có số. Hoá đơn chưa cấp số (NULL) thì
-- bao nhiêu tờ cũng được.
-- Ký hiệu vào khoá vì hai ký hiệu khác nhau dùng chung dải số là chuyện
-- thường; COALESCE để ký hiệu NULL không làm rỗng cả khoá (NULL trong
-- unique index là "khác nhau hết", tức không chặn được gì).
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_misa_inv_no
  ON invoices (org_id, COALESCE(misa_inv_series, ''), misa_inv_no)
  WHERE misa_inv_no IS NOT NULL;

-- --- 6. Chỉ mục cho vòng quét ---------------------------------------
-- Lượt 2 sắp theo misa_last_checked_at NULLS FIRST; không có chỉ mục thì
-- mỗi lần chạy là một lần quét toàn bảng invoices.
CREATE INDEX IF NOT EXISTS idx_invoices_misa_sync
  ON invoices (org_id, misa_last_checked_at NULLS FIRST)
  WHERE misa_ref_id IS NOT NULL;

-- --- 7. Cột cũ: giữ lại, đánh dấu không dùng nữa ---------------------
-- KHÔNG drop trong migration này. Còn mã đang chạy đọc nó (danh sách hoá
-- đơn, trang chi tiết), và drop cột là thao tác không lùi được. Drop ở
-- migration sau, khi đã xác nhận không còn ai đọc.
COMMENT ON COLUMN invoices.misa_invoice_id IS
  'KHÔNG DÙNG NỮA (mig 099) — cột này từng kiêm cả RefID lẫn số hoá đơn '
  'và vai sau xoá mất vai trước. Dùng misa_ref_id / misa_inv_no. Giữ lại '
  'để đối chiếu; sẽ drop ở migration sau.';


-- ####################################################################
-- # 100_misa_invoice_snapshots.sql
-- ####################################################################

-- ====================================================================
-- 100 — Bảng snapshot hoá đơn kéo từ MISA về
--
-- VÌ SAO CẦN
-- Toàn bộ luồng hiện tại đi MỘT CHIỀU: app đẩy hoá đơn lên MISA rồi hỏi
-- lại đúng những tờ mình đã đẩy (qua misa_ref_id). Hệ quả: hoá đơn phát
-- hành THẲNG trên web MISA — kế toán tự lập, hoá đơn thay thế do MISA
-- sinh, hoá đơn của người khác trong cùng MST — là VÔ HÌNH với sổ. Đó
-- đúng loại hoá đơn ngoài sổ mà kiểm toán sẽ hỏi.
--
-- Bảng này là bản sao ĐỌC-VỀ của danh sách hoá đơn bên MISA. Nó KHÔNG
-- phải nguồn sự thật của sổ; nó là thứ để đối chiếu hai chiều:
--   • hoá đơn có trên MISA mà không có trong sổ  → "Chỉ có trên MISA"
--   • hoá đơn có trong sổ mà không có trên MISA  → tra ngược bằng ref_id
--
-- KHOÁ TỰ NHIÊN
-- (org_id, ref_id) — RefID là GUID do MISA quản lý, duy nhất tuyệt đối.
-- Thêm chỉ mục phụ trên (org_id, inv_series_norm, inv_no_norm) vì đối
-- soát dữ liệu CŨ phải dựa vào ký hiệu + số: hoá đơn có sẵn trên MISA
-- không mang RefID do app này sinh, nên tầng khớp theo ref_id không bao
-- giờ trúng với chúng. Đã đo trên 30 hoá đơn thật: khoá (ký hiệu, số đã
-- chuẩn hoá) là DUY NHẤT.
--
-- CHUẨN HOÁ KHI SO, GIỮ NGUYÊN KHI LƯU
-- inv_no / inv_series giữ NGUYÊN VĂN chuỗi MISA trả về (số hoá đơn thật
-- là '00007140', 8 chữ số). Hai cột `*_norm` là bản đã chuẩn hoá, sinh
-- tự động, chỉ dùng để khớp — không hiển thị, không xuất báo cáo.
-- ====================================================================

CREATE TABLE IF NOT EXISTS misa_invoice_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- --- Định danh bên MISA ------------------------------------------
  ref_id text NOT NULL,
  inv_series text,
  inv_no text,
  inv_date date,
  transaction_id text,
  invoice_code text,

  -- --- Người mua ----------------------------------------------------
  buyer_tax_code text,
  buyer_name text,

  -- --- Tiền ---------------------------------------------------------
  -- CÓ THỂ ÂM: hoá đơn điều chỉnh giảm mang số chênh âm (đã đo trên dữ
  -- liệu thật). Mọi phép so tiền phải xử dấu.
  total_amount numeric,
  amount_before_vat numeric,
  vat_amount numeric,

  -- --- Hai trục trạng thái -------------------------------------------
  publish_status integer,
  einvoice_status integer,
  relation text,
  is_deleted boolean NOT NULL DEFAULT false,
  org_ref_id text,

  -- --- Đối soát ------------------------------------------------------
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  match_method text,
  match_confidence text,
  match_status text,
  match_note text,

  -- Bản ghi thô, để tra lại khi phát hiện mình bóc field sai. Không có
  -- nó thì mỗi lần nghi ngờ phải đi kéo lại toàn bộ từ MISA.
  raw jsonb,

  pulled_at timestamptz NOT NULL DEFAULT now(),
  matched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Chuẩn hoá để KHỚP. Sinh tự động nên không thể quên cập nhật.
--   số hoá đơn : bỏ khoảng trắng + số 0 ở đầu ('00007140' → '7140');
--                chuỗi toàn số 0 giữ nguyên để không nuốt mất dữ liệu
--   ký hiệu    : bỏ khoảng trắng + viết hoa. KHÔNG bỏ chữ số đầu ở đây —
--                '1C25MHG' và '2C25MHG' là hai MẪU SỐ khác nhau, gộp
--                chúng ở tầng lưu là mất dữ liệu. Việc bỏ chữ số đầu chỉ
--                được làm ở tầng khớp DỰ PHÒNG, có gắn "cần review".
ALTER TABLE misa_invoice_snapshots
  ADD COLUMN IF NOT EXISTS inv_no_norm text
    GENERATED ALWAYS AS (
      CASE
        WHEN inv_no IS NULL THEN NULL
        WHEN regexp_replace(replace(inv_no, ' ', ''), '^0+', '') = '' THEN replace(inv_no, ' ', '')
        ELSE regexp_replace(replace(inv_no, ' ', ''), '^0+', '')
      END
    ) STORED,
  ADD COLUMN IF NOT EXISTS inv_series_norm text
    GENERATED ALWAYS AS (upper(replace(COALESCE(inv_series, ''), ' ', ''))) STORED;

-- Một RefID = một hoá đơn. Kéo lại nhiều lần thì UPSERT, không nhân bản.
CREATE UNIQUE INDEX IF NOT EXISTS uq_misa_snapshot_ref
  ON misa_invoice_snapshots (org_id, ref_id);

-- Đường khớp chính cho dữ liệu cũ (ký hiệu + số).
CREATE INDEX IF NOT EXISTS idx_misa_snapshot_no
  ON misa_invoice_snapshots (org_id, inv_series_norm, inv_no_norm);

-- Rổ "chỉ có trên MISA" và các rổ cần xử lý khác.
CREATE INDEX IF NOT EXISTS idx_misa_snapshot_status
  ON misa_invoice_snapshots (org_id, match_status, inv_date DESC);

CREATE INDEX IF NOT EXISTS idx_misa_snapshot_invoice
  ON misa_invoice_snapshots (invoice_id)
  WHERE invoice_id IS NOT NULL;

-- Khớp theo mã tra cứu (tầng 2).
CREATE INDEX IF NOT EXISTS idx_misa_snapshot_txn
  ON misa_invoice_snapshots (org_id, transaction_id)
  WHERE transaction_id IS NOT NULL;

ALTER TABLE misa_invoice_snapshots
  DROP CONSTRAINT IF EXISTS misa_snapshot_match_status_check;
ALTER TABLE misa_invoice_snapshots
  ADD CONSTRAINT misa_snapshot_match_status_check CHECK (
    match_status IS NULL OR match_status IN (
      'matched',        -- khớp, tiền cũng khớp
      'amount_diff',    -- khớp được hoá đơn nhưng lệch tiền
      'misa_only',      -- CHỈ có trên MISA — hoá đơn ngoài sổ
      'cancelled',      -- đã huỷ bên MISA
      'replaced',       -- đã bị thay thế → hết hiệu lực
      'needs_review'    -- khớp bằng suy đoán, người phải xác nhận
    )
  );

ALTER TABLE misa_invoice_snapshots
  DROP CONSTRAINT IF EXISTS misa_snapshot_match_method_check;
ALTER TABLE misa_invoice_snapshots
  ADD CONSTRAINT misa_snapshot_match_method_check CHECK (
    match_method IS NULL OR match_method IN (
      'ref_id',          -- tầng 1 — chắc chắn
      'transaction_id',  -- tầng 2 — chắc chắn
      'inv_no',          -- tầng 3 — chắc chắn (khoá tự nhiên, đã đo là duy nhất)
      'inv_no_loose',    -- tầng 3b — khớp sau khi bỏ chữ số đầu ký hiệu: CẦN REVIEW
      'tax_date_amount', -- tầng 4 — suy đoán, chỉ nhận khi duy nhất: CẦN REVIEW
      'manual'           -- người chốt tay — vòng khớp KHÔNG được đụng vào
    )
  );

COMMENT ON TABLE misa_invoice_snapshots IS
  'Bản sao đọc-về của danh sách hoá đơn bên MISA, để đối soát hai chiều. '
  'KHÔNG phải nguồn sự thật của sổ.';
COMMENT ON COLUMN misa_invoice_snapshots.match_method IS
  'Cách khớp được. ''manual'' = người chốt tay, vòng khớp tự động phải bỏ qua.';
COMMENT ON COLUMN misa_invoice_snapshots.total_amount IS
  'CÓ THỂ ÂM (hoá đơn điều chỉnh giảm). Mọi phép so tiền phải xử dấu.';
COMMENT ON COLUMN misa_invoice_snapshots.inv_no IS
  'Số hoá đơn NGUYÊN VĂN MISA trả về (thường 8 chữ số, vd 00007140). '
  'Bản chuẩn hoá để khớp nằm ở inv_no_norm.';

-- --- RLS -------------------------------------------------------------
-- Đây là dữ liệu hoá đơn thuế: cùng mức nhạy cảm với bảng invoices, nên
-- cùng bộ vai trò. Không mở cho sales/warehouse/driver.
ALTER TABLE misa_invoice_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View misa snapshots" ON misa_invoice_snapshots;
CREATE POLICY "View misa snapshots" ON misa_invoice_snapshots FOR SELECT TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner','accountant','manager'));

DROP POLICY IF EXISTS "Manage misa snapshots" ON misa_invoice_snapshots;
CREATE POLICY "Manage misa snapshots" ON misa_invoice_snapshots FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner','accountant','manager'))
  WITH CHECK (org_id = public.user_org_id() AND public.user_role() IN ('owner','accountant','manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON misa_invoice_snapshots TO authenticated;


-- ####################################################################
-- # 101_pod_photos_bucket.sql
-- ####################################################################

-- =====================================================================
-- Migration 101: bucket ảnh giao hàng (POD)
-- =====================================================================
-- KHÔNG thêm cột nào. `delivery_lines.pod_photo_url` và `.pod_signature`
-- đã có từ migration 001 và trang chi tiết đơn đã hiển thị ảnh POD — chỉ
-- chưa bao giờ có màn nào GHI vào. Migration này chỉ tạo chỗ chứa ảnh.
--
-- Chữ ký KHÔNG vào bucket: nó nằm trong cột `pod_signature` (text, data
-- URL PNG) và được RLS của `delivery_lines` bảo vệ theo org. Chữ ký là
-- thứ nhạy cảm hơn ảnh thùng hàng nên để nó trong DB là cố ý.
--
-- ĐÁNH ĐỔI ĐÃ BIẾT: bucket để `public = true`, giống hệt `visit-photos`
-- ở migration 014. Nghĩa là ai có URL đều xem được ảnh, không cần đăng
-- nhập. Chọn vậy vì trang /orders/[id] render thẳng
-- <img src={dl.pod_photo_url}> — chuyển sang bucket riêng tư thì phải ký
-- URL tạm và URL đã lưu trong DB sẽ hết hạn. Đường dẫn có org_id +
-- delivery_line_id (đều là uuid) nên không đoán được, nhưng đó là che
-- giấu chứ không phải kiểm soát truy cập. Muốn siết thì phải đổi cả
-- đường đọc, làm riêng.

INSERT INTO storage.buckets (id, name, public)
VALUES ('pod-photos', 'pod-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Ghi và xoá bị giới hạn trong thư mục org của người dùng; đọc thì mở
-- cho mọi tài khoản đã đăng nhập (bucket vốn đã public).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'pod_photos_insert'
  ) THEN
    CREATE POLICY "pod_photos_insert" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'pod-photos'
        AND (split_part(name, '/', 1))::uuid = public.user_org_id()
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'pod_photos_select'
  ) THEN
    CREATE POLICY "pod_photos_select" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'pod-photos');
  END IF;

  -- KHÔNG có policy DELETE. Ảnh POD là bằng chứng giao hàng: xoá được
  -- từ phía client thì lúc có tranh chấp với khách, bên xoá được là bên
  -- thắng. `visit-photos` có DELETE vì ảnh viếng thăm là ghi nhận nội
  -- bộ, không phải chứng từ.
END $$;


-- ####################################################################
-- # 102_opening_balances.sql
-- ####################################################################

-- =====================================================================
-- Migration 102: công nợ ĐẦU KỲ cho khách hàng và nhà cung cấp
-- =====================================================================
-- Trước đây `receivables` chỉ sinh ra từ đơn đã giao, `payables` từ phiếu
-- nhập. Số dư mang sang từ sổ cũ không có chỗ đứng, nên NPP mới lên hệ
-- thống hoặc phải bịa đơn hàng giả (bẩn tồn kho + doanh số), hoặc bỏ hẳn
-- công nợ cũ ra ngoài phần mềm.
--
-- KHÔNG tạo bảng mới. Công nợ đầu kỳ VẪN LÀ công nợ: mọi báo cáo tuổi nợ,
-- màn thu tiền, tổng nợ theo khách đều đã đọc hai bảng này. Tách sang
-- bảng riêng là buộc phải sửa lại từng chỗ đó, và chỗ nào quên sẽ báo
-- thiếu tiền mà không ai biết.
--
-- Chỉ thêm một CỜ để phân biệt và một chỉ mục để mỗi đối tượng có đúng
-- MỘT dòng đầu kỳ — nhờ đó nhập lại file là cập nhật, không nhân bản.

-- ---------------------------------------------------------------------
-- 1. Cột
-- ---------------------------------------------------------------------
ALTER TABLE receivables
  ADD COLUMN IF NOT EXISTS opening_balance boolean NOT NULL DEFAULT false,
  -- receivables chưa hề có cột ghi chú. Dòng đầu kỳ cần nói rõ "chốt sổ
  -- ngày nào", nếu không thì sang năm không ai giải thích được con số.
  ADD COLUMN IF NOT EXISTS note text;

ALTER TABLE payables
  ADD COLUMN IF NOT EXISTS opening_balance boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------
-- 2. Mỗi đối tượng đúng MỘT dòng đầu kỳ
-- ---------------------------------------------------------------------
-- Chỉ mục BỘ PHẬN (chỉ áp lên dòng đầu kỳ): công nợ thường thì một khách
-- có bao nhiêu dòng cũng được, ràng buộc này không được đụng tới chúng.
CREATE UNIQUE INDEX IF NOT EXISTS uq_receivables_opening
  ON receivables (org_id, customer_id)
  WHERE opening_balance;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payables_opening
  ON payables (org_id, supplier_id)
  WHERE opening_balance;

-- ---------------------------------------------------------------------
-- 3. Tra cứu nhanh khi màn nhập liệu nạp danh sách đang có
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_receivables_opening
  ON receivables (org_id) WHERE opening_balance;
CREATE INDEX IF NOT EXISTS idx_payables_opening
  ON payables (org_id) WHERE opening_balance;

-- ---------------------------------------------------------------------
-- 4. RLS: NVBH không được tạo công nợ đầu kỳ
-- ---------------------------------------------------------------------
-- Policy cũ cho 'sales' chèn receivables (đúng — màn tạo đơn cần thế).
-- Nhưng công nợ đầu kỳ là việc chốt sổ của kế toán: mở cho NVBH nghĩa là
-- một người bán hàng có thể tự ghi cho khách của mình một khoản nợ đầu
-- kỳ. Siết lại đúng một vế, phần còn lại giữ nguyên hành vi cũ (đơn hàng
-- sinh receivable với opening_balance = false nên vẫn qua).
DROP POLICY IF EXISTS "Authorized roles can create receivables" ON receivables;
CREATE POLICY "Authorized roles can create receivables"
  ON receivables FOR INSERT
  WITH CHECK (
    org_id = public.user_org_id()
    AND (
      public.user_role() IN ('owner', 'accountant')
      OR (public.user_role() = 'sales' AND opening_balance = false)
    )
  );

-- Xoá: trước đây KHÔNG có policy DELETE trên receivables, nghĩa là không
-- ai xoá được dòng nào qua RLS. Màn nhập cần xoá được dòng ĐẦU KỲ (điền
-- số 0) — mở đúng phạm vi đó, không mở cho công nợ sinh từ đơn hàng.
DROP POLICY IF EXISTS "Accountant can delete opening receivables" ON receivables;
CREATE POLICY "Accountant can delete opening receivables"
  ON receivables FOR DELETE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'accountant')
    AND opening_balance
  );

-- payables đã có policy "Manage payables" FOR ALL cho owner/accountant —
-- đủ cho cả tạo, sửa lẫn xoá dòng đầu kỳ. Không đụng vào.


-- ####################################################################
-- # 103_customer_photos.sql
-- ####################################################################

-- =====================================================================
-- Migration 103: ảnh điểm bán (tối đa 3) + nhắc nhở cập nhật
-- =====================================================================
-- NVBH thường dựng danh sách điểm bán ở nhà cho nhanh, rồi đi tuyến mới
-- chụp ảnh và lấy toạ độ. Hệ thống phải chịu được trạng thái "có khách
-- nhưng chưa có ảnh / chưa có vị trí" và TỰ NHẮC, chứ không im lặng để
-- danh sách rỗng ảnh nằm đó nhiều tháng.

-- ---------------------------------------------------------------------
-- 1. Bảng ảnh
-- ---------------------------------------------------------------------
-- Bảng riêng chứ không phải 3 cột photo_1/2/3 trên `customers`: mỗi ảnh
-- mang theo THỜI GIAN và TOẠ ĐỘ lúc chụp — đó là bằng chứng "đã tới tận
-- nơi", nhồi vào cột phẳng thì thành 9 cột và không cách nào thêm ảnh
-- thứ tư sau này.
CREATE TABLE IF NOT EXISTS customer_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  -- Ô ảnh 1..3. Trần "tối đa 3 ảnh" được ép bằng CHECK + chỉ mục duy
  -- nhất, KHÔNG bằng trigger đếm: đếm rồi chèn là hai bước, hai người
  -- bấm cùng lúc sẽ lọt ảnh thứ tư. Ràng buộc khai báo thì không lọt.
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 3),

  photo_url text NOT NULL,

  -- Thời điểm CHỤP, do máy của người chụp báo. Khác created_at (lúc ghi
  -- vào DB) — hai cái này lệch nhau khi máy mất mạng lúc ở điểm bán.
  taken_at timestamptz NOT NULL,

  -- Toạ độ lúc chụp. Cho phép NULL: máy từ chối quyền định vị thì vẫn
  -- phải lưu được ảnh, chỉ là ảnh đó không có giá trị làm bằng chứng vị
  -- trí. Để trống còn hơn ghi một toạ độ bịa.
  gps_lat numeric,
  gps_lng numeric,
  /** Sai số máy báo, mét. 5m và 500m là hai chất lượng khác hẳn nhau. */
  gps_accuracy numeric,

  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_photos_slot
  ON customer_photos (customer_id, slot);
CREATE INDEX IF NOT EXISTS idx_customer_photos_customer
  ON customer_photos (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_photos_org
  ON customer_photos (org_id);

-- ---------------------------------------------------------------------
-- 2. Mốc đã nhắc — để cron không nhắc lại mỗi ngày
-- ---------------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS photo_reminder_sent_at timestamptz;

-- ---------------------------------------------------------------------
-- 3. RLS — bám đúng quyền đã có trên `customers`
-- ---------------------------------------------------------------------
ALTER TABLE customer_photos ENABLE ROW LEVEL SECURITY;

-- Nhìn thấy ảnh khi và chỉ khi nhìn thấy khách. Viết bằng EXISTS trên
-- `customers` thay vì chép lại luật vai trò: chép lại là hai bản sao, và
-- bản ở đây sẽ không được sửa cùng lúc khi luật kia đổi.
DROP POLICY IF EXISTS "View customer photos" ON customer_photos;
CREATE POLICY "View customer photos"
  ON customer_photos FOR SELECT
  USING (EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id));

DROP POLICY IF EXISTS "Manage customer photos" ON customer_photos;
CREATE POLICY "Manage customer photos"
  ON customer_photos FOR ALL
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'sales')
    AND EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id)
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'sales')
    AND EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id)
  );

-- ---------------------------------------------------------------------
-- 4. Loại thông báo mới
-- ---------------------------------------------------------------------
-- TRA TÊN RÀNG BUỘC trong pg_constraint, KHÔNG đoán. Tên do Postgres tự
-- sinh (notifications_type_check) chỉ đúng khi CHECK được khai báo inline
-- và chưa ai đổi tên; đoán sai thì lệnh DROP âm thầm không làm gì và
-- CHECK cũ vẫn chặn giá trị mới.
DO $$
DECLARE
  v_name text;
BEGIN
  SELECT con.conname INTO v_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'notifications'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%order_pending_approval%'
  LIMIT 1;

  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I', v_name);
  END IF;

  ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'order_pending_approval',
    'order_approved',
    'order_cancelled',
    'payment_received',
    'receivable_overdue',
    'visit_logged',
    'customer_photo_missing',
    'info'
  ));
EXCEPTION
  WHEN duplicate_object THEN
    -- Chạy lại lần hai: ràng buộc mới đã có tên đó rồi, không sao.
    NULL;
END $$;

-- ---------------------------------------------------------------------
-- 5. Kho ảnh điểm bán
-- ---------------------------------------------------------------------
-- Cùng khuôn với `visit-photos` (mig 014) và `pod-photos` (mig 101).
-- ĐÁNH ĐỔI ĐÃ BIẾT: bucket public, ai có URL đều xem được. Ảnh mặt tiền
-- cửa hàng không phải dữ liệu cá nhân nhạy cảm, và để public thì thẻ
-- khách render thẳng <img src> không cần ký URL tạm.
INSERT INTO storage.buckets (id, name, public)
VALUES ('customer-photos', 'customer-photos', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'customer_photos_insert'
  ) THEN
    CREATE POLICY "customer_photos_insert" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'customer-photos'
        AND (split_part(name, '/', 1))::uuid = public.user_org_id()
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'customer_photos_select'
  ) THEN
    CREATE POLICY "customer_photos_select" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'customer-photos');
  END IF;

  -- CÓ policy DELETE ở đây (khác pod-photos): ảnh điểm bán là dữ liệu
  -- vận hành, chụp mờ / chụp nhầm cửa hàng là chuyện thường và NVBH phải
  -- thay được. Ảnh POD thì không, vì nó là chứng từ giao hàng.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'customer_photos_delete'
  ) THEN
    CREATE POLICY "customer_photos_delete" ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id = 'customer-photos'
        AND (split_part(name, '/', 1))::uuid = public.user_org_id()
      );
  END IF;
END $$;


-- ####################################################################
-- # 104_login_by_phone.sql
-- ####################################################################

-- ====================================================================
-- 104_login_by_phone
--
-- Số điện thoại thành ĐỊNH DANH CHÍNH của nhân viên, thay cho email.
--
-- VÌ SAO
--   Nhân viên bán hàng phần lớn không có email. Bắt họ có một cái chỉ để
--   đăng nhập là dựng thêm một rào cản cho đúng nhóm người dùng nhiều
--   nhất. Số điện thoại thì ai cũng có, và chính họ nhớ.
--
-- VẤN ĐỀ ĐÃ CÓ TỪ 085
--   085 cho phép đăng nhập bằng phone, nhưng so khớp chỉ BỎ KHOẢNG TRẮNG:
--       regexp_replace(u.phone, '\s+', '', 'g') = <người dùng gõ>
--   Nên cùng một số nhập khác dạng là KHÔNG khớp:
--       tạo "0909 123 456"  →  gõ "0909123456"   ✓ (may mắn khớp)
--       tạo "0909.123.456"  →  gõ "0909123456"   ✗ KHÔNG khớp
--       tạo "0909123456"    →  gõ "+84909123456" ✗ KHÔNG khớp
--   Người dùng gõ đúng số của mình mà bị báo sai tài khoản, và không có
--   cách nào tự hiểu vì sao.
--
-- CÁCH LÀM: chuẩn hoá KHI SO, giữ nguyên KHI LƯU
--   `users.phone` vẫn lưu đúng những gì người nhập — để hiển thị, để bấm
--   gọi. Việc so khớp đi qua public.normalize_phone(), và ĐÚNG MỘT hàm đó
--   được dùng cho CẢ chỉ mục duy nhất LẪN RPC đăng nhập. Một định nghĩa,
--   không có bản sao để lệch.
--
--   Bản TS tương ứng: src/lib/users/phone.ts
--   Bộ ca kiểm dùng chung: tests/fixtures/phone-cases.json
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. Chuẩn hoá: chỉ chữ số, luôn bắt đầu bằng '0'.
--    IMMUTABLE để dùng được trong chỉ mục.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_phone(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN d = ''                                  THEN ''
    -- Mã quốc gia: 84909123456 → 0909123456
    WHEN d LIKE '84%' AND length(d) >= 11         THEN '0' || substr(d, 3)
    WHEN d LIKE '0%'                              THEN d
    -- Thiếu số 0 đầu: 909123456 → 0909123456
    WHEN length(d) = 9                            THEN '0' || d
    ELSE d
  END
  FROM (
    SELECT regexp_replace(
             -- Bỏ tiền tố quay số quốc tế trước, rồi mới xét mã quốc gia:
             -- 0084909123456 → 84909123456 → 0909123456
             regexp_replace(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '^00', ''),
             '', ''
           ) AS d
  ) t;
$$;

COMMENT ON FUNCTION public.normalize_phone(text) IS
  'Quy SĐT về một dạng để SO KHỚP (chỉ chữ số, bắt đầu bằng 0). Bản TS: src/lib/users/phone.ts';

-- --------------------------------------------------------------------
-- 2. Trước khi siết chỉ mục: nếu dữ liệu hiện có bị trùng sau khi chuẩn
--    hoá thì DỪNG và NÊU RÕ số nào, thay vì để Postgres ném một lỗi
--    "duplicate key" không nói được ai trùng ai.
-- --------------------------------------------------------------------
DO $$
DECLARE dup text;
BEGIN
  SELECT string_agg(x, '; ') INTO dup FROM (
    SELECT public.normalize_phone(phone) || ' (' || count(*) || ' người)' AS x
    FROM public.users
    WHERE phone IS NOT NULL AND length(trim(phone)) > 0
    GROUP BY public.normalize_phone(phone)
    HAVING count(*) > 1
  ) t;

  IF dup IS NOT NULL THEN
    RAISE EXCEPTION
      'Có SĐT trùng nhau sau khi chuẩn hoá: %. Số điện thoại nay là định danh '
      'đăng nhập nên phải duy nhất — sửa dữ liệu trước rồi chạy lại migration này. '
      'Xem chi tiết: SELECT public.normalize_phone(phone), full_name, role FROM users '
      'WHERE phone IS NOT NULL ORDER BY 1;',
      dup;
  END IF;
END $$;

-- --------------------------------------------------------------------
-- 3. Chỉ mục duy nhất theo DẠNG CHUẨN HOÁ.
--    Chỉ mục cũ (085) chỉ bỏ khoảng trắng nên "0909.123.456" và
--    "0909123456" lọt qua như hai người khác nhau.
-- --------------------------------------------------------------------
DROP INDEX IF EXISTS idx_users_phone_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique
  ON public.users (public.normalize_phone(phone))
  WHERE phone IS NOT NULL AND length(trim(phone)) > 0;

-- --------------------------------------------------------------------
-- 4. RPC đăng nhập: so bằng CÙNG hàm chuẩn hoá đó.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_email_by_identifier(p_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_id    text := lower(trim(coalesce(p_id, '')));
  v_phone text := public.normalize_phone(p_id);
  v_email text;
BEGIN
  IF length(v_id) < 2 THEN RETURN NULL; END IF;

  -- Đã là email thì trả thẳng (vẫn kiểm tồn tại để không trả bừa).
  IF v_id LIKE '%@%' THEN
    SELECT au.email INTO v_email
    FROM auth.users au
    WHERE lower(au.email) = v_id
    LIMIT 1;
    RETURN v_email;
  END IF;

  -- SĐT trước — đây là đường đăng nhập chính của nhân viên.
  IF v_phone <> '' THEN
    SELECT au.email INTO v_email
    FROM public.users u
    JOIN auth.users au ON au.id = u.id
    WHERE u.phone IS NOT NULL
      AND public.normalize_phone(u.phone) = v_phone
    LIMIT 1;
    IF v_email IS NOT NULL THEN RETURN v_email; END IF;
  END IF;

  -- Còn lại: tên tài khoản.
  SELECT au.email INTO v_email
  FROM public.users u
  JOIN auth.users au ON au.id = u.id
  WHERE u.username IS NOT NULL AND lower(u.username) = v_id
  LIMIT 1;

  RETURN v_email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_email_by_identifier(text) TO anon, authenticated;

COMMENT ON FUNCTION public.lookup_email_by_identifier(text) IS
  'Tra email từ SĐT / tên tài khoản / email để đăng nhập. SĐT so theo dạng chuẩn hoá.';


-- ####################################################################
-- # 105_drop_username_login.sql
-- ####################################################################

-- ====================================================================
-- 105_drop_username_login
--
-- Bỏ hẳn `users.username` — định danh đăng nhập thứ ba, nay thừa.
--
-- VÌ SAO BỎ, KHÔNG PHẢI ĐỂ ĐÓ CHO CHẮC
--   Sau 104, số điện thoại là định danh của nhân viên. `username` làm
--   đúng một việc: thêm một cách nữa để cùng một người đăng nhập. Cái giá
--   thì có thật:
--     • một chỉ mục duy nhất nữa phải giữ đồng bộ
--     • một nhánh nữa trong RPC đăng nhập
--     • một ô nữa trên hai màn tạo người dùng — đúng thứ vừa được yêu cầu
--       làm gọn lại
--     • và một câu hỏi cho người vận hành: "nhân viên này đăng nhập bằng
--       số hay bằng tên tài khoản?" — câu hỏi lẽ ra không nên tồn tại
--
--   Bỏ được vì hệ thống CHƯA BÀN GIAO và database vừa reset: không có
--   dòng nào đang dùng cột này. Đây là lúc rẻ nhất để bỏ; để lâu thì nó
--   thành thứ không ai dám động.
--
-- CÒN LẠI HAI ĐƯỜNG ĐĂNG NHẬP
--   • Số điện thoại — nhân viên, và là đường chính.
--   • Email        — CHỈ dành cho tài khoản chủ NPP tạo từ Supabase
--                    Dashboard (xem supabase/bootstrap_owner.sql).
--                    Bỏ nốt vế này là khoá luôn đường vào đầu tiên của
--                    một bản cài mới, nên nó ở lại có chủ đích.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. Chỉ bỏ khi thật sự không còn ai dùng. Có dữ liệu mà vẫn bỏ là xoá
--    âm thầm thứ người ta đang đăng nhập bằng nó.
-- --------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'username'
  ) THEN
    EXECUTE 'SELECT count(*) FROM public.users WHERE username IS NOT NULL AND length(trim(username)) > 0'
      INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION
        'Có % tài khoản đang đặt username — bỏ cột này là họ mất một đường '
        'đăng nhập mà không được báo. Kiểm tra: SELECT full_name, username, phone '
        'FROM users WHERE username IS NOT NULL; Đảm bảo ai cũng có SĐT rồi xoá '
        'username thủ công, sau đó chạy lại migration này.',
        n;
    END IF;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_users_username_unique;
ALTER TABLE public.users DROP COLUMN IF EXISTS username;

-- --------------------------------------------------------------------
-- 2. RPC đăng nhập: chỉ còn SĐT và email.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_email_by_identifier(p_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_id    text := lower(trim(coalesce(p_id, '')));
  v_phone text := public.normalize_phone(p_id);
  v_email text;
BEGIN
  IF length(v_id) < 2 THEN RETURN NULL; END IF;

  -- Chủ NPP đăng nhập bằng email thật (tài khoản tạo từ Dashboard).
  -- Vẫn kiểm tồn tại để không trả về một địa chỉ bất kỳ.
  IF v_id LIKE '%@%' THEN
    SELECT au.email INTO v_email
    FROM auth.users au
    WHERE lower(au.email) = v_id
    LIMIT 1;
    RETURN v_email;
  END IF;

  -- Nhân viên: số điện thoại, so theo dạng chuẩn hoá.
  IF v_phone = '' THEN RETURN NULL; END IF;

  SELECT au.email INTO v_email
  FROM public.users u
  JOIN auth.users au ON au.id = u.id
  WHERE u.phone IS NOT NULL
    AND public.normalize_phone(u.phone) = v_phone
  LIMIT 1;

  RETURN v_email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_email_by_identifier(text) TO anon, authenticated;

COMMENT ON FUNCTION public.lookup_email_by_identifier(text) IS
  'Tra email đăng nhập từ SĐT (nhân viên) hoặc email (chủ NPP). Username đã bỏ ở 105.';


-- ####################################################################
-- # 106_owner_login_by_phone.sql
-- ####################################################################

-- ====================================================================
-- 106_owner_login_by_phone
--
-- Chủ NPP cũng đăng nhập bằng số điện thoại. Bỏ nốt nhánh email.
--
-- SAU MIGRATION NÀY CHỈ CÒN MỘT ĐỊNH DANH
--   Không còn "người này đăng nhập bằng gì" nữa: ai cũng gõ số điện thoại.
--   Email trong auth.users trở thành thuần kỹ thuật — Supabase Auth bắt
--   buộc phải có, hệ thống sinh ra từ chính SĐT, và không ai nhìn thấy.
--
-- ⚠ RỦI RO PHẢI CHẶN
--   Bỏ nhánh email nghĩa là tài khoản nào KHÔNG CÓ SĐT sẽ không còn cách
--   nào đăng nhập — kể cả chủ NPP. Nếu đó là tài khoản duy nhất thì mất
--   luôn quyền vào hệ thống, và không có đường sửa từ giao diện.
--
--   Nên migration này DỪNG nếu còn tài khoản đang hoạt động mà thiếu SĐT,
--   và nêu rõ tên. Sửa xong chạy lại.
-- ====================================================================

DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(full_name || ' (' || role || ')', '; ')
  INTO missing
  FROM public.users
  WHERE coalesce(is_active, true)
    AND (phone IS NULL OR public.normalize_phone(phone) = '');

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Những tài khoản này chưa có số điện thoại: %. Sau migration này, SĐT là '
      'cách đăng nhập DUY NHẤT — họ sẽ không vào được nữa và không sửa được từ '
      'giao diện. Cập nhật SĐT trước: UPDATE public.users SET phone = ''09xxxxxxxx'' '
      'WHERE id = ''...''; rồi chạy lại migration này.',
      missing;
  END IF;
END $$;

-- --------------------------------------------------------------------
-- RPC đăng nhập: CHỈ còn số điện thoại.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_email_by_identifier(p_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_phone text := public.normalize_phone(p_id);
  v_email text;
BEGIN
  -- Không phải số thì thôi. Trả NULL chứ không báo lỗi riêng: client hiện
  -- một câu chung "sai số hoặc mật khẩu", để người ngoài không dò được số
  -- nào đang tồn tại trong hệ thống.
  IF v_phone = '' THEN RETURN NULL; END IF;

  SELECT au.email INTO v_email
  FROM public.users u
  JOIN auth.users au ON au.id = u.id
  WHERE u.phone IS NOT NULL
    AND public.normalize_phone(u.phone) = v_phone
  LIMIT 1;

  RETURN v_email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_email_by_identifier(text) TO anon, authenticated;

COMMENT ON FUNCTION public.lookup_email_by_identifier(text) IS
  'Tra email kỹ thuật từ SĐT để đăng nhập. SĐT là định danh DUY NHẤT (106).';


-- ####################################################################
-- # 107_fifo_one_ledger.sql
-- ####################################################################

-- ====================================================================
-- 107 — FIFO: MỘT sổ kho duy nhất, và trừ tồn lúc ghi sổ phiếu xuất
-- ====================================================================
--
-- TRẠNG THÁI TRƯỚC MIGRATION NÀY (đã đọc mã, đã đo)
--
-- 1. Có HAI sổ kho song song:
--      • `batches.qty_on_hand` — sổ thật. Mọi màn hình nhập, kiểm kê,
--        trả hàng, bàn giao đều ghi vào đây.
--      • `fifo_layers` — sổ thứ hai. Chỉ được ghi ở đúng một nhánh (nhận
--        hàng chưa dùng về từ tài xế, mig 047/051/057), và ba hàm gọi
--        nó trong mã ứng dụng (`createFifoLayer`, `consumeFifoLayers`,
--        `getStockValue`) KHÔNG có chỗ nào gọi tới — chỉ bộ test gọi.
--
--    Hai sổ thì sẽ lệch. Và view `v_stock_balance_by_zone` lại ưu tiên
--    đọc sổ thứ hai, nên đúng những sản phẩm từng đi qua nhánh bàn giao
--    sẽ báo giá trị tồn theo một cuốn sổ không ai cập nhật. Migration
--    098 đã vá phần ngọn (coi giá vốn 0 là "chưa biết"); đây là phần gốc.
--
-- 2. Tồn kho chỉ bị trừ ở ĐÚNG MỘT nút: "Tự giao hàng" (sổ lỗi NPP-01).
--    Đơn giao qua tài xế đạt trạng thái đã giao mà tồn kho giữ nguyên →
--    tồn cao hơn thật, giá vốn không được ghi, lãi gộp ra 100%.
--
-- QUYẾT ĐỊNH NGHIỆP VỤ (chủ NPP chốt)
--   • Thứ tự xuất: FIFO — lô nhập trước xuất trước.
--   • Trừ tồn: lúc GHI SỔ PHIẾU XUẤT. Hàng rời kho là trừ. Hàng tài xế
--     mang về được nhập lại bằng phiếu bàn giao — vòng khép kín, đúng
--     như RPC bàn giao vốn đã giả định.
--
-- ⚠ ĐÁNH ĐỔI ĐÃ BIẾT CỦA FIFO: lô cận hạn có thể nằm lại trong kho, vì
--   lô nhập sau đôi khi có hạn gần hơn lô nhập trước. RPC dưới đây đếm
--   số lần điều đó xảy ra và trả về (`near_expiry_skipped`) để màn hình
--   cảnh báo — không tự đổi thứ tự, vì thứ tự là việc của người quyết.
--
-- LÀM GÌ
--   1. Nới kiểu số lượng lô: integer → numeric. Đơn vị cơ bản có thể lẻ.
--   2. Thêm `batches.received_at` — thời điểm hàng VÀO kho. Đây là khoá
--      thứ tự của FIFO, và nó phải BẤT BIẾN.
--   3. RPC `post_stock_export()` — nguyên tử, chống trừ hai lần.
--   4. View giá trị tồn đọc thẳng `batches`, bỏ nhánh sổ thứ hai.
--   5. Bỏ `fifo_layers` / `fifo_consumptions` / `fifo_consume()`, và gỡ
--      lệnh ghi sổ thứ hai khỏi RPC bàn giao.
-- ====================================================================

-- --------------------------------------------------------------------
-- 0. Gỡ view trước khi đổi kiểu cột
-- --------------------------------------------------------------------
-- Postgres từ chối `ALTER COLUMN … TYPE` khi còn view đọc cột đó
-- ("cannot alter type of a column used by a view or rule"). View được
-- dựng lại ở mục 4 — cùng migration, nên không có khoảng nào nó biến mất
-- khỏi hệ thống.
DROP VIEW IF EXISTS v_stock_balance_by_zone;

-- --------------------------------------------------------------------
-- 1. Số lượng lô: integer → numeric
-- --------------------------------------------------------------------
-- `qty_on_hand integer` (mig 001) làm tròn mọi số lẻ khi ghi. Một thùng
-- 24 lon chia ra thì còn đếm được, nhưng 1,5 lít dầu hay 0,5 kg thì
-- không — và phép làm tròn đó KHÔNG báo lỗi. FIFO còn cắt lô làm đôi khi
-- một dòng xuất ăn hết lô này sang lô kia, nên phần dư càng phải giữ
-- đúng. `stock_entry_lines.qty_in_base_uom` đã là numeric(18,6) từ mig
-- 039; hai bên phải cùng kiểu thì cộng trừ mới khớp.
ALTER TABLE batches
  ALTER COLUMN qty_on_hand TYPE numeric(18, 6),
  ALTER COLUMN qty_initial TYPE numeric(18, 6);

-- --------------------------------------------------------------------
-- 2. `received_at` — khoá thứ tự FIFO
-- --------------------------------------------------------------------
-- VÌ SAO KHÔNG DÙNG `created_at`: phiếu tồn ĐẦU KỲ được ghi lùi ngày
-- (chốt sổ 31/12) nhưng dòng lô thì tạo ra hôm nay. Xếp theo `created_at`
-- thì hàng tồn đầu kỳ nằm SAU hàng nhập trong tuần — FIFO lấy ngược, và
-- hàng cũ nhất nằm lại trong kho mãi mãi.
--
-- Khoá thứ tự phải BẤT BIẾN: một lô đã vào sổ thì vị trí của nó trong
-- hàng đợi FIFO không được đổi về sau, kể cả khi có người sửa lại phiếu.
ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS received_at timestamptz;

COMMENT ON COLUMN batches.received_at IS
  'Thời điểm hàng vào kho — khoá thứ tự FIFO. Lấy từ posted_at của phiếu '
  'nhập đã tạo ra lô (nên phiếu ghi lùi ngày xếp đúng chỗ), không phải '
  'lúc dòng được tạo.';

-- Bù cho dữ liệu cũ: lấy `posted_at` của phiếu nhập đã tạo ra lô. Không
-- tra ra phiếu nào thì lùi về `created_at` — chưa chắc đúng tuyệt đối,
-- nhưng đó là mốc duy nhất còn lại, và nó không tệ hơn thứ tự hiện tại.
UPDATE batches b
SET received_at = COALESCE(
  (
    SELECT MIN(se.posted_at)
    FROM stock_entry_lines sel
    JOIN stock_entries se ON se.id = sel.entry_id
    WHERE sel.batch_id = b.id
      AND se.type = 'import'
      AND se.status = 'posted'
  ),
  b.created_at,
  now()
)
WHERE b.received_at IS NULL;

ALTER TABLE batches
  ALTER COLUMN received_at SET DEFAULT now();

-- Lô mới mà quên truyền `received_at` thì DEFAULT now() lo. Nhưng dòng
-- cũ vừa bù xong có thể vẫn NULL nếu created_at cũng NULL — chặn hẳn,
-- vì một lô không có chỗ đứng trong hàng đợi FIFO sẽ bị bỏ qua vĩnh viễn
-- và nằm lại trong kho mà không ai hiểu vì sao.
UPDATE batches SET received_at = now() WHERE received_at IS NULL;
ALTER TABLE batches ALTER COLUMN received_at SET NOT NULL;

-- Chỉ mục phục vụ đúng câu FIFO ở RPC dưới.
CREATE INDEX IF NOT EXISTS idx_batches_fifo
  ON batches (org_id, product_id, received_at, created_at, id)
  WHERE qty_on_hand > 0;

-- --------------------------------------------------------------------
-- 3. RPC ghi sổ phiếu xuất
-- --------------------------------------------------------------------
-- VÌ SAO LÀ RPC CHỨ KHÔNG PHẢI VÒNG LẶP Ở TRÌNH DUYỆT
--   Mã cũ trừ tồn bằng nhiều lệnh update rời từ trình duyệt. Bấm hai lần,
--   hoặc mạng chập rồi bấm lại, là trừ HAI LẦN — và trừ hai lần thì
--   không có cách nào dò ngược ra được. Ở đây cả việc khoá phiếu, trừ
--   tồn, đóng giá vốn và đổi trạng thái nằm trong MỘT giao dịch; phiếu
--   đã ghi sổ thì lần gọi sau không làm gì cả.
CREATE OR REPLACE FUNCTION post_stock_export(p_entry_id uuid)
RETURNS TABLE (
  posted boolean,
  total_cost numeric,
  short_qty numeric,
  near_expiry_skipped int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org             uuid;
  v_status          text;
  v_type            text;
  v_allow_oversell  boolean;
  v_total_cost      numeric := 0;
  v_short           numeric := 0;
  v_near            int     := 0;
  l                 record;
  b                 record;
  v_remaining       numeric;
  v_take            numeric;
  v_cost_sum        numeric;
  v_qty_taken       numeric;
  v_best_id         uuid;
  v_best_qty        numeric;
  v_detail          text;
  v_lots            int;
  v_min_expiry      date;
  v_prod_name       text;
BEGIN
  -- Khoá phiếu TRƯỚC khi đọc trạng thái. Đọc rồi mới khoá thì hai lượt
  -- chạy song song đều thấy 'draft' và cùng đi tiếp.
  SELECT org_id, status, type
    INTO v_org, v_status, v_type
  FROM stock_entries
  WHERE id = p_entry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTRY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF v_type <> 'export' THEN
    RAISE EXCEPTION 'NOT_AN_EXPORT: phiếu % không phải phiếu xuất', v_type
      USING ERRCODE = 'P0001';
  END IF;

  -- Đã ghi sổ rồi thì KHÔNG làm gì. Đây là lá chắn chống trừ hai lần:
  -- trả về posted = false để nơi gọi biết là không có gì xảy ra, chứ
  -- không phải báo lỗi — bấm lại lần nữa là chuyện bình thường.
  IF v_status <> 'draft' THEN
    RETURN QUERY SELECT false, 0::numeric, 0::numeric, 0;
    RETURN;
  END IF;

  SELECT COALESCE(allow_oversell, false) INTO v_allow_oversell
  FROM organizations WHERE id = v_org;

  FOR l IN
    SELECT sel.id,
           sel.product_id,
           sel.notes,
           COALESCE(sel.qty_in_base_uom, sel.quantity, 0)::numeric AS need
    FROM stock_entry_lines sel
    WHERE sel.entry_id = p_entry_id
    ORDER BY sel.id
  LOOP
    CONTINUE WHEN l.need <= 0;

    v_remaining := l.need;
    v_cost_sum  := 0;
    v_qty_taken := 0;
    v_best_id   := NULL;
    v_best_qty  := 0;
    v_detail    := '';
    v_lots      := 0;

    -- Hạn gần nhất đang có, đo TRƯỚC khi trừ. Dùng để biết FIFO có bỏ
    -- qua lô cận hạn hơn không.
    SELECT MIN(expires_at) INTO v_min_expiry
    FROM batches
    WHERE org_id = v_org AND product_id = l.product_id AND qty_on_hand > 0;

    FOR b IN
      SELECT id, qty_on_hand, unit_cost, batch_code, expires_at
      FROM batches
      WHERE org_id = v_org
        AND product_id = l.product_id
        AND qty_on_hand > 0
      -- FIFO: hàng vào kho trước đi trước. `created_at` và `id` chỉ để
      -- hai lô cùng mốc vẫn có thứ tự cố định — không có chúng thì thứ
      -- tự do Postgres tự chọn, và mỗi lần chạy lại một khác.
      ORDER BY received_at ASC, created_at ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_take := LEAST(b.qty_on_hand, v_remaining);

      UPDATE batches
      SET qty_on_hand = qty_on_hand - v_take
      WHERE id = b.id;

      v_cost_sum  := v_cost_sum + v_take * COALESCE(b.unit_cost, 0);
      v_qty_taken := v_qty_taken + v_take;
      v_remaining := v_remaining - v_take;
      v_lots      := v_lots + 1;

      IF v_take > v_best_qty THEN
        v_best_qty := v_take;
        v_best_id  := b.id;
      END IF;

      v_detail := v_detail
        || CASE WHEN v_detail = '' THEN '' ELSE ', ' END
        || COALESCE(b.batch_code, left(b.id::text, 8)) || '×' || v_take::text;

      -- Lấy một lô có hạn XA HƠN lô gần hạn nhất đang nằm trong kho:
      -- đúng cái giá phải trả của FIFO. Đếm lại để màn hình nói ra.
      IF v_min_expiry IS NOT NULL AND b.expires_at > v_min_expiry THEN
        v_near := v_near + 1;
      END IF;
    END LOOP;

    IF v_remaining > 0 THEN
      IF NOT v_allow_oversell THEN
        SELECT name INTO v_prod_name FROM products WHERE id = l.product_id;
        RAISE EXCEPTION
          'INSUFFICIENT_STOCK: thiếu % đơn vị của "%" — ghi sổ phiếu xuất sẽ làm tồn kho âm',
          v_remaining, COALESCE(v_prod_name, l.product_id::text)
          USING ERRCODE = 'P0001';
      END IF;
      -- Cho phép bán âm thì vẫn ghi sổ, nhưng cộng dồn để trả về. Im
      -- lặng ở đây là để người ta phát hiện ra vào lúc kiểm kê.
      v_short := v_short + v_remaining;
    END IF;

    -- Đóng giá vốn lên dòng. `batch_id` là khoá đơn nên chỉ giữ được MỘT
    -- lô — ghi lô lấy nhiều nhất, và ghi đủ danh sách vào notes để còn
    -- truy ngược được hạn dùng của hàng đã bán (hàng FMCG cần điều đó).
    UPDATE stock_entry_lines
    SET unit_cost = CASE WHEN v_qty_taken > 0
                         THEN v_cost_sum / v_qty_taken
                         ELSE unit_cost END,
        batch_id  = COALESCE(v_best_id, batch_id),
        notes     = CASE
                      WHEN v_lots > 1
                      THEN trim(both ' •' from COALESCE(l.notes, '')) ||
                           CASE WHEN COALESCE(l.notes, '') = '' THEN '' ELSE ' • ' END ||
                           'Lô: ' || v_detail
                      ELSE notes
                    END
    WHERE id = l.id;

    v_total_cost := v_total_cost + v_cost_sum;
  END LOOP;

  UPDATE stock_entries
  SET status = 'posted',
      posted_at = COALESCE(posted_at, now())
  WHERE id = p_entry_id;

  RETURN QUERY SELECT true, v_total_cost, v_short, v_near;
END;
$$;

COMMENT ON FUNCTION post_stock_export(uuid) IS
  'Ghi sổ phiếu xuất: trừ tồn theo FIFO (received_at), đóng giá vốn lên '
  'từng dòng, đổi trạng thái sang posted. Nguyên tử và chống trừ hai lần '
  '— phiếu đã ghi sổ thì trả về posted = false và không làm gì.';

REVOKE EXECUTE ON FUNCTION post_stock_export(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION post_stock_export(uuid) TO authenticated;

-- --------------------------------------------------------------------
-- 4. View giá trị tồn đọc thẳng `batches`
-- --------------------------------------------------------------------
-- Bỏ hẳn nhánh đọc `fifo_layers`. Mig 098 phải thêm `NULLIF(…, 0)` chỉ
-- vì nhánh đó tồn tại; bỏ nguồn thứ hai đi thì mẹo ấy cũng không cần
-- nữa, và con số chỉ còn MỘT chỗ để sai.
DROP VIEW IF EXISTS v_stock_balance_by_zone;

CREATE VIEW v_stock_balance_by_zone AS
SELECT
  b.org_id,
  b.product_id,
  COALESCE(b.warehouse_zone, 'sale') AS warehouse_zone,
  SUM(b.qty_on_hand)::numeric AS qty_in_base_uom,
  SUM(b.qty_on_hand * COALESCE(b.unit_cost, 0))::numeric AS value
FROM batches b
WHERE b.qty_on_hand > 0
GROUP BY b.org_id, b.product_id, COALESCE(b.warehouse_zone, 'sale');

-- Mig 092 bật security_invoker để RLS vẫn áp dụng. DROP + CREATE làm mất
-- thuộc tính đó — bỏ quên là mở toàn bộ số liệu tồn kho cho mọi vai trò
-- mà không có lỗi nào báo ra.
ALTER VIEW v_stock_balance_by_zone SET (security_invoker = true);

COMMENT ON VIEW v_stock_balance_by_zone IS
  'Số lượng và giá trị tồn theo (sản phẩm, khu kho). Đọc thẳng batches — '
  'từ mig 107 batches là sổ kho DUY NHẤT.';

GRANT SELECT ON v_stock_balance_by_zone TO authenticated;

-- --------------------------------------------------------------------
-- 5. Gỡ sổ thứ hai
-- --------------------------------------------------------------------
-- RPC bàn giao đã cộng thẳng `batches.qty_on_hand` ngay phía trên lệnh
-- ghi `fifo_layers`, nên bỏ lệnh đó đi không mất số liệu nào — chỉ bỏ
-- một bản sao. Chép lại nguyên văn mig 057, trừ đúng khối ấy.
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
    RETURN;
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  UPDATE sales_orders so
  SET status = 'cancelled',
      current_workflow_stage = 'delivery_failed'
  FROM driver_handover_failed_orders dhfo
  WHERE dhfo.handover_id = p_handover_id
    AND dhfo.order_id    = so.id;

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

    FOR r IN
      SELECT dhi.*, p.base_unit
      FROM driver_handover_items dhi
      JOIN products p ON p.id = dhi.product_id
      WHERE dhi.handover_id = p_handover_id
    LOOP
      SELECT id INTO v_batch_id
      FROM batches
      WHERE org_id = v_org
        AND product_id = r.product_id
        AND COALESCE(warehouse_zone, 'sale') = r.destination_zone
      ORDER BY created_at DESC
      LIMIT 1;

      IF v_batch_id IS NULL THEN
        INSERT INTO batches (
          org_id, product_id, batch_code, expires_at, warehouse_zone,
          qty_initial, qty_on_hand, unit_cost, received_at
        ) VALUES (
          v_org, r.product_id,
          'BG-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS')
            || '-' || left(r.product_id::text, 4),
          '2099-12-31',
          r.destination_zone,
          0, 0, COALESCE(r.unit_cost, 0),
          -- Hàng quay lại kho: mốc FIFO là LÚC NÀY, không phải lúc nhập
          -- lần đầu. Nó vừa đi một vòng, nên xếp cuối hàng đợi là đúng.
          now()
        )
        RETURNING id INTO v_batch_id;
      END IF;

      INSERT INTO stock_entry_lines (
        entry_id, product_id, batch_id, unit_name,
        quantity, qty_in_base_uom, qty_in_transaction_uom,
        transaction_uom, conversion_factor_snapshot, unit_cost
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

      UPDATE batches
      SET qty_on_hand = qty_on_hand + r.qty_in_base_uom,
          qty_initial = qty_initial + r.qty_in_base_uom
      WHERE id = v_batch_id;

      -- [107] Ở đây từng có thêm một lệnh ghi `fifo_layers`. Đã bỏ:
      -- `batches` ngay phía trên đã là sổ kho, bản sao thứ hai chỉ tạo
      -- chỗ cho hai con số lệch nhau.

      IF r.source_type = 'unused_swap_stock' AND r.swap_movement_id IS NOT NULL THEN
        UPDATE swap_stock_movements
        SET qty_returned_in_base_uom = qty_returned_in_base_uom + r.qty_in_base_uom
        WHERE id = r.swap_movement_id;
      END IF;
    END LOOP;
  END IF;

  UPDATE driver_handovers
  SET status = 'confirmed',
      confirmed_at = now()
  WHERE id = p_handover_id;

  UPDATE deliveries
  SET status = 'completed',
      completed_at = COALESCE(completed_at, now())
  WHERE id = v_delivery;
END;
$$;

REVOKE EXECUTE ON FUNCTION confirm_driver_handover(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confirm_driver_handover(uuid) TO authenticated;

-- Giờ mới bỏ được: không còn ai đọc, không còn ai ghi.
DROP FUNCTION IF EXISTS fifo_consume(uuid, uuid, text, numeric, uuid);
DROP TABLE IF EXISTS fifo_consumptions;
DROP TABLE IF EXISTS fifo_layers;


-- ####################################################################
-- # 108_default_vat_8.sql
-- ####################################################################

-- ====================================================================
-- 108 — Thuế VAT mặc định của sản phẩm: 10% → 8%
-- ====================================================================
--
-- `products.vat_rate` để mặc định 0.1 từ mig 001. Phần lớn hàng FMCG đang
-- chịu 8%, nên mặc định cũ khiến mỗi sản phẩm mới phải sửa tay một lần —
-- và sửa tay thì có lần quên.
--
-- ⚠ CHỈ ĐỔI MẶC ĐỊNH CHO DÒNG MỚI. Không đụng một dòng nào đang có.
--
-- Cám dỗ ở đây là chạy luôn `UPDATE products SET vat_rate = 0.08`. Không
-- làm, vì không phân biệt được hai trường hợp:
--   • sản phẩm nhập từ file KHÔNG có cột thuế → nhận 10% do mặc định cũ,
--     đúng là nên đổi;
--   • sản phẩm người ta CỐ Ý khai 10% (vẫn còn mặt hàng chịu 10%), đổi đi
--     là ghi đè số người ta nhập tay.
--
-- Hai trường hợp đó nhìn giống hệt nhau trong cơ sở dữ liệu. Muốn đổi
-- hàng loạt thì xem hai câu ở cuối file: câu thứ nhất ĐẾM xem đang có
-- bao nhiêu, câu thứ hai mới đổi — và chạy tay sau khi đã nhìn con số.
-- ====================================================================

ALTER TABLE products
  ALTER COLUMN vat_rate SET DEFAULT 0.08;

COMMENT ON COLUMN products.vat_rate IS
  'Thuế suất VAT, lưu dạng tỉ lệ (0.08 = 8%). Mặc định 0.08 từ mig 108. '
  'Giá trị đồng bộ với DEFAULT_VAT_RATE trong src/lib/constants.ts.';

-- --------------------------------------------------------------------
-- KHÔNG PHẢI PHẦN CỦA MIGRATION — hai câu để chạy tay nếu muốn
-- --------------------------------------------------------------------
--
-- 1) Xem đang có bao nhiêu sản phẩm ở mỗi mức thuế:
--
--      SELECT vat_rate, count(*) AS so_san_pham
--      FROM products
--      GROUP BY vat_rate
--      ORDER BY vat_rate;
--
-- 2) Nếu con số ở trên cho thấy TẤT CẢ đang là 0.1 do mặc định cũ (tức
--    là file nhập không có cột thuế), và ta muốn chuyển hết sang 8%:
--
--      UPDATE products SET vat_rate = 0.08 WHERE vat_rate = 0.1;
--
--    Chỉ chạy khi đã nhìn kết quả câu 1 và chắc rằng trong đó không có
--    mặt hàng nào cố ý để 10%.


-- ####################################################################
-- # 109_set_all_products_vat_8.sql
-- ####################################################################

-- ====================================================================
-- 109 — Đổi TẤT CẢ sản phẩm đang có về thuế VAT 8%
-- ====================================================================
--
-- Mig 108 cố ý KHÔNG làm việc này: nó chỉ đổi mặc định cho dòng mới, vì
-- một sản phẩm đang để 10% có thể là do mặc định cũ (nên đổi) hoặc do
-- người ta cố ý khai (không được đổi), và hai trường hợp đó nhìn giống
-- hệt nhau trong cơ sở dữ liệu.
--
-- Chủ NPP đã nghe điều đó và quyết: đổi hết. Migration này ghi lại quyết
-- định ấy thành một bước có thể chạy lại và lần ra được, thay vì một câu
-- SQL gõ tay trong SQL Editor rồi không ai nhớ đã chạy chưa.
--
-- ⚠ ĐỔI HẾT NGHĨA LÀ ĐỔI CẢ HÀNG ĐANG ĐỂ 0%. Nếu trong danh mục có mặt
--   hàng không chịu thuế, nó cũng bị kéo lên 8%. Phần NOTICE dưới đây in
--   ra bảng phân bố TRƯỚC khi đổi, nên nhìn log là biết có bao nhiêu dòng
--   0% vừa bị động tới và đưa lại được.
--
-- CHỈ ĐỤNG BẢNG `products`. Đơn hàng, hoá đơn mua, phiếu trả đều ĐÓNG
-- thuế suất lên từng dòng lúc lập (order-form.tsx gọi `snapVat(...)`),
-- nên chứng từ cũ giữ nguyên con số của ngày lập — đúng như phải thế.
-- Thay đổi này chỉ ảnh hưởng chứng từ lập TỪ NAY.
-- ====================================================================

DO $$
DECLARE
  r       record;
  v_moved int;
BEGIN
  RAISE NOTICE '--- Thuế VAT TRƯỚC khi đổi ---';
  FOR r IN
    SELECT COALESCE(vat_rate::text, '(trống)') AS muc, count(*) AS so_dong
    FROM products
    GROUP BY vat_rate
    ORDER BY vat_rate NULLS FIRST
  LOOP
    RAISE NOTICE '  % → % sản phẩm', r.muc, r.so_dong;
  END LOOP;

  -- `IS DISTINCT FROM` chứ không phải `<> 0.08`.
  --
  -- ⚠ Sản phẩm có vat_rate RỖNG thì `vat_rate <> 0.08` trả về NULL, không
  -- phải TRUE — dòng đó bị bỏ qua, im lặng, và vẫn rỗng sau khi chạy.
  -- Cột này cho phép rỗng (mig 001 chỉ đặt DEFAULT, không NOT NULL), nên
  -- đây là ca có thật chứ không phải lo xa.
  UPDATE products SET vat_rate = 0.08
  WHERE vat_rate IS DISTINCT FROM 0.08;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  RAISE NOTICE '--- Đã đổi % sản phẩm về 8%% ---', v_moved;

  -- Chốt chặn: sau khi chạy thì không được còn dòng nào khác 8%. Nếu còn,
  -- có thứ gì đó đang ghi đè (trigger, quy tắc) và phải biết ngay, chứ
  -- không phải phát hiện vào lúc xuất hoá đơn.
  IF EXISTS (SELECT 1 FROM products WHERE vat_rate IS DISTINCT FROM 0.08) THEN
    RAISE EXCEPTION 'Vẫn còn sản phẩm khác 8%% sau khi cập nhật — dừng, chưa ghi gì.';
  END IF;
END $$;


-- ####################################################################
-- # 110_default_vat_0.sql
-- ####################################################################

-- ====================================================================
-- 110 — Thuế VAT mặc định của sản phẩm: 8% → 0%
-- ====================================================================
--
-- Mig 108 đổi mặc định từ 10% sang 8%. Chủ NPP chốt lại: hàng ở đây xuất
-- KHÔNG kèm VAT, nên 0 mới là con số đúng — để 8% là bắt người ta sửa tay
-- mỗi lần tạo sản phẩm, mà sửa tay thì có lần quên.
--
-- ⚠ 0 Ở ĐÂY LÀ MỘT LỰA CHỌN, KHÔNG PHẢI CHỖ CHƯA ĐIỀN.
--
-- Mã nguồn từng có một phép kiểm mang tên "VAT trống thì mặc định 8%,
-- không phải 0", lý do ghi kèm là "mặc định 0 sẽ làm mọi hoá đơn thiếu
-- thuế". Phép kiểm ấy đã được đổi có chủ ý, không phải bị bỏ quên. Ghi
-- lại ở đây để người sau đọc migration đừng "sửa" nó về 8%.
--
-- Mặt hàng nào có chịu thuế thì khai trên chính sản phẩm đó — mặc định
-- chỉ là điểm xuất phát cho dòng mới.
--
-- ⚠ CHỈ ĐỔI MẶC ĐỊNH CHO DÒNG MỚI. Không đụng sản phẩm đang có. Mig 109
-- vừa đặt toàn bộ danh mục về 8%; muốn kéo cả danh mục về 0% thì đó là
-- một bước RIÊNG, có in ra số dòng bị động tới — xem mig 109 để biết
-- khuôn mẫu, đừng gộp vào đây.
--
-- KHÔNG đụng `purchase_orders` (mặc định 0.1). Đó là thuế ĐẦU VÀO do nhà
-- cung cấp thu, không phải thuế mình xuất ra — hai con số khác nhau và
-- không có lý do để đi cùng nhau.
-- ====================================================================

ALTER TABLE products
  ALTER COLUMN vat_rate SET DEFAULT 0;

COMMENT ON COLUMN products.vat_rate IS
  'Thuế suất VAT, lưu dạng tỉ lệ (0 = 0%, 0.08 = 8%). Mặc định 0 từ mig '
  '110 — hàng xuất không kèm VAT; mặt hàng nào chịu thuế thì khai riêng '
  'trên sản phẩm đó. Đồng bộ với DEFAULT_VAT_RATE trong '
  'src/lib/constants.ts.';


-- ####################################################################
-- # 111_set_all_products_vat_0.sql
-- ####################################################################

-- ====================================================================
-- 111 — Đổi TẤT CẢ sản phẩm đang có về thuế VAT 0%
-- ====================================================================
--
-- Cùng khuôn mẫu với mig 109, chỉ khác con số đích.
--
-- VÌ SAO CÓ CẢ 109 LẪN 111
--   109 đặt toàn bộ danh mục về 8%; ngay sau đó chủ NPP chốt lại là hàng
--   ở đây xuất KHÔNG kèm VAT, nên phải về 0%. Không sửa 109 và cũng không
--   xoá nó: migration là LỊCH SỬ, và hai máy đã chạy 109 rồi thì sửa file
--   cũ chỉ tạo ra lệch trạng thái. Chạy 109 xong rồi 111 hơi thừa một
--   nhịp nhưng ra đúng kết quả, và đọc lại là hiểu chuyện gì đã xảy ra.
--
-- ⚠ CÁI NÀY XOÁ THÔNG TIN. Sau khi chạy, không còn cách nào biết sản phẩm
--   nào từng ở 5% hay 10% — mig 109 đã gộp hết về 8% trước đó rồi. Đây là
--   quyết định của chủ NPP, ghi lại để khỏi ai tưởng là tai nạn.
--
-- CHỈ ĐỤNG BẢNG `products`. Đơn hàng, hoá đơn mua, phiếu trả đều ĐÓNG
-- thuế suất lên từng dòng lúc lập (order-form gọi `snapVat`), nên chứng
-- từ cũ giữ nguyên con số của ngày lập. Thay đổi này chỉ ảnh hưởng chứng
-- từ lập TỪ NAY.
-- ====================================================================

DO $$
DECLARE
  r       record;
  v_moved int;
BEGIN
  RAISE NOTICE '--- Thuế VAT TRƯỚC khi đổi ---';
  FOR r IN
    SELECT COALESCE(vat_rate::text, '(trống)') AS muc, count(*) AS so_dong
    FROM products
    GROUP BY vat_rate
    ORDER BY vat_rate NULLS FIRST
  LOOP
    RAISE NOTICE '  % → % sản phẩm', r.muc, r.so_dong;
  END LOOP;

  -- `IS DISTINCT FROM` chứ không phải `<> 0`.
  --
  -- ⚠ Sản phẩm có vat_rate RỖNG thì `vat_rate <> 0` trả về NULL, không
  -- phải TRUE — dòng đó bị bỏ qua, im lặng, và vẫn rỗng sau khi chạy. Cột
  -- này cho phép rỗng (mig 001 chỉ đặt DEFAULT, không NOT NULL) nên đây
  -- là ca có thật. Và rỗng KHÁC 0: rỗng là "chưa khai", 0 là "khai rằng
  -- không chịu thuế" — hai thứ đó không được lẫn vào nhau.
  UPDATE products SET vat_rate = 0
  WHERE vat_rate IS DISTINCT FROM 0;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  RAISE NOTICE '--- Đã đổi % sản phẩm về 0%% ---', v_moved;

  -- Chốt chặn: sau khi chạy không được còn dòng nào khác 0. Còn sót nghĩa
  -- là có thứ gì đó ghi đè (trigger, quy tắc) và phải biết ngay, chứ
  -- không phải phát hiện vào lúc xuất hoá đơn cho khách.
  IF EXISTS (SELECT 1 FROM products WHERE vat_rate IS DISTINCT FROM 0) THEN
    RAISE EXCEPTION 'Vẫn còn sản phẩm khác 0%% sau khi cập nhật — dừng, chưa ghi gì.';
  END IF;
END $$;


-- ####################################################################
-- # 112_backfill_customer_creator.sql
-- ####################################################################

-- ====================================================================
-- 112 — Bù "ai tạo" và "ai phụ trách" cho điểm bán cũ
-- ====================================================================
--
-- HAI LỖ HỔNG ĐÃ TẠO RA DỮ LIỆU TRỐNG
--
--   1. Màn NHẬP KHÁCH HÀNG LOẠT không đóng dấu `created_by`. Mà đó lại là
--      đường vào của phần lớn dữ liệu — nên gần như mọi điểm bán nhập từ
--      Excel đều "không rõ ai tạo". (Đã sửa ở mã nguồn.)
--   2. Màn TẠO TỪNG KHÁCH có đóng dấu `created_by` nhưng không tạo dòng
--      phân công. (Đã sửa ở mã nguồn.)
--
-- Migration này bù lại cho dữ liệu ĐÃ CÓ, theo hai chiều.
--
-- ⚠ NÓ KHÔNG BÙ ĐƯỢC HẾT, VÀ CỐ Ý KHÔNG ĐOÁN.
--
--   Điểm bán vừa không có `created_by` vừa không có ai phụ trách thì
--   trong cơ sở dữ liệu KHÔNG còn dấu vết nào để lần ra người tạo. Gán
--   bừa cho chủ NPP hay cho NVBH gần nhất là dựng ra một sự thật chưa
--   từng có. Phần NOTICE ở cuối đếm đúng số điểm bán như vậy để biết còn
--   bao nhiêu phải phân công tay.
-- ====================================================================

DO $$
DECLARE
  v_n1 int;
  v_n2 int;
  v_con int;
BEGIN
  -- ------------------------------------------------------------------
  -- Chiều 1: có người phụ trách → suy ra người tạo
  -- ------------------------------------------------------------------
  -- Cùng phép bù mig 032 đã làm, chạy lại cho những dòng thêm vào SAU
  -- lần đó. Lấy người phụ trách ĐẦU TIÊN theo ngày phân công.
  --
  -- ⚠ Chỉ điền vào ô đang TRỐNG. Đè lên `created_by` đang có giá trị là
  -- xoá mất một sự thật để thay bằng một phép suy đoán.
  WITH first_assignment AS (
    SELECT DISTINCT ON (customer_id) customer_id, user_id
    FROM customer_assignments
    WHERE status = 'active'
    ORDER BY customer_id, assigned_at NULLS LAST, id
  )
  UPDATE customers c
  SET created_by = fa.user_id
  FROM first_assignment fa
  WHERE c.id = fa.customer_id
    AND c.created_by IS NULL;
  GET DIAGNOSTICS v_n1 = ROW_COUNT;
  RAISE NOTICE 'Bù người tạo từ người phụ trách: % điểm bán', v_n1;

  -- ------------------------------------------------------------------
  -- Chiều 2: có người tạo là NVBH → phân công cho họ
  -- ------------------------------------------------------------------
  -- ⚠ CHỈ khi người tạo là vai trò `sales`, và ĐÚNG như quy tắc ở màn tạo
  -- mới (src/lib/customers/assign-creator.ts). Chủ NPP nhập liệu hành
  -- chính không phải là người đi tuyến — gán họ ghế 'primary' thì NVBH
  -- thật về sau chỉ còn ghế phụ.
  --
  -- ⚠ Và chỉ khi điểm bán CHƯA có ai phụ trách. Chen thêm một người vào
  -- điểm bán đã có chủ là đổi lại phân công mà không ai yêu cầu.
  INSERT INTO customer_assignments (customer_id, user_id, role, status, assigned_at)
  SELECT c.id, c.created_by, 'primary', 'active', COALESCE(c.created_at::date, CURRENT_DATE)
  FROM customers c
  JOIN users u ON u.id = c.created_by
  WHERE c.created_by IS NOT NULL
    AND u.role = 'sales'
    AND COALESCE(u.is_active, true)
    AND NOT EXISTS (
      SELECT 1 FROM customer_assignments a
      WHERE a.customer_id = c.id AND a.status = 'active'
    )
  -- Ràng buộc UNIQUE(customer_id, user_id) đã có; câu này chỉ để một dòng
  -- 'inactive' cũ không làm cả lệnh đổ.
  ON CONFLICT (customer_id, user_id) DO NOTHING;
  GET DIAGNOSTICS v_n2 = ROW_COUNT;
  RAISE NOTICE 'Phân công cho NVBH đã tạo điểm bán: % điểm bán', v_n2;

  -- ------------------------------------------------------------------
  -- Còn lại bao nhiêu
  -- ------------------------------------------------------------------
  SELECT count(*) INTO v_con
  FROM customers c
  WHERE NOT EXISTS (
    SELECT 1 FROM customer_assignments a
    WHERE a.customer_id = c.id AND a.status = 'active'
  );
  RAISE NOTICE '--- CÒN % điểm bán chưa có ai phụ trách — phải phân công tay ---', v_con;

  SELECT count(*) INTO v_con FROM customers WHERE created_by IS NULL;
  RAISE NOTICE '--- CÒN % điểm bán không rõ ai tạo (không còn dấu vết để lần ra) ---', v_con;
END $$;


-- ####################################################################
-- # 113_delete_cancelled_orders.sql
-- ####################################################################

-- ====================================================================
-- 113 — Cho phép xoá đơn hàng đã huỷ / còn nháp
-- ====================================================================
--
-- TRIỆU CHỨNG: bấm "Xoá đơn hàng" trên một đơn ĐÃ HUỶ, màn hình báo "Đã
-- xóa đơn hàng", quay về danh sách — và đơn vẫn nằm đó.
--
-- NGUYÊN NHÂN: `sales_orders` bật RLS nhưng KHÔNG CÓ policy DELETE nào.
-- Rà cả 112 migration: có policy SELECT, INSERT, UPDATE, không có DELETE.
-- Khi RLS bật mà không có policy cho một thao tác thì thao tác đó khớp
-- KHÔNG dòng nào — PostgREST trả về 200, mảng rỗng, KHÔNG có lỗi. Mã
-- nguồn chỉ kiểm `error`, thấy rỗng nên báo thành công.
--
-- Đây là kiểu hỏng khó thấy nhất: không phải "xoá rồi báo lỗi", mà "không
-- xoá gì và báo đã xoá".
--
-- PHẠM VI CỐ Ý HẸP
--
--   • Chỉ `draft` và `cancelled`. Đơn đã giao gắn với công nợ, phiếu xuất
--     kho, hoá đơn điện tử — xoá là thủng sổ. Trạng thái khác thì huỷ
--     trước, xoá sau; ĐÚNG như nút trên màn hình vẫn đang gài.
--   • Chỉ owner/manager, khớp với policy UPDATE sẵn có.
--
-- KHÔNG NỚI KHOÁ NGOẠI. Vài bảng trỏ vào `sales_orders` bằng REFERENCES
-- trần (công nợ, phiếu thu, bàn giao tài xế) nên Postgres sẽ CHẶN nếu đơn
-- còn dính chứng từ — và chặn ở đó là đúng. Lúc ấy lỗi khoá ngoại có nội
-- dung thật, hiện thẳng lên màn hình, khác hẳn cái im lặng cũ.
-- ====================================================================

DROP POLICY IF EXISTS "Owner/Manager can delete draft or cancelled orders" ON sales_orders;
CREATE POLICY "Owner/Manager can delete draft or cancelled orders"
  ON sales_orders FOR DELETE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
    AND status IN ('draft', 'cancelled')
  );

COMMENT ON TABLE sales_orders IS
  'Đơn bán. Chỉ xoá được khi status là draft hoặc cancelled (mig 113); '
  'đơn đã giao phải huỷ trước, và vẫn bị khoá ngoại chặn nếu còn dính '
  'công nợ hay phiếu thu.';


-- ####################################################################
-- # 114_fix_activity_log_on_order_delete.sql
-- ####################################################################

-- ====================================================================
-- 114 — Xoá đơn hàng nổ vì trigger ghi nhật ký
-- ====================================================================
--
-- TRIỆU CHỨNG (xuất hiện ngay sau khi mig 113 cho phép xoá thật):
--   null value in column "org_id" of relation "order_activity_log"
--   violates not-null constraint
--
-- CƠ CHẾ
--   Xoá một dòng `sales_orders` → `sales_order_lines` bị cascade xoá theo
--   → trigger `log_sales_order_line_change()` chạy cho từng dòng hàng.
--   Nhánh DELETE của nó làm:
--
--       SELECT org_id, current_workflow_stage INTO v_org, v_stage
--       FROM sales_orders WHERE id = OLD.order_id;
--
--   Nhưng đơn CHA đã bị xoá trong CÙNG câu lệnh đó. Truy vấn không tìm
--   thấy gì, `v_org` là NULL, và lệnh INSERT ngay sau đổ vì `org_id`
--   NOT NULL.
--
--   Trước mig 113 không ai gặp: RLS chặn từ vòng ngoài nên lệnh xoá chưa
--   bao giờ chạm tới trigger. Sửa được lỗi thứ nhất thì lỗi thứ hai lộ
--   ra — nó vẫn ở đó suốt.
--
-- CÁCH SỬA
--   Đơn cha không còn thì THÔI GHI, trả về OLD.
--
--   Không phải vá cho qua chuyện: `order_activity_log.order_id` có khoá
--   ngoại ON DELETE CASCADE, nên dòng nhật ký vừa ghi cũng bị xoá ngay
--   trong cùng câu lệnh. Ghi để rồi xoá là việc vô nghĩa — mà lại đang
--   làm hỏng cả thao tác xoá.
--
--   Nhật ký này sinh ra để ghi lại việc SỬA DÒNG HÀNG trong đời một đơn,
--   không phải để ghi lại cái chết của chính đơn đó.
--
-- SỬA THÊM MỘT CHỖ, NÓI RÕ RA ĐÂY
--   Nhánh UPDATE của hàm gốc KIỂM `line_discount` để quyết định có ghi
--   nhật ký không, nhưng phần mô tả thay đổi lại KHÔNG chứa cột đó. Hậu
--   quả: sửa mỗi chiết khấu dòng thì nhật ký có ghi, mà nội dung ghi là
--   một khối rỗng — biết "có người sửa gì đó" mà không biết sửa gì.
--
--   Đã thêm `line_discount` vào phần mô tả. Ghi rõ ở đây vì đó là thay
--   đổi HÀNH VI, không phải một phần của bản vá lỗi xoá đơn; đối chiếu
--   với mig 052 thì đây là khác biệt cố ý duy nhất ngoài hai chốt chặn
--   NULL ở trên.
--
-- Phần còn lại của hàm giữ NGUYÊN VĂN mig 052.
-- ====================================================================

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

    -- [114] Đơn cha đã biến mất → đang xoá CẢ ĐƠN, không phải xoá một
    -- dòng hàng. Thôi ghi.
    IF v_org IS NULL THEN
      RETURN OLD;
    END IF;

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

  -- Cùng lý do: đơn cha không còn thì không có gì để gắn dòng nhật ký
  -- vào. Chặn ở đây để hàm không bao giờ chèn `org_id` rỗng.
  IF v_org IS NULL THEN
    RETURN NEW;
  END IF;

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
      'line_discount', CASE WHEN NEW.line_discount IS DISTINCT FROM OLD.line_discount
        THEN jsonb_build_object('from', OLD.line_discount, 'to', NEW.line_discount) END,
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

COMMENT ON FUNCTION log_sales_order_line_change() IS
  'Ghi nhật ký sửa dòng hàng trong đời một đơn. Bỏ qua khi đơn cha đã bị '
  'xoá (mig 114) — lúc đó dòng nhật ký cũng sẽ cascade mất ngay, mà lại '
  'làm đổ cả lệnh xoá.';


-- ####################################################################
-- # 115_sales_edit_after_approval.sql
-- ####################################################################

-- ---------------------------------------------------------------------
-- 115 — NVBH được sửa đơn CỦA MÌNH sau khi đơn đã duyệt
-- ---------------------------------------------------------------------
--
-- TRƯỚC KHI SỬA
--   Chính sách "Sales can update own draft orders" (mig 002, vá lại ở 036)
--   chỉ cho NVBH sửa đơn khi `status = 'draft'`. Duyệt xong là hết đường:
--   sai một con số cũng phải nhờ quản lý, hoặc huỷ đơn làm lại từ đầu.
--
-- ⚠ VÌ SAO PHẢI SỬA Ở ĐÂY CHỨ KHÔNG CHỈ Ở MÀN HÌNH
--   RLS không báo lỗi khi từ chối. Lệnh UPDATE không khớp chính sách nào
--   thì Postgres sửa 0 dòng, PostgREST trả HTTP 200, `error` là null.
--   Nới quyền trên màn hình mà quên nới ở đây thì nhân viên bấm Lưu, thấy
--   "Đã cập nhật đơn hàng", rồi tải lại trang và thấy số cũ. Không có chỗ
--   nào trong hệ thống nói cho họ biết vì sao.
--
-- ⚠ LỖ HỔNG ĐÃ CÓ SẴN, SỬA LUÔN
--   Chính sách của `sales_order_lines` là FOR ALL cho cả 'sales', KHÔNG
--   ràng buộc trạng thái và KHÔNG ràng buộc ai phụ trách đơn. Tức là dòng
--   hàng vốn đã sửa được ở mọi trạng thái, chỉ có phần đầu đơn
--   (subtotal/total) là bị chặn. Ai cấp quyền `orders.update` cho NVBH
--   trong /settings/permissions là lập tức có cảnh: dòng hàng đổi, tổng
--   tiền đứng im, và không ai được báo. Siết lại cho khớp phần đầu đơn.
--
-- KHÔNG ĐỔI
--   Owner/manager/warehouse giữ nguyên quyền cũ.
--   `picking` trở đi NVBH vẫn không sửa được: từ lúc thủ kho bắt đầu lấy
--   hàng, đơn trên giấy và hàng trên xe đẩy phải là một.
-- ---------------------------------------------------------------------

-- --- Phần đầu đơn ----------------------------------------------------
DROP POLICY IF EXISTS "Sales can update own draft orders" ON sales_orders;
DROP POLICY IF EXISTS "Sales can update own open orders" ON sales_orders;

CREATE POLICY "Sales can update own open orders" ON sales_orders
  FOR UPDATE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'sales'
    AND sales_user_id = auth.uid()
    AND status IN ('draft', 'confirmed')
  )
  -- ⚠ WITH CHECK chặn chiều NGƯỢC LẠI: sửa xong không được đẩy đơn sang
  -- một trạng thái mà chính mình không còn sửa được nữa. Thiếu vế này thì
  -- một lệnh UPDATE có thể vừa sửa vừa tự chuyển đơn sang `picking`, tức
  -- tự bỏ qua bước thủ kho.
  WITH CHECK (
    org_id = public.user_org_id()
    AND sales_user_id = auth.uid()
    AND status IN ('draft', 'confirmed')
  );

COMMENT ON POLICY "Sales can update own open orders" ON sales_orders IS
  'NVBH sửa đơn của chính mình khi đơn còn ở draft hoặc confirmed (đã '
  'duyệt, chưa lấy hàng). Danh sách trạng thái này phải khớp '
  'SALES_EDITABLE_STATUSES trong src/lib/orders/edit-permission.ts.';

-- --- Dòng hàng --------------------------------------------------------
--
-- Tách 'sales' ra khỏi chính sách FOR ALL chung để ràng buộc thêm hai vế
-- mà các vai trò kia không cần: đúng người phụ trách, và đúng trạng thái.
DROP POLICY IF EXISTS "Owner/Manager/Sales can manage order lines" ON sales_order_lines;
DROP POLICY IF EXISTS "Admin roles can manage order lines" ON sales_order_lines;
DROP POLICY IF EXISTS "Sales can manage lines of own open orders" ON sales_order_lines;

CREATE POLICY "Admin roles can manage order lines" ON sales_order_lines
  FOR ALL
  USING (
    public.user_role() IN ('owner', 'manager', 'warehouse')
    AND EXISTS (
      SELECT 1 FROM sales_orders so
      WHERE so.id = order_id AND so.org_id = public.user_org_id()
    )
  );

CREATE POLICY "Sales can manage lines of own open orders" ON sales_order_lines
  FOR ALL
  USING (
    public.user_role() = 'sales'
    AND EXISTS (
      SELECT 1 FROM sales_orders so
      WHERE so.id = order_id
        AND so.org_id = public.user_org_id()
        AND so.sales_user_id = auth.uid()
        AND so.status IN ('draft', 'confirmed')
    )
  )
  WITH CHECK (
    public.user_role() = 'sales'
    AND EXISTS (
      SELECT 1 FROM sales_orders so
      WHERE so.id = order_id
        AND so.org_id = public.user_org_id()
        AND so.sales_user_id = auth.uid()
        AND so.status IN ('draft', 'confirmed')
    )
  );

NOTIFY pgrst, 'reload schema';

-- --- Đếm lại để biết vừa mở ra bao nhiêu ------------------------------
DO $$
DECLARE
  v_open int;
BEGIN
  SELECT count(*) INTO v_open
  FROM sales_orders
  WHERE status = 'confirmed';
  RAISE NOTICE '--- Có % đơn đã duyệt, NVBH phụ trách nay sửa được ---', v_open;
END $$;


-- ####################################################################
-- # 116_grant_sales_order_update.sql
-- ####################################################################

-- ---------------------------------------------------------------------
-- 116 — Bật quyền `orders.update` cho NVBH trong ma trận phân quyền
-- ---------------------------------------------------------------------
--
-- Migration 115 mở chính sách RLS; đây là công tắc phía ứng dụng.
--
-- ⚠ VÌ SAO KHÔNG CHỈ SỬA MẶC ĐỊNH TRONG MÃ
--   `DEFAULT_PERMISSION_MAP` chỉ là giá trị nền. Tổ chức nào đã từng bấm
--   "Đặt lại" ở /settings/permissions thì có SẴN một dòng
--   (sales, orders, update, allowed=false) trong `role_permissions`, và
--   dòng đó đè lên mặc định mới. Sửa mã mà không chạm bảng thì đúng những
--   tổ chức đã cấu hình lại là những tổ chức không thấy gì thay đổi.
--
-- ⚠ CHỈ ĐỘNG ĐÚNG MỘT Ô. Không đụng tới bất kỳ (vai trò, mô-đun, hành
--   động) nào khác — ai đã tự siết quyền gì thì giữ nguyên quyền đó.
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_updated int := 0;
  v_inserted int := 0;
BEGIN
  -- Ô đã có sẵn và đang tắt → bật.
  UPDATE role_permissions
     SET allowed = true, updated_at = now()
   WHERE role = 'sales' AND module = 'orders' AND action = 'update'
     AND allowed IS DISTINCT FROM true;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Tổ chức chưa từng lưu ô này → chèn cho khớp mặc định mới, để lần sau
  -- ai mở màn phân quyền cũng thấy đúng trạng thái đang chạy.
  INSERT INTO role_permissions (org_id, role, module, action, allowed)
  SELECT o.id, 'sales', 'orders', 'update', true
    FROM organizations o
   WHERE NOT EXISTS (
     SELECT 1 FROM role_permissions rp
      WHERE rp.org_id = o.id AND rp.role = 'sales'
        AND rp.module = 'orders' AND rp.action = 'update'
   );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RAISE NOTICE '--- Bật quyền sửa đơn cho NVBH: % ô đã bật, % ô mới thêm ---',
    v_updated, v_inserted;
END $$;

NOTIFY pgrst, 'reload schema';


-- ####################################################################
-- # 117_sales_delete_own_draft.sql
-- ####################################################################

-- ---------------------------------------------------------------------
-- 117 — NVBH xoá được đơn NHÁP của chính mình
-- ---------------------------------------------------------------------
--
-- Màn "Đơn tạm" có nút Xoá. Nhưng chính sách xoá duy nhất hiện nay (mig
-- 113) chỉ cho owner/manager, nên NVBH bấm Xoá sẽ rơi vào đúng cái bẫy đã
-- gặp hai lần trong dự án này: RLS từ chối thì Postgres xoá 0 dòng,
-- PostgREST trả HTTP 200 và `error` là null — màn hình báo "đã xoá", tải
-- lại trang thì đơn vẫn nằm đó.
--
-- ⚠ CHỈ `draft`, CHỈ ĐƠN CỦA MÌNH. Đơn đã duyệt thì kho có thể đang soạn
-- hàng; đơn của người khác thì không phải việc của mình. Hai vế đó khớp
-- đúng phạm vi SỬA mà migration 115 đã mở — xoá không được rộng hơn sửa.
--
-- KHÔNG đụng tới chính sách của owner/manager ở mig 113.
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "Sales can delete own draft orders" ON sales_orders;

CREATE POLICY "Sales can delete own draft orders"
  ON sales_orders FOR DELETE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'sales'
    AND sales_user_id = auth.uid()
    AND status = 'draft'
  );

COMMENT ON POLICY "Sales can delete own draft orders" ON sales_orders IS
  'NVBH bỏ đơn nháp của chính mình (màn Đơn tạm). Hẹp hơn quyền sửa ở '
  'mig 115 đúng một bậc: sửa được cả draft lẫn confirmed, xoá thì chỉ draft.';

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM sales_orders WHERE status = 'draft';
  RAISE NOTICE '--- Có % đơn nháp; NVBH phụ trách nay xoá được đơn của mình ---', v_n;
END $$;


-- ####################################################################
-- # 118_delete_order_cleans_returns.sql
-- ####################################################################

-- ---------------------------------------------------------------------
-- 118 — Xoá đơn nháp / đã huỷ: dọn phiếu trả CHƯA HOÀN THÀNH đi kèm,
--       chặn rõ lời nếu phiếu trả ĐÃ hoàn thành
-- ---------------------------------------------------------------------
--
-- TRIỆU CHỨNG (chủ NPP báo kèm ảnh): bấm "Xoá đơn hàng" trên đơn ĐÃ HUỶ →
--   update or delete on table "sales_orders" violates foreign key
--   constraint "returns_order_id_fkey" on table "returns" (mã 23503)
--
-- NGUYÊN NHÂN: luồng bán hàng tạo "hàng trả kèm đơn" — một dòng `returns`
-- trỏ `order_id` vào đơn, chưa hoàn thành. Khoá ngoại đó là REFERENCES
-- trần (mig 001), nên Postgres chặn xoá đơn chừng nào phiếu trả còn đó.
-- Mig 113 cố ý KHÔNG nới khoá ngoại vì công nợ / phiếu thu / bàn giao phải
-- chặn — đúng. Nhưng phiếu trả chưa hoàn thành thì KHÁC: nó chưa trừ công nợ,
-- chưa nhập kho, nó là một phần của chính đơn đó. Đơn đi thì nó đi theo.
--
-- ⚠ PHIẾU TRẢ ĐÃ HOÀN THÀNH LÀ CHỨNG TỪ. Nó đã trừ
-- công nợ (credited_at) và kho đã nhận hàng lại. Không xoá theo, không gỡ
-- liên kết (gỡ là phiếu mất dấu vết "trả cho đơn nào") — CHẶN, và nói
-- thẳng vì sao bằng tiếng người, thay vì câu "violates foreign key".
--
-- `visit_logs.order_id` chỉ là dấu "lần ghé này có ra đơn": đơn xoá thì
-- lần ghé vẫn có thật → gỡ liên kết, giữ nhật ký.
--
-- SECURITY DEFINER: người xoá đơn thường không có policy DELETE trên
-- `returns` (mig 002 chỉ có xem / tạo / sửa). Không có nó thì lệnh xoá
-- phiếu trả bên trong trigger khớp 0 dòng — im lặng — rồi khoá ngoại lại
-- chặn y như cũ. Trigger chỉ chạy sau khi RLS đã CHO xoá đơn, và chỉ đụng
-- tới phiếu trả của đúng đơn đó, nên phạm vi không rộng hơn quyền đã có.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_sales_orders_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_posted  int;
  v_pending int;
BEGIN
  -- ⚠ Q12 — BỐN TRẠNG THÁI CỦA WORKFLOW V2, không phải ba giá trị cũ.
  --   `chk_returns_status_v2` (mig 119) chỉ còn cho
  --   draft/submitted/completed/cancelled; ba giá trị của bước duyệt cũ
  --   đã bị backfill đi và ràng buộc cấm.
  --
  --   Hỏng ra sao nếu để nguyên, và hỏng ÂM THẦM:
  --   · nhánh chặn hỏi cả giá trị của bước duyệt cũ → phiếu 'submitted'
  --     hết chặn việc xoá đơn;
  --   · nhánh dọn hỏi hai giá trị cũ kia → khớp 0 dòng, nên khoá ngoại
  --     23503 chặn xoá đơn kèm một câu tiếng Anh — ĐÚNG THỨ MIGRATION
  --     NÀY SINH RA ĐỂ SỬA.
  --
  -- ⚠ Chỉ phiếu 'completed' mới đụng tồn kho và công nợ, nên chỉ nó mới
  --   chặn. Ba trạng thái kia chưa ghi gì (hoặc đã được đảo lại ở
  --   `cancel_return`) nên dọn đi cùng đơn được.
  SELECT count(*) INTO v_posted
  FROM returns
  WHERE order_id = OLD.id AND status = 'completed';

  IF v_posted > 0 THEN
    RAISE EXCEPTION
      'Đơn % có % phiếu trả hàng ĐÃ HOÀN THÀNH (đã trừ công nợ / nhập lại kho) nên không xoá được. Huỷ phiếu trả đó trước, hoặc giữ đơn.',
      OLD.order_code, v_posted
      USING ERRCODE = 'P0001', HINT = 'returns.order_id';
  END IF;

  DELETE FROM returns
  WHERE order_id = OLD.id AND status IN ('draft', 'submitted', 'cancelled');
  GET DIAGNOSTICS v_pending = ROW_COUNT;

  UPDATE visit_logs SET order_id = NULL WHERE order_id = OLD.id;

  IF v_pending > 0 THEN
    RAISE NOTICE 'Xoá đơn %: đã bỏ % phiếu trả chưa hoàn thành đi kèm', OLD.order_code, v_pending;
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_sales_orders_before_delete() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_sales_orders_before_delete ON sales_orders;
CREATE TRIGGER trg_sales_orders_before_delete
  BEFORE DELETE ON sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_sales_orders_before_delete();

COMMENT ON FUNCTION public.trg_sales_orders_before_delete() IS
  'Xoá đơn nháp/huỷ: bỏ phiếu trả chưa hoàn thành đi kèm (chưa trừ công '
  'nợ, chưa nhập kho); chặn rõ lời nếu có phiếu trả đã hoàn thành; '
  'gỡ order_id khỏi visit_logs. Công nợ, hoá đơn, phiếu thu, bàn giao vẫn '
  'chặn bằng khoá ngoại — đó là chứng từ, đúng như mig 113 chốt.';

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
  FROM returns r JOIN sales_orders o ON o.id = r.order_id
  WHERE o.status IN ('draft', 'cancelled')
    AND r.status IN ('draft', 'submitted', 'cancelled');
  RAISE NOTICE '--- Hiện có % phiếu trả chưa hoàn thành gắn với đơn nháp/huỷ — sẽ đi theo khi đơn bị xoá ---', v_n;
END $$;


-- ####################################################################
-- # 119_workflow_v2.sql
-- ####################################################################

-- ---------------------------------------------------------------------
-- 119 — Workflow đơn hàng v2: Nháp → Phiếu tạm → Hoàn thành / Đã hủy
-- ---------------------------------------------------------------------
--
-- TRƯỚC KHI SỬA
--   Đơn đi qua 6 trạng thái (draft → confirmed → picking → delivering →
--   delivered) với một lớp duyệt chồng lên. Nhà phân phối nhỏ không có
--   thủ kho riêng, không có tổ duyệt đơn: cùng một người nhận đơn, lấy
--   hàng, giao, thu tiền. Sáu bước ấy bắt họ bấm năm lần cho một việc.
--
--   Tệ hơn, mỗi bước là một lệnh UPDATE rời từ trình duyệt. Đơn nhảy
--   sang 'delivering' mà phiếu xuất vẫn nằm im ở nháp, kho không trừ,
--   công nợ không sinh — không có gì trong CSDL ràng hai chuyện đó lại
--   với nhau.
--
-- SAU KHI SỬA
--   4 trạng thái: 'draft' (nháp của NVBH) · 'submitted' (phiếu tạm, NPP
--   nhìn thấy) · 'completed' (đã xuất hàng) · 'cancelled'.
--   Hai bước đắt tiền — xuất hàng và huỷ đơn đã xuất — BẮT BUỘC đi qua
--   RPC (migration 120). Trigger ở đây chặn đường tắt: UPDATE thẳng từ
--   trình duyệt sẽ RAISE 'USE_RPC'.
--
-- ⚠ VÌ SAO PHẢI TẮT HAI TRIGGER KHI BACKFILL
--   trg_check_order_status (bản mig 059) cấm 'confirmed' → bất cứ đâu
--   ngoài 'picking'/'cancelled'. Chạy backfill mà không gỡ nó ra thì
--   lệnh UPDATE đầu tiên đã RAISE, migration chết giữa chừng.
--   trg_log_order_status thì ngược lại: nó chạy êm, và ghi vào
--   order_status_history một dòng cho MỖI đơn được backfill. Lịch sử
--   trạng thái của cả nhà phân phối sẽ có một ngày mà mọi đơn cùng đổi
--   trạng thái do 'migration' — đọc lại không hiểu chuyện gì đã xảy ra.
--   Tắt lúc backfill, bật lại ngay sau.
--
-- ⚠ CÁC RÀNG BUỘC CHECK Ở ĐÂY KHÔNG CÓ TÊN
--   sales_orders.status, returns.status, cash_receipts.source_type và
--   payments.method đều khai inline trong CREATE TABLE (mig 001), nên
--   Postgres tự đặt tên. Tên tự sinh KHÔNG xuất hiện trong repo, không
--   được đoán. Mỗi chỗ dùng một khối DO tra pg_constraint rồi DROP theo
--   tên thật — đúng khuôn mig 103 đã dùng cho notifications.
--
-- ⚠ ĐỔI Ý NGHĨA SỐ LIỆU — ĐỌC KỸ
--   is_revenue_status() từ 'không phải nháp và không phải huỷ' đổi thành
--   'đúng completed'. Đơn đang ở 'confirmed' hôm nay trở thành phiếu tạm
--   và RỜI KHỎI doanh thu cho tới khi ai đó bấm Xuất hàng. Lương, hoa
--   hồng và báo cáo các kỳ đã chốt sẽ tính lại thấp hơn phần đó. Chủ nhà
--   đã biết và đã chốt: bảng map giữ nguyên, không có ngoại lệ.
--
-- KHÔNG ĐỔI
--   Cột current_workflow_stage giữ lại (dữ liệu cũ, không ai đọc nữa).
--   Module giao hàng qua tài xế giữ nguyên bảng và mã, chỉ ẩn khỏi menu
--   ở phase sau — nên nhánh SELECT cho vai trò tài xế vẫn còn trong RLS.
-- ---------------------------------------------------------------------


-- =====================================================================
-- 1. Cột mới
-- =====================================================================

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS submitted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by  uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at  timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by  uuid,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

COMMENT ON COLUMN sales_orders.completed_at IS
  'Mốc xuất hàng. NULL với đơn chưa xuất. Đơn huỷ SAU khi đã xuất vẫn giữ '
  'mốc này — đó là dấu để biết đơn huỷ nào còn hồ sơ kho, không được xoá.';

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS completed_edit_days int NOT NULL DEFAULT 1;

COMMENT ON COLUMN organizations.completed_edit_days IS
  'Số ngày còn được sửa/huỷ đơn đã Hoàn thành, tính từ ngày đặt. Mặc định 1.';


-- =====================================================================
-- 2. Gỡ giàn giáo của luồng cũ
-- =====================================================================
-- Giai đoạn workflow là cột dẫn xuất từ status theo bảng ánh xạ 6 giá
-- trị cũ. Bỏ trạng thái cũ thì bảng ánh xạ vô nghĩa: mọi status mới rơi
-- vào nhánh ELSE và cột giữ nguyên giá trị cũ — sai một cách im lặng.
DROP TRIGGER  IF EXISTS trg_sync_workflow_stage ON sales_orders;
DROP FUNCTION IF EXISTS sync_sales_order_workflow_stage();

ALTER TABLE sales_orders
  DROP CONSTRAINT IF EXISTS chk_sales_orders_workflow_stage;

-- Khoá dòng đã pick chỉ có nghĩa khi còn bước "đang lấy hàng". v2 không
-- có bước đó; khoá sửa đơn Hoàn thành nằm ở RPC (mig 120) chứ không ở
-- đây.
DROP TRIGGER  IF EXISTS trg_enforce_picked_line_lock ON sales_order_lines;
DROP FUNCTION IF EXISTS enforce_picked_line_lock();
DROP VIEW     IF EXISTS v_sales_order_line_picked;


-- =====================================================================
-- 3. Tắt hai trigger gác trạng thái để backfill
-- =====================================================================

DROP TRIGGER IF EXISTS trg_check_order_status ON sales_orders;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_log_order_status'
      AND tgrelid = 'sales_orders'::regclass
      AND NOT tgisinternal
  ) THEN
    EXECUTE 'ALTER TABLE sales_orders DISABLE TRIGGER trg_log_order_status';
  END IF;
END $$;


-- =====================================================================
-- 4. Backfill sales_orders
-- =====================================================================
--
-- ⚠ GỠ RÀNG BUỘC CŨ TRƯỚC KHI BACKFILL, KHÔNG PHẢI SAU.
--
--   Ràng buộc gốc (mig 001) chỉ cho sáu giá trị của luồng cũ:
--   draft/confirmed/picking/delivering/delivered/cancelled. `submitted`
--   và `completed` KHÔNG nằm trong đó. Đặt phần gỡ xuống sau backfill —
--   như bản đầu của file này — thì lệnh UPDATE đầu tiên đã chết với
--   `23514 sales_orders_status_check`, và cả migration rollback.
--
--   Không gộp luôn cả việc THÊM ràng buộc mới lên đây được: lúc này bảng
--   còn đầy `confirmed`/`picking`, mà ràng buộc mới không nhận chúng nên
--   `ADD CONSTRAINT` sẽ vỡ. Phải đúng ba nhịp: GỠ → BACKFILL → THÊM.
--   Nhịp thêm nằm ở mục 5.
--
-- ⚠ Ràng buộc cũ không có tên trong kho mã (khai inline ở mig 001), nên
--   phải tra `pg_constraint` rồi DROP theo tên thật. Lọc theo 'confirmed'
--   vì đó là chuỗi CHỈ có trong ràng buộc status — ràng buộc giai đoạn
--   workflow đã bị gỡ ở mục 2 và nó không chứa chuỗi này.
DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'sales_orders'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%confirmed%'
  LOOP
    EXECUTE format('ALTER TABLE sales_orders DROP CONSTRAINT %I', v_name);
    RAISE NOTICE '119: đã gỡ ràng buộc status cũ %', v_name;
  END LOOP;
END $$;

-- Bảng map (Coder Pack mục 1), chạy đúng thứ tự này:
--   draft + lý do 'Lưu nháp — chưa gửi duyệt'  → draft   (giữ nguyên)
--   draft khác (kể cả lý do rỗng)              → submitted
--   confirmed                                   → submitted
--   picking | delivering | delivered            → completed
--   cancelled                                   → cancelled
--
-- ⚠ submitted_at KHÔNG được đoán. Đơn cũ không lưu mốc gửi, và
--   created_at là mốc TẠO chứ không phải mốc gửi. Để trống.

DO $$
DECLARE
  v_draft_keep int;
  v_draft_sub  int;
  v_confirmed  int;
  v_completed  int;
  v_cancelled  int;
BEGIN
  SELECT count(*) INTO v_draft_keep
  FROM sales_orders
  WHERE status = 'draft'
    AND COALESCE(approval_reason, '') = 'Lưu nháp — chưa gửi duyệt';

  -- draft đã gửi (lý do khác, hoặc rỗng) → phiếu tạm
  UPDATE sales_orders
  SET status = 'submitted'
  WHERE status = 'draft'
    AND COALESCE(approval_reason, '') <> 'Lưu nháp — chưa gửi duyệt';
  GET DIAGNOSTICS v_draft_sub = ROW_COUNT;

  UPDATE sales_orders
  SET status = 'submitted'
  WHERE status = 'confirmed';
  GET DIAGNOSTICS v_confirmed = ROW_COUNT;

  -- Đã xuất kho / đang giao / đã giao đều là "đã xuất hàng" trong v2.
  -- Mốc lấy từ phiếu xuất đã ghi sổ của chính đơn đó; không có phiếu
  -- (đơn trước mig 107, hoặc đơn giao qua tài xế) thì lấy now().
  UPDATE sales_orders so
  SET status = 'completed',
      completed_at = COALESCE(
        (SELECT max(se.posted_at)
           FROM stock_entries se
          WHERE se.type = 'export'
            AND se.status = 'posted'
            AND se.ref_order_ids @> jsonb_build_array(so.id::text)),
        now())
  WHERE so.status IN ('picking', 'delivering', 'delivered');
  GET DIAGNOSTICS v_completed = ROW_COUNT;

  -- Đơn huỷ: completed_at để trống, TRỪ đơn đã từng xuất kho thật (giao
  -- thất bại, bàn giao lại). Đơn đó phải giữ hồ sơ, không được xoá.
  UPDATE sales_orders so
  SET completed_at = (
        SELECT max(se.posted_at)
          FROM stock_entries se
         WHERE se.type = 'export'
           AND se.status = 'posted'
           AND se.ref_order_ids @> jsonb_build_array(so.id::text))
  WHERE so.status = 'cancelled'
    AND so.completed_at IS NULL
    AND EXISTS (
      SELECT 1 FROM stock_entries se
       WHERE se.type = 'export'
         AND se.status = 'posted'
         AND se.ref_order_ids @> jsonb_build_array(so.id::text));
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  RAISE NOTICE '119 backfill sales_orders: % nháp giữ nguyên, % nháp→phiếu tạm, % đã duyệt→phiếu tạm, % →hoàn thành, % đơn huỷ được đóng dấu mốc xuất kho',
    v_draft_keep, v_draft_sub, v_confirmed, v_completed, v_cancelled;
END $$;


-- =====================================================================
-- 5. Ràng buộc CHECK mới cho sales_orders.status
-- =====================================================================
ALTER TABLE sales_orders
  DROP CONSTRAINT IF EXISTS chk_sales_orders_status_v2;
ALTER TABLE sales_orders
  ADD CONSTRAINT chk_sales_orders_status_v2
  CHECK (status IN ('draft', 'submitted', 'completed', 'cancelled'));


-- =====================================================================
-- 6. Bật lại trigger ghi lịch sử
-- =====================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_log_order_status'
      AND tgrelid = 'sales_orders'::regclass
      AND NOT tgisinternal
  ) THEN
    EXECUTE 'ALTER TABLE sales_orders ENABLE TRIGGER trg_log_order_status';
  END IF;
END $$;


-- =====================================================================
-- 7. Đơn trả
-- =====================================================================

-- 7.1 Mốc ghi có: chỉ đóng dấu khi phiếu HOÀN THÀNH.
-- Bản mig 097 đóng dấu cả ở 'approved'. v2 không còn trạng thái đó, và
-- phiếu tạm thì chưa trừ công nợ của ai.
CREATE OR REPLACE FUNCTION public.sync_return_credited_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    -- Đóng dấu lần đầu. Đã có dấu thì giữ nguyên — sửa ghi chú không
    -- được đẩy khoản trừ sang kỳ khác.
    IF NEW.credited_at IS NULL THEN
      NEW.credited_at := now();
    END IF;
  ELSE
    -- Quay về phiếu tạm hoặc bị huỷ thì phiếu không còn đáng tính.
    NEW.credited_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- 7.2 Cột mới
ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS destination_zone   text,
  ADD COLUMN IF NOT EXISTS completed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by       uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at       timestamptz,
  ADD COLUMN IF NOT EXISTS applied_receipt_id uuid REFERENCES cash_receipts(id);

ALTER TABLE returns DROP CONSTRAINT IF EXISTS chk_returns_destination_zone;
ALTER TABLE returns
  ADD CONSTRAINT chk_returns_destination_zone
  CHECK (destination_zone IS NULL OR destination_zone IN ('sale', 'date'));

COMMENT ON COLUMN returns.destination_zone IS
  'Kho nhận hàng trả khi hoàn thành phiếu: sale = kho bán, date = kho hàng cận date.';
COMMENT ON COLUMN returns.applied_receipt_id IS
  'Phiếu thu đã cấn trừ khoản có này. Chỉ dùng cho phiếu trả KHÔNG gắn đơn.';

-- 7.3 Backfill (Coder Pack mục 1, bảng returns)
--
-- ⚠ CÙNG MỘT CÁI BẪY NHƯ MỤC 4, GỠ RÀNG BUỘC TRƯỚC. Ràng buộc gốc của
--   `returns` (mig 001) chỉ nhận pending/approved/rejected/completed;
--   `draft` và `submitted` không có trong đó. Ba nhịp: GỠ → BACKFILL →
--   THÊM, và nhịp thêm nằm ngay sau khối backfill bên dưới.
DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'returns'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%rejected%'
  LOOP
    EXECUTE format('ALTER TABLE returns DROP CONSTRAINT %I', v_name);
    RAISE NOTICE '119: đã gỡ ràng buộc status cũ của returns: %', v_name;
  END LOOP;
END $$;

DO $$
DECLARE
  v_draft int; v_sub int; v_appr int; v_rej int;
BEGIN
  -- pending + đơn liên kết chưa hoàn thành → nháp (ẩn khỏi danh sách)
  UPDATE returns r
  SET status = 'draft'
  WHERE r.status = 'pending'
    AND r.order_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM sales_orders o
       WHERE o.id = r.order_id AND o.status <> 'completed');
  GET DIAGNOSTICS v_draft = ROW_COUNT;

  -- pending còn lại (đơn đã hoàn thành, hoặc phiếu không gắn đơn)
  UPDATE returns SET status = 'submitted' WHERE status = 'pending';
  GET DIAGNOSTICS v_sub = ROW_COUNT;

  UPDATE returns SET status = 'submitted' WHERE status = 'approved';
  GET DIAGNOSTICS v_appr = ROW_COUNT;

  UPDATE returns SET status = 'cancelled' WHERE status = 'rejected';
  GET DIAGNOSTICS v_rej = ROW_COUNT;

  RAISE NOTICE '119 backfill returns: % →nháp, % chờ→phiếu tạm, % đã duyệt→phiếu tạm, % bị từ chối→huỷ',
    v_draft, v_sub, v_appr, v_rej;
END $$;

ALTER TABLE returns DROP CONSTRAINT IF EXISTS chk_returns_status_v2;
ALTER TABLE returns
  ADD CONSTRAINT chk_returns_status_v2
  CHECK (status IN ('draft', 'submitted', 'completed', 'cancelled'));

-- 7.4 Trần số lượng trả: không trả nhiều hơn đã bán
--
-- ⚠ return_lines KHÔNG có cột hệ số quy đổi (khác sales_order_lines).
--   Phải tra product_units — và cột ở bảng đó tên là `conversion`, KHÔNG
--   phải `conversion_factor`. Gõ nhầm là lỗi 42703 lúc chạy.
-- ⚠ Dòng đổi hàng không tính: hàng đổi không trừ công nợ, và số lượng
--   đổi không bị chặn bởi số đã bán.
CREATE OR REPLACE FUNCTION public.enforce_return_line_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order    uuid;
  v_conv     numeric;
  v_qty_base numeric;
  v_sold     numeric;
  v_returned numeric;
  v_name     text;
BEGIN
  IF NEW.is_exchange THEN
    RETURN NEW;
  END IF;

  SELECT r.order_id INTO v_order FROM returns r WHERE r.id = NEW.return_id;
  IF v_order IS NULL THEN
    -- Phiếu trả độc lập: không có đơn gốc để so, trần giá do UI gác.
    RETURN NEW;
  END IF;

  v_conv := COALESCE((
    SELECT pu.conversion FROM product_units pu
     WHERE pu.product_id = NEW.product_id AND pu.unit_name = NEW.unit_name), 1);
  v_qty_base := COALESCE(NEW.quantity, 0) * v_conv;

  SELECT COALESCE(sum(sol.quantity * COALESCE(sol.conversion_factor, 1)), 0)
    INTO v_sold
  FROM sales_order_lines sol
  WHERE sol.order_id = v_order
    AND sol.product_id = NEW.product_id;

  SELECT COALESCE(sum(rl.quantity * COALESCE((
            SELECT pu.conversion FROM product_units pu
             WHERE pu.product_id = rl.product_id AND pu.unit_name = rl.unit_name), 1)), 0)
    INTO v_returned
  FROM return_lines rl
  JOIN returns r2 ON r2.id = rl.return_id
  WHERE r2.order_id = v_order
    AND r2.status = 'completed'
    AND rl.is_exchange = false
    AND rl.product_id = NEW.product_id
    AND rl.id <> NEW.id;

  IF v_qty_base + v_returned > v_sold THEN
    SELECT name INTO v_name FROM products WHERE id = NEW.product_id;
    RAISE EXCEPTION
      'RETURN_QTY_EXCEEDS: "%" — đã bán %, đã trả %, dòng này thêm % là vượt',
      COALESCE(v_name, NEW.product_id::text), v_sold, v_returned, v_qty_base
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_return_lines_cap ON return_lines;
CREATE TRIGGER trg_return_lines_cap
  BEFORE INSERT OR UPDATE ON return_lines
  FOR EACH ROW EXECUTE FUNCTION public.enforce_return_line_cap();


-- =====================================================================
-- 8. Ghi nhận đã lấy hàng từ lô nào
-- =====================================================================
-- VÌ SAO: post_stock_export trừ FIFO qua nhiều lô, nhưng
-- stock_entry_lines.batch_id là khoá đơn nên chỉ giữ được MỘT lô — lô
-- lấy nhiều nhất. Phần còn lại nằm trong notes dạng chữ ("Lô: A×3, B×2").
-- Sửa hoặc huỷ đơn đã xuất thì phải trả hàng về ĐÚNG lô đã lấy; đọc chữ
-- trong notes để làm việc đó là cách hỏng.

CREATE TABLE IF NOT EXISTS stock_line_consumptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id         uuid NOT NULL REFERENCES stock_entry_lines(id) ON DELETE CASCADE,
  batch_id        uuid NOT NULL REFERENCES batches(id),
  qty_in_base_uom numeric NOT NULL,
  unit_cost       numeric,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_line_consumptions_line
  ON stock_line_consumptions(line_id);
CREATE INDEX IF NOT EXISTS idx_stock_line_consumptions_batch
  ON stock_line_consumptions(batch_id);

COMMENT ON TABLE stock_line_consumptions IS
  'Mỗi lần FIFO lấy hàng từ một lô cho một dòng phiếu xuất. Dùng để hoàn '
  'kho về đúng lô khi sửa hoặc huỷ đơn đã xuất.';

ALTER TABLE stock_line_consumptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view stock line consumptions" ON stock_line_consumptions;
CREATE POLICY "Org members can view stock line consumptions"
  ON stock_line_consumptions FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM stock_entry_lines sel
      JOIN stock_entries se ON se.id = sel.entry_id
      WHERE sel.id = line_id
        AND se.org_id = public.user_org_id()
    )
  );

-- Ghi là việc của post_stock_export và các RPC ở mig 120 — đều
-- SECURITY DEFINER nên không đi qua RLS. Không mở policy ghi cho client.

-- Chép nguyên văn bản hiện hành (mig 107), THÊM ĐÚNG MỘT lệnh INSERT
-- trong vòng lặp trừ lô. Không đổi gì khác trong hàm.
CREATE OR REPLACE FUNCTION post_stock_export(p_entry_id uuid)
RETURNS TABLE (
  posted boolean,
  total_cost numeric,
  short_qty numeric,
  near_expiry_skipped int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org             uuid;
  v_status          text;
  v_type            text;
  v_allow_oversell  boolean;
  v_total_cost      numeric := 0;
  v_short           numeric := 0;
  v_near            int     := 0;
  l                 record;
  b                 record;
  v_remaining       numeric;
  v_take            numeric;
  v_cost_sum        numeric;
  v_qty_taken       numeric;
  v_best_id         uuid;
  v_best_qty        numeric;
  v_detail          text;
  v_lots            int;
  v_min_expiry      date;
  v_prod_name       text;
BEGIN
  -- Khoá phiếu TRƯỚC khi đọc trạng thái. Đọc rồi mới khoá thì hai lượt
  -- chạy song song đều thấy 'draft' và cùng đi tiếp.
  SELECT org_id, status, type
    INTO v_org, v_status, v_type
  FROM stock_entries
  WHERE id = p_entry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTRY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF v_type <> 'export' THEN
    RAISE EXCEPTION 'NOT_AN_EXPORT: phiếu % không phải phiếu xuất', v_type
      USING ERRCODE = 'P0001';
  END IF;

  -- Đã ghi sổ rồi thì KHÔNG làm gì. Đây là lá chắn chống trừ hai lần:
  -- trả về posted = false để nơi gọi biết là không có gì xảy ra, chứ
  -- không phải báo lỗi — bấm lại lần nữa là chuyện bình thường.
  IF v_status <> 'draft' THEN
    RETURN QUERY SELECT false, 0::numeric, 0::numeric, 0;
    RETURN;
  END IF;

  SELECT COALESCE(allow_oversell, false) INTO v_allow_oversell
  FROM organizations WHERE id = v_org;

  FOR l IN
    SELECT sel.id,
           sel.product_id,
           sel.notes,
           COALESCE(sel.qty_in_base_uom, sel.quantity, 0)::numeric AS need
    FROM stock_entry_lines sel
    WHERE sel.entry_id = p_entry_id
    ORDER BY sel.id
  LOOP
    CONTINUE WHEN l.need <= 0;

    v_remaining := l.need;
    v_cost_sum  := 0;
    v_qty_taken := 0;
    v_best_id   := NULL;
    v_best_qty  := 0;
    v_detail    := '';
    v_lots      := 0;

    -- Hạn gần nhất đang có, đo TRƯỚC khi trừ. Dùng để biết FIFO có bỏ
    -- qua lô cận hạn hơn không.
    SELECT MIN(expires_at) INTO v_min_expiry
    FROM batches
    WHERE org_id = v_org AND product_id = l.product_id AND qty_on_hand > 0;

    FOR b IN
      SELECT id, qty_on_hand, unit_cost, batch_code, expires_at
      FROM batches
      WHERE org_id = v_org
        AND product_id = l.product_id
        AND qty_on_hand > 0
      -- FIFO: hàng vào kho trước đi trước. `created_at` và `id` chỉ để
      -- hai lô cùng mốc vẫn có thứ tự cố định — không có chúng thì thứ
      -- tự do Postgres tự chọn, và mỗi lần chạy lại một khác.
      ORDER BY received_at ASC, created_at ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_take := LEAST(b.qty_on_hand, v_remaining);

      UPDATE batches
      SET qty_on_hand = qty_on_hand - v_take
      WHERE id = b.id;

      -- 119 — DÒNG DUY NHẤT THÊM VÀO HÀM NÀY.
      -- Trước đây chỉ lô lấy NHIỀU NHẤT được ghi vào stock_entry_lines.batch_id,
      -- phần còn lại nằm trong notes dạng chữ. Hoàn kho khi sửa hoặc huỷ đơn
      -- đã xuất thì không dò ngược được đã lấy bao nhiêu từ lô nào. Ghi lại
      -- từng lần lấy để trả đúng chỗ.
      INSERT INTO stock_line_consumptions (line_id, batch_id, qty_in_base_uom, unit_cost)
      VALUES (l.id, b.id, v_take, COALESCE(b.unit_cost, 0));

      v_cost_sum  := v_cost_sum + v_take * COALESCE(b.unit_cost, 0);
      v_qty_taken := v_qty_taken + v_take;
      v_remaining := v_remaining - v_take;
      v_lots      := v_lots + 1;

      IF v_take > v_best_qty THEN
        v_best_qty := v_take;
        v_best_id  := b.id;
      END IF;

      v_detail := v_detail
        || CASE WHEN v_detail = '' THEN '' ELSE ', ' END
        || COALESCE(b.batch_code, left(b.id::text, 8)) || '×' || v_take::text;

      -- Lấy một lô có hạn XA HƠN lô gần hạn nhất đang nằm trong kho:
      -- đúng cái giá phải trả của FIFO. Đếm lại để màn hình nói ra.
      IF v_min_expiry IS NOT NULL AND b.expires_at > v_min_expiry THEN
        v_near := v_near + 1;
      END IF;
    END LOOP;

    IF v_remaining > 0 THEN
      IF NOT v_allow_oversell THEN
        SELECT name INTO v_prod_name FROM products WHERE id = l.product_id;
        RAISE EXCEPTION
          'INSUFFICIENT_STOCK: thiếu % đơn vị của "%" — ghi sổ phiếu xuất sẽ làm tồn kho âm',
          v_remaining, COALESCE(v_prod_name, l.product_id::text)
          USING ERRCODE = 'P0001';
      END IF;
      -- Cho phép bán âm thì vẫn ghi sổ, nhưng cộng dồn để trả về. Im
      -- lặng ở đây là để người ta phát hiện ra vào lúc kiểm kê.
      v_short := v_short + v_remaining;
    END IF;

    -- Đóng giá vốn lên dòng. `batch_id` là khoá đơn nên chỉ giữ được MỘT
    -- lô — ghi lô lấy nhiều nhất, và ghi đủ danh sách vào notes để còn
    -- truy ngược được hạn dùng của hàng đã bán (hàng FMCG cần điều đó).
    UPDATE stock_entry_lines
    SET unit_cost = CASE WHEN v_qty_taken > 0
                         THEN v_cost_sum / v_qty_taken
                         ELSE unit_cost END,
        batch_id  = COALESCE(v_best_id, batch_id),
        notes     = CASE
                      WHEN v_lots > 1
                      THEN trim(both ' •' from COALESCE(l.notes, '')) ||
                           CASE WHEN COALESCE(l.notes, '') = '' THEN '' ELSE ' • ' END ||
                           'Lô: ' || v_detail
                      ELSE notes
                    END
    WHERE id = l.id;

    v_total_cost := v_total_cost + v_cost_sum;
  END LOOP;

  UPDATE stock_entries
  SET status = 'posted',
      posted_at = COALESCE(posted_at, now())
  WHERE id = p_entry_id;

  RETURN QUERY SELECT true, v_total_cost, v_short, v_near;
END;
$$;


-- =====================================================================
-- 9. Phiếu thu, dòng phiếu thu, khoản chi trả
-- =====================================================================

-- 9.1 Phiếu thu lập tay không gắn chuyến giao nào
DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'cash_receipts'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%delivery_settle%'
  LOOP
    EXECUTE format('ALTER TABLE cash_receipts DROP CONSTRAINT %I', v_name);
  END LOOP;
END $$;

ALTER TABLE cash_receipts DROP CONSTRAINT IF EXISTS chk_cash_receipts_source_type_v2;
ALTER TABLE cash_receipts
  ADD CONSTRAINT chk_cash_receipts_source_type_v2
  CHECK (source_type IN ('delivery_settle', 'manual', 'standalone'));

ALTER TABLE cash_receipts
  ADD COLUMN IF NOT EXISTS voided_at   timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by   uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS void_reason text;

-- 9.2 Dòng phiếu thu: tiền mặt hay cấn trừ đơn trả
ALTER TABLE cash_receipt_lines
  ADD COLUMN IF NOT EXISTS kind      text NOT NULL DEFAULT 'payment',
  ADD COLUMN IF NOT EXISTS return_id uuid REFERENCES returns(id);

ALTER TABLE cash_receipt_lines DROP CONSTRAINT IF EXISTS chk_cash_receipt_lines_kind;
ALTER TABLE cash_receipt_lines
  ADD CONSTRAINT chk_cash_receipt_lines_kind
  CHECK (kind IN ('payment', 'return_credit', 'credit_applied'));

COMMENT ON COLUMN cash_receipt_lines.kind IS
  'payment = khách trả tiền. return_credit = cấn trừ bằng đơn trả độc '
  'lập. credit_applied = chuyển SỐ DƯ CÓ của khách sang khoản nợ khác '
  '(Q11) — đi thành CẶP: một dòng ÂM rút ở khoản đang dư, một dòng DƯƠNG '
  'đắp vào khoản được thu. Nhờ đi theo cặp mà void_cash_receipt đảo được '
  'cả hai vế bằng đúng vòng lặp sẵn có, không cần biết gì thêm.';

-- 9.3 Khoản trả có thể là tiền, hoặc là khoản có từ đơn trả
DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'payments'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%ewallet%'
  LOOP
    EXECUTE format('ALTER TABLE payments DROP CONSTRAINT %I', v_name);
  END LOOP;
END $$;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_method_v2;
ALTER TABLE payments
  ADD CONSTRAINT chk_payments_method_v2
  CHECK (method IS NULL OR method IN ('cash', 'transfer', 'ewallet', 'return_credit', 'credit_applied'));

-- ⚠ `payments.amount` KHÔNG có ràng buộc dấu, và Q11 dựa vào điều đó: vế
--   rút của bút toán chuyển số dư có ghi một dòng ÂM. Đừng thêm
--   `CHECK (amount > 0)` — thêm là bút toán chuyển hết đường ghi, và
--   `void_cash_receipt` mất khả năng đảo bằng cùng một vòng lặp.


-- =====================================================================
-- 10. Thông báo và nhật ký sửa dòng
-- =====================================================================

DO $$
DECLARE
  v_name text;
BEGIN
  SELECT con.conname INTO v_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'notifications'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%order_pending_approval%'
  LIMIT 1;

  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I', v_name);
  END IF;
END $$;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'order_pending_approval',
    'order_approved',
    'order_cancelled',
    'order_completed',
    'order_edited',
    'return_completed',
    'payment_received',
    'receivable_overdue',
    'visit_logged',
    'customer_photo_missing',
    'info'
  ));

DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'order_activity_log'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%add_line%'
  LOOP
    EXECUTE format('ALTER TABLE order_activity_log DROP CONSTRAINT %I', v_name);
  END LOOP;
END $$;

ALTER TABLE order_activity_log DROP CONSTRAINT IF EXISTS chk_order_activity_log_action;
ALTER TABLE order_activity_log
  ADD CONSTRAINT chk_order_activity_log_action
  CHECK (action IN (
    'add_line', 'edit_line', 'remove_line',
    'edit_after_complete', 'cancel_after_complete'
  ));


-- =====================================================================
-- 11. Định nghĩa doanh thu
-- =====================================================================
-- ⚠ ĐỌC PHẦN "ĐỔI Ý NGHĨA SỐ LIỆU" Ở ĐẦU FILE trước khi đổi dòng này.
DROP FUNCTION IF EXISTS public.is_revenue_status(text);
CREATE FUNCTION public.is_revenue_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_status, '') = 'completed';
$$;

COMMENT ON FUNCTION public.is_revenue_status(text) IS
  'Đơn có được tính vào doanh thu không. v2: đúng đơn đã xuất hàng. '
  'Phiếu tạm chưa trừ kho, chưa sinh công nợ, nên chưa phải doanh thu.';

-- finance_pnl là hàm DUY NHẤT còn lọc doanh thu bằng giá trị trạng thái
-- viết thẳng. Mọi hàm lương/tổng quan khác đã gọi is_revenue_status từ
-- mig 094 nên tự đi theo.
-- DROP xoá sạch GRANT, nên phải cấp lại ngay bên dưới.
DROP FUNCTION IF EXISTS public.finance_pnl(date, date);
CREATE FUNCTION public.finance_pnl(p_from date, p_to date)
RETURNS TABLE (
  revenue        numeric,
  order_count    bigint,
  cogs           numeric,
  exp_cogs       numeric,
  exp_operating  numeric,
  exp_hr         numeric,
  exp_financial  numeric,
  exp_tax        numeric,
  exp_other      numeric,
  total_expenses numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH rev AS (
    SELECT COALESCE(SUM(COALESCE(total, 0)), 0) AS revenue, COUNT(*) AS order_count
    FROM sales_orders
    WHERE org_id = public.user_org_id()
      AND public.is_revenue_status(status)
      AND order_date >= p_from
      AND order_date <= p_to
  ),
  cogs AS (
    SELECT COALESCE(SUM(ABS(COALESCE(l.quantity, 0)) * COALESCE(l.unit_cost, 0)), 0) AS cogs
    FROM stock_entry_lines l
    JOIN stock_entries e ON e.id = l.entry_id
    WHERE e.org_id = public.user_org_id()
      AND e.type = 'export'
      AND e.status = 'posted'
      AND e.posted_at >= p_from::timestamptz
      AND e.posted_at <  (p_to + 1)::timestamptz
  ),
  exp AS (
    SELECT
      -- Danh mục không có bucket thì rơi vào 'other', giống mã cũ.
      COALESCE(ec.bucket, 'other') AS bucket,
      SUM(COALESCE(x.amount, 0))   AS amt
    FROM expenses x
    LEFT JOIN expense_categories ec ON ec.id = x.category_id
    WHERE x.org_id = public.user_org_id()
      AND x.expense_date >= p_from
      AND x.expense_date <= p_to
    GROUP BY COALESCE(ec.bucket, 'other')
  )
  SELECT
    rev.revenue,
    rev.order_count,
    cogs.cogs,
    COALESCE((SELECT amt FROM exp WHERE bucket = 'cogs'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'operating'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'hr'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'financial'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'tax'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'other'), 0),
    COALESCE((SELECT SUM(amt) FROM exp), 0)
  FROM rev, cogs;
$$;

GRANT EXECUTE ON FUNCTION public.finance_pnl(date, date) TO authenticated;


-- =====================================================================
-- 12. Máy trạng thái mới
-- =====================================================================
-- Bỏ toàn bộ ngưỡng duyệt 20tr/50tr: v2 không có bước duyệt. NPP mở
-- từng phiếu tạm ra xem rồi mới bấm Xuất hàng.
--
-- ⚠ HAI BƯỚC PHẢI ĐI QUA RPC
--   'submitted' → 'completed' trừ kho và sinh công nợ.
--   'completed' → 'cancelled' hoàn kho và xoá công nợ.
--   Làm hai việc đó bằng vài lệnh UPDATE rời từ trình duyệt là cách cũ
--   đã cho ra đơn 'đang giao' mà kho không trừ. RPC ở mig 120 đặt cờ
--   npp.via_rpc rồi mới đổi trạng thái; không có cờ thì chặn tại đây.
CREATE OR REPLACE FUNCTION public.check_order_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'draft' AND NEW.status NOT IN ('submitted', 'cancelled') THEN
    RAISE EXCEPTION 'Không thể chuyển từ nháp sang %', NEW.status
      USING ERRCODE = 'P0001';
  END IF;

  IF OLD.status = 'submitted' AND NEW.status NOT IN ('completed', 'cancelled', 'draft') THEN
    RAISE EXCEPTION 'Không thể chuyển từ phiếu tạm sang %', NEW.status
      USING ERRCODE = 'P0001';
  END IF;

  IF OLD.status = 'completed' AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'Đơn đã hoàn thành, chỉ có thể huỷ'
      USING ERRCODE = 'P0001';
  END IF;

  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'Đơn đã huỷ, không đổi trạng thái được nữa'
      USING ERRCODE = 'P0001';
  END IF;

  IF (OLD.status = 'submitted' AND NEW.status = 'completed')
     OR (OLD.status = 'completed' AND NEW.status = 'cancelled') THEN
    IF COALESCE(current_setting('npp.via_rpc', true), '') <> 'on' THEN
      RAISE EXCEPTION 'USE_RPC: dùng nút Xuất hàng / Hủy đơn'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.status = 'submitted' AND NEW.submitted_at IS NULL THEN
    NEW.submitted_at := now();
  END IF;
  IF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN
    NEW.cancelled_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_order_status ON sales_orders;
CREATE TRIGGER trg_check_order_status
  BEFORE UPDATE OF status ON sales_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.check_order_status_transition();


-- =====================================================================
-- 13. Phân quyền hàng
-- =====================================================================
--
-- ⚠ RLS KHÔNG BÁO LỖI KHI TỪ CHỐI. Lệnh UPDATE không khớp policy nào thì
--   Postgres sửa 0 dòng, PostgREST trả HTTP 200, error = null. Sai ở đây
--   là hỏng im lặng — màn hình báo "Đã lưu" cho một lệnh chưa chạy.
--
-- ⚠ NHÁNH TÀI XẾ ĐƯỢC GIỮ. Coder Pack nói giữ policy "Driver sees
--   delivery orders", nhưng policy đó đã bị mig 042 gộp vào
--   sales_order_select từ lâu. Giữ đúng phần việc của nó: nhánh cuối
--   trong policy SELECT dưới đây.

DROP POLICY IF EXISTS "Admin roles can view all orders" ON sales_orders;
DROP POLICY IF EXISTS "Sales see own orders" ON sales_orders;
DROP POLICY IF EXISTS "Driver sees delivery orders" ON sales_orders;
DROP POLICY IF EXISTS sales_order_select ON sales_orders;
DROP POLICY IF EXISTS "Owner/Manager can update orders" ON sales_orders;
DROP POLICY IF EXISTS "Admin roles can update orders" ON sales_orders;
DROP POLICY IF EXISTS "Sales can update own draft orders" ON sales_orders;
DROP POLICY IF EXISTS "Sales can update own open orders" ON sales_orders;
DROP POLICY IF EXISTS "Owner/Manager can delete draft or cancelled orders" ON sales_orders;
DROP POLICY IF EXISTS "Sales can delete own draft orders" ON sales_orders;

-- Nháp là sổ tay riêng của NVBH: chưa gửi thì NPP không nhìn thấy.
CREATE POLICY sales_order_select ON sales_orders
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND (status <> 'draft' OR sales_user_id = auth.uid())
    AND (
      public.user_role() IN ('owner', 'manager', 'accountant', 'warehouse')
      OR public.user_has_permission(auth.uid(), 'customer.view_all')
      OR sales_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM customer_assignments ca
        WHERE ca.customer_id = sales_orders.customer_id
          AND ca.user_id = auth.uid()
          AND ca.status = 'active'
      )
      OR (
        public.user_role() = 'driver'
        AND id IN (
          SELECT dl.order_id FROM delivery_lines dl
          JOIN deliveries d ON d.id = dl.delivery_id
          WHERE d.driver_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Admin roles can update orders" ON sales_orders
  FOR UPDATE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'warehouse')
  )
  WITH CHECK (org_id = public.user_org_id());

-- NVBH sửa đơn của mình khi còn nháp hoặc còn là phiếu tạm; được phép
-- tự huỷ (WITH CHECK có 'cancelled') nhưng không kéo ngược đơn đã xuất.
CREATE POLICY "Sales can update own open orders" ON sales_orders
  FOR UPDATE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'sales'
    AND sales_user_id = auth.uid()
    AND status IN ('draft', 'submitted')
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND sales_user_id = auth.uid()
    AND status IN ('draft', 'submitted', 'cancelled')
  );

COMMENT ON POLICY "Sales can update own open orders" ON sales_orders IS
  'Phải khớp SALES_EDITABLE_STATUSES trong src/lib/orders/edit-permission.ts.';

-- Đơn từng xuất kho thì không xoá, kể cả khi đã huỷ: hồ sơ kho còn đó.
CREATE POLICY "Owner/Manager can delete draft or cancelled orders"
  ON sales_orders FOR DELETE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
    AND status IN ('draft', 'cancelled')
    AND completed_at IS NULL
  );

CREATE POLICY "Sales can delete own draft orders"
  ON sales_orders FOR DELETE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'sales'
    AND sales_user_id = auth.uid()
    AND status = 'draft'
  );

-- Dòng hàng của đơn đã hoàn thành chỉ đổi được qua RPC sửa đơn.
DROP POLICY IF EXISTS "Admin roles can manage order lines" ON sales_order_lines;
CREATE POLICY "Admin roles can manage order lines" ON sales_order_lines
  FOR ALL
  USING (
    public.user_role() IN ('owner', 'manager', 'warehouse')
    AND EXISTS (
      SELECT 1 FROM sales_orders so
      WHERE so.id = order_id
        AND so.org_id = public.user_org_id()
        AND (
          so.status <> 'completed'
          OR COALESCE(current_setting('npp.via_rpc', true), '') = 'on'
        )
    )
  );

DROP POLICY IF EXISTS "Sales can manage lines of own open orders" ON sales_order_lines;
CREATE POLICY "Sales can manage lines of own open orders" ON sales_order_lines
  FOR ALL
  USING (
    public.user_role() = 'sales'
    AND EXISTS (
      SELECT 1 FROM sales_orders so
      WHERE so.id = order_id
        AND so.org_id = public.user_org_id()
        AND so.sales_user_id = auth.uid()
        AND so.status IN ('draft', 'submitted')
    )
  )
  WITH CHECK (
    public.user_role() = 'sales'
    AND EXISTS (
      SELECT 1 FROM sales_orders so
      WHERE so.id = order_id
        AND so.org_id = public.user_org_id()
        AND so.sales_user_id = auth.uid()
        AND so.status IN ('draft', 'submitted')
    )
  );


-- =====================================================================
-- 14. Quyền thực thi
-- =====================================================================
-- Hàm trigger không cấp cho ai gọi thẳng.
REVOKE ALL ON FUNCTION public.enforce_return_line_cap()        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_order_status_transition()  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_return_credited_at()        FROM PUBLIC;

GRANT SELECT ON stock_line_consumptions TO authenticated;


NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- 15. Đếm lại sau khi backfill
-- =====================================================================

DO $$
DECLARE
  r record;
  v_no_export int;
BEGIN
  FOR r IN
    SELECT status, count(*) AS n FROM sales_orders GROUP BY status ORDER BY status
  LOOP
    RAISE NOTICE '119 đơn hàng — %: %', r.status, r.n;
  END LOOP;

  FOR r IN
    SELECT status, count(*) AS n FROM returns GROUP BY status ORDER BY status
  LOOP
    RAISE NOTICE '119 đơn trả — %: %', r.status, r.n;
  END LOOP;

  -- Coder Pack mục 1: đơn đang ở Hoàn thành mà chưa từng có phiếu xuất
  -- ghi sổ. Đây là đơn có trước mig 107 — tồn kho chưa bao giờ bị trừ
  -- cho chúng. Chỉ liệt kê cho chủ NPP kiểm tay, KHÔNG tự xử.
  SELECT count(*) INTO v_no_export
  FROM sales_orders so
  WHERE so.status = 'completed'
    AND NOT EXISTS (
      SELECT 1 FROM stock_entries se
       WHERE se.type = 'export'
         AND se.status = 'posted'
         AND se.ref_order_ids @> jsonb_build_array(so.id::text));

  IF v_no_export > 0 THEN
    RAISE NOTICE '119 ⚠ % đơn Hoàn thành KHÔNG có phiếu xuất đã ghi sổ — tồn kho chưa từng bị trừ cho các đơn này:', v_no_export;
    FOR r IN
      SELECT so.order_code
      FROM sales_orders so
      WHERE so.status = 'completed'
        AND NOT EXISTS (
          SELECT 1 FROM stock_entries se
           WHERE se.type = 'export'
             AND se.status = 'posted'
             AND se.ref_order_ids @> jsonb_build_array(so.id::text))
      ORDER BY so.order_date DESC, so.order_code
    LOOP
      RAISE NOTICE '119    %', r.order_code;
    END LOOP;
  END IF;
END $$;


-- ####################################################################
-- # 120_workflow_v2_rpcs.sql
-- ####################################################################

-- ---------------------------------------------------------------------
-- 120 — Workflow v2: các RPC làm việc nặng
-- ---------------------------------------------------------------------
--
-- VÌ SAO PHẢI LÀ RPC
--   Xuất hàng = trừ kho FIFO + sinh công nợ + đổi trạng thái + mở phiếu
--   trả kèm đơn. Bốn việc, một ý nghĩa: hoặc xong cả bốn, hoặc không việc
--   nào. Làm bằng bốn lệnh rời từ trình duyệt thì mạng chập giữa chừng là
--   kho đã trừ mà công nợ chưa sinh, và không ai biết để sửa. Mỗi hàm ở
--   đây là MỘT giao dịch.
--
--   Migration 119 đã chặn đường tắt: đổi 'submitted' → 'completed' hoặc
--   'completed' → 'cancelled' bằng UPDATE thẳng sẽ RAISE 'USE_RPC'. Các
--   hàm dưới đây bật cờ `npp.via_rpc` trong giao dịch của mình rồi mới
--   đổi trạng thái.
--
-- ⚠ TRIGGER NHẬP KHO TỰ ĐỘNG CỦA ĐƠN TRẢ BỊ GỠ Ở ĐÂY
--   trg_auto_restock_return (mig 008) tự tạo phiếu nhập mỗi khi phiếu trả
--   sang 'completed'. Từ nay complete_return() làm việc đó. Để cả hai là
--   nhập kho HAI LẦN cho một lần trả hàng, tồn tăng gấp đôi và không có
--   gì báo. Chủ nhà đã chốt: "Hoàn thành đơn trả mới nhập kho."
--   Trigger cũ cũng không chọn được kho nhận (kho bán hay kho date) —
--   đúng thứ mục 3.4 cần.
--
-- ⚠ QUY ƯỚC BÁO LỖI
--   Mọi RAISE dùng ERRCODE 'P0001' và mở đầu bằng MÃ viết hoa
--   (LOCKED_HAS_PAYMENT: …) để giao diện tách mã ra rồi hiện đúng lý do,
--   thay vì ném nguyên câu tiếng Việt lên màn hình.
--
-- ⚠ QUYỀN
--   Kiểm bằng public.user_has_permission(auth.uid(), '<module>.<action>').
--   Hàm đó tách khoá tại DẤU CHẤM CUỐI rồi tra role_permissions(module,
--   action), nên khoá phải là cặp có thật trong ma trận: 'orders.approve',
--   'orders.update', 'returns.approve', 'receivables.create',
--   'receivables.update'. Chủ sở hữu luôn qua.
-- ---------------------------------------------------------------------


-- =====================================================================
-- 0. Gỡ trigger nhập kho tự động của đơn trả
-- =====================================================================

DROP TRIGGER  IF EXISTS trg_auto_restock_return ON returns;
DROP FUNCTION IF EXISTS public.auto_restock_on_return();


-- =====================================================================
-- 0b. Lý do huỷ phiếu trả
-- =====================================================================
-- cancel_return nhận p_reason nhưng bảng chưa có chỗ chứa. Người dùng gõ
-- lý do, hệ thống báo thành công, mở lại không thấy gì — với phiếu đã
-- nhập kho rồi bị đảo thì đó là mất dấu vết của một lần đụng tồn kho.
ALTER TABLE returns ADD COLUMN IF NOT EXISTS cancel_reason text;


-- =====================================================================
-- 0c. Mở đúng những ô quyền các RPC dưới đây cần
-- =====================================================================
-- ⚠ user_has_permission trả FALSE khi role_permissions chưa có dòng —
--   không có ma trận mặc định phía CSDL, bản mặc định chỉ nằm trong
--   TypeScript. Không seed thì sau khi chạy 120, mọi vai trò TRỪ chủ sở
--   hữu đều bị từ chối: quản lý bấm Xuất hàng ra 'FORBIDDEN', kế toán
--   không lập được phiếu thu, trong khi giao diện vẫn hiện nút.
--   Chỉ chèn đúng các ô theo DEFAULT_PERMISSION_MAP (src/lib/permissions.ts),
--   và ON CONFLICT DO NOTHING để không đè lên lựa chọn tổ chức đã cấu hình.
INSERT INTO role_permissions (org_id, role, module, action, allowed)
SELECT o.id, v.role, v.module, v.action, true
FROM organizations o
CROSS JOIN (VALUES
  ('manager',    'orders',      'approve'),
  ('manager',    'orders',      'update'),
  ('manager',    'returns',     'approve'),
  ('sales',      'orders',      'update'),
  ('accountant', 'receivables', 'create'),
  ('accountant', 'receivables', 'update'),
  ('sales',      'receivables', 'create')
) AS v(role, module, action)
ON CONFLICT (org_id, role, module, action) DO NOTHING;


-- =====================================================================
-- 1. Helper nội bộ (không cấp quyền gọi trực tiếp)
-- =====================================================================

-- 1.1 Thông báo cho một người. Bỏ qua khi không biết gửi cho ai.
CREATE OR REPLACE FUNCTION public._wf2_notify(
  p_user_id uuid, p_type text, p_title text, p_body text, p_link text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  SELECT org_id INTO v_org FROM users WHERE id = p_user_id;
  IF v_org IS NULL THEN RETURN; END IF;
  INSERT INTO notifications (org_id, user_id, type, title, body, link_url)
  VALUES (v_org, p_user_id, p_type, p_title, p_body, p_link);
END;
$$;

-- 1.2 Tính lại công nợ của một đơn.
--
-- Port từ recomputeReceivableForOrder (src/lib/returns.ts:192). Khác một
-- điểm: bản TS cộng credit của phiếu trả 'approved' lẫn 'completed'.
-- Workflow v2 không còn 'approved', và phiếu tạm thì chưa trừ nợ của ai —
-- chỉ 'completed' mới tính.
--
-- ⚠ KHÔNG đụng tới `paid`. Số đã thu là sự thật do phiếu thu ghi; tính
--   lại công nợ mà đè lên nó là xoá tiền khách đã trả.
CREATE OR REPLACE FUNCTION public._wf2_recompute_receivable(p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o          record;
  v_credits  numeric;
  v_net      numeric;
  v_id       uuid;
  v_paid     numeric;
  v_days     int;
BEGIN
  SELECT id, org_id, customer_id, sales_user_id, total, payment_terms, order_date, status
    INTO o
  FROM sales_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(sum(COALESCE(credit_note_amount, 0)), 0) INTO v_credits
  FROM returns
  WHERE order_id = p_order_id AND status = 'completed';

  v_net := GREATEST(0, COALESCE(o.total, 0) - v_credits);

  SELECT id, COALESCE(paid, 0) INTO v_id, v_paid
  FROM receivables WHERE order_id = p_order_id LIMIT 1;

  -- ⚠ Chỉ ĐƠN ĐÃ XUẤT mới sinh công nợ. Hoàn thành một phiếu trả gắn vào
  --   đơn còn là phiếu tạm mà tạo công nợ ở đây thì khách bị ghi nợ một
  --   đơn chưa giao, và doanh thu vẫn bằng 0 — hai sổ nói hai đằng.
  IF v_id IS NULL AND o.status <> 'completed' THEN
    RETURN NULL;
  END IF;

  -- ⚠ Q11 — TỪNG CHẶN Ở ĐÂY, NAY CHO QUA. Khi khách trả hàng sau khi đã
  --   thanh toán đủ thì `paid > amount`. Bản trước RAISE
  --   'OVERPAID_AFTER_CREDIT' và rollback CẢ `complete_return` — kể cả
  --   phần nhập kho — kèm lời khuyên "huỷ phiếu thu trước". Nhưng nếu
  --   tiền vào qua màn thu theo công nợ thì KHÔNG có phiếu thu nào để
  --   huỷ, nên phiếu trả kẹt vĩnh viễn và hàng khách trả không bao giờ
  --   vào kho được.
  --
  --   Chủ nhà chọn phương án (a): `paid > amount` là HỢP LỆ, phần dư là
  --   SỐ DƯ CÓ của khách. Khối UPDATE ngay dưới đã đúng sẵn cho ca này:
  --   nhánh `v_paid >= v_net` bắt luôn trường hợp lớn hơn và đặt status
  --   'paid', nghĩa là "không còn gì để đòi".
  --
  -- ⚠ KHÔNG thêm giá trị mới vào `receivables.status`. Ràng buộc CHECK
  --   của nó là ẩn danh từ mig 001, và mọi bộ lọc trong kho đều dùng
  --   `status <> 'paid'` để nói "đã tất toán, đừng tính nữa" — đúng ý.
  --
  -- ⚠ HỆ QUẢ ĐÃ BÁO CHỦ NHÀ: `paid > 0` là điều kiện khoá ở
  --   `_wf2_assert_order_unlocked` và `cancel_return`. Dòng dư luôn có
  --   `paid > 0`, nên đơn gốc hết sửa/huỷ được và chính phiếu trả vừa
  --   cứu khỏi kẹt thì không huỷ lại được. Đó là cái giá của (a).

  IF v_id IS NOT NULL THEN
    UPDATE receivables
    SET amount = v_net,
        status = CASE
                   WHEN v_paid >= v_net THEN 'paid'
                   WHEN v_paid > 0      THEN 'partial'
                   ELSE 'open'
                 END
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  -- NETxx → số ngày; mọi thứ khác (COD, rỗng) = 0 ngày. Giống hệt
  -- paymentTermsToDays trong src/lib/returns.ts:273.
  v_days := COALESCE(
    (substring(upper(COALESCE(o.payment_terms, '')) FROM 'NET([0-9]+)'))::int, 0);

  INSERT INTO receivables (
    org_id, order_id, customer_id, sales_user_id, amount, paid, due_date, status
  ) VALUES (
    o.org_id, o.id, o.customer_id, o.sales_user_id, v_net, 0,
    COALESCE(o.order_date, current_date) + v_days, 'open'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 1.3 Dựng phiếu xuất rồi ghi sổ ngay.
--
-- p_lines: mảng jsonb, mỗi phần tử
--   { product_id, unit_name, quantity, conversion_factor, note? }
--
-- ⚠ RAISE của post_stock_export (INSUFFICIENT_STOCK khi tổ chức không cho
--   bán âm) làm rollback CẢ giao dịch — phiếu vừa dựng cũng biến mất. Đó
--   là điều mong muốn: không để lại phiếu rác khi xuất hàng thất bại.
CREATE OR REPLACE FUNCTION public._wf2_export_order(
  p_order_id uuid, p_lines jsonb, p_note text
) RETURNS TABLE (entry_id uuid, short_qty numeric, near_expiry_skipped int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org   uuid;
  v_entry uuid;
BEGIN
  SELECT org_id INTO v_org FROM sales_orders WHERE id = p_order_id;

  INSERT INTO stock_entries (
    org_id, entry_code, type, status, created_by, notes, ref_order_ids
  ) VALUES (
    v_org,
    'XK-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS'),
    'export', 'draft', auth.uid(), p_note,
    jsonb_build_array(p_order_id::text)
  )
  RETURNING id INTO v_entry;

  -- `quantity` là cột integer từ mig 001, chỉ để hiển thị. Số thật nằm ở
  -- qty_in_transaction_uom / qty_in_base_uom (numeric) — FIFO đọc cột sau.
  INSERT INTO stock_entry_lines (
    entry_id, product_id, unit_name, quantity,
    qty_in_transaction_uom, qty_in_base_uom, transaction_uom,
    conversion_factor_snapshot, notes
  )
  SELECT
    v_entry,
    (l->>'product_id')::uuid,
    l->>'unit_name',
    round((l->>'quantity')::numeric)::int,
    (l->>'quantity')::numeric,
    (l->>'quantity')::numeric * COALESCE((l->>'conversion_factor')::numeric, 1),
    l->>'unit_name',
    COALESCE((l->>'conversion_factor')::numeric, 1),
    NULLIF(l->>'note', '')
  FROM jsonb_array_elements(p_lines) AS l
  WHERE COALESCE((l->>'quantity')::numeric, 0) > 0;

  RETURN QUERY
  SELECT v_entry, p.short_qty, p.near_expiry_skipped
  FROM post_stock_export(v_entry) p;
END;
$$;

-- 1.4 Hoàn hàng về ĐÚNG các lô đã lấy, thứ tự ngược (lô lấy sau trả trước).
--
-- ⚠ Dòng xuất cũ (trước mig 119) không có dấu vết FIFO. Khi đó hoàn về lô
--   ghi trên chính dòng đó; dòng không ghi lô nào thì về lô mới nhất cùng
--   sản phẩm ở kho bán. Không đoán thêm, và ghi rõ trong ghi chú dòng
--   nhập để người kiểm kê biết con số này kém chắc hơn.
CREATE OR REPLACE FUNCTION public._wf2_restock(
  p_source_line_id uuid, p_qty_base numeric, p_note text, p_entry_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_left    numeric := p_qty_base;
  v_give    numeric;
  c         record;
  v_product uuid;
  v_unit    text;
  v_conv    numeric;
  v_cost    numeric;
  v_batch   uuid;
  v_first   uuid;
  v_note    text := p_note;
BEGIN
  IF COALESCE(p_qty_base, 0) <= 0 THEN RETURN; END IF;

  SELECT product_id, unit_name, COALESCE(conversion_factor_snapshot, 1), COALESCE(unit_cost, 0), batch_id
    INTO v_product, v_unit, v_conv, v_cost, v_batch
  FROM stock_entry_lines WHERE id = p_source_line_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Hệ số quy đổi 0 hoặc âm thì phép chia ở cuối hàm trả NULL, và cột
  -- quantity là NOT NULL — lỗi 23502 ở một chỗ chẳng liên quan gì.
  IF COALESCE(v_conv, 0) <= 0 THEN v_conv := 1; END IF;

  -- ⚠ TRỪ DẦN dấu vết đã hoàn. Không trừ thì lần hoàn sau lại thấy đủ số
  --   cũ: sửa đơn giảm 4 rồi huỷ đơn sẽ hoàn thêm cả 10, kho dôi ra 4
  --   thùng không có thật.
  FOR c IN
    SELECT id, batch_id, qty_in_base_uom
    FROM stock_line_consumptions
    WHERE line_id = p_source_line_id AND qty_in_base_uom > 0
    ORDER BY created_at DESC, id DESC
    FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_give := LEAST(c.qty_in_base_uom, v_left);
    UPDATE batches SET qty_on_hand = qty_on_hand + v_give WHERE id = c.batch_id;
    UPDATE stock_line_consumptions
    SET qty_in_base_uom = qty_in_base_uom - v_give
    WHERE id = c.id;
    v_left := v_left - v_give;
    v_first := COALESCE(v_first, c.batch_id);
  END LOOP;

  IF v_left > 0 THEN
    IF v_batch IS NULL THEN
      SELECT id INTO v_batch
      FROM batches
      WHERE product_id = v_product AND warehouse_zone = 'sale'
      ORDER BY received_at DESC NULLS LAST, created_at DESC
      LIMIT 1;
    END IF;
    IF v_batch IS NOT NULL THEN
      UPDATE batches SET qty_on_hand = qty_on_hand + v_left WHERE id = v_batch;
      v_first := COALESCE(v_first, v_batch);
      v_note := v_note || ' • phần không có dấu vết lô, hoàn về lô gần nhất';
      v_left := 0;
    END IF;
  END IF;

  IF v_left > 0 THEN
    RAISE EXCEPTION 'NO_BATCH_TO_RESTOCK: không tìm được lô để hoàn % đơn vị', v_left
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO stock_entry_lines (
    entry_id, product_id, batch_id, unit_name, quantity,
    qty_in_transaction_uom, qty_in_base_uom, transaction_uom,
    conversion_factor_snapshot, unit_cost, notes
  ) VALUES (
    p_entry_id, v_product, v_first, v_unit,
    round(p_qty_base / NULLIF(v_conv, 0))::int,
    p_qty_base / NULLIF(v_conv, 0), p_qty_base, v_unit,
    v_conv, v_cost, v_note
  );
END;
$$;


-- =====================================================================
-- 2. Xuất hàng
-- =====================================================================
-- Gọi lần hai trên đơn đã xuất KHÔNG xuất lại: RAISE ORDER_NOT_SUBMITTED
-- để màn hình biết mà tải lại, thay vì trừ kho thêm lần nữa.
CREATE OR REPLACE FUNCTION public.complete_order(p_order_id uuid)
RETURNS TABLE (
  entry_id uuid, receivable_id uuid, return_id uuid,
  short_qty numeric, near_expiry_skipped int
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o        record;
  v_lines  jsonb;
  v_exp    record;
  v_rec    uuid;
  v_ret    uuid;
BEGIN
  SELECT id, org_id, order_code, status, sales_user_id INTO o
  FROM sales_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF o.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.user_has_permission(auth.uid(), 'orders.approve') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền xuất hàng' USING ERRCODE = 'P0001';
  END IF;
  IF o.status <> 'submitted' THEN
    RAISE EXCEPTION 'ORDER_NOT_SUBMITTED: đơn % không ở Phiếu tạm', o.order_code
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('npp.via_rpc', 'on', true);

  -- Hàng theo đơn, cộng hàng đem đổi của phiếu trả kèm đơn (còn nháp):
  -- khách đổi hàng thì hàng mới cũng rời kho trong chính chuyến này.
  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_lines FROM (
    SELECT jsonb_build_object(
             'product_id', sol.product_id,
             'unit_name',  sol.unit_name,
             'quantity',   sol.quantity,
             'conversion_factor', COALESCE(sol.conversion_factor, 1),
             'note', sol.note) AS x
    FROM sales_order_lines sol WHERE sol.order_id = p_order_id
    UNION ALL
    SELECT jsonb_build_object(
             'product_id', rl.product_id,
             'unit_name',  rl.unit_name,
             'quantity',   rl.quantity,
             'conversion_factor', COALESCE((
               SELECT pu.conversion FROM product_units pu
                WHERE pu.product_id = rl.product_id AND pu.unit_name = rl.unit_name), 1),
             'note', '[Exchange]') AS x
    FROM return_lines rl
    JOIN returns r ON r.id = rl.return_id
    WHERE r.order_id = p_order_id AND r.status = 'draft' AND rl.is_exchange = true
  ) s;

  SELECT * INTO v_exp
  FROM public._wf2_export_order(p_order_id, v_lines, 'Xuất theo đơn ' || o.order_code);

  UPDATE sales_orders
  SET status = 'completed', completed_at = now(), completed_by = auth.uid()
  WHERE id = p_order_id;

  v_rec := public._wf2_recompute_receivable(p_order_id);

  -- Phiếu trả kèm đơn đang nháp: đơn đã xuất thì phiếu trả thành phiếu tạm
  -- để NPP xử lý tiếp.
  -- ⚠ KHÔNG dùng RETURNING … INTO ở đây: lệnh DML trả nhiều hơn một dòng
  --   là lỗi 21000, và một đơn có thể có vài phiếu trả nháp.
  UPDATE returns SET status = 'submitted'
  WHERE order_id = p_order_id AND status = 'draft';

  SELECT id INTO v_ret FROM returns
  WHERE order_id = p_order_id AND status = 'submitted'
  ORDER BY created_at LIMIT 1;

  PERFORM public._wf2_notify(
    o.sales_user_id, 'order_completed',
    'Đơn ' || o.order_code || ' đã xuất hàng', NULL,
    '/orders/' || p_order_id::text);

  RETURN QUERY SELECT v_exp.entry_id, v_rec, v_ret, v_exp.short_qty, v_exp.near_expiry_skipped;
END;
$$;


-- 1.5 Các khoá chung cho sửa và huỷ đơn ĐÃ XUẤT.
--
-- p_check_age: chỉ bật khi SỬA. Huỷ đơn đã xuất không bị chặn bởi hạn
-- sửa — hàng có thể quay về kho muộn hơn thế, và chặn ở đây thì đơn sai
-- nằm lại vĩnh viễn.
CREATE OR REPLACE FUNCTION public._wf2_assert_order_unlocked(
  p_order_id uuid, p_order_date date, p_check_age boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_days int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM receivables r WHERE r.order_id = p_order_id AND COALESCE(r.paid, 0) > 0
  ) OR EXISTS (
    SELECT 1 FROM cash_receipt_lines crl
    JOIN cash_receipts cr ON cr.id = crl.receipt_id
    WHERE crl.order_id = p_order_id AND cr.status <> 'voided'
  ) THEN
    RAISE EXCEPTION 'LOCKED_HAS_PAYMENT: đơn đã có tiền thu, huỷ phiếu thu trước'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_check_age THEN
    SELECT COALESCE(completed_edit_days, 1) INTO v_days
    FROM organizations WHERE id = public.user_org_id();
    IF COALESCE(p_order_date, current_date) < current_date - v_days THEN
      RAISE EXCEPTION 'LOCKED_TOO_OLD: quá % ngày kể từ ngày đặt', v_days
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- "Đã phát hành" = hoá đơn nội bộ đã chốt, hoặc MISA đã cấp số / đã ký.
  IF EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.order_id = p_order_id
      AND (i.status = 'issued'
           OR i.misa_inv_no IS NOT NULL
           OR i.misa_status IN ('signed', 'replaced'))
  ) THEN
    RAISE EXCEPTION 'LOCKED_EINVOICE: đơn đã phát hành hoá đơn điện tử'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM returns r WHERE r.order_id = p_order_id AND r.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'LOCKED_RETURN_DONE: đơn đã có phiếu trả hoàn thành'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;


-- =====================================================================
-- 3. Sửa đơn đã hoàn thành
-- =====================================================================
-- p_lines là TOÀN BỘ dòng mong muốn sau khi sửa. Dòng không có `id` là
-- thêm mới; `id` cũ không còn trong mảng là xoá.
--
-- ⚠ BỐN KHOÁ. Sửa đơn đã xuất là đụng vào kho và công nợ đã chốt sổ. Khi
--   đã có tiền vào, đã quá hạn sửa, đã phát hành hoá đơn, hoặc đã có phiếu
--   trả hoàn thành gắn vào đơn — thì không sửa nữa, phải đi đường chứng
--   từ khác.
CREATE OR REPLACE FUNCTION public.edit_completed_order(
  p_order_id uuid, p_lines jsonb, p_subtotal numeric, p_vat numeric,
  p_total numeric, p_notes text
) RETURNS TABLE (export_entry_id uuid, import_entry_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o         record;
  v_sum     numeric;
  v_delta   jsonb;
  v_add     jsonb;
  v_exp     record;
  v_imp     uuid;
  d         record;
  s         record;
  v_need    numeric;
  v_take    numeric;
  v_old     numeric;
BEGIN
  SELECT id, org_id, order_code, status, order_date, total, sales_user_id INTO o
  FROM sales_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF o.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.user_has_permission(auth.uid(), 'orders.update') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền sửa đơn' USING ERRCODE = 'P0001';
  END IF;
  -- ⚠ Hàm là SECURITY DEFINER nên bỏ qua RLS. Không kiểm chủ đơn ở đây thì
  --   NVBH sửa được đơn đã xuất của người khác, kéo theo kho, công nợ và
  --   doanh số của họ.
  IF public.user_role() = 'sales' AND o.sales_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'FORBIDDEN_NOT_OWNER: chỉ sửa được đơn của mình'
      USING ERRCODE = 'P0001';
  END IF;
  IF o.status <> 'completed' THEN
    RAISE EXCEPTION 'LOCKED_NOT_COMPLETED: đơn % chưa xuất hàng', o.order_code
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM public._wf2_assert_order_unlocked(p_order_id, o.order_date, true);

  SELECT COALESCE(sum((l->>'line_total')::numeric), 0) INTO v_sum
  FROM jsonb_array_elements(p_lines) AS l;
  IF abs(COALESCE(p_subtotal, 0) - v_sum) > 1 THEN
    RAISE EXCEPTION 'TOTAL_MISMATCH: tạm tính % không khớp tổng dòng %', p_subtotal, v_sum
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('npp.via_rpc', 'on', true);

  -- Chênh lệch theo (sản phẩm, đơn vị), quy về base UOM.
  --
  -- ⚠ Dùng biến jsonb chứ KHÔNG dùng bảng tạm: hai lần gọi hàm trong cùng
  --   một giao dịch sẽ đụng "bảng tạm đã tồn tại", và lỗi đó chỉ hiện ra
  --   khi có người sửa hai đơn liền tay.
  WITH new_l AS (
    SELECT (l->>'product_id')::uuid AS product_id,
           l->>'unit_name' AS unit_name,
           sum((l->>'quantity')::numeric * COALESCE((l->>'conversion_factor')::numeric, 1)) AS qty
    FROM jsonb_array_elements(p_lines) AS l
    GROUP BY 1, 2
  ), old_l AS (
    SELECT product_id, unit_name,
           sum(quantity * COALESCE(conversion_factor, 1)) AS qty
    FROM sales_order_lines WHERE order_id = p_order_id
    GROUP BY 1, 2
  ), d AS (
    SELECT COALESCE(n.product_id, o2.product_id) AS product_id,
           COALESCE(n.unit_name, o2.unit_name)   AS unit_name,
           COALESCE(n.qty, 0) - COALESCE(o2.qty, 0) AS delta
    FROM new_l n FULL OUTER JOIN old_l o2
      ON o2.product_id = n.product_id AND o2.unit_name = n.unit_name
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id', product_id, 'unit_name', unit_name, 'delta', delta)), '[]'::jsonb)
    INTO v_delta
  FROM d WHERE delta <> 0;

  -- Phần TĂNG: xuất thêm.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id', (x->>'product_id')::uuid,
           'unit_name',  x->>'unit_name',
           'quantity',   (x->>'delta')::numeric / NULLIF(COALESCE((
             SELECT pu.conversion FROM product_units pu
              WHERE pu.product_id = (x->>'product_id')::uuid
                AND pu.unit_name = x->>'unit_name'), 1), 0),
           'conversion_factor', COALESCE((
             SELECT pu.conversion FROM product_units pu
              WHERE pu.product_id = (x->>'product_id')::uuid
                AND pu.unit_name = x->>'unit_name'), 1))), '[]'::jsonb)
    INTO v_add
  FROM jsonb_array_elements(v_delta) AS x
  WHERE (x->>'delta')::numeric > 0;

  IF jsonb_array_length(v_add) > 0 THEN
    SELECT * INTO v_exp
    FROM public._wf2_export_order(p_order_id, v_add, 'Sửa đơn ' || o.order_code);
    export_entry_id := v_exp.entry_id;
  END IF;

  -- Phần GIẢM: hoàn về đúng lô đã lấy.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_delta) AS x WHERE (x->>'delta')::numeric < 0) THEN
    INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, notes)
    VALUES (o.org_id,
            'NK-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS'),
            'import', 'posted', now(), auth.uid(),
            'Hoàn kho do sửa đơn ' || o.order_code)
    RETURNING id INTO v_imp;
    import_entry_id := v_imp;

    FOR d IN
      SELECT (x->>'product_id')::uuid AS product_id,
             x->>'unit_name' AS unit_name,
             (x->>'delta')::numeric AS delta
      FROM jsonb_array_elements(v_delta) AS x
      WHERE (x->>'delta')::numeric < 0
    LOOP
      v_need := -d.delta;
      FOR s IN
        SELECT sel.id,
               COALESCE((SELECT sum(slc.qty_in_base_uom)
                           FROM stock_line_consumptions slc
                          WHERE slc.line_id = sel.id), sel.qty_in_base_uom) AS qty_in_base_uom
        FROM stock_entry_lines sel
        JOIN stock_entries se ON se.id = sel.entry_id
        WHERE se.type = 'export' AND se.status = 'posted'
          AND se.ref_order_ids @> jsonb_build_array(p_order_id::text)
          AND sel.product_id = d.product_id
          AND sel.unit_name = d.unit_name
        ORDER BY se.posted_at DESC, sel.id DESC
      LOOP
        EXIT WHEN v_need <= 0;
        v_take := LEAST(s.qty_in_base_uom, v_need);
        PERFORM public._wf2_restock(s.id, v_take, 'Hoàn kho do sửa đơn ' || o.order_code, v_imp);
        v_need := v_need - v_take;
      END LOOP;
      IF v_need > 0 THEN
        RAISE EXCEPTION 'NO_EXPORT_TO_REVERSE: không tìm được dòng xuất để hoàn % đơn vị', v_need
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;

  -- Ghi lại dòng đơn. Trigger mig 052 tự ghi nhật ký từng dòng.
  DELETE FROM sales_order_lines
  WHERE order_id = p_order_id
    AND id NOT IN (
      SELECT NULLIF(l->>'id', '')::uuid FROM jsonb_array_elements(p_lines) AS l
      WHERE NULLIF(l->>'id', '') IS NOT NULL);

  UPDATE sales_order_lines sol
  SET product_id = (l->>'product_id')::uuid,
      unit_name  = l->>'unit_name',
      quantity   = (l->>'quantity')::numeric,
      unit_price = (l->>'unit_price')::numeric,
      line_discount = COALESCE((l->>'line_discount')::numeric, 0),
      line_total = (l->>'line_total')::numeric,
      conversion_factor = COALESCE((l->>'conversion_factor')::numeric, 1),
      note = NULLIF(l->>'note', '')
  FROM jsonb_array_elements(p_lines) AS l
  WHERE sol.id = NULLIF(l->>'id', '')::uuid AND sol.order_id = p_order_id;

  INSERT INTO sales_order_lines (
    order_id, product_id, unit_name, quantity, unit_price,
    line_discount, line_total, conversion_factor, note
  )
  SELECT p_order_id, (l->>'product_id')::uuid, l->>'unit_name',
         (l->>'quantity')::numeric, (l->>'unit_price')::numeric,
         COALESCE((l->>'line_discount')::numeric, 0), (l->>'line_total')::numeric,
         COALESCE((l->>'conversion_factor')::numeric, 1), NULLIF(l->>'note', '')
  FROM jsonb_array_elements(p_lines) AS l
  WHERE NULLIF(l->>'id', '') IS NULL;

  v_old := o.total;
  UPDATE sales_orders
  SET subtotal = p_subtotal, vat = p_vat, total = p_total, notes = p_notes
  WHERE id = p_order_id;

  INSERT INTO order_activity_log (org_id, order_id, action, workflow_stage, changes, actor_id)
  VALUES (o.org_id, p_order_id, 'edit_after_complete', 'completed',
          jsonb_build_object('export_entry_id', export_entry_id,
                             'import_entry_id', import_entry_id,
                             'old_total', v_old,
                             'new_total', p_total),
          auth.uid());

  PERFORM public._wf2_recompute_receivable(p_order_id);
  PERFORM public._wf2_notify(
    (SELECT sales_user_id FROM sales_orders WHERE id = p_order_id),
    'order_edited', 'Đơn ' || o.order_code || ' vừa được sửa', NULL,
    '/orders/' || p_order_id::text);

  RETURN NEXT;
END;
$$;

-- =====================================================================
-- 4. Huỷ đơn
-- =====================================================================
CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o      record;
  v_imp  uuid;
  s      record;
  d      record;
  v_need numeric;
  v_take numeric;
BEGIN
  SELECT id, org_id, order_code, status, order_date, sales_user_id INTO o
  FROM sales_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF o.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF o.status = 'cancelled' THEN RETURN; END IF;

  IF o.status IN ('draft', 'submitted') THEN
    IF NOT public.user_has_permission(auth.uid(), 'orders.update') THEN
      RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền huỷ đơn' USING ERRCODE = 'P0001';
    END IF;
    IF public.user_role() = 'sales' AND o.sales_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'FORBIDDEN_NOT_OWNER: chỉ huỷ được đơn của mình'
        USING ERRCODE = 'P0001';
    END IF;

    -- draft/submitted → cancelled không cần cờ RPC: trigger 119 chỉ gác
    -- hai bước đụng kho và công nợ.
    UPDATE sales_orders
    SET status = 'cancelled', cancelled_at = now(),
        cancelled_by = auth.uid(), cancel_reason = p_reason
    WHERE id = p_order_id;

    UPDATE returns SET status = 'cancelled', cancelled_at = now()
    WHERE order_id = p_order_id AND status = 'draft';

    PERFORM public._wf2_notify(
      o.sales_user_id, 'order_cancelled',
      'Đơn ' || o.order_code || ' đã bị huỷ', p_reason,
      '/orders/' || p_order_id::text);
    RETURN;
  END IF;

  -- Huỷ đơn ĐÃ XUẤT: hoàn kho toàn bộ rồi xoá công nợ.
  IF NOT public.user_has_permission(auth.uid(), 'orders.approve') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền huỷ đơn đã xuất'
      USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED: phải ghi lý do huỷ đơn đã xuất'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM public._wf2_assert_order_unlocked(p_order_id, o.order_date, false);
  PERFORM set_config('npp.via_rpc', 'on', true);

  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, notes)
  VALUES (o.org_id,
          'NK-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS'),
          'import', 'posted', now(), auth.uid(),
          'Hoàn kho do huỷ đơn ' || o.order_code)
  RETURNING id INTO v_imp;

  -- ⚠ HAI CÁI BẪY Ở ĐÂY.
  --   1. Phiếu xuất có thể GỘP NHIỀU ĐƠN (màn xuất kho cũ gộp theo khách,
  --      ref_order_ids là mảng). Hoàn nguyên dòng của phiếu gộp là trả về
  --      kho cả hàng của đơn khác — tồn dôi ra mà không ai giải thích nổi.
  --      Vì thế chỉ hoàn ĐÚNG số của đơn đang huỷ, theo từng cặp sản phẩm
  --      và đơn vị.
  --   2. Đơn có thể đã được sửa giảm và hoàn một phần trước đó, nên lấy
  --      phần CÒN LẠI theo dấu vết FIFO chứ không lấy số xuất ban đầu.
  FOR d IN
    SELECT product_id, unit_name, sum(qty) AS qty FROM (
      SELECT sol.product_id, sol.unit_name,
             sol.quantity * COALESCE(sol.conversion_factor, 1) AS qty
      FROM sales_order_lines sol WHERE sol.order_id = p_order_id
      UNION ALL
      SELECT rl.product_id, rl.unit_name,
             rl.quantity * COALESCE((SELECT pu.conversion FROM product_units pu
               WHERE pu.product_id = rl.product_id AND pu.unit_name = rl.unit_name), 1)
      FROM return_lines rl
      JOIN returns r2 ON r2.id = rl.return_id
      WHERE r2.order_id = p_order_id AND rl.is_exchange = true
    ) t GROUP BY product_id, unit_name
  LOOP
    v_need := d.qty;
    FOR s IN
      SELECT sel.id,
             COALESCE((SELECT sum(slc.qty_in_base_uom)
                         FROM stock_line_consumptions slc
                        WHERE slc.line_id = sel.id), sel.qty_in_base_uom) AS qty_left
      FROM stock_entry_lines sel
      JOIN stock_entries se ON se.id = sel.entry_id
      WHERE se.type = 'export' AND se.status = 'posted'
        AND se.ref_order_ids @> jsonb_build_array(p_order_id::text)
        AND sel.product_id = d.product_id
        AND sel.unit_name = d.unit_name
      ORDER BY se.posted_at DESC, sel.id DESC
    LOOP
      EXIT WHEN v_need <= 0;
      CONTINUE WHEN COALESCE(s.qty_left, 0) <= 0;
      v_take := LEAST(s.qty_left, v_need);
      PERFORM public._wf2_restock(s.id, v_take,
        'Hoàn kho do huỷ đơn ' || o.order_code, v_imp);
      v_need := v_need - v_take;
    END LOOP;
  END LOOP;

  -- ⚠ Phiếu thu ĐÃ HUỶ vẫn để lại dòng trỏ vào công nợ (void chỉ đổi
  --   trạng thái phiếu). Không gỡ trước thì DELETE dưới đây nổ 23503 và
  --   phần hoàn kho vừa làm cũng rollback.
  UPDATE cash_receipt_lines crl
  SET receivable_id = NULL, payment_id = NULL
  FROM receivables r
  WHERE crl.receivable_id = r.id AND r.order_id = p_order_id;

  DELETE FROM receivables WHERE order_id = p_order_id;

  UPDATE returns SET status = 'cancelled', cancelled_at = now()
  WHERE order_id = p_order_id AND status IN ('draft', 'submitted');

  INSERT INTO order_activity_log (org_id, order_id, action, workflow_stage, changes, actor_id)
  VALUES (o.org_id, p_order_id, 'cancel_after_complete', 'cancelled',
          jsonb_build_object('import_entry_id', v_imp, 'reason', p_reason), auth.uid());

  UPDATE sales_orders
  SET status = 'cancelled', cancelled_at = now(),
      cancelled_by = auth.uid(), cancel_reason = p_reason
  WHERE id = p_order_id;

  PERFORM public._wf2_notify(
    o.sales_user_id, 'order_cancelled',
    'Đơn ' || o.order_code || ' đã bị huỷ sau khi xuất', p_reason,
    '/orders/' || p_order_id::text);
END;
$$;


-- =====================================================================
-- 5. Đơn trả
-- =====================================================================
-- Nhập kho vào ĐÚNG kho người dùng chọn. Hàng cận date về kho date thì
-- lần bán sau nó ra trước — đó là lý do có tham số này.
CREATE OR REPLACE FUNCTION public.complete_return(p_return_id uuid, p_zone text)
RETURNS TABLE (entry_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r          record;
  v_entry    uuid;
  v_code     text;
  l          record;
  v_conv     numeric;
  v_base     numeric;
  v_batch    uuid;
  v_cost     numeric;
  v_exp      date;
  cap        record;
  v_sold     numeric;
  v_returned numeric;
  v_pname    text;
BEGIN
  SELECT id, org_id, order_id, status, requested_by INTO r
  FROM returns WHERE id = p_return_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RETURN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF r.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.user_has_permission(auth.uid(), 'returns.approve') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền hoàn thành đơn trả'
      USING ERRCODE = 'P0001';
  END IF;
  IF r.status <> 'submitted' THEN
    RAISE EXCEPTION 'RETURN_NOT_SUBMITTED: phiếu trả không ở Phiếu tạm'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_zone NOT IN ('sale', 'date') THEN
    RAISE EXCEPTION 'BAD_ZONE: kho nhận phải là sale hoặc date' USING ERRCODE = 'P0001';
  END IF;
  -- ⚠ Nhập lại hàng của một đơn CHƯA xuất là cộng khống tồn kho: số hàng
  --   đó chưa bao giờ rời kho. Backfill mig 119 có thể tạo ra đúng cảnh
  --   này với phiếu trả cũ ở trạng thái đã duyệt.
  IF r.order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sales_orders o2 WHERE o2.id = r.order_id AND o2.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'ORDER_NOT_COMPLETED: đơn gốc chưa xuất hàng, không nhập trả được'
      USING ERRCODE = 'P0001';
  END IF;

  -- ===================================================================
  -- Q8 — TRẦN SỐ LƯỢNG TRẢ, KIỂM LẠI Ở ĐÂY
  --
  -- ⚠ VÌ SAO PHẢI KIỂM HAI LẦN. Trigger `enforce_return_line_cap` (mig
  --   119) chạy lúc CHÈN DÒNG, và phần "đã trả rồi" của nó chỉ đếm phiếu
  --   ở trạng thái 'completed'. Nên hai phiếu trả của cùng một đơn, cùng
  --   nằm ở 'submitted', mỗi phiếu đều thấy "đã trả = 0" và đều LỌT:
  --     đơn bán 10 → phiếu A 10 lọt → phiếu B 10 cũng lọt
  --     → hoàn thành cả hai → nhập kho 20 và trừ công nợ gấp đôi.
  --
  -- ⚠ KIỂM Ở ĐÂY, KHÔNG SIẾT TRIGGER. Bắt trigger đếm cả phiếu
  --   'submitted' thì một phiếu lập nhầm rồi bỏ đó sẽ chiếm chỗ và chặn
  --   mất phiếu thật. Chặn đúng lúc hàng THẬT SỰ vào kho là chỗ duy nhất
  --   con số có ý nghĩa.
  --
  -- ⚠ Dòng ĐỔI không tính — hàng đổi không trừ công nợ và không bị chặn
  --   bởi số đã bán. Phiếu trả độc lập cũng không: không có đơn gốc để so.
  -- ===================================================================
  IF r.order_id IS NOT NULL THEN
    FOR cap IN
      SELECT rl.product_id,
             sum(rl.quantity * COALESCE((
               SELECT pu.conversion FROM product_units pu
                WHERE pu.product_id = rl.product_id
                  AND pu.unit_name = rl.unit_name), 1)) AS need
      FROM return_lines rl
      WHERE rl.return_id = p_return_id AND rl.is_exchange = false
      GROUP BY rl.product_id
    LOOP
      SELECT COALESCE(sum(sol.quantity * COALESCE(sol.conversion_factor, 1)), 0)
        INTO v_sold
      FROM sales_order_lines sol
      WHERE sol.order_id = r.order_id AND sol.product_id = cap.product_id;

      SELECT COALESCE(sum(rl2.quantity * COALESCE((
                SELECT pu.conversion FROM product_units pu
                 WHERE pu.product_id = rl2.product_id
                   AND pu.unit_name = rl2.unit_name), 1)), 0)
        INTO v_returned
      FROM return_lines rl2
      JOIN returns r2 ON r2.id = rl2.return_id
      WHERE r2.order_id = r.order_id
        AND r2.status = 'completed'
        AND rl2.is_exchange = false
        AND rl2.product_id = cap.product_id;

      IF cap.need + v_returned > v_sold THEN
        SELECT name INTO v_pname FROM products WHERE id = cap.product_id;
        RAISE EXCEPTION
          'RETURN_QTY_EXCEEDS: "%" — đã bán %, đã hoàn thành trả %, phiếu này thêm % là vượt',
          COALESCE(v_pname, cap.product_id::text), v_sold, v_returned, cap.need
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;

  v_code := 'NL-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS');
  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, notes)
  VALUES (r.org_id, v_code, 'import', 'posted', now(), auth.uid(),
          'Nhập lại từ phiếu trả ' || p_return_id::text)
  RETURNING id INTO v_entry;

  -- Hàng ĐỔI cũng vào kho như hàng trả; khác nhau ở chỗ nó không ghi có
  -- công nợ, và việc đó do credit_note_amount lo (mig 055).
  FOR l IN
    SELECT rl.id, rl.product_id, rl.unit_name, rl.quantity, rl.is_exchange
    FROM return_lines rl WHERE rl.return_id = p_return_id
  LOOP
    CONTINUE WHEN COALESCE(l.quantity, 0) <= 0;

    v_conv := COALESCE((SELECT pu.conversion FROM product_units pu
                         WHERE pu.product_id = l.product_id
                           AND pu.unit_name = l.unit_name), 1);
    IF v_conv <= 0 THEN v_conv := 1; END IF;
    v_base := l.quantity * v_conv;

    -- ⚠ Giá vốn phải theo hàng THẬT. Để 0 thì lần bán sau FIFO ăn vào lô
    --   này với giá vốn 0, lãi gộp báo cao hơn thực đúng bằng giá vốn số
    --   hàng đã trả. Lấy theo thứ tự: lô đã bán ra của chính đơn gốc →
    --   lô cùng sản phẩm mới nhất → 0.
    v_cost := COALESCE(
      (SELECT slc.unit_cost
         FROM stock_line_consumptions slc
         JOIN stock_entry_lines sel ON sel.id = slc.line_id
         JOIN stock_entries se ON se.id = sel.entry_id
        WHERE sel.product_id = l.product_id
          AND r.order_id IS NOT NULL
          AND se.ref_order_ids @> jsonb_build_array(r.order_id::text)
        ORDER BY slc.created_at DESC LIMIT 1),
      (SELECT b3.unit_cost FROM batches b3
        WHERE b3.product_id = l.product_id AND COALESCE(b3.unit_cost, 0) > 0
        ORDER BY b3.received_at DESC NULLS LAST LIMIT 1),
      0);

    SELECT b.id INTO v_batch
    FROM batches b
    WHERE b.org_id = r.org_id
      AND b.product_id = l.product_id
      AND b.warehouse_zone = p_zone
      AND COALESCE(b.status, 'available') = 'available'
    ORDER BY b.received_at DESC NULLS LAST, b.created_at DESC
    LIMIT 1;

    IF v_batch IS NULL THEN
      -- Lô mới: hạn dùng lấy từ lô xa nhất cùng sản phẩm; không có thì
      -- suy từ hạn sử dụng của sản phẩm; không có nữa thì một năm. Ghi
      -- cách suy vào ghi chú để người kiểm kê biết con số này từ đâu.
      SELECT max(b2.expires_at) INTO v_exp FROM batches b2
       WHERE b2.org_id = r.org_id AND b2.product_id = l.product_id;
      IF v_exp IS NULL THEN
        SELECT current_date + COALESCE(p.shelf_life_days, 365) INTO v_exp
        FROM products p WHERE p.id = l.product_id;
      END IF;

      INSERT INTO batches (
        org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand,
        unit_cost, warehouse_zone, received_at
      ) VALUES (
        r.org_id, l.product_id, 'RESTOCK-' || v_code, COALESCE(v_exp, current_date + 365),
        v_base, 0, v_cost, p_zone, now()
      )
      RETURNING id INTO v_batch;

      -- ⚠ batches có trigger tự xếp kho: lô sắp hết hạn bị đẩy sang kho
      --   date dù người dùng chọn kho bán. Ép lại đúng ý người duyệt, nếu
      --   không thì returns.destination_zone và kho thật nói hai đằng.
      UPDATE batches SET warehouse_zone = p_zone WHERE id = v_batch;
    END IF;

    UPDATE batches SET qty_on_hand = qty_on_hand + v_base WHERE id = v_batch;

    INSERT INTO stock_entry_lines (
      entry_id, product_id, batch_id, unit_name, quantity,
      qty_in_transaction_uom, qty_in_base_uom, transaction_uom,
      conversion_factor_snapshot, unit_cost, notes
    ) VALUES (
      v_entry, l.product_id, v_batch, l.unit_name, round(l.quantity)::int,
      l.quantity, v_base, l.unit_name, v_conv, v_cost,
      CASE WHEN l.is_exchange THEN 'Hàng đổi thu về' ELSE 'Nhập lại từ đơn trả' END
    );
  END LOOP;

  UPDATE returns
  SET status = 'completed', completed_at = now(),
      completed_by = auth.uid(), destination_zone = p_zone
  WHERE id = p_return_id;

  IF r.order_id IS NOT NULL THEN
    PERFORM public._wf2_recompute_receivable(r.order_id);
  END IF;

  PERFORM public._wf2_notify(
    r.requested_by, 'return_completed',
    'Phiếu trả đã hoàn thành', NULL, '/returns/' || p_return_id::text);

  RETURN QUERY SELECT v_entry;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_return(p_return_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r       record;
  v_entry uuid;
  l       record;
  v_rows  int := 0;
BEGIN
  SELECT id, org_id, order_id, status, applied_receipt_id INTO r
  FROM returns WHERE id = p_return_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RETURN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF r.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.user_has_permission(auth.uid(), 'returns.approve') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền huỷ đơn trả' USING ERRCODE = 'P0001';
  END IF;

  IF r.status = 'submitted' THEN
    UPDATE returns
    SET status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
    WHERE id = p_return_id;
    RETURN;
  END IF;

  IF r.status <> 'completed' THEN
    RAISE EXCEPTION 'RETURN_NOT_CANCELLABLE: phiếu ở trạng thái % không huỷ được', r.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Khoản có đã cấn vào phiếu thu thì không rút lại được ở đây.
  IF r.applied_receipt_id IS NOT NULL THEN
    RAISE EXCEPTION 'LOCKED_CREDIT_APPLIED: khoản có đã cấn trừ vào phiếu thu'
      USING ERRCODE = 'P0001';
  END IF;
  IF r.order_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM receivables rc WHERE rc.order_id = r.order_id AND COALESCE(rc.paid, 0) > 0
  ) THEN
    RAISE EXCEPTION 'LOCKED_CREDIT_APPLIED: đơn gốc đã có tiền thu'
      USING ERRCODE = 'P0001';
  END IF;

  -- Đảo đúng những lô đã nhập của chính phiếu trả này.
  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, notes)
  VALUES (r.org_id,
          'XK-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS'),
          'export', 'posted', now(), auth.uid(),
          'Đảo phiếu trả ' || p_return_id::text)
  RETURNING id INTO v_entry;

  FOR l IN
    SELECT sel.product_id, sel.batch_id, sel.unit_name, sel.quantity,
           sel.qty_in_base_uom, sel.conversion_factor_snapshot
    FROM stock_entry_lines sel
    JOIN stock_entries se ON se.id = sel.entry_id
    WHERE se.org_id = r.org_id
      AND se.type = 'import'
      AND se.notes = 'Nhập lại từ phiếu trả ' || p_return_id::text
  LOOP
    IF l.batch_id IS NOT NULL THEN
      UPDATE batches SET qty_on_hand = qty_on_hand - l.qty_in_base_uom WHERE id = l.batch_id;
    END IF;
    INSERT INTO stock_entry_lines (
      entry_id, product_id, batch_id, unit_name, quantity,
      qty_in_transaction_uom, qty_in_base_uom, transaction_uom,
      conversion_factor_snapshot, unit_cost, notes
    ) VALUES (
      v_entry, l.product_id, l.batch_id, l.unit_name, l.quantity,
      l.quantity, l.qty_in_base_uom, l.unit_name,
      COALESCE(l.conversion_factor_snapshot, 1), 0, 'Đảo do huỷ phiếu trả'
    );
    v_rows := v_rows + 1;
  END LOOP;

  -- ⚠ Phiếu trả hoàn thành TRƯỚC mig 120 do trigger cũ nhập kho, ghi chú
  --   khác hẳn nên không khớp được. Im lặng đi tiếp là ghi nợ lại cho
  --   khách trong khi hàng vẫn nằm trong kho. Nói ra và dừng.
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'NO_IMPORT_TO_REVERSE: không tìm được phiếu nhập của phiếu trả này, phải đảo kho bằng tay'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE returns
  SET status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
  WHERE id = p_return_id;

  IF r.order_id IS NOT NULL THEN
    PERFORM public._wf2_recompute_receivable(r.order_id);
  END IF;
END;
$$;


-- =====================================================================
-- 6. Phiếu thu
-- =====================================================================
-- p = { customer_id, receipt_date, method, notes,
--       lines: [{receivable_id, amount}], credits: [{return_id}] }
--
-- ⚠ KHÔNG tạo số dư có. Cấn trừ vượt số nợ đã chọn thì RAISE, chứ không
--   để lại một khoản treo mà sau này không ai biết nó ở đâu ra.
CREATE OR REPLACE FUNCTION public.create_cash_receipt(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org      uuid := public.user_org_id();
  v_cust     uuid := (p->>'customer_id')::uuid;
  v_method   text := COALESCE(p->>'method', 'cash');
  v_sum_line numeric;
  v_sum_cred numeric;
  v_receipt  uuid;
  v_code     text;
  v_try      int := 0;
  v_alloc    jsonb;
  v_item     jsonb;
  v_left     numeric;
  v_apply    numeric;
  v_cred     numeric;
  v_pay      uuid;
  i          int;
  c          record;
  rl         record;
  v_use      numeric := GREATEST(0, COALESCE((p->>'use_credit')::numeric, 0));
  v_avail    numeric;
  v_left_use numeric;
  src        record;
  v_take     numeric;
BEGIN
  IF NOT public.user_has_permission(auth.uid(), 'receivables.create') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền lập phiếu thu' USING ERRCODE = 'P0001';
  END IF;
  IF v_cust IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_REQUIRED: chưa chọn khách hàng' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(sum(x.amount), 0) INTO v_sum_line FROM (
    SELECT sum((l->>'amount')::numeric) AS amount
    FROM jsonb_array_elements(COALESCE(p->'lines', '[]'::jsonb)) AS l
    GROUP BY (l->>'receivable_id')
  ) x;

  -- ⚠ DISTINCT: payload gửi trùng một phiếu trả hai lần thì khách được
  --   cấn trừ gấp đôi mà không có lỗi nào.
  SELECT COALESCE(sum(COALESCE(r.credit_note_amount, 0)), 0) INTO v_sum_cred
  FROM (
    SELECT DISTINCT (c2->>'return_id')::uuid AS id
    FROM jsonb_array_elements(COALESCE(p->'credits', '[]'::jsonb)) AS c2
  ) k
  JOIN returns r ON r.id = k.id;

  IF v_sum_line <= 0 AND v_sum_cred <= 0 THEN
    RAISE EXCEPTION 'EMPTY_RECEIPT: chưa chọn khoản nào để thu' USING ERRCODE = 'P0001';
  END IF;
  IF v_sum_cred > v_sum_line THEN
    RAISE EXCEPTION 'CREDIT_EXCEEDS_SELECTED: cấn trừ vượt số nợ đã chọn'
      USING ERRCODE = 'P0001';
  END IF;

  -- ===================================================================
  -- Q11 — TIÊU SỐ DƯ CÓ CỦA KHÁCH
  --
  -- Từ Q11, `receivables.paid > amount` là hợp lệ: phần chênh là tiền
  -- khách đã đưa mà nhà phân phối còn giữ. `use_credit` là số tiền kế
  -- toán muốn rút từ đó để đắp vào những khoản nợ đang chọn.
  --
  -- ⚠ GHI THÀNH BÚT TOÁN HAI VẾ, KHÔNG GIẢM `paid` TRẦN TRỤI.
  --   `void_cash_receipt` đảo phiếu thu bằng cách duyệt TỪNG dòng
  --   `cash_receipt_lines`, xoá `payments` rồi trừ lại `paid` đúng bằng
  --   `l.amount`. Giảm `paid` mà không sinh dòng tương ứng thì huỷ phiếu
  --   thu xong `paid` lệch vĩnh viễn với `payments`, và không ai đối
  --   chiếu lại được.
  --
  --   Vế RÚT ghi một dòng ÂM ở khoản đang dư; vế ĐẮP ghi một dòng DƯƠNG ở
  --   khoản được thu. Khi huỷ, `paid - (-take)` cộng lại đúng chỗ đã rút
  --   và `paid - take` trừ đúng chỗ đã đắp — vòng lặp sẵn có tự đảo cả
  --   hai vế, không cần biết gì thêm.
  -- ===================================================================
  IF v_use > 0 THEN
    SELECT COALESCE(sum(GREATEST(0, COALESCE(paid, 0) - COALESCE(amount, 0))), 0)
      INTO v_avail
    FROM receivables
    WHERE org_id = v_org AND customer_id = v_cust;

    IF v_use > v_avail + 0.01 THEN
      RAISE EXCEPTION 'CREDIT_BALANCE_TOO_LOW: khách chỉ còn % số dư có, không rút được %',
        v_avail, v_use USING ERRCODE = 'P0001';
    END IF;
    -- Rút nhiều hơn phần còn phải trả là sinh ra số dư mới ở chỗ khác.
    IF v_use > v_sum_line - v_sum_cred + 0.01 THEN
      RAISE EXCEPTION 'CREDIT_EXCEEDS_SELECTED: số dư có dùng vượt phần còn phải trả'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ⚠ GỘP theo khoản nợ trước khi kiểm. Payload gửi cùng một khoản nợ
  --   thành hai dòng thì kiểm riêng lẻ đều lọt, nhưng cộng dồn vào `paid`
  --   là thu vượt số nợ.
  -- ⚠ Và phải KHOÁ HÀNG khi kiểm: hai kế toán bấm Lưu cùng lúc thì cả hai
  --   cùng đọc paid cũ, cả hai cùng qua, và khoản nợ bị thu hai lần.
  FOR rl IN
    SELECT (l->>'receivable_id')::uuid AS id, sum((l->>'amount')::numeric) AS amount
    FROM jsonb_array_elements(COALESCE(p->'lines', '[]'::jsonb)) AS l
    GROUP BY 1
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM receivables r
      WHERE r.id = rl.id AND r.org_id = v_org AND r.customer_id = v_cust
        AND rl.amount <= COALESCE(r.amount, 0) - COALESCE(r.paid, 0) + 0.01
      FOR UPDATE
    ) THEN
      RAISE EXCEPTION 'BAD_RECEIVABLE_LINE: khoản nợ không hợp lệ hoặc thu vượt số còn nợ'
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  FOR c IN
    SELECT DISTINCT (c2->>'return_id')::uuid AS id
    FROM jsonb_array_elements(COALESCE(p->'credits', '[]'::jsonb)) AS c2
  LOOP
    -- ⚠ Q10 — PHẢI KHOÁ HÀNG. Không có FOR UPDATE thì hai kế toán cùng
    --   lập phiếu thu cấn trừ CÙNG một phiếu trả độc lập sẽ cùng đọc
    --   `applied_receipt_id IS NULL`, cùng qua, và khoản có bị cấn trừ
    --   hai lần — lệnh UPDATE ở cuối chỉ ghi đè chứ không chặn.
    --   Cách viết `NOT EXISTS (… FOR UPDATE)` này giống hệt vòng kiểm
    --   khoản nợ bên trên: ở READ COMMITTED, Postgres khoá dòng rồi đánh
    --   giá lại điều kiện sau khi chờ, nên người thứ hai nhận BAD_CREDIT.
    IF NOT EXISTS (
      SELECT 1 FROM returns r
      WHERE r.id = c.id AND r.org_id = v_org AND r.customer_id = v_cust
        AND r.status = 'completed' AND r.order_id IS NULL
        AND r.applied_receipt_id IS NULL
      FOR UPDATE
    ) THEN
      RAISE EXCEPTION 'BAD_CREDIT: phiếu trả không đủ điều kiện cấn trừ'
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  LOOP
    v_try := v_try + 1;
    v_code := 'PT-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD')
              || '-' || lpad(floor(1 + random() * 9999)::text, 4, '0');
    BEGIN
      INSERT INTO cash_receipts (
        org_id, receipt_code, receipt_date, source_type, status,
        submitted_amount, expected_amount,
        received_by, received_at, collected_by, created_by, notes
      ) VALUES (
        v_org, v_code, COALESCE((p->>'receipt_date')::date, current_date),
        'standalone', 'received',
        v_sum_line - v_sum_cred - v_use, v_sum_line - v_sum_cred - v_use,
        auth.uid(), now(), auth.uid(), auth.uid(), p->>'notes'
      )
      RETURNING id INTO v_receipt;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_try >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  -- Bảng phân bổ: mỗi khoản nợ đã chọn còn phải ghi bao nhiêu. Xếp hạn cũ
  -- nhất trước để khoản quá hạn được xoá sổ sớm nhất.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'receivable_id', x.id, 'order_id', x.order_id, 'left', x.amount)
           ORDER BY x.due_date NULLS LAST, x.id), '[]'::jsonb)
    INTO v_alloc
  FROM (
    SELECT r.id, r.order_id, r.due_date, sum((l->>'amount')::numeric) AS amount
    FROM jsonb_array_elements(COALESCE(p->'lines', '[]'::jsonb)) AS l
    JOIN receivables r ON r.id = (l->>'receivable_id')::uuid
    GROUP BY r.id, r.order_id, r.due_date
  ) x;

  -- Cấn trừ từng phiếu trả, ghi return_id lên đúng dòng: một phiếu thu
  -- cấn nhiều phiếu trả vẫn dựng lại được bút toán sau này.
  FOR c IN
    SELECT DISTINCT (c2->>'return_id')::uuid AS id
    FROM jsonb_array_elements(COALESCE(p->'credits', '[]'::jsonb)) AS c2
  LOOP
    SELECT COALESCE(credit_note_amount, 0) INTO v_cred FROM returns WHERE id = c.id;
    i := 0;
    WHILE i < jsonb_array_length(v_alloc) AND v_cred > 0 LOOP
      v_item := v_alloc->i;
      v_left := (v_item->>'left')::numeric;
      IF v_left > 0 THEN
        v_apply := LEAST(v_left, v_cred);
        INSERT INTO payments (receivable_id, collected_by, amount, method, collected_at)
        VALUES ((v_item->>'receivable_id')::uuid, auth.uid(), v_apply, 'return_credit', now())
        RETURNING id INTO v_pay;
        INSERT INTO cash_receipt_lines (
          receipt_id, order_id, receivable_id, payment_id, amount, kind, return_id
        ) VALUES (
          v_receipt, NULLIF(v_item->>'order_id', '')::uuid,
          (v_item->>'receivable_id')::uuid, v_pay, v_apply, 'return_credit', c.id
        );
        v_alloc := jsonb_set(v_alloc, ARRAY[i::text, 'left'], to_jsonb(v_left - v_apply));
        v_cred := v_cred - v_apply;
      END IF;
      i := i + 1;
    END LOOP;

    UPDATE returns SET applied_receipt_id = v_receipt WHERE id = c.id;
  END LOOP;

  -- Q11 — rút số dư có và đắp vào các khoản nợ đang chọn.
  IF v_use > 0 THEN
    v_left_use := v_use;
    FOR src IN
      SELECT id, GREATEST(0, COALESCE(paid, 0) - COALESCE(amount, 0)) AS avail
      FROM receivables
      WHERE org_id = v_org AND customer_id = v_cust
        AND COALESCE(paid, 0) > COALESCE(amount, 0)
      -- Cũ nhất trước: số dư nằm lâu nhất được dùng trước.
      ORDER BY due_date NULLS LAST, id
      FOR UPDATE
    LOOP
      EXIT WHEN v_left_use <= 0;
      v_take := LEAST(src.avail, v_left_use);
      CONTINUE WHEN v_take <= 0;

      -- Vế RÚT: dòng payments ÂM ở khoản đang dư.
      INSERT INTO payments (receivable_id, collected_by, amount, method, collected_at)
      VALUES (src.id, auth.uid(), -v_take, 'credit_applied', now())
      RETURNING id INTO v_pay;
      INSERT INTO cash_receipt_lines (receipt_id, receivable_id, payment_id, amount, kind)
      VALUES (v_receipt, src.id, v_pay, -v_take, 'credit_applied');

      UPDATE receivables
      SET paid = COALESCE(paid, 0) - v_take,
          status = CASE
                     WHEN COALESCE(paid, 0) - v_take >= COALESCE(amount, 0) THEN 'paid'
                     WHEN COALESCE(paid, 0) - v_take > 0                    THEN 'partial'
                     ELSE 'open'
                   END
      WHERE id = src.id;

      -- Vế ĐẮP: rải lên các khoản nợ đã chọn, cùng bảng phân bổ với phần
      -- cấn trừ phiếu trả nên không đắp quá số đã chọn.
      i := 0;
      WHILE i < jsonb_array_length(v_alloc) AND v_take > 0 LOOP
        v_item := v_alloc->i;
        v_left := (v_item->>'left')::numeric;
        IF v_left > 0 THEN
          v_apply := LEAST(v_left, v_take);
          INSERT INTO payments (receivable_id, collected_by, amount, method, collected_at)
          VALUES ((v_item->>'receivable_id')::uuid, auth.uid(), v_apply, 'credit_applied', now())
          RETURNING id INTO v_pay;
          INSERT INTO cash_receipt_lines (
            receipt_id, order_id, receivable_id, payment_id, amount, kind
          ) VALUES (
            v_receipt, NULLIF(v_item->>'order_id', '')::uuid,
            (v_item->>'receivable_id')::uuid, v_pay, v_apply, 'credit_applied'
          );
          v_alloc := jsonb_set(v_alloc, ARRAY[i::text, 'left'], to_jsonb(v_left - v_apply));
          v_take := v_take - v_apply;
          v_left_use := v_left_use - v_apply;
        END IF;
        i := i + 1;
      END LOOP;
    END LOOP;
  END IF;

  -- Phần còn lại là tiền khách trả thật.
  i := 0;
  WHILE i < jsonb_array_length(v_alloc) LOOP
    v_item := v_alloc->i;
    v_left := (v_item->>'left')::numeric;
    IF v_left > 0 THEN
      INSERT INTO payments (receivable_id, collected_by, amount, method, collected_at)
      VALUES ((v_item->>'receivable_id')::uuid, auth.uid(), v_left, v_method, now())
      RETURNING id INTO v_pay;
      INSERT INTO cash_receipt_lines (
        receipt_id, order_id, receivable_id, payment_id, amount, kind
      ) VALUES (
        v_receipt, NULLIF(v_item->>'order_id', '')::uuid,
        (v_item->>'receivable_id')::uuid, v_pay, v_left, 'payment'
      );
    END IF;
    i := i + 1;
  END LOOP;

  -- Cộng đã thu theo đúng số người dùng chọn cho từng khoản.
  FOR rl IN
    SELECT (l->>'receivable_id')::uuid AS id, sum((l->>'amount')::numeric) AS amount
    FROM jsonb_array_elements(COALESCE(p->'lines', '[]'::jsonb)) AS l
    GROUP BY 1
  LOOP
    UPDATE receivables
    SET paid = COALESCE(paid, 0) + rl.amount,
        status = CASE WHEN COALESCE(paid, 0) + rl.amount >= COALESCE(amount, 0)
                      THEN 'paid' ELSE 'partial' END
    WHERE id = rl.id;
  END LOOP;

  RETURN v_receipt;
END;
$$;

-- Huỷ phiếu thu PHẢI trả công nợ về như cũ. Bản cũ ở giao diện chỉ đổi
-- trạng thái phiếu, để lại `paid` đã cộng — khách hiện ra đã trả tiền
-- trong khi phiếu thu đã huỷ.
CREATE OR REPLACE FUNCTION public.void_cash_receipt(p_receipt_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r   record;
  l   record;
BEGIN
  SELECT id, org_id, status INTO r
  FROM cash_receipts WHERE id = p_receipt_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RECEIPT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF r.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.user_has_permission(auth.uid(), 'receivables.update') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền huỷ phiếu thu' USING ERRCODE = 'P0001';
  END IF;
  IF r.status NOT IN ('pending', 'received') THEN
    RAISE EXCEPTION 'RECEIPT_NOT_VOIDABLE: phiếu ở trạng thái % không huỷ được', r.status
      USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED: phải ghi lý do huỷ phiếu thu' USING ERRCODE = 'P0001';
  END IF;

  FOR l IN
    SELECT id, receivable_id, payment_id, amount, kind, return_id
    FROM cash_receipt_lines WHERE receipt_id = p_receipt_id
  LOOP
    -- ⚠ Gỡ tham chiếu TRƯỚC khi xoá. cash_receipt_lines.payment_id là
    --   khoá ngoại NO ACTION, xoá payments trước là lỗi 23503 và cả lệnh
    --   huỷ phiếu thu rollback — công nợ không bao giờ được trả về.
    IF l.payment_id IS NOT NULL THEN
      UPDATE cash_receipt_lines SET payment_id = NULL WHERE id = l.id;
      DELETE FROM payments WHERE id = l.payment_id;
    END IF;
    IF l.receivable_id IS NOT NULL THEN
      -- ⚠ Q11 — NHÁNH 'paid' PHẢI ĐỨNG TRƯỚC. Sau khi cho phép số dư có,
      --   một dòng vẫn có thể còn `paid >= amount` sau khi trừ đi phần
      --   của phiếu thu này. Bản trước rơi thẳng vào `ELSE 'partial'`,
      --   mà mọi bộ lọc trong kho dùng `status <> 'paid'` để nói "đã tất
      --   toán" — nên dòng dư lập tức bị hút vào các phép cộng công nợ và
      --   màn /receivables/by-customer bắt đầu ra số âm. Không lỗi nào
      --   bắn ra.
      UPDATE receivables
      SET paid = GREATEST(0, COALESCE(paid, 0) - l.amount),
          status = CASE
                     WHEN GREATEST(0, COALESCE(paid, 0) - l.amount) >= COALESCE(amount, 0)
                       THEN 'paid'
                     WHEN GREATEST(0, COALESCE(paid, 0) - l.amount) = 0
                       THEN CASE WHEN due_date IS NOT NULL AND due_date < current_date
                                 THEN 'overdue' ELSE 'open' END
                     ELSE 'partial'
                   END
      WHERE id = l.receivable_id;
    END IF;
  END LOOP;

  UPDATE returns SET applied_receipt_id = NULL WHERE applied_receipt_id = p_receipt_id;

  UPDATE cash_receipts
  SET status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
  WHERE id = p_receipt_id;
END;
$$;


-- =====================================================================
-- 7. Quyền thực thi
-- =====================================================================
-- Helper là việc nội bộ của các RPC, không ai gọi thẳng.
REVOKE ALL ON FUNCTION public._wf2_notify(uuid, text, text, text, text)        FROM PUBLIC;
REVOKE ALL ON FUNCTION public._wf2_recompute_receivable(uuid)                  FROM PUBLIC;
REVOKE ALL ON FUNCTION public._wf2_export_order(uuid, jsonb, text)             FROM PUBLIC;
REVOKE ALL ON FUNCTION public._wf2_restock(uuid, numeric, text, uuid)          FROM PUBLIC;
REVOKE ALL ON FUNCTION public._wf2_assert_order_unlocked(uuid, date, boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.complete_order(uuid)                                     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.edit_completed_order(uuid, jsonb, numeric, numeric, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_order(uuid, text)                                 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_return(uuid, text)                              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_return(uuid, text)                                FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_cash_receipt(jsonb)                               FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_cash_receipt(uuid, text)                            FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.complete_order(uuid)                                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_completed_order(uuid, jsonb, numeric, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text)                                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_return(uuid, text)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_return(uuid, text)                                TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_cash_receipt(jsonb)                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_cash_receipt(uuid, text)                            TO authenticated;


NOTIFY pgrst, 'reload schema';


DO $$
BEGIN
  RAISE NOTICE '120: 5 helper + 7 RPC đã dựng; trigger nhập kho tự động của đơn trả đã gỡ.';
END $$;


-- ####################################################################
-- # 121_credit_balance_aggregates.sql
-- ####################################################################

-- ---------------------------------------------------------------------
-- 121 — Bốn hàm tổng hợp nói dối sau khi workflow v2 mở hai thứ mới:
--       SỐ DƯ CÓ của khách, và hai phương thức thanh toán KHÔNG PHẢI TIỀN
-- ---------------------------------------------------------------------
--
-- ⚠ VÌ SAO LÀ MỘT MIGRATION MỚI CHỨ KHÔNG SỬA 093.
--
-- Lượt trước tôi vá thẳng vào `093_aggregate_functions.sql`. Sai — và sai
-- theo đúng kiểu đắt nhất: KHÔNG AI THẤY.
--   · 093 đã chạy trên production từ lâu. `supabase db push` chỉ chạy
--     migration MỚI, nên bản vá nằm trong 093 không bao giờ tới nơi;
--   · 093 dùng `CREATE FUNCTION` trần (không `OR REPLACE`), nên chạy lại
--     nó trên CSDL có sẵn còn ném "function already exists";
--   · `schema_full.sql` chỉ dùng để CÀI MỚI, nên bản gộp vẫn đúng và
--     nhìn vào đó tưởng đã xong.
-- Kết quả: kho mã nói đã sửa, còn cơ sở dữ liệu thật vẫn tính sai. Đã
-- hoàn 093 về nguyên trạng; toàn bộ phép sửa nằm ở đây.
--
-- ---------------------------------------------------------------------
-- VẤN ĐỀ 1 — SỐ DƯ CÓ BỊ TRỪ THẲNG VÀO CÔNG NỢ (Q11)
--
-- Từ mig 120, `receivables.paid > amount` là HỢP LỆ: khách trả hàng sau
-- khi đã thanh toán đủ thì phần chênh là tiền của họ đang nằm ở nhà phân
-- phối. Hai hàm dưới đây tính `amount - paid` không kẹp:
--   · `receivables_by_rep` KHÔNG lọc `status <> 'paid'`, nên dòng dư lọt
--     vào và kéo tổng công nợ của NVBH XUỐNG — có khi âm. Nhân viên đang
--     phải đòi 10 triệu hiện ra còn 7 triệu, không lỗi nào bắn ra.
--   · `receivables_by_customer` có lọc `status <> 'paid'` nên phần lớn
--     dòng dư bị loại; nhưng dòng dư MỘT PHẦN (`partial`, `paid` vừa
--     vượt `amount` sau khi ghi có) vẫn lọt, và vẫn âm.
-- Kẹp `GREATEST(0, …)` là đúng: không ai muốn thấy "công nợ −400.000".
-- Phần bị kẹp được nói ra ở giao diện (`src/lib/receivables/credit.ts`),
-- không nuốt trong im lặng.
--
-- Tỉ lệ thu hồi cũng vượt 100% vì cùng lý do → kẹp trần 100.
--
-- ---------------------------------------------------------------------
-- VẤN ĐỀ 2 — BÁO CÁO DÒNG TIỀN ĐẾM CẢ TIỀN KHÔNG VÀO KÉT (Q13)
--
-- `finance_balance_sheet.cash_in` và `finance_cash_flow.cash_from_customers`
-- cộng THẲNG `payments.amount`, không hỏi `method`. Khi bảng đó chỉ có
-- tiền mặt / chuyển khoản / ví thì đúng. Workflow v2 thêm hai phương
-- thức KHÔNG phải tiền:
--   · `'return_credit'` (mig 120) — cấn trừ phiếu trả độc lập vào công
--     nợ. Một dòng DƯƠNG, KHÔNG có dòng đối ứng. Đây là chỗ sai thật:
--     mỗi đồng hàng trả được cấn trừ đều hiện ra như một đồng tiền mặt
--     thu được. Tiền mặt trên bảng cân đối CAO HƠN két thật.
--   · `'credit_applied'` (Q11) — rút số dư có, ghi HAI VẾ (âm ở khoản
--     đang dư, dương ở khoản được thu) nên tự triệt tiêu trong một tổng.
--     Hôm nay nó vô hại, nhưng chỉ vì hai vế cùng `collected_at`. Lọc nó
--     ra để con số không phụ thuộc vào một bất biến mà không ai nhớ.
--
-- ⚠ LỌC THEO DANH SÁCH LOẠI TRỪ, KHÔNG PHẢI DANH SÁCH CHO PHÉP.
--   `method NOT IN ('return_credit','credit_applied')` giữ nguyên hành vi
--   cho mọi phương thức tiền thật đang có VÀ mọi phương thức tiền thật
--   thêm sau này. Nếu viết `method IN ('cash','transfer','wallet')` thì
--   người thêm 'momo' vào tháng sau sẽ thấy doanh thu tiền mặt hụt đi mà
--   không hiểu vì sao — và sẽ đi tìm ở chỗ khác.
--   `COALESCE(method,'')` vì cột cho phép NULL: `NULL NOT IN (…)` ra NULL
--   chứ không ra true, và dòng đó sẽ bị loại oan.
-- ---------------------------------------------------------------------

-- --------------------------------------------------------------------
-- 1. receivables_by_rep — kẹp phần dư, kẹp trần tỉ lệ thu hồi.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.receivables_by_rep();
CREATE FUNCTION public.receivables_by_rep()
RETURNS TABLE (
  user_id             uuid,
  full_name           text,
  customer_count      bigint,
  customers_with_debt bigint,
  total_debt          numeric,
  total_paid          numeric,
  total_amount        numeric,
  overdue_amount      numeric,
  collection_rate     integer,
  dso                 integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH r AS (
    SELECT
      rc.sales_user_id,
      rc.customer_id,
      COALESCE(rc.amount, 0) AS amount,
      COALESCE(rc.paid, 0)   AS paid,
      -- ⚠ Q11 — KẸP VỀ 0. Hàm này không lọc `status <> 'paid'` nên dòng
      --   trả dư lọt vào; không kẹp thì số dư có bị TRỪ THẲNG vào công
      --   nợ của nhân viên.
      GREATEST(0, COALESCE(rc.amount, 0) - COALESCE(rc.paid, 0)) AS remaining,
      rc.status,
      rc.status <> 'paid' AS has_debt,
      GREATEST(0, CURRENT_DATE - COALESCE(rc.due_date, CURRENT_DATE)) AS aging_days
    FROM receivables rc
    WHERE rc.org_id = public.user_org_id()
      AND rc.sales_user_id IS NOT NULL
  )
  SELECT
    r.sales_user_id,
    COALESCE(u.full_name, '-'),
    COUNT(DISTINCT r.customer_id),
    COUNT(DISTINCT r.customer_id) FILTER (WHERE r.has_debt),
    COALESCE(SUM(r.remaining), 0),
    COALESCE(SUM(r.paid), 0),
    COALESCE(SUM(r.amount), 0),
    COALESCE(SUM(r.remaining) FILTER (WHERE r.status = 'overdue'), 0),
    -- ⚠ Q11 — KẸP TRẦN 100%. Dòng dư có `paid > amount` nên tỉ lệ thu
    --   được vượt 100 và người đọc tưởng số liệu hỏng.
    CASE WHEN COALESCE(SUM(r.amount), 0) > 0
         THEN LEAST(100, ROUND(SUM(r.paid) / SUM(r.amount) * 100)::integer)
         ELSE 0 END,
    CASE WHEN COUNT(*) FILTER (WHERE r.has_debt) > 0
         THEN ROUND(
                AVG(r.aging_days) FILTER (WHERE r.has_debt)
              )::integer
         ELSE 0 END
  FROM r
  LEFT JOIN users u ON u.id = r.sales_user_id
  GROUP BY r.sales_user_id, u.full_name
  ORDER BY COALESCE(SUM(r.remaining), 0) DESC;
$$;

-- --------------------------------------------------------------------
-- 2. receivables_by_customer — kẹp phần dư.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.receivables_by_customer();
CREATE FUNCTION public.receivables_by_customer()
RETURNS TABLE (
  customer_id    uuid,
  store_name     text,
  phone          text,
  rep_name       text,
  total_debt     numeric,
  total_paid     numeric,
  remaining      numeric,
  overdue_amount numeric,
  credit_limit   numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH r AS (
    SELECT
      rc.customer_id,
      COALESCE(rc.amount, 0) AS amount,
      COALESCE(rc.paid, 0)   AS paid,
      -- ⚠ Q11 — KẸP VỀ 0. Bộ lọc `status <> 'paid'` bên dưới loại phần
      --   lớn dòng dư, nhưng dòng `partial` vừa bị ghi có vượt lên vẫn
      --   lọt, và vẫn cho hiệu âm.
      GREATEST(0, COALESCE(rc.amount, 0) - COALESCE(rc.paid, 0)) AS remaining,
      rc.status,
      rc.sales_user_id
    FROM receivables rc
    WHERE rc.org_id = public.user_org_id()
      AND rc.status <> 'paid'
  ),
  agg AS (
    SELECT
      r.customer_id,
      SUM(r.amount)     AS total_debt,
      SUM(r.paid)       AS total_paid,
      SUM(r.remaining)  AS remaining,
      COALESCE(SUM(r.remaining) FILTER (WHERE r.status = 'overdue'), 0) AS overdue_amount,
      -- Lấy một sales_user_id bất kỳ làm phương án dự phòng cho rep_name.
      MIN(r.sales_user_id::text)::uuid AS any_sales_user_id
    FROM r
    GROUP BY r.customer_id
  )
  SELECT
    agg.customer_id,
    COALESCE(c.store_name, '-'),
    COALESCE(c.phone, '-'),
    COALESCE(pa.full_name, su.full_name, '-'),
    agg.total_debt,
    agg.total_paid,
    agg.remaining,
    agg.overdue_amount,
    COALESCE(c.credit_limit, 0)
  FROM agg
  LEFT JOIN customers c ON c.id = agg.customer_id
  LEFT JOIN LATERAL (
    SELECT u.full_name
    FROM customer_assignments ca
    JOIN users u ON u.id = ca.user_id
    WHERE ca.customer_id = agg.customer_id AND ca.role = 'primary'
    LIMIT 1
  ) pa ON true
  LEFT JOIN users su ON su.id = agg.any_sales_user_id
  ORDER BY agg.remaining DESC;
$$;

-- --------------------------------------------------------------------
-- 3. finance_balance_sheet — `cash_in` chỉ đếm TIỀN THẬT.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.finance_balance_sheet(date);
CREATE FUNCTION public.finance_balance_sheet(p_as_of date)
RETURNS TABLE (
  cash                 numeric,
  accounts_receivable  numeric,
  inventory            numeric,
  accounts_payable     numeric,
  unpaid_expenses      numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH
  cash_in AS (
    SELECT COALESCE(SUM(COALESCE(p.amount, 0)), 0) AS v
    FROM payments p
    JOIN receivables r ON r.id = p.receivable_id
    WHERE r.org_id = public.user_org_id()
      AND p.collected_at < (p_as_of + 1)::timestamptz
      -- ⚠ Q13 — CẤN TRỪ KHÔNG PHẢI TIỀN VÀO KÉT. Xem đầu tệp.
      AND COALESCE(p.method, '') NOT IN ('return_credit', 'credit_applied')
  ),
  paid_payables AS (
    SELECT COALESCE(SUM(COALESCE(pp.amount, 0)), 0) AS v
    FROM payable_payments pp
    JOIN payables pa ON pa.id = pp.payable_id
    WHERE pa.org_id = public.user_org_id()
      AND pp.paid_at < (p_as_of + 1)::timestamptz
  ),
  exp AS (
    SELECT
      COALESCE(SUM(COALESCE(amount, 0)) FILTER (WHERE is_paid), 0)     AS paid,
      COALESCE(SUM(COALESCE(amount, 0)) FILTER (WHERE NOT is_paid), 0) AS unpaid
    FROM expenses
    WHERE org_id = public.user_org_id()
      AND expense_date <= p_as_of
  ),
  ar AS (
    SELECT COALESCE(SUM(GREATEST(0, COALESCE(amount, 0) - COALESCE(paid, 0))), 0) AS v
    FROM receivables
    WHERE org_id = public.user_org_id() AND status <> 'paid'
  ),
  inv AS (
    SELECT COALESCE(SUM(COALESCE(qty_on_hand, 0) * COALESCE(unit_cost, 0)), 0) AS v
    FROM batches
    WHERE org_id = public.user_org_id() AND COALESCE(qty_on_hand, 0) > 0
  ),
  ap AS (
    SELECT COALESCE(SUM(GREATEST(0, COALESCE(amount, 0) - COALESCE(paid, 0))), 0) AS v
    FROM payables
    WHERE org_id = public.user_org_id() AND status <> 'paid'
  )
  SELECT
    cash_in.v - paid_payables.v - exp.paid,
    ar.v,
    inv.v,
    ap.v,
    exp.unpaid
  FROM cash_in, paid_payables, exp, ar, inv, ap;
$$;

-- --------------------------------------------------------------------
-- 4. finance_cash_flow — `cash_from_customers` chỉ đếm TIỀN THẬT.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.finance_cash_flow(date, date);
CREATE FUNCTION public.finance_cash_flow(p_from date, p_to date)
RETURNS TABLE (
  cash_from_customers numeric,
  cash_to_suppliers   numeric,
  cash_to_expenses    numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE((
      SELECT SUM(COALESCE(p.amount, 0))
      FROM payments p
      JOIN receivables r ON r.id = p.receivable_id
      WHERE r.org_id = public.user_org_id()
        AND p.collected_at >= p_from::timestamptz
        AND p.collected_at <  (p_to + 1)::timestamptz
        -- ⚠ Q13 — CẤN TRỪ KHÔNG PHẢI TIỀN VÀO KÉT. Xem đầu tệp.
        AND COALESCE(p.method, '') NOT IN ('return_credit', 'credit_applied')
    ), 0),
    COALESCE((
      SELECT SUM(COALESCE(pp.amount, 0))
      FROM payable_payments pp
      JOIN payables pa ON pa.id = pp.payable_id
      WHERE pa.org_id = public.user_org_id()
        AND pp.paid_at >= p_from::timestamptz
        AND pp.paid_at <  (p_to + 1)::timestamptz
    ), 0),
    COALESCE((
      SELECT SUM(COALESCE(amount, 0))
      FROM expenses
      WHERE org_id = public.user_org_id()
        AND is_paid = true
        AND paid_at >= p_from::timestamptz
        AND paid_at <  (p_to + 1)::timestamptz
    ), 0);
$$;

-- --------------------------------------------------------------------
-- Phân quyền — `DROP FUNCTION` xoá luôn GRANT cũ, phải cấp lại.
--
-- ⚠ QUÊN KHỐI NÀY LÀ BỐN MÀN BÁO CÁO TRẮNG XOÁ với lỗi "permission
--   denied for function", trong khi migration chạy xong không báo gì.
-- --------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.receivables_by_rep()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.receivables_by_customer()     TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_balance_sheet(date)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_cash_flow(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- --------------------------------------------------------------------
-- Đếm phần dữ liệu mà bản vá này đụng tới. Không sửa gì — chỉ nói ra,
-- để chủ NPP biết con số trên báo cáo sắp đổi bao nhiêu và vì sao.
-- --------------------------------------------------------------------
DO $$
DECLARE
  v_over  int;
  v_sum   numeric;
  v_ncash int;
  v_nsum  numeric;
BEGIN
  SELECT count(*), COALESCE(sum(COALESCE(paid,0) - COALESCE(amount,0)), 0)
    INTO v_over, v_sum
  FROM receivables
  WHERE COALESCE(paid, 0) > COALESCE(amount, 0);

  SELECT count(*), COALESCE(sum(COALESCE(amount, 0)), 0)
    INTO v_ncash, v_nsum
  FROM payments
  WHERE COALESCE(method, '') IN ('return_credit', 'credit_applied');

  RAISE NOTICE '--- 121: % dòng công nợ đang DƯ, tổng số dư có %đ — trước bản vá phần này bị trừ thẳng vào công nợ ---', v_over, v_sum;
  RAISE NOTICE '--- 121: % dòng payments KHÔNG phải tiền mặt, tổng %đ — trước bản vá phần này bị đếm là tiền vào két ---', v_ncash, v_nsum;
  IF v_ncash > 0 THEN
    RAISE NOTICE '--- 121 ⚠ Tiền mặt trên bảng cân đối sẽ GIẢM %đ sau khi chạy. Đó là sửa đúng, không phải mất tiền. ---', v_nsum;
  END IF;
END $$;


-- ####################################################################
-- # 122_retire_driver_role.sql
-- ####################################################################

-- ---------------------------------------------------------------------
-- 122 — Bỏ vai TÀI XẾ: khoá các tài khoản đang mang vai đó, chặn gán
--       mới, và làm cho "khoá tài khoản" THẬT SỰ khoá
-- ---------------------------------------------------------------------
--
-- Workflow v2 bỏ bước lập chuyến giao; P7 ẩn `/deliveries` và khoá mọi
-- nút ghi ở đó. Vai `driver` vì thế không còn việc riêng trên hệ thống.
-- Chủ NPP chọn: KHOÁ tài khoản, KHÔNG đổi vai của ai.
--
-- ⚠ VÌ SAO KHÔNG SIẾT LUÔN `CHECK (role IN (...))`.
--   Chủ NPP cố ý giữ `role = 'driver'` trên các dòng cũ — đó là hồ sơ
--   nhân sự, và `deliveries.driver_id` trỏ thẳng vào những dòng đó.
--   Siết ràng buộc là ALTER TABLE ném lỗi ngay trên chính dữ liệu đang
--   có. Chặn GÁN MỚI phải làm bằng trigger, vì CHECK không phân biệt
--   được dòng cũ với dòng mới.
--
-- =====================================================================
-- ⚠ PHÁT HIỆN KHI LÀM: `is_active = false` TRƯỚC NAY KHÔNG KHOÁ GÌ CẢ
-- =====================================================================
--
-- Đây là lỗ có sẵn, không phải do đợt này sinh ra, nhưng nó làm hỏng
-- đúng thứ chủ NPP vừa chọn.
--
-- Cả kho chỉ có MỘT chỗ đọc `users.is_active` để chặn: đường đăng nhập
-- bằng mã QR (`src/app/qr-login/route.ts`). Đường đăng nhập thường
-- (email + mật khẩu) đọc `is_active` vào hồ sơ rồi... không hỏi tới nó
-- lần nào. Phía cơ sở dữ liệu cũng vậy: `user_org_id()` và `user_role()`
-- chỉ tra `org_id` / `role` theo `auth.uid()`, không nhìn `is_active`,
-- nên MỌI policy RLS vẫn cho qua.
--
-- Nghĩa là: nhân viên đã nghỉ việc, đã bị "Khoá tài khoản" ở màn Cài
-- đặt → Người dùng, VẪN đăng nhập được bằng mật khẩu cũ và vẫn giữ
-- nguyên quyền của vai mình. Nút "Khoá" từ trước tới nay chỉ là một cái
-- nhãn.
--
-- ⚠ CHỮA Ở HAI HÀM HELPER, KHÔNG ĐI SỬA 167 POLICY. Mọi policy RLS đều
--   đi qua `user_org_id()`; trả NULL ở đó là mọi phép so `org_id = NULL`
--   thành NULL → không dòng nào khớp → chặn sạch, một chỗ sửa.
--
-- ⚠ `COALESCE(is_active, true)` LÀ BẮT BUỘC. Cột này NULL được
--   (`is_active boolean DEFAULT true`, mig 001 — không NOT NULL). Dòng
--   nào có NULL mà đọc thành "không hoạt động" là khoá oan một người
--   đang đi làm, và khoá theo kiểu im lặng nhất: app trống trơn, không
--   câu nào giải thích.
--
-- ⚠ RLS TỪ CHỐI LÀ IM LẶNG — 0 dòng, HTTP 200, `error` null. Khoá ở đây
--   chỉ làm app trống, KHÔNG nói vì sao. Câu giải thích và lệnh đăng
--   xuất nằm ở `src/hooks/use-auth.tsx`. Hai lớp phải đi cùng nhau: lớp
--   này để không lách được, lớp kia để người dùng hiểu chuyện gì xảy ra.
-- ---------------------------------------------------------------------

-- --------------------------------------------------------------------
-- 1. Xem trước: những tài khoản SẮP bị khoá.
--
-- ⚠ IN RA TRƯỚC KHI ĐỔI. Đây là thao tác hàng loạt lên quyền truy cập
--   của người thật; chủ NPP phải đọc được danh sách để gọi cho họ.
-- --------------------------------------------------------------------
DO $$
DECLARE r record; v_n int := 0;
BEGIN
  FOR r IN
    SELECT u.full_name, u.phone, o.name AS org
    FROM users u LEFT JOIN organizations o ON o.id = u.org_id
    WHERE u.role = 'driver' AND COALESCE(u.is_active, true) = true
    ORDER BY o.name, u.full_name
  LOOP
    v_n := v_n + 1;
    RAISE NOTICE '122 — sẽ khoá: % (%) — %', r.full_name, COALESCE(r.phone, 'chưa có SĐT'), r.org;
  END LOOP;
  IF v_n = 0 THEN
    RAISE NOTICE '122 — không có tài khoản tài xế nào đang hoạt động.';
  END IF;
END $$;

-- --------------------------------------------------------------------
-- 2. Khoá. KHÔNG đổi `role`, KHÔNG xoá dòng nào.
--
-- ⚠ Xoá tài khoản là mất hồ sơ: `deliveries.driver_id` trỏ vào đây, và
--   mọi chuyến giao cũ sẽ mất tên người giao.
-- --------------------------------------------------------------------
DO $$
DECLARE v_n int;
BEGIN
  UPDATE users
  SET is_active = false
  WHERE role = 'driver' AND COALESCE(is_active, true) = true;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '--- 122: đã khoá % tài khoản tài xế (vai giữ nguyên, hồ sơ giữ nguyên) ---', v_n;
END $$;

-- --------------------------------------------------------------------
-- 3. Làm cho việc khoá THẬT SỰ có hiệu lực.
--
-- Hai hàm này là cửa ngõ của toàn bộ RLS. Trả NULL cho người đã bị khoá
-- là mọi policy đều không khớp dòng nào.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_org_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  -- ⚠ `COALESCE(is_active, true)`: cột NULL được, và NULL nghĩa là CHƯA
  --   AI KHOÁ — không phải "đã khoá".
  RETURN (
    SELECT org_id FROM public.users
    WHERE id = (SELECT auth.uid())
      AND COALESCE(is_active, true) = true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.user_role()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT role FROM public.users
    WHERE id = (SELECT auth.uid())
      AND COALESCE(is_active, true) = true
  );
END;
$$;

COMMENT ON FUNCTION public.user_org_id() IS
  'Đơn vị của người đang đăng nhập, NULL nếu tài khoản đã bị khoá. '
  'Mọi policy RLS đi qua đây, nên đó là chỗ duy nhất cần chặn.';
COMMENT ON FUNCTION public.user_role() IS
  'Vai của người đang đăng nhập, NULL nếu tài khoản đã bị khoá.';

-- --------------------------------------------------------------------
-- 4. Chặn gán vai `driver` cho người mới.
--
-- ⚠ TRIGGER CHỨ KHÔNG PHẢI CHECK. Ràng buộc CHECK áp cho cả dòng cũ, mà
--   dòng cũ cố ý giữ nguyên `role = 'driver'` — siết CHECK là ALTER
--   TABLE hỏng ngay trên dữ liệu đang có.
--
-- ⚠ CHỈ CHẶN KHI GIÁ TRỊ THẬT SỰ ĐỔI THÀNH 'driver'. Dòng tài xế cũ vẫn
--   phải sửa được (đổi số điện thoại, đổi tên, và nhất là ĐỔI SANG VAI
--   KHÁC). Chặn mọi UPDATE chạm vào dòng đó là nhốt luôn chủ NPP ngoài
--   cửa, không còn đường dọn dẹp.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_block_driver_role()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.role = 'driver' AND (TG_OP = 'INSERT' OR OLD.role IS DISTINCT FROM 'driver') THEN
    RAISE EXCEPTION
      'ROLE_RETIRED: vai Tài xế đã ngưng dùng — quy trình mới không còn bước lập chuyến giao. Chọn vai khác.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_driver_role ON users;
CREATE TRIGGER trg_block_driver_role
  BEFORE INSERT OR UPDATE OF role ON users
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_driver_role();

NOTIFY pgrst, 'reload schema';

-- --------------------------------------------------------------------
-- Đếm phần còn lại để chủ NPP biết còn gì phải dọn tay.
-- --------------------------------------------------------------------
DO $$
DECLARE v_left int; v_deliv int;
BEGIN
  SELECT count(*) INTO v_left FROM users WHERE role = 'driver';
  SELECT count(*) INTO v_deliv FROM deliveries WHERE driver_id IS NOT NULL;
  RAISE NOTICE '--- 122: còn % dòng users mang vai driver (đã khoá, giữ làm hồ sơ) ---', v_left;
  RAISE NOTICE '--- 122: % chuyến giao cũ đang trỏ driver_id — đó là lý do KHÔNG xoá các dòng trên ---', v_deliv;
  IF v_left > 0 THEN
    RAISE NOTICE '--- 122: muốn họ đi làm lại thì vào Cài đặt → Người dùng, đổi sang vai khác rồi mở khoá ---';
  END IF;
END $$;


-- ####################################################################
-- # 123_post_stock_adjustment.sql
-- ####################################################################

-- ---------------------------------------------------------------------
-- 123 — Duyệt phiếu kiểm kê: đưa về MỘT RPC, một giao dịch
--
-- TRIỆU CHỨNG (chủ NPP báo): bấm "Duyệt điều chỉnh", màn báo
--   "Đã duyệt … Kho đã cập nhật" — mà tồn kho KHÔNG đổi một con số nào.
-- ---------------------------------------------------------------------
--
-- NGUYÊN NHÂN: bất đối xứng quyền, cộng với cái bẫy cũ của cả dự án này —
-- RLS TỪ CHỐI LÀ 0 DÒNG, HTTP 200, `error` NULL.
--
-- Nút "Duyệt điều chỉnh" mở cho `owner` và `manager`
-- (`canApprove` ở màn `/inventory/adjustments`). Nhưng policy của
-- `batches` (mig 002) và `stock_entries` (mig 002) chỉ cho
-- `owner` và `warehouse` GHI. Với một người dùng vai `manager`:
--
--   | Bước                    | Bảng            | manager | Kết quả        |
--   |-------------------------|-----------------|---------|----------------|
--   | 1. cộng/trừ tồn         | `batches`       | KHÔNG   | 0 dòng, im lặng|
--   | 2. ghi chi phí hao hụt  | `expenses`      | CÓ      | **GHI THẬT**   |
--   | 3. đóng dấu đã duyệt    | `stock_entries` | KHÔNG   | 0 dòng, im lặng|
--
-- `.throwOnError()` của supabase-js chỉ ném khi `error` KHÁC NULL. RLS từ
-- chối không phải là lỗi — nó là "không có dòng nào khớp". Nên cả ba
-- bước trôi qua êm, và giao diện báo thành công.
--
-- ⚠ HẬU QUẢ TỆ HƠN "KHÔNG ĐỔI GÌ": bước 2 CHẠY ĐƯỢC. Sổ chi phí ghi một
--   khoản hao hụt mà kho không hề giảm — sách và hàng lệch nhau đúng
--   bằng số đó. Và vì bước 3 không chạy, phiếu vẫn nằm ở "chờ duyệt":
--   bấm lại lần nữa là ghi thêm MỘT khoản chi phí trùng nữa. Bấm ba lần,
--   ba khoản.
--
-- ⚠ VÌ SAO KHÔNG AI PHÁT HIỆN SỚM: với vai `owner` thì cả ba bước đều
--   chạy đúng. Người thử nghiệm thường là chủ NPP.
--
-- ---------------------------------------------------------------------
-- CÁCH SỬA: không vá quyền, mà bỏ hẳn vòng lặp ghi từ trình duyệt.
--
-- Bản cũ đọc `batches` rồi ghi lại từng lô một, mỗi lô một lượt mạng.
-- Ngoài chuyện quyền, nó còn ba lỗi nữa mà RPC này xoá bỏ cùng lúc:
--   · KHÔNG PHẢI MỘT GIAO DỊCH — hỏng giữa chừng thì vài lô đã đổi, phiếu
--     chưa đóng dấu, và lần bấm sau cộng chồng lên phần đã cộng;
--   · ĐỌC RỒI GHI (`select qty_on_hand` … `update`) — hai người duyệt hai
--     phiếu cùng lúc thì một người ghi đè mất phần của người kia;
--   · `Math.max(0, current + diff)` KẸP ÂM TRONG IM LẶNG — tồn đã đổi từ
--     lúc kiểm đếm thì phần chênh biến mất, không ai được báo.
--
-- Coder Pack, mục quy ước: "Mọi thao tác đụng tồn kho / công nợ / trạng
-- thái đơn PHẢI đi qua RPC SECURITY DEFINER, một transaction, idempotent.
-- Không loop update từ browser."
-- ---------------------------------------------------------------------

-- --------------------------------------------------------------------
-- Mở ô quyền `inventory.approve` cho quản lý.
--
-- ⚠ `user_has_permission` trả FALSE khi `role_permissions` chưa có dòng
--   (xem mig 120, mục 0c) — không seed thì sau migration này quản lý bấm
--   Duyệt sẽ nhận 'FORBIDDEN', đúng cái nút giao diện vẫn hiện.
--
-- ⚠ KHÔNG mở cho `warehouse`, và đó là CỐ Ý: kho là người ĐẾM. Cho người
--   đếm tự duyệt phần chênh của chính mình là bỏ mất lớp soát duy nhất
--   trên một thao tác ghi thẳng vào tồn kho và sổ chi phí.
-- --------------------------------------------------------------------
INSERT INTO role_permissions (org_id, role, module, action, allowed)
SELECT o.id, 'manager', 'inventory', 'approve', true
FROM organizations o
ON CONFLICT DO NOTHING;

-- --------------------------------------------------------------------
-- post_stock_adjustment — duyệt một phiếu kiểm kê.
--
-- Trả về số lô đã đụng, tổng hao hụt và tổng thừa, để giao diện NÓI ĐÚNG
-- việc vừa xảy ra thay vì đoán.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.post_stock_adjustment(uuid);
CREATE FUNCTION public.post_stock_adjustment(p_entry_id uuid)
RETURNS TABLE (
  batches_touched int,
  shrink_qty      numeric,
  shrink_value    numeric,
  surplus_qty     numeric,
  surplus_value   numeric,
  expense_id      uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e            record;
  l            record;
  b            record;
  v_org        uuid := public.user_org_id();
  v_touched    int := 0;
  v_shrink_q   numeric := 0;
  v_shrink_v   numeric := 0;
  v_surplus_q  numeric := 0;
  v_surplus_v  numeric := 0;
  v_exp        uuid;
  v_cat        uuid;
  v_left       numeric;
  v_take       numeric;
  v_target     uuid;
  v_cost       numeric;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: tài khoản chưa gắn đơn vị, hoặc đã bị khoá'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO e FROM stock_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTRY_NOT_FOUND: không tìm thấy phiếu kiểm kê'
      USING ERRCODE = 'P0001';
  END IF;
  IF e.org_id <> v_org THEN
    RAISE EXCEPTION 'ORG_MISMATCH: phiếu không thuộc đơn vị của bạn'
      USING ERRCODE = 'P0001';
  END IF;

  -- ⚠ CHỐT IDEMPOTENT. `FOR UPDATE` ở trên khoá dòng phiếu, nên hai lần
  --   bấm song song thì người thứ hai chờ, rồi đọc được `status` đã đổi
  --   và dừng ở đây. Không có chốt này, hai lần bấm là cộng tồn hai lần.
  IF e.status = 'posted' THEN
    RAISE EXCEPTION 'ALREADY_POSTED: phiếu % đã được duyệt lúc %',
      e.entry_code, to_char(e.posted_at, 'HH24:MI DD/MM/YYYY')
      USING ERRCODE = 'P0001';
  END IF;
  IF e.status <> 'draft' THEN
    RAISE EXCEPTION 'BAD_STATUS: phiếu % đang ở trạng thái %, không duyệt được',
      e.entry_code, e.status
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.user_has_permission(auth.uid(), 'inventory.approve') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền duyệt điều chỉnh kho'
      USING ERRCODE = 'P0001';
  END IF;

  -- ==================================================================
  -- Áp từng dòng chênh lệch.
  -- ==================================================================
  FOR l IN
    SELECT sel.id, sel.product_id, sel.batch_id, sel.quantity,
           COALESCE(sel.unit_cost, 0) AS unit_cost,
           p.name AS product_name
    FROM stock_entry_lines sel
    LEFT JOIN products p ON p.id = sel.product_id
    WHERE sel.entry_id = p_entry_id
    ORDER BY sel.id
  LOOP
    CONTINUE WHEN COALESCE(l.quantity, 0) = 0;

    v_cost := l.unit_cost;

    IF l.batch_id IS NOT NULL THEN
      -- --------------------------------------------------------------
      -- Dòng có lô rõ ràng: cộng/trừ thẳng vào đúng lô đã đếm.
      -- --------------------------------------------------------------
      SELECT id, qty_on_hand, COALESCE(unit_cost, 0) AS unit_cost
        INTO b
      FROM batches WHERE id = l.batch_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'BATCH_GONE: lô của dòng "%" không còn tồn tại',
          COALESCE(l.product_name, l.product_id::text)
          USING ERRCODE = 'P0001';
      END IF;

      -- ⚠ KHÔNG KẸP ÂM TRONG IM LẶNG. Bản cũ làm `GREATEST(0, …)` nên
      --   phần chênh biến mất mà không ai biết. Tồn đã đổi từ lúc kiểm
      --   đếm là chuyện CẦN NGƯỜI XEM, không phải chuyện để nuốt.
      IF COALESCE(b.qty_on_hand, 0) + l.quantity < 0 THEN
        RAISE EXCEPTION
          'STOCK_MOVED: "%" tồn hiện %, phiếu trừ % — tồn đã đổi từ lúc kiểm đếm. Kiểm đếm lại rồi lập phiếu mới.',
          COALESCE(l.product_name, l.product_id::text),
          COALESCE(b.qty_on_hand, 0), -l.quantity
          USING ERRCODE = 'P0001';
      END IF;

      UPDATE batches
      SET qty_on_hand = COALESCE(qty_on_hand, 0) + l.quantity
      WHERE id = l.batch_id;
      v_touched := v_touched + 1;
      IF v_cost = 0 THEN v_cost := b.unit_cost; END IF;

    ELSIF l.quantity < 0 THEN
      -- --------------------------------------------------------------
      -- Hao hụt không rõ lô → trừ theo FEFO (hạn gần nhất trước).
      -- --------------------------------------------------------------
      v_left := -l.quantity;
      FOR b IN
        SELECT id, qty_on_hand, COALESCE(unit_cost, 0) AS unit_cost
        FROM batches
        WHERE org_id = v_org AND product_id = l.product_id
          AND COALESCE(qty_on_hand, 0) > 0
        ORDER BY expires_at NULLS LAST, id
        FOR UPDATE
      LOOP
        EXIT WHEN v_left <= 0;
        v_take := LEAST(COALESCE(b.qty_on_hand, 0), v_left);
        UPDATE batches SET qty_on_hand = COALESCE(qty_on_hand, 0) - v_take WHERE id = b.id;
        -- Ghi lại lô đã bị trừ — không có vết này thì không ai đối chiếu
        -- được về sau là phiếu đã đụng vào đâu.
        UPDATE stock_entry_lines SET batch_id = b.id WHERE id = l.id AND batch_id IS NULL;
        IF v_cost = 0 THEN v_cost := b.unit_cost; END IF;
        v_left := v_left - v_take;
        v_touched := v_touched + 1;
      END LOOP;

      IF v_left > 0 THEN
        RAISE EXCEPTION
          'NOT_ENOUGH_STOCK: "%" chỉ còn % để trừ, phiếu trừ % — kiểm đếm lại.',
          COALESCE(l.product_name, l.product_id::text),
          -l.quantity - v_left, -l.quantity
          USING ERRCODE = 'P0001';
      END IF;

    ELSE
      -- --------------------------------------------------------------
      -- Thừa không rõ lô → cộng vào lô còn hạn XA NHẤT.
      --
      -- ⚠ BẢN CŨ BỎ QUA TRONG IM LẶNG khi sản phẩm chưa có lô nào. Phần
      --   thừa biến mất, phiếu vẫn đóng dấu đã duyệt. Ở đây nói ra.
      -- --------------------------------------------------------------
      SELECT id, COALESCE(unit_cost, 0) AS unit_cost INTO b
      FROM batches
      WHERE org_id = v_org AND product_id = l.product_id
      ORDER BY expires_at DESC NULLS LAST, id
      LIMIT 1
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'NO_BATCH: "%" chưa có lô nào để ghi phần thừa. Tạo lô cho sản phẩm này trước.',
          COALESCE(l.product_name, l.product_id::text)
          USING ERRCODE = 'P0001';
      END IF;

      v_target := b.id;
      UPDATE batches SET qty_on_hand = COALESCE(qty_on_hand, 0) + l.quantity WHERE id = v_target;
      UPDATE stock_entry_lines SET batch_id = v_target WHERE id = l.id AND batch_id IS NULL;
      IF v_cost = 0 THEN v_cost := b.unit_cost; END IF;
      v_touched := v_touched + 1;
    END IF;

    IF l.quantity < 0 THEN
      v_shrink_q := v_shrink_q + (-l.quantity);
      v_shrink_v := v_shrink_v + (-l.quantity) * v_cost;
    ELSE
      v_surplus_q := v_surplus_q + l.quantity;
      v_surplus_v := v_surplus_v + l.quantity * v_cost;
    END IF;
  END LOOP;

  -- ==================================================================
  -- Chi phí hao hụt — CÙNG giao dịch với phần trừ kho.
  --
  -- ⚠ Bản cũ ghi chi phí ở một lượt mạng riêng, TRƯỚC khi đóng dấu
  --   phiếu. Hỏng ở bước sau là sổ có chi phí mà phiếu vẫn "chờ duyệt".
  -- ==================================================================
  IF v_shrink_v > 0 THEN
    SELECT id INTO v_cat FROM expense_categories
    WHERE org_id = v_org AND code = 'COGS_ADJ' LIMIT 1;
    IF v_cat IS NULL THEN
      SELECT id INTO v_cat FROM expense_categories WHERE org_id = v_org ORDER BY code LIMIT 1;
    END IF;

    INSERT INTO expenses (
      org_id, category_id, expense_date, amount, description,
      reference_code, source_type, source_id, created_by
    ) VALUES (
      v_org, v_cat, CURRENT_DATE, v_shrink_v,
      'Hao hụt từ phiếu kiểm kê ' || e.entry_code,
      e.entry_code, 'stocktake', e.id, auth.uid()
    )
    RETURNING id INTO v_exp;
  END IF;

  UPDATE stock_entries
  SET status = 'posted', posted_at = now()
  WHERE id = p_entry_id;

  RETURN QUERY SELECT v_touched, v_shrink_q, v_shrink_v, v_surplus_q, v_surplus_v, v_exp;
END;
$$;

REVOKE ALL ON FUNCTION public.post_stock_adjustment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_stock_adjustment(uuid) TO authenticated;

COMMENT ON FUNCTION public.post_stock_adjustment(uuid) IS
  'Duyệt phiếu kiểm kê trong MỘT giao dịch: cộng/trừ tồn theo từng dòng, '
  'ghi chi phí hao hụt, đóng dấu phiếu. Idempotent bằng khoá dòng phiếu '
  'và chốt ALREADY_POSTED. Thay cho vòng lặp ghi từ trình duyệt — vòng '
  'lặp đó im lặng khi RLS từ chối (0 dòng, HTTP 200, error null).';

NOTIFY pgrst, 'reload schema';

-- --------------------------------------------------------------------
-- Đếm thiệt hại đã có: phiếu kiểm kê nào ĐÃ ghi chi phí hao hụt mà chưa
-- được đóng dấu duyệt — dấu vết của đúng cái lỗi này.
-- --------------------------------------------------------------------
DO $$
DECLARE r record; v_n int := 0; v_sum numeric := 0;
BEGIN
  FOR r IN
    SELECT se.entry_code, count(*) AS n, sum(x.amount) AS amt
    FROM stock_entries se
    JOIN expenses x ON x.source_type = 'stocktake' AND x.source_id = se.id
    WHERE se.status <> 'posted'
    GROUP BY se.entry_code
    ORDER BY se.entry_code
  LOOP
    v_n := v_n + 1;
    v_sum := v_sum + COALESCE(r.amt, 0);
    RAISE NOTICE '123 ⚠ phiếu % chưa duyệt nhưng đã có % khoản chi phí hao hụt, tổng %đ', r.entry_code, r.n, r.amt;
  END LOOP;

  IF v_n = 0 THEN
    RAISE NOTICE '--- 123: không có phiếu kiểm kê nào dính lỗi ghi chi phí mà không trừ kho ---';
  ELSE
    RAISE NOTICE '--- 123 ⚠ % phiếu dính lỗi, tổng chi phí ghi khống %đ. Migration KHÔNG tự xoá — xem lại từng phiếu rồi quyết. ---', v_n, v_sum;
  END IF;
END $$;


-- ####################################################################
-- # 124_wf2b_sales_invoices.sql
-- ####################################################################

-- ---------------------------------------------------------------------
-- 124 — Workflow v2b: tách Đơn đặt hàng (SO) khỏi Hóa đơn bán (INV)
--
-- Phần CẤU TRÚC. Các RPC nằm ở migration 125.
-- ---------------------------------------------------------------------
--
-- ⚠ 124 VÀ 125 PHẢI CHẠY CÙNG NHAU. File này DROP `complete_order`,
--   `edit_completed_order`, `cancel_order` và `_wf2_recompute_receivable`
--   ở cuối; 125 mới dựng lại bộ thay thế. Chạy 124 một mình là ứng dụng
--   không còn đường nào để xuất hàng.
--
-- ---------------------------------------------------------------------
-- HAI CHỨNG TỪ, HAI VIỆC KHÁC NHAU
-- ---------------------------------------------------------------------
--
-- `sales_orders` (SO) — CAM KẾT CỦA KHÁCH. NVBH tạo. Không đụng kho,
-- không đụng công nợ. Sửa được chừng nào chưa xuất.
--
-- `sales_invoices` (INV) — THỰC XUẤT. Trừ kho FIFO, sinh công nợ, in
-- phiếu giao, là nguồn của hoá đơn điện tử và của doanh thu. Một SO đẻ
-- ra 0..n INV.
--
-- ⚠ VÌ SAO PHẢI TÁCH, nói bằng chuyện đã xảy ra: workflow v2 gộp hai thứ
--   này vào một dòng `sales_orders`. Hệ quả là "sửa đơn đã xuất" phải
--   tính DELTA kho (`edit_completed_order`), và để delta không phá sổ thì
--   phải dựng bốn khoá chặn (`_wf2_assert_order_unlocked`). Càng chặt
--   càng nhiều thứ không sửa được; càng lỏng càng dễ lệch kho. Tách ra
--   thì không còn delta: sai thì HUỶ hoá đơn rồi lập lại, kho hoàn về
--   đúng lô đã lấy.
--
-- ---------------------------------------------------------------------
-- ⚠ CHỐT CHẶN ĐẦU FILE — ĐỌC TRƯỚC KHI CHẠY
-- ---------------------------------------------------------------------
--
-- Backfill ở mục 9 đọc `sales_orders WHERE status = 'completed'`. Giá trị
-- đó do migration 119 sinh ra. Nếu 119 chưa chạy, bảng còn mang sáu giá
-- trị của luồng cũ (`confirmed`, `picking`, `delivering`, `delivered`…)
-- và backfill khớp 0 dòng — nó chạy ÊM RU rồi tạo ra 0 hoá đơn, không
-- lỗi nào bắn ra. Đó đúng là kiểu hỏng im lặng cả hai pack đang chống,
-- nên khối dưới đây DỪNG HẲN thay vì để nó trôi qua.
-- ---------------------------------------------------------------------
DO $$
DECLARE v_legacy int; v_list text;
BEGIN
  SELECT count(*), string_agg(DISTINCT status, ', ')
    INTO v_legacy, v_list
  FROM sales_orders
  WHERE status NOT IN ('draft', 'submitted', 'completed', 'cancelled');

  IF v_legacy > 0 THEN
    RAISE EXCEPTION
      'WF2B_NEEDS_V2: còn % đơn mang trạng thái của luồng cũ (%). Chạy migration 118 → 119 → 120 → 121 → 122 → 123 TRƯỚC, rồi chạy lại file này.',
      v_legacy, v_list
      USING ERRCODE = 'P0001';
  END IF;

  IF to_regclass('public.stock_line_consumptions') IS NULL THEN
    RAISE EXCEPTION
      'WF2B_NEEDS_V2: chưa có bảng stock_line_consumptions (migration 119). Hoàn kho khi huỷ hoá đơn dựa hẳn vào nó.'
      USING ERRCODE = 'P0001';
  END IF;
END $$;


-- =====================================================================
-- 1. sales_invoices — hóa đơn bán
-- =====================================================================
--
-- ⚠ KHÔNG CÓ TRẠNG THÁI NHÁP. Hoá đơn sinh ra và ghi sổ trong CÙNG một
--   RPC; màn "chỉnh số lượng trước khi xuất" là trạng thái trên trình
--   duyệt, chưa chạm cơ sở dữ liệu. Có `draft` trong bảng là mở đường
--   cho một hoá đơn nằm lơ lửng: kho chưa trừ nhưng giấy đã in.
--
-- ⚠ `replaced_from` / `replaced_by` phục vụ việc SỬA hoá đơn. Về mặt kỹ
--   thuật không có sửa: `reissue_invoice` huỷ bản cũ rồi lập bản mới
--   trong một giao dịch. Hai cột này là sợi dây nối hai bản lại, để tra
--   cứu về sau còn biết bản đang xem thay cho cái gì.
CREATE TABLE IF NOT EXISTS sales_invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_code   text NOT NULL,
  order_id       uuid NOT NULL REFERENCES sales_orders(id),
  customer_id    uuid NOT NULL REFERENCES customers(id),
  sales_user_id  uuid REFERENCES users(id),
  invoice_date   date NOT NULL DEFAULT CURRENT_DATE,
  status         text NOT NULL DEFAULT 'posted'
                 CHECK (status IN ('posted', 'cancelled')),
  subtotal       numeric NOT NULL DEFAULT 0,
  vat            numeric NOT NULL DEFAULT 0,
  total          numeric NOT NULL DEFAULT 0,
  payment_terms  text,
  due_date       date,
  stock_entry_id uuid REFERENCES stock_entries(id),
  notes          text,
  replaced_from  uuid REFERENCES sales_invoices(id),
  replaced_by    uuid REFERENCES sales_invoices(id),
  posted_at      timestamptz DEFAULT now(),
  posted_by      uuid REFERENCES users(id),
  cancelled_at   timestamptz,
  cancelled_by   uuid REFERENCES users(id),
  cancel_reason  text,
  created_at     timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_invoices_code
  ON sales_invoices(org_id, invoice_code);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_org_status
  ON sales_invoices(org_id, status, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_order   ON sales_invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer ON sales_invoices(customer_id);

COMMENT ON TABLE sales_invoices IS
  'Hóa đơn bán — chứng từ THỰC XUẤT: trừ kho, sinh công nợ, nguồn doanh '
  'thu và hoá đơn điện tử. 1 đơn đặt hàng → 0..n hóa đơn. Không sửa tại '
  'chỗ: sai thì huỷ rồi lập lại (reissue_invoice), replaced_from/_by nối '
  'hai bản.';

-- =====================================================================
-- 2. sales_invoice_lines
-- =====================================================================
--
-- ⚠ `order_line_id` CHO PHÉP NULL, hai trường hợp:
--   · dòng hàng ĐỔI (`is_exchange`) — nó đến từ phiếu trả, không từ đơn;
--   · dòng NPP thêm ngoài đơn lúc xuất (PATCH 1 cho phép).
--   Trigger đồng bộ ở mục 3 bỏ qua các dòng này, nên chúng không ảnh
--   hưởng việc tính "đơn đã xuất đủ chưa".
--
-- ⚠ `vat_rate` SNAPSHOT TẠI THỜI ĐIỂM XUẤT. `sales_order_lines` KHÔNG có
--   cột thuế suất (chỉ `return_lines` mới có, mig 069) — v2 đọc thẳng
--   `products.vat_rate` lúc tính tiền. Hệ quả cần biết: đổi thuế suất
--   sản phẩm rồi xuất tiếp đợt hai của cùng một đơn thì hai hoá đơn mang
--   thuế suất KHÁC NHAU. Đúng về kế toán (thuế theo ngày xuất), nhưng dễ
--   bị tưởng là lỗi nếu không biết trước.
CREATE TABLE IF NOT EXISTS sales_invoice_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id        uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  order_line_id     uuid REFERENCES sales_order_lines(id),
  product_id        uuid NOT NULL REFERENCES products(id),
  unit_name         text NOT NULL,
  conversion_factor numeric(18, 6) NOT NULL DEFAULT 1,
  quantity          numeric NOT NULL,
  unit_price        numeric NOT NULL DEFAULT 0,
  line_discount     numeric NOT NULL DEFAULT 0,
  line_total        numeric NOT NULL DEFAULT 0,
  vat_rate          numeric NOT NULL DEFAULT 0,
  is_exchange       boolean NOT NULL DEFAULT false,
  sort_order        int NOT NULL DEFAULT 0,
  note              text
);

CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_invoice ON sales_invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_orderline ON sales_invoice_lines(order_line_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_product ON sales_invoice_lines(product_id);


-- =====================================================================
-- 3. sales_order_lines.invoiced_qty — đã xuất bao nhiêu
-- =====================================================================
--
-- ⚠ CÙNG ĐƠN VỊ VỚI `quantity` CỦA DÒNG ĐƠN, không quy về đơn vị cơ sở.
--   Quy đổi hai chiều là chỗ sinh lệch: dòng đặt "2 thùng" mà đã xuất
--   ghi "20 hộp" thì phép so "đã xuất đủ chưa" phải nhân chia mỗi lần
--   đọc, và chỉ cần một chỗ quên là đơn hiện Hoàn thành khi mới giao nửa.
--
-- ⚠ TÍNH LẠI TỪ ĐẦU, KHÔNG CỘNG DỒN. Trigger `+= NEW.quantity` sẽ sai
--   ngay lần đầu có ai UPDATE hoặc DELETE một dòng hoá đơn, và sai theo
--   kiểu không bao giờ tự sửa được.
ALTER TABLE sales_order_lines
  ADD COLUMN IF NOT EXISTS invoiced_qty numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN sales_order_lines.invoiced_qty IS
  'Tổng số lượng ĐÃ XUẤT của dòng này, cùng đơn vị với quantity. Do '
  'trigger trg_sync_invoiced_qty tính lại từ sales_invoice_lines của các '
  'hoá đơn posted — không cộng dồn.';

CREATE OR REPLACE FUNCTION public.sync_invoiced_qty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_line uuid;
BEGIN
  -- Dòng ngoài đơn (`order_line_id` NULL) không ảnh hưởng ai.
  FOR v_line IN
    SELECT x FROM (VALUES (OLD.order_line_id), (NEW.order_line_id)) AS t(x)
    WHERE x IS NOT NULL
  LOOP
    UPDATE sales_order_lines sol
    SET invoiced_qty = COALESCE((
      SELECT sum(sil.quantity)
      FROM sales_invoice_lines sil
      JOIN sales_invoices si ON si.id = sil.invoice_id
      WHERE sil.order_line_id = v_line AND si.status = 'posted'
    ), 0)
    WHERE sol.id = v_line;
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_invoiced_qty ON sales_invoice_lines;
CREATE TRIGGER trg_sync_invoiced_qty
  AFTER INSERT OR UPDATE OR DELETE ON sales_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.sync_invoiced_qty();

-- ⚠ HUỶ HOÁ ĐƠN KHÔNG XOÁ DÒNG NÀO — nó chỉ đổi `sales_invoices.status`.
--   Trigger trên gắn vào `sales_invoice_lines` nên sẽ KHÔNG chạy, và
--   `invoiced_qty` đứng yên ở số cũ: đơn mãi mãi hiện "đã xuất đủ" dù
--   hoá đơn đã huỷ. Cần trigger thứ hai gắn vào chính bảng hoá đơn.
CREATE OR REPLACE FUNCTION public.sync_invoiced_qty_on_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  UPDATE sales_order_lines sol
  SET invoiced_qty = COALESCE((
    SELECT sum(sil.quantity)
    FROM sales_invoice_lines sil
    JOIN sales_invoices si ON si.id = sil.invoice_id
    WHERE sil.order_line_id = sol.id AND si.status = 'posted'
  ), 0)
  WHERE sol.id IN (
    SELECT order_line_id FROM sales_invoice_lines
    WHERE invoice_id = NEW.id AND order_line_id IS NOT NULL
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_invoiced_qty_status ON sales_invoices;
CREATE TRIGGER trg_sync_invoiced_qty_status
  AFTER UPDATE OF status ON sales_invoices
  FOR EACH ROW EXECUTE FUNCTION public.sync_invoiced_qty_on_status();


-- =====================================================================
-- 4. sales_orders — hai trạng thái mới
-- =====================================================================
--
-- `partially_invoiced` Xuất một phần · `closed` Đóng (NPP chốt không
-- giao phần còn lại).
ALTER TABLE sales_orders DROP CONSTRAINT IF EXISTS chk_sales_orders_status_v2;
ALTER TABLE sales_orders
  ADD CONSTRAINT chk_sales_orders_status_v2
  CHECK (status IN (
    'draft', 'submitted', 'partially_invoiced', 'completed', 'closed', 'cancelled'
  ));

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES users(id);

COMMENT ON COLUMN sales_orders.closed_at IS
  'Mốc NPP chốt không giao phần còn lại. Khác completed_at: completed = '
  'đã xuất ĐỦ, closed = thôi không xuất nữa.';

-- ⚠ GIỮ CỘT `completed_by` VÀ `organizations.completed_edit_days`.
--   `completed_by` nay mang nghĩa "người ghi sổ hoá đơn cuối cùng".
--   `completed_edit_days` KHÔNG còn ai đọc (cơ chế sửa-sau-hoàn-thành đã
--   bỏ) nhưng giữ cột để không mất cấu hình tổ chức đã đặt.
COMMENT ON COLUMN organizations.completed_edit_days IS
  'NGƯNG DÙNG từ workflow v2b — cơ chế sửa đơn đã hoàn thành đã bỏ, thay '
  'bằng huỷ/lập lại hoá đơn. Giữ cột để không mất cấu hình cũ.';


-- =====================================================================
-- 5. Khoá ngoại sang hóa đơn
-- =====================================================================
--
-- ⚠ GIỮ NGUYÊN `order_id` Ở CẢ BỐN BẢNG, và RPC luôn ghi CẢ HAI. Dữ liệu
--   cũ chỉ có `order_id`; bỏ nó đi là mọi báo cáo lịch sử đứt. Đọc thì
--   ưu tiên `invoice_id`, rơi về `order_id` khi null.
ALTER TABLE receivables
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES sales_invoices(id);
ALTER TABLE cash_receipt_lines
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES sales_invoices(id);
ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES sales_invoices(id);
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS sales_invoice_id uuid REFERENCES sales_invoices(id);

CREATE INDEX IF NOT EXISTS idx_receivables_invoice        ON receivables(invoice_id);
CREATE INDEX IF NOT EXISTS idx_cash_receipt_lines_invoice ON cash_receipt_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_returns_invoice            ON returns(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoices_sales_invoice     ON invoices(sales_invoice_id);

-- ⚠ MỘT HOÁ ĐƠN CHỈ CÓ MỘT DÒNG CÔNG NỢ. Hai dòng cho cùng một hoá đơn
--   là khách bị đòi hai lần, và không phép cộng nào phát hiện ra.
--   Partial index vì công nợ đầu kỳ không gắn hoá đơn nào.
CREATE UNIQUE INDEX IF NOT EXISTS idx_receivables_invoice_unique
  ON receivables(invoice_id) WHERE invoice_id IS NOT NULL;

COMMENT ON COLUMN invoices.sales_invoice_id IS
  'Hóa đơn bán (sales_invoices) mà hoá đơn điện tử này phát hành cho. '
  'Bảng `invoices` là HĐĐT MISA — tên cũ, giữ nguyên.';


-- =====================================================================
-- 6. Trigger chuyển trạng thái đơn — viết lại cho sáu trạng thái
-- =====================================================================
--
-- ⚠ BỐN TRẠNG THÁI DO HOÁ ĐƠN ĐIỀU KHIỂN, KHÔNG PHẢI NGƯỜI DÙNG.
--   `partially_invoiced`, `completed`, `closed` chỉ vào/ra được khi có
--   cờ `npp.via_rpc` — tức là chỉ qua RPC của migration 125. Để client
--   tự đặt là mở đường cho một đơn hiện Hoàn thành mà chưa hoá đơn nào
--   trừ kho.
--
-- ⚠ ĐI LÙI LÀ HỢP LỆ, và chỉ có một đường: huỷ hoá đơn. `completed` hay
--   `closed` quay về `partially_invoiced` (còn hoá đơn khác) hoặc
--   `submitted` (hết hoá đơn). Không có đường nào khác — đó là thứ giữ
--   cho trạng thái đơn luôn kể đúng câu chuyện của các hoá đơn con.
CREATE OR REPLACE FUNCTION public.check_order_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ok boolean;
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  v_ok := CASE OLD.status
    WHEN 'draft'     THEN NEW.status IN ('submitted', 'cancelled')
    WHEN 'submitted' THEN NEW.status IN ('partially_invoiced', 'completed', 'cancelled', 'draft')
    WHEN 'partially_invoiced'
                     THEN NEW.status IN ('completed', 'closed', 'submitted')
    WHEN 'completed' THEN NEW.status IN ('partially_invoiced', 'submitted')
    WHEN 'closed'    THEN NEW.status IN ('partially_invoiced', 'submitted')
    ELSE false   -- 'cancelled' là điểm cuối
  END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Không thể chuyển đơn từ % sang %', OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;

  IF (OLD.status IN ('partially_invoiced', 'completed', 'closed')
      OR NEW.status IN ('partially_invoiced', 'completed', 'closed'))
     AND COALESCE(current_setting('npp.via_rpc', true), '') <> 'on' THEN
    RAISE EXCEPTION 'USE_RPC: dùng nút Xuất hàng / Huỷ hóa đơn / Đóng đơn'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status = 'submitted' AND NEW.submitted_at IS NULL THEN
    NEW.submitted_at := now();
  END IF;
  IF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN
    NEW.cancelled_at := now();
  END IF;
  IF NEW.status = 'closed' AND NEW.closed_at IS NULL THEN
    NEW.closed_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_order_status ON sales_orders;
CREATE TRIGGER trg_check_order_status
  BEFORE UPDATE OF status ON sales_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.check_order_status_transition();


-- =====================================================================
-- 7. Phân quyền hàng
-- =====================================================================
--
-- ⚠ HAI BẢNG HOÁ ĐƠN KHÔNG CÓ POLICY GHI NÀO CHO CLIENT. Mọi thay đổi
--   đi qua RPC `SECURITY DEFINER` của mig 125. Mở một policy INSERT ở
--   đây là mở luôn đường lập hoá đơn mà không trừ kho.
ALTER TABLE sales_invoices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_invoice_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_invoices_select ON sales_invoices;
CREATE POLICY sales_invoices_select ON sales_invoices
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND (
      public.user_role() IN ('owner', 'manager', 'accountant', 'warehouse')
      -- NVBH chỉ thấy hoá đơn của đơn mình phụ trách.
      OR sales_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM sales_orders so
        WHERE so.id = sales_invoices.order_id AND so.sales_user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS sales_invoice_lines_select ON sales_invoice_lines;
CREATE POLICY sales_invoice_lines_select ON sales_invoice_lines
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM sales_invoices si
    WHERE si.id = sales_invoice_lines.invoice_id
      AND si.org_id = public.user_org_id()
  ));

-- ⚠ DÒNG ĐƠN KHOÁ LẠI KHI ĐƠN ĐÃ CÓ HOÁ ĐƠN. Sửa dòng của một đơn đã
--   xuất là làm lệch `invoiced_qty` so với thứ đã thật sự rời kho — và
--   lệch im lặng, vì không lệnh nào báo. Muốn đổi thì huỷ hoá đơn trước.
CREATE OR REPLACE FUNCTION public.guard_order_lines_locked()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_status text; v_order uuid;
BEGIN
  IF COALESCE(current_setting('npp.via_rpc', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  v_order := COALESCE(NEW.order_id, OLD.order_id);
  SELECT status INTO v_status FROM sales_orders WHERE id = v_order;
  IF v_status IN ('partially_invoiced', 'completed', 'closed') THEN
    RAISE EXCEPTION
      'ORDER_LOCKED: đơn đã xuất hàng, không sửa dòng được. Huỷ hóa đơn trước, hoặc lập đơn trả.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ⚠ TRIGGER DỰNG Ở CUỐI FILE, KHÔNG PHẢI Ở ĐÂY. Backfill ở mục 11 chèn
--   dòng hóa đơn, việc đó làm `trg_sync_invoiced_qty` chạy `UPDATE
--   sales_order_lines` — và chốt này chặn đúng lệnh ấy, vì lúc đó đơn đã
--   mang trạng thái 'completed'. Migration tự vấp chốt chặn của chính
--   mình:
--
--     ERROR: ORDER_LOCKED: đơn đã xuất hàng, không sửa dòng được.
--
--   Dựng chốt sau khi dữ liệu đã vào chỗ. Xem mục 13.


-- =====================================================================
-- 8. Trần số lượng trả — đổi mốc so từ ĐƠN sang HOÁ ĐƠN
-- =====================================================================
--
-- ⚠ TRẢ THEO THỨ ĐÃ XUẤT, KHÔNG THEO THỨ ĐÃ ĐẶT. Đơn đặt 100 mà mới
--   xuất 40 thì trần trả là 40. So với dòng đơn như bản v2 là cho phép
--   khách trả 100 — nhập kho 60 món chưa từng rời kho.
--
-- ⚠ Phiếu trả không gắn hoá đơn (trả độc lập, hoặc gắn đơn kiểu cũ) thì
--   BỎ QUA như trước: không có mốc để so.
CREATE OR REPLACE FUNCTION public.enforce_return_line_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice  uuid;
  v_conv     numeric;
  v_qty_base numeric;
  v_sold     numeric;
  v_returned numeric;
  v_name     text;
BEGIN
  IF NEW.is_exchange THEN
    RETURN NEW;
  END IF;

  SELECT r.invoice_id INTO v_invoice FROM returns r WHERE r.id = NEW.return_id;
  IF v_invoice IS NULL THEN
    RETURN NEW;
  END IF;

  -- ⚠ `return_lines` không có cột hệ số; phải tra `product_units`, và
  --   cột ở bảng đó tên `conversion`, KHÔNG phải `conversion_factor`.
  v_conv := COALESCE((
    SELECT pu.conversion FROM product_units pu
     WHERE pu.product_id = NEW.product_id AND pu.unit_name = NEW.unit_name), 1);
  v_qty_base := COALESCE(NEW.quantity, 0) * v_conv;

  SELECT COALESCE(sum(sil.quantity * COALESCE(sil.conversion_factor, 1)), 0)
    INTO v_sold
  FROM sales_invoice_lines sil
  JOIN sales_invoices si ON si.id = sil.invoice_id
  WHERE si.id = v_invoice
    AND si.status = 'posted'
    AND sil.is_exchange = false
    AND sil.product_id = NEW.product_id;

  SELECT COALESCE(sum(rl.quantity * COALESCE((
            SELECT pu.conversion FROM product_units pu
             WHERE pu.product_id = rl.product_id AND pu.unit_name = rl.unit_name), 1)), 0)
    INTO v_returned
  FROM return_lines rl
  JOIN returns r2 ON r2.id = rl.return_id
  WHERE r2.invoice_id = v_invoice
    AND r2.status = 'completed'
    AND rl.is_exchange = false
    AND rl.product_id = NEW.product_id
    AND rl.id <> NEW.id;

  IF v_qty_base + v_returned > v_sold THEN
    SELECT name INTO v_name FROM products WHERE id = NEW.product_id;
    RAISE EXCEPTION
      'RETURN_QTY_EXCEEDS: "%" — hóa đơn xuất %, đã trả %, dòng này thêm % là vượt',
      COALESCE(v_name, NEW.product_id::text), v_sold, v_returned, v_qty_base
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;


-- =====================================================================
-- 9. Doanh thu bám hóa đơn
-- =====================================================================
--
-- ⚠ `is_revenue_status` GIỮ NGUYÊN, không xoá: nhiều hàm lương/báo cáo
--   còn gọi nó, và P3 mới chuyển từng cái sang bản hoá đơn. Xoá ở đây là
--   hàng loạt hàm vỡ giữa hai migration.
CREATE OR REPLACE FUNCTION public.is_revenue_invoice_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$ SELECT p_status = 'posted' $$;

COMMENT ON FUNCTION public.is_revenue_invoice_status(text) IS
  'Doanh thu v2b đếm hóa đơn bán đã ghi sổ. Đơn đặt hàng KHÔNG còn là '
  'nguồn doanh thu — xem is_revenue_status (ngưng dùng dần ở P3).';


-- =====================================================================
-- 10. Nhật ký và thông báo
-- =====================================================================
--
-- ⚠ GIỮ `edit_after_complete` / `cancel_after_complete` TRONG CHECK dù
--   không ai ghi nữa: dữ liệu cũ đã có hai giá trị đó, siết ràng buộc là
--   ALTER TABLE hỏng ngay trên dữ liệu đang có.
ALTER TABLE order_activity_log DROP CONSTRAINT IF EXISTS chk_order_activity_log_action;
ALTER TABLE order_activity_log
  ADD CONSTRAINT chk_order_activity_log_action
  CHECK (action IN (
    'add_line', 'edit_line', 'remove_line',
    'edit_after_complete', 'cancel_after_complete',   -- lịch sử, không ai ghi nữa
    'invoice_posted', 'invoice_cancelled', 'order_closed'
  ));

-- ⚠ GIỮ `order_edited` TRONG CHECK vì lý do y hệt: thông báo cũ đã gửi
--   rồi, siết ràng buộc là hỏng trên dữ liệu đang có. Chỉ không ai gửi
--   loại đó nữa.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'order_pending_approval',
    'order_approved',
    'order_cancelled',
    'order_completed',
    'order_edited',           -- lịch sử, không ai gửi nữa
    'invoice_cancelled',
    'return_completed',
    'payment_received',
    'receivable_overdue',
    'visit_logged',
    'customer_photo_missing',
    'info'
  ));


-- =====================================================================
-- 11. Backfill — mỗi đơn đã hoàn thành thành một hóa đơn
-- =====================================================================
--
-- ⚠ KHÔNG ĐOÁN. Đơn `completed` mà KHÔNG có phiếu xuất nào đã ghi sổ thì
--   vẫn tạo hoá đơn (để công nợ và hoá đơn điện tử có chỗ bám) nhưng
--   `stock_entry_id` để TRỐNG và liệt kê ra `RAISE NOTICE`. Đó là những
--   đơn có từ trước mig 107 — tồn kho chưa bao giờ bị trừ cho chúng, và
--   gán bừa một phiếu xuất vào là dựng một chứng từ không có thật.
DO $$
DECLARE
  o          record;
  v_inv      uuid;
  v_entry    uuid;
  v_n_entry  int;
  v_code     text;
  v_seq      int := 0;
  v_inv_cnt  int := 0;
  v_no_entry int := 0;
  v_rec      int := 0;
  v_crl      int := 0;
  v_ret      int := 0;
  v_eiv      int := 0;
BEGIN
  FOR o IN
    SELECT so.*, row_number() OVER (PARTITION BY so.org_id ORDER BY so.order_date, so.id) AS rn
    FROM sales_orders so
    WHERE so.status = 'completed'
       OR (so.status = 'cancelled' AND so.completed_at IS NOT NULL)
    ORDER BY so.org_id, so.order_date, so.id
  LOOP
    -- ⚠ HAI CÂU, KHÔNG GỘP BẰNG `min(se.id)`. Postgres KHÔNG có `min`
    --   cho kiểu uuid — gộp là lỗi 42883 ngay câu lệnh đầu tiên của vòng
    --   lặp, và cả migration rollback. Kể cả nếu có thì nó cũng sai
    --   nghĩa: thứ tự uuid không phải thứ tự thời gian, nên "phiếu đầu
    --   tiên" hoá ra là phiếu có uuid nhỏ nhất — một phiếu bất kỳ.
    --
    -- ⚠ "ĐẦU TIÊN" = SỚM NHẤT THEO `posted_at`. Đơn được sửa ở v2 có thể
    --   có vài phiếu xuất; phiếu gắn vào hóa đơn phải là phiếu mở đầu,
    --   không phải phiếu vá về sau. `se.id` chỉ để phá thế hoà khi hai
    --   phiếu cùng một mốc.
    SELECT count(*) INTO v_n_entry
    FROM stock_entries se
    WHERE se.type = 'export' AND se.status = 'posted'
      AND se.ref_order_ids @> jsonb_build_array(o.id::text);

    SELECT se.id INTO v_entry
    FROM stock_entries se
    WHERE se.type = 'export' AND se.status = 'posted'
      AND se.ref_order_ids @> jsonb_build_array(o.id::text)
    ORDER BY se.posted_at NULLS LAST, se.id
    LIMIT 1;

    v_seq := v_seq + 1;
    v_code := 'HD-' || to_char(COALESCE(o.order_date, CURRENT_DATE), 'YYMMDD')
              || '-' || lpad(v_seq::text, 4, '0');

    INSERT INTO sales_invoices (
      org_id, invoice_code, order_id, customer_id, sales_user_id,
      invoice_date, status, subtotal, vat, total, payment_terms, due_date,
      stock_entry_id, notes, posted_at, posted_by, cancelled_at, cancel_reason
    ) VALUES (
      o.org_id, v_code, o.id, o.customer_id, o.sales_user_id,
      COALESCE(o.order_date, CURRENT_DATE),
      CASE WHEN o.status = 'cancelled' THEN 'cancelled' ELSE 'posted' END,
      COALESCE(o.subtotal, 0), COALESCE(o.vat, 0), COALESCE(o.total, 0),
      o.payment_terms, NULL,
      v_entry,
      CASE
        WHEN v_n_entry = 0 THEN 'Backfill v2b: đơn không có phiếu xuất đã ghi sổ — tồn kho chưa từng bị trừ.'
        WHEN v_n_entry > 1 THEN 'Backfill v2b: đơn có ' || v_n_entry || ' phiếu xuất (do sửa ở v2); stock_entry_id lấy phiếu đầu.'
        ELSE 'Backfill v2b từ workflow v2.'
      END,
      COALESCE(o.completed_at, now()), o.completed_by,
      CASE WHEN o.status = 'cancelled' THEN o.cancelled_at ELSE NULL END,
      CASE WHEN o.status = 'cancelled' THEN 'Backfill v2b: đơn đã huỷ sau khi xuất' ELSE NULL END
    )
    RETURNING id INTO v_inv;
    v_inv_cnt := v_inv_cnt + 1;

    IF v_n_entry = 0 THEN
      v_no_entry := v_no_entry + 1;
      RAISE NOTICE '124 ⚠ đơn % (%) KHÔNG có phiếu xuất đã ghi sổ — hóa đơn % tạo ra không có stock_entry_id', o.order_code, o.order_date, v_code;
    END IF;

    INSERT INTO sales_invoice_lines (
      invoice_id, order_line_id, product_id, unit_name, conversion_factor,
      quantity, unit_price, line_discount, line_total, vat_rate, sort_order, note
    )
    SELECT v_inv, sol.id, sol.product_id, sol.unit_name,
           COALESCE(sol.conversion_factor, 1),
           sol.quantity, sol.unit_price, COALESCE(sol.line_discount, 0),
           sol.line_total, COALESCE(p.vat_rate, 0),
           row_number() OVER (ORDER BY sol.id), sol.note
    FROM sales_order_lines sol
    LEFT JOIN products p ON p.id = sol.product_id
    WHERE sol.order_id = o.id;

    -- Gắn các chứng từ con của đơn sang hóa đơn vừa tạo.
    UPDATE receivables SET invoice_id = v_inv
    WHERE order_id = o.id AND invoice_id IS NULL;
    GET DIAGNOSTICS v_n_entry = ROW_COUNT; v_rec := v_rec + v_n_entry;

    UPDATE cash_receipt_lines SET invoice_id = v_inv
    WHERE order_id = o.id AND invoice_id IS NULL;
    GET DIAGNOSTICS v_n_entry = ROW_COUNT; v_crl := v_crl + v_n_entry;

    UPDATE returns SET invoice_id = v_inv
    WHERE order_id = o.id AND invoice_id IS NULL AND status <> 'draft';
    GET DIAGNOSTICS v_n_entry = ROW_COUNT; v_ret := v_ret + v_n_entry;

    UPDATE invoices SET sales_invoice_id = v_inv
    WHERE order_id = o.id AND sales_invoice_id IS NULL;
    GET DIAGNOSTICS v_n_entry = ROW_COUNT; v_eiv := v_eiv + v_n_entry;
  END LOOP;

  RAISE NOTICE '--- 124 backfill: % hóa đơn bán được tạo (% không có phiếu xuất) ---', v_inv_cnt, v_no_entry;
  RAISE NOTICE '--- 124 backfill: gắn % công nợ · % dòng phiếu thu · % phiếu trả · % hoá đơn điện tử ---', v_rec, v_crl, v_ret, v_eiv;
END $$;

-- `invoiced_qty` của đơn đã backfill: trigger mục 3 đã chạy theo từng
-- dòng chèn ở trên, nhưng tính lại một lượt cho chắc — dòng đơn không có
-- hoá đơn nào phải về 0, không để rác từ lần chạy trước.
UPDATE sales_order_lines sol
SET invoiced_qty = COALESCE((
  SELECT sum(sil.quantity)
  FROM sales_invoice_lines sil
  JOIN sales_invoices si ON si.id = sil.invoice_id
  WHERE sil.order_line_id = sol.id AND si.status = 'posted'
), 0);


-- =====================================================================
-- 12. Gỡ cơ chế "sửa đơn đã hoàn thành"
-- =====================================================================
--
-- ⚠ `_wf2_assert_order_unlocked` PACK KHÔNG NHẮC, NHƯNG PHẢI ĐI CÙNG.
--   Nó chỉ phục vụ bốn khoá của `edit_completed_order`, và là chỗ DUY
--   NHẤT còn đọc `organizations.completed_edit_days`. Để lại là mã chết
--   đọc một cột đã ngưng dùng — lần sau có người đọc nó rồi tưởng cơ chế
--   còn sống.
--
-- ⚠ `_wf2_recompute_receivable(uuid)` bị thay bằng bản theo hóa đơn ở
--   mig 125. `complete_return` / `cancel_return` còn gọi tên cũ — PL/pgSQL
--   chỉ tra tên lúc CHẠY nên DDL này không vỡ, nhưng hai RPC đó sẽ lỗi
--   cho tới khi 125 chạy xong. Đó là lý do hai file phải đi cùng nhau.
DROP FUNCTION IF EXISTS public.edit_completed_order(uuid, jsonb, numeric, numeric, numeric, text);
DROP FUNCTION IF EXISTS public.complete_order(uuid);
DROP FUNCTION IF EXISTS public.cancel_order(uuid, text);
DROP FUNCTION IF EXISTS public._wf2_assert_order_unlocked(uuid, date, boolean);
DROP FUNCTION IF EXISTS public._wf2_recompute_receivable(uuid);

-- =====================================================================
-- 13. Khoá dòng đơn — DỰNG SAU CÙNG
-- =====================================================================
--
-- ⚠ ĐÂY LÀ NHỊP CUỐI, VÀ THỨ TỰ LÀ CẢ VẤN ĐỀ. Hàm đã định nghĩa ở mục 7;
--   chỉ còn gắn trigger. Gắn sớm hơn thì backfill ở mục 11 không chạy
--   nổi: nó chèn dòng hóa đơn → `trg_sync_invoiced_qty` chạy `UPDATE
--   sales_order_lines` → chốt này chặn, vì đơn lúc đó đã 'completed'.
--
--   Cùng một bài học với mục 4 của migration 119: chốt chặn dựng SAU khi
--   ghi xong dữ liệu, không phải trước.
DROP TRIGGER IF EXISTS trg_guard_order_lines_locked ON sales_order_lines;
CREATE TRIGGER trg_guard_order_lines_locked
  BEFORE INSERT OR UPDATE OR DELETE ON sales_order_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_lines_locked();


NOTIFY pgrst, 'reload schema';

DO $$
DECLARE v_so int; v_inv int; v_part int;
BEGIN
  SELECT count(*) INTO v_so  FROM sales_orders WHERE status = 'completed';
  SELECT count(*) INTO v_inv FROM sales_invoices WHERE status = 'posted';
  SELECT count(*) INTO v_part FROM sales_orders WHERE status = 'partially_invoiced';
  RAISE NOTICE '--- 124: % đơn Hoàn thành · % hóa đơn đã xuất · % đơn xuất một phần ---', v_so, v_inv, v_part;
  IF v_so <> v_inv THEN
    RAISE NOTICE '--- 124 ⚠ hai con số trên LỆCH NHAU. Đúng ra mỗi đơn hoàn thành có đúng một hóa đơn; kiểm lại trước khi chạy 125. ---';
  END IF;
END $$;


-- ####################################################################
-- # 125_wf2b_invoice_rpcs.sql
-- ####################################################################

-- ---------------------------------------------------------------------
-- 125 — Workflow v2b: các RPC của hóa đơn bán
--
-- Phần CẤU TRÚC nằm ở migration 124. File này dựng bộ thay thế cho
-- `complete_order` / `edit_completed_order` / `cancel_order` mà 124 đã gỡ.
-- ---------------------------------------------------------------------
--
-- ⚠ 124 VÀ 125 PHẢI CHẠY CÙNG NHAU. Giữa hai file, ứng dụng không có
--   đường nào để xuất hàng và `complete_return` / `cancel_return` sẽ lỗi
--   vì hàm chúng gọi đã bị gỡ. Đừng dừng lại ở 124.
--
-- ---------------------------------------------------------------------
-- BẢY VIỆC, MỖI VIỆC MỘT HÀM
-- ---------------------------------------------------------------------
--
--   get_invoiceable_lines(order)        — còn gì chưa xuất, và kho còn bao nhiêu
--   post_invoice(jsonb)                 — lập + ghi sổ hóa đơn: trừ kho, sinh nợ
--   cancel_invoice(invoice, reason)     — huỷ: hoàn kho về đúng lô, xoá nợ
--   reissue_invoice(invoice, jsonb)     — sửa = huỷ + lập lại, một giao dịch
--   close_order(order, reason)          — thôi không giao phần còn lại
--   cancel_order(order, reason)         — viết lại: chỉ còn đơn CHƯA xuất
--   _wf2b_recompute_receivable(invoice) — công nợ bám hóa đơn, không bám đơn
--
-- ---------------------------------------------------------------------
-- ⚠ VÌ SAO KHÔNG CÒN "SỬA": mọi thay đổi trên hàng đã rời kho đi qua
--   HUỶ rồi LẬP LẠI. `cancel_invoice` hoàn hàng về ĐÚNG các lô đã lấy
--   (dấu vết `stock_line_consumptions`, lô lấy sau trả trước), nên sau
--   một vòng huỷ-lập-lại tồn kho theo lô về đúng chỗ cũ. Cách tính delta
--   của v2 không làm được điều đó: nó chỉ biết chênh lệch tổng số.
-- ---------------------------------------------------------------------


-- =====================================================================
-- 0. Mở đúng những ô quyền các RPC dưới đây cần
-- =====================================================================
-- Y hệt lý do ở mig 120 mục 0c: `user_has_permission` trả FALSE khi
-- `role_permissions` chưa có dòng, không có ma trận mặc định phía CSDL.
-- Không seed thì sau khi chạy 125 mọi vai trò TRỪ chủ sở hữu đều bị từ
-- chối, trong khi giao diện vẫn hiện nút.
INSERT INTO role_permissions (org_id, role, module, action, allowed)
SELECT o.id, v.role, v.module, v.action, true
FROM organizations o
CROSS JOIN (VALUES
  ('manager', 'orders', 'approve'),
  ('manager', 'orders', 'update'),
  ('sales',   'orders', 'update')
) AS v(role, module, action)
ON CONFLICT (org_id, role, module, action) DO NOTHING;


-- =====================================================================
-- 1. Helper nội bộ
-- =====================================================================

-- 1.1 NETxx → số ngày. Mọi thứ khác (COD, rỗng, null) = 0 ngày.
--
-- ⚠ BẢN SAO CỦA `paymentTermsToDays` (src/lib/returns.ts). Hai nguồn sự
--   thật cho cùng một phép tính là chỗ lệch kinh điển, nên
--   `tests/wf2b-rpcs.test.ts` có một chốt so hai bản trên cùng bộ số.
--   Sửa một bên thì sửa cả hai.
CREATE OR REPLACE FUNCTION public._wf2b_payment_terms_days(p_terms text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    (substring(upper(COALESCE(p_terms, '')) FROM 'NET([0-9]+)'))::int, 0);
$$;

COMMENT ON FUNCTION public._wf2b_payment_terms_days(text) IS
  'NETxx → số ngày nợ. Bản SQL của paymentTermsToDays trong '
  'src/lib/returns.ts — sửa một bên phải sửa cả hai.';


-- 1.2 Công nợ của MỘT HÓA ĐƠN.
--
-- ⚠ ĐỔI MỐC TỪ ĐƠN SANG HÓA ĐƠN. Bản v2 (`_wf2_recompute_receivable`)
--   gắn công nợ vào `sales_orders`. Một đơn xuất làm hai đợt thì bản đó
--   chỉ có một dòng nợ cho cả hai — khách nhận hàng đợt một đã nợ tiền
--   của cả đợt hai chưa giao. Nay mỗi hóa đơn một dòng nợ, và index
--   `idx_receivables_invoice_unique` (mig 124) giữ cho đúng một.
--
-- ⚠ KHÔNG đụng tới `paid`. Số đã thu là sự thật do phiếu thu ghi; tính
--   lại công nợ mà đè lên nó là xoá tiền khách đã trả.
--
-- ⚠ Q11 — `paid > amount` LÀ HỢP LỆ (chủ nhà chọn phương án (a) ở v2).
--   Khách trả hàng sau khi đã thanh toán đủ thì phần dư là SỐ DƯ CÓ, và
--   nhánh `v_paid >= v_net` đặt status 'paid' = "không còn gì để đòi".
--   Không thêm giá trị mới vào `receivables.status`: ràng buộc CHECK của
--   nó là ẩn danh từ mig 001 và mọi bộ lọc đều dùng `status <> 'paid'`.
CREATE OR REPLACE FUNCTION public._wf2b_recompute_receivable(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v         record;
  v_credits numeric;
  v_net     numeric;
  v_id      uuid;
  v_paid    numeric;
BEGIN
  SELECT si.id, si.org_id, si.order_id, si.customer_id, si.sales_user_id,
         si.total, si.payment_terms, si.invoice_date, si.status
    INTO v
  FROM sales_invoices si WHERE si.id = p_invoice_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(sum(COALESCE(r.credit_note_amount, 0)), 0) INTO v_credits
  FROM returns r
  WHERE r.invoice_id = p_invoice_id AND r.status = 'completed';

  v_net := GREATEST(0, COALESCE(v.total, 0) - v_credits);

  SELECT rc.id, COALESCE(rc.paid, 0) INTO v_id, v_paid
  FROM receivables rc WHERE rc.invoice_id = p_invoice_id LIMIT 1;

  -- ⚠ Chỉ hóa đơn ĐÃ GHI SỔ mới sinh công nợ mới. Hóa đơn đã huỷ thì
  --   dòng nợ của nó đã bị `cancel_invoice` xoá; dựng lại ở đây là đòi
  --   tiền một chứng từ không còn hiệu lực.
  IF v_id IS NULL AND v.status <> 'posted' THEN
    RETURN NULL;
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE receivables
    SET amount = v_net,
        status = CASE
                   WHEN v_paid >= v_net THEN 'paid'
                   WHEN v_paid > 0      THEN 'partial'
                   ELSE 'open'
                 END
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  -- ⚠ GHI CẢ `order_id` LẪN `invoice_id`. Dữ liệu cũ chỉ có `order_id`
  --   và mọi báo cáo lịch sử đọc theo cột đó; bỏ nó là đứt một nửa sổ.
  INSERT INTO receivables (
    org_id, order_id, invoice_id, customer_id, sales_user_id,
    amount, paid, due_date, status
  ) VALUES (
    v.org_id, v.order_id, v.id, v.customer_id, v.sales_user_id,
    v_net, 0,
    COALESCE(v.invoice_date, current_date)
      + public._wf2b_payment_terms_days(v.payment_terms),
    'open'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


-- 1.3 CẦU TẠM cho `complete_return` / `cancel_return`.
--
-- ⚠ VÌ SAO CÓ HÀM NÀY. Hai RPC đơn trả ở mig 120 gọi
--   `_wf2_recompute_receivable(r.order_id)` — chúng còn nói bằng ngôn ngữ
--   của ĐƠN. 124 đã gỡ hàm đó, nên không dựng lại là hai RPC kia lỗi
--   ngay. Dựng lại nguyên bản cũ thì công nợ lại bám đơn, phá đúng thứ
--   v2b vừa tách ra. Nên bản này là CẦU: nhận `order_id`, tính lại công
--   nợ cho từng hóa đơn đã ghi sổ của đơn đó. P6 nối thẳng hai RPC đơn
--   trả vào `_wf2b_recompute_receivable` rồi mới gỡ cầu.
--
-- ⚠ PHIẾU TRẢ CHƯA GẮN HÓA ĐƠN THÌ NHẬN NUÔI, KHÔNG BỎ QUA. Tiền giảm
--   trừ của một phiếu trả `invoice_id` rỗng không thuộc về hóa đơn nào,
--   nên `_wf2b_recompute_receivable` không thấy nó: khách trả hàng mà nợ
--   không giảm, và không dòng nào báo. Đơn có ĐÚNG MỘT hóa đơn đã ghi sổ
--   thì gắn vào đó — không phải đoán. Có từ hai trở lên thì DỪNG và bảo
--   người dùng chọn: đoán ở đây là ghi giảm nợ nhầm hóa đơn.
CREATE OR REPLACE FUNCTION public._wf2_recompute_receivable(p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inv    uuid;
  v_n      int;
  v_first  uuid;
  v_rec    uuid;
  v_orphan int;
BEGIN
  SELECT count(*) INTO v_n
  FROM sales_invoices WHERE order_id = p_order_id AND status = 'posted';

  SELECT count(*) INTO v_orphan
  FROM returns
  WHERE order_id = p_order_id AND invoice_id IS NULL AND status <> 'draft';

  IF v_orphan > 0 THEN
    IF v_n = 1 THEN
      SELECT id INTO v_inv
      FROM sales_invoices WHERE order_id = p_order_id AND status = 'posted';
      UPDATE returns SET invoice_id = v_inv
      WHERE order_id = p_order_id AND invoice_id IS NULL AND status <> 'draft';
    ELSIF v_n > 1 THEN
      RAISE EXCEPTION
        'RETURN_NEEDS_INVOICE: đơn có % hóa đơn đã xuất — phiếu trả phải chỉ rõ trả theo hóa đơn nào',
        v_n USING ERRCODE = 'P0001';
    END IF;
  END IF;

  FOR v_inv IN
    SELECT id FROM sales_invoices
    WHERE order_id = p_order_id AND status = 'posted'
    ORDER BY invoice_date, created_at
  LOOP
    v_rec := public._wf2b_recompute_receivable(v_inv);
    v_first := COALESCE(v_first, v_rec);
  END LOOP;

  RETURN v_first;
END;
$$;

COMMENT ON FUNCTION public._wf2_recompute_receivable(uuid) IS
  'CẦU TẠM: complete_return/cancel_return còn gọi theo order_id. Gỡ ở P6 '
  'khi hai RPC đó nối thẳng vào _wf2b_recompute_receivable.';


-- 1.4 Trạng thái đơn suy ra từ các hóa đơn con của nó.
--
-- ⚠ KHÔNG AI ĐẶT TRẠNG THÁI ĐƠN BẰNG TAY NỮA. Đơn kể lại câu chuyện của
--   các hóa đơn: chưa hóa đơn nào → 'submitted'; xuất đủ mọi dòng →
--   'completed'; giữa hai thứ đó → 'partially_invoiced'. Đặt tay là mở
--   đường cho một đơn hiện Hoàn thành mà chưa hóa đơn nào trừ kho.
--
-- ⚠ ĐƠN ĐANG 'closed' THÌ GIỮ NGUYÊN, trừ khi hóa đơn cuối bị huỷ. NPP
--   đã chốt thôi không giao phần còn lại; tự kéo nó về
--   'partially_invoiced' là xoá một quyết định của con người.
--
-- ⚠ SO SÁNH `>=`, KHÔNG PHẢI `=`. PATCH 1 cho NPP xuất nhiều hơn số đặt.
--   Dùng `=` thì đơn xuất dư mãi mãi kẹt ở 'partially_invoiced', và
--   không nút nào đưa nó ra được.
CREATE OR REPLACE FUNCTION public._wf2b_sync_order_status(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cur  text;
  v_inv  int;
  v_open int;
  v_new  text;
BEGIN
  SELECT status INTO v_cur FROM sales_orders WHERE id = p_order_id;
  IF v_cur IS NULL OR v_cur IN ('draft', 'cancelled') THEN
    RETURN v_cur;
  END IF;

  SELECT count(*) INTO v_inv
  FROM sales_invoices WHERE order_id = p_order_id AND status = 'posted';

  SELECT count(*) INTO v_open
  FROM sales_order_lines
  WHERE order_id = p_order_id AND COALESCE(invoiced_qty, 0) < quantity;

  IF v_inv = 0 THEN
    v_new := 'submitted';
  ELSIF v_open = 0 THEN
    v_new := 'completed';
  ELSIF v_cur = 'closed' THEN
    v_new := 'closed';
  ELSE
    v_new := 'partially_invoiced';
  END IF;

  -- ⚠ RỜI KHỎI 'closed' THÌ XOÁ DẤU ĐÓNG ĐƠN. Đơn đã đóng mà hóa đơn bị
  --   huỷ thì nó quay về đang-chạy; để `closed_at` lại là đơn hiện đang
  --   mở nhưng mang ngày đóng, và mọi báo cáo đếm theo cột đó đều sai.
  --   (Nhánh này không bao giờ ĐẶT 'closed': hàm chỉ suy ra trạng thái
  --   từ hóa đơn, còn đóng đơn là quyết định của con người — close_order.)
  IF v_new IS DISTINCT FROM v_cur THEN
    PERFORM set_config('npp.via_rpc', 'on', true);
    UPDATE sales_orders
    SET status = v_new,
        completed_at = CASE WHEN v_new = 'completed' THEN now() ELSE NULL END,
        completed_by = CASE WHEN v_new = 'completed' THEN auth.uid() ELSE NULL END,
        closed_at    = NULL,
        closed_by    = NULL
    WHERE id = p_order_id;
  END IF;

  RETURN v_new;
END;
$$;


-- 1.5 Mã hóa đơn: HD-YYMMDD-NNNN, đếm trong phạm vi tổ chức + ngày.
--
-- ⚠ KHOÁ TRƯỚC KHI ĐẾM. Hai người bấm Xuất hàng cùng lúc thì cả hai đọc
--   ra cùng một số, một giao dịch vỡ vì unique index — không sai sổ,
--   nhưng người dùng thứ hai thấy lỗi lạ hoắc. Khoá theo (tổ chức, ngày)
--   cho họ xếp hàng, và khoá tự nhả khi giao dịch kết thúc.
CREATE OR REPLACE FUNCTION public._wf2b_next_invoice_code(p_org uuid, p_date date)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_org::text || p_date::text));
  SELECT count(*) + 1 INTO v_n
  FROM sales_invoices
  WHERE org_id = p_org AND invoice_date = p_date;
  RETURN 'HD-' || to_char(p_date, 'YYMMDD') || '-' || lpad(v_n::text, 4, '0');
END;
$$;


-- =====================================================================
-- 2. get_invoiceable_lines — còn gì chưa xuất
-- =====================================================================
--
-- Nguồn của dialog Xuất hàng (P4). Trả về phần CÒN LẠI của từng dòng đơn,
-- cộng hàng đem đổi của phiếu trả kèm đơn.
--
-- ⚠ `available_base` LÀ THÔNG TIN, KHÔNG PHẢI VẤN ĐỀ. Nó để màn hình
--   nhuộm vàng dòng thiếu hàng, không để chặn: tổ chức cho bán âm thì
--   `post_stock_export` vẫn xuất và báo `short_qty`. Chặn ở đây là đặt
--   ra một luật thứ hai mâu thuẫn với cấu hình tổ chức.
--
-- ⚠ DÒNG ĐÃ XUẤT ĐỦ KHÔNG BỊ LOẠI KHỎI KẾT QUẢ, chỉ mang
--   `remaining_qty = 0`. Loại đi thì màn Xuất hàng đợt hai trông như đơn
--   bị mất dòng, và không cách nào biết dòng đó đã xuất rồi hay chưa
--   từng có.
DROP FUNCTION IF EXISTS public.get_invoiceable_lines(uuid);
CREATE FUNCTION public.get_invoiceable_lines(p_order_id uuid)
RETURNS TABLE (
  order_line_id     uuid,
  return_line_id    uuid,
  product_id        uuid,
  product_name      text,
  sku               text,
  unit_name         text,
  conversion_factor numeric,
  ordered_qty       numeric,
  invoiced_qty      numeric,
  remaining_qty     numeric,
  unit_price        numeric,
  list_price        numeric,
  line_discount     numeric,
  vat_rate          numeric,
  available_base    numeric,
  is_exchange       boolean,
  note              text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM sales_orders WHERE id = p_order_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    sol.id, NULL::uuid, sol.product_id, p.name, p.sku, sol.unit_name,
    COALESCE(sol.conversion_factor, 1),
    sol.quantity, COALESCE(sol.invoiced_qty, 0),
    GREATEST(0, sol.quantity - COALESCE(sol.invoiced_qty, 0)),
    sol.unit_price, COALESCE(p.sell_price, 0), COALESCE(sol.line_discount, 0),
    COALESCE(p.vat_rate, 0),
    COALESCE((SELECT sum(b.qty_on_hand) FROM batches b
               WHERE b.product_id = sol.product_id
                 AND b.org_id = v_org
                 AND b.warehouse_zone = 'sale'), 0)::numeric,
    false, sol.note
  FROM sales_order_lines sol
  LEFT JOIN products p ON p.id = sol.product_id
  WHERE sol.order_id = p_order_id

  UNION ALL

  -- Hàng đem đổi của phiếu trả kèm đơn: nó cũng rời kho trong chuyến này,
  -- nhưng không thuộc dòng đơn nào nên `order_line_id` để rỗng.
  SELECT
    NULL::uuid, rl.id, rl.product_id, p2.name, p2.sku, rl.unit_name,
    COALESCE((SELECT pu.conversion FROM product_units pu
               WHERE pu.product_id = rl.product_id
                 AND pu.unit_name = rl.unit_name), 1),
    rl.quantity, 0::numeric, rl.quantity,
    0::numeric, COALESCE(p2.sell_price, 0), 0::numeric,
    COALESCE(p2.vat_rate, 0),
    COALESCE((SELECT sum(b.qty_on_hand) FROM batches b
               WHERE b.product_id = rl.product_id
                 AND b.org_id = v_org
                 AND b.warehouse_zone = 'sale'), 0)::numeric,
    true, '[Exchange]'::text
  FROM return_lines rl
  JOIN returns r ON r.id = rl.return_id
  LEFT JOIN products p2 ON p2.id = rl.product_id
  WHERE r.order_id = p_order_id
    AND r.status IN ('draft', 'submitted')
    AND rl.is_exchange = true;
END;
$$;


-- =====================================================================
-- 3. post_invoice — lập và ghi sổ hóa đơn
-- =====================================================================
--
-- p: { order_id, invoice_date?, payment_terms?, notes?,
--      lines: [ { order_line_id?, return_line_id?, product_id, unit_name,
--                 conversion_factor, quantity, unit_price,
--                 line_discount?, is_exchange?, note? } ] }
--
-- ⚠ MỘT GIAO DỊCH: phiếu xuất + trừ kho FIFO + hóa đơn + dòng hóa đơn +
--   công nợ + trạng thái đơn. Hỏng bất cứ đâu thì không còn dấu vết nào.
--
-- ⚠ LÀM TRÒN Ở TỔNG, KHÔNG Ở DÒNG. `cartTotals` (src/lib/sell/cart.ts)
--   cộng hết rồi mới `Math.round`, và `grandTotal` làm tròn tổng
--   `subtotal + vat` CHƯA làm tròn — không phải `round(subtotal) +
--   round(vat)`. Port sai chỗ làm tròn là lệch vài đồng mỗi hóa đơn, và
--   lệch theo kiểu không ai lần ra được.
--
-- ⚠ VAT TÍNH TRÊN GIÁ ĐANG ÁP, không trên giá bảng — tính trên giá bảng
--   là bắt khách trả thuế cho phần đã được giảm.
--
-- ⚠ THUẾ SUẤT SNAPSHOT TẠI ĐÂY (`products.vat_rate` lúc ghi sổ).
--   `sales_order_lines` không có cột thuế suất. Hệ quả: đổi thuế suất
--   sản phẩm rồi xuất đợt hai của cùng một đơn thì hai hóa đơn mang thuế
--   suất khác nhau — đúng về kế toán, nhưng cần biết trước.
--
-- ⚠ KHÔNG CHẶN SỐ LƯỢNG VƯỢT SỐ ĐẶT (PATCH 1: NPP toàn quyền ở màn Xuất
--   hàng). Đơn đặt 10 mà xuất 12 là hợp lệ, và `_wf2b_sync_order_status`
--   so `>=` nên đơn vẫn về được 'completed'.
--
-- ⚠ `line_total` = số lượng × ĐƠN GIÁ, KHÔNG trừ `line_discount` lần nữa.
--   Đây là chỗ hai quy ước trong kho mã đang ĐÁ NHAU, đã báo chủ nhà:
--     · `src/lib/sell/create-order.ts:52-53` — nơi GHI dữ liệu:
--       `unit_price` = giá đang áp, `line_discount` = qty × (giá bảng −
--       giá đang áp) và chỉ để ghi nhớ; `line_total = round(qty × giá)`.
--     · `src/app/(dashboard)/orders/[id]/page.tsx:620,700` — nơi ĐỌC:
--       `max(0, qty × unit_price − line_discount)`, tức trừ chiết khấu
--       thêm một lần nữa.
--   Với dòng bán đúng giá bảng (`line_discount = 0`) hai bên bằng nhau,
--   nên không ai phát hiện; dòng có giảm giá thì lệch đúng bằng phần
--   giảm. Bản ghi thắng: hàm này theo quy ước của `create-order.ts` và
--   của `cartTotals`. P4 phải gửi `line_discount` theo nghĩa GHI NHỚ.
CREATE OR REPLACE FUNCTION public.post_invoice(p jsonb)
RETURNS TABLE (
  invoice_id uuid, invoice_code text, entry_id uuid, receivable_id uuid,
  short_qty numeric, near_expiry_skipped int, order_status text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o           record;
  v_order     uuid;
  v_date      date;
  v_terms     text;
  v_lines     jsonb;
  v_n         int;
  v_sub_raw   numeric := 0;
  v_vat_raw   numeric := 0;
  v_inv       uuid;
  v_code      text;
  v_exp       record;
  v_rec       uuid;
  v_status    text;
BEGIN
  v_order := (p->>'order_id')::uuid;
  v_lines := COALESCE(p->'lines', '[]'::jsonb);

  SELECT so.id, so.org_id, so.order_code, so.status, so.customer_id,
         so.sales_user_id, so.payment_terms, so.order_date
    INTO o
  FROM sales_orders so WHERE so.id = v_order FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF o.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.user_has_permission(auth.uid(), 'orders.approve') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền xuất hàng' USING ERRCODE = 'P0001';
  END IF;
  IF o.status NOT IN ('submitted', 'partially_invoiced') THEN
    RAISE EXCEPTION
      'ORDER_NOT_INVOICEABLE: đơn % đang ở trạng thái %, không xuất hàng được',
      o.order_code, o.status USING ERRCODE = 'P0001';
  END IF;

  -- ⚠ HÓA ĐƠN RỖNG LÀ MỘT CHỨNG TỪ KHÔNG CÓ THẬT. Không chặn thì nó vẫn
  --   sinh số, vẫn đẩy đơn sang 'completed' (không dòng nào còn thiếu vì
  --   không có dòng nào), và vẫn in ra được.
  SELECT count(*) INTO v_n
  FROM jsonb_array_elements(v_lines) AS l
  WHERE COALESCE((l->>'quantity')::numeric, 0) > 0;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'NO_LINES: hóa đơn phải có ít nhất một dòng số lượng > 0'
      USING ERRCODE = 'P0001';
  END IF;

  v_date  := COALESCE((p->>'invoice_date')::date, current_date);
  v_terms := COALESCE(NULLIF(p->>'payment_terms', ''), o.payment_terms);

  PERFORM set_config('npp.via_rpc', 'on', true);

  -- Phiếu xuất + trừ kho FIFO. RAISE của `post_stock_export`
  -- (INSUFFICIENT_STOCK khi tổ chức không cho bán âm) rollback cả giao
  -- dịch — hóa đơn chưa kịp sinh ra, đúng như mong muốn.
  SELECT * INTO v_exp
  FROM public._wf2_export_order(v_order, v_lines, 'Xuất theo đơn ' || o.order_code);

  v_code := public._wf2b_next_invoice_code(o.org_id, v_date);

  INSERT INTO sales_invoices (
    org_id, invoice_code, order_id, customer_id, sales_user_id,
    invoice_date, status, subtotal, vat, total, payment_terms, due_date,
    stock_entry_id, notes, posted_at, posted_by
  ) VALUES (
    o.org_id, v_code, v_order, o.customer_id, o.sales_user_id,
    v_date, 'posted', 0, 0, 0, v_terms,
    v_date + public._wf2b_payment_terms_days(v_terms),
    v_exp.entry_id, NULLIF(p->>'notes', ''), now(), auth.uid()
  )
  RETURNING id INTO v_inv;

  INSERT INTO sales_invoice_lines (
    invoice_id, order_line_id, product_id, unit_name, conversion_factor,
    quantity, unit_price, line_discount, line_total, vat_rate,
    is_exchange, sort_order, note
  )
  SELECT
    v_inv,
    NULLIF(l->>'order_line_id', '')::uuid,
    (l->>'product_id')::uuid,
    l->>'unit_name',
    COALESCE((l->>'conversion_factor')::numeric, 1),
    (l->>'quantity')::numeric,
    COALESCE((l->>'unit_price')::numeric, 0),
    COALESCE((l->>'line_discount')::numeric, 0),
    (l->>'quantity')::numeric * COALESCE((l->>'unit_price')::numeric, 0),
    COALESCE(pr.vat_rate, 0),
    COALESCE((l->>'is_exchange')::boolean, false),
    (ord.i)::int,
    NULLIF(l->>'note', '')
  FROM jsonb_array_elements(v_lines) WITH ORDINALITY AS ord(l, i)
  LEFT JOIN products pr ON pr.id = (ord.l->>'product_id')::uuid
  WHERE COALESCE((ord.l->>'quantity')::numeric, 0) > 0;

  -- ⚠ CỘNG TRÊN CỘT numeric CỦA BẢNG, không cộng lại từ jsonb: thuế suất
  --   đã snapshot ở trên, và đọc lại `products` lần nữa là mở đường cho
  --   hai con số khác nhau trong cùng một giao dịch.
  SELECT
    COALESCE(sum(sil.line_total), 0),
    COALESCE(sum(sil.line_total * COALESCE(sil.vat_rate, 0)), 0)
  INTO v_sub_raw, v_vat_raw
  FROM sales_invoice_lines sil
  WHERE sil.invoice_id = v_inv;

  UPDATE sales_invoices
  SET subtotal = round(v_sub_raw),
      vat      = round(v_vat_raw),
      total    = GREATEST(0, round(v_sub_raw + v_vat_raw))
  WHERE id = v_inv;

  v_rec := public._wf2b_recompute_receivable(v_inv);

  -- Phiếu trả kèm đơn đang nháp: hàng đã xuất thì phiếu trả thành phiếu
  -- tạm để NPP xử lý tiếp, và từ nay nó trả theo HÓA ĐƠN này.
  -- ⚠ KHÔNG dùng RETURNING … INTO: một đơn có thể có vài phiếu trả nháp,
  --   và DML trả nhiều hơn một dòng là lỗi 21000.
  UPDATE returns SET status = 'submitted', invoice_id = v_inv
  WHERE order_id = v_order AND status = 'draft';

  v_status := public._wf2b_sync_order_status(v_order);

  INSERT INTO order_activity_log (org_id, order_id, action, workflow_stage, changes, actor_id)
  VALUES (o.org_id, v_order, 'invoice_posted', v_status,
          jsonb_build_object('invoice_id', v_inv, 'invoice_code', v_code,
                             'entry_id', v_exp.entry_id), auth.uid());

  PERFORM public._wf2_notify(
    o.sales_user_id, 'order_completed',
    'Đơn ' || o.order_code || ' đã xuất hóa đơn ' || v_code, NULL,
    '/sales-invoices/' || v_inv::text);

  RETURN QUERY SELECT v_inv, v_code, v_exp.entry_id, v_rec,
                      v_exp.short_qty, v_exp.near_expiry_skipped, v_status;
END;
$$;


-- =====================================================================
-- 4. cancel_invoice — huỷ hóa đơn, hoàn kho về đúng lô
-- =====================================================================
--
-- ⚠ HOÀN VỀ ĐÚNG LÔ ĐÃ LẤY, THỨ TỰ NGƯỢC. `_wf2_restock` (mig 120) đi
--   theo dấu vết `stock_line_consumptions` và trừ dần dấu vết đó, nên
--   huỷ hai lần không hoàn hai lần. Hoàn "về lô mới nhất" cho nhanh thì
--   hạn dùng trong kho sai ngay từ lần huỷ đầu tiên.
--
-- ⚠ BỐN KHOÁ, ba trong số đó bê nguyên từ `_wf2_assert_order_unlocked`
--   của v2 nhưng đổi mốc từ ĐƠN sang HÓA ĐƠN: có tiền thu, đã phát hành
--   hóa đơn điện tử, có phiếu trả đã hoàn thành. Khoá thứ tư là trạng
--   thái: chỉ hóa đơn 'posted' mới huỷ được.
CREATE OR REPLACE FUNCTION public.cancel_invoice(p_invoice_id uuid, p_reason text)
RETURNS TABLE (import_entry_id uuid, order_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v        record;
  o        record;
  v_imp    uuid;
  d        record;
  s        record;
  v_need   numeric;
  v_take   numeric;
  v_status text;
BEGIN
  SELECT si.id, si.org_id, si.invoice_code, si.status, si.order_id,
         si.stock_entry_id, si.sales_user_id
    INTO v
  FROM sales_invoices si WHERE si.id = p_invoice_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.user_has_permission(auth.uid(), 'orders.approve') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền huỷ hóa đơn' USING ERRCODE = 'P0001';
  END IF;
  IF v.status <> 'posted' THEN
    RAISE EXCEPTION 'INVOICE_NOT_POSTED: hóa đơn % đang ở trạng thái %',
      v.invoice_code, v.status USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED: phải ghi lý do huỷ hóa đơn'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT so.id, so.org_id, so.order_code, so.sales_user_id INTO o
  FROM sales_orders so WHERE so.id = v.order_id FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM receivables r
    WHERE r.invoice_id = p_invoice_id AND COALESCE(r.paid, 0) > 0
  ) OR EXISTS (
    -- ⚠ NHÁNH THỨ HAI LÀ CHO PHIẾU THU CŨ. `create_cash_receipt` (mig
    --   120) còn ghi `order_id`, chưa ghi `invoice_id` — P6 mới đổi. Chỉ
    --   so theo `invoice_id` thì một hóa đơn đã thu tiền bằng phiếu cũ
    --   vẫn huỷ được, và tiền khách đã trả treo vào một chứng từ không
    --   còn. Thà chặn rộng: dòng phiếu thu chưa gắn hóa đơn mà trỏ đúng
    --   đơn này thì coi như đã thu.
    SELECT 1 FROM cash_receipt_lines crl
    JOIN cash_receipts cr ON cr.id = crl.receipt_id
    WHERE cr.status <> 'voided'
      AND (crl.invoice_id = p_invoice_id
           OR (crl.invoice_id IS NULL AND crl.order_id = v.order_id))
  ) THEN
    RAISE EXCEPTION 'LOCKED_HAS_PAYMENT: hóa đơn đã có tiền thu, huỷ phiếu thu trước'
      USING ERRCODE = 'P0001';
  END IF;

  -- "Đã phát hành" = hóa đơn nội bộ đã chốt, hoặc MISA đã cấp số / đã ký.
  -- Điều kiện y nguyên mig 120, chỉ đổi cột nối.
  IF EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.sales_invoice_id = p_invoice_id
      AND (i.status = 'issued'
           OR i.misa_inv_no IS NOT NULL
           OR i.misa_status IN ('signed', 'replaced'))
  ) THEN
    RAISE EXCEPTION 'LOCKED_EINVOICE: hóa đơn đã phát hành hóa đơn điện tử'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM returns r
    WHERE r.invoice_id = p_invoice_id AND r.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'LOCKED_RETURN_DONE: hóa đơn đã có phiếu trả hoàn thành'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('npp.via_rpc', 'on', true);

  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, notes)
  VALUES (v.org_id,
          'NK-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS'),
          'import', 'posted', now(), auth.uid(),
          'Hoàn kho do huỷ hóa đơn ' || v.invoice_code)
  RETURNING id INTO v_imp;

  -- ⚠ HOÀN THEO DÒNG HÓA ĐƠN NÀY, KHÔNG THEO DÒNG ĐƠN. Một đơn nay có
  --   thể có nhiều hóa đơn; hoàn theo dòng đơn là trả về kho cả hàng của
  --   hóa đơn khác vẫn đang có hiệu lực.
  --
  -- ⚠ ƯU TIÊN PHIẾU XUẤT CỦA CHÍNH HÓA ĐƠN NÀY (`stock_entry_id`). Hóa
  --   đơn backfill không có phiếu xuất thì rơi về phiếu xuất của đơn —
  --   và hóa đơn backfill mà `stock_entry_id` rỗng nghĩa là tồn kho chưa
  --   từng bị trừ, nên không có gì để hoàn, vòng lặp chạy rỗng.
  FOR d IN
    SELECT sil.product_id, sil.unit_name,
           sum(sil.quantity * COALESCE(sil.conversion_factor, 1)) AS qty
    FROM sales_invoice_lines sil
    WHERE sil.invoice_id = p_invoice_id
    GROUP BY sil.product_id, sil.unit_name
  LOOP
    v_need := d.qty;
    FOR s IN
      SELECT sel.id,
             COALESCE((SELECT sum(slc.qty_in_base_uom)
                         FROM stock_line_consumptions slc
                        WHERE slc.line_id = sel.id), sel.qty_in_base_uom) AS qty_left
      FROM stock_entry_lines sel
      JOIN stock_entries se ON se.id = sel.entry_id
      WHERE se.type = 'export' AND se.status = 'posted'
        AND (se.id = v.stock_entry_id
             OR (v.stock_entry_id IS NULL
                 AND se.ref_order_ids @> jsonb_build_array(v.order_id::text)))
        AND sel.product_id = d.product_id
        AND sel.unit_name = d.unit_name
      ORDER BY se.posted_at DESC, sel.id DESC
    LOOP
      EXIT WHEN v_need <= 0;
      CONTINUE WHEN COALESCE(s.qty_left, 0) <= 0;
      v_take := LEAST(s.qty_left, v_need);
      PERFORM public._wf2_restock(s.id, v_take,
        'Hoàn kho do huỷ hóa đơn ' || v.invoice_code, v_imp);
      v_need := v_need - v_take;
    END LOOP;
  END LOOP;

  -- ⚠ Phiếu thu ĐÃ HUỶ vẫn để lại dòng trỏ vào công nợ (void chỉ đổi
  --   trạng thái phiếu). Không gỡ trước thì DELETE dưới đây nổ 23503 và
  --   phần hoàn kho vừa làm cũng rollback.
  UPDATE cash_receipt_lines crl
  SET receivable_id = NULL, payment_id = NULL
  FROM receivables r
  WHERE crl.receivable_id = r.id AND r.invoice_id = p_invoice_id;

  DELETE FROM receivables WHERE invoice_id = p_invoice_id;

  -- Phiếu trả đang chờ xử lý của hóa đơn này mất chỗ bám. Huỷ luôn và
  -- ghi lý do — để lại là một phiếu trả trỏ vào chứng từ đã huỷ.
  UPDATE returns
  SET status = 'cancelled', cancelled_at = now(),
      cancel_reason = 'Hóa đơn ' || v.invoice_code || ' bị huỷ'
  WHERE invoice_id = p_invoice_id AND status IN ('draft', 'submitted');

  UPDATE sales_invoices
  SET status = 'cancelled', cancelled_at = now(),
      cancelled_by = auth.uid(), cancel_reason = p_reason
  WHERE id = p_invoice_id;

  v_status := public._wf2b_sync_order_status(v.order_id);

  INSERT INTO order_activity_log (org_id, order_id, action, workflow_stage, changes, actor_id)
  VALUES (v.org_id, v.order_id, 'invoice_cancelled', v_status,
          jsonb_build_object('invoice_id', p_invoice_id,
                             'invoice_code', v.invoice_code,
                             'import_entry_id', v_imp,
                             'reason', p_reason), auth.uid());

  PERFORM public._wf2_notify(
    COALESCE(v.sales_user_id, o.sales_user_id), 'invoice_cancelled',
    'Hóa đơn ' || v.invoice_code || ' đã bị huỷ', p_reason,
    '/orders/' || v.order_id::text);

  RETURN QUERY SELECT v_imp, v_status;
END;
$$;


-- =====================================================================
-- 5. reissue_invoice — sửa hóa đơn (kỹ thuật: huỷ + lập lại)
-- =====================================================================
--
-- ⚠ VỀ MẶT NGHIỆP VỤ ĐÂY LÀ "SỬA" (PATCH 1: NPP sửa hóa đơn thoải mái).
--   Về mặt kỹ thuật không có sửa: huỷ bản cũ, lập bản mới, trong MỘT
--   giao dịch. Kho quay về đúng lô cũ rồi mới trừ lại theo số mới, nên
--   không có phép trừ delta nào để sai.
--
-- ⚠ `replaced_from` / `replaced_by` NỐI HAI BẢN. Không nối thì bản cũ
--   nằm đó như một hóa đơn bị huỷ không rõ vì sao, và người tra sổ sáu
--   tháng sau không có đường nào đi từ nó sang bản đang có hiệu lực.
--
-- ⚠ Q4 — CHẶN SỚM Ở CHỖ NGƯỜI DÙNG ĐANG ĐỨNG. Phiếu trả đang chờ xử lý
--   của hóa đơn cũ được chuyển sang hóa đơn mới. Nhưng hóa đơn mới có
--   thể đã bỏ mất chính món đang được trả — khi đó phiếu trả trỏ vào một
--   hóa đơn không hề bán món đó, và người dùng vấp lỗi ở màn Đơn trả,
--   một chỗ chẳng liên quan gì tới việc họ vừa làm. Nên kiểm ngay tại
--   đây và nêu tên hàng.
CREATE OR REPLACE FUNCTION public.reissue_invoice(p_invoice_id uuid, p jsonb)
RETURNS TABLE (
  invoice_id uuid, invoice_code text, entry_id uuid, receivable_id uuid,
  short_qty numeric, near_expiry_skipped int, order_status text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old     record;
  v_new     record;
  v_missing text;
  v_payload jsonb;
  v_rets    uuid[];
BEGIN
  SELECT si.id, si.org_id, si.order_id, si.invoice_code, si.status INTO v_old
  FROM sales_invoices si WHERE si.id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_old.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- ⚠ Kiểm TRƯỚC KHI huỷ. Kiểm sau thì giao dịch có rollback thật,
  --   nhưng người dùng đã thấy "đang huỷ hóa đơn…" rồi mới nhận lỗi —
  --   và không cách nào biết hóa đơn cũ còn hay mất.
  SELECT string_agg(DISTINCT pr.name, ', ') INTO v_missing
  FROM return_lines rl
  JOIN returns r ON r.id = rl.return_id
  LEFT JOIN products pr ON pr.id = rl.product_id
  WHERE r.invoice_id = p_invoice_id
    AND r.status IN ('draft', 'submitted')
    AND rl.is_exchange = false
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p->'lines', '[]'::jsonb)) AS l
      WHERE (l->>'product_id')::uuid = rl.product_id
        AND COALESCE((l->>'quantity')::numeric, 0) > 0
        AND COALESCE((l->>'is_exchange')::boolean, false) = false
    );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'REISSUE_BREAKS_RETURN: hóa đơn mới không còn bán "%" mà phiếu trả đang chờ xử lý đòi trả. Huỷ phiếu trả trước, rồi sửa lại hóa đơn.',
      v_missing USING ERRCODE = 'P0001';
  END IF;

  -- ⚠ Phiếu trả đang chờ được gỡ khỏi hóa đơn cũ TRƯỚC khi huỷ, nếu
  --   không `cancel_invoice` sẽ huỷ luôn chúng (PATCH 1 nói rõ: chuyển
  --   sang hóa đơn mới, KHÔNG huỷ). Tạm để `invoice_id` rỗng trong vài
  --   dòng lệnh, rồi nối lại ngay dưới.
  --
  -- ⚠ GHI NHỚ ĐÍCH DANH TỪNG PHIẾU. Nối lại bằng điều kiện
  --   "cùng đơn và `invoice_id` rỗng" sẽ vơ luôn những phiếu trả vốn dĩ
  --   đã rỗng từ trước — phiếu trả độc lập của đơn này bỗng dưng bị gắn
  --   vào một hóa đơn nó không liên quan.
  SELECT COALESCE(array_agg(id), '{}') INTO v_rets
  FROM returns
  WHERE invoice_id = p_invoice_id AND status IN ('draft', 'submitted');

  UPDATE returns SET invoice_id = NULL WHERE id = ANY(v_rets);

  PERFORM public.cancel_invoice(
    p_invoice_id, 'Lập lại hóa đơn ' || v_old.invoice_code);

  v_payload := jsonb_set(COALESCE(p, '{}'::jsonb), '{order_id}',
                         to_jsonb(v_old.order_id::text));

  SELECT * INTO v_new FROM public.post_invoice(v_payload);

  UPDATE sales_invoices SET replaced_by   = v_new.invoice_id WHERE id = p_invoice_id;
  UPDATE sales_invoices SET replaced_from = p_invoice_id     WHERE id = v_new.invoice_id;

  UPDATE returns SET invoice_id = v_new.invoice_id WHERE id = ANY(v_rets);

  RETURN QUERY SELECT v_new.invoice_id, v_new.invoice_code, v_new.entry_id,
                      v_new.receivable_id, v_new.short_qty,
                      v_new.near_expiry_skipped, v_new.order_status;
END;
$$;


-- =====================================================================
-- 6. close_order — thôi không giao phần còn lại
-- =====================================================================
--
-- ⚠ KHÁC 'completed'. `completed` = đã xuất ĐỦ mọi dòng; `closed` = NPP
--   chốt không giao nốt. Gộp hai thứ vào một trạng thái là mất luôn câu
--   trả lời cho "đơn này có giao thiếu không" — thứ duy nhất cho biết
--   nên gọi lại khách hay không.
--
-- ⚠ CHỈ ĐÓNG ĐƯỢC ĐƠN ĐÃ XUẤT MỘT PHẦN. Đơn chưa xuất gì mà đóng thì
--   đúng ra là HUỶ, và huỷ có đường riêng. Ràng buộc chuyển trạng thái
--   ở mig 124 cũng chỉ cho `partially_invoiced → closed`.
CREATE OR REPLACE FUNCTION public.close_order(p_order_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o record;
BEGIN
  SELECT so.id, so.org_id, so.order_code, so.status, so.sales_user_id INTO o
  FROM sales_orders so WHERE so.id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF o.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.user_has_permission(auth.uid(), 'orders.approve') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền đóng đơn' USING ERRCODE = 'P0001';
  END IF;
  IF o.status = 'closed' THEN RETURN; END IF;
  IF o.status <> 'partially_invoiced' THEN
    RAISE EXCEPTION
      'ORDER_NOT_PARTIAL: chỉ đóng được đơn đã xuất một phần (đơn % đang %)',
      o.order_code, o.status USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('npp.via_rpc', 'on', true);

  UPDATE sales_orders
  SET status = 'closed', closed_at = now(), closed_by = auth.uid(),
      notes = COALESCE(notes || E'\n', '') || 'Đóng đơn: ' || COALESCE(p_reason, '')
  WHERE id = p_order_id;

  -- Phiếu trả kèm đơn còn nháp không còn chuyến nào để đi cùng.
  UPDATE returns SET status = 'cancelled', cancelled_at = now(),
      cancel_reason = 'Đơn ' || o.order_code || ' đã đóng'
  WHERE order_id = p_order_id AND status = 'draft';

  INSERT INTO order_activity_log (org_id, order_id, action, workflow_stage, changes, actor_id)
  VALUES (o.org_id, p_order_id, 'order_closed', 'closed',
          jsonb_build_object('reason', p_reason), auth.uid());

  PERFORM public._wf2_notify(
    o.sales_user_id, 'order_cancelled',
    'Đơn ' || o.order_code || ' đã đóng, không giao phần còn lại', p_reason,
    '/orders/' || p_order_id::text);
END;
$$;


-- =====================================================================
-- 7. cancel_order — viết lại: chỉ còn đơn CHƯA xuất
-- =====================================================================
--
-- ⚠ NỬA SAU CỦA HÀM CŨ BIẾN MẤT, CÓ CHỦ Ý. Bản v2 huỷ được cả đơn đã
--   xuất: nó tự hoàn kho, tự xoá công nợ. Nay hàng đã rời kho thuộc về
--   một HÓA ĐƠN, và chỉ `cancel_invoice` mới biết hoàn về đúng lô nào.
--   Để `cancel_order` tự hoàn là có hai đường cùng đụng tồn kho cho cùng
--   một lô hàng — hai đường thì sớm muộn chúng lệch nhau.
--
-- ⚠ VÌ THẾ ĐÂY LÀ MỘT LỜI CHỈ ĐƯỜNG, KHÔNG PHẢI MỘT LỜI TỪ CHỐI. Thông
--   báo nêu rõ còn mấy hóa đơn phải huỷ trước.
CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o     record;
  v_inv int;
BEGIN
  SELECT so.id, so.org_id, so.order_code, so.status, so.sales_user_id INTO o
  FROM sales_orders so WHERE so.id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF o.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF o.status = 'cancelled' THEN RETURN; END IF;

  SELECT count(*) INTO v_inv
  FROM sales_invoices WHERE order_id = p_order_id AND status = 'posted';

  IF v_inv > 0 OR o.status IN ('partially_invoiced', 'completed', 'closed') THEN
    RAISE EXCEPTION
      'HAS_INVOICE: đơn % đã xuất % hóa đơn. Huỷ hết hóa đơn trước, rồi mới huỷ đơn.',
      o.order_code, v_inv USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.user_has_permission(auth.uid(), 'orders.update') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền huỷ đơn' USING ERRCODE = 'P0001';
  END IF;
  IF public.user_role() = 'sales' AND o.sales_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'FORBIDDEN_NOT_OWNER: chỉ huỷ được đơn của mình'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE sales_orders
  SET status = 'cancelled', cancelled_at = now(),
      cancelled_by = auth.uid(), cancel_reason = p_reason
  WHERE id = p_order_id;

  UPDATE returns SET status = 'cancelled', cancelled_at = now(),
      cancel_reason = 'Đơn ' || o.order_code || ' đã huỷ'
  WHERE order_id = p_order_id AND status = 'draft';

  PERFORM public._wf2_notify(
    o.sales_user_id, 'order_cancelled',
    'Đơn ' || o.order_code || ' đã bị huỷ', p_reason,
    '/orders/' || p_order_id::text);
END;
$$;


-- =====================================================================
-- 8. Quyền thực thi
-- =====================================================================
--
-- ⚠ HELPER KHÔNG CẤP QUYỀN GỌI. `_wf2b_recompute_receivable` viết thẳng
--   vào công nợ mà không kiểm quyền — nó tin hàm gọi nó đã kiểm. Cấp
--   `authenticated` là cho bất cứ ai gọi thẳng qua PostgREST và đặt lại
--   số nợ của khách.
REVOKE EXECUTE ON FUNCTION public._wf2b_recompute_receivable(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._wf2_recompute_receivable(uuid)  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._wf2b_sync_order_status(uuid)    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._wf2b_next_invoice_code(uuid, date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public._wf2b_payment_terms_days(text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_invoiceable_lines(uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_invoice(jsonb)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_invoice(uuid, text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.reissue_invoice(uuid, jsonb)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_order(uuid, text)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text)        TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE v_fn int; v_rec int; v_orphan int;
BEGIN
  SELECT count(*) INTO v_fn
  FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public'
    AND pr.proname IN ('get_invoiceable_lines', 'post_invoice', 'cancel_invoice',
                       'reissue_invoice', 'close_order', 'cancel_order',
                       '_wf2b_recompute_receivable');

  SELECT count(*) INTO v_rec FROM receivables WHERE invoice_id IS NOT NULL;
  SELECT count(*) INTO v_orphan
  FROM returns WHERE invoice_id IS NULL AND status NOT IN ('draft', 'cancelled');

  RAISE NOTICE '--- 125: %/7 RPC đã dựng · % dòng công nợ gắn hóa đơn ---', v_fn, v_rec;
  IF v_orphan > 0 THEN
    RAISE NOTICE '--- 125 ⚠ % phiếu trả chưa gắn hóa đơn nào. Chúng sẽ được nhận nuôi khi tính lại công nợ, hoặc dừng lại nếu đơn có nhiều hóa đơn. ---', v_orphan;
  END IF;
END $$;


-- ####################################################################
-- # 126_wf2b_revenue_from_invoices.sql
-- ####################################################################

-- ---------------------------------------------------------------------
-- 126 — Workflow v2b: doanh thu chuyển gốc từ ĐƠN sang HÓA ĐƠN
--
-- Phần cuối của bộ ba 124 (cấu trúc) · 125 (RPC) · 126 (số liệu).
-- ---------------------------------------------------------------------
--
-- ⚠ VÌ SAO KHÔNG THỂ ĐỂ NGUYÊN: v2b cho một đơn xuất làm nhiều đợt. Đơn
--   `partially_invoiced` đã giao một phần và đã sinh công nợ phần đó —
--   nhưng `is_revenue_status` của v2 chỉ nhận `'completed'`, nên phần đã
--   giao ấy KHÔNG có mặt trong doanh thu, trong lương, trong báo cáo.
--   Hàng ra khỏi kho, tiền ghi vào công nợ, mà sổ doanh thu im lặng.
--
-- ⚠ VÀ ĐỂ NGUYÊN THEO CHIỀU NGƯỢC LẠI CŨNG SAI: chỉ nới
--   `is_revenue_status` cho ba trạng thái mới mà vẫn cộng
--   `sales_orders.total` thì đơn mới giao một nửa được tính doanh thu
--   TOÀN BỘ. Sai còn to hơn.
--
-- Nên phải tách làm hai việc khác nhau:
--
--   SỐ TIỀN  → cộng từ `sales_invoices` đã ghi sổ. Đúng phần đã xuất,
--              không hơn không kém.
--   TẬP ĐƠN  → `is_revenue_status` đổi nghĩa thành "đơn này đã sinh ra
--              doanh thu", tức đã xuất ít nhất một phần. Dùng cho các
--              phép ĐẾM ĐƠN và cho chốt chặn của đơn trả — những chỗ hỏi
--              "đơn này có đáng kể không", không hỏi "bao nhiêu tiền".
--
-- ⚠ ĐỔI Ý NGHĨA SỐ LIỆU — ĐỌC KỸ
--   Doanh thu nay tính theo NGÀY HÓA ĐƠN, không theo ngày đặt hàng. Đơn
--   đặt cuối tháng 3 giao đầu tháng 4 rời khỏi doanh thu tháng 3 và sang
--   tháng 4. Lương và hoa hồng của các kỳ đã chốt sẽ tính lại khác đi.
--   Đổi lại, doanh thu về đúng cùng một trục thời gian với GIÁ VỐN —
--   `finance_pnl` vốn lấy giá vốn theo `stock_entries.posted_at`, nên
--   trước nay lãi gộp của một kỳ đang so doanh thu ngày đặt với giá vốn
--   ngày giao. Lệch đó nay hết.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.sales_invoices') IS NULL THEN
    RAISE EXCEPTION
      'WF2B_NEEDS_124: chưa có bảng sales_invoices. Chạy migration 124 và 125 trước.'
      USING ERRCODE = 'P0001';
  END IF;
END $$;


-- =====================================================================
-- 1. is_revenue_status — đổi nghĩa, giữ nguyên chữ ký
-- =====================================================================
--
-- ⚠ GIỮ NGUYÊN TÊN VÀ CHỮ KÝ, CÓ CHỦ Ý. Sáu hàm lương/báo cáo đang gọi
--   nó. Đổi tên là phải sửa cả sáu trong cùng một migration, và hàm nào
--   sót lại sẽ gọi một cái tên không còn tồn tại — PL/pgSQL chỉ tra tên
--   lúc CHẠY, nên nó không vỡ khi cài mà vỡ giữa kỳ tính lương.
--
-- ⚠ 'closed' CÓ TÍNH. Đơn đóng là đơn NPP chốt không giao nốt phần còn
--   lại — phần đã giao vẫn là hàng đã bán và tiền đã ghi nợ. Bỏ nó ra là
--   xoá doanh thu có thật chỉ vì đơn không giao đủ.
--
-- ⚠ 'submitted' KHÔNG TÍNH. Phiếu tạm chưa trừ kho, chưa sinh công nợ.
DROP FUNCTION IF EXISTS public.is_revenue_status(text);
CREATE FUNCTION public.is_revenue_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_status, '') IN ('partially_invoiced', 'completed', 'closed');
$$;

COMMENT ON FUNCTION public.is_revenue_status(text) IS
  'Đơn này đã sinh ra doanh thu chưa — tức đã xuất ít nhất một phần. '
  'v2b: dùng cho phép ĐẾM ĐƠN. Muốn biết BAO NHIÊU TIỀN thì cộng từ '
  'sales_invoices, vì đơn xuất một phần không mang doanh thu toàn bộ.';


-- =====================================================================
-- 2. dashboard_summary
-- =====================================================================
--
-- ⚠ HAI CON SỐ ĐẦU VỀ CÙNG MỘT TRỤC THỜI GIAN. Giữ "doanh thu theo ngày
--   hóa đơn" bên cạnh "số đơn theo ngày đặt" là để hai ô cạnh nhau trên
--   cùng màn hình trả lời hai câu hỏi khác nhau mà nhìn như một.
--   `period_orders` nay là SỐ ĐƠN ĐÃ XUẤT HÀNG TRONG KỲ, đếm phân biệt
--   vì một đơn xuất hai đợt vẫn là một đơn.
DROP FUNCTION IF EXISTS public.dashboard_summary(date);
CREATE FUNCTION public.dashboard_summary(p_period_start date)
RETURNS TABLE (
  period_revenue    numeric,
  period_orders     bigint,
  open_receivables  numeric,
  overdue_count     bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE((
      SELECT SUM(COALESCE(total, 0)) FROM sales_invoices
      WHERE org_id = public.user_org_id()
        AND invoice_date >= p_period_start
        AND public.is_revenue_invoice_status(status)
    ), 0),
    COALESCE((
      SELECT COUNT(DISTINCT order_id) FROM sales_invoices
      WHERE org_id = public.user_org_id()
        AND invoice_date >= p_period_start
        AND public.is_revenue_invoice_status(status)
    ), 0),
    COALESCE((
      SELECT SUM(GREATEST(0, COALESCE(amount, 0) - COALESCE(paid, 0)))
      FROM receivables
      WHERE org_id = public.user_org_id() AND status <> 'paid'
    ), 0),
    COALESCE((
      SELECT COUNT(*) FROM receivables
      WHERE org_id = public.user_org_id() AND status = 'overdue'
    ), 0);
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_summary(date) TO authenticated;


-- =====================================================================
-- 3. dashboard_channel_revenue
-- =====================================================================
--
-- ⚠ KÊNH LẤY TỪ KHÁCH CỦA HÓA ĐƠN, không từ khách của đơn. Hai thứ này
--   luôn bằng nhau (RPC chép `customer_id` từ đơn sang) nhưng đi qua hóa
--   đơn thì mỗi đồng doanh thu chỉ được đếm ở đúng một chỗ.
DROP FUNCTION IF EXISTS public.dashboard_channel_revenue(date);
CREATE FUNCTION public.dashboard_channel_revenue(p_period_start date)
RETURNS TABLE (
  channel text,
  total   numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE(NULLIF(c.channel, ''), 'Khác'),
    COALESCE(SUM(COALESCE(si.total, 0)), 0)
  FROM sales_invoices si
  LEFT JOIN customers c ON c.id = si.customer_id
  WHERE si.org_id = public.user_org_id()
    AND si.invoice_date >= p_period_start
    AND public.is_revenue_invoice_status(si.status)
  GROUP BY COALESCE(NULLIF(c.channel, ''), 'Khác')
  ORDER BY COALESCE(SUM(COALESCE(si.total, 0)), 0) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_channel_revenue(date) TO authenticated;


-- =====================================================================
-- 4. dashboard_top_customers
-- =====================================================================
--
-- ⚠ `order_count` VẪN ĐẾM ĐƠN, không đếm hóa đơn. Cột này trả lời "khách
--   này mua mấy lần"; đếm hóa đơn thì khách nhận hàng làm hai chuyến
--   trông như mua hai lần.
DROP FUNCTION IF EXISTS public.dashboard_top_customers(date, integer);
CREATE FUNCTION public.dashboard_top_customers(p_period_start date, p_limit integer DEFAULT 5)
RETURNS TABLE (
  customer_id uuid,
  store_name  text,
  total       numeric,
  order_count bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    si.customer_id,
    COALESCE(c.store_name, 'N/A'),
    COALESCE(SUM(COALESCE(si.total, 0)), 0),
    COUNT(DISTINCT si.order_id)
  FROM sales_invoices si
  LEFT JOIN customers c ON c.id = si.customer_id
  WHERE si.org_id = public.user_org_id()
    AND si.invoice_date >= p_period_start
    AND si.customer_id IS NOT NULL
    AND public.is_revenue_invoice_status(si.status)
  GROUP BY si.customer_id, c.store_name
  ORDER BY COALESCE(SUM(COALESCE(si.total, 0)), 0) DESC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_top_customers(date, integer) TO authenticated;


-- =====================================================================
-- 5. finance_pnl
-- =====================================================================
--
-- ⚠ CHỈ ĐỔI KHỐI `rev`. Giá vốn và chi phí giữ nguyên từng chữ — chúng
--   không đọc trạng thái đơn, và đụng vào là mở thêm một mặt trận trong
--   cùng một migration.
--
-- ⚠ DOANH THU VÀ GIÁ VỐN NAY CÙNG MỘT TRỤC. `cogs` vốn lấy theo
--   `stock_entries.posted_at` (ngày hàng rời kho), còn doanh thu trước
--   nay lấy theo `order_date`. Lãi gộp của một kỳ vì thế đang so hai mốc
--   khác nhau: đơn đặt tháng 3 giao tháng 4 góp doanh thu vào tháng 3 mà
--   góp giá vốn vào tháng 4. Nay cả hai cùng bám ngày giao.
DROP FUNCTION IF EXISTS public.finance_pnl(date, date);
CREATE FUNCTION public.finance_pnl(p_from date, p_to date)
RETURNS TABLE (
  revenue        numeric,
  order_count    bigint,
  cogs           numeric,
  exp_cogs       numeric,
  exp_operating  numeric,
  exp_hr         numeric,
  exp_financial  numeric,
  exp_tax        numeric,
  exp_other      numeric,
  total_expenses numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH rev AS (
    SELECT COALESCE(SUM(COALESCE(total, 0)), 0) AS revenue,
           COUNT(DISTINCT order_id) AS order_count
    FROM sales_invoices
    WHERE org_id = public.user_org_id()
      AND public.is_revenue_invoice_status(status)
      AND invoice_date >= p_from
      AND invoice_date <= p_to
  ),
  cogs AS (
    SELECT COALESCE(SUM(ABS(COALESCE(l.quantity, 0)) * COALESCE(l.unit_cost, 0)), 0) AS cogs
    FROM stock_entry_lines l
    JOIN stock_entries e ON e.id = l.entry_id
    WHERE e.org_id = public.user_org_id()
      AND e.type = 'export'
      AND e.status = 'posted'
      AND e.posted_at >= p_from::timestamptz
      AND e.posted_at <  (p_to + 1)::timestamptz
  ),
  exp AS (
    -- Danh mục không có bucket thì rơi vào 'other', giống mã cũ.
    SELECT
      COALESCE(ec.bucket, 'other') AS bucket,
      SUM(COALESCE(x.amount, 0))   AS amt
    FROM expenses x
    LEFT JOIN expense_categories ec ON ec.id = x.category_id
    WHERE x.org_id = public.user_org_id()
      AND x.expense_date >= p_from
      AND x.expense_date <= p_to
    GROUP BY COALESCE(ec.bucket, 'other')
  )
  SELECT
    rev.revenue,
    rev.order_count,
    cogs.cogs,
    COALESCE((SELECT amt FROM exp WHERE bucket = 'cogs'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'operating'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'hr'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'financial'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'tax'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'other'), 0),
    COALESCE((SELECT SUM(amt) FROM exp), 0)
  FROM rev, cogs;
$$;

GRANT EXECUTE ON FUNCTION public.finance_pnl(date, date) TO authenticated;


-- =====================================================================
-- 6. compute_payroll_run — chỉ đổi DOANH SỐ GỘP
-- =====================================================================
--
-- ⚠ HÀM DÀI, VÀ CHỈ MỘT CÂU TRUY VẤN CẦN ĐỔI. Nên thay vì chép lại cả
--   thân hàm (mig 096) và chờ một chữ bị chép sai, tách đúng câu ấy ra
--   thành một hàm riêng rồi gọi vào. `compute_payroll_run` được dựng lại
--   nguyên văn mig 096 với đúng một dòng khác.
--
-- ⚠ HAI PHÉP ĐẾM ĐƠN THƯỞNG KHÔNG ĐỔI. Chúng đếm ĐƠN theo `order_date`
--   và so `sales_orders.total` với ngưỡng — hỏi "nhân viên chốt được mấy
--   đơn đủ lớn", không hỏi "thu về bao nhiêu tiền". Chuyển sang hóa đơn
--   là đơn giao hai chuyến hoá ra hai lần thưởng. Chúng tự đi theo nghĩa
--   mới của `is_revenue_status` ở mục 1, và thế là đủ.
CREATE OR REPLACE FUNCTION public._wf2b_gross_revenue_for(
  p_user uuid, p_org uuid, p_start date, p_end date
) RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(COALESCE(si.total, 0)), 0)
  FROM sales_invoices si
  WHERE si.org_id = p_org
    AND si.sales_user_id = p_user
    AND public.is_revenue_invoice_status(si.status)
    AND si.invoice_date BETWEEN p_start AND p_end;
$$;

COMMENT ON FUNCTION public._wf2b_gross_revenue_for(uuid, uuid, date, date) IS
  'Doanh số gộp của một nhân viên trong kỳ, cộng từ hóa đơn đã ghi sổ. '
  'Tách riêng để compute_payroll_run không phải chép lại cả thân hàm.';

REVOKE EXECUTE ON FUNCTION public._wf2b_gross_revenue_for(uuid, uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._wf2b_gross_revenue_for(uuid, uuid, date, date) TO authenticated;


DO $$
DECLARE
  v_src  text;
  v_stmt text;
  v_norm text;
  v_new  text;
  v_n    int;
  v_oid  oid;
  v_shape_095 text;
  v_shape_096 text;
BEGIN
  -- ⚠ ĐẾM TRƯỚC KHI LẤY. Có hai bản nạp chồng thì `SELECT … INTO` vớ đại
  --   một cái, vá xong bản kia vẫn cộng tiền theo đơn — và không dòng nào
  --   báo.
  SELECT count(*) INTO v_n
  FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public' AND pr.proname = 'compute_payroll_run'
    AND pr.prokind = 'f';

  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'WF2B_NO_PAYROLL_FN: tìm thấy % bản compute_payroll_run, cần đúng 1', v_n
      USING ERRCODE = 'P0001';
  END IF;

  -- ⚠ LẤY OID TRƯỚC, GỌI SAU — hai câu, không gộp. Cùng lý do như khối
  --   dò ở cuối file: trình tối ưu có thể gọi `pg_get_functiondef` trên
  --   những dòng chưa bị lọc, và nó ném lỗi khi gặp aggregate.
  SELECT pr.oid INTO v_oid
  FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public' AND pr.proname = 'compute_payroll_run'
    AND pr.prokind = 'f';

  v_src := pg_get_functiondef(v_oid);

  -- ⚠ VÁ ĐÚNG MỘT CÂU TRONG THÂN HÀM ĐANG CHẠY, không chép lại cả hàm.
  --   Chép lại là dựng một bản sao thứ hai của 400 dòng mà không ai đối
  --   chiếu được với bản gốc; vá thì nếu câu cần vá không còn đúng như
  --   dự tính, khối này DỪNG thay vì âm thầm để nguyên.
  --
  -- ⚠ CẮT CÂU THẬT RA RỒI MỚI SO, KHÔNG SO BẰNG MỘT CHUỖI CHÉP TAY.
  --   Bản đầu chép nguyên văn câu lệnh từ mig 096 kể cả thụt đầu dòng rồi
  --   `position(... IN ...)`. Nó chết trên CSDL thật chỉ vì hàm ở đó
  --   không cùng một hình dạng — và thông báo lỗi không nói được nó đã
  --   thấy cái gì, nên chủ nhà chỉ biết là "hỏng", không biết hỏng ở đâu.
  --   Giờ: cắt đúng câu gán v_gross ra khỏi thân hàm, chuẩn hoá khoảng
  --   trắng rồi mới đối chiếu, và thay thế bằng CHÍNH đoạn vừa cắt — nên
  --   thụt dòng hay xuống dòng kiểu gì cũng không còn ảnh hưởng.
  v_stmt := substring(v_src from 'SELECT[^;]+INTO[[:space:]]+v_gross[^;]+;');

  IF v_stmt IS NULL THEN
    RAISE EXCEPTION
      'WF2B_PAYROLL_SHAPE: không tìm thấy câu nào gán v_gross trong compute_payroll_run. Gửi lại thân hàm (SELECT prosrc FROM pg_proc WHERE proname = ''compute_payroll_run'') để sửa tay migration 126.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ⚠ ĐẾM. `replace()` thay MỌI chỗ khớp. Nếu một ngày có hai câu cùng
  --   gán v_gross thì vá cả hai là sai, mà vá một cái rồi bỏ cái kia còn
  --   tệ hơn — dừng lại để người sửa nhìn tận mắt.
  SELECT count(*) INTO v_n
  FROM regexp_matches(v_src, 'SELECT[^;]+INTO[[:space:]]+v_gross[^;]+;', 'g');

  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'WF2B_PAYROLL_SHAPE: có % câu gán v_gross trong compute_payroll_run, cần đúng 1.', v_n
      USING ERRCODE = 'P0001';
  END IF;

  v_norm := btrim(lower(regexp_replace(v_stmt, '[[:space:]]+', ' ', 'g')));

  -- Hai hình dạng HỢP LỆ, vì cả hai đều do migration trong repo này tạo ra:
  --   • 096 — có lọc org_id (CSDL đã chạy đủ tới 096)
  --   • 095 — chưa có lọc org_id (CSDL dừng ở 095)
  -- Câu thay thế gọi _wf2b_gross_revenue_for, vốn đã lọc org_id, nên vá
  -- bản 095 vừa đúng vừa sửa luôn chỗ hở đó.
  v_shape_096 := 'select coalesce(sum(total), 0) into v_gross '
              || 'from sales_orders '
              || 'where sales_user_id = u.id '
              || 'and org_id = v_org '
              || 'and public.is_revenue_status(status) '
              || 'and order_date between v_period_start and v_period_end;';

  v_shape_095 := 'select coalesce(sum(total), 0) into v_gross '
              || 'from sales_orders '
              || 'where sales_user_id = u.id '
              || 'and public.is_revenue_status(status) '
              || 'and order_date between v_period_start and v_period_end;';

  v_new := 'v_gross := public._wf2b_gross_revenue_for(u.id, v_org, v_period_start, v_period_end);';

  IF v_norm = v_shape_096 THEN
    NULL;
  ELSIF v_norm = v_shape_095 THEN
    -- ⚠ KÊU TO, ĐỪNG NUỐT. Vá được không có nghĩa là mọi thứ ổn: hàm ở
    --   hình dạng 095 nghĩa là mig 096 hình như CHƯA chạy trên CSDL này,
    --   mà 096 còn sửa một lỗi tiền thật (phiếu trả của đơn đã huỷ vẫn bị
    --   trừ vào doanh số nhân viên). 126 không sửa chỗ đó và cũng không
    --   nên tự sửa.
    RAISE WARNING E'--- 126: compute_payroll_run đang ở hình dạng mig 095, không phải 096.\n'
      '    Vá vẫn chạy được (hàm mới đã lọc org_id sẵn), NHƯNG:\n'
      '    mig 096 có vẻ CHƯA chạy trên CSDL này. 096 còn sửa một lỗi tiền:\n'
      '    phiếu trả gắn vào đơn đã huỷ vẫn bị trừ vào doanh số nhân viên.\n'
      '    Kiểm tra lại mig 096 sau khi chạy xong 127.';
  ELSE
    RAISE EXCEPTION
      E'WF2B_PAYROLL_SHAPE: câu tính doanh số gộp trong compute_payroll_run không khớp hình dạng 095 hay 096. Sửa tay migration 126 trước khi chạy tiếp.\nCâu đang có trong CSDL:\n%', v_stmt
      USING ERRCODE = 'P0001';
  END IF;

  EXECUTE replace(v_src, v_stmt, v_new);
  RAISE NOTICE '--- 126: compute_payroll_run đã chuyển doanh số gộp sang hóa đơn ---';
END $$;


NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_left  int;
  v_names text;
  v_ord   numeric;
  v_inv   numeric;
BEGIN
  -- Còn hàm nào cộng TIỀN từ sales_orders theo is_revenue_status không.
  --
  -- ⚠ `WITH … AS MATERIALIZED` KHÔNG PHẢI TRANG TRÍ. `pg_get_functiondef`
  --   NÉM LỖI khi gặp một aggregate ("array_agg" is an aggregate
  --   function), và trình tối ưu được phép đánh giá nó TRƯỚC khi lọc
  --   `nspname` — nên viết cả hai điều kiện trong cùng một WHERE thì câu
  --   này vẫn chết vì một hàm ở `pg_catalog` mà ta không hề hỏi tới.
  --   Đã gặp thật: migration chết ở đúng khối này.
  --
  -- ⚠ `prokind = 'f'` là vế thứ hai của cùng một lớp bảo vệ: loại
  --   aggregate và window function ra trước khi gọi. Thiếu nó thì chỉ cần
  --   một extension cài aggregate vào `public` là hỏng lại.
  WITH fns AS MATERIALIZED (
    SELECT pr.oid, pr.proname
    FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
    WHERE n.nspname = 'public' AND pr.prokind = 'f'
  )
  SELECT count(*), string_agg(proname, ', ' ORDER BY proname)
    INTO v_left, v_names
  FROM fns
  WHERE pg_get_functiondef(fns.oid) LIKE '%is_revenue_status%'
    AND pg_get_functiondef(fns.oid) LIKE '%sales_orders%';

  -- ⚠ ĐÂY LÀ GỢI Ý ĐỂ SOI MẮT, KHÔNG PHẢI MỘT KẾT LUẬN — và câu chữ phải
  --   nói đúng như vậy.
  --
  --   Bản đầu đếm bằng `LIKE '%SUM(%total%'` rồi kêu "⚠ còn N hàm cộng
  --   tiền từ sales_orders. Xem lại." Chạy thật thì nó réo tên
  --   `compute_payroll_run` — một hàm ĐÚNG: hai chỗ còn `is_revenue_status`
  --   trong đó là hai phép ĐẾM ĐƠN thưởng, cố ý giữ. Mẫu LIKE quét cả
  --   thân hàm nên bất cứ `SUM(` nào đứng trước bất cứ chữ `total` nào
  --   cũng khớp.
  --
  --   Một cảnh báo kêu oan còn tệ hơn không có cảnh báo: nó dạy người đọc
  --   bỏ qua NOTICE, đúng thứ cả hai pack đang chống. Nên nó liệt kê TÊN
  --   và nói thẳng rằng hàm chỉ ĐẾM đơn là bình thường.
  IF v_left > 0 THEN
    RAISE NOTICE '--- 126: % hàm còn nhắc cả is_revenue_status lẫn sales_orders: %. Soi bằng mắt: hàm chỉ ĐẾM đơn là đúng, hàm còn CỘNG TIỀN từ sales_orders mới phải sửa. ---',
      v_left, v_names;
  END IF;

  SELECT COALESCE(sum(total), 0) INTO v_ord
  FROM sales_orders WHERE public.is_revenue_status(status);
  SELECT COALESCE(sum(total), 0) INTO v_inv
  FROM sales_invoices WHERE status = 'posted';

  RAISE NOTICE '--- 126: doanh thu theo ĐƠN % · theo HÓA ĐƠN % ---', v_ord, v_inv;
  IF v_ord <> v_inv THEN
    RAISE NOTICE '--- 126 ⚠ hai con số LỆCH NHAU %. Đúng ra chúng bằng nhau ngay sau backfill (mọi đơn xuất đủ một lần). Lệch nghĩa là có đơn xuất một phần, hoặc backfill 124 chưa khớp — đối chiếu trước khi chốt lương kỳ tới. ---', v_ord - v_inv;
  END IF;
END $$;


-- ####################################################################
-- # 127_wf2b_returns_and_receipts.sql
-- ####################################################################

-- ---------------------------------------------------------------------
-- 127 — Workflow v2b: đơn trả và phiếu thu bám hóa đơn
--
-- Phần cuối của bộ bốn: 124 (cấu trúc) · 125 (RPC) · 126 (số liệu) ·
-- 127 (đơn trả + phiếu thu).
-- ---------------------------------------------------------------------
--
-- ⚠ BA CHỖ V2B LÀM VỠ MÀ 124–126 CHƯA CHẠM TỚI:
--
--   1. `complete_return` chặn mọi đơn không ở đúng `'completed'`. Từ v2b
--      đơn giao một phần mang `'partially_invoiced'` và đơn chốt không
--      giao nốt mang `'closed'` — hàng của chúng ĐÃ rời kho, nhưng khách
--      trả lại thì bị từ chối với câu "đơn gốc chưa xuất hàng". Sai, và
--      sai theo kiểu người dùng không cãi lại được.
--
--   2. Trần số lượng trả trong `complete_return` vẫn đếm `sales_order_lines`.
--      Migration 124 đã đổi trigger sang đếm dòng HÓA ĐƠN; để hai chỗ nói
--      hai đằng thì phiếu trả lọt trigger rồi vấp ở RPC, hoặc ngược lại —
--      và thông báo lỗi nói về một con số người dùng không thấy ở đâu.
--
--   3. `cash_receipt_lines.invoice_id` (mig 124) chưa ai ghi. Cột rỗng
--      nghĩa là khoá "hóa đơn đã có tiền thu" của `cancel_invoice` phải
--      chặn rộng theo `order_id` — đúng về an toàn, nhưng chặn oan hóa
--      đơn đợt hai của một đơn mà đợt một đã thu tiền.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.sales_invoices') IS NULL THEN
    RAISE EXCEPTION
      'WF2B_NEEDS_124: chưa có bảng sales_invoices. Chạy migration 124 → 126 trước.'
      USING ERRCODE = 'P0001';
  END IF;
END $$;


-- =====================================================================
-- 1. Dòng phiếu thu tự gắn hóa đơn
-- =====================================================================
--
-- ⚠ TRIGGER, KHÔNG SỬA `create_cash_receipt`. Hàm đó dài 300 dòng và
--   chèn `cash_receipt_lines` ở BỐN chỗ khác nhau; vá bốn chỗ là bốn chỗ
--   để quên một chỗ, và chỗ quên ấy sẽ là chỗ không ai thử. Quan hệ này
--   suy ra được: một dòng công nợ thuộc đúng một hóa đơn, nên
--   `invoice_id` của dòng phiếu thu luôn bằng `invoice_id` của khoản nợ
--   nó đang trả.
--
-- ⚠ CHỈ ĐIỀN KHI ĐANG RỖNG. Đè lên giá trị đã có là xoá một liên kết ai
--   đó đặt có chủ ý — và §4 của quy ước nói thẳng: đừng gán đè lên cột
--   đang có giá trị tốt.
CREATE OR REPLACE FUNCTION public.fill_crl_invoice_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.invoice_id IS NULL AND NEW.receivable_id IS NOT NULL THEN
    SELECT rc.invoice_id INTO NEW.invoice_id
    FROM receivables rc WHERE rc.id = NEW.receivable_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_crl_invoice_id ON cash_receipt_lines;
CREATE TRIGGER trg_fill_crl_invoice_id
  BEFORE INSERT OR UPDATE OF receivable_id ON cash_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION public.fill_crl_invoice_id();

DO $$
DECLARE v_n int;
BEGIN
  UPDATE cash_receipt_lines crl
  SET invoice_id = rc.invoice_id
  FROM receivables rc
  WHERE crl.receivable_id = rc.id
    AND crl.invoice_id IS NULL
    AND rc.invoice_id IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '--- 127: gắn hóa đơn cho % dòng phiếu thu cũ ---', v_n;
END $$;


-- =====================================================================
-- 2. complete_return — nhập kho hàng khách trả
-- =====================================================================
--
-- Chép nguyên bản mig 120, đổi ĐÚNG BA CHỖ; phần nhập kho, chọn lô và
-- suy hạn dùng giữ từng chữ.
--
-- ⚠ CHỖ 1 — ĐIỀU KIỆN ĐƠN GỐC. `o2.status = 'completed'` đổi thành
--   `is_revenue_status(o2.status)`, tức ba trạng thái đã xuất hàng. Ý
--   định của chốt này là "hàng đã từng rời kho chưa"; sau v2b chỉ so với
--   một giá trị là trả lời sai hai trong ba ca.
--
-- ⚠ CHỖ 2 — TRẦN SỐ LƯỢNG TRẢ đếm `sales_invoice_lines` của
--   `returns.invoice_id`, khớp với trigger ở mig 124. Phiếu trả CHƯA gắn
--   hóa đơn thì rơi về cách cũ (đếm dòng đơn) — dữ liệu cũ vẫn phải xử
--   lý được.
--
-- ⚠ CHỖ 3 — TÍNH LẠI CÔNG NỢ theo HÓA ĐƠN khi phiếu có `invoice_id`.
CREATE OR REPLACE FUNCTION public.complete_return(p_return_id uuid, p_zone text)
RETURNS TABLE (entry_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r          record;
  v_entry    uuid;
  v_code     text;
  l          record;
  v_conv     numeric;
  v_base     numeric;
  v_batch    uuid;
  v_cost     numeric;
  v_exp      date;
  cap        record;
  v_sold     numeric;
  v_returned numeric;
  v_pname    text;
BEGIN
  SELECT id, org_id, order_id, invoice_id, status, requested_by INTO r
  FROM returns WHERE id = p_return_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RETURN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF r.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.user_has_permission(auth.uid(), 'returns.approve') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền hoàn thành đơn trả'
      USING ERRCODE = 'P0001';
  END IF;
  IF r.status <> 'submitted' THEN
    RAISE EXCEPTION 'RETURN_NOT_SUBMITTED: phiếu trả không ở Phiếu tạm'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_zone NOT IN ('sale', 'date') THEN
    RAISE EXCEPTION 'BAD_ZONE: kho nhận phải là sale hoặc date' USING ERRCODE = 'P0001';
  END IF;

  -- ⚠ Nhập lại hàng của một đơn CHƯA xuất là cộng khống tồn kho: số hàng
  --   đó chưa bao giờ rời kho.
  IF r.invoice_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM sales_invoices si
      WHERE si.id = r.invoice_id AND si.status = 'posted'
    ) THEN
      RAISE EXCEPTION
        'INVOICE_NOT_POSTED: hóa đơn gốc đã bị huỷ — hàng của nó đã hoàn về kho rồi, không nhập trả lần nữa'
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF r.order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sales_orders o2
    WHERE o2.id = r.order_id AND public.is_revenue_status(o2.status)
  ) THEN
    RAISE EXCEPTION 'ORDER_NOT_COMPLETED: đơn gốc chưa xuất hàng, không nhập trả được'
      USING ERRCODE = 'P0001';
  END IF;

  -- ===================================================================
  -- TRẦN SỐ LƯỢNG TRẢ, KIỂM LẠI Ở ĐÂY
  --
  -- ⚠ VÌ SAO PHẢI KIỂM HAI LẦN. Trigger `enforce_return_line_cap` chạy
  --   lúc CHÈN DÒNG, và phần "đã trả rồi" của nó chỉ đếm phiếu ở trạng
  --   thái 'completed'. Nên hai phiếu trả của cùng một hóa đơn, cùng nằm
  --   ở 'submitted', mỗi phiếu đều thấy "đã trả = 0" và đều LỌT:
  --     hóa đơn xuất 10 → phiếu A 10 lọt → phiếu B 10 cũng lọt
  --     → hoàn thành cả hai → nhập kho 20 và trừ công nợ gấp đôi.
  --
  -- ⚠ KIỂM Ở ĐÂY, KHÔNG SIẾT TRIGGER. Bắt trigger đếm cả phiếu
  --   'submitted' thì một phiếu lập nhầm rồi bỏ đó sẽ chiếm chỗ và chặn
  --   mất phiếu thật. Chặn đúng lúc hàng THẬT SỰ vào kho là chỗ duy nhất
  --   con số có ý nghĩa.
  --
  -- ⚠ MỐC LÀ HÓA ĐƠN, KHÔNG PHẢI ĐƠN — khách chỉ trả được thứ đã thực
  --   xuất. Đơn đặt 100 mà mới xuất 40 thì trần trả là 40; so với dòng
  --   đơn là cho phép nhập kho 60 món chưa từng rời kho.
  --
  -- ⚠ Dòng ĐỔI không tính — hàng đổi không trừ công nợ. Phiếu trả không
  --   gắn chứng từ nào cũng không: không có mốc để so.
  -- ===================================================================
  IF r.invoice_id IS NOT NULL OR r.order_id IS NOT NULL THEN
    FOR cap IN
      SELECT rl.product_id,
             sum(rl.quantity * COALESCE((
               SELECT pu.conversion FROM product_units pu
                WHERE pu.product_id = rl.product_id
                  AND pu.unit_name = rl.unit_name), 1)) AS need
      FROM return_lines rl
      WHERE rl.return_id = p_return_id AND rl.is_exchange = false
      GROUP BY rl.product_id
    LOOP
      IF r.invoice_id IS NOT NULL THEN
        SELECT COALESCE(sum(sil.quantity * COALESCE(sil.conversion_factor, 1)), 0)
          INTO v_sold
        FROM sales_invoice_lines sil
        WHERE sil.invoice_id = r.invoice_id
          AND sil.is_exchange = false
          AND sil.product_id = cap.product_id;

        SELECT COALESCE(sum(rl2.quantity * COALESCE((
                  SELECT pu.conversion FROM product_units pu
                   WHERE pu.product_id = rl2.product_id
                     AND pu.unit_name = rl2.unit_name), 1)), 0)
          INTO v_returned
        FROM return_lines rl2
        JOIN returns r2 ON r2.id = rl2.return_id
        WHERE r2.invoice_id = r.invoice_id
          AND r2.status = 'completed'
          AND rl2.is_exchange = false
          AND rl2.product_id = cap.product_id;
      ELSE
        -- Phiếu trả cũ chưa gắn hóa đơn: giữ nguyên cách đếm của v2.
        SELECT COALESCE(sum(sol.quantity * COALESCE(sol.conversion_factor, 1)), 0)
          INTO v_sold
        FROM sales_order_lines sol
        WHERE sol.order_id = r.order_id AND sol.product_id = cap.product_id;

        SELECT COALESCE(sum(rl2.quantity * COALESCE((
                  SELECT pu.conversion FROM product_units pu
                   WHERE pu.product_id = rl2.product_id
                     AND pu.unit_name = rl2.unit_name), 1)), 0)
          INTO v_returned
        FROM return_lines rl2
        JOIN returns r2 ON r2.id = rl2.return_id
        WHERE r2.order_id = r.order_id
          AND r2.status = 'completed'
          AND rl2.is_exchange = false
          AND rl2.product_id = cap.product_id;
      END IF;

      IF cap.need + v_returned > v_sold THEN
        SELECT name INTO v_pname FROM products WHERE id = cap.product_id;
        RAISE EXCEPTION
          'RETURN_QTY_EXCEEDS: "%" — đã xuất %, đã hoàn thành trả %, phiếu này thêm % là vượt',
          COALESCE(v_pname, cap.product_id::text), v_sold, v_returned, cap.need
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;

  v_code := 'NL-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS');
  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, notes)
  VALUES (r.org_id, v_code, 'import', 'posted', now(), auth.uid(),
          'Nhập lại từ phiếu trả ' || p_return_id::text)
  RETURNING id INTO v_entry;

  -- Hàng ĐỔI cũng vào kho như hàng trả; khác nhau ở chỗ nó không ghi có
  -- công nợ, và việc đó do credit_note_amount lo (mig 055).
  FOR l IN
    SELECT rl.id, rl.product_id, rl.unit_name, rl.quantity, rl.is_exchange
    FROM return_lines rl WHERE rl.return_id = p_return_id
  LOOP
    CONTINUE WHEN COALESCE(l.quantity, 0) <= 0;

    v_conv := COALESCE((SELECT pu.conversion FROM product_units pu
                         WHERE pu.product_id = l.product_id
                           AND pu.unit_name = l.unit_name), 1);
    IF v_conv <= 0 THEN v_conv := 1; END IF;
    v_base := l.quantity * v_conv;

    -- ⚠ Giá vốn phải theo hàng THẬT. Để 0 thì lần bán sau FIFO ăn vào lô
    --   này với giá vốn 0, lãi gộp báo cao hơn thực đúng bằng giá vốn số
    --   hàng đã trả.
    --
    -- ⚠ ƯU TIÊN PHIẾU XUẤT CỦA CHÍNH HÓA ĐƠN. Đơn xuất hai đợt có thể lấy
    --   từ hai lô giá vốn khác nhau; tra theo đơn là lấy phải giá của đợt
    --   kia. Không có hóa đơn thì rơi về cách cũ (tra theo đơn), rồi tới
    --   lô mới nhất cùng sản phẩm, rồi 0.
    v_cost := COALESCE(
      (SELECT slc.unit_cost
         FROM stock_line_consumptions slc
         JOIN stock_entry_lines sel ON sel.id = slc.line_id
        WHERE sel.product_id = l.product_id
          AND r.invoice_id IS NOT NULL
          AND sel.entry_id = (SELECT si.stock_entry_id FROM sales_invoices si
                               WHERE si.id = r.invoice_id)
        ORDER BY slc.created_at DESC LIMIT 1),
      (SELECT slc.unit_cost
         FROM stock_line_consumptions slc
         JOIN stock_entry_lines sel ON sel.id = slc.line_id
         JOIN stock_entries se ON se.id = sel.entry_id
        WHERE sel.product_id = l.product_id
          AND r.order_id IS NOT NULL
          AND se.ref_order_ids @> jsonb_build_array(r.order_id::text)
        ORDER BY slc.created_at DESC LIMIT 1),
      (SELECT b3.unit_cost FROM batches b3
        WHERE b3.product_id = l.product_id AND COALESCE(b3.unit_cost, 0) > 0
        ORDER BY b3.received_at DESC NULLS LAST LIMIT 1),
      0);

    SELECT b.id INTO v_batch
    FROM batches b
    WHERE b.org_id = r.org_id
      AND b.product_id = l.product_id
      AND b.warehouse_zone = p_zone
      AND COALESCE(b.status, 'available') = 'available'
    ORDER BY b.received_at DESC NULLS LAST, b.created_at DESC
    LIMIT 1;

    IF v_batch IS NULL THEN
      -- Lô mới: hạn dùng lấy từ lô xa nhất cùng sản phẩm; không có thì
      -- suy từ hạn sử dụng của sản phẩm; không có nữa thì một năm.
      SELECT max(b2.expires_at) INTO v_exp FROM batches b2
       WHERE b2.org_id = r.org_id AND b2.product_id = l.product_id;
      IF v_exp IS NULL THEN
        SELECT current_date + COALESCE(p.shelf_life_days, 365) INTO v_exp
        FROM products p WHERE p.id = l.product_id;
      END IF;

      INSERT INTO batches (
        org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand,
        unit_cost, warehouse_zone, received_at
      ) VALUES (
        r.org_id, l.product_id, 'RESTOCK-' || v_code, COALESCE(v_exp, current_date + 365),
        v_base, 0, v_cost, p_zone, now()
      )
      RETURNING id INTO v_batch;

      -- ⚠ batches có trigger tự xếp kho: lô sắp hết hạn bị đẩy sang kho
      --   date dù người dùng chọn kho bán. Ép lại đúng ý người duyệt.
      UPDATE batches SET warehouse_zone = p_zone WHERE id = v_batch;
    END IF;

    UPDATE batches SET qty_on_hand = qty_on_hand + v_base WHERE id = v_batch;

    INSERT INTO stock_entry_lines (
      entry_id, product_id, batch_id, unit_name, quantity,
      qty_in_transaction_uom, qty_in_base_uom, transaction_uom,
      conversion_factor_snapshot, unit_cost, notes
    ) VALUES (
      v_entry, l.product_id, v_batch, l.unit_name, round(l.quantity)::int,
      l.quantity, v_base, l.unit_name, v_conv, v_cost,
      CASE WHEN l.is_exchange THEN 'Hàng đổi thu về' ELSE 'Nhập lại từ đơn trả' END
    );
  END LOOP;

  UPDATE returns
  SET status = 'completed', completed_at = now(),
      completed_by = auth.uid(), destination_zone = p_zone
  WHERE id = p_return_id;

  -- ⚠ TÍNH LẠI THEO HÓA ĐƠN KHI CÓ. Đường qua `_wf2_recompute_receivable`
  --   giữ lại cho phiếu trả chưa gắn hóa đơn — nó tự nhận nuôi khi đơn
  --   chỉ có một hóa đơn, và DỪNG khi có nhiều hơn.
  IF r.invoice_id IS NOT NULL THEN
    PERFORM public._wf2b_recompute_receivable(r.invoice_id);
  ELSIF r.order_id IS NOT NULL THEN
    PERFORM public._wf2_recompute_receivable(r.order_id);
  END IF;

  PERFORM public._wf2_notify(
    r.requested_by, 'return_completed',
    'Phiếu trả đã hoàn thành', NULL, '/returns/' || p_return_id::text);

  RETURN QUERY SELECT v_entry;
END;
$$;


-- =====================================================================
-- 3. cancel_return — đảo phiếu trả đã hoàn thành
-- =====================================================================
--
-- ⚠ KHOÁ "ĐÃ CÓ TIỀN THU" ĐỔI MỐC SANG HÓA ĐƠN. Bản cũ hỏi cả ĐƠN có
--   đồng nào chưa; từ v2b một đơn có nhiều hóa đơn, nên đợt một đã thu
--   tiền sẽ khoá luôn việc huỷ một phiếu trả của đợt hai — hai chứng từ
--   chẳng liên quan gì tới nhau.
CREATE OR REPLACE FUNCTION public.cancel_return(p_return_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r       record;
  v_entry uuid;
  l       record;
  v_rows  int := 0;
  v_paid  boolean;
BEGIN
  SELECT id, org_id, order_id, invoice_id, status, applied_receipt_id INTO r
  FROM returns WHERE id = p_return_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RETURN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF r.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.user_has_permission(auth.uid(), 'returns.approve') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền huỷ đơn trả' USING ERRCODE = 'P0001';
  END IF;

  IF r.status = 'submitted' THEN
    UPDATE returns
    SET status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
    WHERE id = p_return_id;
    RETURN;
  END IF;

  IF r.status <> 'completed' THEN
    RAISE EXCEPTION 'RETURN_NOT_CANCELLABLE: phiếu ở trạng thái % không huỷ được', r.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Khoản có đã cấn vào phiếu thu thì không rút lại được ở đây.
  IF r.applied_receipt_id IS NOT NULL THEN
    RAISE EXCEPTION 'LOCKED_CREDIT_APPLIED: khoản có đã cấn trừ vào phiếu thu'
      USING ERRCODE = 'P0001';
  END IF;

  IF r.invoice_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM receivables rc
      WHERE rc.invoice_id = r.invoice_id AND COALESCE(rc.paid, 0) > 0
    ) INTO v_paid;
    IF v_paid THEN
      RAISE EXCEPTION 'LOCKED_CREDIT_APPLIED: hóa đơn gốc đã có tiền thu'
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF r.order_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM receivables rc
      WHERE rc.order_id = r.order_id AND COALESCE(rc.paid, 0) > 0
    ) INTO v_paid;
    IF v_paid THEN
      RAISE EXCEPTION 'LOCKED_CREDIT_APPLIED: đơn gốc đã có tiền thu'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Đảo đúng những lô đã nhập của chính phiếu trả này.
  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, notes)
  VALUES (r.org_id,
          'XK-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS'),
          'export', 'posted', now(), auth.uid(),
          'Đảo phiếu trả ' || p_return_id::text)
  RETURNING id INTO v_entry;

  FOR l IN
    SELECT sel.product_id, sel.batch_id, sel.unit_name, sel.quantity,
           sel.qty_in_base_uom, sel.conversion_factor_snapshot
    FROM stock_entry_lines sel
    JOIN stock_entries se ON se.id = sel.entry_id
    WHERE se.org_id = r.org_id
      AND se.type = 'import'
      AND se.notes = 'Nhập lại từ phiếu trả ' || p_return_id::text
  LOOP
    IF l.batch_id IS NOT NULL THEN
      UPDATE batches SET qty_on_hand = qty_on_hand - l.qty_in_base_uom WHERE id = l.batch_id;
    END IF;
    INSERT INTO stock_entry_lines (
      entry_id, product_id, batch_id, unit_name, quantity,
      qty_in_transaction_uom, qty_in_base_uom, transaction_uom,
      conversion_factor_snapshot, unit_cost, notes
    ) VALUES (
      v_entry, l.product_id, l.batch_id, l.unit_name, l.quantity,
      l.quantity, l.qty_in_base_uom, l.unit_name,
      COALESCE(l.conversion_factor_snapshot, 1), 0, 'Đảo do huỷ phiếu trả'
    );
    v_rows := v_rows + 1;
  END LOOP;

  -- ⚠ Phiếu trả hoàn thành TRƯỚC mig 120 do trigger cũ nhập kho, ghi chú
  --   khác hẳn nên không khớp được. Im lặng đi tiếp là ghi nợ lại cho
  --   khách trong khi hàng vẫn nằm trong kho. Nói ra và dừng.
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'NO_IMPORT_TO_REVERSE: không tìm được phiếu nhập của phiếu trả này, phải đảo kho bằng tay'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE returns
  SET status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
  WHERE id = p_return_id;

  IF r.invoice_id IS NOT NULL THEN
    PERFORM public._wf2b_recompute_receivable(r.invoice_id);
  ELSIF r.order_id IS NOT NULL THEN
    PERFORM public._wf2_recompute_receivable(r.order_id);
  END IF;
END;
$$;


-- =====================================================================
-- 4. `_wf2_recompute_receivable` thôi làm cầu tạm
-- =====================================================================
--
-- ⚠ KHÔNG GỠ, DÙ PACK ĐỊNH GỠ Ở PHASE NÀY. Sau mục 2 và 3 thì
--   `complete_return` / `cancel_return` đã gọi thẳng bản theo hóa đơn —
--   cầu không còn ai đi qua theo nghĩa cũ. Nhưng phiếu trả CHƯA gắn hóa
--   đơn thì vẫn cần nó: tiền giảm trừ của chúng không thuộc hóa đơn nào,
--   và bản theo hóa đơn không thấy chúng. Gỡ đi là khách trả hàng mà nợ
--   không giảm, im lặng.
--
--   Nên nó đổi VAI: từ "cầu tạm chờ P6" thành "đường cho phiếu trả chưa
--   gắn hóa đơn". Logic giữ nguyên, kể cả việc DỪNG khi đơn có nhiều hơn
--   một hóa đơn — ở ca đó đoán là ghi giảm nợ nhầm chứng từ.
COMMENT ON FUNCTION public._wf2_recompute_receivable(uuid) IS
  'Tính lại công nợ theo ĐƠN. Chỉ dùng cho phiếu trả chưa gắn hóa đơn '
  '(dữ liệu cũ): nhận nuôi khi đơn có đúng một hóa đơn, DỪNG khi có nhiều '
  'hơn. Phiếu trả có invoice_id đi thẳng _wf2b_recompute_receivable.';


NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_orphan int;
  v_multi  int;
  v_crl    int;
BEGIN
  SELECT count(*) INTO v_orphan
  FROM returns
  WHERE invoice_id IS NULL AND order_id IS NOT NULL
    AND status NOT IN ('draft', 'cancelled');

  SELECT count(*) INTO v_multi
  FROM returns r
  WHERE r.invoice_id IS NULL AND r.order_id IS NOT NULL
    AND r.status NOT IN ('draft', 'cancelled')
    AND (SELECT count(*) FROM sales_invoices si
          WHERE si.order_id = r.order_id AND si.status = 'posted') > 1;

  SELECT count(*) INTO v_crl
  FROM cash_receipt_lines WHERE invoice_id IS NOT NULL;

  RAISE NOTICE '--- 127: % phiếu trả chưa gắn hóa đơn · % dòng phiếu thu đã gắn ---', v_orphan, v_crl;
  IF v_multi > 0 THEN
    RAISE NOTICE '--- 127 ⚠ % phiếu trả trong số đó thuộc đơn có NHIỀU hóa đơn. Chúng sẽ DỪNG với RETURN_NEEDS_INVOICE khi tính lại công nợ — gắn tay `returns.invoice_id` cho chúng trước khi dùng tiếp. ---', v_multi;
  END IF;
END $$;


-- ####################################################################
-- # 128_invoice_code_no_date.sql
-- ####################################################################

-- ====================================================================
-- 128 — Số hóa đơn bỏ ngày tháng: HD-0001, bản lập lại thêm -1, -2, …
-- ====================================================================
--
-- VÌ SAO
--   Mẫu cũ `HD-YYMMDD-NNNN` (mig 125) đếm lại từ 1 MỖI NGÀY, nên số hóa
--   đơn không nói được "đây là tờ thứ mấy của nhà phân phối". Chủ NPP
--   chốt: chỉ cần `HD-xxxx` chạy liên tục, và bản lập lại thì gắn thêm
--   `-n` vào chính số đó — nhìn một cái là biết hai tờ cùng một gốc.
--
--       HD-0042      tờ gốc
--       HD-0042-1    sửa lần 1
--       HD-0042-2    sửa lần 2
--
-- ⚠ KHÔNG SUY SỐ CHẠY TỪ CHÍNH CHUỖI MÃ. Cách "lấy max của phần số
--   trong invoice_code rồi +1" nghe gọn nhưng hỏng ngay: mã cũ
--   `HD-260918-0001` đọc ra 260918, và bộ đếm nhảy lên 260919 — mọi hóa
--   đơn sau đó mang số vô nghĩa, không cách nào lùi lại. Thêm hai cột
--   thật để đếm, và chuỗi mã chỉ còn là thứ SINH RA từ chúng.
--
-- ⚠ ĐÁNH SỐ LẠI TOÀN BỘ HÓA ĐƠN CŨ — chủ nhà quyết, không phải mặc định
--   của migration. Lý do chấp nhận được: NPP đang ở đợt đầu, mấy số cũ
--   do backfill mig 124 tự sinh hôm qua chứ chưa phải số đã phát cho
--   khách. Nếu sau này có ai chạy lại file này trên một cơ sở dữ liệu đã
--   phát hành thật thì ĐỪNG — khối mục 3 sẽ báo và dừng.
--
-- ⚠ THỨ TỰ ĐÁNH LẠI LÀ NGÀY XUẤT, KHÔNG PHẢI `created_at`. Hóa đơn
--   backfill mang `invoice_date` của đơn gốc nhưng `created_at` là lúc
--   chạy migration — xếp theo `created_at` thì cả sổ cũ dồn thành một
--   cục theo thứ tự ngẫu nhiên.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. Hai cột đếm
-- --------------------------------------------------------------------
-- `invoice_seq`   — số chạy của tờ GỐC, trong phạm vi một tổ chức.
-- `reissue_no`    — 0 với tờ gốc, n với lần sửa thứ n. Bản lập lại DÙNG
--                   LẠI `invoice_seq` của tờ nó thay thế.
ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS invoice_seq int,
  ADD COLUMN IF NOT EXISTS reissue_no  int NOT NULL DEFAULT 0;

COMMENT ON COLUMN sales_invoices.invoice_seq IS
  'Số chạy của tờ gốc trong phạm vi tổ chức. Bản lập lại dùng lại số của '
  'tờ nó thay thế, và phân biệt bằng reissue_no.';
COMMENT ON COLUMN sales_invoices.reissue_no IS
  '0 = tờ gốc. n = lần sửa thứ n, mã có đuôi -n.';


-- --------------------------------------------------------------------
-- 2. Hàm dựng mã từ hai cột
-- --------------------------------------------------------------------
-- ⚠ MỘT CHỖ DỰNG MÃ. Ghép chuỗi ở nhiều nơi là một ngày nào đó hai nơi
--   ghép khác nhau, và hai tờ giấy cùng một hóa đơn in ra hai số.
CREATE OR REPLACE FUNCTION public._inv_code(p_seq int, p_reissue int)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT 'HD-' || lpad(COALESCE(p_seq, 0)::text, 4, '0')
         || CASE WHEN COALESCE(p_reissue, 0) > 0
                 THEN '-' || p_reissue::text ELSE '' END;
$$;


-- --------------------------------------------------------------------
-- 3. Đánh số lại toàn bộ hóa đơn cũ
-- --------------------------------------------------------------------
DO $$
DECLARE
  v_eiv  int;
  v_n    int;
BEGIN
  -- ⚠ DỪNG NẾU ĐÃ CÓ HÓA ĐƠN ĐIỆN TỬ PHÁT HÀNH. Số trên tờ đã gửi cơ
  --   quan thuế không được đổi — đổi là sổ của mình và sổ của thuế nói
  --   hai số khác nhau cho cùng một giao dịch.
  SELECT count(*) INTO v_eiv
  FROM invoices i
  WHERE i.sales_invoice_id IS NOT NULL AND i.misa_inv_no IS NOT NULL;

  IF v_eiv > 0 THEN
    RAISE EXCEPTION
      'INV_CODE_ISSUED: % hóa đơn điện tử đã phát hành — không đánh số lại được. Bỏ mục 3 của migration 128 và chỉ áp mẫu mới cho hóa đơn lập từ nay.',
      v_eiv USING ERRCODE = 'P0001';
  END IF;

  -- Tờ GỐC: đánh số chạy theo ngày xuất, trong phạm vi tổ chức.
  --
  -- ⚠ "TỜ GỐC" = `replaced_from IS NULL`. Không phải `status='posted'`:
  --   một tờ gốc bị huỷ thẳng (không lập lại) vẫn phải giữ số của nó,
  --   nếu không thì mọi tờ sau nó tụt một số và sổ thủng một lỗ.
  WITH g AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY org_id
             ORDER BY invoice_date, created_at, id
           ) AS n
    FROM sales_invoices
    WHERE replaced_from IS NULL
  )
  UPDATE sales_invoices si
  SET invoice_seq = g.n, reissue_no = 0
  FROM g WHERE g.id = si.id;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '--- 128: % tờ gốc được đánh số lại ---', v_n;

  -- Bản lập lại: đi theo chuỗi `replaced_from` về tới tờ gốc.
  --
  -- ⚠ ĐỆ QUY, KHÔNG PHẢI MỘT PHÉP NỐI. Sửa lần 2 trỏ về bản sửa lần 1,
  --   chứ không trỏ thẳng về tờ gốc — nối một tầng là bản thứ hai không
  --   tra ra số gốc và nằm lại với `invoice_seq` rỗng.
  WITH RECURSIVE chain AS (
    SELECT si.id, si.replaced_from, si.invoice_seq AS root_seq, 0 AS depth
    FROM sales_invoices si
    WHERE si.replaced_from IS NULL

    UNION ALL

    SELECT c2.id, c2.replaced_from, chain.root_seq, chain.depth + 1
    FROM sales_invoices c2
    JOIN chain ON c2.replaced_from = chain.id
  )
  UPDATE sales_invoices si
  SET invoice_seq = chain.root_seq, reissue_no = chain.depth
  FROM chain
  WHERE chain.id = si.id AND chain.depth > 0;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '--- 128: % bản lập lại được gắn vào số gốc ---', v_n;

  -- ⚠ CÒN SÓT DÒNG NÀO LÀ DỪNG. `invoice_seq` rỗng nghĩa là có một hóa
  --   đơn không nằm trong chuỗi nào — dây `replaced_from` đứt ở đâu đó.
  --   Để nó đi tiếp là sinh mã `HD-0000` trùng nhau hàng loạt.
  SELECT count(*) INTO v_n FROM sales_invoices WHERE invoice_seq IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'INV_CODE_ORPHAN: % hóa đơn không tra được số gốc (dây replaced_from đứt). Sửa tay trước khi chạy tiếp.',
      v_n USING ERRCODE = 'P0001';
  END IF;

  UPDATE sales_invoices
  SET invoice_code = public._inv_code(invoice_seq, reissue_no);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '--- 128: % hóa đơn mang mã mới ---', v_n;
END $$;

ALTER TABLE sales_invoices ALTER COLUMN invoice_seq SET NOT NULL;

-- ⚠ CHẶN TRÙNG Ở TẦNG CƠ SỞ DỮ LIỆU, không chỉ trông vào hàm cấp số.
--   Hai người bấm Xuất hàng cùng lúc mà khoá tư vấn hỏng thì chỉ mục này
--   là thứ cuối cùng giữ cho sổ không có hai tờ cùng số.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_invoices_seq
  ON sales_invoices(org_id, invoice_seq, reissue_no);


-- --------------------------------------------------------------------
-- 4. Cấp số cho hóa đơn mới
-- --------------------------------------------------------------------
-- ⚠ KHOÁ TRƯỚC KHI ĐẾM, và khoá theo TỔ CHỨC (mẫu cũ khoá theo tổ chức +
--   ngày, giờ không còn ngày trong mã nữa). Hai người bấm cùng lúc thì
--   cả hai đọc ra cùng một số, một giao dịch vỡ vì chỉ mục duy nhất —
--   không sai sổ, nhưng người thứ hai nhận một lỗi lạ hoắc.
--
-- ⚠ `max + 1`, KHÔNG PHẢI `count + 1`. Đếm thì một tờ bị xoá tay là số
--   tiếp theo trùng với một tờ đang sống.
CREATE OR REPLACE FUNCTION public._wf2b_next_invoice_seq(p_org uuid)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_org::text));
  SELECT COALESCE(max(invoice_seq), 0) + 1 INTO v_n
  FROM sales_invoices WHERE org_id = p_org;
  RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._wf2b_next_invoice_seq(uuid) FROM PUBLIC;

-- Hàm cũ không còn ai gọi sau khi mục 5 thay `post_invoice`.
DROP FUNCTION IF EXISTS public._wf2b_next_invoice_code(uuid, date);


-- --------------------------------------------------------------------
-- 5. `post_invoice` — nhận thêm `reissue_of` để giữ số gốc
-- --------------------------------------------------------------------
-- ⚠ VÁ ĐÚNG NHỮNG CÂU CẦN VÁ TRONG THÂN HÀM ĐANG CHẠY, không chép lại cả
--   400 dòng. Chép lại là dựng một bản sao thứ hai mà không ai đối chiếu
--   được với bản gốc; vá thì nếu câu cần vá không còn đúng hình dạng,
--   khối này DỪNG thay vì âm thầm để nguyên.
DO $$
DECLARE
  v_src  text;
  v_oid  oid;
  v_n    int;
  v_from text;
  v_to   text;
BEGIN
  SELECT count(*) INTO v_n
  FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
  WHERE ns.nspname = 'public' AND pr.proname = 'post_invoice' AND pr.prokind = 'f';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'INV_CODE_NO_FN: tìm thấy % bản post_invoice, cần đúng 1', v_n
      USING ERRCODE = 'P0001';
  END IF;

  SELECT pr.oid INTO v_oid
  FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
  WHERE ns.nspname = 'public' AND pr.proname = 'post_invoice' AND pr.prokind = 'f';
  v_src := pg_get_functiondef(v_oid);

  -- 5.1 Khai thêm hai biến.
  v_from := '  v_status    text;';
  v_to   := '  v_status    text;' || E'\n' ||
            '  v_seq       int;' || E'\n' ||
            '  v_reissue   int := 0;';
  IF position(v_from IN v_src) = 0 THEN
    RAISE EXCEPTION 'INV_CODE_SHAPE: không tìm thấy khai báo v_status trong post_invoice'
      USING ERRCODE = 'P0001';
  END IF;
  v_src := replace(v_src, v_from, v_to);

  -- 5.2 Thay chỗ cấp mã.
  --
  -- ⚠ CÓ `reissue_of` THÌ DÙNG LẠI SỐ CỦA TỜ CŨ và tăng đuôi. Cấp số mới
  --   cho một bản sửa là mất hẳn mối liên hệ giữa hai tờ — người tra sổ
  --   nhìn HD-0042 và HD-0087 không thể biết tờ sau thay tờ trước.
  v_from := '  v_code := public._wf2b_next_invoice_code(o.org_id, v_date);';
  v_to := ''
    || '  IF (p->>''reissue_of'') IS NOT NULL THEN' || E'\n'
    || '    SELECT si0.invoice_seq, si0.reissue_no + 1 INTO v_seq, v_reissue' || E'\n'
    || '    FROM sales_invoices si0 WHERE si0.id = (p->>''reissue_of'')::uuid;' || E'\n'
    || '    IF v_seq IS NULL THEN' || E'\n'
    || '      RAISE EXCEPTION ''INVOICE_NOT_FOUND'' USING ERRCODE = ''P0001'';' || E'\n'
    || '    END IF;' || E'\n'
    || '  ELSE' || E'\n'
    || '    v_seq := public._wf2b_next_invoice_seq(o.org_id);' || E'\n'
    || '    v_reissue := 0;' || E'\n'
    || '  END IF;' || E'\n'
    || '  v_code := public._inv_code(v_seq, v_reissue);';
  IF position(v_from IN v_src) = 0 THEN
    RAISE EXCEPTION 'INV_CODE_SHAPE: không tìm thấy chỗ cấp mã trong post_invoice'
      USING ERRCODE = 'P0001';
  END IF;
  v_src := replace(v_src, v_from, v_to);

  -- 5.3 Ghi hai cột đếm vào dòng hóa đơn.
  v_from := '    org_id, invoice_code, order_id, customer_id, sales_user_id,';
  v_to   := '    org_id, invoice_code, invoice_seq, reissue_no, order_id, customer_id, sales_user_id,';
  IF position(v_from IN v_src) = 0 THEN
    RAISE EXCEPTION 'INV_CODE_SHAPE: không tìm thấy danh sách cột của INSERT sales_invoices'
      USING ERRCODE = 'P0001';
  END IF;
  v_src := replace(v_src, v_from, v_to);

  v_from := '    o.org_id, v_code, v_order, o.customer_id, o.sales_user_id,';
  v_to   := '    o.org_id, v_code, v_seq, v_reissue, v_order, o.customer_id, o.sales_user_id,';
  IF position(v_from IN v_src) = 0 THEN
    RAISE EXCEPTION 'INV_CODE_SHAPE: không tìm thấy danh sách giá trị của INSERT sales_invoices'
      USING ERRCODE = 'P0001';
  END IF;
  v_src := replace(v_src, v_from, v_to);

  EXECUTE v_src;
  RAISE NOTICE '--- 128: post_invoice đã chuyển sang mã HD-xxxx ---';
END $$;


-- --------------------------------------------------------------------
-- 6. `reissue_invoice` — truyền `reissue_of` xuống
-- --------------------------------------------------------------------
DO $$
DECLARE
  v_src  text;
  v_oid  oid;
  v_n    int;
  v_from text;
  v_to   text;
BEGIN
  SELECT count(*) INTO v_n
  FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
  WHERE ns.nspname = 'public' AND pr.proname = 'reissue_invoice' AND pr.prokind = 'f';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'INV_CODE_NO_FN: tìm thấy % bản reissue_invoice, cần đúng 1', v_n
      USING ERRCODE = 'P0001';
  END IF;

  SELECT pr.oid INTO v_oid
  FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
  WHERE ns.nspname = 'public' AND pr.proname = 'reissue_invoice' AND pr.prokind = 'f';
  v_src := pg_get_functiondef(v_oid);

  -- ⚠ GẮN `reissue_of` VÀO TẢI TRỌNG, ngay cạnh chỗ gắn `order_id` — một
  --   câu, cùng một kiểu, để người đọc sau thấy hai thứ đi cùng nhau.
  v_from := '  v_payload := jsonb_set(COALESCE(p, ''{}''::jsonb), ''{order_id}'','
            || E'\n' || '                         to_jsonb(v_old.order_id::text));';
  v_to := ''
    || '  v_payload := jsonb_set(COALESCE(p, ''{}''::jsonb), ''{order_id}'',' || E'\n'
    || '                         to_jsonb(v_old.order_id::text));' || E'\n'
    || '  v_payload := jsonb_set(v_payload, ''{reissue_of}'',' || E'\n'
    || '                         to_jsonb(p_invoice_id::text));';
  IF position(v_from IN v_src) = 0 THEN
    RAISE EXCEPTION 'INV_CODE_SHAPE: không tìm thấy chỗ dựng tải trọng trong reissue_invoice'
      USING ERRCODE = 'P0001';
  END IF;
  v_src := replace(v_src, v_from, v_to);

  -- ------------------------------------------------------------------
  -- 6.2 SỬA LUÔN MỘT LỖI CÓ SẴN TỪ MIG 125 — `reissue_invoice` chưa từng
  --     chạy được.
  --
  -- `RETURNS TABLE (invoice_id uuid, …)` biến `invoice_id` thành một BIẾN
  -- của hàm. Câu dưới đây hỏi bảng `returns` bằng đúng cái tên ấy mà
  -- không gắn bí danh, nên Postgres không biết nên hiểu là biến hay cột:
  --
  --     ERROR: column reference "invoice_id" is ambiguous
  --
  -- ⚠ HÀM TẠO RA VẪN SẠCH, lỗi chỉ nổ lúc CHẠY tới câu đó. Nên cả mig
  --   125 lẫn mọi chốt cấu trúc đều xanh, còn nút "Sửa hóa đơn" thì hỏng
  --   ngay lần bấm đầu tiên. Tìm ra bằng cách chạy thật trên Postgres,
  --   không phải bằng đọc mã.
  --
  -- ⚠ GẮN BÍ DANH, KHÔNG ĐỔI TÊN CỘT TRẢ VỀ. Đổi tên cột trả về là đổi
  --   hợp đồng của RPC, và mã ứng dụng đang đọc `invoice_id`.
  v_from := '  SELECT COALESCE(array_agg(id), ''{}'') INTO v_rets' || E'\n'
            || '  FROM returns' || E'\n'
            || '  WHERE invoice_id = p_invoice_id AND status IN (''draft'', ''submitted'');';
  v_to   := '  SELECT COALESCE(array_agg(rr.id), ''{}'') INTO v_rets' || E'\n'
            || '  FROM returns rr' || E'\n'
            || '  WHERE rr.invoice_id = p_invoice_id AND rr.status IN (''draft'', ''submitted'');';
  IF position(v_from IN v_src) = 0 THEN
    RAISE EXCEPTION 'INV_CODE_SHAPE: không tìm thấy câu gom phiếu trả trong reissue_invoice'
      USING ERRCODE = 'P0001';
  END IF;
  v_src := replace(v_src, v_from, v_to);

  EXECUTE v_src;
  RAISE NOTICE '--- 128: reissue_invoice giữ số gốc, chỉ tăng đuôi (và hết nhập nhằng invoice_id) ---';
END $$;


NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_bad int;
  v_max int;
BEGIN
  -- Còn mã nào mang ngày tháng không.
  SELECT count(*) INTO v_bad FROM sales_invoices
  WHERE invoice_code !~ '^HD-[0-9]{4,}(-[0-9]+)?$';
  SELECT COALESCE(max(invoice_seq), 0) INTO v_max FROM sales_invoices;
  RAISE NOTICE '--- 128: % mã chưa đúng mẫu · số chạy đang ở % ---', v_bad, v_max;
END $$;


-- ####################################################################
-- # 129_order_delete_sweeps_returns.sql
-- ####################################################################

-- ====================================================================
-- 129 — Xoá đơn đã huỷ: vét HẾT phiếu trả chưa hoàn thành, và nếu vẫn
--        còn vướng thì nói ra bằng tiếng người
-- ====================================================================
--
-- TRIỆU CHỨNG (chủ NPP báo kèm ảnh): bấm "Xoá đơn hàng" trên một đơn ĐÃ
-- HUỶ → vẫn nhận
--
--     update or delete on table "sales_orders" violates foreign key
--     constraint "returns_order_id_fkey" on table "returns"  (mã 23503)
--
-- Đúng thứ mà migration 118 sinh ra để dập.
--
-- NGUYÊN NHÂN
--   Trigger của 118 dọn phiếu trả bằng một DANH SÁCH LIỆT KÊ:
--
--       DELETE FROM returns
--       WHERE order_id = OLD.id AND status IN ('draft','submitted','cancelled');
--
--   Danh sách ấy đúng với đúng bốn trạng thái mà `chk_returns_status_v2`
--   cho phép lúc 119 vừa chạy. Nhưng một phiếu mang bất kỳ giá trị nào
--   KHÁC — dữ liệu cũ mà backfill 119 không với tới, hoặc một trạng thái
--   thêm về sau — thì rơi vào đúng kẽ hở: nhánh chặn không thấy nó (chỉ
--   hỏi 'completed'), nhánh dọn cũng không thấy nó. Không ai chặn, không
--   ai dọn, và khoá ngoại nổ kèm một câu tiếng Anh.
--
-- ⚠ LIỆT KÊ CÁI ĐƯỢC PHÉP, ĐỪNG LIỆT KÊ CÁI PHẢI DỌN. Ý định của 118 vốn
--   đã viết rõ ngay trong chú thích của nó: "Chỉ phiếu 'completed' mới
--   đụng tồn kho và công nợ, nên chỉ nó mới chặn." Vậy thì phép dọn phải
--   là PHẦN BÙ của 'completed', không phải một danh sách chép tay — chép
--   tay thì mỗi lần thêm một trạng thái là mở lại đúng kẽ hở này.
--
-- ⚠ VÀ VẪN PHẢI CÓ CHỐT CUỐI. Dọn xong mà còn dòng nào trỏ vào đơn thì
--   ĐẾM và nói ra tên phiếu, thay vì thả cho khoá ngoại ném ra một câu
--   không ai đọc được. Một thông báo nói "còn phiếu TH-xxxx" thì người
--   dùng đi xử lý được; câu "violates foreign key constraint" thì không.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.trg_sales_orders_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_posted  int;
  v_pending int;
  v_left    int;
  v_names   text;
BEGIN
  -- ⚠ PHIẾU TRẢ ĐÃ HOÀN THÀNH LÀ CHỨNG TỪ. Nó đã trừ công nợ
  --   (credited_at) và kho đã nhận hàng lại. Không xoá theo, không gỡ
  --   liên kết (gỡ là phiếu mất dấu vết "trả cho đơn nào") — CHẶN, và
  --   nói thẳng vì sao.
  SELECT count(*) INTO v_posted
  FROM returns
  WHERE order_id = OLD.id AND status = 'completed';

  IF v_posted > 0 THEN
    RAISE EXCEPTION
      'Đơn % có % phiếu trả hàng ĐÃ HOÀN THÀNH (đã trừ công nợ / nhập lại kho) nên không xoá được. Huỷ phiếu trả đó trước, hoặc giữ đơn.',
      OLD.order_code, v_posted
      USING ERRCODE = 'P0001', HINT = 'returns.order_id';
  END IF;

  -- ⚠ PHẦN BÙ CỦA 'completed', KHÔNG PHẢI DANH SÁCH CHÉP TAY. Xem khối
  --   chú thích đầu file: liệt kê ba trạng thái là để hở đúng những
  --   phiếu mang giá trị ngoài danh sách.
  --
  -- ⚠ `IS DISTINCT FROM` chứ không phải `<>`: `NULL <> 'completed'` ra
  --   NULL, tức không khớp — một phiếu status rỗng sẽ lại lọt qua đúng
  --   như cũ.
  DELETE FROM returns
  WHERE order_id = OLD.id AND status IS DISTINCT FROM 'completed';
  GET DIAGNOSTICS v_pending = ROW_COUNT;

  UPDATE visit_logs SET order_id = NULL WHERE order_id = OLD.id;

  -- ⚠ CHỐT CUỐI. Tới đây mà còn dòng nào trỏ vào đơn thì có gì đó ngoài
  --   dự tính — nói ra tên phiếu thay vì thả cho khoá ngoại ném ra một
  --   câu tiếng Anh mà chủ NPP không làm gì được với nó.
  -- ⚠ BẢNG `returns` KHÔNG CÓ CỘT MÃ PHIẾU. Bản đầu của khối này hỏi
  --   `return_code` — một cột không tồn tại — nên trigger nổ ngay lần
  --   xoá đầu tiên, và lỗi mới còn khó hiểu hơn lỗi cũ. Nêu ngày trả và
  --   lý do: đó là hai thứ người dùng nhận ra phiếu bằng.
  SELECT count(*),
         string_agg(
           to_char(COALESCE(r2.created_at, now()), 'DD/MM/YYYY')
           || COALESCE(' · ' || r2.reason, ''), ', ')
    INTO v_left, v_names
  FROM returns r2 WHERE r2.order_id = OLD.id;

  IF v_left > 0 THEN
    RAISE EXCEPTION
      'Đơn % còn % phiếu trả hàng đang trỏ vào nó (%) nên chưa xoá được. Mở từng phiếu, huỷ hoặc gỡ khỏi đơn, rồi xoá lại.',
      OLD.order_code, v_left, v_names
      USING ERRCODE = 'P0001', HINT = 'returns.order_id';
  END IF;

  IF v_pending > 0 THEN
    RAISE NOTICE 'Xoá đơn %: đã bỏ % phiếu trả chưa hoàn thành đi kèm', OLD.order_code, v_pending;
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_sales_orders_before_delete() FROM PUBLIC;

COMMENT ON FUNCTION public.trg_sales_orders_before_delete() IS
  'Xoá đơn nháp/huỷ: bỏ MỌI phiếu trả chưa hoàn thành đi kèm (phần bù của '
  'completed, không phải danh sách liệt kê); chặn rõ lời nếu có phiếu trả '
  'đã hoàn thành; gỡ order_id khỏi visit_logs; và nếu vẫn còn dòng trỏ vào '
  'đơn thì nêu tên phiếu thay vì để khoá ngoại ném lỗi 23503.';

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE v_n int;
BEGIN
  -- Phiếu trả mang trạng thái NGOÀI bốn giá trị của v2 — chính là những
  -- phiếu từng lọt qua cả hai nhánh của trigger cũ.
  SELECT count(*) INTO v_n
  FROM returns
  WHERE status IS NULL
     OR status NOT IN ('draft', 'submitted', 'completed', 'cancelled');
  RAISE NOTICE '--- 129: % phiếu trả mang trạng thái ngoài bốn giá trị v2 (đây là những phiếu từng làm kẹt việc xoá đơn) ---', v_n;
END $$;


-- ####################################################################
-- # 130_order_code_no_date.sql
-- ####################################################################

-- ====================================================================
-- 130 — Số đơn hàng bỏ ngày tháng: DH-0001, sửa lần n thì thêm -n
-- ====================================================================
--
-- VÌ SAO
--   Mã cũ `SO-YYYYMMDD-RAND` do TRÌNH DUYỆT sinh ra, với bốn chữ số
--   NGẪU NHIÊN (`generateOrderCode` trong src/lib/utils.ts). Hai chuyện
--   hỏng:
--     · Số không nói được "đây là đơn thứ mấy". Chủ NPP chốt: `DH-xxxx`
--       chạy liên tục, và sửa lần n thì thêm `-n` vào chính số đó.
--     · `order_code` là UNIQUE TOÀN BẢNG. Bốn chữ số ngẫu nhiên trong
--       một ngày là xác suất đụng nhau có thật — và lúc đụng thì người
--       bán hàng nhận một lỗi unique giữa lúc đang đứng ở cửa hàng.
--
--   Cấp số chuyển hẳn xuống cơ sở dữ liệu: một chỗ cấp, có khoá, có
--   chỉ mục duy nhất đỡ phía sau.
--
-- ⚠ MÃ ĐỔI TẠI CHỖ MỖI LẦN SỬA — chủ nhà chọn, và đây là chỗ nó KHÁC
--   hóa đơn. Hóa đơn lập lại sinh MỘT DÒNG MỚI nên tra sổ vẫn thấy cả
--   hai tờ; đơn thì sửa đè lên chính nó, nên `DH-0042` biến mất khỏi mọi
--   chứng từ đã in trước đó và chỉ còn `DH-0042-1`. Chủ nhà đã được báo
--   và vẫn chọn phương án này.
--
-- ⚠ ĐÁNH SỐ LẠI TOÀN BỘ ĐƠN CŨ, thứ tự theo NGÀY ĐẶT. Xếp theo
--   `created_at` thì đơn nhập bù ngày cũ chen vào giữa sổ.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. Hai cột đếm
-- --------------------------------------------------------------------
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS order_seq int,
  ADD COLUMN IF NOT EXISTS edit_no   int NOT NULL DEFAULT 0;

COMMENT ON COLUMN sales_orders.order_seq IS
  'Số chạy của đơn trong phạm vi tổ chức. Không đổi khi sửa đơn.';
COMMENT ON COLUMN sales_orders.edit_no IS
  '0 = bản đầu. n = đã sửa n lần, mã có đuôi -n.';


-- --------------------------------------------------------------------
-- 2. Hàm dựng mã
-- --------------------------------------------------------------------
-- ⚠ MỘT CHỖ DỰNG MÃ, y như `_inv_code` của mig 128.
CREATE OR REPLACE FUNCTION public._order_code(p_seq int, p_edit int)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT 'DH-' || lpad(COALESCE(p_seq, 0)::text, 4, '0')
         || CASE WHEN COALESCE(p_edit, 0) > 0
                 THEN '-' || p_edit::text ELSE '' END;
$$;


-- --------------------------------------------------------------------
-- 3. Đánh số lại toàn bộ đơn cũ
-- --------------------------------------------------------------------
DO $$
DECLARE v_n int;
BEGIN
  -- ⚠ ÉP KIỂU `::int`. `row_number()` trả BIGINT, và Postgres KHÔNG tự
  --   ép bigint sang int khi chọn hàm — `_order_code(bigint, integer)
  --   does not exist`. Migration chết ngay câu đầu tiên.
  WITH g AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY org_id
             ORDER BY order_date, created_at, id
           )::int AS n
    FROM sales_orders
  )
  UPDATE sales_orders so
  SET order_seq = g.n, edit_no = 0, order_code = public._order_code(g.n, 0)
  FROM g WHERE g.id = so.id;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '--- 130: % đơn được đánh số lại ---', v_n;

  SELECT count(*) INTO v_n FROM sales_orders WHERE order_seq IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ORDER_CODE_ORPHAN: còn % đơn chưa có số chạy', v_n
      USING ERRCODE = 'P0001';
  END IF;
END $$;

ALTER TABLE sales_orders ALTER COLUMN order_seq SET NOT NULL;

-- ⚠ CHẶN TRÙNG Ở TẦNG CƠ SỞ DỮ LIỆU. `order_code` vốn đã UNIQUE; thêm
--   chỉ mục trên (tổ chức, số chạy) để hai đơn không bao giờ mang cùng
--   một số ngay cả khi ai đó ghi tay `order_code`.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_orders_seq
  ON sales_orders(org_id, order_seq);


-- --------------------------------------------------------------------
-- 4. Cấp số cho đơn mới
-- --------------------------------------------------------------------
-- ⚠ KHOÁ TRƯỚC KHI ĐẾM, và `max + 1` chứ không `count + 1`: đếm thì một
--   đơn bị xoá là số tiếp theo trùng với một đơn đang sống.
CREATE OR REPLACE FUNCTION public._next_order_seq(p_org uuid)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('order_seq:' || p_org::text));
  SELECT COALESCE(max(order_seq), 0) + 1 INTO v_n
  FROM sales_orders WHERE org_id = p_org;
  RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._next_order_seq(uuid) FROM PUBLIC;


-- --------------------------------------------------------------------
-- 5. Đơn mới: cơ sở dữ liệu cấp số, KHÔNG phải trình duyệt
-- --------------------------------------------------------------------
-- ⚠ GHI ĐÈ MÃ TRÌNH DUYỆT GỬI LÊN. Màn bán hàng vẫn gửi một
--   `order_code` (nó cần một mã để xếp hàng ngoại tuyến), nhưng mã ấy
--   không còn là mã thật. Trình duyệt phải ĐỌC LẠI mã sau khi ghi —
--   `createOrderFromPayload` đã sửa để `.select("id, order_code")`.
--
-- ⚠ ĐỌC `org_id` TỪ CHÍNH DÒNG ĐANG CHÈN. Gọi `user_org_id()` ở đây là
--   sai với mọi đường ghi không đi qua phiên người dùng (nhập liệu, đồng
--   bộ, migration) — và sai lặng lẽ, vì nó trả NULL chứ không ném lỗi.
CREATE OR REPLACE FUNCTION public.trg_sales_orders_assign_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.order_seq  := public._next_order_seq(NEW.org_id);
  NEW.edit_no    := 0;
  NEW.order_code := public._order_code(NEW.order_seq, 0);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_sales_orders_assign_code() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_sales_orders_assign_code ON sales_orders;
CREATE TRIGGER trg_sales_orders_assign_code
  BEFORE INSERT ON sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_sales_orders_assign_code();


-- --------------------------------------------------------------------
-- 6. Sửa đơn: tăng đuôi
-- --------------------------------------------------------------------
-- ⚠ BÁM VÀO LẦN GHI ĐẦU ĐƠN, KHÔNG BÁM VÀO TỪNG DÒNG HÀNG. Một lần sửa
--   thường xoá hết dòng cũ rồi chèn dòng mới — bám vào `sales_order_lines`
--   thì một lần sửa đếm thành nhiều lần, và `DH-0042` nhảy thẳng lên
--   `DH-0042-7`. Màn sửa đơn ghi đầu đơn đúng MỘT lệnh (order-edit.ts),
--   nên đó mới là chỗ đếm.
--
-- ⚠ CHỈ ĐẾM KHI NỘI DUNG THẬT SỰ ĐỔI. Duyệt đơn, huỷ đơn, xuất hàng đều
--   ghi vào `sales_orders` nhưng chỉ đụng `status` / `approval_reason` —
--   kể chúng là mỗi lần bấm Xuất hàng lại đổi số đơn, và tài xế cầm
--   phiếu in ra không tra được đơn nào cả.
--
-- ⚠ `IS DISTINCT FROM`, KHÔNG PHẢI `<>`. Một cột từ NULL thành có giá
--   trị là một thay đổi thật, mà `NULL <> 'x'` ra NULL nên không khớp.
CREATE OR REPLACE FUNCTION public.trg_sales_orders_bump_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.customer_id        IS DISTINCT FROM OLD.customer_id
     OR NEW.payment_terms   IS DISTINCT FROM OLD.payment_terms
     OR NEW.expected_delivery IS DISTINCT FROM OLD.expected_delivery
     OR NEW.subtotal        IS DISTINCT FROM OLD.subtotal
     OR NEW.vat             IS DISTINCT FROM OLD.vat
     OR NEW.total           IS DISTINCT FROM OLD.total
     OR NEW.discount        IS DISTINCT FROM OLD.discount
     OR NEW.notes           IS DISTINCT FROM OLD.notes
  THEN
    NEW.edit_no    := COALESCE(OLD.edit_no, 0) + 1;
    NEW.order_code := public._order_code(OLD.order_seq, NEW.edit_no);
  ELSE
    -- ⚠ GIỮ NGUYÊN, đừng để ai ghi đè mã bằng tay qua PostgREST.
    NEW.edit_no    := OLD.edit_no;
    NEW.order_code := OLD.order_code;
  END IF;
  NEW.order_seq := OLD.order_seq;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_sales_orders_bump_edit() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_sales_orders_bump_edit ON sales_orders;
CREATE TRIGGER trg_sales_orders_bump_edit
  BEFORE UPDATE ON sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_sales_orders_bump_edit();


NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_bad int;
  v_max int;
BEGIN
  SELECT count(*) INTO v_bad FROM sales_orders
  WHERE order_code !~ '^DH-[0-9]{4,}(-[0-9]+)?$';
  SELECT COALESCE(max(order_seq), 0) INTO v_max FROM sales_orders;
  RAISE NOTICE '--- 130: % mã chưa đúng mẫu · số chạy đang ở % ---', v_bad, v_max;
END $$;


-- ####################################################################
-- # 131_cancel_invoice_keeps_returns.sql
-- ####################################################################

-- =====================================================================
-- 131 — HUỶ HÓA ĐƠN THÌ GỠ PHIẾU TRẢ RA, KHÔNG HUỶ NÓ THEO
-- =====================================================================
--
-- VÌ SAO
--   Chủ nhà báo: tạo hóa đơn từ một đơn có hàng trả / hàng đổi, rồi huỷ
--   hóa đơn — phần đổi trả hàng trên màn chi tiết đơn bị gắn chữ "Đã
--   huỷ".
--
--   Đúng là code đang làm vậy. `cancel_invoice` (mig 125) kết bằng:
--
--       UPDATE returns
--       SET status = 'cancelled', …
--       WHERE invoice_id = p_invoice_id AND status IN ('draft','submitted');
--
--   với lý do ghi trong chú thích: "Phiếu trả đang chờ xử lý của hóa đơn
--   này mất chỗ bám."
--
-- ⚠ LÝ DO ẤY SAI VỚI PHIẾU TRẢ KÈM ĐƠN. Phiếu trả kèm đơn sinh ra từ lúc
--   NVBH lên đơn — TRƯỚC khi có hóa đơn nào. Nó bám vào ĐƠN
--   (`returns.order_id`), và `post_invoice` chỉ nhấc nó từ 'draft' lên
--   'submitted' rồi gắn thêm `invoice_id`. Huỷ hóa đơn là huỷ đúng cái
--   việc `post_invoice` vừa làm — chứ không phải huỷ luôn phiếu trả.
--
--   Hàng khách trả vẫn đang nằm ở đó ngoài đời. Gắn chữ "Đã huỷ" lên nó
--   là ghi vào sổ rằng khách chưa từng trả hàng, và người xử lý đơn lần
--   sau không còn gì để nhìn thấy mà xử lý.
--
-- ⚠ PHIẾU TRẢ ĐỘC LẬP THÌ NGƯỢC LẠI — HUỶ LÀ ĐÚNG. Phiếu không gắn đơn
--   nào (`order_id IS NULL`) chỉ trỏ vào đúng hóa đơn này; hóa đơn mất
--   thì nó mất chỗ bám thật. Nên bản vá tách đôi theo `order_id`, không
--   bỏ hẳn phép huỷ.
--
-- ⚠ GỠ LIÊN KẾT LÀ ĐỦ, KHÔNG CẦN HẠ TRẠNG THÁI. Phiếu quay về đúng chỗ
--   cũ: bám vào đơn, `invoice_id` rỗng. Lần xuất hóa đơn sau
--   `post_invoice` gắn lại bằng chính câu nó vẫn dùng
--   (`WHERE order_id = v_order AND status = 'draft'`), còn phiếu đã
--   'submitted' thì `_wf2_recompute_receivable` nhận nuôi khi đơn có
--   đúng một hóa đơn đã ghi sổ.
--
-- ⚠ VÁ BẰNG CÁCH THAY CÂU, KHÔNG CHÉP LẠI CẢ HÀM. `cancel_invoice` dài
--   ~150 dòng và phần hoàn kho theo lô là phần dễ chép sai nhất. Chép
--   lại nguyên văn ở đây là từ nay có hai bản, và bản nào đúng thì phải
--   đọc cả hai mới biết. Thay đúng một câu, và DỪNG NGAY nếu câu ấy
--   không còn hình dạng cũ.

-- ---------------------------------------------------------------------
-- 1. Vá `cancel_invoice`
-- ---------------------------------------------------------------------
DO $patch$
DECLARE
  v_oid   oid;
  v_src   text;
  v_stmt  text;
  v_new   text;
  v_n     int;
  v_re    text := 'UPDATE returns[^;]+status IN \(''draft'', ''submitted''\);';
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'cancel_invoice';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION
      'CANCEL_INVOICE_MISSING: chưa có hàm cancel_invoice — chạy migration 125 trước.'
      USING ERRCODE = 'P0001';
  END IF;

  v_src := pg_get_functiondef(v_oid);

  -- Đã vá rồi thì đứng yên. Migration phải chạy lại được mà không đổi gì.
  IF position('order_id IS NULL' in v_src) > 0
     AND position('SET invoice_id = NULL' in v_src) > 0 THEN
    RAISE NOTICE '131: cancel_invoice đã vá từ trước — không đổi gì.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_re, 'g');

  IF v_n <> 1 THEN
    -- ⚠ IN RA THỨ TÌM THẤY. Mig 126 đã học bài này một lần: báo "không
    --   đúng hình dạng" mà không nói hình dạng hiện tại là gì thì người
    --   chạy migration không có đường nào sửa tay.
    RAISE EXCEPTION
      'CANCEL_INVOICE_SHAPE: tìm thấy % câu huỷ phiếu trả trong cancel_invoice (cần đúng 1). Thân hàm hiện tại:%',
      v_n, E'\n' || v_src
      USING ERRCODE = 'P0001';
  END IF;

  v_stmt := substring(v_src from v_re);

  v_new :=
    '-- ⚠ PHIẾU TRẢ KÈM ĐƠN CHỈ GỠ KHỎI HÓA ĐƠN, KHÔNG HUỶ (mig 131).' || E'\n'
    || '  --   Nó có từ lúc lên đơn, trước khi có hóa đơn nào; huỷ theo là' || E'\n'
    || '  --   ghi vào sổ rằng khách chưa từng trả hàng.' || E'\n'
    || '  UPDATE returns' || E'\n'
    || '  SET invoice_id = NULL' || E'\n'
    || '  WHERE invoice_id = p_invoice_id' || E'\n'
    || '    AND status IN (''draft'', ''submitted'')' || E'\n'
    || '    AND order_id IS NOT NULL;' || E'\n'
    || E'\n'
    || '  -- Phiếu trả ĐỘC LẬP thì mất chỗ bám thật: nó chỉ trỏ vào hóa đơn' || E'\n'
    || '  -- này. Huỷ và ghi lý do.' || E'\n'
    || '  UPDATE returns' || E'\n'
    || '  SET status = ''cancelled'', cancelled_at = now(),' || E'\n'
    || '      cancel_reason = ''Hóa đơn '' || v.invoice_code || '' bị huỷ''' || E'\n'
    || '  WHERE invoice_id = p_invoice_id' || E'\n'
    || '    AND status IN (''draft'', ''submitted'')' || E'\n'
    || '    AND order_id IS NULL;';

  EXECUTE replace(v_src, v_stmt, v_new);
  RAISE NOTICE '131: đã vá cancel_invoice — phiếu trả kèm đơn nay chỉ bị gỡ liên kết.';
END;
$patch$;


-- ---------------------------------------------------------------------
-- 2. `post_invoice` phải gắn lại được phiếu trả vừa gỡ
-- ---------------------------------------------------------------------
--
-- ⚠ NỬA CÒN LẠI CỦA BẢN VÁ, và nếu thiếu thì nửa trên thành một lỗi mới.
--   Chạy thử trên Postgres thật cho thấy: huỷ hóa đơn xong, phiếu trả về
--   đúng trạng thái `submitted` với `invoice_id` rỗng — nhưng lần xuất
--   hóa đơn SAU không gắn nó lại, vì câu gắn của `post_invoice` chỉ nhặt
--   `status = 'draft'`:
--
--       UPDATE returns SET status = 'submitted', invoice_id = v_inv
--       WHERE order_id = v_order AND status = 'draft';
--
--   Phiếu trả khi ấy nằm mồ côi mãi: hàng khách trả không giảm công nợ
--   của bất kỳ hóa đơn nào, và không dòng nào báo.
--
-- ⚠ ĐÂY CŨNG LÀ MỘT LỖ VỐN ĐÃ CÓ. Phiếu trả được gửi thẳng từ màn Trả
--   hàng (thành 'submitted' trước khi đơn kịp xuất) cũng rơi vào đúng lỗ
--   này. `_wf2_recompute_receivable` có nhận nuôi phiếu mồ côi, nhưng chỉ
--   khi một RPC đơn trả chạy — không ai đảm bảo điều đó xảy ra.
--
-- ⚠ GIỮ NGUYÊN `invoice_id IS NULL`. Không có vế đó thì câu này giật
--   phiếu trả của một hóa đơn khác đang có hiệu lực sang tờ vừa xuất.
DO $patch2$
DECLARE
  v_oid  oid;
  v_src  text;
  v_stmt text;
  v_new  text;
  v_n    int;
  v_re   text := 'UPDATE returns SET status = ''submitted'', invoice_id = v_inv[^;]+;';
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'post_invoice';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION
      'POST_INVOICE_MISSING: chưa có hàm post_invoice — chạy migration 125 trước.'
      USING ERRCODE = 'P0001';
  END IF;

  v_src := pg_get_functiondef(v_oid);

  IF position('AND ret.invoice_id IS NULL' in v_src) > 0 THEN
    RAISE NOTICE '131: post_invoice đã vá từ trước — không đổi gì.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_re, 'g');

  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'POST_INVOICE_SHAPE: tìm thấy % câu gắn phiếu trả trong post_invoice (cần đúng 1). Thân hàm hiện tại:%',
      v_n, E'\n' || v_src
      USING ERRCODE = 'P0001';
  END IF;

  v_stmt := substring(v_src from v_re);

  -- ⚠ ĐẶT BÍ DANH `ret`. `post_invoice` trả về `RETURNS TABLE (invoice_id
  --   uuid, …)`, nên `invoice_id` trần là BIẾN plpgsql, không phải cột —
  --   và Postgres chỉ phát hiện nhập nhằng lúc GỌI, không phải lúc tạo
  --   hàm. Đúng cái bẫy đã làm `reissue_invoice` không chạy được từ mig
  --   125 tới mig 128.
  v_new :=
    'UPDATE returns ret SET status = ''submitted'', invoice_id = v_inv' || E'\n'
    || '  WHERE ret.order_id = v_order' || E'\n'
    || '    AND ret.invoice_id IS NULL' || E'\n'
    || '    AND ret.status IN (''draft'', ''submitted'');';

  EXECUTE replace(v_src, v_stmt, v_new);
  RAISE NOTICE '131: đã vá post_invoice — phiếu trả mồ côi nay được gắn lại.';
END;
$patch2$;


-- ---------------------------------------------------------------------
-- 3. Dựng lại những phiếu trả đã bị huỷ oan
-- ---------------------------------------------------------------------
--
-- ⚠ CHỈ NHẬN ĐÚNG DẤU VẾT CỦA LỖI NÀY, không quét rộng. Dấu vết là cả
--   bốn điều kiện cùng lúc: đã huỷ, lý do đúng câu `cancel_invoice` ghi,
--   có gắn đơn, và hóa đơn nó trỏ vào đang ở trạng thái 'cancelled'.
--   Thiếu một điều kiện là dựng lại cả những phiếu trả do người dùng chủ
--   động huỷ — sửa một lỗi bằng cách tạo ra một lỗi to hơn.
--
-- ⚠ ĐƠN ĐÃ HUỶ / ĐÃ ĐÓNG THÌ ĐỂ YÊN. Phiếu trả kèm một đơn không còn
--   chạy nữa thì huỷ vẫn là đúng, dù nó bị huỷ vì lý do gì.
DO $fix$
DECLARE
  r          record;
  v_posted   int;
  v_inv      uuid;
  v_draft    int := 0;
  v_relink   int := 0;
  v_skip     int := 0;
BEGIN
  FOR r IN
    SELECT ret.id, ret.order_id, so.order_code
    FROM returns ret
    JOIN sales_invoices si ON si.id = ret.invoice_id
    JOIN sales_orders   so ON so.id = ret.order_id
    WHERE ret.status = 'cancelled'
      AND ret.order_id IS NOT NULL
      AND si.status = 'cancelled'
      AND ret.cancel_reason LIKE 'Hóa đơn % bị huỷ'
      AND so.status NOT IN ('cancelled', 'closed')
  LOOP
    -- ⚠ KHÔNG DÙNG `min(si2.id)`. Postgres 16 không có hàm gộp `min` cho
    --   kiểu uuid, và lỗi ấy chỉ nổ lúc CHẠY — `CREATE FUNCTION` nhận hết.
    --   Đếm và lấy dòng là hai câu riêng.
    SELECT count(*) INTO v_posted
    FROM sales_invoices si2
    WHERE si2.order_id = r.order_id AND si2.status = 'posted';

    SELECT si2.id INTO v_inv
    FROM sales_invoices si2
    WHERE si2.order_id = r.order_id AND si2.status = 'posted'
    ORDER BY si2.invoice_date, si2.id
    LIMIT 1;

    IF v_posted = 0 THEN
      -- Đơn chưa có hóa đơn nào còn hiệu lực: phiếu trả quay về đúng chỗ
      -- nó đứng trước khi xuất hàng — kèm đơn, chưa đi đâu. Lần
      -- `post_invoice` sau sẽ nhấc nó lên 'submitted' và gắn hóa đơn.
      UPDATE returns
      SET status = 'draft', invoice_id = NULL,
          cancelled_at = NULL, cancel_reason = NULL
      WHERE id = r.id;
      v_draft := v_draft + 1;

    ELSIF v_posted = 1 THEN
      -- Đơn đã xuất lại bằng một hóa đơn khác: gắn thẳng vào hóa đơn ấy,
      -- đúng thứ `post_invoice` đã làm lần đầu.
      UPDATE returns
      SET status = 'submitted', invoice_id = v_inv,
          cancelled_at = NULL, cancel_reason = NULL
      WHERE id = r.id;
      v_relink := v_relink + 1;

    ELSE
      -- ⚠ HAI HÓA ĐƠN TRỞ LÊN THÌ KHÔNG ĐOÁN. Gắn nhầm hóa đơn là ghi
      --   giảm công nợ vào đúng một tờ chứng từ sai. Để nguyên và nêu tên
      --   đơn để chủ nhà tự chọn.
      v_skip := v_skip + 1;
      RAISE NOTICE '131: đơn % có % hóa đơn đã ghi sổ — phiếu trả % để nguyên, phải chọn tay.',
        r.order_code, v_posted, r.id;
    END IF;
  END LOOP;

  RAISE NOTICE '131: dựng lại % phiếu trả về nháp, gắn lại % phiếu vào hóa đơn còn hiệu lực, bỏ qua % phiếu.',
    v_draft, v_relink, v_skip;
END;
$fix$;

NOTIFY pgrst, 'reload schema';


-- ####################################################################
-- # 132_backfill_missing_receivables.sql
-- ####################################################################

-- =====================================================================
-- 132 — DỰNG CÔNG NỢ CHO NHỮNG HÓA ĐƠN BÁN KHÔNG CÓ DÒNG NỢ NÀO
-- =====================================================================
--
-- VÌ SAO
--   Chủ nhà báo: "có 21 hóa đơn bán nhưng công nợ trắng".
--
--   Đúng như vậy, và đây là lỗ của mig 124. Phần backfill của nó dựng
--   `sales_invoices` từ các đơn đã hoàn thành, rồi GẮN các chứng từ cũ
--   vào hóa đơn mới (124, dòng 672):
--
--       UPDATE receivables SET invoice_id = v_inv
--       WHERE order_id = o.id AND invoice_id IS NULL;
--
--   Chỉ có UPDATE. KHÔNG có INSERT. Đơn nào trước đó đã có dòng công nợ
--   thì được gắn; đơn nào CHƯA từng có dòng nào thì hóa đơn sinh ra
--   trắng trơn — bán hàng có, giao hàng có, mà sổ nợ không ghi gì.
--
-- ⚠ ĐÂY LÀ TIỀN, NÊN KHÔNG ĐOÁN Ở BẤT CỨ CHỖ NÀO. Chỉ dựng dòng nợ cho
--   hóa đơn thoả CẢ HAI:
--     · chính nó chưa có dòng nợ nào (`receivables.invoice_id`), và
--     · ĐƠN của nó cũng không còn dòng nợ cũ chưa gắn.
--
--   Vế thứ hai mới là vế quan trọng. Một dòng nợ cũ `invoice_id` rỗng
--   trỏ vào đơn này nghĩa là khoản nợ ấy ĐÃ TỒN TẠI (và có thể đã thu
--   một phần); dựng thêm dòng nữa là đòi khách hai lần cùng một lô hàng.
--   Những ca đó KHÔNG tự sửa — migration nêu tên ra để chủ nhà xử tay.
--
-- ⚠ TÍNH LẠI QUA `_wf2b_recompute_receivable`, KHÔNG TỰ VIẾT INSERT.
--   Hàm đó đã biết trừ phiếu trả đã hoàn thành, biết tính hạn nợ theo
--   NETxx, biết kẹp về 0. Chép lại phép tính ở đây là từ nay có hai bản,
--   và bản nào đúng thì phải đọc cả hai mới biết.
--
-- ⚠ HẠN NỢ SẼ RƠI VÀO QUÁ KHỨ, và đó là ĐÚNG. Hóa đơn tháng trước thì
--   hạn của nó là tháng trước; những khoản này hiện ra ở nhóm quá hạn
--   ngay sau khi chạy. Đấy là sự thật đang bị giấu, không phải lỗi mới.
--
-- ⚠ CHẠY LẠI KHÔNG SINH THÊM. `_wf2b_recompute_receivable` thấy dòng nợ
--   đã có thì UPDATE chứ không INSERT, và vòng lặp chỉ nhặt hóa đơn chưa
--   có dòng nào.

-- ---------------------------------------------------------------------
-- 1. XEM TRƯỚC — in ra thứ sắp làm, trước khi làm
-- ---------------------------------------------------------------------
DO $preview$
DECLARE
  r        record;
  v_new    int := 0;
  v_amt    numeric := 0;
  v_risk   int := 0;
BEGIN
  FOR r IN
    SELECT si.id, si.invoice_code, si.total, si.invoice_date,
           so.order_code,
           EXISTS (
             SELECT 1 FROM receivables rc
             WHERE rc.order_id = si.order_id AND rc.invoice_id IS NULL
           ) AS has_legacy
    FROM sales_invoices si
    LEFT JOIN sales_orders so ON so.id = si.order_id
    WHERE si.status = 'posted'
      AND NOT EXISTS (
        SELECT 1 FROM receivables rc WHERE rc.invoice_id = si.id
      )
    ORDER BY si.invoice_date, si.invoice_code
  LOOP
    IF r.has_legacy THEN
      v_risk := v_risk + 1;
      -- VẤN ĐỀ: có dòng nợ cũ chưa gắn cho chính đơn này.
      RAISE NOTICE
        '132 BỎ QUA  % (đơn %): đơn còn dòng công nợ cũ chưa gắn hóa đơn. Gắn tay rồi chạy lại, đừng để migration đoán.',
        r.invoice_code, COALESCE(r.order_code, '—');
    ELSE
      v_new := v_new + 1;
      v_amt := v_amt + COALESCE(r.total, 0);
      -- THÔNG TIN: sẽ dựng dòng nợ.
      RAISE NOTICE '132 dựng nợ  % (đơn % · % · %)',
        r.invoice_code, COALESCE(r.order_code, '—'), r.invoice_date,
        to_char(COALESCE(r.total, 0), 'FM999G999G999');
    END IF;
  END LOOP;

  RAISE NOTICE '--- 132 xem trước: dựng % dòng nợ, tổng % · bỏ qua % hóa đơn phải xử tay ---',
    v_new, to_char(v_amt, 'FM999G999G999'), v_risk;
END;
$preview$;


-- ---------------------------------------------------------------------
-- 2. DỰNG
-- ---------------------------------------------------------------------
DO $fix$
DECLARE
  r      record;
  v_id   uuid;
  v_n    int := 0;
  v_fail int := 0;
BEGIN
  FOR r IN
    SELECT si.id, si.invoice_code
    FROM sales_invoices si
    WHERE si.status = 'posted'
      AND NOT EXISTS (
        SELECT 1 FROM receivables rc WHERE rc.invoice_id = si.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM receivables rc
        WHERE rc.order_id = si.order_id AND rc.invoice_id IS NULL
      )
    ORDER BY si.invoice_date, si.invoice_code
  LOOP
    v_id := public._wf2b_recompute_receivable(r.id);
    IF v_id IS NULL THEN
      -- ⚠ HÀM TRẢ `NULL` NGHĨA LÀ NÓ TỪ CHỐI DỰNG. Đếm im lặng rồi báo
      --   "xong" là để lại đúng cái lỗ vừa đi vá.
      v_fail := v_fail + 1;
      RAISE NOTICE '132 KHÔNG dựng được nợ cho % — xem lại tay.', r.invoice_code;
    ELSE
      v_n := v_n + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '--- 132: đã dựng % dòng công nợ (% hóa đơn không dựng được) ---',
    v_n, v_fail;
END;
$fix$;


-- ---------------------------------------------------------------------
-- 3. Đối chiếu lại — còn sót thì nói ra
-- ---------------------------------------------------------------------
DO $check$
DECLARE
  v_left int;
BEGIN
  SELECT count(*) INTO v_left
  FROM sales_invoices si
  WHERE si.status = 'posted'
    AND NOT EXISTS (SELECT 1 FROM receivables rc WHERE rc.invoice_id = si.id);

  IF v_left > 0 THEN
    RAISE NOTICE
      '--- 132: CÒN % hóa đơn đã ghi sổ chưa có công nợ. Đây là những ca phải xử tay (xem dòng BỎ QUA bên trên) ---',
      v_left;
  ELSE
    RAISE NOTICE '--- 132: mọi hóa đơn đã ghi sổ đều có dòng công nợ ---';
  END IF;
END;
$check$;

NOTIFY pgrst, 'reload schema';


-- ####################################################################
-- # 133_return_credit_rides_invoice.sql
-- ####################################################################

-- =====================================================================
-- 133 — HÀNG TRẢ KÈM ĐƠN: HÓA ĐƠN GÁNH KHOẢN TRỪ, PHIẾU TRẢ LO NHẬP KHO
-- =====================================================================
--
-- LUẬT CHỦ NHÀ CHỐT
--   · Đơn hàng có hàng đổi / trả → lúc xuất hàng, lập hóa đơn:
--       – HÓA ĐƠN mang phần trừ tiền hàng trả, và TRỪ LUÔN VÀO CÔNG NỢ;
--       – PHIẾU TRẢ tự sinh từ đơn chỉ còn một việc: NHẬP HÀNG VỀ KHO.
--   · Phiếu trả ĐỘC LẬP (lập từ danh sách Phiếu trả, hoặc lập từ một hóa
--     đơn bán — ví dụ giao rồi khách không nhận hết) thì như cũ: VỪA trừ
--     công nợ VỪA nhập kho, và trừ lúc phiếu HOÀN THÀNH.
--
-- ĐANG SAI CHỖ NÀO
--   `_wf2b_recompute_receivable` (mig 125, dòng 106) trừ công nợ theo
--   MỘT luật duy nhất:
--
--       WHERE r.invoice_id = p_invoice_id AND r.status = 'completed'
--
--   Nghĩa là hàng khách trả tại chỗ cho NVBH chỉ giảm nợ khi THỦ KHO
--   hoàn thành phiếu trả. Từ lúc giao hàng tới lúc đó, sổ ghi khách nợ
--   đủ cả lô — trong khi khách đã đưa tiền phần chênh và cầm về tờ hóa
--   đơn có dòng trừ. Kế toán đi đối chiếu sẽ thấy hai con số khác nhau,
--   và con số sai là con số trong sổ.
--
-- CÁCH SỬA
--   Thêm một cột đánh dấu XUẤT XỨ của phiếu trả — `credit_with_invoice`:
--   "khoản trừ của phiếu này đi cùng hóa đơn". Công nợ trừ theo:
--
--       đi cùng hóa đơn  → trừ từ khi phiếu ở 'submitted' (lúc xuất hàng)
--       không đi cùng    → trừ khi phiếu 'completed'      (lúc nhập kho)
--
-- ⚠ KHÔNG SỬA `sales_invoices.total`. Tờ hóa đơn chứng nhận GIÁ TRỊ LÔ
--   HÀNG ĐÃ GIAO; khoản trừ là việc xảy ra cùng lúc nhưng là một dòng
--   khác. `total` còn là nền của doanh số gộp (mig 126) và của hóa đơn
--   điện tử — đổi nghĩa của nó là doanh thu và thuế lệch theo mà không
--   ai thấy. Bản in đã hiện "Tổng cộng / Trừ hàng trả / Còn phải thu"
--   đúng như chủ nhà chốt.
--
-- ⚠ KHÔNG LƯU KHOẢN TRỪ THÀNH MỘT CỘT SNAPSHOT trên `sales_invoices`.
--   Tính sống từ `returns` mỗi lần là phiếu trả bị huỷ / bị sửa dòng thì
--   công nợ tự đúng theo. Một cột chụp lại là từ nay có hai con số cho
--   cùng một khoản, và chúng chỉ lệch nhau vào đúng lúc không ai nhìn.
--
-- ⚠ ĐẢO NGƯỢC PHẢI KÉO THEO. `cancel_invoice` (đã vá ở mig 131) gỡ phiếu
--   trả kèm đơn ra khỏi hóa đơn; 133 gỡ luôn dấu `credit_with_invoice`.
--   Không gỡ thì phiếu ấy vẫn trừ nợ của một tờ hóa đơn đã huỷ, và lần
--   xuất lại nó trừ thêm lần nữa.
--
-- ⚠ CẦN MIG 131 CHẠY TRƯỚC. 133 vá tiếp lên đúng hai câu mà 131 vừa viết
--   lại. Chưa có 131 thì DỪNG và nói ra, chứ không vá mò.

-- ---------------------------------------------------------------------
-- 1. Cột đánh dấu
-- ---------------------------------------------------------------------
ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS credit_with_invoice boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN returns.credit_with_invoice IS
  'Khoản trừ của phiếu này ĐI CÙNG HÓA ĐƠN: trừ vào công nợ ngay khi '
  'hóa đơn được ghi sổ (phiếu ở ''submitted''), và phiếu chỉ còn việc '
  'nhập hàng về kho. Phiếu trả độc lập để false — nó trừ khi HOÀN THÀNH.';

CREATE INDEX IF NOT EXISTS idx_returns_credit_with_invoice
  ON returns(invoice_id, credit_with_invoice) WHERE invoice_id IS NOT NULL;


-- ---------------------------------------------------------------------
-- 2. Luật trừ công nợ mới
-- ---------------------------------------------------------------------
--
-- ⚠ HÀM NÀY VIẾT LẠI NGUYÊN VĂN, KHÔNG VÁ THEO CHUỖI. Nó ngắn, và phép
--   tính công nợ là thứ phải đọc được hết trong một lần — không phải
--   ghép từ ba migration mới ra nghĩa.
CREATE OR REPLACE FUNCTION public._wf2b_recompute_receivable(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v         record;
  v_credits numeric;
  v_net     numeric;
  v_id      uuid;
  v_paid    numeric;
BEGIN
  SELECT si.id, si.org_id, si.order_id, si.customer_id, si.sales_user_id,
         si.total, si.payment_terms, si.invoice_date, si.status
    INTO v
  FROM sales_invoices si WHERE si.id = p_invoice_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- ⚠ HAI LUẬT, MỘT PHÉP CỘNG. Phiếu đi cùng hóa đơn trừ ngay từ
  --   'submitted' (hàng đã đổi tay lúc giao); phiếu độc lập trừ khi
  --   'completed' (hàng đã về kho). Gộp thành một điều kiện `OR` chứ
  --   không hai câu cộng lại — hai câu là sớm muộn có người sửa một câu.
  SELECT COALESCE(sum(COALESCE(r.credit_note_amount, 0)), 0) INTO v_credits
  FROM returns r
  WHERE r.invoice_id = p_invoice_id
    AND (
      (r.credit_with_invoice AND r.status IN ('submitted', 'completed'))
      OR
      (NOT r.credit_with_invoice AND r.status = 'completed')
    );

  v_net := GREATEST(0, COALESCE(v.total, 0) - v_credits);

  SELECT rc.id, COALESCE(rc.paid, 0) INTO v_id, v_paid
  FROM receivables rc WHERE rc.invoice_id = p_invoice_id LIMIT 1;

  IF v_id IS NULL AND v.status <> 'posted' THEN
    RETURN NULL;
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE receivables
    SET amount = v_net,
        status = CASE
                   WHEN v_paid >= v_net THEN 'paid'
                   WHEN v_paid > 0      THEN 'partial'
                   ELSE 'open'
                 END
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO receivables (
    org_id, order_id, invoice_id, customer_id, sales_user_id,
    amount, paid, due_date, status
  ) VALUES (
    v.org_id, v.order_id, v.id, v.customer_id, v.sales_user_id,
    v_net, 0,
    COALESCE(v.invoice_date, current_date)
      + public._wf2b_payment_terms_days(v.payment_terms),
    'open'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


-- ---------------------------------------------------------------------
-- 3. `post_invoice` — đánh dấu phiếu trả, RỒI mới tính lại công nợ
-- ---------------------------------------------------------------------
--
-- ⚠ THỨ TỰ LÀ CẢ VẤN ĐỀ. Bản mig 125 tính công nợ TRƯỚC rồi mới gắn
--   phiếu trả:
--
--       v_rec := public._wf2b_recompute_receivable(v_inv);
--       UPDATE returns SET status = 'submitted', invoice_id = v_inv ...
--
--   Với luật cũ điều đó vô hại (phiếu vừa gắn còn 'submitted', chưa trừ
--   gì). Với luật mới thì nó trừ hụt: công nợ ghi đủ cả lô, và chỉ đúng
--   lại vào lần nào đó có ai gọi tính lại. Nên câu gắn phải chạy TRƯỚC,
--   và tính lại NGAY SAU nó.
DO $patch$
DECLARE
  v_oid  oid;
  v_src  text;
  v_stmt text;
  v_new  text;
  v_n    int;
  -- Bắt cả hai hình dạng: bản mig 125 (chưa có bí danh) và bản mig 131.
  v_re   text := 'UPDATE returns[^;]*SET status = ''submitted'', invoice_id = v_inv[^;]+;';
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'post_invoice';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'POST_INVOICE_MISSING: chưa có post_invoice — chạy migration 125 trước.'
      USING ERRCODE = 'P0001';
  END IF;

  v_src := pg_get_functiondef(v_oid);

  IF position('AND ret.invoice_id IS NULL' in v_src) = 0 THEN
    RAISE EXCEPTION
      'NEEDS_131: post_invoice chưa được migration 131 vá (câu gắn phiếu trả còn hình dạng cũ). Chạy 131 trước rồi chạy lại 133.'
      USING ERRCODE = 'P0001';
  END IF;

  IF position('credit_with_invoice = true' in v_src) > 0 THEN
    RAISE NOTICE '133: post_invoice đã vá từ trước — không đổi gì.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_re, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'POST_INVOICE_SHAPE: tìm thấy % câu gắn phiếu trả trong post_invoice (cần đúng 1). Thân hàm hiện tại:%',
      v_n, E'\n' || v_src USING ERRCODE = 'P0001';
  END IF;

  v_stmt := substring(v_src from v_re);

  v_new :=
    'UPDATE returns ret' || E'\n'
    || '  SET status = ''submitted'', invoice_id = v_inv,' || E'\n'
    -- ⚠ PHIẾU SINH RA TỪ ĐƠN MỚI ĐƯỢC ĐÁNH DẤU. Phiếu độc lập đã gắn
    --   hóa đơn này từ trước thì `ret.invoice_id IS NULL` loại nó ra rồi.
    || '      credit_with_invoice = true' || E'\n'
    || '  WHERE ret.order_id = v_order' || E'\n'
    || '    AND ret.invoice_id IS NULL' || E'\n'
    || '    AND ret.status IN (''draft'', ''submitted'');' || E'\n'
    || E'\n'
    || '  -- ⚠ TÍNH LẠI SAU KHI ĐÃ GẮN (mig 133). Lần tính ở trên chạy' || E'\n'
    || '  --   trước câu gắn nên chưa thấy khoản trừ nào; không tính lại' || E'\n'
    || '  --   ở đây thì công nợ ghi đủ cả lô trong khi khách đã trừ.' || E'\n'
    || '  v_rec := public._wf2b_recompute_receivable(v_inv);';

  EXECUTE replace(v_src, v_stmt, v_new);
  RAISE NOTICE '133: đã vá post_invoice — hóa đơn gánh khoản trừ hàng trả kèm đơn.';
END;
$patch$;


-- ---------------------------------------------------------------------
-- 4. `cancel_invoice` — gỡ dấu khi gỡ liên kết
-- ---------------------------------------------------------------------
--
-- ⚠ ĐẢO NGƯỢC PHẢI ĐẢO ĐỦ. Mig 131 gỡ `invoice_id`; nếu để lại dấu
--   `credit_with_invoice` thì lần xuất hóa đơn sau `post_invoice` gắn
--   lại và đặt dấu lần nữa — không sai, nhưng phiếu nằm giữa hai lần ấy
--   mang một dấu vô nghĩa. Tệ hơn: phiếu bị gỡ rồi lại được HOÀN THÀNH
--   như một phiếu độc lập thì luật cũ và luật mới cùng nhìn vào nó.
DO $patch2$
DECLARE
  v_oid  oid;
  v_src  text;
  v_stmt text;
  v_new  text;
  v_n    int;
  v_re   text := 'UPDATE returns[^;]*SET invoice_id = NULL[^;]+;';
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'cancel_invoice';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'CANCEL_INVOICE_MISSING: chưa có cancel_invoice — chạy migration 125 trước.'
      USING ERRCODE = 'P0001';
  END IF;

  v_src := pg_get_functiondef(v_oid);

  IF position('SET invoice_id = NULL' in v_src) = 0 THEN
    RAISE EXCEPTION
      'NEEDS_131: cancel_invoice chưa được migration 131 vá (còn huỷ thẳng phiếu trả). Chạy 131 trước rồi chạy lại 133.'
      USING ERRCODE = 'P0001';
  END IF;

  IF position('credit_with_invoice = false' in v_src) > 0 THEN
    RAISE NOTICE '133: cancel_invoice đã vá từ trước — không đổi gì.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_re, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'CANCEL_INVOICE_SHAPE: tìm thấy % câu gỡ phiếu trả trong cancel_invoice (cần đúng 1). Thân hàm hiện tại:%',
      v_n, E'\n' || v_src USING ERRCODE = 'P0001';
  END IF;

  v_stmt := substring(v_src from v_re);

  v_new :=
    'UPDATE returns' || E'\n'
    || '  SET invoice_id = NULL, credit_with_invoice = false' || E'\n'
    || '  WHERE invoice_id = p_invoice_id' || E'\n'
    || '    AND status IN (''draft'', ''submitted'')' || E'\n'
    || '    AND order_id IS NOT NULL;';

  EXECUTE replace(v_src, v_stmt, v_new);
  RAISE NOTICE '133: đã vá cancel_invoice — gỡ dấu đi cùng hóa đơn.';
END;
$patch2$;


-- ---------------------------------------------------------------------
-- 5. Đánh dấu dữ liệu cũ
-- ---------------------------------------------------------------------
--
-- ⚠ CHỈ PHIẾU SINH RA TỪ ĐƠN. Dấu hiệu: có `order_id`, VÀ ra đời TRƯỚC
--   khi hóa đơn của nó được ghi sổ. Phiếu lập TỪ một hóa đơn (giao rồi
--   khách không nhận hết) ra đời SAU, và theo luật chủ nhà nó vẫn trừ
--   lúc nhập kho — không được đánh dấu.
--
-- ⚠ ĐÁNH DẤU MỘT PHIẾU ĐANG 'submitted' LÀ LÀM CÔNG NỢ GIẢM NGAY. Đó
--   chính là ý chủ nhà, nhưng nó đụng vào sổ đang chạy — nên in ra từng
--   dòng, kèm số tiền, trước khi đụng.
DO $mark$
DECLARE
  r      record;
  v_n    int := 0;
  v_move int := 0;
  v_amt  numeric := 0;
BEGIN
  FOR r IN
    SELECT ret.id, ret.status, COALESCE(ret.credit_note_amount, 0) AS credit,
           si.invoice_code, so.order_code
    FROM returns ret
    LEFT JOIN sales_invoices si ON si.id = ret.invoice_id
    LEFT JOIN sales_orders   so ON so.id = ret.order_id
    WHERE ret.order_id IS NOT NULL
      AND NOT ret.credit_with_invoice
      AND ret.status IN ('draft', 'submitted', 'completed')
      AND (
        ret.invoice_id IS NULL
        OR ret.created_at < COALESCE(si.posted_at, si.created_at)
      )
  LOOP
    UPDATE returns SET credit_with_invoice = true WHERE id = r.id;
    v_n := v_n + 1;
    -- Chỉ phiếu 'submitted' mới làm công nợ đổi: 'completed' vốn đã trừ,
    -- 'draft' thì chưa gắn hóa đơn nào nên không có gì để đổi.
    IF r.status = 'submitted' AND r.invoice_code IS NOT NULL AND r.credit > 0 THEN
      v_move := v_move + 1;
      v_amt := v_amt + r.credit;
      RAISE NOTICE '133 CÔNG NỢ ĐỔI: hóa đơn % (đơn %) giảm % — phiếu trả đã gửi, nay trừ ngay.',
        r.invoice_code, COALESCE(r.order_code, '—'), r.credit;
    END IF;
  END LOOP;

  RAISE NOTICE '--- 133: đánh dấu % phiếu trả đi cùng hóa đơn · % hóa đơn đổi công nợ, tổng giảm % ---',
    v_n, v_move, v_amt;
END;
$mark$;


-- ---------------------------------------------------------------------
-- 6. Tính lại công nợ cho những hóa đơn vừa bị ảnh hưởng
-- ---------------------------------------------------------------------
DO $recalc$
DECLARE
  r   record;
  v_n int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT ret.invoice_id AS id
    FROM returns ret
    WHERE ret.invoice_id IS NOT NULL
      AND ret.credit_with_invoice
      AND ret.status IN ('submitted', 'completed')
  LOOP
    PERFORM public._wf2b_recompute_receivable(r.id);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE '--- 133: tính lại công nợ cho % hóa đơn ---', v_n;
END;
$recalc$;

NOTIFY pgrst, 'reload schema';


-- ####################################################################
-- # 134_return_cap_per_customer.sql
-- ####################################################################

-- =====================================================================
-- 134 — PHIẾU TRẢ KÈM ĐƠN: TRẦN TÍNH THEO KHÁCH, KHÔNG THEO MỘT HÓA ĐƠN
-- =====================================================================
--
-- VÌ SAO
--   Chủ nhà báo: phiếu trả không hoàn thành được.
--
--       RETURN_QTY_EXCEEDS: "Xúc xích xiên que koko …" — đã xuất 0,
--       đã hoàn thành trả 0, phiếu này thêm 3 là vượt
--
--   "Đã xuất 0" là đúng: món xúc xích ấy KHÔNG nằm trên đơn vừa giao.
--   Đơn đó bán kẹo dẻo. Món xúc xích là hàng hỏng của LẦN GIAO TRƯỚC, và
--   NVBH thu hồi nó khi mang đơn mới tới.
--
-- ⚠ ĐÂY LÀ MỘT GIẢ ĐỊNH SAI TRONG CODE, KHÔNG PHẢI LỖI NHẬP LIỆU.
--   `complete_return` (mig 127, dòng 194) tính trần theo ĐÚNG MỘT hóa
--   đơn:
--
--       FROM sales_invoice_lines sil WHERE sil.invoice_id = r.invoice_id
--
--   Giả định ngầm: khách chỉ trả được thứ vừa mua trên chính chuyến này.
--   Với phiếu trả LẬP TỪ MỘT HÓA ĐƠN ("giao rồi khách không nhận hết")
--   thì đúng. Với phiếu trả SINH RA TỪ ĐƠN thì sai hẳn — hàng trả trong
--   thực tế gần như luôn là hàng của lần giao trước.
--
-- CÁCH SỬA
--   Phiếu có dấu `credit_with_invoice` (mig 133 — phiếu sinh ra từ đơn)
--   tính trần theo KHÁCH:
--
--       đã giao cho khách này (mọi hóa đơn đã ghi sổ)
--         − đã hoàn thành trả của khách này
--         ≥ số đang trả
--
--   Vẫn là một cái trần thật: nó chặn việc nhập vào kho món khách chưa
--   từng mua, và chặn trả đi trả lại cùng một lô. Chỉ bỏ đúng cái giả
--   định "phải cùng một tờ hóa đơn".
--
-- ⚠ PHIẾU LẬP TỪ HÓA ĐƠN GIỮ NGUYÊN TRẦN CŨ. Người lập nó đã nói rõ "trả
--   theo hóa đơn này"; nới ra là bỏ mất phép kiểm ở đúng chỗ nó có nghĩa.
--
-- ⚠ ĐẾM HAI VẾ CÙNG MỘT KIỂU (`is_exchange = false`), y như nhánh cũ.
--   Lệch kiểu đếm giữa vế "đã giao" và vế "đã trả" là cái trần tự nó
--   trôi. Hệ quả đã biết: món khách nhận dưới dạng hàng ĐỔI rồi sau đó
--   trả lại vẫn bị chặn — hiếm, và khi gặp thì thông báo nêu đúng tên
--   hàng nên nhận ra ngay.
--
-- ⚠ CẦN MIG 133 CHẠY TRƯỚC (cột `credit_with_invoice`). Chưa có thì DỪNG.

DO $patch$
DECLARE
  v_oid    oid;
  v_src    text;
  v_new    text;
  v_anchor text :=
    '      IF r.invoice_id IS NOT NULL THEN' || E'\n'
    || '        SELECT COALESCE(sum(sil.quantity * COALESCE(sil.conversion_factor, 1)), 0)';
  v_head_old text :=
    'SELECT id, org_id, order_id, invoice_id, status, requested_by INTO r';
  v_head_new text :=
    'SELECT id, org_id, order_id, invoice_id, status, requested_by, customer_id, credit_with_invoice INTO r';
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'complete_return';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'COMPLETE_RETURN_MISSING: chưa có complete_return — chạy migration 127 trước.'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'returns'
      AND column_name = 'credit_with_invoice'
  ) THEN
    RAISE EXCEPTION
      'NEEDS_133: chưa có cột returns.credit_with_invoice. Chạy migration 133 trước rồi chạy lại 134.'
      USING ERRCODE = 'P0001';
  END IF;

  v_src := pg_get_functiondef(v_oid);

  IF position('r.credit_with_invoice THEN' in v_src) > 0 THEN
    RAISE NOTICE '134: complete_return đã vá từ trước — không đổi gì.';
    RETURN;
  END IF;

  -- ⚠ HAI NEO, KIỂM TỪNG CÁI VÀ NÓI RÕ CÁI NÀO HỎNG. Báo chung "không
  --   khớp hình dạng" thì người chạy migration phải tự đi dò cả thân hàm.
  IF position(v_head_old in v_src) = 0 THEN
    RAISE EXCEPTION
      'COMPLETE_RETURN_SHAPE: không tìm thấy câu đọc phiếu trả vào biến r. Thân hàm hiện tại:%',
      E'\n' || v_src USING ERRCODE = 'P0001';
  END IF;
  IF position(v_anchor in v_src) = 0 THEN
    RAISE EXCEPTION
      'COMPLETE_RETURN_SHAPE: không tìm thấy nhánh tính trần theo hóa đơn. Thân hàm hiện tại:%',
      E'\n' || v_src USING ERRCODE = 'P0001';
  END IF;

  -- 1. Đọc thêm `customer_id` và dấu `credit_with_invoice`.
  v_src := replace(v_src, v_head_old, v_head_new);

  -- 2. Thêm nhánh trần-theo-khách TRƯỚC nhánh trần-theo-hóa-đơn.
  v_new :=
    '      -- ⚠ PHIẾU SINH RA TỪ ĐƠN: TRẦN THEO KHÁCH (mig 134).' || E'\n'
    || '      --   Hàng trả kèm đơn gần như luôn là hàng của LẦN GIAO TRƯỚC;' || E'\n'
    || '      --   so với dòng của chính tờ hóa đơn vừa xuất thì "đã xuất 0"' || E'\n'
    || '      --   và phiếu không bao giờ hoàn thành được.' || E'\n'
    || '      IF r.credit_with_invoice THEN' || E'\n'
    || '        SELECT COALESCE(sum(sil.quantity * COALESCE(sil.conversion_factor, 1)), 0)' || E'\n'
    || '          INTO v_sold' || E'\n'
    || '        FROM sales_invoice_lines sil' || E'\n'
    || '        JOIN sales_invoices si2 ON si2.id = sil.invoice_id' || E'\n'
    || '        WHERE si2.customer_id = r.customer_id' || E'\n'
    || '          AND si2.status = ''posted''' || E'\n'
    || '          AND sil.is_exchange = false' || E'\n'
    || '          AND sil.product_id = cap.product_id;' || E'\n'
    || E'\n'
    || '        SELECT COALESCE(sum(rl2.quantity * COALESCE((' || E'\n'
    || '                  SELECT pu.conversion FROM product_units pu' || E'\n'
    || '                   WHERE pu.product_id = rl2.product_id' || E'\n'
    || '                     AND pu.unit_name = rl2.unit_name), 1)), 0)' || E'\n'
    || '          INTO v_returned' || E'\n'
    || '        FROM return_lines rl2' || E'\n'
    || '        JOIN returns r2 ON r2.id = rl2.return_id' || E'\n'
    || '        WHERE r2.customer_id = r.customer_id' || E'\n'
    || '          AND r2.status = ''completed''' || E'\n'
    || '          AND rl2.is_exchange = false' || E'\n'
    || '          AND rl2.product_id = cap.product_id;' || E'\n'
    || E'\n'
    || '      ELSIF r.invoice_id IS NOT NULL THEN' || E'\n'
    || '        SELECT COALESCE(sum(sil.quantity * COALESCE(sil.conversion_factor, 1)), 0)';

  v_src := replace(v_src, v_anchor, v_new);

  EXECUTE v_src;
  RAISE NOTICE '134: đã vá complete_return — phiếu trả kèm đơn tính trần theo khách.';
END;
$patch$;

-- ---------------------------------------------------------------------
-- Trigger chặn lúc CHÈN DÒNG cũng mang đúng giả định ấy
-- ---------------------------------------------------------------------
--
-- ⚠ HAI CHỖ CHẶN, PHẢI SỬA CẢ HAI. `enforce_return_line_cap` (mig 124)
--   chạy lúc chèn dòng phiếu trả và so với ĐÚNG MỘT hóa đơn. Sửa mỗi
--   `complete_return` thì phiếu đi qua được lúc hoàn thành nhưng không
--   thêm nổi dòng — người dùng vấp đúng thông báo cũ ở một chỗ khác.
--
-- ⚠ GIỮ NGUYÊN NHÁNH "CHƯA GẮN HÓA ĐƠN THÌ BỎ QUA". Phiếu trả sinh ra
--   lúc lên đơn chưa có `invoice_id`, và hiện KHÔNG bị chặn gì. Đem trần
--   theo khách vào đó là thêm một phép chặn MỚI ở màn bán hàng — đúng
--   hơn về lý thuyết, nhưng nó chặn cả hàng khách mua từ trước khi dùng
--   phần mềm, và chặn ngay lúc NVBH đang đứng trước cửa hàng. Việc cần
--   làm hôm nay là NỚI chỗ chặn nhầm, không phải siết thêm chỗ mới.
CREATE OR REPLACE FUNCTION public.enforce_return_line_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice  uuid;
  v_cust     uuid;
  v_ride     boolean;
  v_conv     numeric;
  v_qty_base numeric;
  v_sold     numeric;
  v_returned numeric;
  v_name     text;
BEGIN
  IF NEW.is_exchange THEN
    RETURN NEW;
  END IF;

  SELECT r.invoice_id, r.customer_id, COALESCE(r.credit_with_invoice, false)
    INTO v_invoice, v_cust, v_ride
  FROM returns r WHERE r.id = NEW.return_id;

  -- Chưa gắn hóa đơn thì không có mốc để so — y như trước.
  IF v_invoice IS NULL THEN
    RETURN NEW;
  END IF;

  -- ⚠ `return_lines` không có cột hệ số; phải tra `product_units`, và
  --   cột ở bảng đó tên `conversion`, KHÔNG phải `conversion_factor`.
  v_conv := COALESCE((
    SELECT pu.conversion FROM product_units pu
     WHERE pu.product_id = NEW.product_id AND pu.unit_name = NEW.unit_name), 1);
  v_qty_base := COALESCE(NEW.quantity, 0) * v_conv;

  IF v_ride THEN
    -- Phiếu sinh ra từ đơn: hàng trả là hàng của LẦN GIAO TRƯỚC, nên mốc
    -- là mọi thứ đã giao cho KHÁCH NÀY (mig 134).
    SELECT COALESCE(sum(sil.quantity * COALESCE(sil.conversion_factor, 1)), 0)
      INTO v_sold
    FROM sales_invoice_lines sil
    JOIN sales_invoices si ON si.id = sil.invoice_id
    WHERE si.customer_id = v_cust
      AND si.status = 'posted'
      AND sil.is_exchange = false
      AND sil.product_id = NEW.product_id;

    SELECT COALESCE(sum(rl.quantity * COALESCE((
              SELECT pu.conversion FROM product_units pu
               WHERE pu.product_id = rl.product_id AND pu.unit_name = rl.unit_name), 1)), 0)
      INTO v_returned
    FROM return_lines rl
    JOIN returns r2 ON r2.id = rl.return_id
    WHERE r2.customer_id = v_cust
      AND r2.status = 'completed'
      AND rl.is_exchange = false
      AND rl.product_id = NEW.product_id
      AND rl.id <> NEW.id;
  ELSE
    SELECT COALESCE(sum(sil.quantity * COALESCE(sil.conversion_factor, 1)), 0)
      INTO v_sold
    FROM sales_invoice_lines sil
    JOIN sales_invoices si ON si.id = sil.invoice_id
    WHERE si.id = v_invoice
      AND si.status = 'posted'
      AND sil.is_exchange = false
      AND sil.product_id = NEW.product_id;

    SELECT COALESCE(sum(rl.quantity * COALESCE((
              SELECT pu.conversion FROM product_units pu
               WHERE pu.product_id = rl.product_id AND pu.unit_name = rl.unit_name), 1)), 0)
      INTO v_returned
    FROM return_lines rl
    JOIN returns r2 ON r2.id = rl.return_id
    WHERE r2.invoice_id = v_invoice
      AND r2.status = 'completed'
      AND rl.is_exchange = false
      AND rl.product_id = NEW.product_id
      AND rl.id <> NEW.id;
  END IF;

  IF v_qty_base + v_returned > v_sold THEN
    SELECT name INTO v_name FROM products WHERE id = NEW.product_id;
    RAISE EXCEPTION
      'RETURN_QTY_EXCEEDS: "%" — đã giao %, đã trả %, dòng này thêm % là vượt',
      COALESCE(v_name, NEW.product_id::text), v_sold, v_returned, v_qty_base
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------
-- Đối chiếu: còn phiếu nào đang kẹt vì trần cũ không
-- ---------------------------------------------------------------------
--
-- ⚠ CHỈ ĐẾM VÀ NÊU TÊN. Không tự hoàn thành phiếu nào — hoàn thành là
--   đụng vào tồn kho, và đó phải là một cú bấm có người chịu trách nhiệm.
DO $report$
DECLARE
  r     record;
  v_n   int := 0;
BEGIN
  FOR r IN
    SELECT ret.id, so.order_code, c.store_name
    FROM returns ret
    LEFT JOIN sales_orders so ON so.id = ret.order_id
    LEFT JOIN customers    c  ON c.id  = ret.customer_id
    WHERE ret.status = 'submitted'
      AND ret.credit_with_invoice
      AND EXISTS (
        SELECT 1 FROM return_lines rl
        WHERE rl.return_id = ret.id
          AND rl.is_exchange = false
          AND NOT EXISTS (
            SELECT 1 FROM sales_invoice_lines sil
            WHERE sil.invoice_id = ret.invoice_id
              AND sil.product_id = rl.product_id
          )
      )
  LOOP
    v_n := v_n + 1;
    RAISE NOTICE '134: phiếu trả của đơn % (%) có hàng ngoài hóa đơn — trước đây không hoàn thành được, nay được.',
      COALESCE(r.order_code, '—'), COALESCE(r.store_name, '—');
  END LOOP;
  RAISE NOTICE '--- 134: % phiếu trả đang chờ được gỡ kẹt ---', v_n;
END;
$report$;

NOTIFY pgrst, 'reload schema';


-- ####################################################################
-- # 135_cancel_invoice_returns_to_draft.sql
-- ####################################################################

-- =====================================================================
-- 135 — HUỶ HÓA ĐƠN: PHIẾU TRẢ KÈM ĐƠN QUAY HẲN VỀ NHÁP
-- =====================================================================
--
-- VÌ SAO
--   Chủ nhà chốt: "huỷ hoá đơn → đảo ngược lại trạng thái của trả hàng
--   về nháp, giống đảo trạng thái của đơn đặt hàng về phiếu tạm".
--
--   Mig 131 mới gỡ `invoice_id` và giữ nguyên trạng thái, nên phiếu trả
--   nằm lại ở 'Chờ xử lý' trong khi đơn đã lùi về Phiếu tạm. Hai chứng từ
--   của cùng một chuyến hàng chỉ về một nửa — người mở đơn ra thấy đơn
--   chưa xuất mà phiếu trả thì "đang chờ xử lý", và không biết phải xử lý
--   cái gì khi hàng còn chưa đi.
--
-- ⚠ CHỈ HẠ TRẠNG THÁI PHIẾU MÀ CHÍNH `post_invoice` ĐÃ NÂNG LÊN. Dấu
--   `credit_with_invoice` (mig 133) nói đúng điều đó: nó chỉ được đặt
--   trong câu `UPDATE ... SET status = 'submitted'` của `post_invoice`.
--   Hạ bừa mọi phiếu 'submitted' là xoá mất việc ai đó đã chủ động gửi
--   một phiếu trả độc lập đi, và không có đường nào biết để dựng lại.
--
-- ⚠ ĐỌC GIÁ TRỊ CŨ TRONG CÙNG MỘT `UPDATE`. `SET status = CASE WHEN
--   credit_with_invoice …` lấy giá trị TRƯỚC câu lệnh, nên đặt
--   `credit_with_invoice = false` ở cùng câu vẫn an toàn. Tách làm hai
--   câu thì câu sau không còn dấu để mà xét.
--
-- ⚠ CẦN MIG 131 VÀ 133 CHẠY TRƯỚC. 135 vá tiếp lên đúng câu hai bản ấy
--   để lại. Chưa có thì DỪNG và nói rõ thiếu bản nào.

DO $patch$
DECLARE
  v_oid  oid;
  v_src  text;
  v_stmt text;
  v_new  text;
  v_n    int;
  v_re   text := 'UPDATE returns[^;]*SET invoice_id = NULL[^;]+;';
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'cancel_invoice';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'CANCEL_INVOICE_MISSING: chưa có cancel_invoice — chạy migration 125 trước.'
      USING ERRCODE = 'P0001';
  END IF;

  v_src := pg_get_functiondef(v_oid);

  IF position('SET invoice_id = NULL' in v_src) = 0 THEN
    RAISE EXCEPTION
      'NEEDS_131: cancel_invoice còn huỷ thẳng phiếu trả. Chạy migration 131 trước rồi chạy lại 135.'
      USING ERRCODE = 'P0001';
  END IF;
  IF position('credit_with_invoice = false' in v_src) = 0 THEN
    RAISE EXCEPTION
      'NEEDS_133: cancel_invoice chưa gỡ dấu credit_with_invoice. Chạy migration 133 trước rồi chạy lại 135.'
      USING ERRCODE = 'P0001';
  END IF;

  IF position('THEN ''draft'' ELSE status END' in v_src) > 0 THEN
    RAISE NOTICE '135: cancel_invoice đã vá từ trước — không đổi gì.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_re, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'CANCEL_INVOICE_SHAPE: tìm thấy % câu gỡ phiếu trả trong cancel_invoice (cần đúng 1). Thân hàm hiện tại:%',
      v_n, E'\n' || v_src USING ERRCODE = 'P0001';
  END IF;

  v_stmt := substring(v_src from v_re);

  v_new :=
    '-- ⚠ VỀ HẲN NHÁP (mig 135). Đơn lùi về Phiếu tạm thì phiếu trả kèm' || E'\n'
    || '  --   nó cũng phải lùi theo; để lại ở ''Chờ xử lý'' là bảo thủ kho đi' || E'\n'
    || '  --   xử lý một chuyến hàng chưa hề rời kho.' || E'\n'
    || '  -- ⚠ CHỈ HẠ PHIẾU MÀ `post_invoice` ĐÃ NÂNG — dấu `credit_with_invoice`' || E'\n'
    || '  --   nói đúng điều đó. Phiếu độc lập ai đó chủ động gửi đi thì giữ.' || E'\n'
    || '  UPDATE returns' || E'\n'
    || '  SET invoice_id = NULL,' || E'\n'
    || '      status = CASE WHEN credit_with_invoice THEN ''draft'' ELSE status END,' || E'\n'
    || '      credit_with_invoice = false' || E'\n'
    || '  WHERE invoice_id = p_invoice_id' || E'\n'
    || '    AND status IN (''draft'', ''submitted'')' || E'\n'
    || '    AND order_id IS NOT NULL;';

  EXECUTE replace(v_src, v_stmt, v_new);
  RAISE NOTICE '135: đã vá cancel_invoice — phiếu trả kèm đơn quay về nháp.';
END;
$patch$;


-- ---------------------------------------------------------------------
-- Dọn những phiếu đã bị mig 131 để lại ở 'Chờ xử lý'
-- ---------------------------------------------------------------------
--
-- ⚠ CHỈ NHẬN ĐÚNG DẤU VẾT: phiếu 'submitted', có gắn đơn, KHÔNG gắn hóa
--   đơn nào, và đơn của nó hiện KHÔNG có hóa đơn nào đã ghi sổ. Đó đúng
--   là phiếu bị bỏ lại sau một lần huỷ hóa đơn. Thiếu vế cuối là hạ nhầm
--   phiếu của một đơn đang có hóa đơn hiệu lực.
DO $fix$
DECLARE
  r   record;
  v_n int := 0;
BEGIN
  FOR r IN
    SELECT ret.id, so.order_code
    FROM returns ret
    JOIN sales_orders so ON so.id = ret.order_id
    WHERE ret.status = 'submitted'
      AND ret.invoice_id IS NULL
      AND so.status NOT IN ('cancelled', 'closed')
      AND NOT EXISTS (
        SELECT 1 FROM sales_invoices si
        WHERE si.order_id = ret.order_id AND si.status = 'posted'
      )
  LOOP
    UPDATE returns SET status = 'draft' WHERE id = r.id;
    v_n := v_n + 1;
    RAISE NOTICE '135: phiếu trả của đơn % lùi về nháp cùng đơn.', r.order_code;
  END LOOP;
  RAISE NOTICE '--- 135: lùi % phiếu trả về nháp ---', v_n;
END;
$fix$;

NOTIFY pgrst, 'reload schema';


-- ####################################################################
-- # 136_committed_stock.sql
-- ####################################################################

-- =====================================================================
-- 136 — HÀNG ĐÃ ĐẶT NHƯNG CHƯA RỜI KHO
-- =====================================================================
--
-- VÌ SAO
--   Chủ nhà chốt hai việc:
--     1. "Thống kê hàng đặt, đổi trong đơn đã gửi (Phiếu tạm) để cạnh
--        tồn kho trong hiển thị mặt hàng"
--     2. "số lượng đặt hoặc đổi ko được lớn hơn tồn kho − hàng đã đặt
--        (hàng này chưa trừ kho nhưng đã đặt trong các đơn khác)"
--
--   Kho chỉ bị trừ ở `post_invoice` (lúc Xuất hàng). Từ lúc nhân viên
--   gửi Phiếu tạm tới lúc xuất, hàng vẫn nằm nguyên trong `batches` —
--   nên màn bán hàng đọc "Tồn 2.838" và BA nhân viên cùng bán hết 2.838
--   ấy trong cùng một buổi sáng. Không màn nào nói dối, chỉ là không màn
--   nào biết hai người kia đã hứa gì với khách.
--
-- ⚠ VÌ SAO PHẢI LÀ `SECURITY DEFINER`, DÙ MIG 093 CẤM ĐIỀU ĐÓ
--   RLS cho vai trò `sales` CHỈ thấy đơn của CHÍNH MÌNH
--   (002_rls_policies.sql:286-293 "Sales see own orders"). Cộng số đã
--   đặt bằng quyền người gọi thì mỗi nhân viên chỉ trừ được phần mình
--   đã hứa — tức là đúng cái lỗ hổng cần bịt vẫn còn nguyên, và tệ hơn
--   là màn hình trông như đã bịt.
--
--   Lệnh cấm ở mig 093 là về SỐ LIỆU TÀI CHÍNH (công nợ, doanh thu, lãi
--   lỗ). Hàm này trả về ĐÚNG hai cột: mã hàng và số lượng theo đơn vị cơ
--   sở. Không tiền, không khách, không mã đơn, không nhân viên. Đó cùng
--   một hạng thông tin với `batches.qty_on_hand` mà mọi vai trò đã nhìn
--   thấy trên màn bán hàng — chỉ là phần đã có người hứa trước.
--
-- ⚠ CHỈ ĐẾM ĐƠN ĐÃ GỬI. `draft` KHÔNG tính: nháp là giỏ hàng riêng của
--   một nhân viên, chưa hứa với ai. Đếm cả nháp là một cái nháp bỏ quên
--   từ tuần trước khoá luôn hàng của cả đơn vị, và người bị chặn không
--   có cách nào nhìn thấy cái nháp đó để mà xoá.
--
-- ⚠ `partially_invoiced` CÓ tính, nhưng chỉ phần CÒN LẠI
--   (`quantity − invoiced_qty`). Phần đã xuất đã trừ kho thật rồi; đếm
--   lại là trừ hai lần trên cùng một số hàng.
--
-- ⚠ HÀNG ĐỔI CŨNG RỜI KHO. Dòng `return_lines.is_exchange` của phiếu
--   trả kèm đơn đi theo đúng chuyến ấy — `get_invoiceable_lines`
--   (mig 125) đã coi chúng là hàng xuất. Không đếm ở đây thì phần đổi
--   biến mất khỏi phép trừ.
--
-- ⚠ ĐỔI ĐÃ XUẤT THÌ THÔI. `post_invoice` gắn `returns.invoice_id`; dấu
--   đó nghĩa là hàng đã đi. Thiếu điều kiện `invoice_id IS NULL` là trừ
--   hai lần đúng như trên.
--
-- ⚠ `return_lines` KHÔNG CÓ CỘT HỆ SỐ QUY ĐỔI (khác `sales_order_lines`).
--   Phải tra `product_units`, và cột ở bảng đó tên là `conversion`, KHÔNG
--   phải `conversion_factor` — gõ nhầm là 42703 lúc chạy. Cùng cái bẫy
--   mig 119 đã ghi lại.
--
-- ⚠ `p_exclude_order` LÀ BẮT BUỘC, KHÔNG PHẢI TIỆN ÍCH. Sửa một Phiếu
--   tạm mà không loại chính nó ra thì đơn tự chặn chính mình: 100 thùng
--   đã đặt của nó bị trừ khỏi tồn, rồi 100 thùng trong giỏ so với phần
--   còn lại → luôn vượt, không ai sửa nổi đơn của mình.

-- ---------------------------------------------------------------------
-- 1. Hàm cộng số đã đặt
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.committed_stock_by_product(uuid);

CREATE FUNCTION public.committed_stock_by_product(p_exclude_order uuid DEFAULT NULL)
RETURNS TABLE (product_id uuid, committed_base numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  v_org := public.user_org_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'NO_ORG: Tài khoản chưa được gắn đơn vị nên không đọc được số hàng đã đặt.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  WITH live_orders AS (
    SELECT so.id
    FROM sales_orders so
    WHERE so.org_id = v_org
      AND so.status IN ('submitted', 'partially_invoiced')
      AND (p_exclude_order IS NULL OR so.id <> p_exclude_order)
  ),
  from_lines AS (
    SELECT sol.product_id AS pid,
           SUM(
             GREATEST(0, sol.quantity - COALESCE(sol.invoiced_qty, 0))
             * COALESCE(sol.conversion_factor, 1)
           ) AS qty
    FROM sales_order_lines sol
    JOIN live_orders lo ON lo.id = sol.order_id
    GROUP BY sol.product_id
  ),
  from_exchange AS (
    SELECT rl.product_id AS pid,
           SUM(rl.quantity * COALESCE(pu.conversion, 1)) AS qty
    FROM return_lines rl
    JOIN returns r ON r.id = rl.return_id
    JOIN live_orders lo ON lo.id = r.order_id
    LEFT JOIN product_units pu
           ON pu.product_id = rl.product_id
          AND pu.unit_name  = rl.unit_name
    WHERE rl.is_exchange = true
      AND r.invoice_id IS NULL
      AND r.status IN ('draft', 'submitted')
    GROUP BY rl.product_id
  )
  SELECT x.pid, SUM(x.qty)::numeric
  FROM (SELECT * FROM from_lines UNION ALL SELECT * FROM from_exchange) x
  GROUP BY x.pid
  HAVING SUM(x.qty) > 0;
END;
$$;

COMMENT ON FUNCTION public.committed_stock_by_product(uuid) IS
  'Số hàng (đơn vị cơ sở) đã hứa trong Phiếu tạm / đơn xuất một phần của đơn vị người gọi nhưng CHƯA trừ kho. Gồm cả dòng đổi hàng chưa xuất. p_exclude_order: bỏ qua đơn đang sửa.';

-- ⚠ SECURITY DEFINER thì phải khoá lại quyền gọi. Mặc định Postgres cấp
--   EXECUTE cho PUBLIC — để nguyên là ai chạm được database cũng gọi được.
REVOKE ALL ON FUNCTION public.committed_stock_by_product(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.committed_stock_by_product(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. Chỉ mục cho phép cộng ở trên
-- ---------------------------------------------------------------------
-- Không có nó thì mỗi lần mở màn bán hàng là một lần quét toàn bảng đơn.
CREATE INDEX IF NOT EXISTS idx_sales_orders_org_status
  ON sales_orders (org_id, status);
CREATE INDEX IF NOT EXISTS idx_return_lines_exchange
  ON return_lines (product_id) WHERE is_exchange = true;

-- ---------------------------------------------------------------------
-- 3. Kiểm: nói ra con số ngay lúc chạy migration
-- ---------------------------------------------------------------------
DO $check$
DECLARE
  v_orders int;
  v_lines  int;
  v_ex     int;
BEGIN
  SELECT count(*) INTO v_orders
  FROM sales_orders WHERE status IN ('submitted', 'partially_invoiced');

  SELECT count(*) INTO v_lines
  FROM sales_order_lines sol
  JOIN sales_orders so ON so.id = sol.order_id
  WHERE so.status IN ('submitted', 'partially_invoiced')
    AND GREATEST(0, sol.quantity - COALESCE(sol.invoiced_qty, 0)) > 0;

  SELECT count(*) INTO v_ex
  FROM return_lines rl
  JOIN returns r ON r.id = rl.return_id
  JOIN sales_orders so ON so.id = r.order_id
  WHERE rl.is_exchange = true
    AND r.invoice_id IS NULL
    AND r.status IN ('draft', 'submitted')
    AND so.status IN ('submitted', 'partially_invoiced');

  RAISE NOTICE '--- 136: % đơn đang giữ hàng, % dòng bán còn lại, % dòng đổi chưa xuất ---',
    v_orders, v_lines, v_ex;
END;
$check$;

NOTIFY pgrst, 'reload schema';


-- ####################################################################
-- # 137_committed_stock_stable_order.sql
-- ####################################################################

-- ====================================================================
-- 137_committed_stock_stable_order
--
-- VÌ SAO CÓ BẢN VÁ NÀY
--
-- `committed_stock_by_product` (mig 136) trả về danh sách "hàng đã đặt
-- nhưng chưa rời kho", và trình duyệt đọc nó QUA NHIỀU TRANG:
-- `fetchAllForAggregate` gọi `.range(from, to)` nhiều lần, SONG SONG.
--
-- Hàm ở 136 kết thúc bằng `GROUP BY ... HAVING ...` và KHÔNG có `ORDER
-- BY`. Không có thứ tự cố định thì Postgres được quyền trả mỗi lần gọi
-- một thứ tự khác nhau — nên `OFFSET/LIMIT` chồng lên nó vừa LẶP dòng
-- vừa BỎ SÓT dòng.
--
-- ⚠ BỎ SÓT MỘT SẢN PHẨM NGHĨA LÀ SỐ "ĐÃ ĐẶT" CỦA NÓ VỀ 0, và màn bán
--   hàng lấy `tồn − 0 = tồn` làm mức cho phép đặt. Đó đúng là chuyện chủ
--   nhà báo: "vẫn cho nhân viên đặt hàng quá số lượng có thể đặt (tồn
--   kho − hàng đã đặt)". Lỗi chỉ lộ ra khi số mặt hàng đang có người đặt
--   vượt một trang (1.000 dòng) — tức là đúng lúc kho đã bận rộn.
--
-- ⚠ KHÔNG SỬA THẲNG VÀO FILE 136. Không biết chắc 136 đã chạy trên máy
--   chủ hay chưa; sửa tại chỗ thì máy đã chạy rồi sẽ không nhận được
--   thay đổi này. Một bản vá mới thì chạy được ở cả hai trường hợp.
--
-- KHÔNG ĐỔI GÌ KHÁC: cùng chữ ký, cùng phép tính, cùng quyền. Chỉ thêm
-- `ORDER BY` để việc chia trang có mốc ổn định.
-- ====================================================================

DROP FUNCTION IF EXISTS public.committed_stock_by_product(uuid);

CREATE FUNCTION public.committed_stock_by_product(p_exclude_order uuid DEFAULT NULL)
RETURNS TABLE (product_id uuid, committed_base numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  v_org := public.user_org_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'NO_ORG: Tài khoản chưa được gắn đơn vị nên không đọc được số hàng đã đặt.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  WITH live_orders AS (
    SELECT so.id
    FROM sales_orders so
    WHERE so.org_id = v_org
      AND so.status IN ('submitted', 'partially_invoiced')
      AND (p_exclude_order IS NULL OR so.id <> p_exclude_order)
  ),
  from_lines AS (
    SELECT sol.product_id AS pid,
           SUM(
             GREATEST(0, sol.quantity - COALESCE(sol.invoiced_qty, 0))
             * COALESCE(sol.conversion_factor, 1)
           ) AS qty
    FROM sales_order_lines sol
    JOIN live_orders lo ON lo.id = sol.order_id
    GROUP BY sol.product_id
  ),
  from_exchange AS (
    SELECT rl.product_id AS pid,
           SUM(rl.quantity * COALESCE(pu.conversion, 1)) AS qty
    FROM return_lines rl
    JOIN returns r ON r.id = rl.return_id
    JOIN live_orders lo ON lo.id = r.order_id
    LEFT JOIN product_units pu
           ON pu.product_id = rl.product_id
          AND pu.unit_name  = rl.unit_name
    WHERE rl.is_exchange = true
      AND r.invoice_id IS NULL
      AND r.status IN ('draft', 'submitted')
    GROUP BY rl.product_id
  )
  SELECT x.pid, SUM(x.qty)::numeric
  FROM (SELECT * FROM from_lines UNION ALL SELECT * FROM from_exchange) x
  GROUP BY x.pid
  HAVING SUM(x.qty) > 0
  -- ⚠ DÒNG DUY NHẤT THÊM SO VỚI 136 — xem phần đầu file. `pid` là khoá
  --   chính của `products` nên luôn duy nhất: mốc chia trang ổn định.
  ORDER BY x.pid;
END;
$$;

COMMENT ON FUNCTION public.committed_stock_by_product(uuid) IS
  'Số hàng (đơn vị cơ sở) đã hứa trong Phiếu tạm / đơn xuất một phần của đơn vị người gọi nhưng CHƯA trừ kho. Gồm cả dòng đổi hàng chưa xuất. p_exclude_order: bỏ qua đơn đang sửa. ORDER BY product_id để trình duyệt chia trang không lặp/sót dòng (mig 137).';

-- ⚠ SECURITY DEFINER thì phải khoá lại quyền gọi. `DROP` ở trên xoá luôn
--   mọi GRANT cũ, nên phải cấp lại — thiếu khối này là cả màn bán hàng
--   mất số "đã đặt" và quay về đúng lỗ hổng bản vá này đang bịt.
REVOKE ALL ON FUNCTION public.committed_stock_by_product(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.committed_stock_by_product(uuid) TO authenticated;

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'committed_stock_by_product';
  RAISE NOTICE '137: committed_stock_by_product — % hàm đang tồn tại, đã gắn ORDER BY product_id.', v_n;
END $$;

NOTIFY pgrst, 'reload schema';


-- ####################################################################
-- # 138_sale_zone_only.sql
-- ####################################################################

-- ====================================================================
-- 138_sale_zone_only
--
-- CHỦ NHÀ CHỐT 20/09/2026: "Hàng trong kho cận date không được bán."
--
-- VÌ SAO CẦN BẢN VÁ NÀY
--
-- Trước hôm nay hệ thống có BA câu trả lời khác nhau cho cùng câu hỏi
-- "hàng nào bán được":
--   · màn bán hàng      — cộng MỌI vùng kho (sale + date);
--   · get_invoiceable_lines (mig 125) — chỉ vùng 'sale';
--   · post_stock_export (mig 119)     — trừ FIFO qua MỌI vùng kho.
--
-- Hệ quả thật, chủ nhà đã gặp: nhân viên đặt được số lượng mà màn Xuất
-- hàng báo "Thiếu N đơn vị cơ sở, bấm Xuất hàng sẽ bị từ chối" — trong
-- khi phép trừ kho lại chấp nhận, vì nó lấy cả hàng cận date. Một tờ
-- giấy nói không, một phép tính nói có.
--
-- Bản vá này chốt MỘT câu trả lời: chỉ vùng 'sale'. `get_invoiceable_lines`
-- vốn đã đúng nên không đụng tới; màn bán hàng sửa ở phía trình duyệt.
--
-- ⚠ HÀNG CẬN DATE KHÔNG BỊ NHỐT. Migration 028 cho chuyển vùng lô hàng
--   bằng tay; muốn bán xả thì chuyển lô về vùng 'sale' rồi bán như
--   thường. Đó là cái cửa đã có sẵn, bản vá này không bịt.
--
-- ⚠ ẢNH HƯỞNG TỚI CẢ PHIẾU XUẤT KHO THỦ CÔNG (/inventory/entries), vì
--   `post_stock_export` là chỗ trừ kho DUY NHẤT cho mọi phiếu `export`.
--   Từ nay một phiếu xuất chạm vào hàng cận date sẽ bị từ chối kèm câu
--   nói rõ lý do và cách gỡ, chứ không âm thầm lấy hàng cận date ra.
--
-- CHÉP NGUYÊN VĂN bản hiện hành (mig 119), THÊM: lọc vùng ở hai câu đọc
-- `batches`, và một câu báo lỗi nói rõ khi hàng đang nằm ở kho cận date.
-- Không đổi gì khác trong hàm.
-- ====================================================================

CREATE OR REPLACE FUNCTION post_stock_export(p_entry_id uuid)
RETURNS TABLE (
  posted boolean,
  total_cost numeric,
  short_qty numeric,
  near_expiry_skipped int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org             uuid;
  v_status          text;
  v_type            text;
  v_allow_oversell  boolean;
  v_total_cost      numeric := 0;
  v_short           numeric := 0;
  v_near            int     := 0;
  l                 record;
  b                 record;
  v_remaining       numeric;
  v_take            numeric;
  v_cost_sum        numeric;
  v_qty_taken       numeric;
  v_best_id         uuid;
  v_best_qty        numeric;
  v_detail          text;
  v_lots            int;
  v_min_expiry      date;
  v_prod_name       text;
  v_date_qty        numeric;
BEGIN
  -- Khoá phiếu TRƯỚC khi đọc trạng thái. Đọc rồi mới khoá thì hai lượt
  -- chạy song song đều thấy 'draft' và cùng đi tiếp.
  SELECT org_id, status, type
    INTO v_org, v_status, v_type
  FROM stock_entries
  WHERE id = p_entry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTRY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF v_type <> 'export' THEN
    RAISE EXCEPTION 'NOT_AN_EXPORT: phiếu % không phải phiếu xuất', v_type
      USING ERRCODE = 'P0001';
  END IF;

  -- Đã ghi sổ rồi thì KHÔNG làm gì. Đây là lá chắn chống trừ hai lần:
  -- trả về posted = false để nơi gọi biết là không có gì xảy ra, chứ
  -- không phải báo lỗi — bấm lại lần nữa là chuyện bình thường.
  IF v_status <> 'draft' THEN
    RETURN QUERY SELECT false, 0::numeric, 0::numeric, 0;
    RETURN;
  END IF;

  SELECT COALESCE(allow_oversell, false) INTO v_allow_oversell
  FROM organizations WHERE id = v_org;

  FOR l IN
    SELECT sel.id,
           sel.product_id,
           sel.notes,
           COALESCE(sel.qty_in_base_uom, sel.quantity, 0)::numeric AS need
    FROM stock_entry_lines sel
    WHERE sel.entry_id = p_entry_id
    ORDER BY sel.id
  LOOP
    CONTINUE WHEN l.need <= 0;

    v_remaining := l.need;
    v_cost_sum  := 0;
    v_qty_taken := 0;
    v_best_id   := NULL;
    v_best_qty  := 0;
    v_detail    := '';
    v_lots      := 0;

    -- Hạn gần nhất đang có, đo TRƯỚC khi trừ. Dùng để biết FIFO có bỏ
    -- qua lô cận hạn hơn không.
    SELECT MIN(expires_at) INTO v_min_expiry
    FROM batches
    WHERE org_id = v_org AND product_id = l.product_id AND qty_on_hand > 0
      AND COALESCE(warehouse_zone, 'sale') = 'sale';

    FOR b IN
      SELECT id, qty_on_hand, unit_cost, batch_code, expires_at
      FROM batches
      WHERE org_id = v_org
        AND product_id = l.product_id
        AND qty_on_hand > 0
        -- ⚠ CHỈ KHO BÁN. Xem đầu file bản vá 138.
        AND COALESCE(warehouse_zone, 'sale') = 'sale'
      -- FIFO: hàng vào kho trước đi trước. `created_at` và `id` chỉ để
      -- hai lô cùng mốc vẫn có thứ tự cố định — không có chúng thì thứ
      -- tự do Postgres tự chọn, và mỗi lần chạy lại một khác.
      ORDER BY received_at ASC, created_at ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_take := LEAST(b.qty_on_hand, v_remaining);

      UPDATE batches
      SET qty_on_hand = qty_on_hand - v_take
      WHERE id = b.id;

      -- 119 — DÒNG DUY NHẤT THÊM VÀO HÀM NÀY.
      -- Trước đây chỉ lô lấy NHIỀU NHẤT được ghi vào stock_entry_lines.batch_id,
      -- phần còn lại nằm trong notes dạng chữ. Hoàn kho khi sửa hoặc huỷ đơn
      -- đã xuất thì không dò ngược được đã lấy bao nhiêu từ lô nào. Ghi lại
      -- từng lần lấy để trả đúng chỗ.
      INSERT INTO stock_line_consumptions (line_id, batch_id, qty_in_base_uom, unit_cost)
      VALUES (l.id, b.id, v_take, COALESCE(b.unit_cost, 0));

      v_cost_sum  := v_cost_sum + v_take * COALESCE(b.unit_cost, 0);
      v_qty_taken := v_qty_taken + v_take;
      v_remaining := v_remaining - v_take;
      v_lots      := v_lots + 1;

      IF v_take > v_best_qty THEN
        v_best_qty := v_take;
        v_best_id  := b.id;
      END IF;

      v_detail := v_detail
        || CASE WHEN v_detail = '' THEN '' ELSE ', ' END
        || COALESCE(b.batch_code, left(b.id::text, 8)) || '×' || v_take::text;

      -- Lấy một lô có hạn XA HƠN lô gần hạn nhất đang nằm trong kho:
      -- đúng cái giá phải trả của FIFO. Đếm lại để màn hình nói ra.
      IF v_min_expiry IS NOT NULL AND b.expires_at > v_min_expiry THEN
        v_near := v_near + 1;
      END IF;
    END LOOP;

    IF v_remaining > 0 THEN
      IF NOT v_allow_oversell THEN
        SELECT name INTO v_prod_name FROM products WHERE id = l.product_id;
        /*
          ⚠ NÓI RÕ KHI HÀNG ĐANG NẰM Ở KHO CẬN DATE. Không có vế này thì
          người dùng đọc "thiếu 20 đơn vị" trong khi màn tồn kho hiện
          rành rành 200 — và họ đi đếm lại kho thay vì đi chuyển vùng lô
          hàng, việc duy nhất gỡ được.
        */
        SELECT COALESCE(sum(qty_on_hand), 0) INTO v_date_qty
        FROM batches
        WHERE org_id = v_org AND product_id = l.product_id AND qty_on_hand > 0
          AND COALESCE(warehouse_zone, 'sale') = 'date';
        IF v_date_qty > 0 THEN
          RAISE EXCEPTION
            'INSUFFICIENT_STOCK: thiếu % đơn vị của "%" ở kho bán — còn % đơn vị nhưng đang nằm ở KHO CẬN DATE, không bán được. Chuyển vùng lô hàng nếu muốn bán.',
            v_remaining, COALESCE(v_prod_name, l.product_id::text), v_date_qty
            USING ERRCODE = 'P0001';
        END IF;
        RAISE EXCEPTION
          'INSUFFICIENT_STOCK: thiếu % đơn vị của "%" — ghi sổ phiếu xuất sẽ làm tồn kho âm',
          v_remaining, COALESCE(v_prod_name, l.product_id::text)
          USING ERRCODE = 'P0001';
      END IF;
      -- Cho phép bán âm thì vẫn ghi sổ, nhưng cộng dồn để trả về. Im
      -- lặng ở đây là để người ta phát hiện ra vào lúc kiểm kê.
      v_short := v_short + v_remaining;
    END IF;

    -- Đóng giá vốn lên dòng. `batch_id` là khoá đơn nên chỉ giữ được MỘT
    -- lô — ghi lô lấy nhiều nhất, và ghi đủ danh sách vào notes để còn
    -- truy ngược được hạn dùng của hàng đã bán (hàng FMCG cần điều đó).
    UPDATE stock_entry_lines
    SET unit_cost = CASE WHEN v_qty_taken > 0
                         THEN v_cost_sum / v_qty_taken
                         ELSE unit_cost END,
        batch_id  = COALESCE(v_best_id, batch_id),
        notes     = CASE
                      WHEN v_lots > 1
                      THEN trim(both ' •' from COALESCE(l.notes, '')) ||
                           CASE WHEN COALESCE(l.notes, '') = '' THEN '' ELSE ' • ' END ||
                           'Lô: ' || v_detail
                      ELSE notes
                    END
    WHERE id = l.id;

    v_total_cost := v_total_cost + v_cost_sum;
  END LOOP;

  UPDATE stock_entries
  SET status = 'posted',
      posted_at = COALESCE(posted_at, now())
  WHERE id = p_entry_id;

  RETURN QUERY SELECT true, v_total_cost, v_short, v_near;
END;
$$;

DO $$
DECLARE v_sale numeric; v_date numeric;
BEGIN
  SELECT COALESCE(sum(qty_on_hand),0) INTO v_sale FROM batches
   WHERE qty_on_hand > 0 AND COALESCE(warehouse_zone,'sale') = 'sale';
  SELECT COALESCE(sum(qty_on_hand),0) INTO v_date FROM batches
   WHERE qty_on_hand > 0 AND COALESCE(warehouse_zone,'sale') = 'date';
  RAISE NOTICE '--- 138: kho bán % đơn vị · kho cận date % đơn vị (từ nay KHÔNG bán được) ---', v_sale, v_date;
END $$;

NOTIFY pgrst, 'reload schema';


-- ####################################################################
-- # 139_cancel_stock_entry.sql
-- ####################################################################

-- ====================================================================
-- 139_cancel_stock_entry
--
-- CHỦ NHÀ BÁO 20/09/2026: "Khi huỷ phiếu nhập kho → kho không thay đổi."
--
-- VÌ SAO ĐÂY LÀ LỖ THỦNG SỔ SÁCH, KHÔNG PHẢI MỘT NÚT THIẾU
--
-- Huỷ phiếu kho hiện là một lệnh ghi thẳng từ trình duyệt:
--     UPDATE stock_entries SET status = 'cancelled' WHERE id = ...
-- Nó KHÔNG đụng `batches`, KHÔNG kiểm trạng thái hiện tại, và KHÔNG
-- kiểm xem có dòng nào bị RLS từ chối hay không. Hệ quả:
--   · huỷ phiếu NHẬP đã ghi sổ  → kho giữ lại hàng chưa từng có thật;
--   · huỷ phiếu XUẤT đã ghi sổ  → kho thiếu hàng vĩnh viễn;
--   · RLS từ chối → 0 dòng, HTTP 200, app vẫn báo "Đã hủy phiếu".
-- Cả hai chiều đều làm `batches` lệch `stock_entries`, và không có gì
-- trên màn hình nói ra.
--
-- ⚠ "ĐÃ XUẤT THÌ CHỈ CHO SỬA" (chủ nhà chốt). Nếu hàng của phiếu nhập đã
--   bán bớt thì hoàn lại sẽ làm lô âm — hàm này TỪ CHỐI và nói rõ còn
--   bao nhiêu, thay vì hoàn một phần rồi để sổ tự lệch.
--
-- ⚠ PHIẾU XUẤT CỦA MỘT HÓA ĐƠN KHÔNG HUỶ Ở ĐÂY. Huỷ hóa đơn còn phải xoá
--   công nợ và lùi trạng thái đơn — việc của `cancel_invoice` (mig 125).
--   Huỷ riêng phiếu kho là hoàn hàng về mà sổ nợ vẫn ghi khách còn nợ.
--
-- ⚠ HOÀN PHIẾU XUẤT PHẢI DỰA TRÊN `stock_line_consumptions` (mig 119) —
--   bảng ghi đã lấy bao nhiêu từ ĐÚNG lô nào. Phiếu xuất ghi sổ TRƯỚC
--   mig 119 không có dòng nào ở đó, nên không thể biết trả về lô nào:
--   hàm TỪ CHỐI và nói ra, chứ không đoán.
--
-- ⚠ PHIẾU CHUYỂN KHO / KIỂM KÊ chưa có đường hoàn ở đây. Từ chối kèm câu
--   giải thích còn hơn âm thầm đổi trạng thái mà không đụng kho — đó
--   đúng là hành vi đang hỏng.
--
-- IDEMPOTENT: phiếu đã huỷ rồi thì trả về `reversed = false` và không
-- làm gì. Bấm hai lần là chuyện bình thường, không phải lỗi.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.cancel_stock_entry(
  p_entry_id uuid,
  p_reason   text DEFAULT NULL
)
RETURNS TABLE (cancelled boolean, reversed boolean, lines_reversed int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org      uuid;
  v_status   text;
  v_type     text;
  v_code     text;
  l          record;
  c          record;
  v_n        int := 0;
  v_have     numeric;
  v_need     numeric;
  v_prod     text;
  v_inv      text;
BEGIN
  -- Khoá phiếu TRƯỚC khi đọc trạng thái: đọc rồi mới khoá thì hai lượt
  -- chạy song song đều thấy 'posted' và cùng hoàn kho một lần nữa.
  SELECT org_id, status, type, entry_code
    INTO v_org, v_status, v_type, v_code
  FROM stock_entries WHERE id = p_entry_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTRY_NOT_FOUND: không tìm thấy phiếu kho này.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH: phiếu này không thuộc đơn vị của bạn.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Đã huỷ rồi thì thôi. KHÔNG báo lỗi: bấm lại lần nữa là chuyện
  -- thường, và báo lỗi ở đây làm người dùng tưởng mình vừa làm hỏng.
  IF v_status = 'cancelled' THEN
    RETURN QUERY SELECT true, false, 0;
    RETURN;
  END IF;

  -- Phiếu nháp chưa trừ/cộng gì, chỉ cần đổi trạng thái.
  IF v_status <> 'posted' THEN
    UPDATE stock_entries
       SET status = 'cancelled',
           notes  = COALESCE(notes || E'\n', '') || 'Huỷ phiếu: ' || COALESCE(p_reason, '(không ghi lý do)')
     WHERE id = p_entry_id;
    RETURN QUERY SELECT true, false, 0;
    RETURN;
  END IF;

  -- ---- Từ đây là phiếu ĐÃ GHI SỔ: phải hoàn kho trước khi đổi trạng thái.

  IF v_type NOT IN ('import', 'export') THEN
    RAISE EXCEPTION
      'CANNOT_REVERSE_TYPE: phiếu % (%) đã ghi sổ nhưng chưa có đường hoàn kho cho loại phiếu này. Dùng phiếu điều chỉnh để sửa tồn.',
      v_code, v_type USING ERRCODE = 'P0001';
  END IF;

  IF v_type = 'export' THEN
    -- Phiếu xuất của một hóa đơn còn hiệu lực phải đi qua `cancel_invoice`.
    SELECT si.invoice_code INTO v_inv
    FROM sales_invoices si
    WHERE si.stock_entry_id = p_entry_id AND si.status = 'posted'
    LIMIT 1;
    IF v_inv IS NOT NULL THEN
      RAISE EXCEPTION
        'ENTRY_HAS_INVOICE: phiếu % thuộc hóa đơn %. Huỷ hóa đơn đó thay vì huỷ riêng phiếu kho — huỷ riêng thì hàng về kho mà sổ nợ vẫn ghi khách còn nợ.',
        v_code, v_inv USING ERRCODE = 'P0001';
    END IF;

    -- Không có vết đã lấy lô nào thì KHÔNG đoán.
    IF NOT EXISTS (
      SELECT 1 FROM stock_line_consumptions slc
      JOIN stock_entry_lines sel ON sel.id = slc.line_id
      WHERE sel.entry_id = p_entry_id
    ) THEN
      RAISE EXCEPTION
        'NO_CONSUMPTION_TRACE: phiếu % ghi sổ trước khi hệ thống lưu vết lấy lô, nên không biết trả hàng về lô nào. Dùng phiếu điều chỉnh để sửa tồn.',
        v_code USING ERRCODE = 'P0001';
    END IF;

    FOR c IN
      SELECT slc.batch_id, SUM(slc.qty_in_base_uom) AS qty
      FROM stock_line_consumptions slc
      JOIN stock_entry_lines sel ON sel.id = slc.line_id
      WHERE sel.entry_id = p_entry_id
      GROUP BY slc.batch_id
    LOOP
      UPDATE batches SET qty_on_hand = qty_on_hand + c.qty WHERE id = c.batch_id;
      v_n := v_n + 1;
    END LOOP;

  ELSE  -- import
    FOR l IN
      SELECT sel.id, sel.batch_id, sel.product_id,
             COALESCE(sel.qty_in_base_uom, sel.quantity, 0)::numeric AS qty
      FROM stock_entry_lines sel
      WHERE sel.entry_id = p_entry_id
      ORDER BY sel.id
    LOOP
      CONTINUE WHEN l.qty <= 0;

      IF l.batch_id IS NULL THEN
        SELECT name INTO v_prod FROM products WHERE id = l.product_id;
        RAISE EXCEPTION
          'NO_BATCH_LINK: dòng "%" của phiếu % không ghi lô nào, nên không biết rút hàng ra khỏi đâu. Dùng phiếu điều chỉnh để sửa tồn.',
          COALESCE(v_prod, l.product_id::text), v_code USING ERRCODE = 'P0001';
      END IF;

      SELECT qty_on_hand INTO v_have FROM batches WHERE id = l.batch_id FOR UPDATE;

      /*
        ⚠ "ĐÃ XUẤT THÌ CHỈ CHO SỬA" — chủ nhà chốt. Hàng của lô này đã
        bán bớt thì rút hết về sẽ làm lô âm. Từ chối và nói rõ còn bao
        nhiêu, để người dùng biết đường sửa phiếu thay vì huỷ.
      */
      IF COALESCE(v_have, 0) < l.qty THEN
        SELECT name INTO v_prod FROM products WHERE id = l.product_id;
        RAISE EXCEPTION
          'ALREADY_ISSUED: "%" của phiếu % đã xuất bớt — nhập % nhưng lô chỉ còn %. Phiếu đã xuất thì chỉ SỬA được, không huỷ được.',
          COALESCE(v_prod, l.product_id::text), v_code, l.qty, COALESCE(v_have, 0)
          USING ERRCODE = 'P0001';
      END IF;

      UPDATE batches SET qty_on_hand = qty_on_hand - l.qty WHERE id = l.batch_id;
      v_n := v_n + 1;
    END LOOP;
  END IF;

  UPDATE stock_entries
     SET status = 'cancelled',
         notes  = COALESCE(notes || E'\n', '') || 'Huỷ phiếu: ' || COALESCE(p_reason, '(không ghi lý do)')
   WHERE id = p_entry_id;

  RETURN QUERY SELECT true, true, v_n;
END;
$$;

COMMENT ON FUNCTION public.cancel_stock_entry(uuid, text) IS
  'Huỷ một phiếu kho VÀ hoàn kho trong cùng một giao dịch. Phiếu nhập: rút hàng khỏi lô đã tạo, từ chối nếu đã xuất bớt. Phiếu xuất: trả về đúng lô theo stock_line_consumptions, từ chối nếu phiếu thuộc hóa đơn còn hiệu lực. Idempotent.';

-- ⚠ SECURITY DEFINER thì phải khoá lại quyền gọi. Mặc định Postgres cấp
--   EXECUTE cho PUBLIC — để nguyên là ai chạm được database cũng gọi được.
REVOKE ALL ON FUNCTION public.cancel_stock_entry(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_stock_entry(uuid, text) TO authenticated;

DO $$
DECLARE v_posted int; v_no_trace int;
BEGIN
  SELECT count(*) INTO v_posted FROM stock_entries WHERE status = 'posted';
  SELECT count(*) INTO v_no_trace
  FROM stock_entries se
  WHERE se.status = 'posted' AND se.type = 'export'
    AND NOT EXISTS (
      SELECT 1 FROM stock_line_consumptions slc
      JOIN stock_entry_lines sel ON sel.id = slc.line_id
      WHERE sel.entry_id = se.id
    );
  RAISE NOTICE '--- 139: % phiếu đã ghi sổ · % phiếu xuất KHÔNG có vết lấy lô (huỷ sẽ bị từ chối, phải dùng phiếu điều chỉnh) ---',
    v_posted, v_no_trace;
END $$;

NOTIFY pgrst, 'reload schema';


-- ####################################################################
-- # 140_vn_today.sql
-- ####################################################################

-- ====================================================================
-- 140 — TUỔI NỢ TÍNH THEO NGÀY VIỆT NAM, KHÔNG THEO NGÀY UTC
-- ====================================================================
--
-- VÌ SAO
--   Trình duyệt tính tuổi nợ bằng ngày giờ Việt Nam (`daysOverdueOf`
--   trong `src/lib/utils.ts` — có chú thích dài giải thích vì sao). Máy
--   chủ Supabase chạy giờ UTC, nên `CURRENT_DATE` trong SQL là ngày UTC.
--
--   Việt Nam đi trước UTC 7 tiếng. Từ 00:00 tới 07:00 giờ Việt Nam mỗi
--   ngày, `CURRENT_DATE` vẫn còn là NGÀY HÔM QUA. Trong bảy tiếng đó:
--
--     · Ô tổng đầu trang Công nợ (`receivables_summary`) xếp một khoản
--       đến hạn HÔM NAY vào nhóm "chưa tới hạn", trong khi bảng ngay
--       bên dưới — do trình duyệt tính — đã xếp nó sang "quá hạn".
--       Cùng một màn hình, hai câu trả lời khác nhau về cùng một phiếu.
--     · Số ngày quá hạn trung bình (DSO) của từng nhân viên
--       (`receivables_by_rep`) thấp hơn đúng một ngày.
--
--   Bảy tiếng đó không phải giờ chết: kho bắt đầu soạn hàng từ 5-6 giờ
--   sáng, và đó chính là lúc người ta mở màn Công nợ để quyết định có
--   cho khách nợ thêm hay không.
--
-- ⚠ VÌ SAO LÀ MỘT HÀM CHỨ KHÔNG PHẢI SỬA TẠI CHỖ. `CURRENT_DATE` xuất
--   hiện ở nhiều hàm, và mỗi lần viết lại `(now() AT TIME ZONE ...)` là
--   một cơ hội gõ sai tên múi giờ mà không ai phát hiện — Postgres chỉ
--   ném lỗi lúc CHẠY, tức là lúc người dùng bấm. Một hàm `vn_today()`
--   thì sai một lần là sai ngay khi chạy migration.
--
-- ⚠ KHÔNG ĐỔI `timezone` CỦA CẢ CƠ SỞ DỮ LIỆU. Làm vậy là đổi nghĩa của
--   MỌI `CURRENT_DATE`, `now()::date` và mọi giá trị mặc định
--   `DEFAULT CURRENT_DATE` trong toàn bộ kho — kể cả những chỗ đang
--   đúng và những chỗ chưa ai đọc lại. Sửa đúng hai hàm đang sai thì
--   biết chắc mình vừa đổi cái gì.
--
-- ⚠ CHƯA ĐỤNG TỚI `028_warehouse_zones.sql` (`expires_at <=
--   CURRENT_DATE + threshold`). Cùng một lệch bảy tiếng, nhưng trên một
--   ngưỡng 30-60 ngày thì nó chỉ làm một lô vào kho cận date muộn hơn
--   bảy tiếng — và đó là một trigger đụng vào việc chia kho, không phải
--   một ô số liệu. Ghi ra đây để lần sau không phải đi tìm lại.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. vn_today() — hôm nay theo lịch Việt Nam.
-- --------------------------------------------------------------------
-- ⚠ `STABLE` chứ không `IMMUTABLE`: giá trị đổi theo thời điểm gọi.
--   Khai `IMMUTABLE` là cho phép Postgres nhớ kết quả vào chỉ mục và
--   trả về một ngày đã cũ.
CREATE OR REPLACE FUNCTION public.vn_today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
$$;

COMMENT ON FUNCTION public.vn_today() IS
  'Hôm nay theo lịch Việt Nam. Dùng thay CURRENT_DATE (ngày UTC) ở mọi '
  'phép tính tuổi nợ, để khớp với daysOverdueOf() ở trình duyệt.';

GRANT EXECUTE ON FUNCTION public.vn_today() TO authenticated;

-- --------------------------------------------------------------------
-- 2. receivables_summary — ô tổng đầu trang Công nợ.
-- --------------------------------------------------------------------
-- Ngưỡng chia nhóm PHẢI khớp với `getAgingStatus()` trong
-- src/lib/utils.ts. Có chốt khoá hai bên: tests/aging-thresholds.test.ts.
DROP FUNCTION IF EXISTS public.receivables_summary();
CREATE FUNCTION public.receivables_summary()
RETURNS TABLE (
  total_outstanding  numeric,
  current_amount     numeric,
  current_count      bigint,
  warning_amount     numeric,
  warning_count      bigint,
  overdue_amount     numeric,
  overdue_count      bigint,
  critical_amount    numeric,
  critical_count     bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH r AS (
    SELECT
      GREATEST(0, COALESCE(amount, 0) - COALESCE(paid, 0)) AS remaining,
      CASE
        WHEN due_date IS NULL THEN 'current'
        WHEN (public.vn_today() - due_date) <= 0  THEN 'current'
        WHEN (public.vn_today() - due_date) <= 30 THEN 'warning'
        WHEN (public.vn_today() - due_date) <= 60 THEN 'overdue'
        ELSE 'critical'
      END AS bucket
    FROM receivables
    WHERE org_id = public.user_org_id()
      AND status <> 'paid'
  )
  SELECT
    COALESCE(SUM(remaining), 0),
    COALESCE(SUM(remaining) FILTER (WHERE bucket = 'current'),  0),
    COUNT(*)                FILTER (WHERE bucket = 'current'),
    COALESCE(SUM(remaining) FILTER (WHERE bucket = 'warning'),  0),
    COUNT(*)                FILTER (WHERE bucket = 'warning'),
    COALESCE(SUM(remaining) FILTER (WHERE bucket = 'overdue'),  0),
    COUNT(*)                FILTER (WHERE bucket = 'overdue'),
    COALESCE(SUM(remaining) FILTER (WHERE bucket = 'critical'), 0),
    COUNT(*)                FILTER (WHERE bucket = 'critical')
  FROM r;
$$;

-- --------------------------------------------------------------------
-- 3. receivables_by_rep — công nợ gộp theo nhân viên bán hàng.
-- --------------------------------------------------------------------
-- ⚠ BẢN ĐANG CHẠY LÀ BẢN CỦA MIGRATION 121, KHÔNG PHẢI 093. Chép lại
--   nguyên văn thân hàm của 121 và chỉ đổi đúng phép tính ngày; lấy
--   nhầm thân hàm của 093 là bỏ mất phép kẹp về 0 mà 121 thêm vào
--   (xem chú thích "Q11" bên dưới).
DROP FUNCTION IF EXISTS public.receivables_by_rep();
CREATE FUNCTION public.receivables_by_rep()
RETURNS TABLE (
  user_id             uuid,
  full_name           text,
  customer_count      bigint,
  customers_with_debt bigint,
  total_debt          numeric,
  total_paid          numeric,
  total_amount        numeric,
  overdue_amount      numeric,
  collection_rate     integer,
  dso                 integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH r AS (
    SELECT
      rc.sales_user_id,
      rc.customer_id,
      COALESCE(rc.amount, 0) AS amount,
      COALESCE(rc.paid, 0)   AS paid,
      -- ⚠ Q11 — KẸP VỀ 0. Hàm này không lọc `status <> 'paid'` nên dòng
      --   trả dư lọt vào; không kẹp thì số dư có bị TRỪ THẲNG vào công
      --   nợ của nhân viên.
      GREATEST(0, COALESCE(rc.amount, 0) - COALESCE(rc.paid, 0)) AS remaining,
      rc.status,
      rc.status <> 'paid' AS has_debt,
      GREATEST(0, public.vn_today() - COALESCE(rc.due_date, public.vn_today())) AS aging_days
    FROM receivables rc
    WHERE rc.org_id = public.user_org_id()
      AND rc.sales_user_id IS NOT NULL
  )
  SELECT
    r.sales_user_id,
    COALESCE(u.full_name, '-'),
    COUNT(DISTINCT r.customer_id),
    COUNT(DISTINCT r.customer_id) FILTER (WHERE r.has_debt),
    COALESCE(SUM(r.remaining), 0),
    COALESCE(SUM(r.paid), 0),
    COALESCE(SUM(r.amount), 0),
    COALESCE(SUM(r.remaining) FILTER (WHERE r.status = 'overdue'), 0),
    -- ⚠ Q11 — KẸP TRẦN 100%. Dòng dư có `paid > amount` nên tỉ lệ thu
    --   được vượt 100 và người đọc tưởng số liệu hỏng.
    CASE WHEN COALESCE(SUM(r.amount), 0) > 0
         THEN LEAST(100, ROUND(SUM(r.paid) / SUM(r.amount) * 100)::integer)
         ELSE 0 END,
    CASE WHEN COUNT(*) FILTER (WHERE r.has_debt) > 0
         THEN ROUND(
                AVG(r.aging_days) FILTER (WHERE r.has_debt)
              )::integer
         ELSE 0 END
  FROM r
  LEFT JOIN users u ON u.id = r.sales_user_id
  GROUP BY r.sales_user_id, u.full_name
  ORDER BY COALESCE(SUM(r.remaining), 0) DESC;
$$;

-- `DROP FUNCTION` xoá luôn GRANT cũ, phải cấp lại.
GRANT EXECUTE ON FUNCTION public.receivables_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.receivables_by_rep()  TO authenticated;

-- --------------------------------------------------------------------
-- 4. Báo cáo ảnh hưởng.
-- --------------------------------------------------------------------
-- Không có backfill nào ở đây — hai hàm chỉ ĐỌC. Nhưng phải nói ra
-- migration này vừa đổi câu trả lời cho bao nhiêu dòng, nếu không thì
-- không có cách nào biết nó đã chạy thật hay chưa.
DO $$
DECLARE
  v_utc   date    := CURRENT_DATE;
  v_vn    date    := public.vn_today();
  v_moved bigint  := 0;
BEGIN
  IF v_vn <> v_utc THEN
    SELECT COUNT(*) INTO v_moved
    FROM receivables
    WHERE status <> 'paid'
      AND due_date IS NOT NULL
      AND (
        ((v_utc - due_date) <= 0)  <> ((v_vn - due_date) <= 0)  OR
        ((v_utc - due_date) <= 30) <> ((v_vn - due_date) <= 30) OR
        ((v_utc - due_date) <= 60) <> ((v_vn - due_date) <= 60)
      );
    RAISE NOTICE 'vn_today() = %, CURRENT_DATE (UTC) = % — lệch NGÀY ngay lúc này. % dòng công nợ đổi nhóm tuổi nợ.', v_vn, v_utc, v_moved;
  ELSE
    RAISE NOTICE 'vn_today() = % trùng CURRENT_DATE — lúc này hai cách tính cho cùng kết quả (0 dòng đổi nhóm). Chênh lệch chỉ hiện từ 00:00 tới 07:00 giờ Việt Nam.', v_vn;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';


-- ####################################################################
-- # 141_supplier_return_vat_ratio.sql
-- ####################################################################

-- ====================================================================
-- 141 — `supplier_return_lines.vat_rate` ĐỔI TỪ PHẦN TRĂM SANG TỈ LỆ
-- ====================================================================
--
-- VÌ SAO
--   Mọi bảng dòng hàng khác trong kho này giữ thuế suất dưới dạng TỈ LỆ:
--
--     · `products.vat_rate`        — DEFAULT 0.1, có COMMENT nói rõ
--     · `sales_invoice_lines`      — màn chi tiết in `vat_rate * 100`
--     · `stock_entry_lines`        — phiếu nhập kho nhân/chia 100 ở ô nhập
--
--   Chỉ `supplier_return_lines` giữ PHẦN TRĂM (10 = 10%). Một bảng lẻ
--   loi không tự nó gây hại, nhưng nó đã gây hại một lần rồi: màn tạo
--   phiếu trả điền sẵn ô "VAT %" bằng `products.vat_rate` — tức chép
--   thẳng TỈ LỆ 0,1 vào một ô PHẦN TRĂM. Phiếu tính 0,1% thay cho 10%,
--   thuế hụt đúng 100 lần, và không một dòng nào trên màn kêu lên.
--
--   Đã vá chỗ điền sẵn ở lần sửa trước. Migration này dọn tận gốc: đưa
--   cột về đúng quy ước của cả kho, để lần sau ai đọc `vat_rate` ở bất
--   kỳ bảng dòng hàng nào cũng chỉ có MỘT cách hiểu.
--
-- ⚠ ĐÂY LÀ PHÉP ĐỔI ĐƠN VỊ, KHÔNG PHẢI PHÉP SỬA SỐ. Chia 100 cho MỌI
--   dòng, kể cả những dòng trông "sai" (0.1 → 0.001). Vì sao không tự
--   đoán ý người nhập: cột `supplier_returns.vat` và cột
--   `supplier_return_lines.line_total` ĐÃ được tính bằng cách hiểu phần
--   trăm và đã ghi xuống sổ. Một dòng 0.1 đã đóng góp 0,1% vào số tiền
--   trên tờ phiếu; "sửa" nó thành 0.1 tỉ lệ là làm dòng hàng nói một
--   đằng còn tổng tiền nói một nẻo. Chia đều 100 giữ mọi con số tiền y
--   nguyên — đó là phép đổi duy nhất KHÔNG mất mát.
--
--   Nếu chủ nhà muốn sửa lại thuế suất của mấy phiếu cũ thành con số
--   đúng ý, đó là một việc KHÁC: mở phiếu ra sửa, và tổng tiền đổi theo.
--   Migration không tự quyết chuyện đó.
--
-- ⚠ IDEMPOTENT BẰNG COMMENT CỦA CỘT. Chạy lại lần hai mà không có chốt
--   chặn là chia 100 lần nữa — thuế thành một phần vạn. Không có cột
--   "phiên bản" nào để bám, nên dùng chính COMMENT làm dấu: có chữ
--   "TỈ LỆ" nghĩa là đã đổi rồi.
-- ====================================================================

DO $$
DECLARE
  v_marker text;
  v_n      bigint := 0;
  v_max    numeric;
BEGIN
  SELECT col_description('public.supplier_return_lines'::regclass, a.attnum)
    INTO v_marker
  FROM pg_attribute a
  WHERE a.attrelid = 'public.supplier_return_lines'::regclass
    AND a.attname  = 'vat_rate';

  IF v_marker IS NOT NULL AND v_marker LIKE '%TỈ LỆ%' THEN
    RAISE NOTICE '141: cột đã ở dạng tỉ lệ từ lần chạy trước — bỏ qua (0 dòng đổi).';
    RETURN;
  END IF;

  SELECT COALESCE(MAX(vat_rate), 0) INTO v_max FROM supplier_return_lines;

  UPDATE supplier_return_lines
     SET vat_rate = vat_rate / 100
   WHERE vat_rate <> 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RAISE NOTICE '141: đổi đơn vị vat_rate phần trăm → tỉ lệ cho % dòng (thuế suất cao nhất trước khi đổi: %). Tiền trên phiếu KHÔNG đổi.', v_n, v_max;
END $$;

COMMENT ON COLUMN supplier_return_lines.vat_rate IS
  'Thuế suất dạng TỈ LỆ (0.1 = 10%), giống products.vat_rate và '
  'sales_invoice_lines.vat_rate. Đổi từ phần trăm ở migration 141. '
  'Giao diện nhân 100 khi hiện và chia 100 khi lưu.';

NOTIFY pgrst, 'reload schema';


-- ####################################################################
-- # 142_purchase_receipt.sql
-- ####################################################################

-- ====================================================================
-- 142 — PHIẾU NHẬP HÀNG: ĐÁNH THỨC MÔ HÌNH ĐÚNG ĐÃ NẰM SẴN
-- ====================================================================
--
-- CHUYỆN ĐÃ XẢY RA — đọc kỹ trước khi sửa gì ở đây.
--
--   Migration 065 đã dựng đúng mô hình chủ nhà đang yêu cầu: bảng
--   `purchase_invoices` với ba trạng thái draft/completed/cancelled, và
--   RPC `complete_purchase_invoice` làm một transaction gồm nhập kho +
--   ghi công nợ NCC. Nhưng KHÔNG MỘT MÀN NÀO trong app gọi tới nó —
--   `grep` cả `src/` chỉ ra đúng một chỗ đọc bảng đó, là báo cáo NCC.
--
--   Việc nhập hàng thật đang chạy ở `/inventory/stock-in`: 999 dòng
--   TypeScript tự ghi thẳng `stock_entries` → `batches` →
--   `stock_entry_lines` → `payables` bằng một vòng lặp TỪ TRÌNH DUYỆT,
--   không transaction. Mạng rớt giữa chừng là kho đã cộng mà công nợ
--   chưa ghi, hoặc ngược lại — và không có gì dọn lại.
--
--   Chủ nhà đã tự gỡ nút thắt này trong chính yêu cầu: "Phiếu nhập kho
--   chuyển hẳn sang phần Kho vận (dùng để nhập kho thông thường)". Tức
--   là `stock_entries` trở về đúng việc của nó — một lần chuyển động
--   kho — còn PHIẾU NHẬP HÀNG (có NCC, có hoá đơn đầu vào, có công nợ)
--   là chứng từ riêng, chính là `purchase_invoices`.
--
--   Nên migration này KHÔNG dựng bảng mới. Nó bù những cột mô hình cũ
--   còn thiếu so với yêu cầu, rồi viết lại RPC cho đủ.
--
-- ⚠ LỊCH SỬ NHẬP HÀNG CŨ KHÔNG TỰ CHUYỂN SANG. Mọi phiếu nhập từ trước
--   nằm ở `stock_entries`, không ở `purchase_invoices`. Migration này
--   KHÔNG chép chúng sang — chép là đoán lại giá, thuế và giảm giá của
--   những chứng từ không ghi mấy con số đó, rồi dựng ra công nợ thứ hai
--   cho cùng một lần nhập. Màn "Hoá đơn mua (tra cứu)" vẫn đọc
--   `stock_entries` nên lịch sử cũ không mất đi đâu cả. Nếu chủ nhà muốn
--   gộp một mối, đó là một migration backfill RIÊNG và phải bàn trước.
--
-- ⚠ QUY ƯỚC TIỀN CỦA PHIẾU NHẬP KHÁC PHIẾU BÁN — cố ý, và phải nhớ.
--   Bên bán, `line_discount` chỉ GHI NHỚ đã giảm bao nhiêu so với giá
--   bảng; chiết khấu đã nằm sẵn trong `unit_price` (xem
--   `src/lib/sell/create-order.ts`). Bên mua thì NCC ghi giảm giá thành
--   một dòng riêng trên hoá đơn giấy, nên ở đây nó TRỪ THẬT:
--
--     tiền dòng   = quantity × unit_price − line_discount
--     subtotal    = Σ tiền dòng
--     vat         = Σ (tiền dòng × vat_rate)
--     total       = subtotal + vat − discount        ← "Cần trả NCC"
--
--   `discount` ở đầu phiếu trừ SAU thuế: nó là khoản NCC bớt lúc thanh
--   toán, không phải khoản làm đổi căn cứ tính thuế. Nếu thực tế của
--   chủ nhà ngược lại (giảm giá làm giảm cả tiền thuế) thì phải sửa ở
--   ĐÂY, và sửa thì mọi phiếu cũ vẫn giữ nguyên số đã ghi.
--
-- ⚠ TIỀN TÍNH LẠI Ở MÁY CHỦ, KHÔNG NHẬN SỐ TỪ TRÌNH DUYỆT. Bản cũ nhận
--   `total` do trình duyệt gửi lên rồi ghi thẳng vào `payables.amount`.
--   Một lỗi làm tròn, một ô để trống, hay một tab mở lâu với bảng giá cũ
--   là công nợ NCC lệch mà không có chỗ nào đối chiếu.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. Cột còn thiếu
-- --------------------------------------------------------------------
ALTER TABLE purchase_invoices
  -- Mã phiếu của MÌNH. `invoice_number` là số hoá đơn NCC đưa (có thể
  -- trùng, có thể trống); không dùng nó làm mã phiếu được.
  ADD COLUMN IF NOT EXISTS receipt_code text,
  -- Giảm giá toàn phiếu, trừ sau thuế — xem quy ước ở đầu tệp.
  ADD COLUMN IF NOT EXISTS discount numeric NOT NULL DEFAULT 0,
  -- Kho đích: hàng nhập về vào kho bán hay kho cận date.
  ADD COLUMN IF NOT EXISTS warehouse_zone text NOT NULL DEFAULT 'sale',
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'purchase_invoices'::regclass
      AND conname = 'purchase_invoices_zone_chk'
  ) THEN
    ALTER TABLE purchase_invoices
      ADD CONSTRAINT purchase_invoices_zone_chk
      CHECK (warehouse_zone IN ('sale', 'date'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pinv_receipt_code
  ON purchase_invoices(org_id, receipt_code) WHERE receipt_code IS NOT NULL;

ALTER TABLE purchase_invoice_lines
  -- Giảm giá của DÒNG, trừ thật — xem quy ước ở đầu tệp.
  ADD COLUMN IF NOT EXISTS line_discount numeric NOT NULL DEFAULT 0,
  -- STT người dùng nhìn thấy. Không có nó thì thứ tự dòng phụ thuộc vào
  -- thứ tự Postgres trả về, và tờ in mỗi lần một khác.
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- --------------------------------------------------------------------
-- 2. Đánh số phiếu — PN-0001, chạy theo org
-- --------------------------------------------------------------------
-- ⚠ KHÔNG NHÚNG NGÀY VÀO MÃ. Chủ nhà đã chốt chuyện này một lần rồi cho
--   mã đơn hàng (migration 130): mã có ngày thì đọc số không ra thứ tự,
--   và hai phiếu cùng ngày vẫn phải thêm hậu tố.
CREATE OR REPLACE FUNCTION public.next_purchase_receipt_code(p_org uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  -- ⚠ KHOÁ THEO ORG TRONG SUỐT GIAO DỊCH. Hai người bấm "Hoàn thành"
  --   cùng lúc mà không khoá là hai phiếu mang cùng một mã, và chỉ chỉ
  --   mục duy nhất mới kêu — sau khi kho đã cộng.
  PERFORM pg_advisory_xact_lock(hashtext('purchase_receipt_code:' || p_org::text));
  SELECT COALESCE(MAX(NULLIF(regexp_replace(receipt_code, '^PN-', ''), '')::integer), 0) + 1
    INTO v_n
  FROM purchase_invoices
  WHERE org_id = p_org AND receipt_code ~ '^PN-[0-9]+$';
  RETURN 'PN-' || lpad(v_n::text, 4, '0');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.next_purchase_receipt_code(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_purchase_receipt_code(uuid) TO authenticated;

-- --------------------------------------------------------------------
-- 3. complete_purchase_invoice — viết lại
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_purchase_invoice(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org        uuid;
  v_status     text;
  v_supplier   uuid;
  v_inv_number text;
  v_zone       text;
  v_discount   numeric;
  v_code       text;
  v_uid        uuid := auth.uid();
  v_entry_id   uuid;
  v_payable_id uuid;
  v_seq        int := 0;
  v_batch_id   uuid;
  v_base_qty   numeric;
  v_unit_cost  numeric;
  v_shelf      int;
  v_sub        numeric := 0;
  v_vat        numeric := 0;
  v_total      numeric;
  r            record;
BEGIN
  SELECT org_id, status, supplier_id, invoice_number, warehouse_zone,
         COALESCE(discount, 0), receipt_code
    INTO v_org, v_status, v_supplier, v_inv_number, v_zone, v_discount, v_code
  FROM purchase_invoices WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PHIEU_KHONG_TON_TAI: Không tìm thấy phiếu nhập này.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'SAI_DON_VI: Phiếu nhập này không thuộc đơn vị của bạn.'
      USING ERRCODE = 'P0001';
  END IF;
  -- ⚠ IDEMPOTENT. Bấm hai lần, hoặc bấm rồi mạng rớt rồi bấm lại, KHÔNG
  --   được nhập kho hai lần.
  IF v_status = 'completed' THEN
    RETURN p_invoice_id;
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'PHIEU_KHONG_CON_TAM: Phiếu đang ở trạng thái "%" — chỉ phiếu tạm mới hoàn thành được.', v_status
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM purchase_invoice_lines WHERE invoice_id = p_invoice_id) THEN
    RAISE EXCEPTION 'PHIEU_KHONG_CO_HANG: Phiếu chưa có dòng hàng nào.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_code IS NULL THEN
    v_code := public.next_purchase_receipt_code(v_org);
  END IF;

  -- 3.1 Phiếu nhập kho đi kèm.
  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, supplier_id, notes)
  VALUES (
    v_org, v_code, 'import', 'posted', now(), v_uid, v_supplier,
    'Nhập kho từ phiếu nhập hàng ' || v_code
  )
  RETURNING id INTO v_entry_id;

  FOR r IN
    SELECT l.product_id, l.unit_name, l.quantity, l.unit_price,
           COALESCE(l.line_discount, 0) AS line_discount,
           COALESCE(l.vat_rate, 0)      AS vat_rate,
           COALESCE(l.conversion_factor, 1) AS cf,
           p.shelf_life_days
    FROM purchase_invoice_lines l
    JOIN products p ON p.id = l.product_id
    WHERE l.invoice_id = p_invoice_id
    ORDER BY l.sort_order, l.id
  LOOP
    v_seq := v_seq + 1;
    v_base_qty := COALESCE(r.quantity, 0) * r.cf;

    IF v_base_qty <= 0 THEN
      RAISE EXCEPTION 'SO_LUONG_KHONG_HOP_LE: Dòng % có số lượng không lớn hơn 0.', v_seq
        USING ERRCODE = 'P0001';
    END IF;

    -- ⚠ GIÁ VỐN TÍNH TRÊN TIỀN ĐÃ TRỪ GIẢM GIÁ DÒNG, và theo ĐƠN VỊ CƠ
    --   SỞ. Lấy thẳng `unit_price` là ghi giá một thùng thành giá một
    --   hộp; bỏ qua giảm giá là ghi giá vốn cao hơn số thật sự đã trả,
    --   và mọi báo cáo lãi lỗ sau đó đều thấp hơn thực tế.
    v_unit_cost := (COALESCE(r.quantity, 0) * COALESCE(r.unit_price, 0) - r.line_discount)
                   / v_base_qty;

    v_sub := v_sub + (COALESCE(r.quantity, 0) * COALESCE(r.unit_price, 0) - r.line_discount);
    v_vat := v_vat + (COALESCE(r.quantity, 0) * COALESCE(r.unit_price, 0) - r.line_discount) * r.vat_rate;

    v_shelf := COALESCE(r.shelf_life_days, 0);

    INSERT INTO batches (
      org_id, product_id, batch_code, manufactured_at, expires_at,
      qty_initial, qty_on_hand, status, unit_cost, warehouse_zone
    ) VALUES (
      v_org, r.product_id,
      v_code || '-' || lpad(v_seq::text, 3, '0'),
      public.vn_today(),
      CASE WHEN v_shelf > 0 THEN public.vn_today() + v_shelf ELSE DATE '2099-12-31' END,
      v_base_qty, v_base_qty, 'available', v_unit_cost,
      -- ⚠ KHO ĐÍCH DO NGƯỜI NHẬP CHỌN. Mặc định cứng vào 'sale' là đưa
      --   một lô hàng cận date vào kho bán, và từ mig 138 thì kho bán
      --   mới là kho được bán ra.
      v_zone
    )
    RETURNING id INTO v_batch_id;

    /**
     * ⚠ PHẢI ĐIỀN CẢ BỘ CỘT ĐƠN VỊ. `stock_entry_lines` được mở rộng
     *   sau migration 065 (`qty_in_base_uom` NOT NULL, `transaction_uom`,
     *   `conversion_factor_snapshot`), mà bản RPC cũ thì không biết —
     *   nó chèn thiếu cột và NGÃ NGAY. Đó cũng là bằng chứng thêm rằng
     *   RPC đó chưa từng chạy một lần nào: nếu có, nó đã nổ.
     *
     * ⚠ `quantity` LÀ `integer` — phải làm tròn, không để Postgres tự
     *   cắt. Số thật đi vào `qty_in_base_uom` (numeric 18,6).
     */
    INSERT INTO stock_entry_lines (
      entry_id, product_id, batch_id, unit_name, quantity, unit_cost,
      qty_in_base_uom, qty_in_transaction_uom, transaction_uom,
      conversion_factor_snapshot
    )
    VALUES (
      v_entry_id, r.product_id, v_batch_id, r.unit_name,
      ROUND(v_base_qty)::integer, v_unit_cost,
      v_base_qty, COALESCE(r.quantity, 0), r.unit_name, r.cf
    );
  END LOOP;

  -- 3.2 Tiền — TÍNH LẠI TỪ DÒNG, không nhận số của trình duyệt.
  v_total := GREATEST(0, v_sub + v_vat - v_discount);

  -- 3.3 Công nợ NCC.
  INSERT INTO payables (org_id, supplier_id, stock_entry_id, invoice_number, amount, paid, status, notes)
  VALUES (
    v_org, v_supplier, v_entry_id, v_inv_number, v_total, 0, 'open',
    'Phiếu nhập hàng ' || v_code
  )
  RETURNING id INTO v_payable_id;

  UPDATE purchase_invoices
  SET status = 'completed',
      receipt_code = v_code,
      subtotal = v_sub,
      vat = v_vat,
      total = v_total,
      completed_at = now(),
      stock_entry_id = v_entry_id,
      payable_id = v_payable_id
  WHERE id = p_invoice_id;

  RETURN p_invoice_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_purchase_invoice(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_purchase_invoice(uuid) TO authenticated;

COMMENT ON FUNCTION public.complete_purchase_invoice(uuid) IS
  'Hoàn thành phiếu nhập hàng: nhập kho vào đúng warehouse_zone + ghi '
  'công nợ NCC, trong MỘT giao dịch. Tiền tính lại từ dòng hàng. '
  'Idempotent: gọi lại trên phiếu đã hoàn thành thì không làm gì.';

-- --------------------------------------------------------------------
-- 4. cancel_purchase_invoice — đảo ngược
-- --------------------------------------------------------------------
-- ⚠ CHỈ HUỶ ĐƯỢC KHI HÀNG CHƯA ĐỘNG VÀ TIỀN CHƯA TRẢ. Trừ ngược một lô
--   đã bán mất một phần là đẩy tồn xuống âm và xoá mất vết của chính
--   lần bán đó. Thà từ chối và bảo người dùng lập phiếu điều chỉnh.
CREATE OR REPLACE FUNCTION public.cancel_purchase_invoice(
  p_invoice_id uuid,
  p_reason     text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org      uuid;
  v_status   text;
  v_entry    uuid;
  v_payable  uuid;
  v_uid      uuid := auth.uid();
  v_paid     numeric;
  v_bad      text;
BEGIN
  SELECT org_id, status, stock_entry_id, payable_id
    INTO v_org, v_status, v_entry, v_payable
  FROM purchase_invoices WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PHIEU_KHONG_TON_TAI: Không tìm thấy phiếu nhập này.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'SAI_DON_VI: Phiếu nhập này không thuộc đơn vị của bạn.'
      USING ERRCODE = 'P0001';
  END IF;
  -- Idempotent.
  IF v_status = 'cancelled' THEN
    RETURN p_invoice_id;
  END IF;

  -- Phiếu còn tạm thì huỷ là đổi một chữ; chưa đụng gì tới kho hay nợ.
  IF v_status = 'draft' THEN
    UPDATE purchase_invoices
    SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid,
        cancel_reason = p_reason
    WHERE id = p_invoice_id;
    RETURN p_invoice_id;
  END IF;

  -- 4.1 Tiền đã trả rồi thì không huỷ được.
  IF v_payable IS NOT NULL THEN
    SELECT COALESCE(paid, 0) INTO v_paid FROM payables WHERE id = v_payable;
    IF COALESCE(v_paid, 0) > 0 THEN
      RAISE EXCEPTION 'DA_TRA_TIEN: Phiếu này đã trả NCC % — huỷ phiếu là xoá mất khoản đã trả. Gỡ phiếu chi trước, hoặc lập phiếu trả hàng NCC.', v_paid
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 4.2 Hàng đã động thì không huỷ được. Nói rõ MẶT HÀNG NÀO — bắt người
  --     dùng tự dò cả phiếu là bỏ phí việc mình vừa tra ra.
  IF v_entry IS NOT NULL THEN
    SELECT string_agg(
             p.name || ' (nhập ' || b.qty_initial || ', còn ' || b.qty_on_hand || ')',
             ' · ' ORDER BY p.name)
      INTO v_bad
    FROM stock_entry_lines sel
    JOIN batches  b ON b.id = sel.batch_id
    JOIN products p ON p.id = sel.product_id
    WHERE sel.entry_id = v_entry
      AND b.qty_on_hand <> b.qty_initial;

    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'HANG_DA_XUAT: Không huỷ được vì hàng của phiếu đã xuất bớt — %. Lập phiếu trả hàng NCC hoặc phiếu điều chỉnh kho.', v_bad
        USING ERRCODE = 'P0001';
    END IF;

    -- Trừ sạch lô của phiếu này rồi đóng phiếu kho.
    UPDATE batches b
    SET qty_on_hand = 0, status = 'cancelled'
    FROM stock_entry_lines sel
    WHERE sel.entry_id = v_entry AND b.id = sel.batch_id;

    UPDATE stock_entries SET status = 'cancelled' WHERE id = v_entry;
  END IF;

  /**
   * 4.3 Đóng phiếu TRƯỚC, xoá công nợ SAU.
   *
   * ⚠ THỨ TỰ NÀY LÀ BẮT BUỘC, KHÔNG PHẢI SỞ THÍCH.
   *   `purchase_invoices.payable_id` có khoá ngoại trỏ tới `payables`,
   *   nên xoá dòng nợ khi phiếu còn trỏ vào nó là Postgres từ chối
   *   ("still referenced from table"). Phải gỡ con trỏ trước.
   *
   * ⚠ XOÁ HẲN DÒNG NỢ, KHÔNG ĐÁNH DẤU. `payables.status` chỉ nhận
   *   open/partial/paid/overdue — không có 'cancelled'. Để nó lại ở
   *   'open' là một khoản nợ ma vẫn cộng vào công nợ NCC mãi mãi. Vết
   *   tích nằm ở chính phiếu: `cancelled_at`, `cancelled_by`,
   *   `cancel_reason`. An toàn vì mục 4.1 đã chắc chắn chưa trả đồng nào.
   */
  UPDATE purchase_invoices
  SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid,
      cancel_reason = p_reason, payable_id = NULL
  WHERE id = p_invoice_id;

  IF v_payable IS NOT NULL THEN
    DELETE FROM payables WHERE id = v_payable;
  END IF;

  RETURN p_invoice_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_purchase_invoice(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_invoice(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.cancel_purchase_invoice(uuid, text) IS
  'Huỷ phiếu nhập hàng và đảo ngược: trừ sạch lô đã nhập, xoá công nợ '
  'NCC. Từ chối nếu hàng đã xuất bớt hoặc đã trả tiền. Idempotent.';

-- --------------------------------------------------------------------
-- 5. Báo cáo hiện trạng
-- --------------------------------------------------------------------
DO $$
DECLARE
  v_pinv  bigint;
  v_entry bigint;
  v_code  bigint;
BEGIN
  SELECT COUNT(*) INTO v_pinv  FROM purchase_invoices;
  SELECT COUNT(*) INTO v_entry FROM stock_entries WHERE type = 'import' AND status = 'posted';
  SELECT COUNT(*) INTO v_code  FROM purchase_invoices WHERE receipt_code IS NOT NULL;
  RAISE NOTICE '--- 142: % phiếu nhập hàng trong purchase_invoices (% đã có mã PN) ---', v_pinv, v_code;
  RAISE NOTICE '--- 142: % phiếu nhập kho cũ nằm ở stock_entries — KHÔNG chuyển sang, vẫn tra cứu được ở màn cũ ---', v_entry;
END $$;

NOTIFY pgrst, 'reload schema';

