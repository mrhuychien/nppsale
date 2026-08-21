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
