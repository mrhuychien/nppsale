-- KIỂM MIG 249 — khoá tìm của bảng chứng từ lưu sẵn (chủ nhà 20/10/2026: "Kiểm tra giúp tao sao tìm kiếm số hóa đơn
-- trong danh sách hóa đơn chậm thế ?"). psql -f, BEGIN … ROLLBACK. Dựng lại đúng trạng thái production hôm nay (cột tính
-- `tim_kd(<bảng>)` của mig 205 + search_path của mig 207 + chỉ mục biểu thức), có sẵn chứng từ ở cả 9 bảng, rồi chạy
-- CHÍNH tệp migration hai lần. Chạy dưới safeupdate (như API thật):
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-249-luu-khoa-tim-chung-tu.sql
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
CREATE TEMP TABLE ctx (k text PRIMARY KEY, u uuid) ON COMMIT DROP;
GRANT ALL ON ctx TO authenticated;
-- Bảng → cột ghép vào khoá: y như mig 205 / 249.
CREATE TEMP TABLE bang (bang text PRIMARY KEY, cot text[]) ON COMMIT DROP;
INSERT INTO bang VALUES
  ('sales_orders', ARRAY['order_code']), ('sales_invoices', ARRAY['invoice_code']), ('returns', ARRAY['return_code']),
  ('stock_entries', ARRAY['entry_code']), ('batches', ARRAY['batch_code']), ('payables', ARRAY['invoice_number']),
  ('cash_receipts', ARRAY['receipt_code', 'notes']), ('users', ARRAY['full_name', 'phone']),
  ('invoices', ARRAY['invoice_number', 'customer_name', 'misa_inv_no', 'misa_invoice_id']);
-- Câu UPDATE nào chạm 9 bảng trong lúc chạy migration cũng bị ghi lại ở đây (mig 249 hứa: không một câu nào).
CREATE TEMP TABLE da_sua (bang text) ON COMMIT DROP;

CREATE FUNCTION pg_temp.ghi(b text, t text, ok boolean, g text) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO kq VALUES (b, t, COALESCE(ok, false), g) $f$;
-- Số dòng có `tim_kd` KHÁC khoá tính lại từ cột nguồn, trên cả 9 bảng — và tổng số dòng đã soát.
CREATE FUNCTION pg_temp.lech() RETURNS TABLE (lech bigint, da_soat bigint) LANGUAGE plpgsql AS $f$
DECLARE r record; v_l bigint; v_n bigint;
BEGIN
  lech := 0; da_soat := 0;
  FOR r IN SELECT * FROM bang LOOP
    EXECUTE format('SELECT count(*) FILTER (WHERE tim_kd IS DISTINCT FROM public.khoa_tim_ds(VARIADIC ARRAY[%s])), count(*) FROM public.%I',
      (SELECT string_agg(format('%I::text', c), ', ') FROM unnest(r.cot) c), r.bang) INTO v_l, v_n;
    lech := lech + v_l; da_soat := da_soat + v_n;
  END LOOP;
  RETURN NEXT;
END $f$;
CREATE FUNCTION pg_temp.dem_tim(q text) RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE n bigint; BEGIN EXECUTE 'SELECT count(*) FROM public.sales_invoices WHERE ' || q INTO n; RETURN n; END $f$;
GRANT EXECUTE ON FUNCTION pg_temp.ghi(text, text, boolean, text), pg_temp.dem_tim(text) TO authenticated;

-- 0. TRẠNG THÁI TRƯỚC MIG 249 (= production hôm nay): không cột, hàm cột tính có search_path, chỉ mục biểu thức.
DO $truoc$
DECLARE r record; v_bt text;
BEGIN
  FOR r IN SELECT * FROM bang LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_zzzz_tim_kd ON public.%I', r.bang);
    EXECUTE format('ALTER TABLE public.%I DROP COLUMN IF EXISTS tim_kd', r.bang);
    SELECT 'public.khoa_tim_ds(VARIADIC ARRAY[' || string_agg(format('(%s).%I::text', '$1', c), ', ') || '])'
      INTO v_bt FROM unnest(r.cot) c;
    EXECUTE format('CREATE OR REPLACE FUNCTION public.tim_kd(public.%I) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE '
                   'SET search_path = public, extensions AS %L', r.bang, 'SELECT ' || v_bt);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.tim_kd(public.%I) TO authenticated', r.bang);
    SELECT 'public.khoa_tim_ds(VARIADIC ARRAY[' || string_agg(format('%I::text', c), ', ') || '])'
      INTO v_bt FROM unnest(r.cot) c;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I USING gin ((%s) extensions.gin_trgm_ops)',
      'idx_' || r.bang || '_tim_kd_trgm', r.bang, v_bt);
  END LOOP;
END $truoc$;

-- Chứng từ có sẵn ở cả 9 bảng (users: 5 người của sổ thử). NVBH e…04 lập HĐ 00123; quản lý e…02 lập HĐ 00456.
INSERT INTO ctx VALUES ('org', 'a0000000-0000-0000-0000-000000000001'), ('kh', 'd0000000-0000-0000-0000-000000000001'),
  ('sp', 'c0000000-0000-0000-0000-000000000001'), ('nvbh', 'e0000000-0000-0000-0000-000000000004'),
  ('ql', 'e0000000-0000-0000-0000-000000000002'), ('chu', 'e0000000-0000-0000-0000-000000000001');
CREATE FUNCTION pg_temp.c(p text) RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT u FROM ctx WHERE k = p $f$;
DO $du$
DECLARE v_don uuid; v_hd uuid; v_ncc uuid;
BEGIN
  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, order_seq, status)
  VALUES (pg_temp.c('org'), 'tam', pg_temp.c('kh'), pg_temp.c('nvbh'), 0, 'completed') RETURNING id INTO v_don;
  INSERT INTO sales_invoices (org_id, invoice_code, order_id, customer_id, invoice_seq, status, subtotal, total, sales_user_id)
  VALUES (pg_temp.c('org'), 'HD251020-00123', v_don, pg_temp.c('kh'), 990249, 'posted', 0, 0, pg_temp.c('nvbh'))
  RETURNING id INTO v_hd;
  INSERT INTO ctx VALUES ('hd', v_hd), ('don', v_don);
  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, order_seq, status)
  VALUES (pg_temp.c('org'), 'tam', pg_temp.c('kh'), pg_temp.c('ql'), 0, 'completed') RETURNING id INTO v_don;
  INSERT INTO sales_invoices (org_id, invoice_code, order_id, customer_id, invoice_seq, status, subtotal, total, sales_user_id)
  VALUES (pg_temp.c('org'), 'HD251020-00456', v_don, pg_temp.c('kh'), 990250, 'posted', 0, 0, pg_temp.c('ql'));
  INSERT INTO returns (org_id, customer_id, invoice_id, status, reason, requested_by)
  VALUES (pg_temp.c('org'), pg_temp.c('kh'), v_hd, 'draft', 'damaged', pg_temp.c('nvbh'));
  INSERT INTO stock_entries (org_id, entry_code, type, status) VALUES (pg_temp.c('org'), 'PN-0042', 'import', 'draft');
  INSERT INTO batches (org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand)
  VALUES (pg_temp.c('org'), pg_temp.c('sp'), 'LÔ-0007', '2027-01-01', 5, 5) RETURNING id INTO v_ncc;
  INSERT INTO ctx VALUES ('lo', v_ncc);
  INSERT INTO suppliers (org_id, name, code) VALUES (pg_temp.c('org'), 'NCC thử mig 249', 'NCC-249') RETURNING id INTO v_ncc;
  INSERT INTO payables (org_id, supplier_id, amount, invoice_number) VALUES (pg_temp.c('org'), v_ncc, 1000, 'HĐ-NCC 0099');
  INSERT INTO cash_receipts (org_id, receipt_code, notes, status, source_type)
  VALUES (pg_temp.c('org'), 'PT-0001', 'Thu tiền chị Hằng', 'pending', 'manual');
  INSERT INTO invoices (org_id, customer_name, invoice_number, status) VALUES (pg_temp.c('org'), 'Tạp hoá Bà Hai', '0000077', 'draft');
END $du$;

-- Lính canh: mọi UPDATE trên 9 bảng trong lúc chạy migration.
CREATE FUNCTION public._thu249_da_sua() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN INSERT INTO da_sua VALUES (TG_TABLE_NAME); RETURN NULL; END $f$;
DO $canh$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM bang LOOP
    EXECUTE format('CREATE TRIGGER zz_thu249_canh AFTER UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public._thu249_da_sua()', r.bang);
  END LOOP;
END $canh$;

\o /dev/null
\ir ../../supabase/migrations/249_luu_khoa_tim_chung_tu.sql
\o

SELECT pg_temp.ghi('1', 'cả 9 bảng có cột THƯỜNG tim_kd (không generated — ghi lại nguyên dòng vẫn được)',
  (SELECT count(*) FROM pg_attribute a JOIN bang b ON a.attrelid = ('public.' || b.bang)::regclass
    WHERE a.attname = 'tim_kd' AND NOT a.attisdropped AND a.attgenerated = '') = 9, '');
SELECT pg_temp.ghi('2', 'chứng từ CÓ SẴN được điền khoá đúng (cả 9 bảng)', l.lech = 0 AND l.da_soat >= 14,
  'lệch ' || l.lech || ' / soát ' || l.da_soat || ' dòng') FROM pg_temp.lech() l;
SELECT pg_temp.ghi('3', 'HĐ HD251020-00123: khoá như mig 205 (viết liền, bỏ số 0 đầu)',
  tim_kd = 'hd251020 00123 hd25102000123 hd251020123', tim_kd)
  FROM sales_invoices WHERE id = pg_temp.c('hd');
SELECT pg_temp.ghi('4', 'điền cột KHÔNG chạy một câu UPDATE nào (không trigger nào của chứng từ bị chạy)',
  NOT EXISTS (SELECT 1 FROM da_sua), (SELECT string_agg(DISTINCT bang, ', ') FROM da_sua));
SELECT pg_temp.ghi('5', 'bỏ hết hàm cột tính tim_kd(<bảng>) và chỉ mục biểu thức của mig 205',
  NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tim_kd' AND pronamespace = 'public'::regnamespace)
  AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexdef LIKE '%khoa_tim_ds%'),
  (SELECT count(*) FROM pg_proc WHERE proname = 'tim_kd') || ' hàm');
-- Postgres chạy trigger BEFORE theo thứ tự tên: trg_zzzz_tim_kd phải là cái CUỐI của mỗi bảng.
SELECT pg_temp.ghi('6', 'trigger khoá có ở 9 bảng và chạy SAU mọi trigger BEFORE khác (sau trigger đặt mã)',
  count(*) = 9 AND bool_and(cuoi), string_agg(b.bang || '=' || cuoi, ' ') FILTER (WHERE NOT cuoi))
  FROM bang b, LATERAL (SELECT (SELECT max(t.tgname) FROM pg_trigger t
                                 WHERE t.tgrelid = ('public.' || b.bang)::regclass AND NOT t.tgisinternal
                                   AND t.tgtype & 2 = 2 AND t.tgtype & 1 = 1) = 'trg_zzzz_tim_kd' AS cuoi) x
 WHERE EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = ('public.' || b.bang)::regclass AND t.tgname = 'trg_zzzz_tim_kd');

-- Ghi mới / sửa sau migration
DO $sau$
DECLARE v_don uuid; v_ma text; v_kd text; v_tra uuid;
BEGIN
  -- Đơn mới: trg_sales_orders_assign_code ĐÈ mã 'tam' bằng mã thật — khoá phải theo mã thật.
  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, order_seq, status)
  VALUES (pg_temp.c('org'), 'tam', pg_temp.c('kh'), pg_temp.c('nvbh'), 0, 'draft') RETURNING id, order_code, tim_kd INTO v_don, v_ma, v_kd;
  PERFORM pg_temp.ghi('7', 'đơn mới: khoá tính từ mã DO TRIGGER ĐẶT (không phải mã tạm)',
    v_ma <> 'tam' AND v_kd = public.khoa_tim(v_ma), v_ma || ' → ' || v_kd);
  -- Phiếu trả mới không ghi mã: trg_danh_so_phieu_tra đặt PT-…
  INSERT INTO returns (org_id, customer_id, invoice_id, status, reason, requested_by)
  VALUES (pg_temp.c('org'), pg_temp.c('kh'), pg_temp.c('hd'), 'draft', 'damaged', pg_temp.c('nvbh'))
  RETURNING id, return_code, tim_kd INTO v_tra, v_ma, v_kd;
  PERFORM pg_temp.ghi('8', 'phiếu trả mới: khoá theo số phiếu trigger đặt', v_ma IS NOT NULL AND v_kd = public.khoa_tim(v_ma),
    coalesce(v_ma, '∅') || ' → ' || coalesce(v_kd, '∅'));
  -- Đổi mã → khoá theo mã mới.
  UPDATE sales_invoices SET invoice_code = 'HD251021-00789' WHERE id = pg_temp.c('hd') RETURNING tim_kd INTO v_kd;
  PERFORM pg_temp.ghi('9', 'đổi số hoá đơn → khoá đổi theo', v_kd = public.khoa_tim('HD251021-00789'), v_kd);
  -- Ghi thẳng rác vào tim_kd (vd màn đọc select("*") rồi ghi lại) → bị tính đè. Cột generated thì câu ghi bị TỪ CHỐI —
  -- bắt lỗi để ghi thành bước SAI thay vì dừng cả bộ thử.
  BEGIN
    UPDATE sales_invoices SET tim_kd = 'rac', notes = 'ghi chú' WHERE id = pg_temp.c('hd') RETURNING tim_kd INTO v_kd;
    PERFORM pg_temp.ghi('10', 'ghi thẳng vào tim_kd → bị tính đè bằng khoá đúng', v_kd = public.khoa_tim('HD251021-00789'), v_kd);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.ghi('10', 'ghi thẳng vào tim_kd → bị tính đè bằng khoá đúng', false, SQLERRM);
  END;
  BEGIN
    UPDATE sales_invoices SET invoice_code = invoice_code, tim_kd = tim_kd, notes = 'ghi lại nguyên dòng'
     WHERE id = pg_temp.c('hd') RETURNING tim_kd INTO v_kd;
    PERFORM pg_temp.ghi('11', 'ghi lại nguyên dòng (có nhắc tim_kd) vẫn được, khoá giữ đúng', v_kd = public.khoa_tim('HD251021-00789'), v_kd);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.ghi('11', 'ghi lại nguyên dòng (có nhắc tim_kd) vẫn được, khoá giữ đúng', false, SQLERRM);
  END;
END $sau$;

-- Sửa dòng mà KHÔNG đổi cột nguồn thì KHÔNG tính lại khoá (lô hàng đổi số lượng liên tục). Khoá "cũ" cài lén
-- (tắt trigger) để thấy được: không tính lại thì khoá cũ còn nguyên; đổi mã lô thì tính lại.
ALTER TABLE batches DISABLE TRIGGER USER;
DO $cai$ BEGIN
  UPDATE batches SET tim_kd = 'khoa cu' WHERE id = pg_temp.c('lo');
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.ghi('12', 'lô đổi số lượng (không đổi mã) → khỏi tính lại khoá', false, 'không cài được khoá cũ: ' || SQLERRM);
END $cai$;
ALTER TABLE batches ENABLE TRIGGER USER;
UPDATE batches SET qty_on_hand = 4 WHERE id = pg_temp.c('lo');
SELECT pg_temp.ghi('12', 'lô đổi số lượng (không đổi mã) → khỏi tính lại khoá', tim_kd = 'khoa cu', tim_kd)
  FROM batches WHERE id = pg_temp.c('lo') AND NOT EXISTS (SELECT 1 FROM kq WHERE buoc = '12');
UPDATE batches SET batch_code = 'LÔ-0008' WHERE id = pg_temp.c('lo');
SELECT pg_temp.ghi('13', 'đổi mã lô → tính lại khoá', tim_kd = public.khoa_tim('LÔ-0008'), tim_kd)
  FROM batches WHERE id = pg_temp.c('lo');
-- Trigger chung của mig 177 (hàng / khách / NCC) vẫn ghi khoá như cũ.
UPDATE customers SET store_name = 'Tạp hoá Bà Hai Mới' WHERE id = pg_temp.c('kh');
SELECT pg_temp.ghi('14', 'khách đổi tên → tim_kd của khách có tên mới (trigger chung mig 177 vẫn chạy)',
  position('tap hoa ba hai moi' IN tim_kd) > 0, tim_kd) FROM customers WHERE id = pg_temp.c('kh');

-- Tìm như trình duyệt (vai authenticated, có RLS)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);
SELECT pg_temp.ghi('15', 'chủ NPP gõ "hd251021-00789" / "00789" / "789" → ra đúng HĐ',
  pg_temp.dem_tim($q$tim_kd ILIKE '%hd25102100789%'$q$) = 1 AND pg_temp.dem_tim($q$tim_kd ILIKE '%00789%'$q$) = 1
  AND pg_temp.dem_tim($q$tim_kd ILIKE '%789%'$q$) = 1 AND pg_temp.dem_tim($q$tim_kd ILIKE '%00456%'$q$) = 1, '');
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000004', true);
SELECT pg_temp.ghi('16', 'NVBH tìm: thấy HĐ của mình, KHÔNG thấy HĐ 00456 của quản lý (RLS vẫn chặn)',
  pg_temp.dem_tim($q$tim_kd ILIKE '%789%'$q$) = 1 AND pg_temp.dem_tim($q$tim_kd ILIKE '%00456%'$q$) = 0, '');
RESET ROLE;

-- Câu tìm không còn tính khoá từng dòng: kế hoạch chạy (vai authenticated) không có khoa_tim.
CREATE TEMP TABLE ke_hoach (dong text) ON COMMIT DROP;
GRANT ALL ON ke_hoach TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);
DO $kh$ DECLARE r text; BEGIN
  FOR r IN EXECUTE $q$EXPLAIN (VERBOSE, COSTS OFF) SELECT id FROM public.sales_invoices
     WHERE status = 'posted' AND (invoice_code ILIKE '%HD251020-00123%' OR tim_kd ILIKE '%hd25102000123%' OR tim_kd ILIKE '%hd251020-00123%')
     ORDER BY invoice_date DESC, created_at DESC, id LIMIT 20$q$ LOOP
    INSERT INTO ke_hoach VALUES (r);
  END LOOP;
END $kh$;
RESET ROLE;
-- Trước mig 249 bộ lọc là `tim_kd(sales_invoices.*)` (hàm, tính từng dòng); nay phải là so cột `sales_invoices.tim_kd`.
SELECT pg_temp.ghi('17', 'tìm số HĐ không còn tính lại khoá cho từng hoá đơn (lọc thẳng trên cột, không gọi hàm khoá)',
  NOT EXISTS (SELECT 1 FROM ke_hoach WHERE dong LIKE '%khoa_tim%' OR dong LIKE '%tim_kd(%')
  AND EXISTS (SELECT 1 FROM ke_hoach WHERE dong LIKE '%sales_invoices.tim_kd ~~*%'),
  (SELECT left(btrim(dong), 160) FROM ke_hoach WHERE dong LIKE '%tim_kd%' LIMIT 1));

-- Chạy lại: vô hại — không đổi giá trị, không UPDATE, vẫn 9 trigger.
CREATE TEMP TABLE truoc_lan2 ON COMMIT DROP AS SELECT id, tim_kd FROM sales_invoices;
CREATE TEMP TABLE sua_truoc_lan2 ON COMMIT DROP AS SELECT count(*) AS n FROM da_sua;
\o /dev/null
\ir ../../supabase/migrations/249_luu_khoa_tim_chung_tu.sql
\o
SELECT pg_temp.ghi('18', 'chạy lại lần hai: không lỗi, khoá giữ nguyên, không UPDATE, vẫn 9 trigger',
  NOT EXISTS (SELECT 1 FROM sales_invoices s JOIN truoc_lan2 t USING (id) WHERE s.tim_kd IS DISTINCT FROM t.tim_kd)
  AND (SELECT count(*) FROM da_sua) = (SELECT n FROM sua_truoc_lan2)
  AND (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_zzzz_tim_kd') = 9,
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_zzzz_tim_kd') || ' trigger');

-- Bước nào không ra dòng là im lặng mất — đếm cho đủ.
INSERT INTO kq SELECT '99', 'Đủ 18 dòng kiểm', count(*) = 18, count(*) || ' dòng' FROM kq;
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc::numeric;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS loi FROM kq;
ROLLBACK;
