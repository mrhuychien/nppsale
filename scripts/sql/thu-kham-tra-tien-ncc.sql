-- Bộ thử câu khám tiền trả NCC (supabase/diagnostics/kham_tra_tien_ncc.sql) — MỘT giao dịch rồi ROLLBACK, không để lại gì.
--   NCC "cty á châu": nợ đầu kỳ 1.000.000 nhập sẵn số đã trả (chỉ 600.000 có phiếu) · phiếu nhập PN-AC1 2.000.000 · ghi trả
--   thẳng 500.000 · phiếu chi PCNCC-T1 900.000 chia đầu kỳ 600.000 + PN-AC1 300.000 · phiếu chi PCNCC-T2 100.000 KHÔNG chia
--   đồng nào (lệch). NCC "Bình Minh": PN-B1 300.000 chưa trả. Phiếu chi loại Chi phí: "Trả tiền hàng cty Á Châu đợt 1",
--   "Thanh toán NCC Bình Minh" (nghi là trả NCC) và "Tiền điện tháng 9" (không).
--   Chạy: psql -q -At -F ' | ' -f scripts/sql/thu-kham-tra-tien-ncc.sql (sổ thử có schema app).
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO organizations (id, name, slug) VALUES ('7e570000-0000-4000-8000-000000000001', 'NPP thử khám trả NCC', 'npp-thu-kham-tra-ncc');
INSERT INTO suppliers (id, org_id, code, name) VALUES
  ('7e570000-0000-4000-8000-0000000000a1', '7e570000-0000-4000-8000-000000000001', 'NCC-AC', 'cty á châu'),
  ('7e570000-0000-4000-8000-0000000000a2', '7e570000-0000-4000-8000-000000000001', 'NCC-BM', 'Bình Minh');
INSERT INTO payables (id, org_id, supplier_id, invoice_number, amount, paid, status, opening_balance, created_at) VALUES
  ('7e570000-0000-4000-8000-0000000000b1', '7e570000-0000-4000-8000-000000000001', '7e570000-0000-4000-8000-0000000000a1',
   NULL, 1000000, 1000000, 'paid', true, '2026-09-01T03:00:00Z'),
  ('7e570000-0000-4000-8000-0000000000b2', '7e570000-0000-4000-8000-000000000001', '7e570000-0000-4000-8000-0000000000a1',
   'PN-AC1', 2000000, 800000, 'partial', false, '2026-09-10T03:00:00Z'),
  ('7e570000-0000-4000-8000-0000000000b3', '7e570000-0000-4000-8000-000000000001', '7e570000-0000-4000-8000-0000000000a2',
   'PN-B1', 300000, 0, 'open', false, '2026-09-12T03:00:00Z');
INSERT INTO supplier_payments (id, org_id, seq, code, supplier_id, paid_date, amount, method, status) VALUES
  ('7e570000-0000-4000-8000-0000000000c1', '7e570000-0000-4000-8000-000000000001', 9001, 'PCNCC-T1',
   '7e570000-0000-4000-8000-0000000000a1', '2026-09-20', 900000, 'transfer', 'posted'),
  ('7e570000-0000-4000-8000-0000000000c2', '7e570000-0000-4000-8000-000000000001', 9002, 'PCNCC-T2',
   '7e570000-0000-4000-8000-0000000000a1', '2026-09-21', 100000, 'cash', 'posted'),
  -- Phiếu đã huỷ: không tính vào tiền đã trả, không phải phiếu lệch.
  ('7e570000-0000-4000-8000-0000000000c3', '7e570000-0000-4000-8000-000000000001', 9003, 'PCNCC-T3',
   '7e570000-0000-4000-8000-0000000000a1', '2026-09-22', 700000, 'cash', 'cancelled');
INSERT INTO payable_payments (payable_id, amount, method, paid_at, supplier_payment_id) VALUES
  ('7e570000-0000-4000-8000-0000000000b2', 500000, 'cash', '2026-09-15T03:00:00Z', NULL),
  ('7e570000-0000-4000-8000-0000000000b1', 600000, 'transfer', '2026-09-20T05:00:00Z', '7e570000-0000-4000-8000-0000000000c1'),
  ('7e570000-0000-4000-8000-0000000000b2', 300000, 'transfer', '2026-09-20T05:00:00Z', '7e570000-0000-4000-8000-0000000000c1');
INSERT INTO expense_categories (id, org_id, code, name, bucket) VALUES
  ('7e570000-0000-4000-8000-0000000000d1', '7e570000-0000-4000-8000-000000000001', 'THU_KHAM', 'Chi phí khác', 'other');
INSERT INTO expenses (org_id, category_id, expense_date, amount, description) VALUES
  ('7e570000-0000-4000-8000-000000000001', '7e570000-0000-4000-8000-0000000000d1', '2026-10-01', 5000000, 'Trả tiền hàng cty Á Châu đợt 1'),
  ('7e570000-0000-4000-8000-000000000001', '7e570000-0000-4000-8000-0000000000d1', '2026-10-02', 200000, 'Thanh toán NCC Bình Minh'),
  ('7e570000-0000-4000-8000-000000000001', '7e570000-0000-4000-8000-0000000000d1', '2026-10-03', 150000, 'Tiền điện tháng 9'),
  -- Chỉ nhắc tên NCC, không có từ khoá nào.
  ('7e570000-0000-4000-8000-000000000001', '7e570000-0000-4000-8000-0000000000d1', '2026-10-04', 300000, 'Chuyển khoản Bình Minh');

\echo === KHAM
\ir ../../supabase/diagnostics/kham_tra_tien_ncc.sql
ROLLBACK;
\echo === XONG
