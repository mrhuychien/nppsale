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
