-- KIỂM MIG 235 — SỬA PHIẾU NHẬP ĐÃ BÁN HÀNG RA · SỬA PHIẾU TRẢ NCC (chủ nhà 06/10/2026: "những phiếu nhập hàng từ NCC
-- đã bán hàng ra không sửa được, tao muốn sửa được … tương tự với phiếu trả hàng ncc"). psql -f, BEGIN … ROLLBACK.
--   Phiếu nhập P: A 2 thùng × 240.000 (48 hộp, giá vốn 10.000/hộp). Đã bán 30 hộp (phiếu xuất X), đã trả NCC 100.000.
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;

INSERT INTO suppliers (id, org_id, name, code) VALUES
  ('5f000000-0000-0000-0000-0000000235a1', 'a0000000-0000-0000-0000-000000000001', 'NCC thử 235', 'T235');
INSERT INTO products (id, org_id, sku, name, base_unit, status) VALUES
  ('c2350000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'T235A', 'Hàng A thử 235', 'hộp', 'active'),
  ('c2350000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-000000000001', 'T235B', 'Hàng B thử 235', 'gói', 'active');
INSERT INTO product_units (product_id, unit_name, conversion) VALUES ('c2350000-0000-0000-0000-0000000000a1', 'thùng', 24);
INSERT INTO purchase_invoices (id, org_id, supplier_id, status, invoice_date, warehouse_zone) VALUES
  ('d2350000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000235a1', 'draft', '2026-10-01', 'sale'),
  ('d2350000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000235a1', 'draft', '2026-10-01', 'sale');
INSERT INTO purchase_invoice_lines (invoice_id, product_id, unit_name, quantity, unit_price, conversion_factor, line_total, sort_order) VALUES
  ('d2350000-0000-0000-0000-0000000000f1', 'c2350000-0000-0000-0000-0000000000a1', 'thùng', 2, 240000, 24, 480000, 1);

-- Hoàn thành P (Thủ kho, RPC thật).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
SELECT public.complete_purchase_invoice('d2350000-0000-0000-0000-0000000000f1') IS NOT NULL AS p_hoan_thanh;
RESET ROLE;

CREATE TEMP TABLE lo AS
  SELECT b.id, b.batch_code FROM batches b JOIN stock_entry_lines sel ON sel.batch_id = b.id
  JOIN purchase_invoices pi ON pi.stock_entry_id = sel.entry_id WHERE pi.id = 'd2350000-0000-0000-0000-0000000000f1';
GRANT SELECT ON lo TO authenticated;

-- Bán 30 hộp từ lô của P (như `post_stock_export`: dòng xuất + dấu vết lấy lô, giá vốn chụp 10.000).
INSERT INTO stock_entries (id, org_id, entry_code, type, status, posted_at, warehouse_zone) VALUES
  ('e2350000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-000000000001', 'XK-T235', 'export', 'posted', now(), 'sale');
INSERT INTO stock_entry_lines (id, entry_id, product_id, batch_id, unit_name, quantity, unit_cost, qty_in_base_uom)
SELECT 'f2350000-0000-0000-0000-0000000000e1', 'e2350000-0000-0000-0000-0000000000e1', 'c2350000-0000-0000-0000-0000000000a1', lo.id, 'hộp', 30, 10000, 30 FROM lo;
INSERT INTO stock_line_consumptions (line_id, batch_id, qty_in_base_uom, unit_cost)
SELECT 'f2350000-0000-0000-0000-0000000000e1', lo.id, 30, 10000 FROM lo;
UPDATE batches SET qty_on_hand = qty_on_hand - 30 WHERE id IN (SELECT id FROM lo);
-- Đã trả NCC 100.000.
UPDATE payables SET paid = 100000, status = 'partial'
WHERE id = (SELECT payable_id FROM purchase_invoices WHERE id = 'd2350000-0000-0000-0000-0000000000f1');

CREATE TEMP VIEW pn AS
  SELECT pi.total, pi.subtotal, pi.status, pi.receipt_code, p.amount, p.paid, p.status AS no_tt,
         (SELECT count(*) FROM purchase_invoice_lines WHERE invoice_id = pi.id) AS so_dong
  FROM purchase_invoices pi LEFT JOIN payables p ON p.id = pi.payable_id
  WHERE pi.id = 'd2350000-0000-0000-0000-0000000000f1';
GRANT SELECT ON pn TO authenticated;
CREATE TEMP VIEW loA AS SELECT b.* FROM batches b WHERE b.id IN (SELECT id FROM lo);
GRANT SELECT ON loA TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);

-- 1. Huỷ phiếu vẫn bị chặn (hàng đã bán) — luật huỷ không đổi.
DO $t$
DECLARE v_loi text;
BEGIN
  BEGIN PERFORM public.cancel_purchase_invoice('d2350000-0000-0000-0000-0000000000f1', 'thử'); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (1, 'Huỷ phiếu nhập đã bán vẫn bị chặn (HANG_DA_XUAT hoặc DA_TRA_TIEN)', v_loi ~ '^(HANG_DA_XUAT|DA_TRA_TIEN)', v_loi);
END $t$;

-- 2. Sửa giá 240.000 → 264.000/thùng: cùng lô, còn 18, giá vốn 11.000; phần đã bán tính lại 11.000; công nợ sửa tại chỗ.
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.sua_phieu_nhap('d2350000-0000-0000-0000-0000000000f1',
    '{"supplier_id":"5f000000-0000-0000-0000-0000000235a1","invoice_number":"HD-NCC-9","invoice_date":"2026-10-01","warehouse_zone":"sale","discount":0,"vat_override":null,"notes":"sửa giá"}',
    '[{"product_id":"c2350000-0000-0000-0000-0000000000a1","unit_name":"thùng","quantity":2,"unit_price":264000,"line_discount":0,"vat_rate":0,"conversion_factor":24}]');
  INSERT INTO kq VALUES (2, 'Sửa giá phiếu đã bán: cùng lô, nhập 48 còn 18, giá vốn lô 11.000',
    (SELECT count(*) FROM loA) = 1 AND (SELECT qty_initial FROM loA) = 48 AND (SELECT qty_on_hand FROM loA) = 18
    AND (SELECT unit_cost FROM loA) = 11000, j::text);
END $t$;
INSERT INTO kq SELECT 3, 'Giá vốn hàng ĐÃ BÁN tính lại 11.000 (dấu vết lấy lô + dòng xuất)',
  (SELECT unit_cost FROM stock_line_consumptions WHERE line_id = 'f2350000-0000-0000-0000-0000000000e1') = 11000
  AND (SELECT unit_cost FROM stock_entry_lines WHERE id = 'f2350000-0000-0000-0000-0000000000e1') = 11000, NULL;
INSERT INTO kq SELECT 4, 'Công nợ NCC sửa tại chỗ 528.000, đã trả 100.000 giữ nguyên, trạng thái partial; phiếu vẫn Hoàn thành',
  (SELECT amount FROM pn) = 528000 AND (SELECT paid FROM pn) = 100000 AND (SELECT no_tt FROM pn) = 'partial'
  AND (SELECT total FROM pn) = 528000 AND (SELECT status FROM pn) = 'completed',
  (SELECT row_to_json(pn)::text FROM pn);
INSERT INTO kq SELECT 5, 'Bảng giá nhập (mig 234) theo giá sửa: thùng 264.000',
  (SELECT price FROM purchase_price_lists WHERE product_id = 'c2350000-0000-0000-0000-0000000000a1' AND unit_name = 'thùng') = 264000, NULL;

-- 6. Giảm xuống 1 thùng (24 hộp) < 30 đã bán → chặn, nói rõ.
DO $t$
DECLARE v_loi text;
BEGIN
  BEGIN
    PERFORM public.sua_phieu_nhap('d2350000-0000-0000-0000-0000000000f1', '{"warehouse_zone":"sale"}',
      '[{"product_id":"c2350000-0000-0000-0000-0000000000a1","unit_name":"thùng","quantity":1,"unit_price":264000,"conversion_factor":24}]');
    v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (6, 'SL mới (24 hộp) < đã xuất (30) → DA_XUAT_NHIEU_HON, nói rõ "đã xuất 30 hộp"',
    v_loi LIKE 'DA_XUAT_NHIEU_HON%' AND v_loi LIKE '%đã xuất 30 hộp%' AND (SELECT qty_on_hand FROM loA) = 18, v_loi);
END $t$;

-- 7. Đổi sang 30 hộp (= đúng số đã bán) + thêm dòng B 10 gói: lô A còn 0, lô B mới; mã lô nối tiếp.
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.sua_phieu_nhap('d2350000-0000-0000-0000-0000000000f1', '{"warehouse_zone":"sale"}',
    '[{"product_id":"c2350000-0000-0000-0000-0000000000a1","unit_name":"hộp","quantity":30,"unit_price":11000,"conversion_factor":1},
      {"product_id":"c2350000-0000-0000-0000-0000000000b1","unit_name":"gói","quantity":10,"unit_price":5000,"conversion_factor":1}]');
  INSERT INTO kq VALUES (7, 'Đổi 30 hộp (= đã bán) + thêm dòng B: lô A nhập 30 còn 0, lô B mới 10, mã lô -002',
    (SELECT qty_initial FROM loA) = 30 AND (SELECT qty_on_hand FROM loA) = 0
    AND EXISTS (SELECT 1 FROM batches b WHERE b.product_id = 'c2350000-0000-0000-0000-0000000000b1' AND b.qty_on_hand = 10
                AND b.batch_code = (SELECT receipt_code FROM pn) || '-002')
    AND (SELECT so_dong FROM pn) = 2 AND (SELECT amount FROM pn) = 380000, j::text);
END $t$;

-- 8. Bỏ dòng B (chưa xuất) → lô B đóng, dòng phiếu kho bỏ. 9. Bỏ dòng A (đã bán) → chặn.
DO $t$
DECLARE v_loi text;
BEGIN
  PERFORM public.sua_phieu_nhap('d2350000-0000-0000-0000-0000000000f1', '{"warehouse_zone":"sale"}',
    '[{"product_id":"c2350000-0000-0000-0000-0000000000a1","unit_name":"hộp","quantity":30,"unit_price":11000,"conversion_factor":1}]');
  INSERT INTO kq VALUES (8, 'Bỏ dòng B chưa xuất: lô B về 0 / đóng, không còn dòng phiếu kho',
    NOT EXISTS (SELECT 1 FROM batches b WHERE b.product_id = 'c2350000-0000-0000-0000-0000000000b1' AND b.qty_on_hand <> 0)
    AND NOT EXISTS (SELECT 1 FROM stock_entry_lines sel JOIN purchase_invoices pi ON pi.stock_entry_id = sel.entry_id
                    WHERE pi.id = 'd2350000-0000-0000-0000-0000000000f1' AND sel.product_id = 'c2350000-0000-0000-0000-0000000000b1'), NULL);
  BEGIN
    PERFORM public.sua_phieu_nhap('d2350000-0000-0000-0000-0000000000f1', '{"warehouse_zone":"sale"}',
      '[{"product_id":"c2350000-0000-0000-0000-0000000000b1","unit_name":"gói","quantity":1,"unit_price":5000,"conversion_factor":1}]');
    v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (9, 'Bỏ dòng A đã bán → DA_XUAT_NHIEU_HON "không bỏ dòng này được"',
    v_loi LIKE 'DA_XUAT_NHIEU_HON%không bỏ dòng này được%', v_loi);
END $t$;

-- 10. Sửa xuống tổng thấp hơn tiền đã trả (trả dư) → công nợ âm còn tính (partial), không kẹp.
DO $t$
BEGIN
  PERFORM public.sua_phieu_nhap('d2350000-0000-0000-0000-0000000000f1', '{"warehouse_zone":"sale"}',
    '[{"product_id":"c2350000-0000-0000-0000-0000000000a1","unit_name":"hộp","quantity":30,"unit_price":2000,"conversion_factor":1}]');
  INSERT INTO kq VALUES (10, 'Tổng 60.000 < đã trả 100.000: nợ 60.000, trả 100.000, trạng thái partial (NCC còn nợ lại 40.000)',
    (SELECT amount FROM pn) = 60000 AND (SELECT paid FROM pn) = 100000 AND (SELECT no_tt FROM pn) = 'partial', NULL);
END $t$;

-- 11. Vai bán hàng → FORBIDDEN. 12. Phiếu tạm → PHIEU_CHUA_HOAN_THANH.
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000004', true);
DO $t$
DECLARE v_loi text;
BEGIN
  BEGIN PERFORM public.sua_phieu_nhap('d2350000-0000-0000-0000-0000000000f1', '{}', '[{"product_id":"c2350000-0000-0000-0000-0000000000a1","unit_name":"hộp","quantity":30,"unit_price":1}]'); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (11, 'NV bán hàng gọi sửa phiếu nhập → FORBIDDEN', v_loi LIKE 'FORBIDDEN%', v_loi);
END $t$;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000003', true);
DO $t$
DECLARE v_loi text;
BEGIN
  BEGIN PERFORM public.sua_phieu_nhap('d2350000-0000-0000-0000-0000000000f2', '{}', '[{"product_id":"c2350000-0000-0000-0000-0000000000a1","unit_name":"hộp","quantity":1,"unit_price":1}]'); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (12, 'Phiếu tạm → PHIEU_CHUA_HOAN_THANH (lưu như thường)', v_loi LIKE 'PHIEU_CHUA_HOAN_THANH%', v_loi);
END $t$;
RESET ROLE;

-- 13. Phiếu trả NCC lấy từ lô đã ĐÓNG (phiếu nhập gốc từng bị huỷ-lập-lại) → huỷ được, hàng về lô, lô mở lại.
INSERT INTO batches (id, org_id, product_id, batch_code, qty_initial, qty_on_hand, status, unit_cost, warehouse_zone, expires_at)
VALUES ('b2350000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001', 'c2350000-0000-0000-0000-0000000000b1',
        'T235-CU', 20, 20, 'available', 5000, 'sale', '2099-12-31');
INSERT INTO supplier_returns (id, org_id, supplier_id, status, warehouse_zone, return_date) VALUES
  ('d2350000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000235a1', 'draft', 'sale', '2026-10-02');
INSERT INTO supplier_return_lines (return_id, product_id, unit_name, quantity, unit_price, conversion_factor, line_total, sort_order) VALUES
  ('d2350000-0000-0000-0000-0000000000d1', 'c2350000-0000-0000-0000-0000000000b1', 'gói', 5, 5000, 1, 25000, 1);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
SELECT public.complete_supplier_return('d2350000-0000-0000-0000-0000000000d1') IS NOT NULL AS tra_ncc_xong;
RESET ROLE;
UPDATE batches SET status = 'cancelled' WHERE id = 'b2350000-0000-0000-0000-0000000000c1';
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v_loi text := 'được';
BEGIN
  BEGIN PERFORM public.cancel_supplier_return('d2350000-0000-0000-0000-0000000000d1', 'sửa phiếu');
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (13, 'Huỷ phiếu trả NCC lấy từ lô đã đóng: không còn LO_DA_DONG, hàng về lô (15 → 20), lô mở lại',
    v_loi = 'được' AND (SELECT qty_on_hand FROM batches WHERE id = 'b2350000-0000-0000-0000-0000000000c1') = 20
    AND (SELECT status FROM batches WHERE id = 'b2350000-0000-0000-0000-0000000000c1') = 'available', v_loi);
END $t$;
RESET ROLE;

SELECT buoc, ten, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
