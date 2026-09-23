-- ====================================================================
-- ĐƠN ĐÃ HUỶ THÌ KHÔNG THÊM / SỬA DÒNG HÀNG ĐƯỢC NỮA
--
-- Rơi ra từ đợt QA 22/09/2026.
--
-- ⚠ ĐÃ ĐO TRÊN POSTGRES 16, đăng nhập quản lý (-0002), sửa một đơn vừa bị
--   người khác huỷ (DH-0006):
--       UPDATE dòng hàng quantity → 99       : ĐƯỢC
--       UPDATE đầu đơn (applyOrderEdit)      : "Không thể chuyển đơn từ
--                                              cancelled sang submitted"
--   Kết quả: đơn `cancelled`, `total` = 1.100.000 mà dòng hàng là 99 —
--   ghi dở dang, sổ nói hai đằng.
--
--   Chính sách "Admin roles can manage order lines" chỉ loại `completed`,
--   còn `guard_order_lines_locked` (mig 124) không chặn `cancelled`.
--
-- ⚠ CHỈ CHẶN THÊM VÀ SỬA, KHÔNG CHẶN XOÁ. Chủ / quản lý được xoá đơn đã
--   huỷ ("Owner/Manager can delete draft or cancelled orders"), và xoá đơn
--   thì dòng hàng bị xoá theo (CASCADE) — chặn xoá dòng là chặn luôn việc
--   dọn đơn huỷ.
--
-- ⚠ LỐI `npp.via_rpc` GIỮ NGUYÊN — các RPC hoá đơn tự kiểm trạng thái.
-- ====================================================================

-- ⚠ GIỮ NGUYÊN SECURITY DEFINER + search_path CỦA BẢN GỐC (mig 124):
--   `CREATE OR REPLACE` không mang theo thuộc tính cũ, thiếu hai dòng này
--   là trigger đọc trạng thái đơn qua RLS của người gọi — và NVBH không
--   thấy đơn nháp của người khác thì trigger thấy `NULL`, thả qua hết.
CREATE OR REPLACE FUNCTION public.guard_order_lines_locked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_status text; v_order uuid;
BEGIN
  IF COALESCE(current_setting('npp.via_rpc', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  v_order := COALESCE(NEW.order_id, OLD.order_id);
  SELECT status INTO v_status FROM sales_orders WHERE id = v_order;
  IF v_status IN ('partially_invoiced', 'completed', 'closed') THEN
    RAISE EXCEPTION
      'ORDER_LOCKED: đơn đã xuất hàng, không sửa dòng được. Huỷ hóa đơn trước, hoặc lập đơn trả.'
      USING ERRCODE = 'P0001';
  END IF;
  -- (mig 172) Đơn đã huỷ: không thêm, không sửa dòng. Xoá thì để yên.
  IF v_status = 'cancelled' AND TG_OP IN ('INSERT', 'UPDATE') THEN
    RAISE EXCEPTION
      'ORDER_CANCELLED: đơn này đã bị huỷ — không sửa dòng hàng được nữa. Tải lại đơn để xem trạng thái mới.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $kiem$
BEGIN
  IF position('ORDER_CANCELLED' in pg_get_functiondef('public.guard_order_lines_locked()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '172: chưa vá guard_order_lines_locked' USING ERRCODE = 'P0001';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.guard_order_lines_locked()'::regprocedure) THEN
    RAISE EXCEPTION '172: guard_order_lines_locked mất SECURITY DEFINER' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                 WHERE p.proname = 'guard_order_lines_locked' AND t.tgrelid = 'sales_order_lines'::regclass) THEN
    RAISE EXCEPTION '172: guard_order_lines_locked không còn gắn vào sales_order_lines' USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE '--- 172: đơn đã huỷ không thêm / sửa dòng được nữa ---';
END;
$kiem$;

NOTIFY pgrst, 'reload schema';

SELECT 'Đơn đã huỷ mà tổng tiền khác tổng dòng (dấu vết ghi dở dang cũ)' AS hang_muc,
       count(*)::text AS so_don,
       coalesce(string_agg(so.order_code, ', '), '') AS ma_don
FROM sales_orders so
JOIN (SELECT order_id, sum(line_total) AS tong FROM sales_order_lines GROUP BY order_id) l ON l.order_id = so.id
WHERE so.status = 'cancelled' AND abs(coalesce(so.subtotal, 0) - l.tong) > 1;
