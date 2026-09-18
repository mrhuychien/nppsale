-- ---------------------------------------------------------------------
-- 127 — Workflow v2b: đơn trả và phiếu thu bám hóa đơn
--
-- Phần cuối của bộ bốn: 124 (cấu trúc) · 125 (RPC) · 126 (số liệu) ·
-- 127 (đơn trả + phiếu thu).
-- ---------------------------------------------------------------------
--
-- ⚠ BA CHỖ V2B LÀM VỠ MÀ 124–126 CHƯA CHẠM TỚI:
--
--   1. `complete_return` chặn mọi đơn không ở đúng `'completed'`. Từ v2b
--      đơn giao một phần mang `'partially_invoiced'` và đơn chốt không
--      giao nốt mang `'closed'` — hàng của chúng ĐÃ rời kho, nhưng khách
--      trả lại thì bị từ chối với câu "đơn gốc chưa xuất hàng". Sai, và
--      sai theo kiểu người dùng không cãi lại được.
--
--   2. Trần số lượng trả trong `complete_return` vẫn đếm `sales_order_lines`.
--      Migration 124 đã đổi trigger sang đếm dòng HÓA ĐƠN; để hai chỗ nói
--      hai đằng thì phiếu trả lọt trigger rồi vấp ở RPC, hoặc ngược lại —
--      và thông báo lỗi nói về một con số người dùng không thấy ở đâu.
--
--   3. `cash_receipt_lines.invoice_id` (mig 124) chưa ai ghi. Cột rỗng
--      nghĩa là khoá "hóa đơn đã có tiền thu" của `cancel_invoice` phải
--      chặn rộng theo `order_id` — đúng về an toàn, nhưng chặn oan hóa
--      đơn đợt hai của một đơn mà đợt một đã thu tiền.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.sales_invoices') IS NULL THEN
    RAISE EXCEPTION
      'WF2B_NEEDS_124: chưa có bảng sales_invoices. Chạy migration 124 → 126 trước.'
      USING ERRCODE = 'P0001';
  END IF;
END $$;


-- =====================================================================
-- 1. Dòng phiếu thu tự gắn hóa đơn
-- =====================================================================
--
-- ⚠ TRIGGER, KHÔNG SỬA `create_cash_receipt`. Hàm đó dài 300 dòng và
--   chèn `cash_receipt_lines` ở BỐN chỗ khác nhau; vá bốn chỗ là bốn chỗ
--   để quên một chỗ, và chỗ quên ấy sẽ là chỗ không ai thử. Quan hệ này
--   suy ra được: một dòng công nợ thuộc đúng một hóa đơn, nên
--   `invoice_id` của dòng phiếu thu luôn bằng `invoice_id` của khoản nợ
--   nó đang trả.
--
-- ⚠ CHỈ ĐIỀN KHI ĐANG RỖNG. Đè lên giá trị đã có là xoá một liên kết ai
--   đó đặt có chủ ý — và §4 của quy ước nói thẳng: đừng gán đè lên cột
--   đang có giá trị tốt.
CREATE OR REPLACE FUNCTION public.fill_crl_invoice_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.invoice_id IS NULL AND NEW.receivable_id IS NOT NULL THEN
    SELECT rc.invoice_id INTO NEW.invoice_id
    FROM receivables rc WHERE rc.id = NEW.receivable_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_crl_invoice_id ON cash_receipt_lines;
CREATE TRIGGER trg_fill_crl_invoice_id
  BEFORE INSERT OR UPDATE OF receivable_id ON cash_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION public.fill_crl_invoice_id();

DO $$
DECLARE v_n int;
BEGIN
  UPDATE cash_receipt_lines crl
  SET invoice_id = rc.invoice_id
  FROM receivables rc
  WHERE crl.receivable_id = rc.id
    AND crl.invoice_id IS NULL
    AND rc.invoice_id IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '--- 127: gắn hóa đơn cho % dòng phiếu thu cũ ---', v_n;
END $$;


-- =====================================================================
-- 2. complete_return — nhập kho hàng khách trả
-- =====================================================================
--
-- Chép nguyên bản mig 120, đổi ĐÚNG BA CHỖ; phần nhập kho, chọn lô và
-- suy hạn dùng giữ từng chữ.
--
-- ⚠ CHỖ 1 — ĐIỀU KIỆN ĐƠN GỐC. `o2.status = 'completed'` đổi thành
--   `is_revenue_status(o2.status)`, tức ba trạng thái đã xuất hàng. Ý
--   định của chốt này là "hàng đã từng rời kho chưa"; sau v2b chỉ so với
--   một giá trị là trả lời sai hai trong ba ca.
--
-- ⚠ CHỖ 2 — TRẦN SỐ LƯỢNG TRẢ đếm `sales_invoice_lines` của
--   `returns.invoice_id`, khớp với trigger ở mig 124. Phiếu trả CHƯA gắn
--   hóa đơn thì rơi về cách cũ (đếm dòng đơn) — dữ liệu cũ vẫn phải xử
--   lý được.
--
-- ⚠ CHỖ 3 — TÍNH LẠI CÔNG NỢ theo HÓA ĐƠN khi phiếu có `invoice_id`.
CREATE OR REPLACE FUNCTION public.complete_return(p_return_id uuid, p_zone text)
RETURNS TABLE (entry_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r          record;
  v_entry    uuid;
  v_code     text;
  l          record;
  v_conv     numeric;
  v_base     numeric;
  v_batch    uuid;
  v_cost     numeric;
  v_exp      date;
  cap        record;
  v_sold     numeric;
  v_returned numeric;
  v_pname    text;
BEGIN
  SELECT id, org_id, order_id, invoice_id, status, requested_by INTO r
  FROM returns WHERE id = p_return_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RETURN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF r.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.user_has_permission(auth.uid(), 'returns.approve') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền hoàn thành đơn trả'
      USING ERRCODE = 'P0001';
  END IF;
  IF r.status <> 'submitted' THEN
    RAISE EXCEPTION 'RETURN_NOT_SUBMITTED: phiếu trả không ở Phiếu tạm'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_zone NOT IN ('sale', 'date') THEN
    RAISE EXCEPTION 'BAD_ZONE: kho nhận phải là sale hoặc date' USING ERRCODE = 'P0001';
  END IF;

  -- ⚠ Nhập lại hàng của một đơn CHƯA xuất là cộng khống tồn kho: số hàng
  --   đó chưa bao giờ rời kho.
  IF r.invoice_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM sales_invoices si
      WHERE si.id = r.invoice_id AND si.status = 'posted'
    ) THEN
      RAISE EXCEPTION
        'INVOICE_NOT_POSTED: hóa đơn gốc đã bị huỷ — hàng của nó đã hoàn về kho rồi, không nhập trả lần nữa'
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF r.order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sales_orders o2
    WHERE o2.id = r.order_id AND public.is_revenue_status(o2.status)
  ) THEN
    RAISE EXCEPTION 'ORDER_NOT_COMPLETED: đơn gốc chưa xuất hàng, không nhập trả được'
      USING ERRCODE = 'P0001';
  END IF;

  -- ===================================================================
  -- TRẦN SỐ LƯỢNG TRẢ, KIỂM LẠI Ở ĐÂY
  --
  -- ⚠ VÌ SAO PHẢI KIỂM HAI LẦN. Trigger `enforce_return_line_cap` chạy
  --   lúc CHÈN DÒNG, và phần "đã trả rồi" của nó chỉ đếm phiếu ở trạng
  --   thái 'completed'. Nên hai phiếu trả của cùng một hóa đơn, cùng nằm
  --   ở 'submitted', mỗi phiếu đều thấy "đã trả = 0" và đều LỌT:
  --     hóa đơn xuất 10 → phiếu A 10 lọt → phiếu B 10 cũng lọt
  --     → hoàn thành cả hai → nhập kho 20 và trừ công nợ gấp đôi.
  --
  -- ⚠ KIỂM Ở ĐÂY, KHÔNG SIẾT TRIGGER. Bắt trigger đếm cả phiếu
  --   'submitted' thì một phiếu lập nhầm rồi bỏ đó sẽ chiếm chỗ và chặn
  --   mất phiếu thật. Chặn đúng lúc hàng THẬT SỰ vào kho là chỗ duy nhất
  --   con số có ý nghĩa.
  --
  -- ⚠ MỐC LÀ HÓA ĐƠN, KHÔNG PHẢI ĐƠN — khách chỉ trả được thứ đã thực
  --   xuất. Đơn đặt 100 mà mới xuất 40 thì trần trả là 40; so với dòng
  --   đơn là cho phép nhập kho 60 món chưa từng rời kho.
  --
  -- ⚠ Dòng ĐỔI không tính — hàng đổi không trừ công nợ. Phiếu trả không
  --   gắn chứng từ nào cũng không: không có mốc để so.
  -- ===================================================================
  IF r.invoice_id IS NOT NULL OR r.order_id IS NOT NULL THEN
    FOR cap IN
      SELECT rl.product_id,
             sum(rl.quantity * COALESCE((
               SELECT pu.conversion FROM product_units pu
                WHERE pu.product_id = rl.product_id
                  AND pu.unit_name = rl.unit_name), 1)) AS need
      FROM return_lines rl
      WHERE rl.return_id = p_return_id AND rl.is_exchange = false
      GROUP BY rl.product_id
    LOOP
      IF r.invoice_id IS NOT NULL THEN
        SELECT COALESCE(sum(sil.quantity * COALESCE(sil.conversion_factor, 1)), 0)
          INTO v_sold
        FROM sales_invoice_lines sil
        WHERE sil.invoice_id = r.invoice_id
          AND sil.is_exchange = false
          AND sil.product_id = cap.product_id;

        SELECT COALESCE(sum(rl2.quantity * COALESCE((
                  SELECT pu.conversion FROM product_units pu
                   WHERE pu.product_id = rl2.product_id
                     AND pu.unit_name = rl2.unit_name), 1)), 0)
          INTO v_returned
        FROM return_lines rl2
        JOIN returns r2 ON r2.id = rl2.return_id
        WHERE r2.invoice_id = r.invoice_id
          AND r2.status = 'completed'
          AND rl2.is_exchange = false
          AND rl2.product_id = cap.product_id;
      ELSE
        -- Phiếu trả cũ chưa gắn hóa đơn: giữ nguyên cách đếm của v2.
        SELECT COALESCE(sum(sol.quantity * COALESCE(sol.conversion_factor, 1)), 0)
          INTO v_sold
        FROM sales_order_lines sol
        WHERE sol.order_id = r.order_id AND sol.product_id = cap.product_id;

        SELECT COALESCE(sum(rl2.quantity * COALESCE((
                  SELECT pu.conversion FROM product_units pu
                   WHERE pu.product_id = rl2.product_id
                     AND pu.unit_name = rl2.unit_name), 1)), 0)
          INTO v_returned
        FROM return_lines rl2
        JOIN returns r2 ON r2.id = rl2.return_id
        WHERE r2.order_id = r.order_id
          AND r2.status = 'completed'
          AND rl2.is_exchange = false
          AND rl2.product_id = cap.product_id;
      END IF;

      IF cap.need + v_returned > v_sold THEN
        SELECT name INTO v_pname FROM products WHERE id = cap.product_id;
        RAISE EXCEPTION
          'RETURN_QTY_EXCEEDS: "%" — đã xuất %, đã hoàn thành trả %, phiếu này thêm % là vượt',
          COALESCE(v_pname, cap.product_id::text), v_sold, v_returned, cap.need
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;

  v_code := 'NL-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS');
  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, notes)
  VALUES (r.org_id, v_code, 'import', 'posted', now(), auth.uid(),
          'Nhập lại từ phiếu trả ' || p_return_id::text)
  RETURNING id INTO v_entry;

  -- Hàng ĐỔI cũng vào kho như hàng trả; khác nhau ở chỗ nó không ghi có
  -- công nợ, và việc đó do credit_note_amount lo (mig 055).
  FOR l IN
    SELECT rl.id, rl.product_id, rl.unit_name, rl.quantity, rl.is_exchange
    FROM return_lines rl WHERE rl.return_id = p_return_id
  LOOP
    CONTINUE WHEN COALESCE(l.quantity, 0) <= 0;

    v_conv := COALESCE((SELECT pu.conversion FROM product_units pu
                         WHERE pu.product_id = l.product_id
                           AND pu.unit_name = l.unit_name), 1);
    IF v_conv <= 0 THEN v_conv := 1; END IF;
    v_base := l.quantity * v_conv;

    -- ⚠ Giá vốn phải theo hàng THẬT. Để 0 thì lần bán sau FIFO ăn vào lô
    --   này với giá vốn 0, lãi gộp báo cao hơn thực đúng bằng giá vốn số
    --   hàng đã trả.
    --
    -- ⚠ ƯU TIÊN PHIẾU XUẤT CỦA CHÍNH HÓA ĐƠN. Đơn xuất hai đợt có thể lấy
    --   từ hai lô giá vốn khác nhau; tra theo đơn là lấy phải giá của đợt
    --   kia. Không có hóa đơn thì rơi về cách cũ (tra theo đơn), rồi tới
    --   lô mới nhất cùng sản phẩm, rồi 0.
    v_cost := COALESCE(
      (SELECT slc.unit_cost
         FROM stock_line_consumptions slc
         JOIN stock_entry_lines sel ON sel.id = slc.line_id
        WHERE sel.product_id = l.product_id
          AND r.invoice_id IS NOT NULL
          AND sel.entry_id = (SELECT si.stock_entry_id FROM sales_invoices si
                               WHERE si.id = r.invoice_id)
        ORDER BY slc.created_at DESC LIMIT 1),
      (SELECT slc.unit_cost
         FROM stock_line_consumptions slc
         JOIN stock_entry_lines sel ON sel.id = slc.line_id
         JOIN stock_entries se ON se.id = sel.entry_id
        WHERE sel.product_id = l.product_id
          AND r.order_id IS NOT NULL
          AND se.ref_order_ids @> jsonb_build_array(r.order_id::text)
        ORDER BY slc.created_at DESC LIMIT 1),
      (SELECT b3.unit_cost FROM batches b3
        WHERE b3.product_id = l.product_id AND COALESCE(b3.unit_cost, 0) > 0
        ORDER BY b3.received_at DESC NULLS LAST LIMIT 1),
      0);

    SELECT b.id INTO v_batch
    FROM batches b
    WHERE b.org_id = r.org_id
      AND b.product_id = l.product_id
      AND b.warehouse_zone = p_zone
      AND COALESCE(b.status, 'available') = 'available'
    ORDER BY b.received_at DESC NULLS LAST, b.created_at DESC
    LIMIT 1;

    IF v_batch IS NULL THEN
      -- Lô mới: hạn dùng lấy từ lô xa nhất cùng sản phẩm; không có thì
      -- suy từ hạn sử dụng của sản phẩm; không có nữa thì một năm.
      SELECT max(b2.expires_at) INTO v_exp FROM batches b2
       WHERE b2.org_id = r.org_id AND b2.product_id = l.product_id;
      IF v_exp IS NULL THEN
        SELECT current_date + COALESCE(p.shelf_life_days, 365) INTO v_exp
        FROM products p WHERE p.id = l.product_id;
      END IF;

      INSERT INTO batches (
        org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand,
        unit_cost, warehouse_zone, received_at
      ) VALUES (
        r.org_id, l.product_id, 'RESTOCK-' || v_code, COALESCE(v_exp, current_date + 365),
        v_base, 0, v_cost, p_zone, now()
      )
      RETURNING id INTO v_batch;

      -- ⚠ batches có trigger tự xếp kho: lô sắp hết hạn bị đẩy sang kho
      --   date dù người dùng chọn kho bán. Ép lại đúng ý người duyệt.
      UPDATE batches SET warehouse_zone = p_zone WHERE id = v_batch;
    END IF;

    UPDATE batches SET qty_on_hand = qty_on_hand + v_base WHERE id = v_batch;

    INSERT INTO stock_entry_lines (
      entry_id, product_id, batch_id, unit_name, quantity,
      qty_in_transaction_uom, qty_in_base_uom, transaction_uom,
      conversion_factor_snapshot, unit_cost, notes
    ) VALUES (
      v_entry, l.product_id, v_batch, l.unit_name, round(l.quantity)::int,
      l.quantity, v_base, l.unit_name, v_conv, v_cost,
      CASE WHEN l.is_exchange THEN 'Hàng đổi thu về' ELSE 'Nhập lại từ đơn trả' END
    );
  END LOOP;

  UPDATE returns
  SET status = 'completed', completed_at = now(),
      completed_by = auth.uid(), destination_zone = p_zone
  WHERE id = p_return_id;

  -- ⚠ TÍNH LẠI THEO HÓA ĐƠN KHI CÓ. Đường qua `_wf2_recompute_receivable`
  --   giữ lại cho phiếu trả chưa gắn hóa đơn — nó tự nhận nuôi khi đơn
  --   chỉ có một hóa đơn, và DỪNG khi có nhiều hơn.
  IF r.invoice_id IS NOT NULL THEN
    PERFORM public._wf2b_recompute_receivable(r.invoice_id);
  ELSIF r.order_id IS NOT NULL THEN
    PERFORM public._wf2_recompute_receivable(r.order_id);
  END IF;

  PERFORM public._wf2_notify(
    r.requested_by, 'return_completed',
    'Phiếu trả đã hoàn thành', NULL, '/returns/' || p_return_id::text);

  RETURN QUERY SELECT v_entry;
END;
$$;


-- =====================================================================
-- 3. cancel_return — đảo phiếu trả đã hoàn thành
-- =====================================================================
--
-- ⚠ KHOÁ "ĐÃ CÓ TIỀN THU" ĐỔI MỐC SANG HÓA ĐƠN. Bản cũ hỏi cả ĐƠN có
--   đồng nào chưa; từ v2b một đơn có nhiều hóa đơn, nên đợt một đã thu
--   tiền sẽ khoá luôn việc huỷ một phiếu trả của đợt hai — hai chứng từ
--   chẳng liên quan gì tới nhau.
CREATE OR REPLACE FUNCTION public.cancel_return(p_return_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r       record;
  v_entry uuid;
  l       record;
  v_rows  int := 0;
  v_paid  boolean;
BEGIN
  SELECT id, org_id, order_id, invoice_id, status, applied_receipt_id INTO r
  FROM returns WHERE id = p_return_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RETURN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF r.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.user_has_permission(auth.uid(), 'returns.approve') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền huỷ đơn trả' USING ERRCODE = 'P0001';
  END IF;

  IF r.status = 'submitted' THEN
    UPDATE returns
    SET status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
    WHERE id = p_return_id;
    RETURN;
  END IF;

  IF r.status <> 'completed' THEN
    RAISE EXCEPTION 'RETURN_NOT_CANCELLABLE: phiếu ở trạng thái % không huỷ được', r.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Khoản có đã cấn vào phiếu thu thì không rút lại được ở đây.
  IF r.applied_receipt_id IS NOT NULL THEN
    RAISE EXCEPTION 'LOCKED_CREDIT_APPLIED: khoản có đã cấn trừ vào phiếu thu'
      USING ERRCODE = 'P0001';
  END IF;

  IF r.invoice_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM receivables rc
      WHERE rc.invoice_id = r.invoice_id AND COALESCE(rc.paid, 0) > 0
    ) INTO v_paid;
    IF v_paid THEN
      RAISE EXCEPTION 'LOCKED_CREDIT_APPLIED: hóa đơn gốc đã có tiền thu'
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF r.order_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM receivables rc
      WHERE rc.order_id = r.order_id AND COALESCE(rc.paid, 0) > 0
    ) INTO v_paid;
    IF v_paid THEN
      RAISE EXCEPTION 'LOCKED_CREDIT_APPLIED: đơn gốc đã có tiền thu'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Đảo đúng những lô đã nhập của chính phiếu trả này.
  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, notes)
  VALUES (r.org_id,
          'XK-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS'),
          'export', 'posted', now(), auth.uid(),
          'Đảo phiếu trả ' || p_return_id::text)
  RETURNING id INTO v_entry;

  FOR l IN
    SELECT sel.product_id, sel.batch_id, sel.unit_name, sel.quantity,
           sel.qty_in_base_uom, sel.conversion_factor_snapshot
    FROM stock_entry_lines sel
    JOIN stock_entries se ON se.id = sel.entry_id
    WHERE se.org_id = r.org_id
      AND se.type = 'import'
      AND se.notes = 'Nhập lại từ phiếu trả ' || p_return_id::text
  LOOP
    IF l.batch_id IS NOT NULL THEN
      UPDATE batches SET qty_on_hand = qty_on_hand - l.qty_in_base_uom WHERE id = l.batch_id;
    END IF;
    INSERT INTO stock_entry_lines (
      entry_id, product_id, batch_id, unit_name, quantity,
      qty_in_transaction_uom, qty_in_base_uom, transaction_uom,
      conversion_factor_snapshot, unit_cost, notes
    ) VALUES (
      v_entry, l.product_id, l.batch_id, l.unit_name, l.quantity,
      l.quantity, l.qty_in_base_uom, l.unit_name,
      COALESCE(l.conversion_factor_snapshot, 1), 0, 'Đảo do huỷ phiếu trả'
    );
    v_rows := v_rows + 1;
  END LOOP;

  -- ⚠ Phiếu trả hoàn thành TRƯỚC mig 120 do trigger cũ nhập kho, ghi chú
  --   khác hẳn nên không khớp được. Im lặng đi tiếp là ghi nợ lại cho
  --   khách trong khi hàng vẫn nằm trong kho. Nói ra và dừng.
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'NO_IMPORT_TO_REVERSE: không tìm được phiếu nhập của phiếu trả này, phải đảo kho bằng tay'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE returns
  SET status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
  WHERE id = p_return_id;

  IF r.invoice_id IS NOT NULL THEN
    PERFORM public._wf2b_recompute_receivable(r.invoice_id);
  ELSIF r.order_id IS NOT NULL THEN
    PERFORM public._wf2_recompute_receivable(r.order_id);
  END IF;
END;
$$;


-- =====================================================================
-- 4. `_wf2_recompute_receivable` thôi làm cầu tạm
-- =====================================================================
--
-- ⚠ KHÔNG GỠ, DÙ PACK ĐỊNH GỠ Ở PHASE NÀY. Sau mục 2 và 3 thì
--   `complete_return` / `cancel_return` đã gọi thẳng bản theo hóa đơn —
--   cầu không còn ai đi qua theo nghĩa cũ. Nhưng phiếu trả CHƯA gắn hóa
--   đơn thì vẫn cần nó: tiền giảm trừ của chúng không thuộc hóa đơn nào,
--   và bản theo hóa đơn không thấy chúng. Gỡ đi là khách trả hàng mà nợ
--   không giảm, im lặng.
--
--   Nên nó đổi VAI: từ "cầu tạm chờ P6" thành "đường cho phiếu trả chưa
--   gắn hóa đơn". Logic giữ nguyên, kể cả việc DỪNG khi đơn có nhiều hơn
--   một hóa đơn — ở ca đó đoán là ghi giảm nợ nhầm chứng từ.
COMMENT ON FUNCTION public._wf2_recompute_receivable(uuid) IS
  'Tính lại công nợ theo ĐƠN. Chỉ dùng cho phiếu trả chưa gắn hóa đơn '
  '(dữ liệu cũ): nhận nuôi khi đơn có đúng một hóa đơn, DỪNG khi có nhiều '
  'hơn. Phiếu trả có invoice_id đi thẳng _wf2b_recompute_receivable.';


NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_orphan int;
  v_multi  int;
  v_crl    int;
BEGIN
  SELECT count(*) INTO v_orphan
  FROM returns
  WHERE invoice_id IS NULL AND order_id IS NOT NULL
    AND status NOT IN ('draft', 'cancelled');

  SELECT count(*) INTO v_multi
  FROM returns r
  WHERE r.invoice_id IS NULL AND r.order_id IS NOT NULL
    AND r.status NOT IN ('draft', 'cancelled')
    AND (SELECT count(*) FROM sales_invoices si
          WHERE si.order_id = r.order_id AND si.status = 'posted') > 1;

  SELECT count(*) INTO v_crl
  FROM cash_receipt_lines WHERE invoice_id IS NOT NULL;

  RAISE NOTICE '--- 127: % phiếu trả chưa gắn hóa đơn · % dòng phiếu thu đã gắn ---', v_orphan, v_crl;
  IF v_multi > 0 THEN
    RAISE NOTICE '--- 127 ⚠ % phiếu trả trong số đó thuộc đơn có NHIỀU hóa đơn. Chúng sẽ DỪNG với RETURN_NEEDS_INVOICE khi tính lại công nợ — gắn tay `returns.invoice_id` cho chúng trước khi dùng tiếp. ---', v_multi;
  END IF;
END $$;
