-- KIỂM MIG 228 (phần bổ sung 04/10/2026, sau đợt đội test): (1) bảng cân đối không kẹp dòng nợ âm về 0 —
-- dư có của khách trừ vào tổng phải thu (CLAUDE.md, mig 186); (2) mã phiếu đặt mua NCC trùng được giữa hai NPP.
-- psql -f, bọc BEGIN … ROLLBACK.
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE kq (buoc text, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;
GRANT USAGE ON SCHEMA public, auth TO authenticated;

DELETE FROM receivables WHERE org_id = 'a0000000-0000-0000-0000-000000000001';
INSERT INTO receivables (org_id, customer_id, amount, paid, status)
SELECT 'a0000000-0000-0000-0000-000000000001', c.id, v.amount, 0, 'open'
  FROM (SELECT id FROM customers WHERE org_id = 'a0000000-0000-0000-0000-000000000001' ORDER BY id LIMIT 1) c,
       (VALUES (500000::numeric), (-120000::numeric)) v(amount);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);
INSERT INTO kq
SELECT '1', 'phải thu trên bảng cân đối = 500.000 − 120.000 (dư có trừ vào)', accounts_receivable = 380000,
       'phải thu = ' || accounts_receivable
  FROM public.finance_balance_sheet(public.vn_today());
RESET ROLE;

INSERT INTO organizations (id, name, slug) VALUES ('a0000000-0000-0000-0000-0000000000f2', 'NPP thứ hai (thử)', 'npp-thu-hai-thu')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO suppliers (id, org_id, name) VALUES
  ('5f000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'NCC thử 1'),
  ('5f000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000f2', 'NCC thử 2');
DO $t$
DECLARE v_loi text := 'OK';
BEGIN
  INSERT INTO purchase_orders (org_id, po_code, supplier_id)
    VALUES ('a0000000-0000-0000-0000-000000000001', 'PO-THU-0001', '5f000000-0000-0000-0000-000000000001');
  BEGIN
    INSERT INTO purchase_orders (org_id, po_code, supplier_id)
      VALUES ('a0000000-0000-0000-0000-0000000000f2', 'PO-THU-0001', '5f000000-0000-0000-0000-000000000002');
  EXCEPTION WHEN unique_violation THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES ('2a', 'NPP thứ hai tạo được PO cùng mã', v_loi = 'OK', v_loi);
  v_loi := 'không chặn';
  BEGIN
    INSERT INTO purchase_orders (org_id, po_code, supplier_id)
      VALUES ('a0000000-0000-0000-0000-000000000001', 'PO-THU-0001', '5f000000-0000-0000-0000-000000000001');
  EXCEPTION WHEN unique_violation THEN v_loi := 'chặn'; END;
  INSERT INTO kq VALUES ('2b', 'trùng mã trong CÙNG NPP vẫn bị chặn', v_loi = 'chặn', v_loi);
END $t$;

SELECT buoc, ten, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
