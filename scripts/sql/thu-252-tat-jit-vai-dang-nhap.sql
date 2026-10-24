-- KIỂM MIG 252 — tắt JIT ở vai đăng nhập của API (authenticator) + anon (chủ nhà 24/10/2026: bảng pg_stat_statements
-- cho thấy danh sách hoá đơn ~3 giây/câu; tái hiện: JIT bật 4.245 ms, tắt 11 ms).
-- psql -f, BEGIN … ROLLBACK (ALTER ROLE nằm trong giao dịch — huỷ là về như cũ). Chạy dưới safeupdate:
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-252-tat-jit-vai-dang-nhap.sql
\set ON_ERROR_STOP on
-- ⚠ XẾP HÀNG: vitest chạy các bộ thử song song trên CÙNG một sổ thử — khoá tư vấn giữ tới hết phiên.
\o /dev/null
SELECT pg_advisory_lock(hashtext('npp-thu-sql'));
\o
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
-- Cài đặt của một vai (toàn cụm, không theo database), dạng "khoá=giá trị".
CREATE FUNCTION pg_temp.cai(p_vai text) RETURNS text[] LANGUAGE sql STABLE AS $f$
  SELECT coalesce((SELECT array_agg(c ORDER BY c) FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole, unnest(s.setconfig) c
                    WHERE r.rolname = p_vai AND s.setdatabase = 0), '{}')
$f$;
-- Sổ đang có sẵn jit ở hai vai này (lần thử trước, tay ai đặt) thì gỡ trước — thử đúng đường của sổ thật chưa chạy mig.
ALTER ROLE authenticator RESET jit;
ALTER ROLE anon RESET jit;
CREATE TEMP TABLE truoc ON COMMIT DROP AS
  SELECT r.rolname, pg_temp.cai(r.rolname) AS cai FROM pg_roles r WHERE r.rolname IN ('authenticated', 'anon', 'authenticator', 'postgres', 'service_role');

\o /dev/null
\ir ../../supabase/migrations/252_tat_jit_vai_dang_nhap.sql
\ir ../../supabase/migrations/252_tat_jit_vai_dang_nhap.sql
\o

INSERT INTO kq SELECT 1, 'vai đăng nhập authenticator có jit=off — đúng một lần dù chạy mig hai lần',
  (SELECT count(*) FROM unnest(pg_temp.cai('authenticator')) c WHERE c LIKE 'jit=%') = 1 AND 'jit=off' = ANY (pg_temp.cai('authenticator')),
  array_to_string(pg_temp.cai('authenticator'), ' ');
INSERT INTO kq SELECT 2, 'vai anon có jit=off — đúng một lần',
  (SELECT count(*) FROM unnest(pg_temp.cai('anon')) c WHERE c LIKE 'jit=%') = 1 AND 'jit=off' = ANY (pg_temp.cai('anon')),
  array_to_string(pg_temp.cai('anon'), ' ');
INSERT INTO kq SELECT 3, 'các cài đặt khác của authenticator / anon giữ nguyên (vd pgrst.db_schemas, statement_timeout)',
  NOT EXISTS (
    SELECT 1 FROM truoc t WHERE t.rolname IN ('authenticator', 'anon')
      AND (SELECT array_agg(c ORDER BY c) FROM unnest(pg_temp.cai(t.rolname)) c WHERE c NOT LIKE 'jit=%')
          IS DISTINCT FROM (SELECT array_agg(c ORDER BY c) FROM unnest(t.cai) c WHERE c NOT LIKE 'jit=%')), '';
INSERT INTO kq SELECT 4, 'vai khác (authenticated — của mig 251, postgres, service_role) không bị đụng',
  NOT EXISTS (SELECT 1 FROM truoc t WHERE t.rolname NOT IN ('authenticator', 'anon') AND pg_temp.cai(t.rolname) IS DISTINCT FROM t.cai), '';

INSERT INTO kq SELECT 99, 'Đủ 4 dòng kiểm', count(*) = 4, count(*) || ' dòng' FROM kq;
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS loi FROM kq;
ROLLBACK;
