-- ====================================================================
-- 229 — CHẶN GIÁ TRẦN Ở MÁY CHỦ (dòng đơn bán)
--
-- VÌ SAO
--   · Chủ nhà 04/10/2026, trả lời câu "Giá trần: máy chủ chỉ chặn bán dưới giá bảng, chưa chặn sửa giá
--     vượt trần cho phép. Có cần chặn luôn không?" → "có".
--   · Luật trần đang chỉ ở giao diện (`priceViolation`, src/lib/sell/cart.ts; mig 027): giá ≤ giá bảng ×
--     (1 + users.price_edit_max_increase_pct). Gọi thẳng RPC / ghi thẳng dòng thì nâng giá bao nhiêu cũng được.
--
-- CÁCH LÀM
--   Viết lại `_chot_gia_dong_don` (mig 226) — thêm khối (c0) kiểm trần sau khi tra giá bảng đúng đơn vị +
--   nhóm giá của khách. Chủ NPP / kế toán vẫn toàn quyền (thoát sớm như cũ). NVBH không có quyền sửa giá →
--   trần = giá bảng; vai khác theo % của chính họ (như POS: canEditPrice = !isSales || allow_price_edit).
--   Giá bảng 0 (chưa đặt giá) thì không kiểm. Sửa dòng không nâng giá so với dòng cũ → cho qua.
--   Dung sai 1 đồng (giá trước giảm suy từ line_discount / SL bị làm tròn).
-- ====================================================================

CREATE OR REPLACE FUNCTION public._chot_gia_dong_don()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_order  uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  q        record;
  v_nhom   uuid;
  v_bang   numeric;
  v_giam   numeric;
  v_goc    numeric := 0;
  v_tien   numeric;
  v_tran   numeric;
  v_sai    numeric;
  v_pct    numeric;
  v_truoc  numeric;
  v_tran_gia numeric;
BEGIN
  -- (a) Chỉ kiểm khi dòng mới / xoá, hoặc đổi thứ ảnh hưởng tiền. Cập nhật `invoiced_qty` của RPC xuất
  --     hàng không đụng giá — cho qua, kể cả dòng cũ của sổ.
  IF TG_OP = 'UPDATE'
     AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity
     AND NEW.unit_price IS NOT DISTINCT FROM OLD.unit_price
     AND NEW.line_discount IS NOT DISTINCT FROM OLD.line_discount
     AND NEW.product_id IS NOT DISTINCT FROM OLD.product_id
     AND NEW.unit_name IS NOT DISTINCT FROM OLD.unit_name THEN
    RETURN NEW;
  END IF;

  SELECT * INTO q FROM public._quyen_giam_cua((SELECT auth.uid()));

  -- (b) Ảnh chụp giảm đơn gốc TRƯỚC lần đổi dòng đầu tiên của người BỊ GIỚI HẠN quyền, kể từ lần
  --     đầu đơn lưu gần nhất (trigger đầu đơn xoá ảnh khi lưu xong). Ứng dụng sửa dòng và sửa đầu
  --     đơn bằng hai lệnh RỜI — tới lúc đầu đơn lưu thì dòng đã đổi, không còn cách nào khác biết
  --     khoản giảm cũ.
  IF NOT q.toan_quyen
     AND NOT EXISTS (SELECT 1 FROM giam_don_goc g WHERE g.order_id = v_order)
     AND EXISTS (SELECT 1 FROM sales_orders so WHERE so.id = v_order AND so.status IN ('draft', 'submitted')) THEN
    INSERT INTO giam_don_goc (order_id, giam)
    VALUES (v_order, COALESCE(public._giam_don_hien_tai(v_order), 0))
    ON CONFLICT (order_id) DO NOTHING;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'BAD_PAYLOAD: số lượng của dòng hàng phải lớn hơn 0 (bỏ dòng thay vì để 0).'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.unit_price IS NULL OR NEW.unit_price < 0 THEN
    RAISE EXCEPTION 'BAD_PAYLOAD: đơn giá của dòng hàng không được âm.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(NEW.line_discount, 0) < 0 THEN
    RAISE EXCEPTION 'BAD_PAYLOAD: giảm giá dòng không được âm.' USING ERRCODE = 'P0001';
  END IF;

  -- (c) Quyền giảm giá (mig 185).
  IF q.toan_quyen THEN RETURN NEW; END IF;

  SELECT c.group_id INTO v_nhom
  FROM sales_orders so JOIN customers c ON c.id = so.customer_id
  WHERE so.id = NEW.order_id;
  v_bang := COALESCE(public._gia_bang_don_vi(NEW.product_id, NEW.unit_name, v_nhom), 0);

  -- (c0) GIÁ TRẦN (mig 229, chủ nhà 04/10/2026: "có" — chặn cả ở máy chủ). Cùng luật `priceViolation`:
  --      giá TRƯỚC giảm dòng ≤ giá bảng × (1 + % được nâng). NVBH không có quyền sửa giá thì % = 0 (đúng
  --      giá bảng); vai khác (quản lý, thủ kho) sửa được giá trong % của chính họ, như POS. Sửa dòng mà
  --      không nâng giá so với dòng cũ → cho qua (đơn NPP đã nâng giá).
  IF v_bang > 0 THEN
    SELECT CASE WHEN u.allow_price_edit OR u.role <> 'sales'
                THEN GREATEST(0, COALESCE(u.price_edit_max_increase_pct, 0)) ELSE 0 END
      INTO v_pct
      FROM users u WHERE u.id = (SELECT auth.uid());
    v_truoc := NEW.unit_price + COALESCE(NEW.line_discount, 0) / NEW.quantity;
    v_tran_gia := round(v_bang * (1 + COALESCE(v_pct, 0) / 100));
    IF v_truoc > v_tran_gia + 1
       AND NOT (TG_OP = 'UPDATE' AND OLD.product_id = NEW.product_id AND OLD.unit_name = NEW.unit_name
                AND COALESCE(OLD.quantity, 0) > 0
                AND v_truoc <= OLD.unit_price + COALESCE(OLD.line_discount, 0) / OLD.quantity + 1) THEN
      RAISE EXCEPTION 'PRICE_OVER_CEILING: Đơn giá % vượt mức tối đa % (giá bảng %, được nâng %).',
        replace(to_char(round(v_truoc), 'FM999,999,999,999'), ',', '.'),
        replace(to_char(v_tran_gia, 'FM999,999,999,999'), ',', '.'),
        replace(to_char(round(v_bang), 'FM999,999,999,999'), ',', '.'),
        replace(trim_scale(COALESCE(v_pct, 0))::text, '.', ',') || '%'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Giảm THẬT: phần ghi ở line_discount, hoặc phần đơn giá thấp hơn giá bảng — lấy số lớn hơn.
  v_giam := GREATEST(COALESCE(NEW.line_discount, 0),
                     CASE WHEN v_bang > 0 THEN NEW.quantity * (v_bang - NEW.unit_price) ELSE 0 END, 0);
  IF TG_OP = 'UPDATE' AND OLD.product_id = NEW.product_id AND OLD.unit_name = NEW.unit_name THEN
    v_goc := GREATEST(COALESCE(OLD.line_discount, 0),
                      CASE WHEN v_bang > 0 THEN OLD.quantity * (v_bang - OLD.unit_price) ELSE 0 END, 0);
  END IF;
  v_sai := NEW.quantity * 0.5 + 1;

  -- Không tăng khoản giảm đã có (đơn NPP đã giảm) → cho qua.
  IF v_giam <= v_goc + v_sai THEN RETURN NEW; END IF;

  IF NOT q.duoc_giam THEN
    RAISE EXCEPTION 'DISCOUNT_NOT_ALLOWED: Bạn không có quyền giảm giá dòng (kể cả bán dưới giá bảng) — bỏ giảm giá ở các dòng rồi gửi lại.'
      USING ERRCODE = 'P0001';
  END IF;
  IF q.tran IS NOT NULL THEN
    v_tien := NEW.quantity * NEW.unit_price + v_giam;
    v_tran := CASE WHEN q.loai_tran = 'vnd' THEN q.tran
                   ELSE floor(v_tien * LEAST(100, q.tran) / 100) END;
    IF v_giam > v_tran + v_sai THEN
      RAISE EXCEPTION 'DISCOUNT_OVER_LIMIT: Giảm giá dòng vượt mức cho phép (%).', public._nhan_tran_giam(q.loai_tran, q.tran)
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._chot_gia_dong_don() FROM PUBLIC, anon, authenticated;

-- Trigger đã gắn ở mig 226; gắn lại cho chắc (idempotent).
DROP TRIGGER IF EXISTS trg_quyen_gia_dong_don ON public.sales_order_lines;
CREATE TRIGGER trg_quyen_gia_dong_don
  BEFORE INSERT OR UPDATE OR DELETE ON public.sales_order_lines
  FOR EACH ROW EXECUTE FUNCTION public._chot_gia_dong_don();

NOTIFY pgrst, 'reload schema';

SELECT 'mig 229: chặn giá trần ở máy chủ' AS buoc,
       CASE WHEN position('PRICE_OVER_CEILING' IN pg_get_functiondef('public._chot_gia_dong_don()'::regprocedure)) > 0
            THEN 'OK' ELSE 'CHƯA' END AS ket_qua,
       (SELECT count(*) FROM users WHERE role = 'sales' AND allow_price_edit)::text AS nvbh_duoc_sua_gia;
