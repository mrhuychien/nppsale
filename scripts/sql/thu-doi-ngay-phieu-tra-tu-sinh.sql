-- KIỂM ĐỔI NGÀY PHIẾU TRẢ TỰ SINH (chủ nhà 08/10/2026: "phiếu tự sinh theo đơn đặt hàng tao cũng muốn sửa được ngày
-- tháng"). Không có migration — kiểm luật đang chạy: trình duyệt (Quản lý) ghi được `return_date` của phiếu tự sinh đã
-- qua Nháp; doanh số / công nợ vẫn theo ngày hóa đơn (`revenue_date`, mig 192); không đổi được tiền / trạng thái.
-- psql -f, BEGIN … ROLLBACK.
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;

INSERT INTO sales_orders (id, org_id, customer_id, sales_user_id, order_code, order_seq, status, order_date)
VALUES ('0d000000-0000-0000-0000-0000000008a1', 'a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000006',
        'e0000000-0000-0000-0000-000000000004', 'DH-T8NGAY', 990801, 'completed', '2026-10-01');
INSERT INTO sales_invoices (id, org_id, order_id, customer_id, invoice_code, invoice_seq, status, invoice_date, total)
VALUES ('0e000000-0000-0000-0000-0000000008a1', 'a0000000-0000-0000-0000-000000000001', '0d000000-0000-0000-0000-0000000008a1',
        'd0000000-0000-0000-0000-000000000006', 'HD-T8NGAY', 990801, 'posted', '2026-10-01', 500000);
INSERT INTO returns (id, org_id, customer_id, requested_by, order_id, invoice_id, status, credit_with_invoice, credit_note_amount, reason, return_date)
VALUES ('0f000000-0000-0000-0000-0000000008a1', 'a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000006',
        'e0000000-0000-0000-0000-000000000001', '0d000000-0000-0000-0000-0000000008a1', '0e000000-0000-0000-0000-0000000008a1',
        'submitted', true, 100000, 'damaged', '2026-10-01');

CREATE TEMP VIEW pt AS SELECT return_date, revenue_date, credit_note_amount, status FROM returns WHERE id = '0f000000-0000-0000-0000-0000000008a1';
GRANT SELECT ON pt TO authenticated;
INSERT INTO kq SELECT 1, 'Phiếu tự sinh Chờ xử lý: trừ doanh số theo ngày HĐ 01/10', (SELECT revenue_date FROM pt) = '2026-10-01', (SELECT row_to_json(pt)::text FROM pt);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000002', true);
DO $t$
DECLARE v_n int; v_loi text;
BEGIN
  UPDATE returns SET return_date = '2026-10-04' WHERE id = '0f000000-0000-0000-0000-0000000008a1';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO kq VALUES (2, 'Quản lý đổi ngày phiếu tự sinh từ trình duyệt → ghi được (1 dòng), ngày phiếu 04/10',
    v_n = 1 AND (SELECT return_date FROM pt) = '2026-10-04', v_n::text);
  INSERT INTO kq VALUES (3, 'Doanh số / công nợ vẫn theo ngày hoá đơn 01/10 (không theo ngày phiếu)',
    (SELECT revenue_date FROM pt) = '2026-10-01', (SELECT revenue_date::text FROM pt));
  BEGIN
    UPDATE returns SET credit_note_amount = 1 WHERE id = '0f000000-0000-0000-0000-0000000008a1'; v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (4, 'Tiền của phiếu tự sinh vẫn không ghi thẳng được', v_loi LIKE 'PHIEU_TRA_KHOA%', v_loi);
END $t$;
-- 5. Nhân viên bán hàng: phiếu không phải Nháp của mình → RLS không cho đổi (0 dòng).
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000004', true);
DO $t$
DECLARE v_n int;
BEGIN
  UPDATE returns SET return_date = '2026-10-02' WHERE id = '0f000000-0000-0000-0000-0000000008a1';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO kq VALUES (5, 'NV bán hàng không đổi được ngày phiếu đã qua Nháp (RLS: 0 dòng)', v_n = 0, v_n::text);
END $t$;
RESET ROLE;

SELECT buoc, ten, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
