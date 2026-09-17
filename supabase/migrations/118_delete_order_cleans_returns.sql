-- ---------------------------------------------------------------------
-- 118 — Xoá đơn nháp / đã huỷ: dọn phiếu trả CHƯA DUYỆT đi kèm, chặn rõ
--       lời nếu phiếu trả ĐÃ duyệt
-- ---------------------------------------------------------------------
--
-- TRIỆU CHỨNG (chủ NPP báo kèm ảnh): bấm "Xoá đơn hàng" trên đơn ĐÃ HUỶ →
--   update or delete on table "sales_orders" violates foreign key
--   constraint "returns_order_id_fkey" on table "returns" (mã 23503)
--
-- NGUYÊN NHÂN: luồng bán hàng tạo "hàng trả kèm đơn" — một dòng `returns`
-- trỏ `order_id` vào đơn, trạng thái `pending`. Khoá ngoại đó là REFERENCES
-- trần (mig 001), nên Postgres chặn xoá đơn chừng nào phiếu trả còn đó.
-- Mig 113 cố ý KHÔNG nới khoá ngoại vì công nợ / phiếu thu / bàn giao phải
-- chặn — đúng. Nhưng phiếu trả `pending` thì KHÁC: nó chưa trừ công nợ,
-- chưa nhập kho, nó là một phần của chính đơn đó. Đơn đi thì nó đi theo.
--
-- ⚠ PHIẾU TRẢ ĐÃ DUYỆT (`approved` / `completed`) LÀ CHỨNG TỪ. Nó đã trừ
-- công nợ (credited_at) và kho đã nhận hàng lại. Không xoá theo, không gỡ
-- liên kết (gỡ là phiếu mất dấu vết "trả cho đơn nào") — CHẶN, và nói
-- thẳng vì sao bằng tiếng người, thay vì câu "violates foreign key".
--
-- `visit_logs.order_id` chỉ là dấu "lần ghé này có ra đơn": đơn xoá thì
-- lần ghé vẫn có thật → gỡ liên kết, giữ nhật ký.
--
-- SECURITY DEFINER: người xoá đơn thường không có policy DELETE trên
-- `returns` (mig 002 chỉ có xem / tạo / duyệt). Không có nó thì lệnh xoá
-- phiếu trả bên trong trigger khớp 0 dòng — im lặng — rồi khoá ngoại lại
-- chặn y như cũ. Trigger chỉ chạy sau khi RLS đã CHO xoá đơn, và chỉ đụng
-- tới phiếu trả của đúng đơn đó, nên phạm vi không rộng hơn quyền đã có.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_sales_orders_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_posted  int;
  v_pending int;
BEGIN
  SELECT count(*) INTO v_posted
  FROM returns
  WHERE order_id = OLD.id AND status IN ('approved', 'completed');

  IF v_posted > 0 THEN
    RAISE EXCEPTION
      'Đơn % có % phiếu trả hàng ĐÃ DUYỆT (đã trừ công nợ / nhập lại kho) nên không xoá được. Huỷ phiếu trả đó trước, hoặc giữ đơn.',
      OLD.order_code, v_posted
      USING ERRCODE = 'P0001', HINT = 'returns.order_id';
  END IF;

  DELETE FROM returns
  WHERE order_id = OLD.id AND status IN ('pending', 'rejected');
  GET DIAGNOSTICS v_pending = ROW_COUNT;

  UPDATE visit_logs SET order_id = NULL WHERE order_id = OLD.id;

  IF v_pending > 0 THEN
    RAISE NOTICE 'Xoá đơn %: đã bỏ % phiếu trả chưa duyệt đi kèm', OLD.order_code, v_pending;
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_sales_orders_before_delete() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_sales_orders_before_delete ON sales_orders;
CREATE TRIGGER trg_sales_orders_before_delete
  BEFORE DELETE ON sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_sales_orders_before_delete();

COMMENT ON FUNCTION public.trg_sales_orders_before_delete() IS
  'Xoá đơn nháp/huỷ: bỏ phiếu trả pending/rejected đi kèm (chưa trừ công '
  'nợ, chưa nhập kho); chặn rõ lời nếu có phiếu trả approved/completed; '
  'gỡ order_id khỏi visit_logs. Công nợ, hoá đơn, phiếu thu, bàn giao vẫn '
  'chặn bằng khoá ngoại — đó là chứng từ, đúng như mig 113 chốt.';

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
  FROM returns r JOIN sales_orders o ON o.id = r.order_id
  WHERE o.status IN ('draft', 'cancelled') AND r.status IN ('pending', 'rejected');
  RAISE NOTICE '--- Hiện có % phiếu trả chưa duyệt gắn với đơn nháp/huỷ — sẽ đi theo khi đơn bị xoá ---', v_n;
END $$;
