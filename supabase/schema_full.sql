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
INSERT INTO hr_salary_config (org_id, name, base_salary, gas_allowance, phone_allowance, target_tiers)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Cấu hình lương NVBH',
  3700000, 1000000, 300000,
  '[
    {"min_percent": 70, "bonus": 1000000, "label": "Đạt 70%"},
    {"min_percent": 80, "bonus": 1000000, "label": "Đạt 80%"},
    {"min_percent": 90, "bonus": 1000000, "label": "Đạt 90%"},
    {"min_percent": 100, "bonus": 1000000, "label": "Đạt 100%"}
  ]'
);

-- Seed April 2026 bonus tiers
INSERT INTO hr_monthly_bonus (org_id, period, tiers, notes)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  '2026-04',
  '[
    {"min_revenue": 150000000, "bonus": 1000000},
    {"min_revenue": 200000000, "bonus": 1500000},
    {"min_revenue": 250000000, "bonus": 2000000},
    {"min_revenue": 300000000, "bonus": 2500000},
    {"min_revenue": 350000000, "bonus": 3000000}
  ]',
  'Thưởng doanh số tháng 4/2026'
);


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

