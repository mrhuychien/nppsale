-- KIỂM MIG 262 — NVBH chỉ xem đơn hàng của chính mình (chủ nhà 15/11/2026: "Kiểm tra lại quyền xem, sao nhân viên này lại xem
-- được đơn hàng của nhân viên kia"). psql -f, BEGIN … ROLLBACK. Chạy dưới safeupdate (như API thật):
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-262-nvbh-chi-xem-don-cua-minh.sql
--
-- Bước 0 đưa chính sách đọc đơn, nhật ký đơn và get_invoiceable_lines về ĐÚNG bản trước mig 262 (mig 161 + 250, 052 + 250,
-- 183 + 212) — tái hiện lỗi trên chính sổ này kể cả khi sổ đã chạy 262 — rồi chụp "ai thấy đơn nào" qua vai authenticated
-- (như PostgREST), chạy mig 262 HAI lần, chụp lại và so.
--
-- Người (NPP chính): chủ e..01 · quản lý e..02 · kế toán e..03 · kho e..05 · NVBH A, B, C (C có quyền riêng "Xem tất cả KH"),
--   D (không khách nào) · TX tài xế (vai cũ, đơn o10 trong chuyến của TX) · L NVBH đã bị khoá · X NVBH của NPP khác.
-- Khách: K1 làm chung A (chính) + B (phụ) · K2 của B · K3 của A · K4 vừa bàn giao B → A (dòng của B đã gỡ) · K5 không ai ·
--   KX của NPP khác.
-- Đơn: o01 A·K1 · o02 B·K1 · o03 B·K2 · o04 B·K4 hoàn thành · o05 chủ·K3 · o06 A·K3 NHÁP · o07 B·K1 NHÁP · o08 A·K5 ·
--   o09 X·KX (NPP khác) · o10 B·K5 trong chuyến của TX · o11 L·K5.
\set ON_ERROR_STOP on
\o /dev/null
SELECT pg_advisory_lock(hashtext('npp-thu-sql'));
\o
GRANT USAGE ON SCHEMA public, auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
CREATE TEMP TABLE ctx (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON ctx TO authenticated;
CREATE TEMP TABLE nguoi (ten text PRIMARY KEY, id uuid NOT NULL, cung_npp boolean NOT NULL) ON COMMIT DROP;
-- "ai thấy gì": luc = truoc / sau; bang = don / dong / nhat_ky / lich_su; ds = khoá đơn mẫu, xếp, nối dấu phẩy.
CREATE TEMP TABLE thay (luc text, ten text, bang text, ds text, PRIMARY KEY (luc, ten, bang)) ON COMMIT DROP;
-- Cả sổ (không chỉ đơn mẫu): số đơn thấy + vân tay id, số đơn thấy được mà KHÔNG đứng tên mình.
CREATE TEMP TABLE ca_so (luc text, ten text, van_tay text, cua_nguoi_khac int, PRIMARY KEY (luc, ten)) ON COMMIT DROP;
-- get_invoiceable_lines: loi NULL = đọc được dòng.
CREATE TEMP TABLE goi (luc text, ten text, don text, loi text, PRIMARY KEY (luc, ten, don)) ON COMMIT DROP;
CREATE TEMP TABLE ham (luc text PRIMARY KEY, thuoc_tinh text) ON COMMIT DROP;

-- Chạy câu q dưới vai authenticated với phiên của p — như PostgREST (set_config role + jwt) — trả một giá trị.
CREATE FUNCTION pg_temp.duoi(p uuid, q text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p::text, true);
  PERFORM set_config('role', 'authenticated', true);
  EXECUTE q INTO r;
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
-- Đơn mẫu có dòng ở bảng p_bang (theo order_id) mà người p đọc được.
CREATE FUNCTION pg_temp.thay_bang(p uuid, p_bang text) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.duoi(p, format(
    $q$SELECT coalesce(string_agg(c.k, ',' ORDER BY c.k), '') FROM ctx c
        WHERE c.k ~ '^o\d+$' AND EXISTS (SELECT 1 FROM public.%I x WHERE x.%I = c.v)$q$,
    p_bang, CASE WHEN p_bang = 'sales_orders' THEN 'id' ELSE 'order_id' END))
$f$;
-- get_invoiceable_lines(o) dưới phiên của p: NULL = đọc được; còn lại = mã lỗi. p NULL = máy chủ gọi (không phiên).
--   Lỗi thì khối con huỷ → vai + phiên tự về như trước khối.
CREATE FUNCTION pg_temp.goi_rpc(p uuid, o uuid) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    IF p IS NOT NULL THEN
      PERFORM set_config('request.jwt.claim.sub', p::text, true);
      PERFORM set_config('role', 'authenticated', true);
    END IF;
    PERFORM count(*) FROM public.get_invoiceable_lines(o);
    PERFORM set_config('role', 'none', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    RETURN split_part(SQLERRM, ':', 1);
  END;
END $f$;
-- Chụp mọi thứ cần so ở thời điểm p_luc.
CREATE FUNCTION pg_temp.chup(p_luc text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE n record; o record; b text;
BEGIN
  FOR n IN SELECT * FROM nguoi ORDER BY ten LOOP
    FOREACH b IN ARRAY ARRAY['sales_orders', 'sales_order_lines', 'order_activity_log', 'order_status_history'] LOOP
      INSERT INTO thay VALUES (p_luc, n.ten,
        CASE b WHEN 'sales_orders' THEN 'don' WHEN 'sales_order_lines' THEN 'dong'
               WHEN 'order_activity_log' THEN 'nhat_ky' ELSE 'lich_su' END,
        pg_temp.thay_bang(n.id, b));
    END LOOP;
    INSERT INTO ca_so VALUES (p_luc, n.ten,
      pg_temp.duoi(n.id, $q$SELECT count(*) || ':' || md5(coalesce(string_agg(id::text, ',' ORDER BY id), '')) FROM public.sales_orders$q$),
      pg_temp.duoi(n.id, $q$SELECT count(*) FROM public.sales_orders WHERE sales_user_id IS DISTINCT FROM auth.uid()$q$)::int);
    FOR o IN SELECT * FROM ctx WHERE k ~ '^o\d+$' ORDER BY k LOOP
      INSERT INTO goi VALUES (p_luc, n.ten, o.k, pg_temp.goi_rpc(n.id, o.v));
    END LOOP;
  END LOOP;
  INSERT INTO ham SELECT p_luc, concat_ws(' · ', p.prosecdef, p.provolatile, p.proparallel, p.proisstrict,
                                          p.proconfig::text, p.proacl::text, pg_get_function_result(p.oid),
                                          pg_get_function_identity_arguments(p.oid), p.proowner::regrole)
    FROM pg_proc p WHERE p.oid = 'public.get_invoiceable_lines(uuid)'::regprocedure;
END $f$;
CREATE FUNCTION pg_temp.ds(p_luc text, p_ten text, p_bang text DEFAULT 'don') RETURNS text LANGUAGE sql STABLE AS
  $f$ SELECT ds FROM thay WHERE luc = p_luc AND ten = p_ten AND bang = p_bang $f$;
-- Phần của tập p_ds (khoá đơn) có dòng ở bảng p_bang — đọc bằng quyền postgres (sự thật của sổ).
CREATE FUNCTION pg_temp.co_dong(p_ds text, p_bang text) RETURNS text LANGUAGE plpgsql STABLE AS $f$
DECLARE r text;
BEGIN
  EXECUTE format($q$SELECT coalesce(string_agg(c.k, ',' ORDER BY c.k), '') FROM ctx c
                    WHERE c.k = ANY (string_to_array($1, ',')) AND EXISTS (SELECT 1 FROM public.%I x WHERE x.order_id = c.v)$q$,
                 p_bang) INTO r USING p_ds;
  RETURN r;
END $f$;

\set ORG '''a0000000-0000-0000-0000-000000000001'''
\set ORGX '''a2620000-0000-0000-0000-0000000000ff'''
\set CHU '''e0000000-0000-0000-0000-000000000001'''
\set QL '''e0000000-0000-0000-0000-000000000002'''
\set KT '''e0000000-0000-0000-0000-000000000003'''
\set KHO '''e0000000-0000-0000-0000-000000000005'''
\set A '''e2620000-0000-0000-0000-00000000000a'''
\set B '''e2620000-0000-0000-0000-00000000000b'''
\set C '''e2620000-0000-0000-0000-00000000000c'''
\set D '''e2620000-0000-0000-0000-00000000000d'''
\set TX '''e2620000-0000-0000-0000-00000000000e'''
\set L '''e2620000-0000-0000-0000-00000000000f'''
\set X '''e2620000-0000-0000-0000-0000000000ff'''
\set P1 '''c0000000-0000-0000-0000-000000000001'''

-- ===================================== 0. ĐƯA VỀ BẢN TRƯỚC MIG 262 =====================================
ALTER POLICY sales_order_select ON public.sales_orders USING (
  (org_id = (SELECT public.user_org_id()))
  AND ((status <> 'draft') OR (sales_user_id = (SELECT auth.uid())))
  AND (((SELECT public.user_role()) = ANY (ARRAY['owner', 'manager', 'accountant', 'warehouse']))
       OR (SELECT public.user_has_permission((SELECT auth.uid()), 'customer.view_all'))
       OR (sales_user_id = (SELECT auth.uid()))
       OR (EXISTS (SELECT 1 FROM public.customer_assignments ca
                    WHERE ca.customer_id = sales_orders.customer_id AND ca.user_id = (SELECT auth.uid())
                      AND ca.status = 'active'))
       OR (((SELECT public.user_role()) = 'driver')
           AND (id IN (SELECT dl.order_id FROM public.delivery_lines dl JOIN public.deliveries d ON d.id = dl.delivery_id
                        WHERE d.driver_id = (SELECT auth.uid())))))
);
ALTER POLICY org_iso_oal ON public.order_activity_log USING (org_id = (SELECT public.user_org_id()));
-- get_invoiceable_lines y hệt bản đang chạy trước mig 262 (mig 183 + vá mig 212).
CREATE OR REPLACE FUNCTION public.get_invoiceable_lines(p_order_id uuid)
 RETURNS TABLE(order_line_id uuid, return_line_id uuid, product_id uuid, product_name text, sku text, unit_name text, conversion_factor numeric, ordered_qty numeric, invoiced_qty numeric, remaining_qty numeric, unit_price numeric, list_price numeric, line_discount numeric, vat_rate numeric, available_base numeric, is_exchange boolean, note text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM sales_orders WHERE id = p_order_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    sol.id, NULL::uuid, sol.product_id, p.name, p.sku, sol.unit_name,
    COALESCE(sol.conversion_factor, 1),
    sol.quantity, COALESCE(sol.invoiced_qty, 0),
    GREATEST(0, sol.quantity - COALESCE(sol.invoiced_qty, 0)),
    sol.unit_price, COALESCE(p.sell_price, 0), COALESCE(sol.line_discount, 0),
    -- (mig 183) Thuế người bán đã chọn trên dòng đơn; đơn cũ → thuế mặt hàng.
    COALESCE(sol.vat_rate, p.vat_rate, 0),
    COALESCE((SELECT sum(b.qty_on_hand) FROM batches b
               WHERE b.product_id = sol.product_id
                 AND b.org_id = v_org
                 AND b.warehouse_zone = 'sale'), 0)::numeric,
    false, sol.note
  FROM sales_order_lines sol
  LEFT JOIN products p ON p.id = sol.product_id
  WHERE sol.order_id = p_order_id

  UNION ALL

  -- Hàng đem đổi của phiếu trả kèm đơn: nó cũng rời kho trong chuyến này,
  -- nhưng không thuộc dòng đơn nào nên `order_line_id` để rỗng.
  SELECT
    NULL::uuid, rl.id, rl.product_id, p2.name, p2.sku, rl.unit_name,
    COALESCE((SELECT pu.conversion FROM product_units pu
               WHERE pu.product_id = rl.product_id
                 AND pu.unit_name = rl.unit_name), 1),
    rl.quantity, 0::numeric, rl.quantity,
    0::numeric, COALESCE(p2.sell_price, 0), 0::numeric,
    COALESCE(p2.vat_rate, 0),
    COALESCE((SELECT sum(b.qty_on_hand) FROM batches b
               WHERE b.product_id = rl.product_id
                 AND b.org_id = v_org
                 AND b.warehouse_zone = 'sale'), 0)::numeric,
    true, '[Exchange]'::text
  FROM return_lines rl
  JOIN returns r ON r.id = rl.return_id
  LEFT JOIN products p2 ON p2.id = rl.product_id
  WHERE r.order_id = p_order_id
    AND r.status IN ('draft', 'submitted')
    AND r.invoice_id IS NULL /* (mig 212) đã bám HĐ = đã xuất theo tờ ấy */ AND rl.is_exchange = true;
END;
$function$;

-- ===================================== DỰNG SỔ (postgres, không phiên — trigger "không phiên thì để yên") =====================================
\o /dev/null
SELECT set_config('npp.via_rpc', 'on', true);  -- cho chèn dòng của đơn đã hoàn thành (o04); tắt lại ngay sau khi dựng
\o
INSERT INTO organizations (id, name, slug) VALUES (:ORGX, 'NPP khác 262', 'npp-khac-262');
INSERT INTO auth.users (id, email) VALUES
  (:A, 'a262@x.vn'), (:B, 'b262@x.vn'), (:C, 'c262@x.vn'), (:D, 'd262@x.vn'), (:TX, 'tx262@x.vn'), (:L, 'l262@x.vn'),
  (:X, 'x262@x.vn');
INSERT INTO users (id, org_id, full_name, role, is_active, allow_price_edit, price_edit_max_increase_pct) VALUES
  (:A, :ORG, 'NV A 262', 'sales', true, true, 100),
  (:B, :ORG, 'NV B 262', 'sales', true, false, 0),
  (:C, :ORG, 'NV C 262 (xem tất cả KH)', 'sales', true, false, 0),
  (:D, :ORG, 'NV D 262', 'sales', true, false, 0),
  (:L, :ORG, 'NV L 262 (đã khoá)', 'sales', false, false, 0),
  (:X, :ORGX, 'NV X 262 (NPP khác)', 'sales', true, false, 0);
-- Vai Tài xế đã ngưng (trg_block_driver_role) nhưng sổ thật còn tài khoản cũ → chèn vòng qua trigger.
SET LOCAL session_replication_role = replica;
INSERT INTO users (id, org_id, full_name, role, is_active) VALUES (:TX, :ORG, 'TX 262 (tài xế cũ)', 'driver', true);
SET LOCAL session_replication_role = origin;
INSERT INTO user_permission_overrides (user_id, permission_key, granted, org_id) VALUES (:C, 'customer.view_all', true, :ORG);

INSERT INTO ctx VALUES
  ('K1', 'c2620000-0000-0000-0000-000000000001'), ('K2', 'c2620000-0000-0000-0000-000000000002'),
  ('K3', 'c2620000-0000-0000-0000-000000000003'), ('K4', 'c2620000-0000-0000-0000-000000000004'),
  ('K5', 'c2620000-0000-0000-0000-000000000005'), ('KX', 'c2620000-0000-0000-0000-0000000000ff');
INSERT INTO customers (id, org_id, store_name, owner_name, phone, address, channel)
SELECT v, CASE WHEN k = 'KX' THEN :ORGX ELSE :ORG END::uuid, 'Thử262 ' || k, 'Chủ ' || k,
       '09126200' || lpad((row_number() OVER (ORDER BY k))::text, 2, '0'), k || ' Thử262', 'GT'
  FROM ctx WHERE k ~ '^K';
-- K4: bàn giao "chuyển hẳn" B → A (mig 246 xoá dòng của người giao) — chỉ còn A.
INSERT INTO customer_assignments (customer_id, user_id, role, status)
SELECT c.v, u.id::uuid, u.vai, 'active'
  FROM (VALUES ('K1', :A, 'primary'), ('K1', :B, 'secondary'), ('K2', :B, 'primary'), ('K3', :A, 'primary'),
               ('K4', :A, 'primary')) u(kh, id, vai)
  JOIN ctx c ON c.k = u.kh;

INSERT INTO ctx VALUES
  ('o01', 'd2620000-0000-0000-0000-000000000001'), ('o02', 'd2620000-0000-0000-0000-000000000002'),
  ('o03', 'd2620000-0000-0000-0000-000000000003'), ('o04', 'd2620000-0000-0000-0000-000000000004'),
  ('o05', 'd2620000-0000-0000-0000-000000000005'), ('o06', 'd2620000-0000-0000-0000-000000000006'),
  ('o07', 'd2620000-0000-0000-0000-000000000007'), ('o08', 'd2620000-0000-0000-0000-000000000008'),
  ('o09', 'd2620000-0000-0000-0000-000000000009'), ('o10', 'd2620000-0000-0000-0000-000000000010'),
  ('o11', 'd2620000-0000-0000-0000-000000000011');
INSERT INTO sales_orders (id, org_id, customer_id, sales_user_id, status, subtotal, total)
SELECT o.v, CASE WHEN d.don = 'o09' THEN :ORGX ELSE :ORG END::uuid, k.v, d.nv::uuid, d.tt, 10000, 10000
  FROM (VALUES ('o01', 'K1', :A, 'submitted'), ('o02', 'K1', :B, 'submitted'), ('o03', 'K2', :B, 'submitted'),
               ('o04', 'K4', :B, 'completed'), ('o05', 'K3', :CHU, 'submitted'), ('o06', 'K3', :A, 'draft'),
               ('o07', 'K1', :B, 'draft'), ('o08', 'K5', :A, 'submitted'), ('o09', 'KX', :X, 'submitted'),
               ('o10', 'K5', :B, 'submitted'), ('o11', 'K5', :L, 'submitted')) d(don, kh, nv, tt)
  JOIN ctx o ON o.k = d.don
  JOIN ctx k ON k.k = d.kh;
INSERT INTO sales_order_lines (order_id, product_id, unit_name, conversion_factor, quantity, unit_price, line_total)
SELECT v, :P1, 'lon', 1, 1, 10000, 10000 FROM ctx WHERE k ~ '^o\d+$';
INSERT INTO order_activity_log (org_id, order_id, action, changes)
SELECT so.org_id, so.id, 'add_line', '{}'::jsonb FROM sales_orders so JOIN ctx c ON c.v = so.id;
WITH ch AS (INSERT INTO deliveries (org_id, driver_id) VALUES (:ORG, :TX) RETURNING id)
INSERT INTO delivery_lines (delivery_id, order_id) SELECT ch.id, c.v FROM ch, ctx c WHERE c.k = 'o10';
\o /dev/null
SELECT set_config('npp.via_rpc', '', true);
\o

INSERT INTO nguoi VALUES
  ('CHU', :CHU, true), ('QL', :QL, true), ('KT', :KT, true), ('KHO', :KHO, true), ('A', :A, true), ('B', :B, true),
  ('C', :C, true), ('D', :D, true), ('TX', :TX, true), ('L', :L, true), ('X', :X, false);

INSERT INTO kq SELECT 1, 'Bước 0 đưa về đúng bản trước 262: đọc đơn còn nhánh phân công + Xem tất cả KH, nhật ký chỉ lọc NPP, hàm chưa vá',
  position('customer_assignments' IN q.don) > 0 AND position('customer.view_all' IN q.don) > 0
    AND position('sales_orders' IN q.nk) = 0
    AND position('(mig 262)' IN pg_get_functiondef('public.get_invoiceable_lines(uuid)'::regprocedure)) = 0,
  ''
  FROM (SELECT (SELECT qual FROM pg_policies WHERE tablename = 'sales_orders' AND policyname = 'sales_order_select') AS don,
               (SELECT qual FROM pg_policies WHERE tablename = 'order_activity_log' AND policyname = 'org_iso_oal') AS nk) q;

-- ===================================== TRƯỚC KHI SỬA =====================================
\o /dev/null
SELECT pg_temp.chup('truoc');
\o

INSERT INTO kq SELECT 2, 'TÁI HIỆN: A thấy đơn của B (khách làm chung o02, khách vừa bàn giao o04) + đơn chủ bán cho khách của A (o05); B thấy đơn của A (o01)',
  pg_temp.ds('truoc', 'A') = 'o01,o02,o04,o05,o06,o08' AND pg_temp.ds('truoc', 'B') = 'o01,o02,o03,o04,o07,o10',
  'A: ' || pg_temp.ds('truoc', 'A') || ' · B: ' || pg_temp.ds('truoc', 'B');
INSERT INTO kq SELECT 3, 'TÁI HIỆN: C có quyền "Xem tất cả KH" thấy mọi đơn đã gửi của NPP; D (không khách nào) không thấy gì',
  pg_temp.ds('truoc', 'C') = 'o01,o02,o03,o04,o05,o08,o10,o11' AND pg_temp.ds('truoc', 'D') = '',
  'C: ' || pg_temp.ds('truoc', 'C') || ' · D: ' || pg_temp.ds('truoc', 'D');
INSERT INTO kq SELECT 4, 'TÁI HIỆN: nhật ký đơn chỉ lọc NPP — D đọc được nhật ký mọi đơn, kể cả đơn NHÁP của người khác',
  pg_temp.ds('truoc', 'D', 'nhat_ky') = 'o01,o02,o03,o04,o05,o06,o07,o08,o10,o11',
  'D: ' || pg_temp.ds('truoc', 'D', 'nhat_ky');
INSERT INTO kq SELECT 5, 'TÁI HIỆN: get_invoiceable_lines chỉ kiểm NPP — D đọc dòng o03 của B, chủ đọc nháp o07 của B, L đã khoá đọc o02',
  (SELECT loi FROM goi WHERE luc = 'truoc' AND ten = 'D' AND don = 'o03') IS NULL
    AND (SELECT loi FROM goi WHERE luc = 'truoc' AND ten = 'CHU' AND don = 'o07') IS NULL
    AND (SELECT loi FROM goi WHERE luc = 'truoc' AND ten = 'L' AND don = 'o02') IS NULL,
  '';

-- ===================================== CHẠY MIGRATION HAI LẦN =====================================
\o /dev/null
\ir ../../supabase/migrations/262_nvbh_chi_xem_don_cua_minh.sql
\ir ../../supabase/migrations/262_nvbh_chi_xem_don_cua_minh.sql
\o

INSERT INTO kq SELECT 6, 'Vá get_invoiceable_lines đúng 1 chỗ sau 2 lượt; thuộc tính hàm (definer, search_path, quyền, chủ…) giữ nguyên',
  (SELECT count(*) FROM regexp_matches(pg_get_functiondef('public.get_invoiceable_lines(uuid)'::regprocedure), '\(mig 262\)', 'g')) = 1
    AND (SELECT thuoc_tinh FROM ham WHERE luc = 'truoc')
        = (SELECT concat_ws(' · ', p.prosecdef, p.provolatile, p.proparallel, p.proisstrict, p.proconfig::text, p.proacl::text,
                            pg_get_function_result(p.oid), pg_get_function_identity_arguments(p.oid), p.proowner::regrole)
             FROM pg_proc p WHERE p.oid = 'public.get_invoiceable_lines(uuid)'::regprocedure),
  (SELECT thuoc_tinh FROM ham WHERE luc = 'truoc');
INSERT INTO kq SELECT 7, 'Câu tóm tắt của mig 262 đếm đúng TRƯỚC KHI SỬA: A 3 đơn người khác (vì phân công), B 1, C = mọi đơn đã gửi không phải của C (vì Xem tất cả KH)',
  (SELECT so_don = 3 AND vi_phan_cong = 3 AND NOT xem_het FROM _mig262_truoc WHERE nv = :A)
    AND (SELECT so_don = 1 AND vi_phan_cong = 1 FROM _mig262_truoc WHERE nv = :B)
    AND (SELECT xem_het AND vi_phan_cong = 0
                AND so_don = (SELECT count(*) FROM sales_orders WHERE org_id = :ORG AND status <> 'draft' AND sales_user_id <> :C)
           FROM _mig262_truoc WHERE nv = :C)
    AND NOT EXISTS (SELECT 1 FROM _mig262_truoc WHERE nv IN (:D, :L, :TX)),
  (SELECT string_agg(ten || ' ' || so_don || '/' || vi_phan_cong, ' · ' ORDER BY ten) FROM _mig262_truoc
    WHERE nv IN (:A, :B, :C));

-- ===================================== SAU KHI SỬA =====================================
\o /dev/null
SELECT pg_temp.chup('sau');
\o

INSERT INTO kq SELECT 8, 'NVBH chỉ thấy đơn ĐỨNG TÊN MÌNH: A o01 + nháp o06 + o08 · B o02 o03 o04 nháp o07 o10 · C, D, L không gì · X (NPP khác) o09',
  pg_temp.ds('sau', 'A') = 'o01,o06,o08' AND pg_temp.ds('sau', 'B') = 'o02,o03,o04,o07,o10'
    AND pg_temp.ds('sau', 'C') = '' AND pg_temp.ds('sau', 'D') = '' AND pg_temp.ds('sau', 'L') = ''
    AND pg_temp.ds('sau', 'X') = 'o09',
  (SELECT string_agg(ten || ': ' || ds, ' · ' ORDER BY ten) FROM thay WHERE luc = 'sau' AND bang = 'don'
    AND ten IN ('A', 'B', 'C', 'D', 'L', 'X'));
INSERT INTO kq SELECT 9, 'Cả sổ (không chỉ đơn mẫu): không NVBH nào còn thấy một đơn không đứng tên mình',
  bool_and(cua_nguoi_khac = 0), string_agg(ten || ' ' || cua_nguoi_khac, ' · ' ORDER BY ten)
  FROM ca_so WHERE luc = 'sau' AND ten IN ('A', 'B', 'C', 'D', 'L', 'X');
INSERT INTO kq SELECT 10, 'Văn phòng (chủ / quản lý / kế toán / kho) GIỮ NGUYÊN: cả sổ trước = sau; đơn mẫu = mọi đơn đã gửi của NPP + nháp của mình',
  bool_and(t.van_tay = s.van_tay)
    AND bool_and(pg_temp.ds('sau', t.ten) = 'o01,o02,o03,o04,o05,o08,o10,o11')
    AND bool_and(pg_temp.ds('truoc', t.ten) = pg_temp.ds('sau', t.ten)),
  string_agg(t.ten || ' ' || split_part(s.van_tay, ':', 1) || ' đơn', ' · ' ORDER BY t.ten)
  FROM ca_so t JOIN ca_so s ON s.ten = t.ten AND s.luc = 'sau'
 WHERE t.luc = 'truoc' AND t.ten IN ('CHU', 'QL', 'KT', 'KHO');
INSERT INTO kq SELECT 11, 'Tài xế (vai cũ) giữ nguyên: chỉ đơn trong chuyến của mình (o10), trước = sau',
  pg_temp.ds('truoc', 'TX') = 'o10' AND pg_temp.ds('sau', 'TX') = 'o10'
    AND (SELECT t.van_tay = s.van_tay FROM ca_so t JOIN ca_so s ON s.ten = t.ten WHERE t.luc = 'truoc' AND s.luc = 'sau' AND t.ten = 'TX'),
  pg_temp.ds('sau', 'TX');
INSERT INTO kq SELECT 12, 'Dòng đơn, nhật ký đơn, lịch sử trạng thái theo ĐÚNG quyền xem đơn của từng người (sau khi sửa)',
  bool_and(pg_temp.ds('sau', n.ten, 'dong') = pg_temp.co_dong(pg_temp.ds('sau', n.ten), 'sales_order_lines')
           AND pg_temp.ds('sau', n.ten, 'nhat_ky') = pg_temp.co_dong(pg_temp.ds('sau', n.ten), 'order_activity_log')
           AND pg_temp.ds('sau', n.ten, 'lich_su') = pg_temp.co_dong(pg_temp.ds('sau', n.ten), 'order_status_history')),
  string_agg(CASE WHEN pg_temp.ds('sau', n.ten, 'nhat_ky') <> pg_temp.ds('sau', n.ten)
                  THEN n.ten || ' nhật ký ' || pg_temp.ds('sau', n.ten, 'nhat_ky') END, ' · ')
  FROM nguoi n;
INSERT INTO kq SELECT 13, 'get_invoiceable_lines đọc được ⇔ người ấy XEM được đơn (mọi cặp người × đơn)',
  bool_and((g.loi IS NULL) = (g.don = ANY (string_to_array(t.ds, ',')))),
  string_agg(CASE WHEN (g.loi IS NULL) <> (g.don = ANY (string_to_array(t.ds, ',')))
                  THEN g.ten || '×' || g.don || '=' || coalesce(g.loi, 'đọc được') END, ' · ')
  FROM goi g JOIN thay t ON t.luc = 'sau' AND t.ten = g.ten AND t.bang = 'don'
 WHERE g.luc = 'sau';
INSERT INTO kq SELECT 14, 'Không xem được → ORDER_NOT_FOUND (không lộ là đơn có tồn tại); đơn của NPP khác → ORG_MISMATCH như cũ; L đã khoá → ORDER_NOT_FOUND cả đơn mình',
  bool_and(CASE WHEN g.loi IS NULL THEN true
                WHEN g.ten = 'L' THEN g.loi = 'ORDER_NOT_FOUND'
                WHEN n.cung_npp = (g.don <> 'o09') THEN g.loi = 'ORDER_NOT_FOUND'
                ELSE g.loi = 'ORG_MISMATCH' END)
    AND (SELECT loi FROM goi WHERE luc = 'sau' AND ten = 'L' AND don = 'o11') = 'ORDER_NOT_FOUND',
  string_agg(DISTINCT g.loi, ' · ')
  FROM goi g JOIN nguoi n ON n.ten = g.ten
 WHERE g.luc = 'sau';
INSERT INTO kq SELECT 15, 'Máy chủ gọi (không phiên đăng nhập) vẫn đọc được mọi đơn như cũ — kể cả nháp, kể cả NPP khác',
  pg_temp.goi_rpc(NULL, c7.v) IS NULL AND pg_temp.goi_rpc(NULL, c9.v) IS NULL,
  ''
  FROM ctx c7, ctx c9 WHERE c7.k = 'o07' AND c9.k = 'o09';

-- ===================================== NVBH LẬP ĐƠN RỒI ĐỌC LẠI (qua vai authenticated như API thật) =====================================
\o /dev/null
SELECT set_config('request.jwt.claim.sub', :A, true);
\o
SET LOCAL ROLE authenticated;
INSERT INTO ctx SELECT 'm12', order_id FROM create_order_with_lines(jsonb_build_object('client_request_id', gen_random_uuid(),
  'order', jsonb_build_object('customer_id', 'c2620000-0000-0000-0000-000000000001', 'status', 'submitted',
                              'payment_terms', 'NET30', 'subtotal', 10000, 'total', 10000),
  'lines', jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon',
                                                'conversion_factor', 1, 'quantity', 1, 'unit_price', 10000, 'line_total', 10000))));
RESET ROLE;
\o /dev/null
SELECT set_config('request.jwt.claim.sub', '', true);
\o
INSERT INTO kq SELECT 16, 'NVBH A lập đơn cho khách làm chung K1 → A đọc lại được đơn + dòng + Xuất hàng đọc được dòng; B (cùng khách) không; chủ thấy',
  pg_temp.duoi(:A, format('SELECT count(*) FROM sales_orders WHERE id = %L', m.v)) = '1'
    AND pg_temp.duoi(:A, format('SELECT count(*) FROM sales_order_lines WHERE order_id = %L', m.v)) = '1'
    AND pg_temp.goi_rpc(:A, m.v) IS NULL
    AND pg_temp.duoi(:B, format('SELECT count(*) FROM sales_orders WHERE id = %L', m.v)) = '0'
    AND pg_temp.goi_rpc(:B, m.v) = 'ORDER_NOT_FOUND'
    AND pg_temp.duoi(:CHU, format('SELECT count(*) FROM sales_orders WHERE id = %L', m.v)) = '1',
  (SELECT order_code FROM sales_orders WHERE id = m.v)
  FROM ctx m WHERE m.k = 'm12';

INSERT INTO kq SELECT 99, 'Đủ 16 dòng kiểm', count(*) = 16, count(*) || ' dòng' FROM kq;
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS loi FROM kq;
ROLLBACK;
