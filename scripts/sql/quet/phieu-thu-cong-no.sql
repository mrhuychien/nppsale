-- ====================================================================
-- QUÉT NGHIỆP VỤ: PHIẾU THU ↔ CÔNG NỢ (nợ đầu kỳ, dư có / công nợ âm,
-- payments, huỷ / lập lại hóa đơn — mig 184, 186, 191).
--
-- Chạy trên BẢN SAO DB thử (KHÔNG chạy trên DB thật — mỗi kịch bản
-- BEGIN … ROLLBACK nhưng vẫn đụng dữ liệu thật trong giao dịch):
--   psql -d q_thu -f scripts/sql/quet/phieu-thu-cong-no.sql 2>&1 | grep -E 'OK |LỖI|CHẶN'
-- Mỗi kịch bản in NOTICE 'OK …' / 'LỖI …' / 'CHẶN …' (chặn đúng thiết kế).
-- Dữ liệu mẫu: khách d…06 có HD-0001..0003 (1.100.000 mỗi tờ, đã ghi sổ).
--
-- Bất biến kiểm sau mỗi bước (pg_temp.bat_bien):
--  INV1 receivables.paid = Σ payments.amount của khoản đó
--  INV2 dòng dương: 'paid' ⇔ amount − paid ≤ 0; dòng âm: 'paid' ⇔ dùng hết
--  INV3 nợ ròng Σ(amount−paid) = Σ HĐ posted − hàng trả được tính + đầu kỳ − tiền thật đã thu
--  INV3app nợ theo loadCustomerDebt (status <> 'paid') = nợ ròng
--  INV4 cash_receipts.submitted_amount = Σ dòng kind='payment' (phiếu chưa huỷ)
--  INV5 không dòng phiếu thu còn hiệu lực trỏ HĐ đã huỷ / mất khoản nợ / mất payment
-- ====================================================================
\set ON_ERROR_STOP off
\set VERBOSITY terse
SET client_min_messages = notice;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p int) RETURNS void AS $f$
BEGIN PERFORM set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-00000000000' || p, false); END
$f$ LANGUAGE plpgsql;

-- Nợ theo đúng công thức loadCustomerDebt / loadDebtByCustomer
CREATE OR REPLACE FUNCTION pg_temp.no_app(c uuid) RETURNS numeric AS $f$
  SELECT COALESCE(sum(amount - COALESCE(paid,0)),0) FROM receivables WHERE customer_id = c AND status <> 'paid';
$f$ LANGUAGE sql;
-- Nợ ròng mọi dòng
CREATE OR REPLACE FUNCTION pg_temp.no_rong(c uuid) RETURNS numeric AS $f$
  SELECT COALESCE(sum(amount - COALESCE(paid,0)),0) FROM receivables WHERE customer_id = c;
$f$ LANGUAGE sql;
-- Nợ kỳ vọng tính độc lập từ chứng từ
CREATE OR REPLACE FUNCTION pg_temp.no_ky_vong(c uuid) RETURNS numeric AS $f$
  SELECT
    (SELECT COALESCE(sum(total),0) FROM sales_invoices WHERE customer_id = c AND status = 'posted')
  - (SELECT COALESCE(sum(COALESCE(credit_note_amount,0)),0) FROM returns r WHERE r.customer_id = c AND (
        (r.invoice_id IS NOT NULL AND EXISTS (SELECT 1 FROM sales_invoices s WHERE s.id=r.invoice_id AND s.status='posted')
          AND ((r.credit_with_invoice AND r.status IN ('submitted','completed')) OR (NOT r.credit_with_invoice AND r.status='completed')))
     OR (r.invoice_id IS NULL AND r.order_id IS NULL AND r.status = 'completed')))
  + (SELECT COALESCE(sum(amount),0) FROM receivables WHERE customer_id = c AND opening_balance)
  - (SELECT COALESCE(sum(l.amount),0) FROM cash_receipt_lines l JOIN cash_receipts cr ON cr.id=l.receipt_id
      WHERE cr.status <> 'voided' AND l.kind = 'payment'
        AND EXISTS (SELECT 1 FROM receivables rc WHERE rc.id = l.receivable_id AND rc.customer_id = c));
$f$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION pg_temp.bat_bien(c uuid) RETURNS text AS $f$
DECLARE s text := ''; x record;
BEGIN
  FOR x IN SELECT r.id, r.paid, COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.receivable_id=r.id),0) sp
           FROM receivables r WHERE r.customer_id=c LOOP
    IF abs(COALESCE(x.paid,0) - x.sp) > 0.001 THEN s := s || format(' INV1[%s paid=%s Σpay=%s]', left(x.id::text,8), x.paid, x.sp); END IF;
  END LOOP;
  FOR x IN SELECT id, amount, paid, status FROM receivables WHERE customer_id=c LOOP
    -- (mig 212) dòng dương: 'paid' ⇔ |amount − paid| < 0,01; trả dư là 'open' (dư có).
    IF x.amount >= 0 AND ((abs(x.amount - COALESCE(x.paid,0)) < 0.01) <> (x.status='paid')) THEN
      s := s || format(' INV2[%s amt=%s paid=%s st=%s]', left(x.id::text,8), x.amount, x.paid, x.status); END IF;
    IF x.amount >= 0 AND x.status = 'partial' AND COALESCE(x.paid,0) <= 0 THEN
      s := s || format(' INV2b[%s partial mà paid=%s]', left(x.id::text,8), x.paid); END IF;
    IF x.amount < 0 AND ((abs(COALESCE(x.paid,0)-x.amount) < 0.01) <> (x.status='paid')) THEN
      s := s || format(' INV2neg[%s amt=%s paid=%s st=%s]', left(x.id::text,8), x.amount, x.paid, x.status); END IF;
  END LOOP;
  IF abs(pg_temp.no_rong(c) - pg_temp.no_ky_vong(c)) > 0.001 THEN
    s := s || format(' INV3[rong=%s kyvong=%s]', pg_temp.no_rong(c), pg_temp.no_ky_vong(c)); END IF;
  IF abs(pg_temp.no_app(c) - pg_temp.no_rong(c)) > 0.001 THEN
    s := s || format(' INV3app[app=%s rong=%s]', pg_temp.no_app(c), pg_temp.no_rong(c)); END IF;
  FOR x IN SELECT cr.id, cr.submitted_amount,
                  COALESCE((SELECT sum(l.amount) FROM cash_receipt_lines l WHERE l.receipt_id=cr.id AND l.kind='payment'),0) sl
           FROM cash_receipts cr
           WHERE cr.status <> 'voided'
             AND EXISTS (SELECT 1 FROM cash_receipt_lines l JOIN receivables rc ON rc.id=l.receivable_id
                         WHERE l.receipt_id=cr.id AND rc.customer_id=c) LOOP
    IF abs(x.submitted_amount - x.sl) > 0.001 THEN s := s || format(' INV4[%s sub=%s Σline=%s]', left(x.id::text,8), x.submitted_amount, x.sl); END IF;
  END LOOP;
  FOR x IN SELECT l.receipt_id, l.amount, l.kind, (SELECT p.amount FROM payments p WHERE p.id=l.payment_id) pa
           FROM cash_receipt_lines l JOIN cash_receipts cr ON cr.id=l.receipt_id
           WHERE cr.status <> 'voided' AND l.payment_id IS NOT NULL LOOP
    IF abs(x.amount - COALESCE(x.pa, 0)) > 0.001 THEN s := s || format(' INV4b[dòng %s %s ≠ payment %s]', x.kind, x.amount, x.pa); END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM cash_receipt_lines l JOIN cash_receipts cr ON cr.id=l.receipt_id JOIN sales_invoices si ON si.id=l.invoice_id
             WHERE cr.status<>'voided' AND si.status='cancelled') THEN s := s || ' INV5[dòng phiếu thu sống trỏ HĐ huỷ]'; END IF;
  IF EXISTS (SELECT 1 FROM cash_receipt_lines l JOIN cash_receipts cr ON cr.id=l.receipt_id
             WHERE cr.status<>'voided' AND (l.receivable_id IS NULL OR l.payment_id IS NULL)) THEN
    s := s || ' INV5b[dòng phiếu thu sống mất receivable/payment]'; END IF;
  IF EXISTS (SELECT 1 FROM payments p JOIN receivables r ON r.id=p.receivable_id JOIN sales_invoices si ON si.id=r.invoice_id
             WHERE si.status='cancelled') THEN s := s || ' INV5c[payment trên công nợ HĐ huỷ]'; END IF;
  RETURN s;
END $f$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.kq(ten text, ok boolean, chi_tiet text) RETURNS void AS $f$
BEGIN
  IF ok THEN RAISE NOTICE 'OK   %: %', ten, chi_tiet; ELSE RAISE NOTICE 'LỖI %: %', ten, chi_tiet; END IF;
END $f$ LANGUAGE plpgsql;
-- Mong đợi bị chặn với mã lỗi cho trước
CREATE OR REPLACE FUNCTION pg_temp.chan(ten text, sql text, ma text) RETURNS void AS $f$
BEGIN
  BEGIN
    EXECUTE sql;
    RAISE NOTICE 'LỖI %: KHÔNG bị chặn (mong %)', ten, ma;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE ma || '%' OR SQLERRM LIKE '%' || ma || '%' THEN RAISE NOTICE 'CHẶN %: % (đúng thiết kế)', ten, left(SQLERRM, 90);
    ELSE RAISE NOTICE 'LỖI %: chặn sai mã: % (mong %)', ten, left(SQLERRM, 120), ma; END IF;
  END;
END $f$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.rc(code text) RETURNS uuid AS $f$
  SELECT r.id FROM receivables r JOIN sales_invoices s ON s.id=r.invoice_id WHERE s.invoice_code=code AND s.status='posted';
$f$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.hd(code text) RETURNS uuid AS $f$
  SELECT id FROM sales_invoices WHERE invoice_code=code;
$f$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.ln(r uuid, a numeric) RETURNS jsonb AS $f$ SELECT jsonb_build_object('receivable_id', r, 'amount', a) $f$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.thu(c uuid, lines jsonb, extra jsonb DEFAULT '{}') RETURNS uuid AS $f$
  SELECT create_cash_receipt(jsonb_build_object('customer_id', c, 'lines', lines) || extra);
$f$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.r(id uuid) RETURNS text AS $f$
  SELECT format('amt=%s paid=%s st=%s', amount, paid, status) FROM receivables WHERE receivables.id = r.id;
$f$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.dong(p_inv uuid, k numeric DEFAULT 1) RETURNS jsonb AS $d$
  SELECT jsonb_agg(jsonb_build_object('order_line_id', order_line_id, 'product_id', product_id,
           'unit_name', unit_name, 'conversion_factor', conversion_factor, 'quantity', quantity*k,
           'unit_price', unit_price, 'is_exchange', is_exchange))
  FROM sales_invoice_lines WHERE invoice_id = p_inv
$d$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.lap_lai(code text, k numeric DEFAULT 1) RETURNS uuid AS $f$
DECLARE v uuid;
BEGIN
  UPDATE batches SET qty_on_hand = qty_on_hand + 10000 WHERE warehouse_zone = 'sale';
  SELECT x.invoice_id INTO v FROM reissue_invoice(pg_temp.hd(code),
    jsonb_build_object('lines', pg_temp.dong(pg_temp.hd(code), k), 'allow_oversell', true)) x;
  RETURN v;
END $f$ LANGUAGE plpgsql;
-- Phiếu trả tự lập (không đơn). p_hd NULL = độc lập → công nợ âm; có p_hd = gắn HĐ → trừ vào HĐ.
CREATE OR REPLACE FUNCTION pg_temp.tra(c uuid, tien numeric, p_hd uuid DEFAULT NULL) RETURNS uuid AS $f$
DECLARE v uuid;
BEGIN
  v := create_return_with_lines(jsonb_build_object('customer_id', c, 'reason', 'damaged', 'status', 'draft',
         'invoice_id', COALESCE(p_hd::text, '')),
        jsonb_build_array(jsonb_build_object('product_id','c0000000-0000-0000-0000-000000000001','unit_name','lon',
          'quantity', 1, 'unit_price', tien, 'line_total', tien)));
  UPDATE returns SET credit_note_amount = tien WHERE id = v;
  PERFORM complete_return(v, 'sale');
  RETURN v;
END $f$ LANGUAGE plpgsql;
-- Nợ đầu kỳ như màn nhập Excel (ghi thẳng bảng receivables)
CREATE OR REPLACE FUNCTION pg_temp.dau_ky(c uuid, tien numeric, han date DEFAULT '2026-01-01') RETURNS uuid AS $f$
  INSERT INTO receivables (org_id, customer_id, amount, paid, due_date, status, opening_balance, note)
  VALUES ('a0000000-0000-0000-0000-000000000001', c, tien, 0, han, 'open', true, 'Nợ đầu kỳ thử')
  RETURNING id;
$f$ LANGUAGE sql;

SELECT pg_temp.as_user(1);
\echo ===== BẮT ĐẦU QUÉT PHIẾU THU ↔ CÔNG NỢ =====

-- ------------------------------------------------------------------
-- T00 Mốc: dữ liệu mẫu tự khớp
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; b text;
BEGIN
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T00 mốc', b = '' AND pg_temp.no_app(c) = 3300000, format('nợ=%s %s', pg_temp.no_app(c), b));
END $s$;
ROLLBACK;

-- T01 Thu đủ một hóa đơn
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; r1 uuid := pg_temp.rc('HD-0001'); p uuid; b text;
BEGIN
  p := pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 1100000)));
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T01 thu đủ HD-0001',
    b = '' AND pg_temp.no_app(c) = 2200000 AND (SELECT status FROM receivables WHERE id=r1)='paid'
      AND (SELECT submitted_amount FROM cash_receipts WHERE id=p) = 1100000,
    format('R1 %s; nợ %s; %s', pg_temp.r(r1), pg_temp.no_app(c), b));
END $s$;
ROLLBACK;

-- T02 Thu một phần
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; r1 uuid := pg_temp.rc('HD-0001'); b text;
BEGIN
  PERFORM pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 300000)));
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T02 thu 300k', b = '' AND pg_temp.no_app(c) = 3000000
      AND (SELECT status FROM receivables WHERE id=r1)='partial', format('R1 %s; nợ %s; %s', pg_temp.r(r1), pg_temp.no_app(c), b));
END $s$;
ROLLBACK;

-- T03 Một phiếu thu nhiều hóa đơn
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; p uuid; b text;
  r1 uuid := pg_temp.rc('HD-0001'); r2 uuid := pg_temp.rc('HD-0002'); r3 uuid := pg_temp.rc('HD-0003');
BEGIN
  p := pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 500000), pg_temp.ln(r2, 1100000), pg_temp.ln(r3, 200000)), '{"method":"transfer"}');
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T03 1 phiếu 3 HĐ', b = '' AND pg_temp.no_app(c) = 1500000
      AND (SELECT submitted_amount FROM cash_receipts WHERE id=p) = 1800000
      AND (SELECT count(*) FROM cash_receipt_lines WHERE receipt_id=p) = 3
      AND (SELECT count(DISTINCT invoice_id) FROM cash_receipt_lines WHERE receipt_id=p) = 3,
    format('R1 %s | R2 %s | R3 %s; nợ %s; %s', pg_temp.r(r1), pg_temp.r(r2), pg_temp.r(r3), pg_temp.no_app(c), b));
END $s$;
ROLLBACK;

-- T04 Thu vượt số còn nợ; T05 cùng khoản nợ hai dòng cộng vượt; T31 phiếu 0đ / rỗng
BEGIN;
SELECT pg_temp.chan('T04 thu vượt 1.200.000/1.100.000',
  format('SELECT pg_temp.thu(%L, %L)', 'd0000000-0000-0000-0000-000000000006',
         jsonb_build_array(pg_temp.ln(pg_temp.rc('HD-0001'), 1200000))), 'BAD_RECEIVABLE_LINE');
SELECT pg_temp.chan('T05 hai dòng 600k cùng HD-0001',
  format('SELECT pg_temp.thu(%L, %L)', 'd0000000-0000-0000-0000-000000000006',
         jsonb_build_array(pg_temp.ln(pg_temp.rc('HD-0001'), 600000), pg_temp.ln(pg_temp.rc('HD-0001'), 600000))), 'BAD_RECEIVABLE_LINE');
SELECT pg_temp.chan('T31a phiếu 0đ',
  format('SELECT pg_temp.thu(%L, %L)', 'd0000000-0000-0000-0000-000000000006',
         jsonb_build_array(pg_temp.ln(pg_temp.rc('HD-0001'), 0))), 'EMPTY_RECEIPT');
SELECT pg_temp.chan('T31b phiếu không dòng',
  format('SELECT pg_temp.thu(%L, %L)', 'd0000000-0000-0000-0000-000000000006', '[]'), 'EMPTY_RECEIPT');
SELECT pg_temp.chan('T31c thiếu khách', $q$SELECT create_cash_receipt('{"lines":[]}')$q$, 'CUSTOMER_REQUIRED');
ROLLBACK;

-- T06 Nợ đầu kỳ: thu một phần rồi đủ
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; ob uuid; b text; p1 uuid;
BEGIN
  ob := pg_temp.dau_ky(c, 500000);
  PERFORM pg_temp.kq('T06a nợ đầu kỳ vào tổng nợ', pg_temp.no_app(c) = 3800000 AND pg_temp.bat_bien(c) = '', format('nợ %s', pg_temp.no_app(c)));
  p1 := pg_temp.thu(c, jsonb_build_array(pg_temp.ln(ob, 200000)));
  PERFORM pg_temp.thu(c, jsonb_build_array(pg_temp.ln(ob, 300000)));
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T06b thu đầu kỳ 200k+300k', b = '' AND pg_temp.no_app(c) = 3300000
     AND (SELECT status FROM receivables WHERE id=ob)='paid', format('OB %s; nợ %s; %s', pg_temp.r(ob), pg_temp.no_app(c), b));
  PERFORM void_cash_receipt(p1, 'thử');
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T06c huỷ phiếu 200k của đầu kỳ', b = '' AND (SELECT paid FROM receivables WHERE id=ob) = 300000
     AND (SELECT status FROM receivables WHERE id=ob)='partial', format('OB %s; %s', pg_temp.r(ob), b));
END $s$;
ROLLBACK;

-- T07 Thứ tự phân bổ dư có: hạn cũ nhất trước
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; ob uuid; neg uuid; p uuid; b text; r1 uuid := pg_temp.rc('HD-0001');
  ob_cr numeric; r1_cr numeric;
BEGIN
  ob := pg_temp.dau_ky(c, 500000, '2026-01-01');
  PERFORM pg_temp.tra(c, 200000);
  SELECT id INTO neg FROM receivables WHERE customer_id=c AND return_id IS NOT NULL;
  p := pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 1100000), pg_temp.ln(ob, 500000)), '{"use_credit":200000}');
  SELECT COALESCE(sum(amount) FILTER (WHERE receivable_id=ob),0), COALESCE(sum(amount) FILTER (WHERE receivable_id=r1),0)
    INTO ob_cr, r1_cr FROM cash_receipt_lines WHERE receipt_id=p AND kind='credit_applied' AND amount>0;
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T07 dư có đắp vào khoản hạn cũ nhất (đầu kỳ)', b = '' AND ob_cr = 200000 AND r1_cr = 0
     AND (SELECT submitted_amount FROM cash_receipts WHERE id=p) = 1400000 AND pg_temp.no_app(c) = 2200000,
     format('đắp OB=%s R1=%s; tiền thật=%s; NEG %s; nợ %s; %s', ob_cr, r1_cr,
            (SELECT submitted_amount FROM cash_receipts WHERE id=p), pg_temp.r(neg), pg_temp.no_app(c), b));
END $s$;
ROLLBACK;

-- T08 Huỷ phiếu thu → trả nguyên; huỷ lần hai; T10 thiếu lý do
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; r1 uuid := pg_temp.rc('HD-0001'); p uuid; b text;
BEGIN
  p := pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 1100000)));
  PERFORM pg_temp.chan('T10 huỷ không lý do', format('SELECT void_cash_receipt(%L, %L)', p, '  '), 'REASON_REQUIRED');
  PERFORM void_cash_receipt(p, 'thu nhầm');
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T08a huỷ phiếu thu đủ', b = '' AND pg_temp.no_app(c) = 3300000
     AND (SELECT status FROM receivables WHERE id=r1)='open' AND NOT EXISTS (SELECT 1 FROM payments WHERE receivable_id=r1),
     format('R1 %s; nợ %s; %s', pg_temp.r(r1), pg_temp.no_app(c), b));
  PERFORM pg_temp.chan('T08b huỷ lần hai', format('SELECT void_cash_receipt(%L, %L)', p, 'lại'), 'RECEIPT_NOT_VOIDABLE');
END $s$;
ROLLBACK;

-- T09 Hai phiếu thu cùng HĐ, huỷ phiếu đầu
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; r1 uuid := pg_temp.rc('HD-0001'); p1 uuid; b text;
BEGIN
  p1 := pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 300000)));
  PERFORM pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 500000)));
  PERFORM void_cash_receipt(p1, 'thử');
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T09 huỷ 1 trong 2 phiếu', b = '' AND (SELECT paid FROM receivables WHERE id=r1) = 500000
     AND (SELECT status FROM receivables WHERE id=r1)='partial', format('R1 %s; %s', pg_temp.r(r1), b));
END $s$;
ROLLBACK;

-- T11 Huỷ HĐ có tiền thu → khoá; huỷ phiếu thu rồi huỷ HĐ
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; r1 uuid := pg_temp.rc('HD-0001'); p uuid; b text;
BEGIN
  p := pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 400000)));
  PERFORM pg_temp.chan('T11a huỷ HĐ đã thu', format('SELECT cancel_invoice(%L, %L)', pg_temp.hd('HD-0001'), 'thử'), 'LOCKED_HAS_PAYMENT');
  PERFORM void_cash_receipt(p, 'thử');
  PERFORM cancel_invoice(pg_temp.hd('HD-0001'), 'thử');
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T11b huỷ phiếu thu rồi huỷ HĐ', b = '' AND pg_temp.no_app(c) = 2200000
     AND NOT EXISTS (SELECT 1 FROM receivables WHERE id = r1), format('nợ %s; %s', pg_temp.no_app(c), b));
END $s$;
ROLLBACK;

-- T12 Lập lại HĐ đã thu một phần (cùng dòng) → tiền đi theo; huỷ phiếu thu sau khi lập lại
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; r1 uuid := pg_temp.rc('HD-0001'); p uuid; b text;
  hd2 uuid; rn uuid; no_truoc numeric;
BEGIN
  p := pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 400000)));
  hd2 := pg_temp.lap_lai('HD-0001', 1);
  SELECT id INTO rn FROM receivables WHERE invoice_id = hd2;
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T12a lập lại: tiền thu sang tờ mới', b = '' AND (SELECT paid FROM receivables WHERE id=rn) = 400000
     AND (SELECT count(*) FROM cash_receipt_lines WHERE receipt_id=p AND invoice_id=hd2 AND receivable_id=rn) = 1,
     format('mới %s (tổng HĐ %s); nợ app %s; %s', pg_temp.r(rn), (SELECT total FROM sales_invoices WHERE id=hd2), pg_temp.no_app(c), b));
  no_truoc := pg_temp.no_app(c);
  PERFORM void_cash_receipt(p, 'thử sau lập lại');
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T12b huỷ phiếu thu sau lập lại', b = '' AND (SELECT paid FROM receivables WHERE id=rn) = 0
     AND pg_temp.no_app(c) = no_truoc + 400000, format('mới %s; nợ %s→%s; %s', pg_temp.r(rn), no_truoc, pg_temp.no_app(c), b));
END $s$;
ROLLBACK;

-- T13 Lập lại HĐ có một phiếu đã huỷ + một phiếu sống
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; r1 uuid := pg_temp.rc('HD-0001'); p1 uuid; p2 uuid; b text; hd2 uuid; rn uuid;
BEGIN
  p1 := pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 100000)));
  PERFORM void_cash_receipt(p1, 'thử');
  p2 := pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 250000)));
  hd2 := pg_temp.lap_lai('HD-0001', 1);
  SELECT id INTO rn FROM receivables WHERE invoice_id = hd2;
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T13 lập lại có phiếu huỷ + phiếu sống', b = '' AND (SELECT paid FROM receivables WHERE id=rn) = 250000
     AND (SELECT receivable_id FROM cash_receipt_lines WHERE receipt_id=p1) IS NULL
     AND (SELECT invoice_id FROM cash_receipt_lines WHERE receipt_id=p1) = hd2,
     format('mới %s; %s', pg_temp.r(rn), b));
END $s$;
ROLLBACK;

-- T14 Lập lại HĐ nhỏ hơn số đã thu → dư có; tổng nợ app có trừ phần dư?
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; r1 uuid := pg_temp.rc('HD-0001'); b text; hd2 uuid; rn uuid;
BEGIN
  PERFORM pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 1100000)));
  hd2 := pg_temp.lap_lai('HD-0001', 0.5);
  SELECT id INTO rn FROM receivables WHERE invoice_id = hd2;
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T14 lập lại nhỏ hơn đã thu', b = '',
     format('mới %s; nợ app(loadCustomerDebt)=%s, nợ ròng=%s, kỳ vọng=%s; %s', pg_temp.r(rn),
            pg_temp.no_app(c), pg_temp.no_rong(c), pg_temp.no_ky_vong(c), b));
END $s$;
ROLLBACK;

-- T15 T14 + rút dư có sang HD-0002 + huỷ phiếu thu gốc → dư có đã tiêu bị "mất"?
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; r1 uuid := pg_temp.rc('HD-0001'); r2 uuid := pg_temp.rc('HD-0002');
  p1 uuid; p2 uuid; b text; hd2 uuid; rn uuid; du numeric;
BEGIN
  p1 := pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 1100000)));
  hd2 := pg_temp.lap_lai('HD-0001', 0.5);
  SELECT id, paid - amount INTO rn, du FROM receivables WHERE invoice_id = hd2;
  p2 := pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r2, du)), jsonb_build_object('use_credit', du));
  PERFORM void_cash_receipt(p1, 'thu nhầm');
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T15 huỷ phiếu thu có dư đã tiêu', b = '',
     format('dư có rút=%s; mới %s; R2 %s; nợ app=%s, kỳ vọng=%s; %s', du, pg_temp.r(rn), pg_temp.r(r2),
            pg_temp.no_app(c), pg_temp.no_ky_vong(c), b));
END $s$;
ROLLBACK;

-- T16 Đường thường gặp của T14/T15: thu đủ HD-0001 → phiếu trả tự lập GẮN HĐ 200k → dư 200k
--     → rút sang HD-0002 → huỷ phiếu thu gốc
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; r1 uuid := pg_temp.rc('HD-0001'); r2 uuid := pg_temp.rc('HD-0002');
  p1 uuid; b text;
BEGIN
  p1 := pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 1100000)));
  PERFORM pg_temp.tra(c, 200000, pg_temp.hd('HD-0001'));
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T16a trả hàng gắn HĐ sau khi thu đủ: dư có hiện trong tổng nợ', b = '',
     format('R1 %s; nợ app=%s, ròng=%s, kỳ vọng=%s; %s', pg_temp.r(r1), pg_temp.no_app(c), pg_temp.no_rong(c), pg_temp.no_ky_vong(c), b));
  PERFORM pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r2, 200000)), '{"use_credit":200000}');
  PERFORM void_cash_receipt(p1, 'thu nhầm');
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T16b rút dư 200k rồi huỷ phiếu thu gốc', b = '',
     format('R1 %s; R2 %s; nợ app=%s, kỳ vọng=%s; %s', pg_temp.r(r1), pg_temp.r(r2), pg_temp.no_app(c), pg_temp.no_ky_vong(c), b));
END $s$;
ROLLBACK;

-- T17-T20 Công nợ âm (phiếu trả độc lập)
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; r1 uuid := pg_temp.rc('HD-0001'); ret uuid; neg uuid; p uuid; b text;
BEGIN
  ret := pg_temp.tra(c, 200000);
  SELECT id INTO neg FROM receivables WHERE return_id = ret;
  PERFORM pg_temp.kq('T17a phiếu trả độc lập → dòng âm open', pg_temp.bat_bien(c) = ''
     AND (SELECT amount FROM receivables WHERE id=neg) = -200000 AND (SELECT status FROM receivables WHERE id=neg) = 'open'
     AND pg_temp.no_app(c) = 3100000, format('NEG %s; nợ %s', pg_temp.r(neg), pg_temp.no_app(c)));
  p := pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 500000)), '{"use_credit":200000}');
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T17b thu 500k dùng dư có 200k', b = '' AND (SELECT submitted_amount FROM cash_receipts WHERE id=p) = 300000
     AND (SELECT status FROM receivables WHERE id=neg) = 'paid' AND pg_temp.no_app(c) = 2800000,
     format('NEG %s; R1 %s; tiền thật %s; nợ %s; %s', pg_temp.r(neg), pg_temp.r(r1), (SELECT submitted_amount FROM cash_receipts WHERE id=p), pg_temp.no_app(c), b));
  PERFORM void_cash_receipt(p, 'thử');
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T19 huỷ phiếu thu có dùng dư có', b = '' AND (SELECT paid FROM receivables WHERE id=neg) = 0
     AND (SELECT status FROM receivables WHERE id=neg) = 'open' AND pg_temp.no_app(c) = 3100000,
     format('NEG %s; R1 %s; nợ %s; %s', pg_temp.r(neg), pg_temp.r(r1), pg_temp.no_app(c), b));
END $s$;
ROLLBACK;

BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; r1 uuid := pg_temp.rc('HD-0001'); ret uuid; neg uuid; b text;
BEGIN
  ret := pg_temp.tra(c, 200000);
  SELECT id INTO neg FROM receivables WHERE return_id = ret;
  PERFORM pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 50000)), '{"use_credit":50000}');
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T18 dùng một phần dư có 50k/200k', b = '' AND (SELECT status FROM receivables WHERE id=neg) = 'open'
     AND (SELECT amount - paid FROM receivables WHERE id=neg) = -150000 AND pg_temp.no_app(c) = 3100000,
     format('NEG %s; nợ %s; %s', pg_temp.r(neg), pg_temp.no_app(c), b));
  PERFORM pg_temp.chan('T21 dùng dư có vượt số dư (200k > 150k)',
     format('SELECT pg_temp.thu(%L, %L, %L)', c, jsonb_build_array(pg_temp.ln(pg_temp.rc('HD-0002'), 200000)), '{"use_credit":200000}'),
     'CREDIT_BALANCE_TOO_LOW');
  PERFORM pg_temp.chan('T21b dùng dư có vượt phần phải trả (100k > 50k chọn)',
     format('SELECT pg_temp.thu(%L, %L, %L)', c, jsonb_build_array(pg_temp.ln(pg_temp.rc('HD-0002'), 50000)), '{"use_credit":100000}'),
     'CREDIT_EXCEEDS_SELECTED');
  PERFORM pg_temp.chan('T22 cấn phiếu trả độc lập kiểu cũ (credits)',
     format('SELECT pg_temp.thu(%L, %L, %L)', c, jsonb_build_array(pg_temp.ln(pg_temp.rc('HD-0002'), 500000)),
            jsonb_build_object('credits', jsonb_build_array(jsonb_build_object('return_id', ret)))), 'BAD_CREDIT');
END $s$;
ROLLBACK;

-- T20 Huỷ phiếu trả sau khi dư có đã dùng → nợ tăng lại; rồi huỷ phiếu thu
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; r1 uuid := pg_temp.rc('HD-0001'); ret uuid; neg uuid; p uuid; b text;
BEGIN
  ret := pg_temp.tra(c, 200000);
  SELECT id INTO neg FROM receivables WHERE return_id = ret;
  p := pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 500000)), '{"use_credit":200000}');
  PERFORM cancel_return(ret, 'thử');
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T20a huỷ phiếu trả sau khi dùng dư có', b = '' AND pg_temp.no_app(c) = 3000000
     AND (SELECT status FROM receivables WHERE id=neg) <> 'paid',
     format('NEG %s; nợ %s (mong 3.000.000); %s', pg_temp.r(neg), pg_temp.no_app(c), b));
  PERFORM void_cash_receipt(p, 'thử');
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T20b rồi huỷ phiếu thu', b = '' AND pg_temp.no_app(c) = 3300000,
     format('NEG %s; R1 %s; nợ %s; %s', pg_temp.r(neg), pg_temp.r(r1), pg_temp.no_app(c), b));
END $s$;
ROLLBACK;

-- T23 Dòng số tiền ÂM trên khoản nợ dương (gửi thẳng RPC)
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; r1 uuid := pg_temp.rc('HD-0001'); r2 uuid := pg_temp.rc('HD-0002'); p uuid; b text;
BEGIN
  PERFORM pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r2, 1100000)));
  BEGIN
    p := pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 1100000), pg_temp.ln(r2, -500000)));
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'CHẶN T23 dòng âm: % (đúng thiết kế)', left(SQLERRM, 90); RETURN;
  END;
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T23 dòng âm -500k trên HD-0002 đã thu đủ', b = '',
     format('RPC NHẬN: tiền thật %s; R1 %s; R2 %s; nợ app %s, kỳ vọng %s; %s', (SELECT submitted_amount FROM cash_receipts WHERE id=p),
            pg_temp.r(r1), pg_temp.r(r2), pg_temp.no_app(c), pg_temp.no_ky_vong(c), b));
END $s$;
ROLLBACK;

-- T24 Dòng thu trên chính dòng công nợ ÂM (gửi thẳng RPC) rồi huỷ phiếu
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; r1 uuid := pg_temp.rc('HD-0001'); neg uuid; p uuid; b text;
BEGIN
  PERFORM pg_temp.tra(c, 200000);
  SELECT id INTO neg FROM receivables WHERE customer_id=c AND return_id IS NOT NULL;
  BEGIN
    p := pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 1100000), pg_temp.ln(neg, -200000)));
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'CHẶN T24 dòng trên công nợ âm: % (đúng thiết kế)', left(SQLERRM, 90); RETURN;
  END;
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T24a thu dòng -200k trên công nợ âm', b = '',
     format('RPC NHẬN: tiền thật %s; NEG %s; R1 %s; %s', (SELECT submitted_amount FROM cash_receipts WHERE id=p), pg_temp.r(neg), pg_temp.r(r1), b));
  PERFORM void_cash_receipt(p, 'thử');
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T24b huỷ phiếu đó', b = '' AND pg_temp.no_app(c) = 3100000,
     format('NEG %s; R1 %s; nợ app %s (mong 3.100.000); %s', pg_temp.r(neg), pg_temp.r(r1), pg_temp.no_app(c), b));
END $s$;
ROLLBACK;

-- T25 Dòng 0đ kèm dòng thật
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; r1 uuid := pg_temp.rc('HD-0001'); r2 uuid := pg_temp.rc('HD-0002'); b text;
BEGIN
  BEGIN
    PERFORM pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 100000), pg_temp.ln(r2, 0)));
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'CHẶN T25: % (mig 212)', left(SQLERRM, 90); RETURN;
  END;
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T25 dòng 0đ trên HD-0002', b = '', format('R2 %s; %s', pg_temp.r(r2), b));
END $s$;
ROLLBACK;

-- T26 Quyền theo vai trò
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; r1 uuid := pg_temp.rc('HD-0001'); p uuid; b text;
BEGIN
  PERFORM pg_temp.as_user(4);
  PERFORM pg_temp.chan('T26a NVBH lập phiếu thu', format('SELECT pg_temp.thu(%L, %L)', c, jsonb_build_array(pg_temp.ln(r1, 1000))), 'FORBIDDEN');
  PERFORM pg_temp.as_user(5);
  PERFORM pg_temp.chan('T26b thủ kho lập phiếu thu', format('SELECT pg_temp.thu(%L, %L)', c, jsonb_build_array(pg_temp.ln(r1, 1000))), 'FORBIDDEN');
  PERFORM pg_temp.as_user(3);
  p := pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 1000)));
  PERFORM pg_temp.kq('T26c kế toán lập phiếu thu', p IS NOT NULL AND pg_temp.bat_bien(c) = '', 'collected_by=' || (SELECT collected_by FROM cash_receipts WHERE id=p));
  PERFORM pg_temp.as_user(4);
  PERFORM pg_temp.chan('T26d NVBH huỷ phiếu thu', format('SELECT void_cash_receipt(%L, %L)', p, 'x'), 'FORBIDDEN');
  PERFORM pg_temp.as_user(3);
  PERFORM void_cash_receipt(p, 'kế toán huỷ');
  PERFORM pg_temp.kq('T26e kế toán huỷ phiếu thu', pg_temp.bat_bien(c) = '' AND pg_temp.no_app(c) = 3300000, pg_temp.r(r1));
  PERFORM pg_temp.as_user(1);
END $s$;
ROLLBACK;

-- T27 Khoản nợ của khách khác; T28 khác đơn vị
BEGIN;
DO $s$ DECLARE c6 uuid := 'd0000000-0000-0000-0000-000000000006'; c7 uuid := 'd0000000-0000-0000-0000-000000000007';
  r1 uuid := pg_temp.rc('HD-0001'); ob7 uuid; p uuid;
  org2 uuid := 'a0000000-0000-0000-0000-0000000000f2'; u2 uuid := 'e0000000-0000-0000-0000-0000000000f2';
BEGIN
  ob7 := pg_temp.dau_ky(c7, 300000);
  PERFORM pg_temp.chan('T27a phiếu khách 7 thu HĐ khách 6', format('SELECT pg_temp.thu(%L, %L)', c7, jsonb_build_array(pg_temp.ln(r1, 1000))), 'BAD_RECEIVABLE_LINE');
  PERFORM pg_temp.chan('T27b phiếu khách 6 kèm nợ khách 7', format('SELECT pg_temp.thu(%L, %L)', c6,
     jsonb_build_array(pg_temp.ln(r1, 1000), pg_temp.ln(ob7, 1000))), 'BAD_RECEIVABLE_LINE');
  p := pg_temp.thu(c6, jsonb_build_array(pg_temp.ln(r1, 1000)));
  INSERT INTO organizations (id, name, slug) VALUES (org2, 'NPP khác', 'npp-khac-quet');
  INSERT INTO auth.users (id, email) VALUES (u2, 'khac@quet.local');
  INSERT INTO users (id, org_id, full_name, role) VALUES (u2, org2, 'Chủ NPP khác', 'owner');
  PERFORM set_config('request.jwt.claim.sub', u2::text, false);
  PERFORM pg_temp.chan('T28a đơn vị khác thu HĐ', format('SELECT pg_temp.thu(%L, %L)', c6, jsonb_build_array(pg_temp.ln(r1, 1000))), 'BAD_RECEIVABLE_LINE');
  PERFORM pg_temp.chan('T28b đơn vị khác huỷ phiếu thu', format('SELECT void_cash_receipt(%L, %L)', p, 'x'), 'ORG_MISMATCH');
  PERFORM pg_temp.as_user(1);
END $s$;
ROLLBACK;

-- T29 Ghi thẳng bảng tiền từ trình duyệt (vai authenticated + RLS)
GRANT USAGE ON SCHEMA public, auth, extensions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
BEGIN;
SELECT pg_temp.as_user(1);
SELECT pg_temp.thu('d0000000-0000-0000-0000-000000000006', jsonb_build_array(pg_temp.ln(pg_temp.rc('HD-0001'), 400000))) AS p29 \gset
SELECT pg_temp.as_user(3);
SET LOCAL ROLE authenticated;
DO $s$ DECLARE n int; p uuid := (SELECT id FROM cash_receipts ORDER BY created_at DESC LIMIT 1);
BEGIN
  BEGIN
    UPDATE receivables SET paid = 1100000, status = 'paid' WHERE id = pg_temp.rc('HD-0002'); GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM pg_temp.kq('T29a kế toán UPDATE thẳng receivables.paid', n = 0, format('%s dòng bị sửa (paid không qua RPC, không payment)', n));
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'CHẶN T29a: % (mig 214)', left(SQLERRM, 100);
  END;
  BEGIN
    UPDATE payments SET amount = 1 WHERE receivable_id = pg_temp.rc('HD-0001'); GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM pg_temp.kq('T29b kế toán UPDATE thẳng payments.amount', n = 0, format('%s dòng bị sửa', n));
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'CHẶN T29b: % (mig 214)', left(SQLERRM, 100);
  END;
  BEGIN
    UPDATE cash_receipts SET status = 'voided' WHERE id = p; GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM pg_temp.kq('T29c kế toán đổi thẳng cash_receipts.status=voided', n = 0, format('%s dòng bị sửa (bỏ qua void_cash_receipt)', n));
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'CHẶN T29c: % (mig 214)', left(SQLERRM, 100);
  END;
END $s$;
RESET ROLE;
DO $s$ BEGIN RAISE NOTICE '     → sau T29: %', pg_temp.bat_bien('d0000000-0000-0000-0000-000000000006'); END $s$;
ROLLBACK;
BEGIN;
SELECT pg_temp.as_user(1);
SELECT pg_temp.thu('d0000000-0000-0000-0000-000000000006', jsonb_build_array(pg_temp.ln(pg_temp.rc('HD-0001'), 400000))) AS p29 \gset
SELECT pg_temp.as_user(2);
SET LOCAL ROLE authenticated;
DO $s$ DECLARE n int; p uuid := (SELECT id FROM cash_receipts ORDER BY created_at DESC LIMIT 1);
BEGIN
  DELETE FROM cash_receipts WHERE id = p; GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.kq('T29d quản lý DELETE thẳng phiếu thu', n = 0, format('%s phiếu bị xoá (dòng xoá theo CASCADE, payments + paid ở lại)', n));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'CHẶN T29d: %', left(SQLERRM, 100);
END $s$;
RESET ROLE;
DO $s$ BEGIN RAISE NOTICE '     → sau T29d: % ; phiếu thu còn: %', pg_temp.bat_bien('d0000000-0000-0000-0000-000000000006'),
  (SELECT count(*) FROM cash_receipts); END $s$;
ROLLBACK;
BEGIN;
SELECT pg_temp.as_user(3);
SET LOCAL ROLE authenticated;
DO $s$ DECLARE n int;
BEGIN
  INSERT INTO payments (receivable_id, collected_by, amount, method) VALUES (pg_temp.rc('HD-0003'), 'e0000000-0000-0000-0000-000000000003', 500000, 'cash');
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.kq('T29e kế toán INSERT thẳng payments', n = 0, format('%s dòng payments không phiếu thu', n));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'CHẶN T29e: %', left(SQLERRM, 100);
END $s$;
RESET ROLE;
ROLLBACK;
BEGIN;
SELECT pg_temp.as_user(5);
SET LOCAL ROLE authenticated;
DO $s$ DECLARE n int; v uuid;
BEGIN
  INSERT INTO cash_receipts (org_id, receipt_code, source_type, status, submitted_amount, expected_amount, collected_by)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'PT-GIA-QUET', 'manual', 'received', 9999999, 9999999, 'e0000000-0000-0000-0000-000000000005')
  RETURNING id INTO v;
  INSERT INTO cash_receipt_lines (receipt_id, receivable_id, amount, kind) VALUES (v, pg_temp.rc('HD-0003'), 9999999, 'payment');
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.kq('T29f thủ kho INSERT thẳng phiếu thu + dòng (không payment)', n = 0, format('%s dòng; phiếu "đã nhận" 9.999.999đ không qua RPC', n));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'CHẶN T29f: %', left(SQLERRM, 100);
END $s$;
RESET ROLE;
ROLLBACK;

-- T30 Làm tròn / số lẻ
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; r1 uuid := pg_temp.rc('HD-0001'); r2 uuid := pg_temp.rc('HD-0002'); p uuid; b text;
BEGIN
  BEGIN
    p := pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 0.005)));
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'CHẶN T30a: % (mig 212)', left(SQLERRM, 90); RETURN;
  END;
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T30a thu 0,005đ', b = '', format('R1 %s; tiền phiếu %s; dòng %s; payment %s; %s', pg_temp.r(r1),
     (SELECT submitted_amount FROM cash_receipts WHERE id=p), (SELECT amount FROM cash_receipt_lines WHERE receipt_id=p),
     (SELECT amount FROM payments WHERE receivable_id=r1), b));
END $s$;
ROLLBACK;
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; r2 uuid := pg_temp.rc('HD-0002'); b text;
BEGIN
  BEGIN
    PERFORM pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r2, 1100000.01)));
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'CHẶN T30b: % (mig 212)', left(SQLERRM, 90); RETURN;
  END;
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T30b thu 1.100.000,01 (dung sai 0,01)', b = '', format('R2 %s; %s', pg_temp.r(r2), b));
END $s$;
ROLLBACK;

-- T32 Bấm Lưu hai lần (cùng tải trọng)
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; r1 uuid := pg_temp.rc('HD-0001'); p1 uuid; p2 uuid;
BEGIN
  -- (mig 215) Màn hình gửi kèm client_key; bấm Lưu hai lần = cùng khoá.
  p1 := pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 300000)), '{"notes":"lần 1","client_key":"k-t32"}');
  BEGIN
    p2 := pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 300000)), '{"notes":"lần 1","client_key":"k-t32"}');
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'CHẶN T32: %', SQLERRM; RETURN; END;
  PERFORM pg_temp.kq('T32 gửi trùng tạo 2 phiếu', p1 = p2 AND (SELECT paid FROM receivables WHERE id = r1) = 300000,
     format('2 phiếu %s + %s, R1 %s — RPC không có khoá chống gửi trùng (idempotency)',
            (SELECT receipt_code FROM cash_receipts WHERE id=p1), (SELECT receipt_code FROM cash_receipts WHERE id=p2), pg_temp.r(r1)));
END $s$;
ROLLBACK;

-- T33 Dùng dư có trả trọn (tiền thật 0đ)
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; r1 uuid := pg_temp.rc('HD-0001'); p uuid; b text;
BEGIN
  PERFORM pg_temp.tra(c, 300000);
  p := pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 300000)), '{"use_credit":300000}');
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T33 phiếu thu toàn dư có', b = '' AND (SELECT submitted_amount FROM cash_receipts WHERE id=p) = 0
     AND pg_temp.no_app(c) = 3000000, format('R1 %s; tiền thật %s; nợ %s; %s', pg_temp.r(r1),
     (SELECT submitted_amount FROM cash_receipts WHERE id=p), pg_temp.no_app(c), b));
END $s$;
ROLLBACK;

-- T34 Nợ đầu kỳ đã thu: xoá / sửa số qua màn nhập Excel (ghi thẳng, RLS kế toán)
BEGIN;
SELECT pg_temp.as_user(1);
SELECT pg_temp.dau_ky('d0000000-0000-0000-0000-000000000006', 500000) AS ob34 \gset
SELECT pg_temp.thu('d0000000-0000-0000-0000-000000000006', jsonb_build_array(pg_temp.ln(:'ob34', 500000))) AS p34 \gset
SELECT pg_temp.as_user(3);
SET LOCAL ROLE authenticated;
DO $s$ DECLARE n int; ob uuid := (SELECT id FROM receivables WHERE opening_balance AND note='Nợ đầu kỳ thử');
BEGIN
  BEGIN
    DELETE FROM receivables WHERE id = ob; GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM pg_temp.kq('T34a xoá nợ đầu kỳ đã thu', n = 0, format('%s dòng bị xoá', n));
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'CHẶN T34a xoá nợ đầu kỳ đã thu: % (khoá ngoại dòng phiếu thu)', left(SQLERRM, 80);
  END;
  UPDATE receivables SET amount = 200000 WHERE id = ob; GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '     T34b sửa đầu kỳ 500k→200k khi đã thu 500k: % dòng; %', n, pg_temp.r(ob);
END $s$;
RESET ROLE;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; ob uuid := (SELECT id FROM receivables WHERE opening_balance AND note='Nợ đầu kỳ thử'); b text;
BEGIN
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T34b sau sửa: dư có 300k có hiện ở tổng nợ?', b = '',
    format('OB %s; nợ app %s, ròng %s; %s', pg_temp.r(ob), pg_temp.no_app(c), pg_temp.no_rong(c), b));
END $s$;
ROLLBACK;

-- T35 Lập lại HĐ đã nhận dư có (vế đắp credit_applied) rồi huỷ phiếu thu
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; r1 uuid := pg_temp.rc('HD-0001'); p uuid; b text; hd2 uuid; neg uuid;
BEGIN
  PERFORM pg_temp.tra(c, 200000);
  SELECT id INTO neg FROM receivables WHERE customer_id=c AND return_id IS NOT NULL;
  p := pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 500000)), '{"use_credit":200000}');
  hd2 := pg_temp.lap_lai('HD-0001', 1);
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T35a lập lại HĐ đã nhận dư có', b = '', format('mới %s; NEG %s; %s',
     (SELECT format('amt=%s paid=%s st=%s', amount, paid, status) FROM receivables WHERE invoice_id=hd2), pg_temp.r(neg), b));
  PERFORM void_cash_receipt(p, 'thử');
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T35b rồi huỷ phiếu thu', b = '' AND (SELECT paid FROM receivables WHERE id=neg) = 0,
     format('mới %s; NEG %s; %s', (SELECT format('amt=%s paid=%s st=%s', amount, paid, status) FROM receivables WHERE invoice_id=hd2), pg_temp.r(neg), b));
END $s$;
ROLLBACK;

-- T36 Lập lại HĐ là NGUỒN dư có đã rút (paid giảm bởi dòng -take) rồi lập lại lần nữa
BEGIN;
DO $s$ DECLARE c uuid := 'd0000000-0000-0000-0000-000000000006'; r1 uuid := pg_temp.rc('HD-0001'); r2 uuid := pg_temp.rc('HD-0002');
  b text; hd2 uuid; hd3 uuid;
BEGIN
  PERFORM pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r1, 1100000)));
  hd2 := pg_temp.lap_lai('HD-0001', 0.5);
  PERFORM pg_temp.thu(c, jsonb_build_array(pg_temp.ln(r2, 100000)), '{"use_credit":100000}');
  UPDATE batches SET qty_on_hand = qty_on_hand + 10000 WHERE warehouse_zone = 'sale';
  SELECT x.invoice_id INTO hd3 FROM reissue_invoice(hd2, jsonb_build_object('lines', pg_temp.dong(hd2, 1), 'allow_oversell', true)) x;
  b := pg_temp.bat_bien(c);
  PERFORM pg_temp.kq('T36 lập lại lần 2 tờ đã là nguồn dư có', b = '',
     format('tờ 3 %s; R2 %s; nợ app %s ròng %s; %s', (SELECT format('amt=%s paid=%s st=%s', amount, paid, status) FROM receivables WHERE invoice_id=hd3),
            pg_temp.r(r2), pg_temp.no_app(c), pg_temp.no_rong(c), b));
END $s$;
ROLLBACK;

\echo ===== HẾT =====
