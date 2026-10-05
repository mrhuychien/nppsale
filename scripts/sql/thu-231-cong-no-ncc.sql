-- KIỂM MIG 231 — tổng còn phải trả NCC trừ dòng âm của phiếu trả NCC (chủ nhà 05/10/2026). psql -f, BEGIN … ROLLBACK.
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE kq (buoc text, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
DELETE FROM payables WHERE org_id = 'a0000000-0000-0000-0000-000000000001';
INSERT INTO suppliers (id, org_id, name) VALUES ('5f000000-0000-0000-0000-000000000231', 'a0000000-0000-0000-0000-000000000001', 'NCC thử 231');
INSERT INTO payables (org_id, supplier_id, amount, paid, status) VALUES
  ('a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-000000000231', 300000, 100000, 'partial'),
  ('a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-000000000231', -50000, 0, 'open'),
  ('a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-000000000231', 200000, 200000, 'paid');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);
INSERT INTO kq SELECT '1', 'payables_summary: còn phải trả = 300.000 − 100.000 − 50.000', open_payables = 150000, 'open_payables = ' || open_payables
  FROM public.payables_summary(now() - interval '1 year');
INSERT INTO kq SELECT '2', 'payables_by_supplier cùng số', remaining = 150000, 'remaining = ' || remaining
  FROM public.payables_by_supplier() WHERE supplier_id = '5f000000-0000-0000-0000-000000000231';
RESET ROLE;
SELECT buoc, ten, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
