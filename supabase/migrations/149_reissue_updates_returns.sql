-- ====================================================================
-- 149_reissue_updates_returns
--
-- SỬA HÓA ĐƠN THÌ SỬA LUÔN PHIẾU TRẢ KÈM NÓ — trong CÙNG MỘT giao dịch.
--
-- ⚠ CHỦ NHÀ CHỐT 21/09/2026: "Khi sửa và tạo hoá đơn cho phép sửa cả
--   đổi trả -> sửa thế nào cập nhật vào phiếu trả là xong".
--
-- VÌ SAO CẦN. `reissue_invoice` (mig 125) TỪ CHỐI khi hóa đơn mới không
-- còn bán món mà phiếu trả đang chờ đòi trả, và bảo người dùng "huỷ
-- phiếu trả trước". Luật từ chối ấy ĐÚNG — khách chỉ trả được thứ đã
-- thực xuất, và `complete_return` (mig 127) lấy chính hóa đơn làm TRẦN
-- số được trả. Nhưng lối thoát thì sai: huỷ CẢ phiếu là mất luôn những
-- dòng khác trên đó, và người dùng phải đi vòng qua hai màn.
--
-- NAY: màn soạn hóa đơn gửi kèm phần sửa của phiếu trả, và RPC áp nó
-- TRƯỚC khi kiểm. Người dùng bỏ một món khỏi hóa đơn thì bỏ luôn dòng
-- trả tương ứng, một lần bấm, một giao dịch.
--
-- ⚠ VÌ SAO PHẢI NẰM TRONG RPC CHỨ KHÔNG GHI TỪ TRÌNH DUYỆT. Sửa
--   `return_lines` là đụng `returns.credit_note_amount` (trigger
--   `trg_return_lines_sync_credit`, mig 035) và từ đó đụng CÔNG NỢ của
--   khách. Ghi từ trình duyệt rồi mới gọi RPC là hai bước: bước một
--   xong, bước hai hỏng, và phiếu trả đã bị sửa cho một hóa đơn không
--   bao giờ được lập. Trong RPC thì hoặc cả hai cùng xong, hoặc không
--   gì cả.
--
-- ⚠ CHỐT CHẶN GIỮ NGUYÊN. Phần kiểm REISSUE_BREAKS_RETURN vẫn đứng đó,
--   chỉ là chạy SAU khi đã áp phần sửa. Nó là lưới cuối: một tab cũ mở
--   sẵn, hay một nơi gọi quên gửi phần sửa, vẫn phải bị từ chối chứ
--   không được lặng lẽ tạo ra một phiếu trả đòi món chưa rời kho.
--
-- ⚠ KHÔNG GỬI GÌ THÌ KHÔNG ĐỤNG GÌ. `p->'return_edits'` vắng mặt là
--   hành vi y hệt trước migration này — nơi gọi cũ không phải sửa.
-- ====================================================================

-- --------------------------------------------------------------------
-- Áp phần sửa phiếu trả.
--
-- Hình dạng: [{ "line_id": uuid, "quantity": numeric }, ...]
--   · quantity > 0  → đặt lại số lượng, tính lại `line_total`.
--   · quantity <= 0 → XOÁ dòng ấy.
--
-- ⚠ TÍNH LẠI `line_total` Ở ĐÂY, ĐỪNG NHẬN TỪ TRÌNH DUYỆT. Con số ấy
--   đi thẳng vào `credit_note_amount` rồi vào công nợ; nhận số client
--   gửi là mở một đường ghi tiền tuỳ ý. Công thức lấy đúng của
--   `toReturnLine`: round(qty × unit_price × (1 + vat_rate)).
--
-- ⚠ CHỈ ĐỤNG DÒNG CỦA PHIẾU GẮN VÀO ĐÚNG HÓA ĐƠN NÀY, và chỉ phiếu còn
--   chờ xử lý. Không chặn thì một `line_id` gõ bừa sửa được phiếu trả
--   của khách khác — `SECURITY DEFINER` bỏ qua RLS.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._apply_return_edits(
  p_invoice_id uuid,
  p_edits      jsonb
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e       jsonb;
  v_line  record;
  v_qty   numeric;
  v_count int := 0;
BEGIN
  IF p_edits IS NULL OR jsonb_typeof(p_edits) <> 'array' THEN
    RETURN 0;
  END IF;

  FOR e IN SELECT * FROM jsonb_array_elements(p_edits)
  LOOP
    SELECT rl.id, rl.unit_price, rl.vat_rate
      INTO v_line
    FROM return_lines rl
    JOIN returns r ON r.id = rl.return_id
    WHERE rl.id = (e->>'line_id')::uuid
      AND r.invoice_id = p_invoice_id
      AND r.status IN ('draft', 'submitted');

    -- ⚠ KHÔNG TÌM THẤY THÌ BỎ QUA, KHÔNG NỔ. Người dùng có thể đã xoá
    --   dòng ấy ở tab khác; ném lỗi ở đây là chặn cả việc sửa hóa đơn
    --   vì một dòng vốn dĩ đã biến mất đúng như họ muốn.
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_qty := COALESCE((e->>'quantity')::numeric, 0);

    IF v_qty <= 0 THEN
      DELETE FROM return_lines WHERE id = v_line.id;
    ELSE
      UPDATE return_lines
      SET quantity   = v_qty,
          line_total = round(v_qty * COALESCE(unit_price, 0)
                             * (1 + COALESCE(vat_rate, 0)))
      WHERE id = v_line.id;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public._apply_return_edits(uuid, jsonb) IS
  'Áp phần sửa dòng phiếu trả của một hóa đơn, trong cùng giao dịch với '
  'reissue_invoice. quantity <= 0 nghĩa là xoá dòng. line_total tính lại '
  'ở server — không nhận từ client vì nó đi thẳng vào công nợ.';


-- --------------------------------------------------------------------
-- reissue_invoice — thêm bước áp phần sửa phiếu trả.
--
-- ⚠ CHÉP NGUYÊN BẢN MIG 125 RỒI CHÈN ĐÚNG MỘT KHỐI. Mọi chú thích và
--   thứ tự bước giữ y nguyên; đổi thêm bất cứ thứ gì ở đây là trộn hai
--   thay đổi vào một migration, và lần sau không ai tách ra được cái
--   nào gây lỗi.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reissue_invoice(p_invoice_id uuid, p jsonb)
RETURNS TABLE (
  invoice_id uuid, invoice_code text, entry_id uuid, receivable_id uuid,
  short_qty numeric, near_expiry_skipped int, order_status text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old     record;
  v_new     record;
  v_missing text;
  v_payload jsonb;
  v_rets    uuid[];
  v_edited  int;
BEGIN
  SELECT si.id, si.org_id, si.order_id, si.invoice_code, si.status INTO v_old
  FROM sales_invoices si WHERE si.id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_old.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- ⚠ ÁP PHẦN SỬA PHIẾU TRẢ TRƯỚC KHI KIỂM. Đây là cả điểm của
  --   migration 149: người dùng bỏ một món khỏi hóa đơn thì cũng bỏ
  --   dòng trả tương ứng, và phép kiểm ngay dưới nhìn thấy trạng thái
  --   ĐÃ sửa chứ không phải trạng thái cũ.
  v_edited := public._apply_return_edits(p_invoice_id, p->'return_edits');

  -- ⚠ Kiểm TRƯỚC KHI huỷ. Kiểm sau thì giao dịch có rollback thật,
  --   nhưng người dùng đã thấy "đang huỷ hóa đơn…" rồi mới nhận lỗi —
  --   và không cách nào biết hóa đơn cũ còn hay mất.
  SELECT string_agg(DISTINCT pr.name, ', ') INTO v_missing
  FROM return_lines rl
  JOIN returns r ON r.id = rl.return_id
  LEFT JOIN products pr ON pr.id = rl.product_id
  WHERE r.invoice_id = p_invoice_id
    AND r.status IN ('draft', 'submitted')
    AND rl.is_exchange = false
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p->'lines', '[]'::jsonb)) AS l
      WHERE (l->>'product_id')::uuid = rl.product_id
        AND COALESCE((l->>'quantity')::numeric, 0) > 0
        AND COALESCE((l->>'is_exchange')::boolean, false) = false
    );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'REISSUE_BREAKS_RETURN: hóa đơn mới không còn bán "%" mà phiếu trả đang chờ xử lý đòi trả. Bỏ dòng trả đó ở khối "Hàng đổi / trả kèm đơn" rồi lưu lại.',
      v_missing USING ERRCODE = 'P0001';
  END IF;

  -- ⚠ Phiếu trả đang chờ được gỡ khỏi hóa đơn cũ TRƯỚC khi huỷ, nếu
  --   không `cancel_invoice` sẽ huỷ luôn chúng (PATCH 1 nói rõ: chuyển
  --   sang hóa đơn mới, KHÔNG huỷ). Tạm để `invoice_id` rỗng trong vài
  --   dòng lệnh, rồi nối lại ngay dưới.
  --
  -- ⚠ GHI NHỚ ĐÍCH DANH TỪNG PHIẾU. Nối lại bằng điều kiện
  --   "cùng đơn và `invoice_id` rỗng" sẽ vơ luôn những phiếu trả vốn dĩ
  --   đã rỗng từ trước — phiếu trả độc lập của đơn này bỗng dưng bị gắn
  --   vào một hóa đơn nó không liên quan.
  SELECT COALESCE(array_agg(id), '{}') INTO v_rets
  FROM returns
  WHERE invoice_id = p_invoice_id AND status IN ('draft', 'submitted');

  UPDATE returns SET invoice_id = NULL WHERE id = ANY(v_rets);

  PERFORM public.cancel_invoice(
    p_invoice_id, 'Lập lại hóa đơn ' || v_old.invoice_code);

  v_payload := jsonb_set(COALESCE(p, '{}'::jsonb), '{order_id}',
                         to_jsonb(v_old.order_id::text));

  SELECT * INTO v_new FROM public.post_invoice(v_payload);

  UPDATE sales_invoices SET replaced_by   = v_new.invoice_id WHERE id = p_invoice_id;
  UPDATE sales_invoices SET replaced_from = p_invoice_id     WHERE id = v_new.invoice_id;

  UPDATE returns SET invoice_id = v_new.invoice_id WHERE id = ANY(v_rets);

  -- ⚠ PHIẾU TRẢ RỖNG DÒNG THÌ HUỶ HẲN, ĐỪNG ĐỂ NẰM CHỜ. Người dùng bỏ
  --   hết dòng trả nghĩa là "không còn trả gì nữa"; để lại một phiếu
  --   `submitted` không dòng nào là một việc treo vĩnh viễn ở hàng đợi
  --   kho, và `credit_note_amount` của nó đã về 0 nên huỷ không đụng
  --   đồng nào.
  UPDATE returns
  SET status = 'cancelled',
      cancel_reason = 'Bỏ hết dòng trả khi sửa hóa đơn ' || v_old.invoice_code
  WHERE id = ANY(v_rets)
    AND status IN ('draft', 'submitted')
    AND NOT EXISTS (SELECT 1 FROM return_lines rl WHERE rl.return_id = returns.id);

  RETURN QUERY SELECT v_new.invoice_id, v_new.invoice_code, v_new.entry_id,
                      v_new.receivable_id, v_new.short_qty,
                      v_new.near_expiry_skipped, v_new.order_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reissue_invoice(uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE v_fn int; v_pending int;
BEGIN
  SELECT count(*) INTO v_fn
  FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public'
    AND pr.proname IN ('reissue_invoice', '_apply_return_edits');

  SELECT count(*) INTO v_pending
  FROM returns WHERE status IN ('draft', 'submitted') AND invoice_id IS NOT NULL;

  RAISE NOTICE '--- 149: %/2 hàm đã dựng · % phiếu trả đang chờ gắn hóa đơn (nay sửa được ngay tại màn hóa đơn) ---',
    v_fn, v_pending;
END $$;
