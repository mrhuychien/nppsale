-- ====================================================================
-- 141 — `supplier_return_lines.vat_rate` ĐỔI TỪ PHẦN TRĂM SANG TỈ LỆ
-- ====================================================================
--
-- VÌ SAO
--   Mọi bảng dòng hàng khác trong kho này giữ thuế suất dưới dạng TỈ LỆ:
--
--     · `products.vat_rate`        — DEFAULT 0.1, có COMMENT nói rõ
--     · `sales_invoice_lines`      — màn chi tiết in `vat_rate * 100`
--     · `stock_entry_lines`        — phiếu nhập kho nhân/chia 100 ở ô nhập
--
--   Chỉ `supplier_return_lines` giữ PHẦN TRĂM (10 = 10%). Một bảng lẻ
--   loi không tự nó gây hại, nhưng nó đã gây hại một lần rồi: màn tạo
--   phiếu trả điền sẵn ô "VAT %" bằng `products.vat_rate` — tức chép
--   thẳng TỈ LỆ 0,1 vào một ô PHẦN TRĂM. Phiếu tính 0,1% thay cho 10%,
--   thuế hụt đúng 100 lần, và không một dòng nào trên màn kêu lên.
--
--   Đã vá chỗ điền sẵn ở lần sửa trước. Migration này dọn tận gốc: đưa
--   cột về đúng quy ước của cả kho, để lần sau ai đọc `vat_rate` ở bất
--   kỳ bảng dòng hàng nào cũng chỉ có MỘT cách hiểu.
--
-- ⚠ ĐÂY LÀ PHÉP ĐỔI ĐƠN VỊ, KHÔNG PHẢI PHÉP SỬA SỐ. Chia 100 cho MỌI
--   dòng, kể cả những dòng trông "sai" (0.1 → 0.001). Vì sao không tự
--   đoán ý người nhập: cột `supplier_returns.vat` và cột
--   `supplier_return_lines.line_total` ĐÃ được tính bằng cách hiểu phần
--   trăm và đã ghi xuống sổ. Một dòng 0.1 đã đóng góp 0,1% vào số tiền
--   trên tờ phiếu; "sửa" nó thành 0.1 tỉ lệ là làm dòng hàng nói một
--   đằng còn tổng tiền nói một nẻo. Chia đều 100 giữ mọi con số tiền y
--   nguyên — đó là phép đổi duy nhất KHÔNG mất mát.
--
--   Nếu chủ nhà muốn sửa lại thuế suất của mấy phiếu cũ thành con số
--   đúng ý, đó là một việc KHÁC: mở phiếu ra sửa, và tổng tiền đổi theo.
--   Migration không tự quyết chuyện đó.
--
-- ⚠ IDEMPOTENT BẰNG COMMENT CỦA CỘT. Chạy lại lần hai mà không có chốt
--   chặn là chia 100 lần nữa — thuế thành một phần vạn. Không có cột
--   "phiên bản" nào để bám, nên dùng chính COMMENT làm dấu: có chữ
--   "TỈ LỆ" nghĩa là đã đổi rồi.
-- ====================================================================

DO $$
DECLARE
  v_marker text;
  v_n      bigint := 0;
  v_max    numeric;
BEGIN
  SELECT col_description('public.supplier_return_lines'::regclass, a.attnum)
    INTO v_marker
  FROM pg_attribute a
  WHERE a.attrelid = 'public.supplier_return_lines'::regclass
    AND a.attname  = 'vat_rate';

  IF v_marker IS NOT NULL AND v_marker LIKE '%TỈ LỆ%' THEN
    RAISE NOTICE '141: cột đã ở dạng tỉ lệ từ lần chạy trước — bỏ qua (0 dòng đổi).';
    RETURN;
  END IF;

  SELECT COALESCE(MAX(vat_rate), 0) INTO v_max FROM supplier_return_lines;

  UPDATE supplier_return_lines
     SET vat_rate = vat_rate / 100
   WHERE vat_rate <> 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RAISE NOTICE '141: đổi đơn vị vat_rate phần trăm → tỉ lệ cho % dòng (thuế suất cao nhất trước khi đổi: %). Tiền trên phiếu KHÔNG đổi.', v_n, v_max;
END $$;

COMMENT ON COLUMN supplier_return_lines.vat_rate IS
  'Thuế suất dạng TỈ LỆ (0.1 = 10%), giống products.vat_rate và '
  'sales_invoice_lines.vat_rate. Đổi từ phần trăm ở migration 141. '
  'Giao diện nhân 100 khi hiện và chia 100 khi lưu.';

NOTIFY pgrst, 'reload schema';
