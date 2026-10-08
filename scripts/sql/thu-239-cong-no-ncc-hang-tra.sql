-- KIỂM MIG 239 — công nợ theo NCC có cột hàng trả lại (chủ nhà 08/10/2026: "Phần công nợ theo NCC thêm cột hàng trả
-- lại, đã trả đổi tên thành đã thanh toán cho dễ theo dõi"). psql -f, BEGIN … ROLLBACK.
--   NCC X: phiếu nhập 300.000 (đã thanh toán 100.000) · phiếu trả NCC −50.000 · một khoản đã thanh toán xong 200.000.
--   NCC Y: phiếu nhập 80.000 + nợ đầu kỳ âm −10.000 (NCC nợ lại mình), không trả hàng. Kỳ vọng X: tổng nợ ròng 250.000, hàng trả lại 50.000, đã thanh toán
--   100.000, còn lại 150.000 (= 300.000 − 50.000 − 100.000). Y: hàng trả lại 0.
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;

INSERT INTO suppliers (id, org_id, name, code) VALUES
  ('5f000000-0000-0000-0000-0000000239a1', 'a0000000-0000-0000-0000-000000000001', 'NCC X thử 239', 'T239X'),
  ('5f000000-0000-0000-0000-0000000239b1', 'a0000000-0000-0000-0000-000000000001', 'NCC Y thử 239', 'T239Y');
INSERT INTO payables (id, org_id, supplier_id, invoice_number, amount, paid, status) VALUES
  ('a2390000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000239a1', 'PN-T239-1', 300000, 100000, 'partial'),
  ('a2390000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000239a1', 'TH-T239-1', -50000, 0, 'open'),
  ('a2390000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000239a1', 'PN-T239-0', 200000, 200000, 'paid'),
  ('a2390000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000239b1', 'PN-T239-2', 80000, 0, 'open'),
  ('a2390000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000239b1', 'Đầu kỳ', -10000, 0, 'open');
INSERT INTO supplier_returns (id, org_id, supplier_id, status, total, return_code, payable_credit_id) VALUES
  ('b2390000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000239a1',
   'completed', 50000, 'TH-T239-1', 'a2390000-0000-0000-0000-0000000000a2');

-- Kế toán xem màn Công nợ theo NCC (RLS thật).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000003', true);
CREATE TEMP TABLE ds ON COMMIT DROP AS SELECT * FROM public.payables_by_supplier();
RESET ROLE;

INSERT INTO kq SELECT 1, 'NCC X: tổng nợ ròng 250.000 · hàng trả lại 50.000 · đã thanh toán 100.000 · còn lại 150.000',
  total_debt = 250000 AND total_returned = 50000 AND total_paid = 100000 AND remaining = 150000,
  concat_ws(' · ', total_debt, total_returned, total_paid, remaining)
FROM ds WHERE supplier_id = '5f000000-0000-0000-0000-0000000239a1';
INSERT INTO kq SELECT 2, 'Tổng nợ gộp − hàng trả lại − đã thanh toán = còn lại',
  (total_debt + total_returned) - total_returned - total_paid = remaining, NULL
FROM ds WHERE supplier_id = '5f000000-0000-0000-0000-0000000239a1';
INSERT INTO kq SELECT 3, 'NCC Y không trả hàng: hàng trả lại 0, còn lại 70.000 (đầu kỳ âm vẫn trừ vào)',
  total_returned = 0 AND remaining = 70000, concat_ws(' · ', total_returned, remaining)
FROM ds WHERE supplier_id = '5f000000-0000-0000-0000-0000000239b1';
INSERT INTO kq SELECT 4, 'Dòng nợ âm KHÔNG thuộc phiếu trả NCC (nợ đầu kỳ âm) không tính là hàng trả lại',
  NOT EXISTS (SELECT 1 FROM ds WHERE supplier_id = '5f000000-0000-0000-0000-0000000239b1' AND total_returned <> 0), NULL;
INSERT INTO kq SELECT 5, 'Khách vãng lai (anon) không gọi được',
  NOT has_function_privilege('anon', 'public.payables_by_supplier()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.payables_by_supplier()', 'EXECUTE'), NULL;

\echo
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
