-- ĐỘI TEST CÔNG NỢ & THU TIỀN — CÁC LỖI ĐÃ XÁC MINH (để ĐỎ tới khi sửa; sửa xong chạy lại phải XANH).
--
-- L1  Phiếu thu lập không kèm ngày (màn Thu tiền /receivables/collect, màn chi tiết công nợ /receivables/[id])
--     lấy `receipt_date = current_date` theo MÚI GIỜ PHIÊN (Supabase = UTC) chứ không theo giờ VN.
--     00:00–06:59 sáng VN phiếu mang ngày HÔM QUA, trong khi mã phiếu PT-YYMMDD lại theo ngày VN
--     → báo cáo cuối ngày (`receipt_date = ngày`) và bộ lọc kỳ ở danh sách phiếu thu xếp phiếu sang hôm trước.
--     Luật: CLAUDE.md §1 "`invoice_date` là DATE: so bằng ngày theo giờ VN (`vnDateKey`), không so với mốc
--     ISO/UTC"; mig 140 đổi `CURRENT_DATE` → `vn_today()` vì đúng lý do này.
--     Chỗ mã: hàm `create_cash_receipt` (supabase/migrations/120_workflow_v2_rpcs.sql, các bản vá 212/215 giữ nguyên)
--     `COALESCE((p->>'receipt_date')::date, current_date)`.
--     Tái hiện tất định: đổi TimeZone phiên sang UTC−12 và UTC+14 — tại MỌI thời điểm ít nhất một trong hai
--     cho ngày khác `vn_today()` (VN = UTC+7). Hàm đúng phải không phụ thuộc múi giờ phiên.
--
-- L2  Công nợ NCC: tiền ghi THẲNG được từ trình duyệt (kế toán / chủ, vai `authenticated`):
--     sửa `payables.paid` mà không có phiếu chi, chèn / xoá `payable_payments` mà `paid` không đổi, xoá khoản
--     nợ NCC đã trả (CASCADE xoá luôn lịch sử chi). Luật: CLAUDE.md §1 Quyền "Tiền, tồn kho, trạng thái chứng từ
--     chỉ đổi qua RPC — không ghi thẳng từ trình duyệt"; mig 167 dời ghi trả NCC vào RPC
--     `record_payable_payment` vì ghi rời từ trình duyệt làm lệch `paid` với Σ phiếu chi; màn chi tiết
--     (payables/[id]/page.tsx:216) chỉ cho xoá khi `paid = 0`. Mig 214 khoá kiểu ghi thẳng này cho phía
--     PHẢI THU (receivables / payments / cash_receipts) nhưng bỏ sót phía PHẢI TRẢ.
--     Chỗ mã: RLS "Manage payables" / "Manage payable payments" (FOR ALL, owner + accountant, mig 010) và không
--     có trigger khoá ghi thẳng nào trên `payables`, `payable_payments`.
--
-- Chạy: psql -h /tmp/pgtest -p 55432 -U postgres -d npp_cong_no -v ON_ERROR_STOP=1 -f scripts/sql/doi-test/cong-no-loi.sql
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (stt serial, buoc text, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;
GRANT USAGE ON SEQUENCE kq_stt_seq TO authenticated;
CREATE TEMP TABLE ctx (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON ctx TO authenticated;
CREATE FUNCTION pg_temp.c(p_k text) RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT v FROM ctx WHERE k = p_k $f$;
CREATE FUNCTION pg_temp.ghi(b text, t text, ok boolean, g text) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO kq (buoc, ten, ok, ghi) VALUES (b, t, COALESCE(ok, false), COALESCE(g, '')) $f$;
CREATE FUNCTION pg_temp.ghi_thang(q text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE n int;
BEGIN
  EXECUTE q; GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n || ' dòng';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END $f$;
CREATE FUNCTION pg_temp.so(q text) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER AS
  $f$ DECLARE r numeric; BEGIN EXECUTE q INTO r; RETURN r; END $f$;

-- Dữ liệu: khách + nợ đầu kỳ 1.000.000 (để có khoản thu); NCC + 2 khoản nợ NCC.
DO $d$ DECLARE k uuid; r uuid; s uuid; p1 uuid; p2 uuid; BEGIN
  INSERT INTO customers (org_id, store_name, owner_name, phone, address)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'Khách CN lỗi', 'Chị Thử', '0912000111', 'Đường thử') RETURNING id INTO k;
  INSERT INTO receivables (org_id, customer_id, amount, paid, due_date, status, opening_balance)
  VALUES ('a0000000-0000-0000-0000-000000000001', k, 1000000, 0, CURRENT_DATE + 30, 'open', true) RETURNING id INTO r;
  INSERT INTO suppliers (org_id, name, code) VALUES ('a0000000-0000-0000-0000-000000000001', 'NCC lỗi', 'NCC-L') RETURNING id INTO s;
  INSERT INTO payables (org_id, supplier_id, invoice_number, amount, paid, status)
  VALUES ('a0000000-0000-0000-0000-000000000001', s, 'NCC-L1', 1000000, 0, 'open') RETURNING id INTO p1;
  INSERT INTO payables (org_id, supplier_id, invoice_number, amount, paid, status)
  VALUES ('a0000000-0000-0000-0000-000000000001', s, 'NCC-L2', 500000, 0, 'open') RETURNING id INTO p2;
  INSERT INTO ctx VALUES ('K', k), ('R', r), ('PAY1', p1), ('PAY2', p2);
END $d$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000003', true);

-- ─── L1: ngày phiếu thu theo giờ VN, không theo múi giờ phiên ───
DO $t$ DECLARE p uuid; tz text; BEGIN
  FOREACH tz IN ARRAY ARRAY['Etc/GMT+12', 'Etc/GMT-14'] LOOP
    PERFORM set_config('TimeZone', tz, true);
    p := create_cash_receipt(jsonb_build_object('customer_id', pg_temp.c('K'), 'lines',
           jsonb_build_array(jsonb_build_object('receivable_id', pg_temp.c('R'), 'amount', 1000))));
    PERFORM pg_temp.ghi('L1', format('phiếu thu không kèm ngày (phiên %s) → receipt_date = ngày VN %s', tz, vn_today()),
      (SELECT receipt_date FROM cash_receipts WHERE id = p) = vn_today(),
      format('receipt_date=%s, mã %s', (SELECT receipt_date FROM cash_receipts WHERE id = p), (SELECT receipt_code FROM cash_receipts WHERE id = p)));
    PERFORM pg_temp.ghi('L1', format('ngày trong mã phiếu khớp receipt_date (phiên %s)', tz),
      (SELECT substr(receipt_code, 4, 6) = to_char(receipt_date, 'YYMMDD') FROM cash_receipts WHERE id = p),
      (SELECT receipt_code || ' / ' || receipt_date FROM cash_receipts WHERE id = p));
  END LOOP;
  PERFORM set_config('TimeZone', 'UTC', true);
END $t$;

-- ─── L2: công nợ NCC không ghi thẳng được tiền từ trình duyệt ───
DO $t$ DECLARE e text; BEGIN
  e := pg_temp.ghi_thang(format('UPDATE payables SET paid = amount, status = %L WHERE id = %L', 'paid', pg_temp.c('PAY1')));
  PERFORM pg_temp.ghi('L2', 'kế toán sửa thẳng payables.paid = 1.000.000 (không phiếu chi) → phải bị chặn',
    e NOT LIKE '%dòng' OR e = '0 dòng',
    e || format(' → paid=%s, Σ phiếu chi=%s', pg_temp.so(format('SELECT paid FROM payables WHERE id = %L', pg_temp.c('PAY1'))),
      pg_temp.so(format('SELECT COALESCE(sum(amount),0) FROM payable_payments WHERE payable_id = %L', pg_temp.c('PAY1')))));
  e := pg_temp.ghi_thang(format($q$INSERT INTO payable_payments (payable_id, amount, method, paid_by) VALUES (%L, 300000, 'cash', 'e0000000-0000-0000-0000-000000000003')$q$, pg_temp.c('PAY2')));
  PERFORM pg_temp.ghi('L2', 'kế toán chèn thẳng phiếu chi NCC 300.000 (paid không đổi) → phải bị chặn',
    e NOT LIKE '%dòng' OR e = '0 dòng',
    e || format(' → paid=%s, Σ phiếu chi=%s', pg_temp.so(format('SELECT paid FROM payables WHERE id = %L', pg_temp.c('PAY2'))),
      pg_temp.so(format('SELECT COALESCE(sum(amount),0) FROM payable_payments WHERE payable_id = %L', pg_temp.c('PAY2')))));
END $t$;
-- Trả 200.000 ĐÚNG đường RPC, rồi thử xoá phiếu chi / xoá khoản nợ đã trả.
DO $t$ DECLARE e text; BEGIN
  PERFORM record_payable_payment(pg_temp.c('PAY2'), 200000, 'cash', NULL);
  e := pg_temp.ghi_thang(format('DELETE FROM payable_payments WHERE payable_id = %L AND amount = 200000', pg_temp.c('PAY2')));
  PERFORM pg_temp.ghi('L2', 'kế toán xoá thẳng phiếu chi 200.000 đã ghi qua RPC → phải bị chặn (paid ở lại 200.000)',
    e NOT LIKE '%dòng' OR e = '0 dòng',
    e || format(' → paid=%s, Σ phiếu chi=%s', pg_temp.so(format('SELECT paid FROM payables WHERE id = %L', pg_temp.c('PAY2'))),
      pg_temp.so(format('SELECT COALESCE(sum(amount),0) FROM payable_payments WHERE payable_id = %L AND amount = 200000', pg_temp.c('PAY2')))));
  e := pg_temp.ghi_thang(format('DELETE FROM payables WHERE id = %L', pg_temp.c('PAY2')));
  PERFORM pg_temp.ghi('L2', 'kế toán xoá khoản nợ NCC ĐÃ trả (màn chỉ cho xoá khi paid = 0) → phải bị chặn',
    e NOT LIKE '%dòng' OR e = '0 dòng',
    e || format(' → khoản còn %s, phiếu chi còn %s', pg_temp.so(format('SELECT count(*) FROM payables WHERE id = %L', pg_temp.c('PAY2'))),
      pg_temp.so(format('SELECT count(*) FROM payable_payments WHERE payable_id = %L', pg_temp.c('PAY2')))));
END $t$;

RESET ROLE;
SELECT stt, buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ten, left(ghi, 140) AS ghi FROM kq ORDER BY stt;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
