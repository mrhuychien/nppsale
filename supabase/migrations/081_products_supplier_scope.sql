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
