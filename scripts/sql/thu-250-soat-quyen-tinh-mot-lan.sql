-- KIỂM MIG 250 — soát quyền (RLS) tính một lần mỗi câu (chủ nhà 20/10/2026: "làm tương tự cho tìm kiếm các danh sách khác").
-- psql -f, BEGIN … ROLLBACK. Dựng sổ có đủ vai (chủ NPP, quản lý, kế toán, thủ kho, hai NVBH) + một NPP khác, chụp
-- TẬP DÒNG mỗi người thấy ở MỌI bảng có RLS và kết quả thử GHI (sửa / xoá / chèn) của từng người ở từng bảng, chạy
-- CHÍNH tệp migration, chụp lại — phải y hệt. Chạy dưới safeupdate (như API thật):
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-250-soat-quyen-tinh-mot-lan.sql
\set ON_ERROR_STOP on
-- ⚠ XẾP HÀNG: vitest chạy các bộ thử song song trên CÙNG một sổ thử — mig 250 giữ khoá mọi bảng ~13 giây, câu GRANT
--   chạy cùng lúc thì "tuple concurrently updated". Khoá tư vấn giữ tới hết phiên: bộ nào tới sau thì chờ.
\o /dev/null
SELECT pg_advisory_lock(hashtext('npp-thu-sql'));
\o
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;

BEGIN;
CREATE TEMP TABLE kq (buoc text, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;
CREATE TEMP TABLE nguoi (ma uuid PRIMARY KEY, vai text) ON COMMIT DROP;
CREATE TEMP TABLE thay (lan int, vai text, bang text, n bigint, h text) ON COMMIT DROP;
CREATE TEMP TABLE ghi (lan int, vai text, bang text, thao_tac text, kq text) ON COMMIT DROP;
GRANT ALL ON thay, ghi TO authenticated;

CREATE FUNCTION pg_temp.ghi_kq(b text, t text, ok boolean, g text) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO kq VALUES (b, t, COALESCE(ok, false), g) $f$;

-- auth.uid() đúng bản Supabase: PostgREST ≥ v10 chỉ đặt request.jwt.claims (JSON).
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$f$;
CREATE FUNCTION pg_temp.vao(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $f$;

-- Sổ thử đã chạy mig 250 (sổ thử theo kịp migration) → gỡ lớp bọc + bỏ hai hàm, để thử đúng đường của sổ thật CHƯA
-- chạy: chính sách gọi thẳng hàm quyền. Sổ chưa chạy thì bước này không đổi gì.
CREATE FUNCTION pg_temp.go_boc(p text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE s text := p;
BEGIN
  IF s IS NULL THEN RETURN NULL; END IF;
  s := regexp_replace(s, '\( SELECT ((public\.)?user_has_permission\(\( SELECT auth\.uid\(\) AS uid\), ''[^'']*''::text\)) AS user_has_permission\)', '\1', 'g');
  s := regexp_replace(s, '\( SELECT auth\.uid\(\) AS uid\)', 'auth.uid()', 'g');
  s := regexp_replace(s, '\( SELECT ((public\.)?user_org_id\(\)) AS user_org_id\)', '\1', 'g');
  s := regexp_replace(s, '\( SELECT ((public\.)?user_role\(\)) AS user_role\)', '\1', 'g');
  RETURN s;
END $f$;
DO $go$
DECLARE r record; v_q text; v_c text;
BEGIN
  FOR r IN SELECT p.polname, c.relname, pg_get_expr(p.polqual, p.polrelid) AS q, pg_get_expr(p.polwithcheck, p.polrelid) AS c
             FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE c.relnamespace = 'public'::regnamespace LOOP
    v_q := pg_temp.go_boc(r.q); v_c := pg_temp.go_boc(r.c);
    IF v_q IS DISTINCT FROM r.q OR v_c IS DISTINCT FROM r.c THEN
      EXECUTE format('ALTER POLICY %I ON public.%I', r.polname, r.relname)
           || CASE WHEN v_q IS NOT NULL THEN format(' USING (%s)', v_q) ELSE '' END
           || CASE WHEN v_c IS NOT NULL THEN format(' WITH CHECK (%s)', v_c) ELSE '' END;
    END IF;
  END LOOP;
END $go$;
DROP FUNCTION IF EXISTS public._rls_tinh_mot_lan_ap();
DROP FUNCTION IF EXISTS public._rls_tinh_mot_lan(text);

-- ---------------------------------------------------------------- Sổ thử
INSERT INTO organizations (id, name, slug) VALUES ('b2500000-0000-4000-8000-000000000001', 'NPP khác (thử mig 250)', 'npp-thu-mig-250');
INSERT INTO auth.users (id) VALUES ('e2500000-0000-4000-8000-0000000000b1'), ('e2500000-0000-4000-8000-0000000000a2');
INSERT INTO users (id, org_id, full_name, role) VALUES
  ('e2500000-0000-4000-8000-0000000000b1', 'b2500000-0000-4000-8000-000000000001', 'Chủ NPP khác', 'owner'),
  ('e2500000-0000-4000-8000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'NVBH thứ hai', 'sales');
INSERT INTO nguoi VALUES
  ('e0000000-0000-0000-0000-000000000001', 'chủ NPP'), ('e0000000-0000-0000-0000-000000000002', 'quản lý'),
  ('e0000000-0000-0000-0000-000000000003', 'kế toán'), ('e0000000-0000-0000-0000-000000000005', 'thủ kho'),
  ('e0000000-0000-0000-0000-000000000004', 'NVBH'), ('e2500000-0000-4000-8000-0000000000a2', 'NVBH 2'),
  ('e2500000-0000-4000-8000-0000000000b1', 'chủ NPP khác');

SET LOCAL session_replication_role = replica; -- đổ nhanh, không trigger
INSERT INTO suppliers (id, org_id, name, code)
SELECT ('5250' || lpad(g::text, 4, '0') || '-0000-4000-8000-000000000000')::uuid,
       CASE WHEN g <= 6 THEN 'a0000000-0000-0000-0000-000000000001'::uuid ELSE 'b2500000-0000-4000-8000-000000000001'::uuid END,
       'NCC thử ' || g, 'NCC250-' || g FROM generate_series(1, 8) g;
INSERT INTO user_suppliers (org_id, user_id, supplier_id) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000004', '52500001-0000-4000-8000-000000000000'),
  ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000004', '52500002-0000-4000-8000-000000000000'),
  ('a0000000-0000-0000-0000-000000000001', 'e2500000-0000-4000-8000-0000000000a2', '52500003-0000-4000-8000-000000000000');
INSERT INTO products (id, org_id, sku, name, base_unit, primary_supplier_id)
SELECT gen_random_uuid(), CASE WHEN g <= 120 THEN 'a0000000-0000-0000-0000-000000000001'::uuid ELSE 'b2500000-0000-4000-8000-000000000001'::uuid END,
       'SP250-' || g, 'Hàng thử ' || g, 'hộp',
       CASE WHEN g % 7 = 0 THEN NULL WHEN g <= 120 THEN ('5250' || lpad((1 + g % 6)::text, 4, '0') || '-0000-4000-8000-000000000000')::uuid
            ELSE '52500007-0000-4000-8000-000000000000'::uuid END
  FROM generate_series(1, 130) g;
INSERT INTO customers (id, org_id, store_name, owner_name, phone, address, status, created_by)
SELECT ('c250' || lpad(g::text, 4, '0') || '-0000-4000-8000-000000000000')::uuid,
       CASE WHEN g <= 300 THEN 'a0000000-0000-0000-0000-000000000001'::uuid ELSE 'b2500000-0000-4000-8000-000000000001'::uuid END,
       'Khách thử ' || g, 'Chủ ' || g, '0925' || lpad(g::text, 6, '0'), g || ' Lê Lợi', 'active',
       CASE WHEN g % 11 = 0 THEN 'e0000000-0000-0000-0000-000000000004'::uuid END
  FROM generate_series(1, 320) g;
INSERT INTO customer_assignments (customer_id, user_id, role, status)
SELECT ('c250' || lpad(g::text, 4, '0') || '-0000-4000-8000-000000000000')::uuid,
       CASE WHEN g % 3 = 0 THEN 'e0000000-0000-0000-0000-000000000004'::uuid ELSE 'e2500000-0000-4000-8000-0000000000a2'::uuid END,
       'primary', CASE WHEN g % 13 = 0 THEN 'inactive' ELSE 'active' END
  FROM generate_series(1, 300) g WHERE g % 3 = 0 OR g % 6 = 1;
-- 900 đơn NPP chính (NVBH / NVBH 2 / quản lý, đủ trạng thái), 30 đơn NPP khác; HĐ cho đơn hoàn thành; nợ theo HĐ.
INSERT INTO sales_orders (id, org_id, order_code, order_seq, customer_id, sales_user_id, status, created_at)
SELECT ('d250' || lpad(g::text, 4, '0') || '-0000-4000-8000-000000000000')::uuid,
       CASE WHEN g <= 900 THEN 'a0000000-0000-0000-0000-000000000001'::uuid ELSE 'b2500000-0000-4000-8000-000000000001'::uuid END,
       'DH250-' || g, 990000 + g,
       ('c250' || lpad((CASE WHEN g <= 900 THEN 1 + g % 300 ELSE 301 + g % 20 END)::text, 4, '0') || '-0000-4000-8000-000000000000')::uuid,
       CASE WHEN g > 900 THEN 'e2500000-0000-4000-8000-0000000000b1'::uuid WHEN g % 3 = 0 THEN 'e0000000-0000-0000-0000-000000000004'::uuid
            WHEN g % 3 = 1 THEN 'e2500000-0000-4000-8000-0000000000a2'::uuid ELSE 'e0000000-0000-0000-0000-000000000002'::uuid END,
       (ARRAY['draft', 'submitted', 'completed', 'completed', 'cancelled'])[1 + g % 5], now() - (g || ' minutes')::interval
  FROM generate_series(1, 930) g;
INSERT INTO sales_invoices (id, org_id, invoice_code, order_id, customer_id, invoice_seq, reissue_no, status, invoice_date, total, sales_user_id, created_at)
SELECT ('1250' || lpad(g::text, 4, '0') || '-0000-4000-8000-000000000000')::uuid, so.org_id, 'HD250-' || g, so.id, so.customer_id,
       990000 + g, 0, CASE WHEN g % 17 = 0 THEN 'cancelled' ELSE 'posted' END, current_date - (g % 90), 100000 + g, so.sales_user_id, so.created_at
  FROM generate_series(1, 930) g JOIN sales_orders so ON so.id = ('d250' || lpad(g::text, 4, '0') || '-0000-4000-8000-000000000000')::uuid
 WHERE so.status = 'completed';
INSERT INTO receivables (id, org_id, customer_id, invoice_id, amount, paid, status, due_date, sales_user_id, created_at)
SELECT gen_random_uuid(), si.org_id, si.customer_id, si.id, si.total, CASE WHEN si.invoice_seq % 4 = 0 THEN si.total ELSE 0 END,
       CASE WHEN si.invoice_seq % 4 = 0 THEN 'paid' ELSE 'open' END, si.invoice_date + 30, si.sales_user_id, si.created_at
  FROM sales_invoices si WHERE si.invoice_code LIKE 'HD250-%' AND si.status = 'posted';
INSERT INTO payments (receivable_id, amount, collected_by)
SELECT r.id, 1000, r.sales_user_id FROM receivables r JOIN sales_invoices si ON si.id = r.invoice_id
 WHERE si.invoice_code LIKE 'HD250-%' AND si.invoice_seq % 9 = 0;
INSERT INTO returns (org_id, customer_id, invoice_id, order_id, status, reason, requested_by, sales_user_id, return_code)
SELECT si.org_id, si.customer_id, si.id, si.order_id, (ARRAY['draft', 'completed', 'cancelled'])[1 + si.invoice_seq % 3], 'damaged',
       si.sales_user_id, si.sales_user_id, 'PT250-' || si.invoice_seq
  FROM sales_invoices si WHERE si.invoice_code LIKE 'HD250-%' AND si.invoice_seq % 8 = 0;
INSERT INTO cash_receipts (org_id, receipt_code, status, source_type, notes, collected_by)
SELECT 'a0000000-0000-0000-0000-000000000001', 'PTT250-' || g, (ARRAY['pending', 'received', 'voided'])[1 + g % 3], 'manual', 'Thu thử ' || g,
       CASE WHEN g % 2 = 0 THEN 'e0000000-0000-0000-0000-000000000004'::uuid ELSE 'e0000000-0000-0000-0000-000000000003'::uuid END
  FROM generate_series(1, 40) g;
INSERT INTO stock_entries (org_id, entry_code, type, status)
SELECT CASE WHEN g <= 36 THEN 'a0000000-0000-0000-0000-000000000001'::uuid ELSE 'b2500000-0000-4000-8000-000000000001'::uuid END,
       'PN250-' || g, (ARRAY['import', 'export', 'stocktake'])[1 + g % 3], (ARRAY['draft', 'posted'])[1 + g % 2]
  FROM generate_series(1, 40) g;
SET LOCAL session_replication_role = origin;
ANALYZE customers; ANALYZE customer_assignments; ANALYZE sales_orders; ANALYZE sales_invoices; ANALYZE receivables; ANALYZE products;

-- ---------------------------------------------------------------- Chụp: thấy gì, ghi được gì
CREATE FUNCTION pg_temp.chup(p_lan int) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE u record; r record; v_n bigint; v_h text; v_cot text; v_k text; v_sql text;
BEGIN
  FOR u IN SELECT * FROM nguoi ORDER BY vai LOOP
    PERFORM pg_temp.vao(u.ma);
    FOR r IN SELECT c.oid, c.relname FROM pg_class c
              WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relrowsecurity ORDER BY 1 LOOP
      -- Thấy gì: số dòng + băm cả dòng.
      BEGIN
        EXECUTE format('SELECT count(*), md5(coalesce(string_agg(t::text, '','' ORDER BY t::text), '''')) FROM public.%I t', r.relname)
          INTO v_n, v_h;
      EXCEPTION WHEN OTHERS THEN v_n := -1; v_h := SQLSTATE;
      END;
      INSERT INTO thay VALUES (p_lan, u.vai, r.relname, v_n, v_h);
      -- Ghi được gì: sửa (cột đầu = chính nó), xoá, chèn bản sao một dòng thấy được. Ghi xong thì huỷ ngay
      -- (ném lỗi P0999 mang số dòng) — chỉ giữ KẾT QUẢ: số dòng hoặc mã lỗi.
      SELECT quote_ident(a.attname) INTO v_cot FROM pg_attribute a
       WHERE a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' AND a.attidentity = ''
       ORDER BY a.attnum LIMIT 1;
      FOREACH v_k IN ARRAY ARRAY['sua', 'xoa', 'chen'] LOOP
        v_sql := CASE v_k
          WHEN 'sua' THEN format('UPDATE public.%I SET %s = %s WHERE true', r.relname, v_cot, v_cot)
          WHEN 'xoa' THEN format('DELETE FROM public.%I WHERE true', r.relname)
          -- ⚠ CÓ THỨ TỰ: "dòng đầu tiên" không xếp thì sau mig Postgres có thể quét khác (đi chỉ mục), bốc dòng khác.
          ELSE format('INSERT INTO public.%I SELECT * FROM public.%I t ORDER BY t::text LIMIT 1', r.relname, r.relname) END;
        BEGIN
          EXECUTE v_sql;
          GET DIAGNOSTICS v_n = ROW_COUNT;
          RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = v_n::text;
        EXCEPTION
          WHEN SQLSTATE 'P0999' THEN v_h := 'n=' || SQLERRM;
          WHEN OTHERS THEN v_h := 'E:' || SQLSTATE;
        END;
        INSERT INTO ghi VALUES (p_lan, u.vai, r.relname, v_k, v_h);
      END LOOP;
    END LOOP;
    EXECUTE 'RESET ROLE';
  END LOOP;
END $f$;

SELECT pg_temp.chup(1);
-- Kế hoạch đếm công nợ của NVBH TRƯỚC mig: hàm quyền nằm ngay trong bộ lọc (gọi lại từng dòng).
CREATE TEMP TABLE ke_hoach (lan int, dong text) ON COMMIT DROP;
GRANT ALL ON ke_hoach TO authenticated;
CREATE FUNCTION pg_temp.ke_hoach(p_lan int) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE d text;
BEGIN
  PERFORM pg_temp.vao('e0000000-0000-0000-0000-000000000004');
  FOR d IN EXECUTE 'EXPLAIN (COSTS OFF) SELECT count(*) FROM public.receivables' LOOP
    INSERT INTO ke_hoach VALUES (p_lan, d);
  END LOOP;
  EXECUTE 'RESET ROLE';
END $f$;
SELECT pg_temp.ke_hoach(1);
CREATE TEMP TABLE chinh_sach_truoc ON COMMIT DROP AS
  SELECT n.nspname, c.relname, p.polname, pg_get_expr(p.polqual, p.polrelid) AS q, pg_get_expr(p.polwithcheck, p.polrelid) AS c
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace;

\o /dev/null
\ir ../../supabase/migrations/250_soat_quyen_tinh_mot_lan.sql
\o

SELECT pg_temp.chup(2);
SELECT pg_temp.ke_hoach(2);

-- ---------------------------------------------------------------- Kết quả
SELECT pg_temp.ghi_kq('1', 'mỗi người thấy ĐÚNG Y những dòng như trước, ở mọi bảng có RLS (7 người, có cả NPP khác)',
  NOT EXISTS (SELECT 1 FROM thay a JOIN thay b ON b.lan = 2 AND b.vai = a.vai AND b.bang = a.bang
               WHERE a.lan = 1 AND (a.n IS DISTINCT FROM b.n OR a.h IS DISTINCT FROM b.h))
  AND (SELECT count(*) FROM thay WHERE lan = 1) = (SELECT count(*) FROM thay WHERE lan = 2),
  (SELECT count(*) FROM thay WHERE lan = 1) || ' cặp người × bảng, ' || (SELECT count(*) FROM thay WHERE lan = 1 AND n > 0) || ' có dòng; lệch: '
  || coalesce((SELECT string_agg(a.vai || '/' || a.bang, ', ') FROM thay a JOIN thay b ON b.lan = 2 AND b.vai = a.vai AND b.bang = a.bang
                WHERE a.lan = 1 AND (a.n IS DISTINCT FROM b.n OR a.h IS DISTINCT FROM b.h)), 'không'));
SELECT pg_temp.ghi_kq('2', 'mỗi người SỬA / XOÁ / CHÈN được đúng như trước, ở mọi bảng có RLS',
  NOT EXISTS (SELECT 1 FROM ghi a JOIN ghi b ON b.lan = 2 AND b.vai = a.vai AND b.bang = a.bang AND b.thao_tac = a.thao_tac
               WHERE a.lan = 1 AND a.kq IS DISTINCT FROM b.kq)
  AND (SELECT count(*) FROM ghi WHERE lan = 1) = (SELECT count(*) FROM ghi WHERE lan = 2),
  (SELECT count(*) FROM ghi WHERE lan = 1) || ' phép thử ghi; lệch: '
  || coalesce((SELECT string_agg(a.vai || '/' || a.bang || '/' || a.thao_tac || ':' || a.kq || '→' || b.kq, ', ')
                 FROM ghi a JOIN ghi b ON b.lan = 2 AND b.vai = a.vai AND b.bang = a.bang AND b.thao_tac = a.thao_tac
                WHERE a.lan = 1 AND a.kq IS DISTINCT FROM b.kq), 'không'));
SELECT pg_temp.ghi_kq('3', 'phép thử có ăn thật: có người thấy dòng, có phép ghi được, có phép bị RLS chặn',
  (SELECT count(*) FROM thay WHERE lan = 1 AND n > 0) >= 30
  AND EXISTS (SELECT 1 FROM ghi WHERE lan = 1 AND kq LIKE 'n=%' AND kq <> 'n=0')
  AND EXISTS (SELECT 1 FROM ghi WHERE lan = 1 AND kq = 'E:42501'),
  (SELECT count(*) FROM ghi WHERE lan = 1 AND kq = 'E:42501') || ' phép bị RLS chặn, '
  || (SELECT count(*) FROM ghi WHERE lan = 1 AND kq LIKE 'n=%' AND kq <> 'n=0') || ' phép ghi được');
-- Vài luật then chốt, nói thẳng (đằng nào bước 1 cũng đã canh).
SELECT pg_temp.ghi_kq('4', 'NVBH chỉ thấy công nợ của mình; NPP khác không thấy khách / đơn nào của NPP này',
  (SELECT n FROM thay WHERE lan = 2 AND vai = 'NVBH' AND bang = 'receivables')
    = (SELECT count(*) FROM receivables WHERE sales_user_id = 'e0000000-0000-0000-0000-000000000004')
  AND (SELECT n FROM thay WHERE lan = 2 AND vai = 'chủ NPP khác' AND bang = 'customers')
    = (SELECT count(*) FROM customers WHERE org_id = 'b2500000-0000-4000-8000-000000000001')
  AND (SELECT n FROM thay WHERE lan = 2 AND vai = 'chủ NPP khác' AND bang = 'sales_orders')
    = (SELECT count(*) FROM sales_orders WHERE org_id = 'b2500000-0000-4000-8000-000000000001'),
  'NVBH thấy ' || (SELECT n FROM thay WHERE lan = 2 AND vai = 'NVBH' AND bang = 'receivables') || ' dòng nợ');
SELECT pg_temp.ghi_kq('5', 'không còn chính sách nào gọi thẳng hàm quyền (chạy lại: bọc thêm 0 chính sách)',
  NOT EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
               WHERE c.relnamespace = 'public'::regnamespace
                 AND (public._rls_tinh_mot_lan(pg_get_expr(p.polqual, p.polrelid)) IS DISTINCT FROM pg_get_expr(p.polqual, p.polrelid)
                      OR public._rls_tinh_mot_lan(pg_get_expr(p.polwithcheck, p.polrelid)) IS DISTINCT FROM pg_get_expr(p.polwithcheck, p.polrelid)))
  AND public._rls_tinh_mot_lan_ap() = 0, '');
SELECT pg_temp.ghi_kq('6', 'mig chạm chính sách có hàm quyền, KHÔNG chạm chính sách của schema khác (storage)',
  (SELECT count(*) FROM chinh_sach_truoc t
    JOIN pg_policy p ON p.polname = t.polname JOIN pg_class c ON c.oid = p.polrelid AND c.relname = t.relname
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.nspname
   WHERE t.nspname <> 'public' AND (pg_get_expr(p.polqual, p.polrelid) IS DISTINCT FROM t.q OR pg_get_expr(p.polwithcheck, p.polrelid) IS DISTINCT FROM t.c)) = 0
  AND (SELECT count(*) FROM chinh_sach_truoc t
    JOIN pg_policy p ON p.polname = t.polname JOIN pg_class c ON c.oid = p.polrelid AND c.relname = t.relname
   WHERE t.nspname = 'public' AND (pg_get_expr(p.polqual, p.polrelid) IS DISTINCT FROM t.q OR pg_get_expr(p.polwithcheck, p.polrelid) IS DISTINCT FROM t.c)) >= 150,
  (SELECT count(*) FROM chinh_sach_truoc t
    JOIN pg_policy p ON p.polname = t.polname JOIN pg_class c ON c.oid = p.polrelid AND c.relname = t.relname
   WHERE t.nspname = 'public' AND (pg_get_expr(p.polqual, p.polrelid) IS DISTINCT FROM t.q OR pg_get_expr(p.polwithcheck, p.polrelid) IS DISTINCT FROM t.c))
  || ' chính sách public đã bọc');
-- `auth.uid()` là hàm SQL nên kế hoạch in thân nó ra (current_setting('request.jwt…')) — tìm cả dạng ấy.
SELECT pg_temp.ghi_kq('7', 'NVBH đếm công nợ: trước mig hàm quyền nằm trong bộ lọc từng dòng, sau mig thành tham số tính một lần',
  EXISTS (SELECT 1 FROM ke_hoach WHERE lan = 1 AND dong LIKE '%Filter:%'
           AND (dong LIKE '%user_org_id()%' OR dong LIKE '%user_role()%' OR dong LIKE '%current_setting(''request.jwt%'))
  AND NOT EXISTS (SELECT 1 FROM ke_hoach WHERE lan = 2 AND dong LIKE '%Filter:%'
           AND (dong LIKE '%user_org_id()%' OR dong LIKE '%user_role()%' OR dong LIKE '%current_setting(''request.jwt%'))
  AND EXISTS (SELECT 1 FROM ke_hoach WHERE lan = 2 AND dong LIKE '%InitPlan%'),
  (SELECT left(btrim(dong), 140) FROM ke_hoach WHERE lan = 2 AND dong LIKE '%Filter:%' LIMIT 1));
-- Luật bọc trên mẫu tay: đúng chỗ, đúng một lớp, không chạm hàm phụ thuộc dòng.
SELECT pg_temp.ghi_kq('8', 'luật bọc: hàm quyền bọc đúng dạng Postgres in ra; hàm theo dòng giữ nguyên; bọc hai lần = một lần',
  public._rls_tinh_mot_lan('(org_id = user_org_id())') = '(org_id = ( SELECT user_org_id() AS user_org_id))'
  AND public._rls_tinh_mot_lan('(customer_org_id(customer_id) = user_org_id())')
      = '(customer_org_id(customer_id) = ( SELECT user_org_id() AS user_org_id))'
  AND public._rls_tinh_mot_lan('user_has_permission(auth.uid(), ''customer.view_all''::text)')
      = '( SELECT user_has_permission(( SELECT auth.uid() AS uid), ''customer.view_all''::text) AS user_has_permission)'
  AND public._rls_tinh_mot_lan('(public.user_role() = ''sales''::text)') = '(( SELECT public.user_role() AS user_role) = ''sales''::text)'
  AND public._rls_tinh_mot_lan('(user_sells_to_customer(id) OR (sales_user_id = auth.uid()))')
      = '(user_sells_to_customer(id) OR (sales_user_id = ( SELECT auth.uid() AS uid)))'
  AND public._rls_tinh_mot_lan(public._rls_tinh_mot_lan('((org_id = user_org_id()) AND (user_role() = ANY (ARRAY[''owner''::text])))'))
      = public._rls_tinh_mot_lan('((org_id = user_org_id()) AND (user_role() = ANY (ARRAY[''owner''::text])))')
  AND public._rls_tinh_mot_lan(NULL) IS NULL, '');
SELECT pg_temp.ghi_kq('9', 'hai hàm nội bộ của mig: trình duyệt / khách không gọi được',
  NOT has_function_privilege('authenticated', 'public._rls_tinh_mot_lan(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._rls_tinh_mot_lan_ap()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._rls_tinh_mot_lan_ap()', 'EXECUTE'), '');

-- Bước nào không ra dòng là im lặng mất — đếm cho đủ.
INSERT INTO kq SELECT '99', 'Đủ 9 dòng kiểm', count(*) = 9, count(*) || ' dòng' FROM kq;
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc::numeric;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS loi FROM kq;
ROLLBACK;
