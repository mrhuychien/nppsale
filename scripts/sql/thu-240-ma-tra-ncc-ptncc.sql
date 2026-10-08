-- KIỂM MIG 240 — phiếu trả hàng NCC đánh số PTNCC-xxxx, đánh lại cả phiếu cũ (chủ nhà 08/10/2026: "Đổi đầu PTNCC",
-- chọn "Đánh lại cả phiếu cũ"). psql -f, BEGIN … ROLLBACK — chạy lại CHÍNH tệp migration trong giao dịch. Nên chạy dưới
-- safeupdate (như API thật):
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-240-ma-tra-ncc-ptncc.sql
--   Dựng lại trạng thái trước 240: R1 hoàn thành 01/09 (TH-250901-080000, có dòng nợ NCC + phiếu kho mang mã cũ),
--   R3 đã huỷ 03/09 (TH-250903-090000), R2 nháp 05/09 (chưa có mã, có một dòng hàng).
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;

INSERT INTO suppliers (id, org_id, name, code) VALUES
  ('5f000000-0000-0000-0000-0000000240a1', 'a0000000-0000-0000-0000-000000000001', 'NCC thử 240', 'T240');
INSERT INTO products (id, org_id, sku, name, base_unit, status) VALUES
  ('c2400000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'T240A', 'Hàng A thử 240', 'hộp', 'active');

-- Trạng thái TRƯỚC 240 (sổ đã chạy 240 thì tắt tạm trigger đánh số để dựng lại).
DO $t$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_danh_so_tra_ncc') THEN
    EXECUTE 'ALTER TABLE supplier_returns DISABLE TRIGGER trg_danh_so_tra_ncc';
  END IF;
END $t$;
INSERT INTO supplier_returns (id, org_id, supplier_id, status, return_code, total, warehouse_zone, created_at, stock_entry_id, payable_credit_id) VALUES
  ('b2400000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000240a1',
   'completed', 'TH-250901-080000', 30000, 'sale', '2026-09-01 01:00+00', NULL, NULL),
  ('b2400000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000240a1',
   'cancelled', 'TH-250903-090000', 10000, 'sale', '2026-09-03 01:00+00', NULL, NULL),
  ('b2400000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000240a1',
   'draft', NULL, 0, 'sale', '2026-09-05 01:00+00', NULL, NULL);
DO $t$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_danh_so_tra_ncc') THEN
    EXECUTE 'UPDATE supplier_returns SET return_seq = NULL, return_code_cu = NULL WHERE supplier_id = ''5f000000-0000-0000-0000-0000000240a1''';
    EXECUTE 'ALTER TABLE supplier_returns ENABLE TRIGGER trg_danh_so_tra_ncc';
  END IF;
END $t$;
INSERT INTO stock_entries (id, org_id, entry_code, type, status, posted_at, warehouse_zone, notes) VALUES
  ('e2400000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-000000000001', 'TN-T240', 'export', 'posted', now(), 'sale',
   'Xuất kho trả NCC — phiếu TH-250901-080000 (kho: sale)');
INSERT INTO payables (id, org_id, supplier_id, stock_entry_id, invoice_number, amount, paid, status, notes) VALUES
  ('a2400000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000240a1',
   'e2400000-0000-0000-0000-0000000000e1', 'TH-250901-080000', -30000, 0, 'open', 'Hoàn trả NCC — phiếu TH-250901-080000')
  ON CONFLICT DO NOTHING;
UPDATE supplier_returns SET stock_entry_id = 'e2400000-0000-0000-0000-0000000000e1', payable_credit_id = 'a2400000-0000-0000-0000-0000000000c1'
WHERE id = 'b2400000-0000-0000-0000-0000000000a1';
INSERT INTO supplier_return_lines (return_id, product_id, unit_name, quantity, unit_price, line_total, sort_order) VALUES
  ('b2400000-0000-0000-0000-0000000000a2', 'c2400000-0000-0000-0000-0000000000a1', 'hộp', 1, 5000, 5000, 1);

\ir ../../supabase/migrations/240_ma_tra_ncc_ptncc.sql

CREATE TEMP VIEW ma AS
  SELECT s.id, s.return_seq AS so, s.return_code, s.return_code_cu FROM supplier_returns s
  WHERE s.supplier_id = '5f000000-0000-0000-0000-0000000240a1';
GRANT SELECT ON ma TO authenticated;

INSERT INTO kq SELECT 1, 'Đánh lại theo thứ tự LẬP: R1 (01/09) < R3 (03/09) < R2 (05/09); mã = PTNCC- + số chạy',
  (SELECT so FROM ma WHERE id = 'b2400000-0000-0000-0000-0000000000a1') < (SELECT so FROM ma WHERE id = 'b2400000-0000-0000-0000-0000000000a3')
  AND (SELECT so FROM ma WHERE id = 'b2400000-0000-0000-0000-0000000000a3') < (SELECT so FROM ma WHERE id = 'b2400000-0000-0000-0000-0000000000a2')
  AND NOT EXISTS (SELECT 1 FROM ma WHERE return_code IS DISTINCT FROM public._ma_tra_ncc(so))
  AND NOT EXISTS (SELECT 1 FROM supplier_returns WHERE return_code IS NULL OR return_code NOT LIKE 'PTNCC-%'),
  (SELECT string_agg(return_code, ', ' ORDER BY so) FROM ma);
INSERT INTO kq SELECT 2, 'Giữ mã cũ để tra giấy đã đưa NCC (phiếu nháp chưa có mã thì để trống)',
  (SELECT return_code_cu FROM ma WHERE id = 'b2400000-0000-0000-0000-0000000000a1') = 'TH-250901-080000'
  AND (SELECT return_code_cu FROM ma WHERE id = 'b2400000-0000-0000-0000-0000000000a3') = 'TH-250903-090000'
  AND (SELECT return_code_cu FROM ma WHERE id = 'b2400000-0000-0000-0000-0000000000a2') IS NULL, NULL;
INSERT INTO kq SELECT 3, 'Dòng công nợ NCC: số chứng từ + ghi chú đổi sang mã mới',
  p.invoice_number = m.return_code AND p.notes = 'Hoàn trả NCC — phiếu ' || m.return_code,
  p.invoice_number || ' · ' || p.notes
FROM payables p, ma m WHERE p.id = 'a2400000-0000-0000-0000-0000000000c1' AND m.id = 'b2400000-0000-0000-0000-0000000000a1';
INSERT INTO kq SELECT 4, 'Ghi chú phiếu kho đổi sang mã mới',
  e.notes = 'Xuất kho trả NCC — phiếu ' || m.return_code || ' (kho: sale)', e.notes
FROM stock_entries e, ma m WHERE e.id = 'e2400000-0000-0000-0000-0000000000e1' AND m.id = 'b2400000-0000-0000-0000-0000000000a1';

-- 5. Lập phiếu mới (thủ kho, như trình duyệt — không gửi mã): có số ngay lúc lập.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
INSERT INTO supplier_returns (id, org_id, supplier_id, status, warehouse_zone) VALUES
  ('b2400000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000240a1', 'draft', 'sale');
RESET ROLE;
INSERT INTO kq SELECT 5, 'Phiếu lập mới có số PTNCC- ngay (số kế tiếp của NPP), không còn "chưa sinh mã"',
  so = (SELECT max(return_seq) FROM supplier_returns WHERE org_id = 'a0000000-0000-0000-0000-000000000001'
          AND id <> 'b2400000-0000-0000-0000-0000000000a4') + 1
  AND return_code = public._ma_tra_ncc(so), return_code FROM ma WHERE id = 'b2400000-0000-0000-0000-0000000000a4';

-- 6. Hoàn thành phiếu nháp R2 (RPC thật, cho phép xuất âm vì kho không có hàng): giữ đúng số, dòng nợ + phiếu kho mang mã PTNCC-.
UPDATE organizations SET allow_oversell = true WHERE id = 'a0000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
SELECT public.complete_supplier_return('b2400000-0000-0000-0000-0000000000a2') IS NOT NULL AS hoan_thanh_r2;
RESET ROLE;
INSERT INTO kq SELECT 6, 'Hoàn thành phiếu nháp: giữ số PTNCC-, dòng nợ NCC + phiếu kho mang mã mới (không sinh TH-)',
  m.return_code = public._ma_tra_ncc(m.so) AND m.return_code_cu IS NULL
  AND p.invoice_number = m.return_code AND e.notes LIKE '%' || m.return_code || '%'
  AND NOT EXISTS (SELECT 1 FROM supplier_returns WHERE return_code LIKE 'TH-%'),
  m.return_code || ' · ' || p.invoice_number
FROM ma m JOIN supplier_returns s ON s.id = m.id
JOIN payables p ON p.id = s.payable_credit_id JOIN stock_entries e ON e.id = s.stock_entry_id
WHERE m.id = 'b2400000-0000-0000-0000-0000000000a2';
INSERT INTO kq SELECT 7, 'Có chỉ mục số duy nhất theo NPP; trigger đang bật',
  to_regclass('public.uq_supplier_returns_org_seq') IS NOT NULL
  AND (SELECT tgenabled FROM pg_trigger WHERE tgname = 'trg_danh_so_tra_ncc') = 'O', NULL;

\echo
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
