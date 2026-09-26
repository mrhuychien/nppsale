-- ====================================================================
-- NVBH CHỈ CÒN MODULE BÁN HÀNG + công nợ / báo cáo bán hàng / phiếu lương của mình
--
-- VÌ SAO — chủ nhà 26/09/2026: "NV bán hàng chỉ cần Module bán hàng và - Xem được công nợ
--   của mình - Xem được báo cáo bán hàng của mình - Xem được phiếu lương của mình. Còn lại
--   bỏ hết".
--   Mặc định trong mã (`DEFAULT_PERMISSION_MAP.sales`, `MAU_QUYEN_NVBH`) đã thu lại. Nhưng
--   ma trận của NPP (`role_permissions`) có thể đã LƯU các ô cũ (bấm "Áp mẫu NVBH" hôm
--   25/09, hay mig 166 gieo `receivables.create` cho sales) — ô lưu thắng mặc định, nên
--   phải tắt ở đây. Chỉ đụng vai `sales`; quyền RIÊNG từng người
--   (`user_permission_overrides`) giữ nguyên — đó là chủ NPP cấp đích danh.
--   Hệ quả dưới DB: `create_cash_receipt` đòi `receivables.create` → NVBH không lập phiếu
--   thu nữa. Tồn kho / sản phẩm ở /sell vẫn đọc qua RLS (không dựa vào ma trận).
-- ====================================================================

-- 1. Tắt mọi ô `sales` đang BẬT ngoài bộ được giữ.
UPDATE role_permissions rp
SET allowed = false
WHERE rp.role = 'sales'
  AND rp.allowed
  AND (rp.module, rp.action) NOT IN (
    ('orders', 'read'), ('orders', 'create'), ('orders', 'update'),
    ('customers', 'read'), ('customers', 'create'), ('customers', 'update'),
    ('customers.visits', 'read'), ('customers.visits', 'create'), ('customers.visits', 'update'),
    ('promotions', 'read'),
    ('commissions', 'read'),
    ('receivables', 'read'),
    ('receivables.by_customer', 'read'),
    ('reports', 'read'),
    ('reports.sales', 'read')
  );

-- 2. NPP tạo về sau: bộ gieo mặc định (mig 166) không còn cấp `receivables.create` cho sales.
CREATE OR REPLACE FUNCTION public._gieo_quyen_mac_dinh(p_org uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  INSERT INTO role_permissions (org_id, role, module, action, allowed)
  SELECT p_org, v.role, v.module, v.action, true
  FROM (VALUES
    ('manager',    'orders',      'approve'),
    ('manager',    'orders',      'update'),
    ('manager',    'returns',     'approve'),
    ('manager',    'inventory',   'approve'),
    ('sales',      'orders',      'update'),
    ('accountant', 'receivables', 'create'),
    ('accountant', 'receivables', 'update')
  ) AS v(role, module, action)
  ON CONFLICT (org_id, role, module, action) DO NOTHING;
$fn$;

REVOKE EXECUTE ON FUNCTION public._gieo_quyen_mac_dinh(uuid) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'NVBH chỉ còn bán hàng' AS hang_muc,
       (SELECT count(*) FROM role_permissions
         WHERE role = 'sales' AND allowed
           AND (module, action) NOT IN (
             ('orders','read'),('orders','create'),('orders','update'),
             ('customers','read'),('customers','create'),('customers','update'),
             ('customers.visits','read'),('customers.visits','create'),('customers.visits','update'),
             ('promotions','read'),('commissions','read'),('receivables','read'),
             ('receivables.by_customer','read'),('reports','read'),('reports.sales','read'))) AS o_thua_con_bat,
       (SELECT count(*) FROM user_permission_overrides upo JOIN users u ON u.id = upo.user_id
         WHERE u.role = 'sales' AND upo.granted) AS quyen_rieng_nvbh_dang_cap;
