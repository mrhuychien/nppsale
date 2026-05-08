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
