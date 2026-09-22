-- ====================================================================
-- BỎ TRẦN "CHỈ TRẢ ĐƯỢC HÀNG ĐÃ THỰC XUẤT"
--
-- Chủ nhà chốt 22/09/2026, nguyên văn:
--     "Bỏ logic này đi, khách hàng được trả mọi loại mặt hàng dù chưa
--      từng xuất. Vì phần mềm triển khai ngang xương, hàng người ta
--      nhập từ trước đấy rồi có vào phần mềm đâu."
--
-- Câu chặn chủ nhà gặp, nguyên văn trên màn sửa hóa đơn:
--     Chưa lưu được: bạn vừa bỏ "Trà thảo mộc 238g(18 gói/th)cty phương
--     huyền" khỏi hóa đơn HD-0119, nhưng khách đang có phiếu trả chờ xử
--     lý đòi trả lại đúng món đó.
--
-- VÌ SAO LUẬT CŨ TỒN TẠI, VÀ VÌ SAO NAY SAI
--
--   Luật cũ: khách chỉ trả được thứ đã THỰC XUẤT, và hóa đơn là TRẦN
--   của số được trả. Nó chặn đúng một rủi ro: nhập kho khống và trừ
--   công nợ khống.
--
--   Nhưng nó ngầm giả định MỌI hàng khách đang giữ đều có trong sổ. Nhà
--   phân phối này bật phần mềm giữa chừng — hàng tồn ở cửa hàng khách
--   mua từ trước đó không có dòng nào trong `sales_invoice_lines`. Với
--   những món ấy `v_sold` luôn bằng 0, nên MỌI phiếu trả đều bị từ chối.
--   Luật đúng trên một sổ đầy đủ, sai trên sổ thật của họ.
--
-- BỐN CHỖ CHẶN, PHẢI GỠ CẢ BỐN
--
--   Gỡ thiếu một chỗ là dời bức tường chứ không phá nó: người dùng lưu
--   được hóa đơn rồi vấp đúng câu từ chối ấy ở bước sau.
--     1. trigger `enforce_return_line_cap` (mig 119/124/134) — chặn
--        ngay lúc CHÈN dòng phiếu trả, ném `RETURN_QTY_EXCEEDS`;
--     2. `complete_return` (mig 127) — kiểm lại lúc hoàn thành phiếu;
--     3. `reissue_invoice` (mig 152) — ném `REISSUE_BREAKS_RETURN` khi
--        tờ hóa đơn sửa xong không còn bán một mã phiếu trả đang đòi;
--     4. phía trình duyệt: `returnsBrokenBy` trong
--        `src/lib/orders/invoice-editor.ts` và khối cảnh báo của
--        `invoice-editor.tsx` — chính chỗ in ra câu chủ nhà chụp.
--   Migration này gỡ ba chỗ đầu; chỗ thứ tư gỡ trong cùng commit.
--
-- ⚠ MẤT GÌ KHI GỠ. Nói thẳng để sau này không ai ngạc nhiên:
--   · Phiếu trả nay nhập kho và trừ công nợ theo số người dùng gõ,
--     KHÔNG còn con số nào của hệ thống đối chiếu lại.
--   · Hai phiếu trả trùng nhau của cùng một hóa đơn sẽ đi qua cả hai —
--     hàng vào kho hai lần, công nợ trừ hai lần. Trước đây phép kiểm ở
--     `complete_return` chặn đúng ca này.
--   Đây là đánh đổi chủ nhà đã chọn khi biết rõ: sổ không đầy đủ thì
--   một cái trần dựng trên sổ ấy chặn nhầm nhiều hơn chặn đúng.
--
-- ⚠ GIỮ LẠI HAI PHÉP KIỂM KHÁC, và chúng KHÔNG phải luật này:
--   · `INVOICE_NOT_POSTED` / `ORDER_NOT_COMPLETED` — phiếu trả gắn vào
--     một chứng từ chưa ghi sổ. Đó là lỗi trạng thái chứng từ, không
--     phải chuyện "món này chưa từng xuất". Phiếu trả ĐỘC LẬP (không
--     gắn hóa đơn, không gắn đơn) vốn đã không bị hai phép này đụng tới.
--
-- ⚠ HÀNG TRẢ VỀ VẪN CÓ CHỖ ĐỂ NHẬP. Mặt hàng chưa từng bán thì có thể
--   chưa có lô nào trong kho — `complete_return` đã tự tạo lô khi thiếu
--   (xem nhánh `INSERT INTO batches` trong chính hàm dưới đây), nên bỏ
--   trần không đẻ ra một bức tường mới ở bước nhập kho.
--
-- ⚠ CHÉP NGUYÊN VĂN HAI HÀM CỦA MIG 127 VÀ MIG 152, CẮT ĐÚNG HAI KHỐI.
--   Không gõ lại tay: hai hàm này dài 256 và 121 dòng, và chúng giữ
--   phép trừ công nợ, phép nhập kho, phép đánh số hóa đơn. Lấy nhầm một
--   bản cũ hơn là mất những thứ ấy mà không có gì báo.
--
-- ⚠ ĐÁNH SỐ 158, KHÔNG PHẢI 156. Nhánh `newdesign` đang giữ 156 và 157
--   cho hai bản vá khác; trùng số là hai tệp cùng số sau khi gộp, và
--   `scripts/build-combined-migration.sh` hết cơ sở để xếp thứ tự.
-- ====================================================================

-- ---------------------------------------------------------------------
-- 1. Trigger chặn lúc chèn dòng phiếu trả
-- ---------------------------------------------------------------------
--
-- ⚠ GỠ HẲN, KHÔNG ĐỂ MỘT TRIGGER RỖNG. Một hàm chỉ `RETURN NEW` vẫn là
--   một lời gọi cho mỗi dòng, và tệ hơn: người đọc sau sẽ tưởng còn một
--   phép kiểm nào đó ở đây.
DROP TRIGGER IF EXISTS trg_return_lines_cap ON return_lines;
DROP FUNCTION IF EXISTS public.enforce_return_line_cap();


-- ---------------------------------------------------------------------
-- 2. `complete_return` — bỏ phép kiểm trần lúc hoàn thành phiếu
-- ---------------------------------------------------------------------

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
  /* ⚠ HAI CỘT CUỐI LÀ MIẾNG VÁ CỦA MIG 134, GIỮ NGUYÊN DÙ TẠM THỜI
     KHÔNG AI ĐỌC. Mig 134 thêm `customer_id` và `credit_with_invoice`
     để tính trần trả theo KHÁCH; bản vá 158 bỏ hẳn khối trần ấy nên
     hiện không còn chỗ nào dùng tới. Vẫn chép lại vì hai lý do: chép
     thân hàm từ bản 127 mà bỏ dòng này là lặng lẽ xoá một miếng vá của
     migration SAU nó — đúng cái bẫy `tests/migration-khong-de-mat-
     mieng-va.test.ts` sinh ra để canh; và hàm này còn được viết lại
     nhiều lần nữa, lần nào cũng phải mang theo. */
  SELECT id, org_id, order_id, invoice_id, status, requested_by,
         customer_id, credit_with_invoice INTO r
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

  /* ⚠ TRẦN SỐ LƯỢNG TRẢ ĐÃ BỊ BỎ — xem đầu tệp migration 158. */

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

-- ---------------------------------------------------------------------
-- 3. `reissue_invoice` — bỏ `REISSUE_BREAKS_RETURN`
-- ---------------------------------------------------------------------

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
  v_added   int;
BEGIN
  SELECT si.id, si.org_id, si.order_id, si.invoice_code, si.status INTO v_old
  FROM sales_invoices si WHERE si.id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_old.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- ⚠ SỬA/BỎ TRƯỚC (mig 149), THÊM SAU (mig 152) — rồi mới kiểm.
  --   Thứ tự ấy có ý: một dòng vừa thêm KHÔNG được mang `line_id` nào
  --   để bị chính lượt sửa này bỏ đi.
  v_edited := public._apply_return_edits(p_invoice_id, p->'return_edits');
  v_added  := public._apply_return_adds(v_old.order_id, p_invoice_id, p->'return_adds');

  /* ⚠ PHÉP KIỂM `REISSUE_BREAKS_RETURN` ĐÃ BỊ BỎ — xem đầu tệp migration 158. */

  -- ⚠ BÍ DANH `rr` — MIẾNG VÁ CỦA MIG 128, mục 6.2. Tên trần ở đây là
  --   "column reference invoice_id is ambiguous" ngay giữa giao dịch.
  SELECT COALESCE(array_agg(rr.id), '{}') INTO v_rets
  FROM returns rr
  WHERE rr.invoice_id = p_invoice_id AND rr.status IN ('draft', 'submitted');

  UPDATE returns SET invoice_id = NULL WHERE id = ANY(v_rets);

  PERFORM public.cancel_invoice(
    p_invoice_id, 'Lập lại hóa đơn ' || v_old.invoice_code);

  v_payload := jsonb_set(COALESCE(p, '{}'::jsonb), '{order_id}',
                         to_jsonb(v_old.order_id::text));
  -- ⚠ GỠ `return_adds` TRƯỚC KHI GỌI `post_invoice` — NẾU KHÔNG DÒNG
  --   TRẢ BỊ THÊM HAI LẦN. `reissue_invoice` đã áp phần thêm ở trên (để
  --   phép kiểm nhìn thấy), rồi nó gọi `post_invoice` với CÙNG tải
  --   trọng ấy, mà `post_invoice` nay cũng áp `return_adds`. Đo trên
  --   Postgres thật trước khi phát hành: thêm 1 dòng trả 216.000 và 1
  --   dòng đổi thì sổ ghi thành hai bản mỗi loại, credit vọt từ
  --   316.000 lên 532.000 — tiền trừ công nợ khách GẤP ĐÔI.
  --
  -- ⚠ CHỈ GỠ `return_adds`. `return_edits` thì `post_invoice` không
  --   đụng tới, gỡ luôn là dọn một thứ không ai nhờ và che mất ý định
  --   của tải trọng khi đọc lại sau này.
  v_payload := v_payload - 'return_adds';
  -- ⚠ MIẾNG VÁ CỦA MIG 128, mục 6 — giữ số gốc HD-xxxx-n.
  v_payload := jsonb_set(v_payload, '{reissue_of}',
                         to_jsonb(p_invoice_id::text));

  SELECT * INTO v_new FROM public.post_invoice(v_payload);

  UPDATE sales_invoices SET replaced_by   = v_new.invoice_id WHERE id = p_invoice_id;
  UPDATE sales_invoices SET replaced_from = p_invoice_id     WHERE id = v_new.invoice_id;

  UPDATE returns SET invoice_id = v_new.invoice_id WHERE id = ANY(v_rets);

  -- ⚠ PHIẾU TRẢ RỖNG DÒNG THÌ HẠ VỀ PHIẾU TẠM — KHÔNG HUỶ NỮA.
  --
  -- ⚠ MIG 149 HUỶ HẲN, VÀ ĐÓ LÀ MỘT QUYẾT ĐỊNH SAI CỦA TÔI. Chủ nhà
  --   báo 21/09/2026: "tại sao khi huỷ hoá đơn lại huỷ cả phần trả về
  --   của Đơn hàng", kèm ảnh một phiếu trả mang nhãn "Đã huỷ · −0đ".
  --   Huỷ là ghi vào sổ rằng khách CHƯA TỪNG trả hàng — trong khi hàng
  --   có thể đang nằm đó thật, và không còn gì để người xử lý nhìn
  --   thấy. Đúng cái sai mà migration 131 đã sửa một lần cho
  --   `cancel_invoice`; tôi lặp lại nó ở chỗ khác.
  --
  -- ⚠ `draft` LÀ TRẠNG THÁI SẴN CÓ CHO ĐÚNG VIỆC NÀY — chủ nhà hỏi
  --   "có cần để thêm 1 trạng thái phiếu tạm cho phiếu trả để còn back
  --   trạng thái khi huỷ hoá đơn?". Không cần thêm: `cancel_invoice`
  --   (mig 131 + 133) đã hạ phiếu về `draft` và gỡ `invoice_id` đúng
  --   như vậy. Ở đây chỉ việc làm giống nó.
  --
  -- ⚠ VÀ CHỈ ĐỤNG KHI CHÍNH LƯỢT NÀY LÀM RỖNG NÓ (`v_edited > 0`).
  --   Không có điều kiện ấy thì một phiếu vốn dĩ đã rỗng từ trước bị
  --   hạ trạng thái ở lần sửa hóa đơn kế tiếp, dù người dùng không hề
  --   chạm vào nó.
  IF v_edited > 0 THEN
    UPDATE returns
    SET status = 'draft', invoice_id = NULL
    WHERE id = ANY(v_rets)
      AND status IN ('draft', 'submitted')
      AND NOT EXISTS (SELECT 1 FROM return_lines rl WHERE rl.return_id = returns.id);
  END IF;

  RETURN QUERY SELECT v_new.invoice_id, v_new.invoice_code, v_new.entry_id,
                      v_new.receivable_id, v_new.short_qty,
                      v_new.near_expiry_skipped, v_new.order_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reissue_invoice(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------
-- Đối chiếu: bao nhiêu phiếu trả đang kẹt vì cái trần vừa gỡ
-- ---------------------------------------------------------------------
--
-- ⚠ CHỈ ĐẾM, KHÔNG TỰ HOÀN THÀNH PHIẾU NÀO. Hoàn thành một phiếu trả là
--   đụng vào tồn kho và công nợ; đó phải là một cú bấm có người chịu
--   trách nhiệm, không phải việc của một migration.
DO $report$
DECLARE v_n int;
BEGIN
  SELECT count(DISTINCT r.id) INTO v_n
  FROM returns r
  JOIN return_lines rl ON rl.return_id = r.id AND rl.is_exchange = false
  WHERE r.status IN ('draft', 'submitted')
    AND r.invoice_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM sales_invoice_lines sil
      WHERE sil.invoice_id = r.invoice_id
        AND sil.is_exchange = false
        AND sil.product_id = rl.product_id
    );
  RAISE NOTICE '--- 158: bỏ trần trả hàng · % phiếu trả đang chờ có món không nằm trên hóa đơn gốc, nay hoàn thành được ---', v_n;
END $report$;

NOTIFY pgrst, 'reload schema';
