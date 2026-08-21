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
