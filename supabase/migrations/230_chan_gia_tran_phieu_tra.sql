-- ====================================================================
-- 230 — CHẶN GIÁ TRẦN PHIẾU TRẢ Ở MÁY CHỦ
--
-- VÌ SAO
--   · Chủ nhà 04/10/2026: "chặn giá trần cho phiếu trả hàng luôn" (sau mig 229 chặn giá trần dòng bán).
--   · Luật đang chỉ ở giao diện (`returnPriceViolation`, src/lib/sell/returns.ts): trả CAO hơn giá tham chiếu
--     là một đường rút tiền ("mua 100k, trả lại 150k") — tiền đi RA khỏi công ty. Gọi thẳng RPC lập phiếu trả /
--     ghi thẳng dòng phiếu Nháp thì đặt giá bao nhiêu cũng được.
--
-- CÁCH LÀM — trigger BEFORE INSERT/UPDATE trên return_lines (bắt mọi đường: save_pos_return,
--   create_return_with_lines, create_order_with_lines, _apply_return_adds / _apply_return_edits của xuất / sửa HĐ,
--   ghi thẳng phiếu Nháp):
--   · Giá tham chiếu: phiếu gắn hoá đơn → giá đã bán trên dòng HĐ cùng mặt hàng + đơn vị (lấy giá TRƯỚC giảm dòng,
--     số lớn nhất — máy chủ không được chặt hơn giao diện); không gắn HĐ → giá bảng đúng đơn vị + nhóm giá của khách
--     (`_gia_bang_don_vi`, mig 226). Tham chiếu 0 (chưa có giá) → không kiểm, như giao diện.
--   · Trần = tham chiếu × (1 + % được nâng) — "TRẦN GIÁ TRẢ = TRẦN GIÁ BÁN CỦA CHÍNH NGƯỜI ĐÓ" (cùng luật mig 229:
--     NVBH không có quyền sửa giá → 0%; vai khác theo % của họ).
--   · Cho qua: hạ giá (kể cả về 0); dòng HÀNG ĐỔI (không tính tiền); chủ NPP / kế toán; không có phiên (máy chủ,
--     migration); sửa dòng mà không nâng giá so với dòng cũ. Dung sai 1 đồng.
-- ====================================================================

CREATE OR REPLACE FUNCTION public._chot_gia_tran_dong_tra()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid   uuid := (SELECT auth.uid());
  v_role  text;
  v_pct   numeric;
  v_inv   uuid;
  v_kh    uuid;
  v_nhom  uuid;
  v_ref   numeric;
  v_tran  numeric;
BEGIN
  IF COALESCE(NEW.is_exchange, false) OR v_uid IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.product_id IS NOT DISTINCT FROM OLD.product_id
     AND NEW.unit_name IS NOT DISTINCT FROM OLD.unit_name
     AND COALESCE(NEW.unit_price, 0) <= COALESCE(OLD.unit_price, 0) + 1 THEN
    RETURN NEW;
  END IF;

  SELECT u.role,
         CASE WHEN u.allow_price_edit OR u.role <> 'sales'
              THEN GREATEST(0, COALESCE(u.price_edit_max_increase_pct, 0)) ELSE 0 END
    INTO v_role, v_pct
    FROM users u WHERE u.id = v_uid;
  IF v_role IS NULL OR v_role IN ('owner', 'accountant') THEN RETURN NEW; END IF;

  SELECT r.invoice_id, r.customer_id INTO v_inv, v_kh FROM returns r WHERE r.id = NEW.return_id;
  IF v_inv IS NOT NULL THEN
    SELECT max(l.unit_price + COALESCE(l.line_discount, 0) / NULLIF(l.quantity, 0))
      INTO v_ref
      FROM sales_invoice_lines l
     WHERE l.invoice_id = v_inv AND l.product_id = NEW.product_id AND l.unit_name = NEW.unit_name;
  END IF;
  IF v_ref IS NULL THEN
    SELECT c.group_id INTO v_nhom FROM customers c WHERE c.id = v_kh;
    v_ref := public._gia_bang_don_vi(NEW.product_id, NEW.unit_name, v_nhom);
  END IF;
  IF COALESCE(v_ref, 0) <= 0 THEN RETURN NEW; END IF;

  v_tran := round(v_ref * (1 + COALESCE(v_pct, 0) / 100));
  IF COALESCE(NEW.unit_price, 0) > v_tran + 1 THEN
    RAISE EXCEPTION 'RETURN_PRICE_OVER_CEILING: Giá trả % vượt mức tối đa % (giá tham chiếu %, được nâng %).',
      replace(to_char(round(NEW.unit_price), 'FM999,999,999,999'), ',', '.'),
      replace(to_char(v_tran, 'FM999,999,999,999'), ',', '.'),
      replace(to_char(round(v_ref), 'FM999,999,999,999'), ',', '.'),
      replace(trim_scale(COALESCE(v_pct, 0))::text, '.', ',') || '%'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._chot_gia_tran_dong_tra() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_gia_tran_dong_tra ON public.return_lines;
CREATE TRIGGER trg_gia_tran_dong_tra
  BEFORE INSERT OR UPDATE ON public.return_lines
  FOR EACH ROW EXECUTE FUNCTION public._chot_gia_tran_dong_tra();

NOTIFY pgrst, 'reload schema';

SELECT 'mig 230: chặn giá trần phiếu trả ở máy chủ' AS buoc,
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_gia_tran_dong_tra') THEN 'OK' ELSE 'CHƯA' END AS ket_qua;
