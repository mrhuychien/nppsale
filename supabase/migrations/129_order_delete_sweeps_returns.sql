-- ====================================================================
-- 129 — Xoá đơn đã huỷ: vét HẾT phiếu trả chưa hoàn thành, và nếu vẫn
--        còn vướng thì nói ra bằng tiếng người
-- ====================================================================
--
-- TRIỆU CHỨNG (chủ NPP báo kèm ảnh): bấm "Xoá đơn hàng" trên một đơn ĐÃ
-- HUỶ → vẫn nhận
--
--     update or delete on table "sales_orders" violates foreign key
--     constraint "returns_order_id_fkey" on table "returns"  (mã 23503)
--
-- Đúng thứ mà migration 118 sinh ra để dập.
--
-- NGUYÊN NHÂN
--   Trigger của 118 dọn phiếu trả bằng một DANH SÁCH LIỆT KÊ:
--
--       DELETE FROM returns
--       WHERE order_id = OLD.id AND status IN ('draft','submitted','cancelled');
--
--   Danh sách ấy đúng với đúng bốn trạng thái mà `chk_returns_status_v2`
--   cho phép lúc 119 vừa chạy. Nhưng một phiếu mang bất kỳ giá trị nào
--   KHÁC — dữ liệu cũ mà backfill 119 không với tới, hoặc một trạng thái
--   thêm về sau — thì rơi vào đúng kẽ hở: nhánh chặn không thấy nó (chỉ
--   hỏi 'completed'), nhánh dọn cũng không thấy nó. Không ai chặn, không
--   ai dọn, và khoá ngoại nổ kèm một câu tiếng Anh.
--
-- ⚠ LIỆT KÊ CÁI ĐƯỢC PHÉP, ĐỪNG LIỆT KÊ CÁI PHẢI DỌN. Ý định của 118 vốn
--   đã viết rõ ngay trong chú thích của nó: "Chỉ phiếu 'completed' mới
--   đụng tồn kho và công nợ, nên chỉ nó mới chặn." Vậy thì phép dọn phải
--   là PHẦN BÙ của 'completed', không phải một danh sách chép tay — chép
--   tay thì mỗi lần thêm một trạng thái là mở lại đúng kẽ hở này.
--
-- ⚠ VÀ VẪN PHẢI CÓ CHỐT CUỐI. Dọn xong mà còn dòng nào trỏ vào đơn thì
--   ĐẾM và nói ra tên phiếu, thay vì thả cho khoá ngoại ném ra một câu
--   không ai đọc được. Một thông báo nói "còn phiếu TH-xxxx" thì người
--   dùng đi xử lý được; câu "violates foreign key constraint" thì không.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.trg_sales_orders_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_posted  int;
  v_pending int;
  v_left    int;
  v_names   text;
BEGIN
  -- ⚠ PHIẾU TRẢ ĐÃ HOÀN THÀNH LÀ CHỨNG TỪ. Nó đã trừ công nợ
  --   (credited_at) và kho đã nhận hàng lại. Không xoá theo, không gỡ
  --   liên kết (gỡ là phiếu mất dấu vết "trả cho đơn nào") — CHẶN, và
  --   nói thẳng vì sao.
  SELECT count(*) INTO v_posted
  FROM returns
  WHERE order_id = OLD.id AND status = 'completed';

  IF v_posted > 0 THEN
    RAISE EXCEPTION
      'Đơn % có % phiếu trả hàng ĐÃ HOÀN THÀNH (đã trừ công nợ / nhập lại kho) nên không xoá được. Huỷ phiếu trả đó trước, hoặc giữ đơn.',
      OLD.order_code, v_posted
      USING ERRCODE = 'P0001', HINT = 'returns.order_id';
  END IF;

  -- ⚠ PHẦN BÙ CỦA 'completed', KHÔNG PHẢI DANH SÁCH CHÉP TAY. Xem khối
  --   chú thích đầu file: liệt kê ba trạng thái là để hở đúng những
  --   phiếu mang giá trị ngoài danh sách.
  --
  -- ⚠ `IS DISTINCT FROM` chứ không phải `<>`: `NULL <> 'completed'` ra
  --   NULL, tức không khớp — một phiếu status rỗng sẽ lại lọt qua đúng
  --   như cũ.
  DELETE FROM returns
  WHERE order_id = OLD.id AND status IS DISTINCT FROM 'completed';
  GET DIAGNOSTICS v_pending = ROW_COUNT;

  UPDATE visit_logs SET order_id = NULL WHERE order_id = OLD.id;

  -- ⚠ CHỐT CUỐI. Tới đây mà còn dòng nào trỏ vào đơn thì có gì đó ngoài
  --   dự tính — nói ra tên phiếu thay vì thả cho khoá ngoại ném ra một
  --   câu tiếng Anh mà chủ NPP không làm gì được với nó.
  -- ⚠ BẢNG `returns` KHÔNG CÓ CỘT MÃ PHIẾU. Bản đầu của khối này hỏi
  --   `return_code` — một cột không tồn tại — nên trigger nổ ngay lần
  --   xoá đầu tiên, và lỗi mới còn khó hiểu hơn lỗi cũ. Nêu ngày trả và
  --   lý do: đó là hai thứ người dùng nhận ra phiếu bằng.
  SELECT count(*),
         string_agg(
           to_char(COALESCE(r2.created_at, now()), 'DD/MM/YYYY')
           || COALESCE(' · ' || r2.reason, ''), ', ')
    INTO v_left, v_names
  FROM returns r2 WHERE r2.order_id = OLD.id;

  IF v_left > 0 THEN
    RAISE EXCEPTION
      'Đơn % còn % phiếu trả hàng đang trỏ vào nó (%) nên chưa xoá được. Mở từng phiếu, huỷ hoặc gỡ khỏi đơn, rồi xoá lại.',
      OLD.order_code, v_left, v_names
      USING ERRCODE = 'P0001', HINT = 'returns.order_id';
  END IF;

  IF v_pending > 0 THEN
    RAISE NOTICE 'Xoá đơn %: đã bỏ % phiếu trả chưa hoàn thành đi kèm', OLD.order_code, v_pending;
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_sales_orders_before_delete() FROM PUBLIC;

COMMENT ON FUNCTION public.trg_sales_orders_before_delete() IS
  'Xoá đơn nháp/huỷ: bỏ MỌI phiếu trả chưa hoàn thành đi kèm (phần bù của '
  'completed, không phải danh sách liệt kê); chặn rõ lời nếu có phiếu trả '
  'đã hoàn thành; gỡ order_id khỏi visit_logs; và nếu vẫn còn dòng trỏ vào '
  'đơn thì nêu tên phiếu thay vì để khoá ngoại ném lỗi 23503.';

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE v_n int;
BEGIN
  -- Phiếu trả mang trạng thái NGOÀI bốn giá trị của v2 — chính là những
  -- phiếu từng lọt qua cả hai nhánh của trigger cũ.
  SELECT count(*) INTO v_n
  FROM returns
  WHERE status IS NULL
     OR status NOT IN ('draft', 'submitted', 'completed', 'cancelled');
  RAISE NOTICE '--- 129: % phiếu trả mang trạng thái ngoài bốn giá trị v2 (đây là những phiếu từng làm kẹt việc xoá đơn) ---', v_n;
END $$;
