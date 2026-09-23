-- ====================================================================
-- SỐ "ĐÃ XUẤT" CỦA DÒNG ĐƠN QUY ĐỔI THEO ĐƠN VỊ
--
-- Chủ nhà chốt 23/09/2026: "khi sửa toàn quyền được thay đổi mọi thông tin
-- như khi tạo? ko giới hạn cái nào cả" — kể cả đổi đơn vị của dòng lấy từ
-- đơn (đơn đặt 2 thùng, xuất 30 hộp).
--
-- ⚠ LỖI SẼ CÓ NẾU CHỈ MỞ GIAO DIỆN. `sales_order_lines.invoiced_qty` được
--   hiểu theo ĐƠN VỊ CỦA DÒNG ĐƠN ở mọi nơi đọc nó (`get_invoiceable_lines`
--   tính "còn lại", `committed_stock_by_product` nhân hệ số của dòng đơn,
--   `_wf2b_sync_order_status` so với `quantity` để chốt hoàn thành). Nhưng
--   hai trigger ghi nó (mig 124) cộng THẲNG `sales_invoice_lines.quantity`
--   — xuất 30 hộp cho một dòng 2 thùng là "đã xuất 30 thùng".
--
-- ⚠ CỘNG THEO ĐƠN VỊ CƠ SỞ RỒI MỚI CHIA. `sum(qty × hệ số hóa đơn) / hệ số
--   dòng đơn` — chia MỘT lần trên tổng, không chia từng dòng rồi cộng: 5 hộp
--   + 19 hộp của dòng 1 thùng (×24) phải ra đúng 1, không phải 0,99999…,
--   nếu không đơn không bao giờ "hoàn thành".
--
-- ⚠ CÙNG ĐƠN VỊ THÌ KẾT QUẢ Y HỆT CŨ (hệ số chia hệ số = 1). Điền lại toàn
--   bộ để dòng nào từng xuất khác đơn vị (màn Xuất hàng cũ trên điện thoại
--   có cho đổi) cũng đúng; bảng tóm tắt đếm số dòng đổi giá trị.
-- ====================================================================

CREATE OR REPLACE FUNCTION public._da_xuat_cua_dong_don(p_order_line_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    sum(sil.quantity * COALESCE(NULLIF(sil.conversion_factor, 0), 1))
      / COALESCE(NULLIF(max(sol.conversion_factor), 0), 1),
    0)
  FROM sales_invoice_lines sil
  JOIN sales_invoices si ON si.id = sil.invoice_id AND si.status = 'posted'
  JOIN sales_order_lines sol ON sol.id = sil.order_line_id
  WHERE sil.order_line_id = p_order_line_id
$$;

REVOKE ALL ON FUNCTION public._da_xuat_cua_dong_don(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_invoiced_qty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_line uuid;
BEGIN
  -- Dòng ngoài đơn (`order_line_id` NULL) không ảnh hưởng ai.
  FOR v_line IN
    SELECT x FROM (VALUES (OLD.order_line_id), (NEW.order_line_id)) AS t(x)
    WHERE x IS NOT NULL
  LOOP
    UPDATE sales_order_lines sol
    SET invoiced_qty = public._da_xuat_cua_dong_don(v_line)
    WHERE sol.id = v_line;
  END LOOP;
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.sync_invoiced_qty_on_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  UPDATE sales_order_lines sol
  SET invoiced_qty = public._da_xuat_cua_dong_don(sol.id)
  WHERE sol.id IN (
    SELECT order_line_id FROM sales_invoice_lines
    WHERE invoice_id = NEW.id AND order_line_id IS NOT NULL
  );
  RETURN NEW;
END;
$fn$;

-- Điền lại — chỉ dòng lệch. Đơn đã xuất bị `guard_order_lines_locked` khoá;
-- cờ này là lối của các RPC, chỉ sống trong khối này.
DO $dien$
DECLARE v_n int;
BEGIN
  PERFORM set_config('npp.via_rpc', 'on', true);
  UPDATE sales_order_lines sol
     SET invoiced_qty = public._da_xuat_cua_dong_don(sol.id)
   WHERE COALESCE(sol.invoiced_qty, 0) IS DISTINCT FROM public._da_xuat_cua_dong_don(sol.id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('npp.via_rpc', '', true);
  RAISE NOTICE '--- 179: tính lại số đã xuất cho % dòng đơn ---', v_n;
END;
$dien$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Bảng tóm tắt — chỉ đọc
-- ---------------------------------------------------------------------
SELECT 'Dòng hóa đơn xuất KHÁC đơn vị dòng đơn' AS hang_muc, count(*)::text AS so_dong
FROM sales_invoice_lines sil
JOIN sales_invoices si ON si.id = sil.invoice_id AND si.status = 'posted'
JOIN sales_order_lines sol ON sol.id = sil.order_line_id
WHERE sil.unit_name IS DISTINCT FROM sol.unit_name
UNION ALL
SELECT 'Dòng đơn có số đã xuất lệch công thức mới (mong đợi 0)', count(*)::text
FROM sales_order_lines sol
WHERE COALESCE(sol.invoiced_qty, 0) IS DISTINCT FROM public._da_xuat_cua_dong_don(sol.id);
