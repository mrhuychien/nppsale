-- KIỂM MIG 242 — phiếu chi trả NCC (chủ nhà 09/10/2026: "phiếu chi thêm phần chi cho ncc và chọn NCC là xong … ko nhất
-- thiết phiếu chi phải chi trả đúng hóa đơn nào đó, có thể chi trả ncc 1 cục 200 triệu, nhiều hóa đơn nợ").
-- psql -f, BEGIN … ROLLBACK. Chạy dưới safeupdate (như API thật):
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-242-phieu-chi-tra-ncc.sql
--   NCC S: nợ đầu kỳ ĐK 50.000 (ghi sau cùng nhưng trả trước), phiếu nhập P1 100.000 · P2 200.000 · P3 300.000,
--   dòng âm phiếu trả NCC −30.000 (không được đụng). NCC S2: phiếu nhập P5 40.000 (trộn phiếu chi + trả thẳng).
-- ⚠ RPC gọi dưới vai KẾ TOÁN; phần KIỂM chạy dưới vai postgres (đọc thẳng sổ).
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
CREATE TEMP TABLE rpc (buoc text PRIMARY KEY, v jsonb, loi text) ON COMMIT DROP;
CREATE TEMP TABLE ghi_nho (k text PRIMARY KEY, gt text) ON COMMIT DROP;
GRANT ALL ON kq, rpc, ghi_nho TO authenticated;

INSERT INTO suppliers (id, org_id, name, code) VALUES
  ('5f000000-0000-0000-0000-0000000242a1', 'a0000000-0000-0000-0000-000000000001', 'NCC thử 242', 'T242'),
  ('5f000000-0000-0000-0000-0000000242a2', 'a0000000-0000-0000-0000-000000000001', 'NCC thử 242 B', 'T242B');
INSERT INTO products (id, org_id, sku, name, base_unit, status) VALUES
  ('c2420000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-000000000001', 'T242B', 'Hàng thử 242', 'gói', 'active');
INSERT INTO purchase_invoices (id, org_id, supplier_id, status, invoice_date, warehouse_zone) VALUES
  ('d2420000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000242a1', 'draft', '2026-09-10', 'sale'),
  ('d2420000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000242a1', 'draft', '2026-09-20', 'sale'),
  ('d2420000-0000-0000-0000-0000000000f3', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000242a1', 'draft', '2026-09-25', 'sale'),
  ('d2420000-0000-0000-0000-0000000000f4', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000242a1', 'draft', '2026-10-05', 'sale'),
  ('d2420000-0000-0000-0000-0000000000f5', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000242a2', 'draft', '2026-10-05', 'sale');
INSERT INTO purchase_invoice_lines (invoice_id, product_id, unit_name, quantity, unit_price, conversion_factor, line_total, sort_order) VALUES
  ('d2420000-0000-0000-0000-0000000000f1', 'c2420000-0000-0000-0000-0000000000b1', 'gói', 20, 5000, 1, 100000, 1),
  ('d2420000-0000-0000-0000-0000000000f2', 'c2420000-0000-0000-0000-0000000000b1', 'gói', 40, 5000, 1, 200000, 1),
  ('d2420000-0000-0000-0000-0000000000f3', 'c2420000-0000-0000-0000-0000000000b1', 'gói', 60, 5000, 1, 300000, 1),
  ('d2420000-0000-0000-0000-0000000000f4', 'c2420000-0000-0000-0000-0000000000b1', 'gói', 30, 5000, 1, 150000, 1),
  ('d2420000-0000-0000-0000-0000000000f5', 'c2420000-0000-0000-0000-0000000000b1', 'gói', 8, 5000, 1, 40000, 1);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
SELECT public.complete_purchase_invoice('d2420000-0000-0000-0000-0000000000f1') IS NOT NULL AS p1,
       public.complete_purchase_invoice('d2420000-0000-0000-0000-0000000000f2') IS NOT NULL AS p2,
       public.complete_purchase_invoice('d2420000-0000-0000-0000-0000000000f3') IS NOT NULL AS p3;
RESET ROLE;
-- Ngày ghi nợ cố định để thứ tự "cũ nhất trước" rõ ràng; nợ đầu kỳ ghi SAU CÙNG nhưng vẫn phải trả trước.
UPDATE payables SET created_at = '2026-09-10 09:00+07' WHERE id = (SELECT payable_id FROM purchase_invoices WHERE id = 'd2420000-0000-0000-0000-0000000000f1');
UPDATE payables SET created_at = '2026-09-20 09:00+07' WHERE id = (SELECT payable_id FROM purchase_invoices WHERE id = 'd2420000-0000-0000-0000-0000000000f2');
UPDATE payables SET created_at = '2026-09-25 09:00+07' WHERE id = (SELECT payable_id FROM purchase_invoices WHERE id = 'd2420000-0000-0000-0000-0000000000f3');
INSERT INTO payables (id, org_id, supplier_id, amount, paid, status, notes, opening_balance, created_at) VALUES
  ('9a420000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000242a1', 50000, 0, 'open', 'Nợ đầu kỳ thử', true, '2026-09-28 09:00+07'),
  ('9a420000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000242a1', -30000, 0, 'open', 'Hoàn trả NCC — phiếu thử', false, '2026-09-26 09:00+07');

CREATE TEMP VIEW no_s AS
  SELECT p.*, CASE WHEN p.id = '9a420000-0000-0000-0000-0000000000d1' THEN 'DK'
                   WHEN p.id = '9a420000-0000-0000-0000-0000000000c1' THEN 'TRA'
                   ELSE COALESCE((SELECT 'P' || right(pi.id::text, 1) FROM purchase_invoices pi WHERE pi.payable_id = p.id),
                                 CASE WHEN EXISTS (SELECT 1 FROM supplier_payments sp WHERE sp.prepay_payable_id = p.id) THEN 'TT' ELSE '?' END) END AS ten
  FROM payables p WHERE p.supplier_id = '5f000000-0000-0000-0000-0000000242a1';
-- Nợ ròng NCC — đúng cách màn hình / payables_by_supplier cộng: Σ(amount − paid) trên dòng chưa 'paid'.
CREATE TEMP VIEW no_rong AS
  SELECT COALESCE(sum(amount - COALESCE(paid, 0)) FILTER (WHERE status <> 'paid'), 0) AS v
  FROM payables WHERE supplier_id = '5f000000-0000-0000-0000-0000000242a1';
CREATE TEMP VIEW tien_chi AS
  SELECT sp.code, sp.status, sp.amount, COALESCE((SELECT sum(pp.amount) FROM payable_payments pp WHERE pp.supplier_payment_id = sp.id), 0) AS da_ghi
  FROM supplier_payments sp WHERE sp.supplier_id IN ('5f000000-0000-0000-0000-0000000242a1', '5f000000-0000-0000-0000-0000000242a2');
INSERT INTO ghi_nho SELECT 'chi_ncc_truoc', cash_to_suppliers::text FROM public.finance_cash_flow(public.vn_today(), public.vn_today());
INSERT INTO kq SELECT 0, 'Chuẩn bị: nợ ròng 50 + 100 + 200 + 300 − 30 = 620.000', v = 620000, v::text FROM no_rong;

-- 1. Chi 120.000: trừ ĐK 50.000 (nợ đầu kỳ trước) rồi P1 70.000 (cũ nhất); P2 / P3 / dòng âm phiếu trả không đụng.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000003', true);
INSERT INTO rpc (buoc, v) VALUES ('1', public.chi_tra_ncc('5f000000-0000-0000-0000-0000000242a1', 120000, NULL, 'transfer', 'trả đợt 1', 'UNC-01'));
RESET ROLE;
INSERT INTO kq SELECT 1, 'Chi 120.000 → ĐK 50.000 đủ, P1 70.000 (còn 30.000); P2 / P3 / phiếu trả đứng yên; không còn trả trước',
  r.v->>'code' = 'PCNCC-0001' AND (r.v->>'da_tru_no')::numeric = 120000 AND (r.v->>'tra_truoc')::numeric = 0 AND (r.v->>'so_khoan')::int = 2
  AND (SELECT paid = 50000 AND status = 'paid' FROM no_s WHERE ten = 'DK')
  AND (SELECT paid = 70000 AND status = 'partial' FROM no_s WHERE ten = 'P1')
  AND (SELECT paid = 0 AND status = 'open' FROM no_s WHERE ten = 'P2')
  AND (SELECT paid = 0 FROM no_s WHERE ten = 'P3')
  AND (SELECT paid = 0 AND status = 'open' FROM no_s WHERE ten = 'TRA')
  AND NOT EXISTS (SELECT 1 FROM no_s WHERE ten = 'TT')
  AND (SELECT v FROM no_rong) = 500000,
  r.v::text || ' · nợ ròng ' || (SELECT v FROM no_rong)::text
FROM rpc r WHERE r.buoc = '1';

-- 2. Chi DƯ 700.000: trả hết P1 30.000 + P2 200.000 + P3 300.000, dư 170.000 thành dòng trả trước (mở) → nợ ròng −200.000.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000003', true);
INSERT INTO rpc (buoc, v) VALUES ('2', public.chi_tra_ncc('5f000000-0000-0000-0000-0000000242a1', 700000, NULL, 'cash', NULL, NULL));
RESET ROLE;
INSERT INTO kq SELECT 2, 'Chi dư 700.000 → P1 / P2 / P3 đủ, 170.000 trả trước (dòng mở), nợ ròng −200.000',
  r.v->>'code' = 'PCNCC-0002' AND (r.v->>'da_tru_no')::numeric = 530000 AND (r.v->>'tra_truoc')::numeric = 170000
  AND (SELECT bool_and(status = 'paid' AND paid = amount) FROM no_s WHERE ten IN ('P1', 'P2', 'P3'))
  AND (SELECT amount = 0 AND paid = 170000 AND status = 'open' FROM no_s WHERE ten = 'TT')
  AND (SELECT v FROM no_rong) = -200000,
  r.v::text || ' · nợ ròng ' || (SELECT v FROM no_rong)::text
FROM rpc r WHERE r.buoc = '2';
INSERT INTO kq SELECT 3, 'Dòng tiền: chi NCC hôm nay tăng đúng 820.000 (120 + 700), dù tiền đã chia nhiều dòng',
  cash_to_suppliers - (SELECT gt FROM ghi_nho WHERE k = 'chi_ncc_truoc')::numeric = 820000,
  (cash_to_suppliers - (SELECT gt FROM ghi_nho WHERE k = 'chi_ncc_truoc')::numeric)::text
FROM public.finance_cash_flow(public.vn_today(), public.vn_today());
INSERT INTO kq SELECT 4, 'Mỗi phiếu chi: tổng các phần đã ghi = số tiền phiếu', bool_and(da_ghi = amount), string_agg(code || ' ' || da_ghi, ' · ')
FROM tien_chi WHERE status = 'posted';
INSERT INTO kq SELECT 5, 'Không ghi gì vào chi phí (lãi lỗ)', NOT EXISTS (SELECT 1 FROM expenses WHERE description LIKE '%PCNCC-%'), NULL;

-- 6. Phiếu nhập mới P4 150.000 hoàn thành → tự lấy tiền trả trước (còn 20.000 trả trước).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
SELECT public.complete_purchase_invoice('d2420000-0000-0000-0000-0000000000f4') IS NOT NULL AS p4;
RESET ROLE;
INSERT INTO kq SELECT 6, 'Phiếu nhập mới P4 150.000 tự trừ vào tiền trả trước → P4 đủ, trả trước còn 20.000, nợ ròng −50.000',
  (SELECT paid = 150000 AND status = 'paid' FROM no_s WHERE ten = 'P4')
  AND (SELECT paid = 20000 FROM no_s WHERE ten = 'TT')
  AND (SELECT v FROM no_rong) = -50000,
  'nợ ròng ' || (SELECT v FROM no_rong)::text FROM (SELECT 1) x;

-- 7. Huỷ phiếu chi #1 (120.000): ĐK về 0, P1 về 30.000 (của #2) → 20.000 trả trước của #2 dồn vào ĐK. Nợ ròng 70.000.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000003', true);
INSERT INTO rpc (buoc, v) VALUES ('7', public.huy_phieu_chi_ncc((SELECT id FROM supplier_payments WHERE code = 'PCNCC-0001'), 'chi nhầm'));
INSERT INTO rpc (buoc, v) VALUES ('8', public.huy_phieu_chi_ncc((SELECT id FROM supplier_payments WHERE code = 'PCNCC-0001'), 'bấm lại'));
RESET ROLE;
INSERT INTO kq SELECT 7, 'Huỷ phiếu chi #1 → gỡ 120.000; trả trước #2 (20.000) dồn vào nợ đầu kỳ; nợ ròng 70.000',
  (r.v->>'da_huy')::boolean AND (r.v->>'so_tien_go')::numeric = 120000
  AND (SELECT status = 'cancelled' AND cancel_reason = 'chi nhầm' FROM supplier_payments WHERE code = 'PCNCC-0001')
  AND (SELECT da_ghi = 0 FROM tien_chi WHERE code = 'PCNCC-0001')
  AND (SELECT paid = 20000 AND status = 'partial' FROM no_s WHERE ten = 'DK')
  AND (SELECT paid = 30000 AND status = 'partial' FROM no_s WHERE ten = 'P1')
  AND NOT EXISTS (SELECT 1 FROM no_s WHERE ten = 'TT')
  AND (SELECT v FROM no_rong) = 70000,
  r.v::text || ' · nợ ròng ' || (SELECT v FROM no_rong)::text
FROM rpc r WHERE r.buoc = '7';
INSERT INTO kq SELECT 8, 'Huỷ lại lần hai: đứng yên', NOT (r.v->>'da_huy')::boolean AND (SELECT v FROM no_rong) = 70000, r.v::text
FROM rpc r WHERE r.buoc = '8';

-- 9. Huỷ phiếu nhập P2 (200.000 do phiếu chi #2 trả): KHÔNG chặn — 200.000 về trả trước rồi dồn vào ĐK 30.000 + P1 70.000,
--    còn 100.000 trả trước. Nợ ròng 70.000 − 200.000 = −130.000.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
DO $t$
BEGIN
  BEGIN
    INSERT INTO rpc (buoc, v) VALUES ('9', to_jsonb(public.cancel_purchase_invoice('d2420000-0000-0000-0000-0000000000f2', 'nhập nhầm')));
  EXCEPTION WHEN OTHERS THEN INSERT INTO rpc (buoc, loi) VALUES ('9', SQLERRM); END;
END $t$;
RESET ROLE;
INSERT INTO kq SELECT 9, 'Huỷ P2 đã được phiếu chi trả → được; tiền về trả trước, dồn vào ĐK + P1; còn 100.000 trả trước; nợ ròng −130.000',
  r.loi IS NULL
  AND (SELECT status FROM purchase_invoices WHERE id = 'd2420000-0000-0000-0000-0000000000f2') = 'cancelled'
  AND (SELECT paid = 50000 AND status = 'paid' FROM no_s WHERE ten = 'DK')
  AND (SELECT paid = 100000 AND status = 'paid' FROM no_s WHERE ten = 'P1')
  AND (SELECT amount = 0 AND paid = 100000 AND status = 'open' FROM no_s WHERE ten = 'TT')
  AND (SELECT da_ghi = 700000 FROM tien_chi WHERE code = 'PCNCC-0002')
  AND (SELECT v FROM no_rong) = -130000,
  COALESCE(r.loi, 'được') || ' · nợ ròng ' || (SELECT v FROM no_rong)::text
FROM rpc r WHERE r.buoc = '9';

-- 10. NCC S2: phiếu nhập P5 40.000 — phiếu chi 15.000 tự trừ + trả THẲNG 5.000 (Ghi trả NCC). Huỷ P5 → DA_TRA_TIEN 5.000
--     và lùi hết (phần phiếu chi vẫn nằm ở P5).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
SELECT public.complete_purchase_invoice('d2420000-0000-0000-0000-0000000000f5') IS NOT NULL AS p5;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000003', true);
INSERT INTO rpc (buoc, v) VALUES ('10a', public.chi_tra_ncc('5f000000-0000-0000-0000-0000000242a2', 15000, '2026-10-01', 'cash', NULL, NULL));
SELECT public.record_payable_payment((SELECT payable_id FROM purchase_invoices WHERE id = 'd2420000-0000-0000-0000-0000000000f5'), 5000, 'cash', 'trả thẳng') IS NOT NULL AS tra_thang;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
DO $t$
BEGIN
  BEGIN
    INSERT INTO rpc (buoc, v) VALUES ('10', to_jsonb(public.cancel_purchase_invoice('d2420000-0000-0000-0000-0000000000f5', 'thử')));
  EXCEPTION WHEN OTHERS THEN INSERT INTO rpc (buoc, loi) VALUES ('10', SQLERRM); END;
END $t$;
RESET ROLE;
INSERT INTO kq SELECT 10, 'Phiếu nhập có tiền trả THẲNG → vẫn chặn DA_TRA_TIEN (5.000), phần phiếu chi 15.000 vẫn nằm ở phiếu',
  r.loi LIKE 'DA_TRA_TIEN:%5000%'
  AND (SELECT status FROM purchase_invoices WHERE id = 'd2420000-0000-0000-0000-0000000000f5') = 'completed'
  AND (SELECT paid FROM payables WHERE id = (SELECT payable_id FROM purchase_invoices WHERE id = 'd2420000-0000-0000-0000-0000000000f5')) = 20000,
  COALESCE(r.loi, 'không chặn')
FROM rpc r WHERE r.buoc = '10';
INSERT INTO kq SELECT 11, 'Chi ghi lùi ngày 01/10 → lúc chi là ngày 01/10 giờ VN (dòng tiền đúng ngày); số phiếu chạy tiếp PCNCC-0003',
  r.v->>'code' = 'PCNCC-0003'
  AND (SELECT bool_and((pp.paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = DATE '2026-10-01') FROM payable_payments pp
       JOIN supplier_payments sp ON sp.id = pp.supplier_payment_id WHERE sp.code = 'PCNCC-0003')
  AND (SELECT paid_date = DATE '2026-10-01' FROM supplier_payments WHERE code = 'PCNCC-0003'),
  r.v::text
FROM rpc r WHERE r.buoc = '10a';

-- 12. Quyền và dữ liệu sai. (id phiếu ghi sẵn: dưới RLS người NPP khác không đọc được phiếu để tự tra id.)
INSERT INTO ghi_nho SELECT 'pc2', id::text FROM supplier_payments WHERE code = 'PCNCC-0002';
INSERT INTO organizations (id, name, slug) VALUES ('a0000000-0000-0000-0000-0000000242f2', 'NPP thứ hai (thử 242)', 'npp-thu-242')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id) VALUES ('e2420000-0000-0000-0000-0000000000f2');
INSERT INTO users (id, org_id, full_name, role) VALUES ('e2420000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-0000000242f2', 'Chủ NPP khác', 'owner');
SET LOCAL ROLE authenticated;
DO $t$
DECLARE
  c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
      ('12a', 'e0000000-0000-0000-0000-000000000002', 'chi'),   -- quản lý
      ('12b', 'e0000000-0000-0000-0000-000000000005', 'chi'),   -- thủ kho
      ('12c', 'e0000000-0000-0000-0000-000000000004', 'chi'),   -- NV bán hàng
      ('12d', 'e2420000-0000-0000-0000-0000000000f2', 'chi'),   -- chủ NPP khác
      ('12e', 'e0000000-0000-0000-0000-000000000002', 'huy'),   -- quản lý huỷ
      ('12f', 'e2420000-0000-0000-0000-0000000000f2', 'huy'),   -- NPP khác huỷ
      ('12g', 'e0000000-0000-0000-0000-000000000003', 'so0'),   -- số tiền 0
      ('12h', 'e0000000-0000-0000-0000-000000000003', 'bu'),    -- hình thức bù trừ
      ('12i', 'e0000000-0000-0000-0000-000000000003', 'mai')    -- ngày mai
    ) AS t(buoc, ai, viec)
  LOOP
    PERFORM set_config('request.jwt.claim.sub', c.ai, true);
    BEGIN
      IF c.viec = 'chi' THEN
        INSERT INTO rpc (buoc, v) VALUES (c.buoc, public.chi_tra_ncc('5f000000-0000-0000-0000-0000000242a1', 1000, NULL, 'cash', NULL, NULL));
      ELSIF c.viec = 'huy' THEN
        INSERT INTO rpc (buoc, v) VALUES (c.buoc, public.huy_phieu_chi_ncc((SELECT gt FROM ghi_nho WHERE k = 'pc2')::uuid, NULL));
      ELSIF c.viec = 'so0' THEN
        INSERT INTO rpc (buoc, v) VALUES (c.buoc, public.chi_tra_ncc('5f000000-0000-0000-0000-0000000242a1', 0, NULL, 'cash', NULL, NULL));
      ELSIF c.viec = 'bu' THEN
        INSERT INTO rpc (buoc, v) VALUES (c.buoc, public.chi_tra_ncc('5f000000-0000-0000-0000-0000000242a1', 1000, NULL, 'offset', NULL, NULL));
      ELSE
        INSERT INTO rpc (buoc, v) VALUES (c.buoc, public.chi_tra_ncc('5f000000-0000-0000-0000-0000000242a1', 1000, public.vn_today() + 1, 'cash', NULL, NULL));
      END IF;
    EXCEPTION WHEN OTHERS THEN INSERT INTO rpc (buoc, loi) VALUES (c.buoc, SQLERRM); END;
  END LOOP;
END $t$;
-- 13. Trình duyệt không ghi thẳng phiếu chi được (chỉ RPC).
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000003', true);
DO $t$
BEGIN
  BEGIN
    INSERT INTO supplier_payments (org_id, seq, code, supplier_id, paid_date, amount, method)
    VALUES ('a0000000-0000-0000-0000-000000000001', 999, 'PCNCC-0999', '5f000000-0000-0000-0000-0000000242a1', public.vn_today(), 1, 'cash');
    INSERT INTO rpc (buoc, loi) VALUES ('13', 'ghi được');
  EXCEPTION WHEN OTHERS THEN INSERT INTO rpc (buoc, loi) VALUES ('13', SQLERRM); END;
END $t$;
RESET ROLE;
INSERT INTO kq SELECT 12, 'Quản lý / thủ kho / NVBH lập phiếu chi NCC → FORBIDDEN', count(*) = 3 AND bool_and(COALESCE(loi LIKE 'FORBIDDEN:%', false)), string_agg(buoc || ' ' || COALESCE(loi, v::text), ' · ')
FROM rpc WHERE buoc IN ('12a', '12b', '12c');
INSERT INTO kq SELECT 13, 'Chủ NPP khác: NCC không thuộc đơn vị; huỷ phiếu → SAI_DON_VI; quản lý huỷ → FORBIDDEN',
  (SELECT loi LIKE 'NCC_KHONG_HOP_LE:%' FROM rpc WHERE buoc = '12d')
  AND (SELECT loi LIKE 'SAI_DON_VI:%' FROM rpc WHERE buoc = '12f')
  AND (SELECT loi LIKE 'FORBIDDEN:%' FROM rpc WHERE buoc = '12e'),
  (SELECT string_agg(buoc || ' ' || COALESCE(loi, v::text), ' · ') FROM rpc WHERE buoc IN ('12d', '12e', '12f'));
INSERT INTO kq SELECT 14, 'Số tiền 0 / hình thức bù trừ / ngày sau hôm nay → bị từ chối',
  (SELECT loi LIKE 'BAD_AMOUNT:%' FROM rpc WHERE buoc = '12g')
  AND (SELECT loi LIKE 'BAD_METHOD:%' FROM rpc WHERE buoc = '12h')
  AND (SELECT loi LIKE 'NGAY_TUONG_LAI:%' FROM rpc WHERE buoc = '12i'),
  (SELECT string_agg(buoc || ' ' || COALESCE(loi, v::text), ' · ') FROM rpc WHERE buoc IN ('12g', '12h', '12i'));
INSERT INTO kq SELECT 15, 'Trình duyệt chèn thẳng supplier_payments → bị chặn (RLS)', loi IS DISTINCT FROM 'ghi được', loi FROM rpc WHERE buoc = '13';
INSERT INTO kq SELECT 16, 'Dòng âm phiếu trả NCC không bị đụng suốt cả bộ', paid = 0 AND status = 'open', paid::text || ' ' || status FROM no_s WHERE ten = 'TRA';
INSERT INTO kq SELECT 17, 'Công nợ theo NCC (payables_by_supplier) = nợ ròng −130.000',
  (SELECT remaining FROM public.payables_by_supplier() WHERE supplier_id = '5f000000-0000-0000-0000-0000000242a1') = -130000, NULL
FROM (SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true)) x;
INSERT INTO kq SELECT 18, 'anon không gọi được RPC phiếu chi NCC; hàm nội bộ đóng với authenticated',
  NOT has_function_privilege('anon', 'public.chi_tra_ncc(uuid,numeric,date,text,text,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.chi_tra_ncc(uuid,numeric,date,text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._don_tra_truoc_ncc(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._tra_phan_bo_ve_truoc(uuid)', 'EXECUTE'), NULL;

\echo
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS loi FROM kq;
ROLLBACK;
