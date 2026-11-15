-- ====================================================================
-- 263 — SÀN GIÁ TRẢ: GIÁ TRẢ KHÔNG THẤP HƠN GIÁ NIÊM YẾT QUÁ 20%
--
-- VÌ SAO — chủ nhà 15/11/2026: "Em xử lý thêm phần hàng trả lại, giá trả không được thấp quá 20% giá niêm yết".
--   Trước đây hạ giá trả luôn được, kể cả xuống 0 (mig 230 chỉ chặn TRẦN). Trả rẻ không phải chiều an toàn: tiền trả thấp
--   làm hàng trả trừ ít đi ở doanh số thuần và đẩy "chênh lệch trả" của nhân viên lên (chênh trả = giá niêm yết − giá trả,
--   chủ nhà 03/11/2026).
--
-- CÁCH LÀM — trigger BEFORE INSERT/UPDATE trên return_lines, cạnh trần của mig 230 (bắt mọi đường: save_pos_return,
--   create_return_with_lines, create_order_with_lines, _apply_return_adds / _apply_return_edits của Xuất hàng / Sửa HĐ,
--   lưu đơn POS / điện thoại, ghi thẳng dòng phiếu Nháp):
--   · Sàn = round(giá niêm yết × 80 / 100). Giá niêm yết = giá bảng ĐÚNG đơn vị của dòng + nhóm giá của khách
--     (`_gia_bang_don_vi`, mig 226 — cũng là giá mặc định của dòng trả ở mọi màn). Cùng phép tính với app (`sanGiaTra`,
--     src/lib/sell/returns.ts — số 20 là `GIAM_TOI_DA_GIA_TRA_PCT`).
--   · Phiếu gắn hoá đơn mà hoá đơn bán mặt hàng + đơn vị ấy RẺ hơn sàn (khuyến mãi, NPP giảm sâu) → sàn = giá đã bán thấp
--     nhất trên hoá đơn (đơn giá sau giảm dòng, bỏ dòng hàng đổi 0đ): trả lại đúng số tiền khách đã trả luôn được.
--   · Cho qua (như trần): dòng HÀNG ĐỔI; chủ NPP / kế toán; không có phiên (máy chủ, migration); chưa có giá niêm yết (0);
--     sửa dòng mà KHÔNG HẠ giá so với dòng cũ (đổi số lượng, ghi chú…). Dung sai 1 đồng.
--   · Lỗi RETURN_PRICE_BELOW_FLOOR nói rõ giá tối thiểu (app dịch ở src/lib/errors.ts).
--   · Dòng cũ đang dưới sàn (lập trước mig này) KHÔNG bị sửa — chỉ chặn khi ghi lại: lưu lại đơn / phiếu có dòng ấy thì
--     phải nâng giá (màn tô đỏ dòng và nói giá tối thiểu). Câu SELECT cuối đếm số dòng như thế.
-- ====================================================================

CREATE OR REPLACE FUNCTION public._chot_gia_san_dong_tra()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid   uuid := (SELECT auth.uid());
  v_role  text;
  v_inv   uuid;
  v_kh    uuid;
  v_nhom  uuid;
  v_ny    numeric;
  v_san   numeric;
  v_ban   numeric;
BEGIN
  IF COALESCE(NEW.is_exchange, false) OR v_uid IS NULL THEN RETURN NEW; END IF;
  -- Sửa dòng mà không hạ giá (đổi số lượng, ghi chú, lý do…) → cho qua, kể cả dòng cũ của sổ đang dưới sàn. Dòng ĐỔI
  -- chuyển sang TRẢ thì là dòng tiền mới — vẫn kiểm.
  IF TG_OP = 'UPDATE'
     AND NOT COALESCE(OLD.is_exchange, false)
     AND NEW.product_id IS NOT DISTINCT FROM OLD.product_id
     AND NEW.unit_name IS NOT DISTINCT FROM OLD.unit_name
     AND COALESCE(NEW.unit_price, 0) >= COALESCE(OLD.unit_price, 0) - 1 THEN
    RETURN NEW;
  END IF;

  SELECT u.role INTO v_role FROM users u WHERE u.id = v_uid;
  IF v_role IS NULL OR v_role IN ('owner', 'accountant') THEN RETURN NEW; END IF;

  SELECT r.invoice_id, r.customer_id INTO v_inv, v_kh FROM returns r WHERE r.id = NEW.return_id;
  SELECT c.group_id INTO v_nhom FROM customers c WHERE c.id = v_kh;
  v_ny := COALESCE(public._gia_bang_don_vi(NEW.product_id, NEW.unit_name, v_nhom), 0);
  IF v_ny <= 0 THEN RETURN NEW; END IF;
  v_san := round(v_ny * (100 - 20) / 100);  -- 20 = GIAM_TOI_DA_GIA_TRA_PCT (src/lib/sell/returns.ts)

  IF v_inv IS NOT NULL THEN
    SELECT min(l.unit_price) INTO v_ban
      FROM sales_invoice_lines l
     WHERE l.invoice_id = v_inv AND l.product_id = NEW.product_id AND l.unit_name = NEW.unit_name
       AND NOT COALESCE(l.is_exchange, false);
  END IF;

  IF v_ban IS NOT NULL AND v_ban >= 0 AND v_ban < v_san THEN
    IF COALESCE(NEW.unit_price, 0) < v_ban - 1 THEN
      RAISE EXCEPTION 'RETURN_PRICE_BELOW_FLOOR: Giá trả % thấp hơn giá đã bán trên hoá đơn %.',
        replace(to_char(round(COALESCE(NEW.unit_price, 0)), 'FM999,999,999,999'), ',', '.'),
        replace(to_char(round(v_ban), 'FM999,999,999,999'), ',', '.')
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF COALESCE(NEW.unit_price, 0) < v_san - 1 THEN
    RAISE EXCEPTION 'RETURN_PRICE_BELOW_FLOOR: Giá trả % thấp hơn mức tối thiểu % (giá niêm yết %, không được thấp hơn quá 20%%).',
      replace(to_char(round(COALESCE(NEW.unit_price, 0)), 'FM999,999,999,999'), ',', '.'),
      replace(to_char(v_san, 'FM999,999,999,999'), ',', '.'),
      replace(to_char(round(v_ny), 'FM999,999,999,999'), ',', '.')
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._chot_gia_san_dong_tra() FROM PUBLIC, anon, authenticated;

-- ⚠ Tên `trg_gia_san_…` xếp SAU `trg_don_vi_rong_la_co_so` (trigger BEFORE chạy theo tên): đơn vị rỗng đã quy về đơn vị cơ
--   sở trước khi tra giá niêm yết.
DROP TRIGGER IF EXISTS trg_gia_san_dong_tra ON public.return_lines;
CREATE TRIGGER trg_gia_san_dong_tra
  BEFORE INSERT OR UPDATE ON public.return_lines
  FOR EACH ROW EXECUTE FUNCTION public._chot_gia_san_dong_tra();

NOTIFY pgrst, 'reload schema';

-- Tóm tắt: trigger đã gắn chưa + dòng trả HIỆN CÓ dưới sàn (phiếu chưa huỷ, dòng trả tiền) — lưu lại đơn / phiếu chứa
-- chúng sẽ phải nâng giá (trừ chủ NPP / kế toán).
WITH duoi_san AS (
  SELECT r.id AS phieu, r.status
    FROM public.return_lines rl
    JOIN public.returns r ON r.id = rl.return_id
    LEFT JOIN public.customers c ON c.id = r.customer_id
    CROSS JOIN LATERAL (
      SELECT round(COALESCE(public._gia_bang_don_vi(rl.product_id, rl.unit_name, c.group_id), 0) * (100 - 20) / 100) AS san,
             (SELECT min(l.unit_price) FROM public.sales_invoice_lines l
               WHERE l.invoice_id = r.invoice_id AND l.product_id = rl.product_id AND l.unit_name = rl.unit_name
                 AND NOT COALESCE(l.is_exchange, false)) AS ban
    ) g
   WHERE NOT COALESCE(rl.is_exchange, false)
     AND r.status <> 'cancelled'
     AND g.san > 0
     AND rl.unit_price < LEAST(g.san, COALESCE(g.ban, g.san)) - 1
)
SELECT 'Trigger sàn giá trả (return_lines)' AS hang_muc,
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_gia_san_dong_tra'
                          AND tgrelid = 'public.return_lines'::regclass)
            THEN 'OK' ELSE 'CHƯA' END AS ket_qua
UNION ALL
SELECT 'Dòng trả đang dưới sàn (phiếu chưa huỷ)',
       count(*) || ' dòng · ' || count(DISTINCT phieu) || ' phiếu (nháp / chờ: '
         || count(DISTINCT phieu) FILTER (WHERE status IN ('draft', 'submitted')) || ')'
  FROM duoi_san;
