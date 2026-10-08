-- KIỂM MIG 237 — phiếu trả hàng PT-xxxx, mã chứng từ không bị cắt khi qua số 9999 (chủ nhà 08/10/2026: "Phiếu trả
-- hàng : đánh số bình thường. dùng PT"). psql -f, BEGIN … ROLLBACK — chạy lại CHÍNH tệp migration trong giao dịch.
--   Dựng lại trạng thái trước 237: hai phiếu trả mang số TH- (một phiếu có ngày trừ doanh số lệch luật hiện tại — dữ
--   liệu cũ), một phiếu nhập PN-9999.
--     psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong -f scripts/sql/thu-237-ma-phieu-tra-pt.sql
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;

-- Hai phiếu trả: R1 hoàn thành (ngày trừ doanh số theo ngày ghi có 12/09), R2 nháp.
INSERT INTO returns (id, org_id, customer_id, requested_by, status, reason, return_date, credited_at, credit_note_amount) VALUES
  ('a2370000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000006',
   'e0000000-0000-0000-0000-000000000005', 'completed', 'damaged', '2026-09-10', '2026-09-12 03:00+00', 50000),
  ('a2370000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000006',
   'e0000000-0000-0000-0000-000000000005', 'draft', 'damaged', '2026-09-11', NULL, 20000);
-- Trạng thái TRƯỚC 237: số TH-, và R1 mang ngày trừ doanh số cũ 01/09 (lệch luật hiện tại — đổi mã không được dời nó).
ALTER TABLE returns DISABLE TRIGGER trg_zz_returns_revenue_date;
UPDATE returns SET return_code = 'TH-' || lpad(return_seq::text, 4, '0')
WHERE id IN ('a2370000-0000-0000-0000-0000000000a1', 'a2370000-0000-0000-0000-0000000000a2');
UPDATE returns SET revenue_date = '2026-09-01' WHERE id = 'a2370000-0000-0000-0000-0000000000a1';
ALTER TABLE returns ENABLE TRIGGER trg_zz_returns_revenue_date;
CREATE TEMP TABLE truoc ON COMMIT DROP AS SELECT id, return_seq, return_code, revenue_date, updated_at FROM returns;

-- Phiếu nhập đã tới số 9999.
INSERT INTO suppliers (id, org_id, name, code) VALUES
  ('5f000000-0000-0000-0000-0000000237a1', 'a0000000-0000-0000-0000-000000000001', 'NCC thử 237', 'T237');
INSERT INTO purchase_invoices (id, org_id, supplier_id, status, invoice_date, warehouse_zone, receipt_code) VALUES
  ('d2370000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000237a1',
   'cancelled', '2026-10-01', 'sale', 'PN-9999');

\ir ../../supabase/migrations/237_ma_phieu_tra_pt.sql

INSERT INTO kq SELECT 1, 'Số phiếu trả PT-: 7 → PT-0007, 12345 → PT-12345 (không cắt)',
  public._ma_phieu_tra(7) = 'PT-0007' AND public._ma_phieu_tra(12345) = 'PT-12345',
  public._ma_phieu_tra(7) || ' · ' || public._ma_phieu_tra(12345);
INSERT INTO kq SELECT 2, 'Mã HĐ / đơn: dưới 10.000 y như cũ, từ 10.000 đủ chữ số, giữ hậu tố sửa / lập lại',
  public._inv_code(9999, 0) = 'HD-9999' AND public._inv_code(10000, 0) = 'HD-10000' AND public._inv_code(12, 1) = 'HD-0012-1'
  AND public._order_code(5, 0) = 'DH-0005' AND public._order_code(10000, 2) = 'DH-10000-2',
  public._inv_code(10000, 0) || ' · ' || public._order_code(10000, 2);
INSERT INTO kq SELECT 3, 'Phiếu nhập sau PN-9999 là PN-10000 (trước đây PN-1000 — trùng mã, không lập được)',
  public.next_purchase_receipt_code('a0000000-0000-0000-0000-000000000001') = 'PN-10000',
  public.next_purchase_receipt_code('a0000000-0000-0000-0000-000000000001');
INSERT INTO kq SELECT 4, 'Phiếu trả cũ TH-xxxx → PT-xxxx, giữ nguyên số; không còn phiếu TH-',
  NOT EXISTS (SELECT 1 FROM returns WHERE return_code LIKE 'TH-%')
  AND NOT EXISTS (SELECT 1 FROM returns r JOIN truoc t ON t.id = r.id
                  WHERE r.return_seq IS DISTINCT FROM t.return_seq
                     OR r.return_code IS DISTINCT FROM 'PT-' || substring(t.return_code FROM 4)),
  (SELECT string_agg(t.return_code || '→' || r.return_code, ', ' ORDER BY r.return_seq) FROM returns r JOIN truoc t ON t.id = r.id);
INSERT INTO kq SELECT 5, 'Đổi mã KHÔNG dời ngày trừ doanh số (R1 giữ 01/09) và không đổi giờ sửa phiếu',
  (SELECT revenue_date FROM returns WHERE id = 'a2370000-0000-0000-0000-0000000000a1') = DATE '2026-09-01'
  AND NOT EXISTS (SELECT 1 FROM returns r JOIN truoc t ON t.id = r.id
                  WHERE r.revenue_date IS DISTINCT FROM t.revenue_date OR r.updated_at IS DISTINCT FROM t.updated_at),
  (SELECT revenue_date::text FROM returns WHERE id = 'a2370000-0000-0000-0000-0000000000a1');
INSERT INTO kq SELECT 6, 'Trigger ngày trừ doanh số BẬT lại sau khi đổi mã',
  (SELECT tgenabled FROM pg_trigger WHERE tgname = 'trg_zz_returns_revenue_date') = 'O',
  (SELECT tgenabled::text FROM pg_trigger WHERE tgname = 'trg_zz_returns_revenue_date');

-- Lập phiếu mới (NV bán hàng, như trình duyệt): số chạy tiếp, đầu PT-.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000004', true);
INSERT INTO returns (id, org_id, customer_id, requested_by, status, reason, return_date, credit_note_amount) VALUES
  ('a2370000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000006',
   'e0000000-0000-0000-0000-000000000004', 'draft', 'damaged', '2026-10-08', 10000);
RESET ROLE;
INSERT INTO kq SELECT 7, 'Phiếu lập sau 237 mang số PT- chạy tiếp',
  (SELECT return_code FROM returns WHERE id = 'a2370000-0000-0000-0000-0000000000a3')
    = 'PT-' || lpad(((SELECT max(return_seq) FROM truoc WHERE return_seq IS NOT NULL) + 1)::text, 4, '0'),
  (SELECT return_code FROM returns WHERE id = 'a2370000-0000-0000-0000-0000000000a3');

\echo
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
