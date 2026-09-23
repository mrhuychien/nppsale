-- ====================================================================
-- XUẤT HÀNG SỬA ĐƯỢC HÀNG ĐỔI TRẢ KÈM ĐƠN
--
-- Chủ nhà báo 23/09/2026: "Khi xuất hàng màn tạo Hoá đơn … Không sửa được
-- thông tin Hàng đổi trả".
--
-- ⚠ VÌ SAO TRƯỚC NAY KHÔNG SỬA ĐƯỢC. `_apply_return_edits` (mig 149) chỉ
--   nhận dòng của phiếu trả ĐANG BÁM hóa đơn — và nó chỉ được gọi từ
--   `reissue_invoice`. Lúc XUẤT LẦN ĐẦU, phiếu trả kèm đơn chưa bám hóa đơn
--   nào; `post_invoice` gắn nó vào tờ mới rồi thôi, không có cổng nào nhận
--   phần sửa.
--
-- ⚠ CÁCH VÁ: áp `return_edits` NGAY SAU câu gắn phiếu trả vào tờ mới — lúc
--   ấy phiếu đã bám đúng hóa đơn và còn `submitted`, đúng điều kiện của
--   `_apply_return_edits` — và TRƯỚC lần tính lại công nợ, để khoản trừ ghi
--   xuống là khoản đã sửa. Cùng một giao dịch với việc xuất hàng.
--
-- ⚠ BỎ QUA KHI ĐANG LẬP LẠI (`reissue_of`). `reissue_invoice` đã tự áp phần
--   sửa trước khi gọi `post_invoice` với CÙNG tải trọng — áp lần nữa là vô
--   hại (đặt lại cùng số, dòng đã xoá thì bỏ qua) nhưng là hai chỗ làm một
--   việc; một chỗ thôi.
--
-- ⚠ VÁ CHUỖI BẢN ĐANG CHẠY, không chép lại thân hàm — như mig 174 (bài học
--   mig 149: chép lại là xoá mất các miếng vá 128 / 131 / 152 / 174).
-- ====================================================================

DO $patch$
DECLARE
  v_oid  oid;
  v_n    int;
  v_src  text;
  v_neo  text := E'    AND ret.status IN (''draft'', ''submitted'');\n';
BEGIN
  SELECT count(*) INTO v_n
  FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
  WHERE ns.nspname = 'public' AND pr.proname = 'post_invoice' AND pr.prokind = 'f';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '180: tìm thấy % bản post_invoice, cần đúng 1', v_n USING ERRCODE = 'P0001';
  END IF;

  SELECT pr.oid INTO v_oid
  FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
  WHERE ns.nspname = 'public' AND pr.proname = 'post_invoice' AND pr.prokind = 'f';
  v_src := pg_get_functiondef(v_oid);

  IF position('(mig 180)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 180: post_invoice đã nhận return_edits, bỏ qua ---';
    RETURN;
  END IF;

  IF (length(v_src) - length(replace(v_src, v_neo, ''))) / length(v_neo) <> 1 THEN
    RAISE EXCEPTION '180: không thấy đúng MỘT chỗ gắn phiếu trả trong post_invoice' USING ERRCODE = 'P0001';
  END IF;

  v_src := replace(v_src, v_neo, v_neo
    || E'\n  -- (mig 180) Sửa hàng trả kèm đơn lúc XUẤT LẦN ĐẦU — phiếu vừa bám tờ này.'
    || E'\n  IF p->>''reissue_of'' IS NULL THEN'
    || E'\n    PERFORM public._apply_return_edits(v_inv, p->''return_edits'');'
    || E'\n  END IF;\n');
  EXECUTE v_src;
END;
$patch$;

DO $kiem$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef('public.post_invoice(jsonb)'::regprocedure) INTO v_src;
  IF position('(mig 180)' IN v_src) = 0 THEN
    RAISE EXCEPTION '180: post_invoice chưa nhận return_edits' USING ERRCODE = 'P0001';
  END IF;
  -- Các miếng vá cũ phải còn nguyên.
  IF position('_chuan_he_so_dong_hoa_don' IN v_src) = 0 OR position('_apply_return_adds' IN v_src) = 0
     OR position('reissue_of' IN v_src) = 0 THEN
    RAISE EXCEPTION '180: post_invoice mất miếng vá của mig 152 / 174' USING ERRCODE = 'P0001';
  END IF;
  -- Phần sửa phải nằm TRƯỚC lần tính lại công nợ cuối.
  IF position('(mig 180)' IN v_src) > position('v_status := public._wf2b_sync_order_status' IN v_src) THEN
    RAISE EXCEPTION '180: phần sửa hàng trả nằm sau lần tính công nợ' USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE '--- 180: xuất hàng nay sửa được hàng trả kèm đơn ---';
END;
$kiem$;

NOTIFY pgrst, 'reload schema';

SELECT 'post_invoice nhận return_edits lúc xuất lần đầu' AS hang_muc,
       CASE WHEN position('(mig 180)' IN pg_get_functiondef('public.post_invoice(jsonb)'::regprocedure)) > 0
            THEN 'có' ELSE 'CHƯA' END AS trang_thai;
