-- KIỂM MIG 251 — tắt JIT cho câu hỏi của app (chủ nhà 20/10/2026: "làm tương tự cho tìm kiếm các danh sách khác").
-- psql -f, BEGIN … ROLLBACK (ALTER ROLE nằm trong giao dịch — huỷ là về như cũ). Chạy dưới safeupdate:
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-251-tat-jit.sql
\set ON_ERROR_STOP on
-- ⚠ XẾP HÀNG: vitest chạy các bộ thử song song trên CÙNG một sổ thử — mig 250 giữ khoá mọi bảng ~13 giây, câu GRANT
--   chạy cùng lúc thì "tuple concurrently updated". Khoá tư vấn giữ tới hết phiên: bộ nào tới sau thì chờ.
\o /dev/null
SELECT pg_advisory_lock(hashtext('npp-thu-sql'));
\o
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
-- Cài đặt của một vai, dạng "khoá=giá trị".
CREATE FUNCTION pg_temp.cai(p_vai text) RETURNS text[] LANGUAGE sql STABLE AS $f$
  SELECT coalesce((SELECT array_agg(c ORDER BY c) FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole, unnest(s.setconfig) c
                    WHERE r.rolname = p_vai AND s.setdatabase = 0), '{}')
$f$;
-- Sổ đang có sẵn jit (lần thử trước, tay ai đặt) thì gỡ trước — thử đúng đường của sổ thật chưa chạy mig.
ALTER ROLE authenticated RESET jit;
CREATE TEMP TABLE truoc ON COMMIT DROP AS
  SELECT r.rolname, pg_temp.cai(r.rolname) AS cai FROM pg_roles r WHERE r.rolname IN ('authenticated', 'anon', 'authenticator', 'postgres');

\o /dev/null
\ir ../../supabase/migrations/251_tat_jit_cho_app.sql
\ir ../../supabase/migrations/251_tat_jit_cho_app.sql
\o

INSERT INTO kq SELECT 1, 'vai authenticated (câu hỏi của app) có jit=off — đúng một lần dù chạy mig hai lần',
  (SELECT count(*) FROM unnest(pg_temp.cai('authenticated')) c WHERE c LIKE 'jit=%') = 1 AND 'jit=off' = ANY (pg_temp.cai('authenticated')),
  array_to_string(pg_temp.cai('authenticated'), ' ');
INSERT INTO kq SELECT 2, 'các cài đặt khác của authenticated giữ nguyên (vd statement_timeout của Supabase)',
  (SELECT array_agg(c ORDER BY c) FROM unnest(pg_temp.cai('authenticated')) c WHERE c NOT LIKE 'jit=%')
    IS NOT DISTINCT FROM (SELECT array_agg(c ORDER BY c) FROM truoc t, unnest(t.cai) c WHERE t.rolname = 'authenticated' AND c NOT LIKE 'jit=%'), '';
INSERT INTO kq SELECT 3, 'vai khác (anon, authenticator, postgres) không bị đụng',
  NOT EXISTS (SELECT 1 FROM truoc t WHERE t.rolname <> 'authenticated' AND pg_temp.cai(t.rolname) IS DISTINCT FROM t.cai), '';
-- PostgREST áp cài đặt của vai người dùng cho từng giao dịch: dựng lại đúng bước ấy rồi xem câu có còn JIT không.
DO $pg$
DECLARE c text; d text; co_jit boolean := false;
BEGIN
  FOREACH c IN ARRAY pg_temp.cai('authenticated') LOOP
    PERFORM set_config(split_part(c, '=', 1), substr(c, length(split_part(c, '=', 1)) + 2), true);
  END LOOP;
  -- Ép ước lượng thật đắt để JIT chắc chắn bật nếu còn bật.
  PERFORM set_config('jit_above_cost', '0', true);
  FOR d IN EXECUTE 'EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF) SELECT count(*) FROM generate_series(1, 1000) g WHERE g % 7 = 0' LOOP
    IF d LIKE 'JIT:%' THEN co_jit := true; END IF;
  END LOOP;
  INSERT INTO kq SELECT 4, 'áp cài đặt của vai như PostgREST → câu không còn biên dịch JIT', current_setting('jit') = 'off' AND NOT co_jit,
    'jit=' || current_setting('jit');
END
$pg$;

INSERT INTO kq SELECT 99, 'Đủ 4 dòng kiểm', count(*) = 4, count(*) || ' dòng' FROM kq;
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS loi FROM kq;
ROLLBACK;
