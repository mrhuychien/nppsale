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
