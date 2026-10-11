-- KIỂM MIG 243 — bảng cân đối: dòng "Trả trước cho NCC", phải trả NCC RÒNG THEO TỪNG NCC (chủ nhà 11/10/2026: "thêm
-- dòng trả trước cho NCC vào"). psql -f, BEGIN … ROLLBACK. Chạy dưới safeupdate (như API thật):
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-243-can-doi-tra-truoc-ncc.sql
-- Sổ có sẵn dữ liệu khác → so CHÊNH trước / sau trên các NCC thử mới (hàm gom theo NCC nên không lẫn):
--   A: nợ 300.000 + dòng trả trước 50.000          → ròng  250.000 → phải trả.
--   B: nợ 100.000 + dòng âm phiếu trả NCC −30.000   → ròng   70.000 → phải trả (bản cũ kẹp từng dòng: 100.000).
--   C: chỉ có dòng âm −80.000                       → ròng  −80.000 → TRẢ TRƯỚC 80.000 (bản cũ: mất hẳn).
--   D: nợ 200.000, trả 150.000, đánh dấu tay 'paid' → không tính (như payables_by_supplier / tongNoNcc).
--   E: nợ 100.000 rồi phiếu chi trả NCC 150.000 (mig 242) → phải trả −100.000, trả trước +50.000, tiền −150.000:
--      vốn chủ (phần chênh) ĐỨNG YÊN (bản cũ hụt 50.000).
-- ⚠ Đọc bảng cân đối dưới vai KẾ TOÁN (hàm SECURITY INVOKER — RLS áp như thật); dựng sổ dưới vai postgres.
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
CREATE TEMP TABLE bs (moc text PRIMARY KEY, cash numeric, ar numeric, inv numeric, ap numeric, unpaid numeric, tt numeric,
                      con_lai_ncc numeric) ON COMMIT DROP;
GRANT ALL ON kq, bs TO authenticated;

INSERT INTO suppliers (id, org_id, name, code) VALUES
  ('5f000000-0000-0000-0000-0000000243a1', 'a0000000-0000-0000-0000-000000000001', 'NCC thử 243 A', 'T243A'),
  ('5f000000-0000-0000-0000-0000000243b1', 'a0000000-0000-0000-0000-000000000001', 'NCC thử 243 B', 'T243B'),
  ('5f000000-0000-0000-0000-0000000243c1', 'a0000000-0000-0000-0000-000000000001', 'NCC thử 243 C', 'T243C'),
  ('5f000000-0000-0000-0000-0000000243d1', 'a0000000-0000-0000-0000-000000000001', 'NCC thử 243 D', 'T243D'),
  ('5f000000-0000-0000-0000-0000000243e1', 'a0000000-0000-0000-0000-000000000001', 'NCC thử 243 E', 'T243E');

-- Chụp bảng cân đối + tổng "còn lại" của màn Công nợ theo NCC (payables_by_supplier) dưới vai kế toán.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000003', true);
INSERT INTO bs SELECT 'truoc', b.cash, b.accounts_receivable, b.inventory, b.accounts_payable, b.unpaid_expenses, b.supplier_prepayments,
                      (SELECT COALESCE(sum(remaining), 0) FROM public.payables_by_supplier())
  FROM public.finance_balance_sheet(public.vn_today()) b;
RESET ROLE;

INSERT INTO payables (id, org_id, supplier_id, amount, paid, status, notes, created_at) VALUES
  ('9a430000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000243a1', 300000, 0, 'open', 'Nợ thử A', '2026-10-01 09:00+07'),
  ('9a430000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000243a1', 0, 50000, 'open', 'Trả trước thử A', '2026-10-02 09:00+07'),
  ('9a430000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000243b1', 100000, 0, 'open', 'Nợ thử B', '2026-10-01 09:00+07'),
  ('9a430000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000243b1', -30000, 0, 'open', 'Hoàn trả NCC thử B', '2026-10-03 09:00+07'),
  ('9a430000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000243c1', -80000, 0, 'open', 'Hoàn trả NCC thử C', '2026-10-03 09:00+07'),
  ('9a430000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000243d1', 200000, 150000, 'paid', 'Đánh dấu đã trả tay', '2026-10-01 09:00+07'),
  ('9a430000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000243e1', 100000, 0, 'open', 'Nợ thử E', '2026-10-01 09:00+07');

-- Bản cũ (mig 228) cộng phải trả kẹp TỪNG DÒNG — chụp ngay lúc này (trước phiếu chi của E) để so.
CREATE TEMP TABLE cu ON COMMIT DROP AS
  SELECT COALESCE(sum(GREATEST(0, amount - COALESCE(paid, 0))), 0) AS v
  FROM payables WHERE supplier_id::text LIKE '5f000000-0000-0000-0000-0000000243%' AND status <> 'paid';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000003', true);
INSERT INTO bs SELECT 'sau_nhap', b.cash, b.accounts_receivable, b.inventory, b.accounts_payable, b.unpaid_expenses, b.supplier_prepayments,
                      (SELECT COALESCE(sum(remaining), 0) FROM public.payables_by_supplier())
  FROM public.finance_balance_sheet(public.vn_today()) b;
SELECT public.chi_tra_ncc('5f000000-0000-0000-0000-0000000243e1', 150000, public.vn_today(), 'cash', 'thử 243', NULL) IS NOT NULL AS da_chi;
INSERT INTO bs SELECT 'sau_chi', b.cash, b.accounts_receivable, b.inventory, b.accounts_payable, b.unpaid_expenses, b.supplier_prepayments,
                      (SELECT COALESCE(sum(remaining), 0) FROM public.payables_by_supplier())
  FROM public.finance_balance_sheet(public.vn_today()) b;
RESET ROLE;

CREATE TEMP VIEW ch AS
  SELECT s.moc,
         s.cash - t.cash AS d_cash, s.ar - t.ar AS d_ar, s.inv - t.inv AS d_inv, s.unpaid - t.unpaid AS d_unpaid,
         s.ap - t.ap AS d_ap, s.tt - t.tt AS d_tt,
         -- Vốn chủ (phần chênh) = tài sản − nợ phải trả; tài sản gồm cả trả trước cho NCC.
         (s.cash + s.ar + s.inv + s.tt - s.ap - s.unpaid) - (t.cash + t.ar + t.inv + t.tt - t.ap - t.unpaid) AS d_von
  FROM bs s, bs t WHERE t.moc = 'truoc';

INSERT INTO kq SELECT 1, 'Thêm nợ A/B/C/D/E: phải trả +420.000 (A 250 + B 70 + E 100; D đã đánh dấu trả không tính)', d_ap = 420000, 'Δ phải trả ' || d_ap
  FROM ch WHERE moc = 'sau_nhap';
INSERT INTO kq SELECT 2, 'Trả trước cho NCC +80.000 (C: hàng trả vượt nợ) — bản cũ kẹp mất', d_tt = 80000, 'Δ trả trước ' || d_tt
  FROM ch WHERE moc = 'sau_nhap';
INSERT INTO kq SELECT 3, 'Bản cũ (kẹp từng dòng) ra phải trả +500.000 và không có trả trước — lệch bản mới 80.000 + 80.000',
       cu.v = 500000 AND cu.v - ch.d_ap = 80000, 'bản cũ = ' || cu.v || ' · bản mới = ' || ch.d_ap
  FROM ch, cu WHERE ch.moc = 'sau_nhap';
INSERT INTO kq SELECT 4, 'Tiền / phải thu / tồn kho / chi phí chưa trả không đổi khi chỉ thêm dòng nợ', d_cash = 0 AND d_ar = 0 AND d_inv = 0 AND d_unpaid = 0,
       concat_ws(' · ', d_cash, d_ar, d_inv, d_unpaid)
  FROM ch WHERE moc = 'sau_nhap';
INSERT INTO kq SELECT 5, 'Phiếu chi trả NCC E 150.000: tiền −150.000, phải trả −100.000, trả trước +50.000',
       s.d_cash - n.d_cash = -150000 AND s.d_ap - n.d_ap = -100000 AND s.d_tt - n.d_tt = 50000,
       concat_ws(' · ', s.d_cash - n.d_cash, s.d_ap - n.d_ap, s.d_tt - n.d_tt)
  FROM ch s, ch n WHERE s.moc = 'sau_chi' AND n.moc = 'sau_nhap';
INSERT INTO kq SELECT 6, 'Chi trả NCC (kể cả trả dư) không làm đổi vốn chủ (phần chênh)', s.d_von = n.d_von,
       'vốn chủ trước chi ' || n.d_von || ' · sau chi ' || s.d_von
  FROM ch s, ch n WHERE s.moc = 'sau_chi' AND n.moc = 'sau_nhap';
INSERT INTO kq SELECT 7, 'Khớp màn Công nợ theo NCC: phải trả − trả trước = Σ còn lại (payables_by_supplier), ở cả 3 mốc',
       bool_and(ap - tt = con_lai_ncc), string_agg(moc || ' ' || (ap - tt) || '=' || con_lai_ncc, ' · ' ORDER BY moc)
  FROM bs;
INSERT INTO kq SELECT 8, 'Hàm trả cột supplier_prepayments; anon không gọi được, authenticated gọi được',
       position('supplier_prepayments' IN pg_get_function_result('public.finance_balance_sheet(date)'::regprocedure)) > 0
       AND NOT has_function_privilege('anon', 'public.finance_balance_sheet(date)', 'EXECUTE')
       AND has_function_privilege('authenticated', 'public.finance_balance_sheet(date)', 'EXECUTE'), '';

-- Bước nào không ra dòng (chụp thiếu mốc…) là im lặng mất — đếm cho đủ.
INSERT INTO kq SELECT 99, 'Đủ 8 bước kiểm', count(*) = 8, count(*) || ' bước' FROM kq;
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS loi FROM kq;
ROLLBACK;
