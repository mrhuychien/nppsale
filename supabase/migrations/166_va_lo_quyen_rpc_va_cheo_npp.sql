-- ====================================================================
-- VÁ LỖ QUYỀN: RPC AI CŨNG GỌI ĐƯỢC, VÀ QUYỀN RÒ SANG NPP KHÁC
--
-- Rơi ra từ đợt QA 22/09/2026. Mọi mục dưới đây ĐÃ ĐO trên Postgres 16
-- (mig 001→165), đăng nhập đúng vai, trong BEGIN…ROLLBACK.
--
-- ⚠ CÙNG MỘT GỐC: hàm SECURITY DEFINER chạy BỎ QUA RLS. Nên hàm nào
--   ghi vào bảng thì phải TỰ kiểm đúng cái RLS của bảng ấy đang kiểm —
--   nếu không, RLS chỉ còn là cửa trước, còn cửa hông mở toang. Các hàm
--   dưới đây chỉ kiểm "cùng NPP", không kiểm "vai nào".
--
--   1. `user_has_permission` đọc `role_permissions` và override KHÔNG
--      lọc theo NPP. Đo: chủ NPP B bật `orders.approve` cho vai sales
--      của NPP B → NVBH của NPP A cũng có luôn (f → t).
--   2. `org_iso_upo_write` chỉ kiểm cột `org_id` của dòng, không kiểm
--      người bị gán quyền có thuộc NPP ấy không. Đo: quản lý NPP A tước
--      `orders.approve` của CHỦ NPP B (t → f), và phía B không thấy dòng
--      ấy. Cùng lỗ: quản lý tước quyền của chính chủ NPP mình.
--   3. `_apply_return_edits`, `_apply_return_adds`, `_pending_return_for`
--      không kiểm gì, và CHƯA TỪNG bị REVOKE — PUBLIC gọi được, tức cả
--      anon. Đo: `SET ROLE anon` sửa được dòng trả hàng của NPP khác.
--      `_wf2b_gross_revenue_for(p_org…)` trả doanh số NPP khác;
--      `next_purchase_receipt_code(p_org)` lộ số phiếu kế tiếp.
--      Cả năm hàm chỉ được gọi từ BÊN TRONG hàm SECURITY DEFINER khác
--      (đã tra `pg_proc.prosrc`), nên thu quyền gọi thẳng không làm gãy
--      luồng nào — đúng việc mig 156/157 đã làm cho `_wf2_restock`.
--   4. RPC kho chỉ kiểm cùng NPP. Đo: NVBH gọi `cancel_stock_entry` trên
--      phiếu nhập → lô 100 → 0; `cancel_supplier_return` → tồn 993 →
--      1000; `post_stock_export` → kho bị trừ.
--   5. `cancel_stock_entry` đảo cả phiếu kho do hoá đơn mua / phiếu trả
--      khách / nhập kho có công nợ NCC sinh ra. Đo: kho về 0, hoá đơn mua
--      vẫn `completed`, công nợ NCC vẫn 60.000 mở.
--   6. `order_status_history` còn chính sách cũ `USING (true)` (mig 008)
--      — mig 033 thêm chính sách đúng mà quên DROP cái cũ, và chính sách
--      permissive thì OR với nhau. Đo: NVBH NPP A đọc được ghi chú đơn
--      của NPP B.
--   7. `payments` vẫn cho sales/driver INSERT thẳng, `receivables` vẫn
--      cho sales INSERT thẳng. Không màn nào còn sống cần — thu tiền và
--      ghi nợ đều qua `create_cash_receipt` / `post_invoice` (SECURITY
--      DEFINER). Đo: NVBH chèn thẳng `payments` 900.000 → "đã thu" phồng.
--   8. `returns` không có chính sách DELETE cho chủ/quản lý → sửa đơn
--      bỏ hết hàng trả thì phiếu trả nháp nằm lại (cùng khuôn mig 165,
--      khác vai).
--   9. `refresh_warehouse_zones(p_org_id)` không kiểm NPP. Đo: NVBH NPP B
--      dời lô của NPP A sang kho date.
--
-- ⚠ VAI LẤY ĐÚNG TỪ RLS CỦA BẢNG MÀ HÀM BỎ QUA — không bịa luật mới:
--     stock_entries / batches         : owner, warehouse
--     purchase_invoices / supplier_returns : owner, manager, accountant, warehouse
--
-- ⚠ `post_stock_export` CÒN ĐƯỢC GỌI TỪ TRONG `post_invoice` (qua
--   `_wf2_export_order`), mà người xuất hoá đơn là kế toán/quản lý. Nên
--   cổng vai BỎ QUA khi `npp.via_rpc = 'on'` — cờ chỉ hàm SECURITY
--   DEFINER đặt được (`set_config(..., true)`, sống trong một giao dịch;
--   PostgREST không cho đặt GUC tuỳ ý).
--
-- ⚠ CHẠY LẠI ĐƯỢC. Mỗi bản vá chuỗi có dấu "(mig 166)"; thấy dấu thì
--   đứng yên. Tìm không đúng MỘT chỗ để vá thì DỪNG và in thân hàm ra.
-- ====================================================================


-- ---------------------------------------------------------------------
-- 1. user_has_permission — lọc theo NPP của người được hỏi
-- ---------------------------------------------------------------------
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
  v_org        uuid;
  v_module     text;
  v_action     text;
  v_last_dot   int;
BEGIN
  SELECT u.role, u.org_id INTO v_role, v_org FROM users u WHERE u.id = p_user_id;
  IF v_role IS NULL THEN RETURN false; END IF;

  -- 1. Override thắng — nhưng CHỈ override của đúng NPP người ấy (mig 166).
  SELECT granted INTO v_override
  FROM user_permission_overrides
  WHERE user_id = p_user_id AND permission_key = p_perm AND org_id = v_org;
  IF FOUND THEN
    RETURN v_override;
  END IF;

  -- 2. Chủ NPP luôn được.
  IF v_role = 'owner' THEN RETURN true; END IF;

  -- 3. role_permissions CỦA ĐÚNG NPP ẤY (mig 166). Tách khoá ở dấu chấm
  --    CUỐI: "customers.analytics.read" → module "customers.analytics".
  v_last_dot := length(p_perm) - position('.' IN reverse(p_perm)) + 1;
  IF v_last_dot > 1 AND v_last_dot < length(p_perm) THEN
    v_module := substring(p_perm FROM 1 FOR v_last_dot - 1);
    v_action := substring(p_perm FROM v_last_dot + 1);
    RETURN COALESCE(
      (SELECT allowed FROM role_permissions rp
        WHERE rp.org_id = v_org
          AND rp.role = v_role
          AND rp.module = v_module
          AND rp.action = v_action),
      false
    );
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.user_has_permission(uuid, text) IS
  'Resolver — override (cùng NPP) > role_permissions (cùng NPP) > false. Chủ NPP luôn true trừ khi có override. Mig 166: lọc theo NPP.';

-- ⚠ Trước 166, NPP tạo SAU các mig 116/120/123/125 không có dòng
--   role_permissions nào, và `LIMIT 1` không lọc NPP vô tình mượn dòng
--   của NPP khác. Nay lọc đúng NPP thì NPP mới sẽ mất các ô ấy — nên
--   gieo đủ bộ mặc định cho mọi NPP còn thiếu, và cho NPP tạo về sau.
CREATE OR REPLACE FUNCTION public._gieo_quyen_mac_dinh(p_org uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO role_permissions (org_id, role, module, action, allowed)
  SELECT p_org, v.role, v.module, v.action, true
  FROM (VALUES
    ('manager',    'orders',      'approve'),
    ('manager',    'orders',      'update'),
    ('manager',    'returns',     'approve'),
    ('manager',    'inventory',   'approve'),
    ('sales',      'orders',      'update'),
    ('sales',      'receivables', 'create'),
    ('accountant', 'receivables', 'create'),
    ('accountant', 'receivables', 'update')
  ) AS v(role, module, action)
  ON CONFLICT (org_id, role, module, action) DO NOTHING;
$$;
REVOKE ALL ON FUNCTION public._gieo_quyen_mac_dinh(uuid) FROM PUBLIC, anon, authenticated;

SELECT public._gieo_quyen_mac_dinh(id) FROM organizations;

CREATE OR REPLACE FUNCTION public._trg_gieo_quyen_npp_moi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._gieo_quyen_mac_dinh(NEW.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._trg_gieo_quyen_npp_moi() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_gieo_quyen_npp_moi ON organizations;
CREATE TRIGGER trg_gieo_quyen_npp_moi
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION public._trg_gieo_quyen_npp_moi();


-- ---------------------------------------------------------------------
-- 2. Override quyền: người bị gán phải cùng NPP; quản lý không đụng chủ
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS org_iso_upo_write ON user_permission_overrides;
CREATE POLICY org_iso_upo_write ON user_permission_overrides
  FOR ALL TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
    AND EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = user_permission_overrides.user_id
        AND u.org_id = public.user_org_id()
        AND (public.user_role() = 'owner' OR u.role <> 'owner')
    )
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
    AND EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = user_permission_overrides.user_id
        AND u.org_id = public.user_org_id()
        AND (public.user_role() = 'owner' OR u.role <> 'owner')
    )
  );

-- Dòng override rò sẵn (người bị gán khác NPP với cột org_id) là rác
-- vô hiệu từ nay — `user_has_permission` đã lọc theo NPP. Dọn đi để
-- màn Phân quyền không hiện thứ không có tác dụng.
DROP TABLE IF EXISTS _166_upo_ro;
CREATE TEMP TABLE _166_upo_ro AS
SELECT o.user_id, o.permission_key
FROM user_permission_overrides o JOIN users u ON u.id = o.user_id
WHERE u.org_id IS DISTINCT FROM o.org_id;
DELETE FROM user_permission_overrides o
USING _166_upo_ro r
WHERE o.user_id = r.user_id AND o.permission_key = r.permission_key;


-- ---------------------------------------------------------------------
-- 3. Hàm nội bộ: thu quyền gọi thẳng
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._apply_return_edits(uuid, jsonb)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._apply_return_adds(uuid, uuid, jsonb)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._pending_return_for(uuid, uuid)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._wf2b_gross_revenue_for(uuid, uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.next_purchase_receipt_code(uuid)           FROM PUBLIC, anon, authenticated;

-- ⚠ VÀ MỌI HÀM NỘI BỘ KHÁC. Các mig trước chỉ `REVOKE … FROM PUBLIC`
--   (`_wf2_restock`, `_wf2_export_order`, `_wf2_notify`, `_next_order_seq`
--   …). Trên Postgres trơn thế là đủ, nhưng Supabase cấp EXECUTE THẲNG
--   cho `anon` và `authenticated` qua ALTER DEFAULT PRIVILEGES — nên thu
--   từ PUBLIC không thu được hai vai ấy. DB thử của chúng ta không có
--   default privileges kiểu đó, nên phép đo ở đây KHÔNG thấy được lỗ này;
--   bảng tóm tắt cuối tệp đếm lại trên DB thật.
--   Quy ước đã có sẵn: tên bắt đầu bằng `_` là hàm nội bộ, chỉ hàm
--   SECURITY DEFINER khác gọi (đã tra: không màn nào `rpc("_…")`, không
--   chính sách RLS nào gọi hàm `_…`).
DO $thu$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef AND p.proname LIKE '\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.fn);
  END LOOP;
END;
$thu$;


-- ---------------------------------------------------------------------
-- 4. RPC kho / mua hàng: kiểm đúng vai mà RLS của bảng đang kiểm
-- ---------------------------------------------------------------------
DO $patch$
DECLARE
  r      record;
  v_oid  oid;
  v_src  text;
  v_n    int;
  v_stmt text;
  v_re   text := 'IF v_org <> public\.user_org_id\(\) THEN\s+RAISE EXCEPTION[^;]*;\s+END IF;';
  v_vai  text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('cancel_stock_entry(uuid,text)',        'owner,warehouse'),
      ('post_stock_export(uuid)',              'owner,warehouse'),
      ('post_stock_issue(uuid)',               'owner,warehouse'),
      ('post_stock_transfer(uuid)',            'owner,warehouse'),
      ('complete_purchase_invoice(uuid)',      'owner,manager,accountant,warehouse'),
      ('cancel_purchase_invoice(uuid,text)',   'owner,manager,accountant,warehouse'),
      ('complete_supplier_return(uuid)',       'owner,manager,accountant,warehouse'),
      ('cancel_supplier_return(uuid,text)',    'owner,manager,accountant,warehouse')
    ) AS t(fn, vai)
  LOOP
    v_oid := to_regprocedure('public.' || r.fn);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '166: không có hàm %', r.fn USING ERRCODE = 'P0001';
    END IF;
    v_src := pg_get_functiondef(v_oid);

    IF position('(mig 166)' in v_src) > 0 THEN
      CONTINUE;
    END IF;

    SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_re, 'g');
    IF v_n <> 1 THEN
      RAISE EXCEPTION '166: % có % chỗ kiểm NPP (cần đúng 1). Thân hàm hiện tại:%',
        r.fn, v_n, E'\n' || v_src USING ERRCODE = 'P0001';
    END IF;

    v_stmt := substring(v_src from v_re);
    v_vai  := '''' || replace(r.vai, ',', ''', ''') || '''';

    EXECUTE replace(v_src, v_stmt, v_stmt || E'\n'
      || '  -- ⚠ KIỂM VAI (mig 166). Hàm SECURITY DEFINER bỏ qua RLS, nên phải' || E'\n'
      || '  --   tự kiểm đúng vai mà RLS của bảng đang kiểm. Bỏ qua khi được' || E'\n'
      || '  --   gọi từ trong một RPC khác đã tự kiểm quyền (npp.via_rpc).' || E'\n'
      || '  IF current_setting(''npp.via_rpc'', true) IS DISTINCT FROM ''on''' || E'\n'
      || '     AND COALESCE(public.user_role(), '''') NOT IN (' || v_vai || ') THEN' || E'\n'
      || '    RAISE EXCEPTION ''FORBIDDEN: vai trò của bạn không được làm thao tác kho / mua hàng này.''' || E'\n'
      || '      USING ERRCODE = ''42501'';' || E'\n'
      || '  END IF;');
  END LOOP;
END;
$patch$;

-- cancel_stock_entry: phiếu có chứng từ gốc thì phải huỷ ở chứng từ gốc
DO $patch$
DECLARE
  v_oid    oid := to_regprocedure('public.cancel_stock_entry(uuid,text)');
  v_src    text;
  v_anchor text := E'  IF v_type NOT IN (''import'', ''export'') THEN';
BEGIN
  v_src := pg_get_functiondef(v_oid);
  IF position('ENTRY_HAS_SOURCE' in v_src) > 0 THEN
    RETURN;
  END IF;
  IF (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION '166: cancel_stock_entry không đúng hình dạng. Thân hàm hiện tại:%', E'\n' || v_src
      USING ERRCODE = 'P0001';
  END IF;

  EXECUTE replace(v_src, v_anchor,
       '  -- ⚠ PHIẾU CÓ CHỨNG TỪ GỐC (mig 166). Đảo riêng phiếu kho thì hàng' || E'\n'
    || '  --   đổi mà hoá đơn mua / phiếu trả / công nợ NCC đứng yên. Bắt đi' || E'\n'
    || '  --   qua đúng hàm huỷ của chứng từ gốc — hàm ấy huỷ cả hai vế.' || E'\n'
    || '  IF EXISTS (SELECT 1 FROM purchase_invoices WHERE stock_entry_id = p_entry_id AND status = ''completed'') THEN' || E'\n'
    || '    RAISE EXCEPTION ''ENTRY_HAS_SOURCE: phiếu % thuộc một hoá đơn nhập mua. Huỷ hoá đơn nhập đó thay vì huỷ riêng phiếu kho.'', v_code' || E'\n'
    || '      USING ERRCODE = ''P0001'';' || E'\n'
    || '  END IF;' || E'\n'
    || '  IF EXISTS (SELECT 1 FROM supplier_returns WHERE stock_entry_id = p_entry_id AND status = ''completed'') THEN' || E'\n'
    || '    RAISE EXCEPTION ''ENTRY_HAS_SOURCE: phiếu % thuộc một phiếu trả NCC. Huỷ phiếu trả NCC đó thay vì huỷ riêng phiếu kho.'', v_code' || E'\n'
    || '      USING ERRCODE = ''P0001'';' || E'\n'
    || '  END IF;' || E'\n'
    || '  IF EXISTS (SELECT 1 FROM returns rt' || E'\n'
    || '             WHERE rt.status = ''completed''' || E'\n'
    || '               AND (SELECT notes FROM stock_entries WHERE id = p_entry_id) = ''Nhập lại từ phiếu trả '' || rt.id::text) THEN' || E'\n'
    || '    RAISE EXCEPTION ''ENTRY_HAS_SOURCE: phiếu % là hàng khách trả. Huỷ phiếu trả hàng đó thay vì huỷ riêng phiếu kho.'', v_code' || E'\n'
    || '      USING ERRCODE = ''P0001'';' || E'\n'
    || '  END IF;' || E'\n'
    || '  IF EXISTS (SELECT 1 FROM payables WHERE stock_entry_id = p_entry_id AND coalesce(status, '''') <> ''cancelled'') THEN' || E'\n'
    || '    RAISE EXCEPTION ''ENTRY_HAS_SOURCE: phiếu % đang có công nợ NCC. Xoá công nợ NCC đó trước rồi mới huỷ phiếu kho.'', v_code' || E'\n'
    || '      USING ERRCODE = ''P0001'';' || E'\n'
    || '  END IF;' || E'\n'
    || E'\n' || v_anchor);
END;
$patch$;


-- ---------------------------------------------------------------------
-- 5. refresh_warehouse_zones — người gọi chỉ được rà NPP của mình
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_warehouse_zones(p_org_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  threshold integer;
  moved integer;
BEGIN
  -- ⚠ (mig 166) Có người đăng nhập thì chỉ được rà NPP của chính mình.
  --   Không có (chạy từ migration / cron) thì giữ như cũ.
  IF auth.uid() IS NOT NULL AND p_org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH: không rà kho của đơn vị khác được.' USING ERRCODE = '42501';
  END IF;

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
$$;


-- ---------------------------------------------------------------------
-- 6–8. Chính sách
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "View order history" ON order_status_history;

DROP POLICY IF EXISTS "Sales/Driver/Accountant can create payments" ON payments;
CREATE POLICY "Sales/Driver/Accountant can create payments" ON payments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_role() IN ('owner', 'accountant')
    AND EXISTS (SELECT 1 FROM receivables r
                WHERE r.id = payments.receivable_id AND r.org_id = public.user_org_id())
  );

DROP POLICY IF EXISTS "Authorized roles can create receivables" ON receivables;
CREATE POLICY "Authorized roles can create receivables" ON receivables
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'accountant')
  );

DROP POLICY IF EXISTS "Owner/Manager can delete draft returns" ON returns;
CREATE POLICY "Owner/Manager can delete draft returns" ON returns
  FOR DELETE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
    AND status = 'draft'
  );


-- ---------------------------------------------------------------------
-- Tự kiểm
-- ---------------------------------------------------------------------
DO $kiem$
DECLARE v_thieu text := ''; r record;
BEGIN
  FOR r IN SELECT unnest(ARRAY[
      'cancel_stock_entry(uuid,text)', 'post_stock_export(uuid)', 'post_stock_issue(uuid)',
      'post_stock_transfer(uuid)', 'complete_purchase_invoice(uuid)', 'cancel_purchase_invoice(uuid,text)',
      'complete_supplier_return(uuid)', 'cancel_supplier_return(uuid,text)']) AS fn
  LOOP
    IF position('(mig 166)' in pg_get_functiondef(to_regprocedure('public.' || r.fn))) = 0 THEN
      v_thieu := v_thieu || E'\n  · ' || r.fn || ' chưa có cổng vai';
    END IF;
  END LOOP;

  FOR r IN SELECT unnest(ARRAY[
      '_apply_return_edits(uuid,jsonb)', '_apply_return_adds(uuid,uuid,jsonb)',
      '_pending_return_for(uuid,uuid)', '_wf2b_gross_revenue_for(uuid,uuid,date,date)',
      'next_purchase_receipt_code(uuid)']) AS fn
  LOOP
    IF has_function_privilege('anon', 'public.' || r.fn, 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.' || r.fn, 'EXECUTE') THEN
      v_thieu := v_thieu || E'\n  · ' || r.fn || ' vẫn gọi thẳng được';
    END IF;
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure::text AS fn
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef AND p.proname LIKE '\_%'
      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
           OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  LOOP
    v_thieu := v_thieu || E'\n  · ' || r.fn || ' (hàm nội bộ) vẫn gọi thẳng được';
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'order_status_history' AND qual = 'true') THEN
    v_thieu := v_thieu || E'\n  · order_status_history còn chính sách USING (true)';
  END IF;

  IF v_thieu <> '' THEN
    RAISE EXCEPTION '166: chưa vá đủ:%', v_thieu USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE '--- 166: đã vá lỗ quyền RPC và quyền rò sang NPP khác ---';
END;
$kiem$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Bảng tóm tắt — thứ DUY NHẤT trình soạn SQL của Supabase hiện ra
-- ---------------------------------------------------------------------
SELECT 'RPC kho / mua hàng đã có cổng vai (cần 8)' AS hang_muc,
       count(*)::text AS ket_qua
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('cancel_stock_entry','post_stock_export','post_stock_issue','post_stock_transfer',
                    'complete_purchase_invoice','cancel_purchase_invoice','complete_supplier_return','cancel_supplier_return')
  AND p.prosrc LIKE '%(mig 166)%'
UNION ALL
SELECT 'Hàm nội bộ (tên _…) còn gọi thẳng được (cần 0)',
       count(*)::text
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef
  AND (p.proname LIKE '\_%' OR p.proname = 'next_purchase_receipt_code')
  AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
UNION ALL
SELECT 'Dòng override quyền rò sang NPP khác vừa dọn',
       (SELECT count(*) FROM _166_upo_ro)::text
UNION ALL
SELECT 'NPP thiếu bộ quyền mặc định (cần 0)',
       count(*)::text
FROM organizations o
WHERE (SELECT count(*) FROM role_permissions rp WHERE rp.org_id = o.id) < 8
UNION ALL
SELECT 'Chính sách USING (true) trên order_status_history (cần 0)',
       count(*)::text
FROM pg_policies WHERE tablename = 'order_status_history' AND qual = 'true';
