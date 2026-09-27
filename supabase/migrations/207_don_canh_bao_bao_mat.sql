-- ====================================================================
-- DỌN CẢNH BÁO BẢO MẬT CỦA SUPABASE (Security Advisor)
--
-- VÌ SAO — chủ nhà 27/09/2026 dán bảng "warnings database" của Supabase:
--   · function_search_path_mutable — 29 hàm không đặt search_path.
--   · anon_security_definer_function_executable — ~45 hàm SECURITY DEFINER gọi được KHI CHƯA
--     ĐĂNG NHẬP (khoá công khai `anon` nằm trong mã trang web, ai cũng lấy được).
--   · authenticated_security_definer_function_executable — hàm trigger / hàm nội bộ gọi được
--     thẳng qua /rest/v1/rpc.
--   · public_bucket_allows_listing — 3 kho ảnh công khai có policy SELECT rộng → liệt kê được
--     MỌI ảnh của MỌI đơn vị.
--
-- LÀM GÌ
--   1. Mọi hàm SECURITY DEFINER trong `public`: thu EXECUTE của PUBLIC + anon. Ngoại lệ DUY NHẤT:
--      `lookup_email_by_identifier` — màn đăng nhập gọi TRƯỚC khi đăng nhập (mã / SĐT → email).
--      Ai đang được gọi (authenticated) thì cấp lại đích danh cho authenticated — không mất quyền.
--   2. Hàm trigger (trả `trigger`) SECURITY DEFINER: thu luôn của authenticated — trigger chạy
--      KHÔNG cần quyền EXECUTE của người sửa dòng; gọi thẳng qua /rpc chỉ là lỗ hổng.
--   3. Các hàm cảnh báo search_path: đặt `search_path = public, extensions`.
--   4. Bỏ policy SELECT rộng của 3 kho ảnh công khai. App chỉ tải lên (upsert:false — không cần
--      SELECT) và hiện ảnh bằng URL công khai (không qua policy). Không chỗ nào liệt kê / xoá file.
--
-- KHÔNG LÀM (và vì sao)
--   · Các RPC nghiệp vụ (post_invoice, cancel_order, create_cash_receipt…) VẪN cho authenticated:
--     app gọi chúng, và chúng tự kiểm quyền bên trong. Cảnh báo 0029 cho các hàm này là có chủ ý.
--   · "Leaked password protection" là công tắc trong Dashboard (Authentication → Password
--     security), không làm được bằng SQL.
--
-- ⚠ Idempotent: chạy lại không đổi gì thêm.
-- ====================================================================

-- 1 + 2. Quyền EXECUTE của hàm SECURITY DEFINER
DO $sec$
DECLARE
  f record;
  duoc_goi boolean;
BEGIN
  FOR f IN
    SELECT p.oid, p.oid::regprocedure AS sig, p.proname, t.typname AS tra_ve
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_type t ON t.oid = p.prorettype
     WHERE n.nspname = 'public' AND p.prosecdef AND p.prokind = 'f'
  LOOP
    IF f.proname = 'lookup_email_by_identifier' THEN
      CONTINUE; -- màn đăng nhập gọi khi CHƯA đăng nhập
    END IF;
    duoc_goi := has_function_privilege('authenticated', f.oid, 'EXECUTE');
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    IF f.tra_ve = 'trigger' THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', f.sig);
    ELSIF duoc_goi THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
    END IF;
  END LOOP;
END
$sec$;

-- 3. search_path cố định cho các hàm Supabase cảnh báo (mọi bản nạp chồng)
DO $sp$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND p.proname IN (
         '_giam_gia_don', '_inv_code', '_ma_phieu_tra', '_order_code', '_thue_hop_le',
         '_wf2b_payment_terms_days', 'approval_rules_touch', 'batches_auto_zone',
         'bump_workflow_session_action', 'compute_return_credit', 'enforce_payroll_lock',
         'expenses_touch', 'is_revenue_invoice_status', 'is_revenue_status', 'normalize_phone',
         'pricing_rules_touch', 'sales_routes_touch', 'sync_return_credit_amount', 'tim_kd',
         'touch_role_permissions_updated_at', 'trg_block_driver_role'
       )
       AND NOT EXISTS (
         SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%'
       )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', f.sig);
  END LOOP;
END
$sp$;

-- 4. Kho ảnh công khai: bỏ policy SELECT rộng (xem ảnh bằng URL công khai, không cần policy)
DO $kho$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS "customer_photos_select" ON storage.objects;
    DROP POLICY IF EXISTS "pod_photos_select" ON storage.objects;
    DROP POLICY IF EXISTS "visit_photos_select" ON storage.objects;
  END IF;
END
$kho$;

NOTIFY pgrst, 'reload schema';

SELECT 'Dọn cảnh báo bảo mật' AS hang_muc,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.prosecdef AND p.proname <> 'lookup_email_by_identifier'
           AND has_function_privilege('anon', p.oid, 'EXECUTE')) AS ham_definer_anon_con_goi_duoc,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'tim_kd'
           AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')) AS tim_kd_chua_dat_search_path;
