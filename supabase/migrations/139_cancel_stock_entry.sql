-- ====================================================================
-- 139_cancel_stock_entry
--
-- CHỦ NHÀ BÁO 20/09/2026: "Khi huỷ phiếu nhập kho → kho không thay đổi."
--
-- VÌ SAO ĐÂY LÀ LỖ THỦNG SỔ SÁCH, KHÔNG PHẢI MỘT NÚT THIẾU
--
-- Huỷ phiếu kho hiện là một lệnh ghi thẳng từ trình duyệt:
--     UPDATE stock_entries SET status = 'cancelled' WHERE id = ...
-- Nó KHÔNG đụng `batches`, KHÔNG kiểm trạng thái hiện tại, và KHÔNG
-- kiểm xem có dòng nào bị RLS từ chối hay không. Hệ quả:
--   · huỷ phiếu NHẬP đã ghi sổ  → kho giữ lại hàng chưa từng có thật;
--   · huỷ phiếu XUẤT đã ghi sổ  → kho thiếu hàng vĩnh viễn;
--   · RLS từ chối → 0 dòng, HTTP 200, app vẫn báo "Đã hủy phiếu".
-- Cả hai chiều đều làm `batches` lệch `stock_entries`, và không có gì
-- trên màn hình nói ra.
--
-- ⚠ "ĐÃ XUẤT THÌ CHỈ CHO SỬA" (chủ nhà chốt). Nếu hàng của phiếu nhập đã
--   bán bớt thì hoàn lại sẽ làm lô âm — hàm này TỪ CHỐI và nói rõ còn
--   bao nhiêu, thay vì hoàn một phần rồi để sổ tự lệch.
--
-- ⚠ PHIẾU XUẤT CỦA MỘT HÓA ĐƠN KHÔNG HUỶ Ở ĐÂY. Huỷ hóa đơn còn phải xoá
--   công nợ và lùi trạng thái đơn — việc của `cancel_invoice` (mig 125).
--   Huỷ riêng phiếu kho là hoàn hàng về mà sổ nợ vẫn ghi khách còn nợ.
--
-- ⚠ HOÀN PHIẾU XUẤT PHẢI DỰA TRÊN `stock_line_consumptions` (mig 119) —
--   bảng ghi đã lấy bao nhiêu từ ĐÚNG lô nào. Phiếu xuất ghi sổ TRƯỚC
--   mig 119 không có dòng nào ở đó, nên không thể biết trả về lô nào:
--   hàm TỪ CHỐI và nói ra, chứ không đoán.
--
-- ⚠ PHIẾU CHUYỂN KHO / KIỂM KÊ chưa có đường hoàn ở đây. Từ chối kèm câu
--   giải thích còn hơn âm thầm đổi trạng thái mà không đụng kho — đó
--   đúng là hành vi đang hỏng.
--
-- IDEMPOTENT: phiếu đã huỷ rồi thì trả về `reversed = false` và không
-- làm gì. Bấm hai lần là chuyện bình thường, không phải lỗi.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.cancel_stock_entry(
  p_entry_id uuid,
  p_reason   text DEFAULT NULL
)
RETURNS TABLE (cancelled boolean, reversed boolean, lines_reversed int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org      uuid;
  v_status   text;
  v_type     text;
  v_code     text;
  l          record;
  c          record;
  v_n        int := 0;
  v_have     numeric;
  v_need     numeric;
  v_prod     text;
  v_inv      text;
BEGIN
  -- Khoá phiếu TRƯỚC khi đọc trạng thái: đọc rồi mới khoá thì hai lượt
  -- chạy song song đều thấy 'posted' và cùng hoàn kho một lần nữa.
  SELECT org_id, status, type, entry_code
    INTO v_org, v_status, v_type, v_code
  FROM stock_entries WHERE id = p_entry_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTRY_NOT_FOUND: không tìm thấy phiếu kho này.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH: phiếu này không thuộc đơn vị của bạn.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Đã huỷ rồi thì thôi. KHÔNG báo lỗi: bấm lại lần nữa là chuyện
  -- thường, và báo lỗi ở đây làm người dùng tưởng mình vừa làm hỏng.
  IF v_status = 'cancelled' THEN
    RETURN QUERY SELECT true, false, 0;
    RETURN;
  END IF;

  -- Phiếu nháp chưa trừ/cộng gì, chỉ cần đổi trạng thái.
  IF v_status <> 'posted' THEN
    UPDATE stock_entries
       SET status = 'cancelled',
           notes  = COALESCE(notes || E'\n', '') || 'Huỷ phiếu: ' || COALESCE(p_reason, '(không ghi lý do)')
     WHERE id = p_entry_id;
    RETURN QUERY SELECT true, false, 0;
    RETURN;
  END IF;

  -- ---- Từ đây là phiếu ĐÃ GHI SỔ: phải hoàn kho trước khi đổi trạng thái.

  IF v_type NOT IN ('import', 'export') THEN
    RAISE EXCEPTION
      'CANNOT_REVERSE_TYPE: phiếu % (%) đã ghi sổ nhưng chưa có đường hoàn kho cho loại phiếu này. Dùng phiếu điều chỉnh để sửa tồn.',
      v_code, v_type USING ERRCODE = 'P0001';
  END IF;

  IF v_type = 'export' THEN
    -- Phiếu xuất của một hóa đơn còn hiệu lực phải đi qua `cancel_invoice`.
    SELECT si.invoice_code INTO v_inv
    FROM sales_invoices si
    WHERE si.stock_entry_id = p_entry_id AND si.status = 'posted'
    LIMIT 1;
    IF v_inv IS NOT NULL THEN
      RAISE EXCEPTION
        'ENTRY_HAS_INVOICE: phiếu % thuộc hóa đơn %. Huỷ hóa đơn đó thay vì huỷ riêng phiếu kho — huỷ riêng thì hàng về kho mà sổ nợ vẫn ghi khách còn nợ.',
        v_code, v_inv USING ERRCODE = 'P0001';
    END IF;

    -- Không có vết đã lấy lô nào thì KHÔNG đoán.
    IF NOT EXISTS (
      SELECT 1 FROM stock_line_consumptions slc
      JOIN stock_entry_lines sel ON sel.id = slc.line_id
      WHERE sel.entry_id = p_entry_id
    ) THEN
      RAISE EXCEPTION
        'NO_CONSUMPTION_TRACE: phiếu % ghi sổ trước khi hệ thống lưu vết lấy lô, nên không biết trả hàng về lô nào. Dùng phiếu điều chỉnh để sửa tồn.',
        v_code USING ERRCODE = 'P0001';
    END IF;

    FOR c IN
      SELECT slc.batch_id, SUM(slc.qty_in_base_uom) AS qty
      FROM stock_line_consumptions slc
      JOIN stock_entry_lines sel ON sel.id = slc.line_id
      WHERE sel.entry_id = p_entry_id
      GROUP BY slc.batch_id
    LOOP
      UPDATE batches SET qty_on_hand = qty_on_hand + c.qty WHERE id = c.batch_id;
      v_n := v_n + 1;
    END LOOP;

  ELSE  -- import
    FOR l IN
      SELECT sel.id, sel.batch_id, sel.product_id,
             COALESCE(sel.qty_in_base_uom, sel.quantity, 0)::numeric AS qty
      FROM stock_entry_lines sel
      WHERE sel.entry_id = p_entry_id
      ORDER BY sel.id
    LOOP
      CONTINUE WHEN l.qty <= 0;

      IF l.batch_id IS NULL THEN
        SELECT name INTO v_prod FROM products WHERE id = l.product_id;
        RAISE EXCEPTION
          'NO_BATCH_LINK: dòng "%" của phiếu % không ghi lô nào, nên không biết rút hàng ra khỏi đâu. Dùng phiếu điều chỉnh để sửa tồn.',
          COALESCE(v_prod, l.product_id::text), v_code USING ERRCODE = 'P0001';
      END IF;

      SELECT qty_on_hand INTO v_have FROM batches WHERE id = l.batch_id FOR UPDATE;

      /*
        ⚠ "ĐÃ XUẤT THÌ CHỈ CHO SỬA" — chủ nhà chốt. Hàng của lô này đã
        bán bớt thì rút hết về sẽ làm lô âm. Từ chối và nói rõ còn bao
        nhiêu, để người dùng biết đường sửa phiếu thay vì huỷ.
      */
      IF COALESCE(v_have, 0) < l.qty THEN
        SELECT name INTO v_prod FROM products WHERE id = l.product_id;
        RAISE EXCEPTION
          'ALREADY_ISSUED: "%" của phiếu % đã xuất bớt — nhập % nhưng lô chỉ còn %. Phiếu đã xuất thì chỉ SỬA được, không huỷ được.',
          COALESCE(v_prod, l.product_id::text), v_code, l.qty, COALESCE(v_have, 0)
          USING ERRCODE = 'P0001';
      END IF;

      UPDATE batches SET qty_on_hand = qty_on_hand - l.qty WHERE id = l.batch_id;
      v_n := v_n + 1;
    END LOOP;
  END IF;

  UPDATE stock_entries
     SET status = 'cancelled',
         notes  = COALESCE(notes || E'\n', '') || 'Huỷ phiếu: ' || COALESCE(p_reason, '(không ghi lý do)')
   WHERE id = p_entry_id;

  RETURN QUERY SELECT true, true, v_n;
END;
$$;

COMMENT ON FUNCTION public.cancel_stock_entry(uuid, text) IS
  'Huỷ một phiếu kho VÀ hoàn kho trong cùng một giao dịch. Phiếu nhập: rút hàng khỏi lô đã tạo, từ chối nếu đã xuất bớt. Phiếu xuất: trả về đúng lô theo stock_line_consumptions, từ chối nếu phiếu thuộc hóa đơn còn hiệu lực. Idempotent.';

-- ⚠ SECURITY DEFINER thì phải khoá lại quyền gọi. Mặc định Postgres cấp
--   EXECUTE cho PUBLIC — để nguyên là ai chạm được database cũng gọi được.
REVOKE ALL ON FUNCTION public.cancel_stock_entry(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_stock_entry(uuid, text) TO authenticated;

DO $$
DECLARE v_posted int; v_no_trace int;
BEGIN
  SELECT count(*) INTO v_posted FROM stock_entries WHERE status = 'posted';
  SELECT count(*) INTO v_no_trace
  FROM stock_entries se
  WHERE se.status = 'posted' AND se.type = 'export'
    AND NOT EXISTS (
      SELECT 1 FROM stock_line_consumptions slc
      JOIN stock_entry_lines sel ON sel.id = slc.line_id
      WHERE sel.entry_id = se.id
    );
  RAISE NOTICE '--- 139: % phiếu đã ghi sổ · % phiếu xuất KHÔNG có vết lấy lô (huỷ sẽ bị từ chối, phải dùng phiếu điều chỉnh) ---',
    v_posted, v_no_trace;
END $$;

NOTIFY pgrst, 'reload schema';
