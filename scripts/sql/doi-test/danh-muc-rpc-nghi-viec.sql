-- ĐỘI TEST "Danh mục, Quyền & Tạo nhanh" — HÀM SECURITY DEFINER (luật mig 166/207), RPC khách hàng,
-- NHÂN VIÊN NGHỈ VIỆC (mig 223), khoá tìm không dấu (mig 205).
--
-- Luật:
--   · CLAUDE.md §3: "Hàm SECURITY DEFINER nội bộ phải REVOKE EXECUTE … FROM PUBLIC, anon, authenticated
--     (luật mig 166)". mig 207: chỉ `lookup_email_by_identifier` gọi được khi chưa đăng nhập.
--   · mig 223 (chủ nhà 02/10/2026): "khi nghỉ bàn giao khách hàng và công nợ về npp. Npp sẽ phân phối lại
--     sau" — khoá đăng nhập, gỡ phân công khách + lịch tuyến, nợ CHƯA THU về NPP (nợ đã thu giữ tên cũ),
--     doanh số (HĐ) vẫn của người cũ; người đã nghỉ không được chọn để gán lại.
--   · mig 205: khoá tìm `khoa_tim` phải trùng từng ký tự với `viValueKey` (src/lib/search.ts).
--
-- Chạy: psql -h /tmp/pgtest -p 55432 -U postgres -d npp_danh_muc -v ON_ERROR_STOP=1 -f scripts/sql/doi-test/danh-muc-rpc-nghi-viec.sql
\set ON_ERROR_STOP on
BEGIN;
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
CREATE TEMP TABLE kq (buoc text, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;

CREATE FUNCTION pg_temp.k(p_buoc text, p_ten text, p_ok boolean, p_ghi text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO kq VALUES (p_buoc, p_ten, COALESCE(p_ok, false), p_ghi);
$f$;
-- Chạy câu với vai authenticated + uid; trả kết quả (text) hoặc 'LOI: <thông điệp>'.
CREATE FUNCTION pg_temp.goi(p_uid uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    EXECUTE p_sql INTO v;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RETURN 'LOI: ' || SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  RETURN COALESCE(v, '<null>');
END $f$;

-- ───────────── 1. QUÉT pg_proc: hàm SECURITY DEFINER ─────────────
DO $t$
DECLARE ds text; n int;
  -- RPC nghiệp vụ authenticated ĐƯỢC gọi (mỗi hàm tự kiểm quyền bên trong — mig 207 "KHÔNG LÀM").
  -- Thêm RPC mới → phải rà kiểm quyền rồi thêm vào đây; chốt này đỏ để nhắc.
  v_cho_phep text[] := ARRAY[
    'acquire_entity_lock','assign_doc_seller','cancel_invoice','cancel_order','cancel_purchase_invoice','cancel_return',
    'cancel_stock_entry','cancel_supplier_return','cap_nhat_luot_soan','cho_nhan_vien_nghi','claim_customer_for_me',
    'close_order','committed_stock_by_product','complete_purchase_invoice','complete_return','complete_supplier_return',
    'compute_payroll_run','confirm_driver_handover','create_cash_receipt','customer_org_id','danh_dau_soan_hang',
    'get_invoiceable_lines','giao_cong_no_npp','gop_nha_cung_cap','heartbeat_entity_lock','hoan_tat_luot_soan','huy_luot_soan',
    'lock_payroll_run','lookup_email_by_identifier','my_payslips','my_sales_target','post_invoice','post_stock_adjustment',
    'post_stock_export','post_stock_import','post_stock_issue','post_stock_transfer','record_payable_payment',
    'refresh_warehouse_zones','reissue_invoice','reject_stock_adjustment','release_entity_lock','release_stale_entity_locks',
    'save_pos_return','search_customer_dupes','so_chung_tu_ncc','so_chung_tu_nhan_vien','tao_luot_soan','user_assigned_customer_ids',
    'user_has_permission','user_is_assigned_to_customer','user_org_id','user_role','user_sells_to_customer','void_cash_receipt','xoa_nha_cung_cap'];
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO ds
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE')
    AND p.proname <> 'lookup_email_by_identifier';
  PERFORM pg_temp.k('1.01', 'anon không gọi được hàm SECURITY DEFINER nào (trừ lookup_email_by_identifier)', ds IS NULL, COALESCE(ds, ''));

  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO ds
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef AND p.proname LIKE '\_%'
    AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'));
  PERFORM pg_temp.k('1.02', 'Hàm nội bộ `_…` SECURITY DEFINER: authenticated/anon không gọi được', ds IS NULL, COALESCE(ds, ''));

  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO ds
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef AND p.prorettype = 'trigger'::regtype
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  PERFORM pg_temp.k('1.03', 'Hàm trigger SECURITY DEFINER: authenticated không gọi được qua /rpc', ds IS NULL, COALESCE(ds, ''));

  SELECT string_agg(DISTINCT p.proname, ', ') INTO ds
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT (p.proname = ANY (v_cho_phep));
  PERFORM pg_temp.k('1.04', 'Mọi RPC SECURITY DEFINER authenticated gọi được đều nằm trong danh sách đã rà', ds IS NULL, COALESCE(ds, ''));

  -- Mỗi RPC ghi dữ liệu (VOLATILE) phải có chốt quyền trong thân: auth.uid / user_org_id / user_role / hàm
  -- quyền riêng — trừ close_order (chỉ RAISE) và release_stale_entity_locks (dọn khoá quá hạn, không dữ liệu).
  SELECT string_agg(DISTINCT p.proname, ', ') INTO ds
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef AND p.provolatile = 'v'
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND p.proname NOT IN ('close_order', 'release_stale_entity_locks')
    AND p.prosrc !~* '(auth\.uid|user_org_id\(|user_role\(|_luot_soan_quyen\()';
  PERFORM pg_temp.k('1.05', 'RPC ghi dữ liệu nào cũng có chốt quyền trong thân hàm', ds IS NULL, COALESCE(ds, ''));

  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.prosecdef AND p.prokind = 'f'
    AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%');
  PERFORM pg_temp.k('1.06', 'Mọi hàm SECURITY DEFINER đặt search_path cố định', n = 0, n::text);
END $t$;

-- ───────────── DỰNG: NPP B + NVBH Hải (NPP A) có khách, tuyến, nợ ─────────────
INSERT INTO auth.users (id, email) VALUES
  ('e0000000-0000-0000-0000-000000000006', 'hai@test.local'),
  ('e0000000-0000-0000-0000-000000000007', 'owner2@test.local'),
  ('e0000000-0000-0000-0000-000000000008', 'moi@test.local'),
  ('f0000000-0000-0000-0000-000000000001', 'ownerb@test.local'),
  ('f0000000-0000-0000-0000-000000000002', 'salesb@test.local');
INSERT INTO organizations (id, name, slug) VALUES ('b0000000-0000-0000-0000-000000000001', 'NPP Khac', 'npp-khac-test');
INSERT INTO users (id, org_id, full_name, role, phone, is_active) VALUES
  ('e0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'Vu Van Hai', 'sales', '0977000006', true),
  ('e0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'Dong Chu', 'owner', '0977000007', true),
  ('e0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', 'NV Moi', 'sales', '0977000008', true),
  ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Chu NPP B', 'owner', '0977000101', true),
  ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'NVBH NPP B', 'sales', '0977000102', true);
INSERT INTO customers (id, org_id, store_name, owner_name, phone, address, channel) VALUES
  ('cc000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Tạp hoá Hải Đăng', 'Hải', '0988000001', 'Lê Lợi', 'GT'),
  ('cc000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Quán Đức Mạnh', 'Mạnh', '0988000003', 'Trần Phú', 'GT'),
  ('cb000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Khach NPP B', 'B', '0988000002', 'Q1', 'GT');
INSERT INTO customer_assignments (customer_id, user_id, role) VALUES
  ('cc000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000006', 'primary'),
  ('cc000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000006', 'primary');
INSERT INTO pjp_routes (org_id, sales_user_id, day_of_week, customer_id) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000006', 2, 'cc000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000006', 5, 'cc000000-0000-0000-0000-000000000002');
INSERT INTO sales_orders (id, org_id, order_code, customer_id, sales_user_id, status, total) VALUES
  ('5d000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'x', 'cc000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000006', 'completed', 200000),
  ('5d000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'x', 'cc000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000006', 'completed', 150000);
INSERT INTO sales_invoices (id, org_id, invoice_code, order_id, customer_id, sales_user_id, status, total, invoice_seq) VALUES
  ('51000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'HD-DM-02', '5d000000-0000-0000-0000-000000000002', 'cc000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000006', 'posted', 200000, 990002),
  ('51000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'HD-DM-04', '5d000000-0000-0000-0000-000000000004', 'cc000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000006', 'posted', 150000, 990004);
-- Nợ: HĐ-02 còn 200.000 − 50.000 đã thu = 150.000 (mở); HĐ-04 đã thu đủ 150.000 (paid); HĐ-04b dư có −30.000 (mở).
INSERT INTO receivables (id, org_id, customer_id, sales_user_id, amount, paid, status, invoice_id, order_id) VALUES
  ('7c000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000006', 200000, 50000, 'open', '51000000-0000-0000-0000-000000000002', '5d000000-0000-0000-0000-000000000002'),
  ('7c000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000006', 150000, 150000, 'paid', '51000000-0000-0000-0000-000000000004', '5d000000-0000-0000-0000-000000000004');
INSERT INTO receivables (id, org_id, customer_id, sales_user_id, amount, paid, status, opening_balance) VALUES
  ('7c000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000006', -30000, 0, 'open', true);

-- ───────────── 2. RPC khách hàng ─────────────
DO $t$
DECLARE
  owner uuid := 'e0000000-0000-0000-0000-000000000001'; dung uuid := 'e0000000-0000-0000-0000-000000000004';
  hai uuid := 'e0000000-0000-0000-0000-000000000006'; ownb uuid := 'f0000000-0000-0000-0000-000000000001';
  r text;
BEGIN
  r := pg_temp.goi(dung, $q$select store_name || '|' || coalesce(primary_user_name,'') || '|' || has_my_assignment from search_customer_dupes('0988000001')$q$);
  PERFORM pg_temp.k('2.01', 'NVBH Dung dò trùng SĐT thấy khách của Hải (kèm tên người phụ trách) dù RLS giấu', r = 'Tạp hoá Hải Đăng|Vu Van Hai|false', r);
  r := pg_temp.goi(dung, $q$select count(*)::text from search_customer_dupes('0988000002')$q$);
  PERFORM pg_temp.k('2.02', 'Dò trùng SĐT của khách NPP B từ NPP A → 0 dòng (không lộ chéo NPP)', r = '0', r);
  r := pg_temp.goi(dung, $q$select string_agg(store_name, ',') from search_customer_dupes('hai dang')$q$);
  PERFORM pg_temp.k('2.03', 'Dò trùng theo tên KHÔNG DẤU "hai dang" có "Tạp hoá Hải Đăng"', r LIKE '%Tạp hoá Hải Đăng%', r);
  r := pg_temp.goi(dung, $q$select string_agg(store_name, ',') from search_customer_dupes('DUC MANH')$q$);
  PERFORM pg_temp.k('2.04', 'Chữ Đ: "DUC MANH" ra "Quán Đức Mạnh"', r = 'Quán Đức Mạnh', r);
  r := pg_temp.goi(dung, $q$select count(*)::text from search_customer_dupes('a')$q$);
  PERFORM pg_temp.k('2.05', 'Từ khoá 1 ký tự → không trả gì (tránh liệt kê cả sổ)', r = '0', r);
  r := pg_temp.goi(NULL, $q$select count(*)::text from search_customer_dupes('0988000001')$q$);
  PERFORM pg_temp.k('2.06', 'Chưa đăng nhập (uid rỗng) → 0 dòng', r = '0', r);
  r := pg_temp.goi(dung, $q$select string_agg(store_name, ',') from search_customer_dupes('0988 000 001')$q$);
  PERFORM pg_temp.k('2.07', 'SĐT gõ có dấu cách "0988 000 001" vẫn ra khách', r = 'Tạp hoá Hải Đăng', r);

  r := pg_temp.goi(dung, $q$select claim_customer_for_me('cb000000-0000-0000-0000-000000000001')::text$q$);
  PERFORM pg_temp.k('2.08', 'NVBH NPP A nhận khách NPP B → bị chặn', r LIKE 'LOI:%không tồn tại%', r);
  r := pg_temp.goi(owner, $q$select claim_customer_for_me('cc000000-0000-0000-0000-000000000001')::text$q$);
  PERFORM pg_temp.k('2.09', 'Chủ NPP gọi claim_customer_for_me → bị chặn (chỉ NVBH)', r LIKE 'LOI:%sales%', r);
  r := pg_temp.goi(dung, $q$select claim_customer_for_me('cc000000-0000-0000-0000-000000000001')->>'role'$q$);
  PERFORM pg_temp.k('2.10', 'Dung nhận khách đã có Hải phụ trách chính → vào làm "secondary"', r = 'secondary', r);
  r := pg_temp.goi(dung, $q$select claim_customer_for_me('cc000000-0000-0000-0000-000000000001')->>'status'$q$);
  PERFORM pg_temp.k('2.11', 'Bấm nhận lần hai → already_assigned, không thêm dòng',
    r = 'already_assigned' AND (SELECT count(*) FROM customer_assignments WHERE customer_id = 'cc000000-0000-0000-0000-000000000001') = 2, r);
  r := pg_temp.goi(dung, $q$select claim_customer_for_me('d0000000-0000-0000-0000-000000000020')->>'role'$q$);
  PERFORM pg_temp.k('2.12', 'Nhận khách chưa ai phụ trách → "primary"', r = 'primary', r);

  -- Hàm quyền dùng trong RLS — không lộ chéo NPP.
  r := pg_temp.goi(ownb, $q$select coalesce(user_org_id()::text,'<null>') || '|' || user_role()$q$);
  PERFORM pg_temp.k('2.13', 'user_org_id / user_role của chủ NPP B đúng NPP B', r = 'b0000000-0000-0000-0000-000000000001|owner', r);
  r := pg_temp.goi(owner, $q$select refresh_warehouse_zones('b0000000-0000-0000-0000-000000000001')::text$q$);
  PERFORM pg_temp.k('2.14', 'Chủ NPP A rà kho NPP B → ORG_MISMATCH', r LIKE 'LOI: ORG_MISMATCH%', r);
  r := pg_temp.goi(owner, $q$select assign_doc_seller('invoice','51000000-0000-0000-0000-000000000002','f0000000-0000-0000-0000-000000000002')::text$q$);
  PERFORM pg_temp.k('2.15', 'Gán HĐ cho NVBH NPP B → ASSIGN_BAD_USER', r LIKE 'LOI: ASSIGN_BAD_USER%', r);
  r := pg_temp.goi(ownb, $q$select assign_doc_seller('invoice','51000000-0000-0000-0000-000000000002','f0000000-0000-0000-0000-000000000002')::text$q$);
  PERFORM pg_temp.k('2.16', 'Chủ NPP B gán HĐ của NPP A → DOC_NOT_FOUND',
    r LIKE 'LOI: DOC_NOT_FOUND%' AND (SELECT sales_user_id FROM sales_invoices WHERE id = '51000000-0000-0000-0000-000000000002') = hai, r);
  r := pg_temp.goi(dung, $q$select assign_doc_seller('invoice','51000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000004')::text$q$);
  PERFORM pg_temp.k('2.17', 'NVBH tự gán HĐ của người khác cho mình → ASSIGN_FORBIDDEN', r LIKE 'LOI: ASSIGN_FORBIDDEN%', r);
  r := pg_temp.goi(owner, $q$select assign_doc_seller('invoice','51000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000005')::text$q$);
  PERFORM pg_temp.k('2.18', 'Gán HĐ cho thủ kho (không bán hàng) → ASSIGN_BAD_USER', r LIKE 'LOI: ASSIGN_BAD_USER%', r);
END $t$;

-- ───────────── 3. NHÂN VIÊN NGHỈ VIỆC (mig 223) ─────────────
DO $t$
DECLARE
  owner uuid := 'e0000000-0000-0000-0000-000000000001'; mgr uuid := 'e0000000-0000-0000-0000-000000000002';
  acc uuid := 'e0000000-0000-0000-0000-000000000003'; dung uuid := 'e0000000-0000-0000-0000-000000000004';
  hai uuid := 'e0000000-0000-0000-0000-000000000006'; ownb uuid := 'f0000000-0000-0000-0000-000000000001';
  r text; j jsonb;
BEGIN
  r := pg_temp.goi(mgr, $q$select so_chung_tu_nhan_vien('e0000000-0000-0000-0000-000000000006')::text$q$);
  PERFORM pg_temp.k('3.01', 'Quản lý xem chứng từ NV → KHONG_DU_QUYEN (chỉ chủ NPP)', r LIKE 'LOI: KHONG_DU_QUYEN%', r);
  r := pg_temp.goi(ownb, $q$select so_chung_tu_nhan_vien('e0000000-0000-0000-0000-000000000006')::text$q$);
  PERFORM pg_temp.k('3.02', 'Chủ NPP B đếm chứng từ NV NPP A → KHONG_TIM_THAY_NV', r LIKE 'LOI: KHONG_TIM_THAY_NV%', r);
  j := pg_temp.goi(owner, $q$select so_chung_tu_nhan_vien('e0000000-0000-0000-0000-000000000006')::text$q$)::jsonb;
  -- Nợ chưa thu của Hải: 150.000 (HĐ-02) + (−30.000 dư có) = 120.000, 2 khoản; HĐ-04 đã thu không tính.
  PERFORM pg_temp.k('3.03', 'Đếm: Hải 2 khách, 2 lịch tuyến, 2 khoản nợ chưa thu = 120.000 (dư có âm được trừ), có chứng từ chặn xoá',
    (j->>'khach')::int = 2 AND (j->>'lich_tuyen')::int = 2 AND (j->>'so_khoan_no')::int = 2
    AND (j->>'tien_no')::numeric = 120000 AND (j->>'tong')::int > 0, j::text);
  j := pg_temp.goi(owner, $q$select so_chung_tu_nhan_vien('e0000000-0000-0000-0000-000000000008')::text$q$)::jsonb;
  PERFORM pg_temp.k('3.04', 'NV mới chưa có chứng từ → tong = 0 (xoá hẳn được)', (j->>'tong')::int = 0 AND (j->>'khach')::int = 0, j::text);

  r := pg_temp.goi(dung, $q$select cho_nhan_vien_nghi('e0000000-0000-0000-0000-000000000006')::text$q$);
  PERFORM pg_temp.k('3.05', 'NVBH cho người khác nghỉ → KHONG_DU_QUYEN', r LIKE 'LOI: KHONG_DU_QUYEN%', r);
  r := pg_temp.goi(acc, $q$select cho_nhan_vien_nghi('e0000000-0000-0000-0000-000000000006')::text$q$);
  PERFORM pg_temp.k('3.06', 'Kế toán cho nghỉ → KHONG_DU_QUYEN', r LIKE 'LOI: KHONG_DU_QUYEN%', r);
  r := pg_temp.goi(owner, $q$select cho_nhan_vien_nghi('e0000000-0000-0000-0000-000000000001')::text$q$);
  PERFORM pg_temp.k('3.07', 'Chủ NPP tự cho mình nghỉ → TU_NGHI', r LIKE 'LOI: TU_NGHI%', r);
  r := pg_temp.goi(owner, $q$select cho_nhan_vien_nghi('e0000000-0000-0000-0000-000000000007')::text$q$);
  PERFORM pg_temp.k('3.08', 'Cho một chủ NPP khác nghỉ → NGHI_CHU_NPP', r LIKE 'LOI: NGHI_CHU_NPP%', r);
  r := pg_temp.goi(ownb, $q$select cho_nhan_vien_nghi('e0000000-0000-0000-0000-000000000006')::text$q$);
  PERFORM pg_temp.k('3.09', 'Chủ NPP B cho NV NPP A nghỉ → KHONG_TIM_THAY_NV, Hải vẫn hoạt động',
    r LIKE 'LOI: KHONG_TIM_THAY_NV%' AND (SELECT is_active AND left_at IS NULL FROM users WHERE id = hai), r);

  j := pg_temp.goi(owner, $q$select cho_nhan_vien_nghi('e0000000-0000-0000-0000-000000000006')::text$q$)::jsonb;
  PERFORM pg_temp.k('3.10', 'Cho Hải nghỉ: trả 2 khách, 2 lịch tuyến, 2 khoản nợ, 120.000',
    (j->>'khach')::int = 2 AND (j->>'lich_tuyen')::int = 2 AND (j->>'so_khoan_no')::int = 2 AND (j->>'tien_no')::numeric = 120000, j::text);
  PERFORM pg_temp.k('3.11', 'Hải: is_active = false, left_at có, left_by = chủ NPP',
    (SELECT NOT is_active AND left_at IS NOT NULL AND left_by = owner FROM users WHERE id = hai), '');
  PERFORM pg_temp.k('3.12', 'Phân công khách + lịch tuyến của Hải đã gỡ (0 / 0)',
    (SELECT count(*) FROM customer_assignments WHERE user_id = hai) = 0 AND (SELECT count(*) FROM pjp_routes WHERE sales_user_id = hai) = 0, '');
  PERFORM pg_temp.k('3.13', 'Nợ chưa thu về NPP: sales_user_id NULL + ve_npp_luc, số tiền KHÔNG đổi (200.000/50.000 và −30.000)',
    (SELECT bool_and(sales_user_id IS NULL AND ve_npp_luc IS NOT NULL) FROM receivables WHERE id IN ('7c000000-0000-0000-0000-000000000002','7c000000-0000-0000-0000-000000000006'))
    AND (SELECT amount = 200000 AND paid = 50000 AND status = 'partial' FROM receivables WHERE id = '7c000000-0000-0000-0000-000000000002')
    AND (SELECT amount = -30000 AND status = 'open' FROM receivables WHERE id = '7c000000-0000-0000-0000-000000000006'),
    (SELECT string_agg(format('%s nv=%s co=%s %s/%s %s', right(id::text,1), sales_user_id, ve_npp_luc IS NOT NULL, amount, paid, status), '; ') FROM receivables WHERE customer_id IN ('cc000000-0000-0000-0000-000000000001','cc000000-0000-0000-0000-000000000002')));
  PERFORM pg_temp.k('3.14', 'Nợ đã thu đủ giữ tên Hải (lịch sử)',
    (SELECT sales_user_id = hai AND ve_npp_luc IS NULL FROM receivables WHERE id = '7c000000-0000-0000-0000-000000000005'), '');
  PERFORM pg_temp.k('3.15', 'Doanh số (HĐ) vẫn đứng tên Hải: 2 HĐ = 350.000',
    (SELECT count(*) = 2 AND sum(total) = 350000 FROM sales_invoices WHERE sales_user_id = hai AND status = 'posted'), '');

  -- Người đã nghỉ (JWT còn hạn) không đọc / ghi được gì.
  r := pg_temp.goi(hai, $q$select (select count(*) from customers) + (select count(*) from receivables) + (select count(*) from sales_invoices) + (select count(*) from sales_orders)$q$);
  PERFORM pg_temp.k('3.16', 'Người đã nghỉ (phiên còn hạn) đọc 0 dòng khách / nợ / HĐ / đơn', r = '0', r);
  r := pg_temp.goi(hai, $q$insert into customers (org_id, store_name, owner_name, phone, address, created_by) values ('a0000000-0000-0000-0000-000000000001','X','X','0911999888','X','e0000000-0000-0000-0000-000000000006') returning id::text$q$);
  PERFORM pg_temp.k('3.17', 'Người đã nghỉ tạo khách → bị chặn', r LIKE 'LOI:%row-level security%', r);
  r := pg_temp.goi(hai, $q$select claim_customer_for_me('cc000000-0000-0000-0000-000000000001')::text$q$);
  PERFORM pg_temp.k('3.18', 'Người đã nghỉ nhận khách → bị chặn', r LIKE 'LOI:%', r);

  -- Không gán lại cho người đã nghỉ.
  r := pg_temp.goi(owner, $q$select assign_doc_seller('invoice','51000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000006')::text$q$);
  PERFORM pg_temp.k('3.19', 'Gán HĐ cho người đã nghỉ → ASSIGN_BAD_USER', r LIKE 'LOI: ASSIGN_BAD_USER%', r);
  r := pg_temp.goi(acc, $q$select giao_cong_no_npp('cc000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000006')::text$q$);
  PERFORM pg_temp.k('3.20', 'Giao nợ lại cho người đã nghỉ → NV_KHONG_HOP_LE', r LIKE 'LOI: NV_KHONG_HOP_LE%', r);
  r := pg_temp.goi(acc, $q$select giao_cong_no_npp('cc000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002')::text$q$);
  PERFORM pg_temp.k('3.21', 'Giao nợ cho NV NPP B → NV_KHONG_HOP_LE', r LIKE 'LOI: NV_KHONG_HOP_LE%', r);
  r := pg_temp.goi(dung, $q$select giao_cong_no_npp('cc000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000004')::text$q$);
  PERFORM pg_temp.k('3.22', 'NVBH tự nhận nợ về mình → KHONG_DU_QUYEN', r LIKE 'LOI: KHONG_DU_QUYEN%', r);

  -- Tính lại nợ (đường HĐ) sau khi nghỉ không kéo nợ về Hải.
  PERFORM public._wf2b_recompute_receivable('51000000-0000-0000-0000-000000000002');
  PERFORM pg_temp.k('3.23', 'Tính lại nợ HĐ-02 sau khi Hải nghỉ → vẫn NPP giữ, còn 150.000',
    (SELECT sales_user_id IS NULL AND ve_npp_luc IS NOT NULL AND amount - paid = 150000 FROM receivables WHERE invoice_id = '51000000-0000-0000-0000-000000000002'),
    (SELECT format('nv=%s co=%s con=%s', sales_user_id, ve_npp_luc, amount - paid) FROM receivables WHERE invoice_id = '51000000-0000-0000-0000-000000000002'));

  -- Kế toán phân lại nợ khách cc…01 cho Dung → Dung thấy thêm 150.000.
  j := pg_temp.goi(acc, $q$select giao_cong_no_npp('cc000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000004')::text$q$)::jsonb;
  PERFORM pg_temp.k('3.24', 'Kế toán phân lại nợ khách cc…01 cho Dung: 1 khoản, 150.000', (j->>'so_khoan_no')::int = 1 AND (j->>'tien_no')::numeric = 150000, j::text);
  r := pg_temp.goi(dung, $q$select coalesce(sum(amount - paid),0)::text from receivables$q$);
  PERFORM pg_temp.k('3.25', 'Dung giờ thấy nợ 150.000 của khách được giao', r = '150000', r);
  PERFORM pg_temp.k('3.26', 'Nợ của khách cc…02 (−30.000) vẫn ở NPP',
    (SELECT sales_user_id IS NULL FROM receivables WHERE id = '7c000000-0000-0000-0000-000000000006'), '');
  j := pg_temp.goi(acc, $q$select giao_cong_no_npp('cc000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000004')::text$q$)::jsonb;
  PERFORM pg_temp.k('3.27', 'Giao lại lần hai (đã giao) → 0 khoản (không nhân đôi)', (j->>'so_khoan_no')::int = 0, j::text);

  -- Nhận lại nhân viên (màn Người dùng: is_active true, left_at null) → đăng nhập lại được, nhưng không tự lấy lại khách / nợ.
  r := pg_temp.goi(owner, $q$with x as (update users set is_active = true, left_at = null, left_by = null where id = 'e0000000-0000-0000-0000-000000000006' returning 1) select count(*)::text from x$q$);
  PERFORM pg_temp.k('3.28', 'Chủ NPP nhận lại Hải (1 dòng)', r = '1', r);
  r := pg_temp.goi(hai, $q$select (select count(*) from customers)::text || '|' || (select count(*) from receivables)::text$q$);
  PERFORM pg_temp.k('3.29', 'Hải quay lại: thấy 2 khách (qua HĐ cũ của mình), 1 khoản nợ đã thu (lịch sử); nợ đã phân lại không quay về',
    r = '2|1', r);
END $t$;

-- ───────────── 4. Khoá tìm không dấu (mig 205) — trùng `viValueKey` (tests/doi-danh-muc.test.ts cùng bộ mẫu) ─────────────
DO $t$
DECLARE r text;
BEGIN
  PERFORM pg_temp.k('4.01', 'khoa_tim(DH-0123)', khoa_tim('DH-0123') = 'dh 0123 dh0123 dh123', khoa_tim('DH-0123'));
  PERFORM pg_temp.k('4.02', 'khoa_tim(0912 345 678)', khoa_tim('0912 345 678') = '0912 345 678 0912345678 912345678', khoa_tim('0912 345 678'));
  PERFORM pg_temp.k('4.03', 'khoa_tim(Sữa hộp)', khoa_tim('Sữa hộp') = 'sua hop suahop', khoa_tim('Sữa hộp'));
  PERFORM pg_temp.k('4.04', 'khoa_tim(Đường Đá) — đ → d', khoa_tim('Đường Đá') = 'duong da duongda', khoa_tim('Đường Đá'));
  PERFORM pg_temp.k('4.05', 'khoa_tim(SP-00)', khoa_tim('SP-00') = 'sp 00 sp00 sp0', khoa_tim('SP-00'));
  PERFORM pg_temp.k('4.06', 'khoa_tim rỗng / NULL → chuỗi rỗng', COALESCE(khoa_tim(''), '') = '' AND COALESCE(khoa_tim(NULL), '') = '', '');
  PERFORM pg_temp.k('4.07', 'khoa_tim(Q.8 – Bách Hoá Xanh)', khoa_tim('Q.8 – Bách Hoá Xanh') = 'q 8 bach hoa xanh q8bachhoaxanh', khoa_tim('Q.8 – Bách Hoá Xanh'));
  -- Trigger tim_kd của khách cập nhật khi đổi tên.
  UPDATE customers SET store_name = 'Nhà Thuốc Đông Á' WHERE id = 'cc000000-0000-0000-0000-000000000002';
  SELECT tim_kd INTO r FROM customers WHERE id = 'cc000000-0000-0000-0000-000000000002';
  PERFORM pg_temp.k('4.08', 'Đổi tên khách → tim_kd có "nha thuoc dong a", bỏ tên cũ "quan duc manh"',
    position('nha thuoc dong a' IN r) > 0 AND position('quan duc manh' IN r) = 0, r);
  SELECT tim_kd INTO r FROM suppliers WHERE false;
  INSERT INTO suppliers (org_id, name, code, phone) VALUES ('a0000000-0000-0000-0000-000000000001', 'Công ty Đại Phát', 'NCC-01', '0243 888 999');
  SELECT tim_kd INTO r FROM suppliers WHERE code = 'NCC-01';
  PERFORM pg_temp.k('4.09', 'NCC mới có tim_kd (tên không dấu + mã viết liền bỏ 0 đầu + SĐT liền)',
    r LIKE '%cong ty dai phat%' AND r LIKE '%ncc1%' AND r LIKE '%0243888999%', r);
END $t$;

SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
