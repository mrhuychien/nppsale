-- ====================================================================
-- BÁN ÂM XONG KHÔNG HUỶ ĐƯỢC HOÁ ĐƠN — VÀ BẢN VÁ 156 ĐÃ CHỮA SAI CHỖ
--
-- Chủ nhà báo 21/09/2026, nguyên văn câu lỗi trên màn:
--     NO_BATCH_TO_RESTOCK: "Bán gạo hàn quốc truyền thống 600g
--     ( 8 hộp/th)" (SP000554) chưa từng có lô nào trong kho, không hoàn
--     được 1.000000 đơn vị.
--
-- Và chủ nhà đoán đúng nguyên nhân: *"tao nghĩ do cho xuất kho âm nên
-- ko có lô -> ko hoàn được"*.
--
-- ĐÃ TÁI HIỆN QUA ĐÚNG ĐƯỜNG THẬT, không dựng tay: bật
-- `organizations.allow_oversell`, tạo một mặt hàng CHƯA TỪNG NHẬP KHO,
-- lập đơn, gọi `post_invoice` — hoá đơn ghi sổ BÌNH THƯỜNG, trả về
-- `short_qty = 1`; dòng phiếu xuất sinh ra có `batch_id` RỖNG và KHÔNG
-- MỘT dòng `stock_line_consumptions` nào. Gọi `cancel_invoice` thì ném
-- đúng câu lỗi trên.
--
-- VÌ SAO — VÀ VÌ SAO BẢN VÁ 156 CHƯA PHẢI CÂU TRẢ LỜI
--
--   Bán âm nghĩa là kho KHÔNG CÓ HÀNG ĐỂ TRỪ. `post_stock_export`
--   (mig 138) chạy hết vòng lặp lô mà không trừ được gì: không một lô
--   nào bị giảm, không một dòng dấu vết nào được ghi, `batch_id` của
--   dòng xuất ở lại RỖNG. Nó chỉ cộng dồn vào `short_qty` rồi ghi sổ.
--
--   Nên khi huỷ, KHÔNG CÓ GÌ ĐỂ HOÀN. Tồn kho lúc bán là 0, sau khi
--   bán vẫn là 0 — phép bán không hề trừ đi đâu cả. Hoàn 1 đơn vị vào
--   bất cứ lô nào cũng là DỰNG RA một đơn vị hàng không có thật.
--
-- ⚠ ĐÓ ĐÚNG LÀ THỨ BẢN VÁ 156 ĐANG LÀM. Nấc 3 của 156 đi tìm "lô gần
--   nhất cùng sản phẩm" rồi cộng hàng vào đó. Nấc ấy chỉ chạy khi
--   `batch_id` của dòng xuất RỖNG — mà (xem dưới) `batch_id` rỗng đồng
--   nghĩa với CHƯA TỪNG TRỪ LÔ NÀO. Nói cách khác nấc 3 chỉ có thể
--   chạy vào đúng những dòng không được phép hoàn. 156 làm cho nút Huỷ
--   bấm được, bằng cách thổi tồn kho lên. Đó là cái giá đắt hơn lỗi.
--
--   Và chẩn đoán của 156 cũng sai: nó viết "phép XUẤT không ghim vùng
--   kho". Đúng với mig 119, nhưng mig 138 — bản MỚI HƠN, đang chạy —
--   đã ghim `post_stock_export` vào đúng kho bán rồi. Thế lệch vùng kho
--   mà 156 đi chữa không còn tồn tại trong hệ.
--
-- CĂN CỨ ĐỂ NÓI "`batch_id` RỖNG = CHƯA TỪNG TRỪ LÔ NÀO"
--   · mig 107 (`post_stock_export` đầu tiên) và mig 119/138 đều đóng
--     `batch_id = COALESCE(v_best_id, batch_id)`, và `v_best_id` được
--     đặt ở MỌI lần lấy hàng (`v_take` luôn > 0 trong vòng lặp).
--   · Trước mig 107, phiếu xuất KHÔNG trừ tồn kho — chính header của
--     107 ghi điều đó. Nên chứng từ cũ cũng không có gì để hoàn.
--   Ba thời kỳ, cùng một kết luận: rỗng là chưa trừ.
--
-- SỬA GÌ
--
--   Bỏ hẳn nấc 3 — phép đoán lô. Không đoán, không dựng hàng, và cũng
--   KHÔNG CHẶN người dùng huỷ nữa:
--     · Có dấu vết lô  → hoàn đúng lô, trừ dần dấu vết (nấc 1, nguyên).
--     · Dòng ghi lô     → hoàn về lô ấy (nấc 2, nguyên).
--     · Không lô, không dấu vết → KHÔNG HOÀN GÌ, và nói ra.
--
--   `NO_BATCH_TO_RESTOCK` biến mất khỏi hàm. Nó là câu lỗi chặn người
--   dùng vì một tình huống lẽ ra không cần hoàn gì.
--
-- ⚠ DÒNG NHẬP GHI ĐÚNG SỐ THỰC HOÀN, KHÔNG GHI SỐ TRÊN HOÁ ĐƠN. Ghi đủ
--   `p_qty_base` trong khi chỉ hoàn được một phần là tự tay làm lệch sổ
--   nhập — đúng cái sai mà bản vá này đi dẹp. Phần bán âm ghi 0 kèm một
--   câu nói rõ, để người kiểm kê đọc được chứ không phải im lặng.
--
-- ⚠ PHẦN CÒN LẠI CỦA HÀM CHÉP NGUYÊN VĂN MIG 156. Lấy nhầm một bản
--   khác là mất phép trừ dần dấu vết ở nấc 1 — thứ giữ cho "sửa đơn
--   giảm 4 rồi huỷ đơn" không hoàn thừa 4 đơn vị.
-- ====================================================================

CREATE OR REPLACE FUNCTION public._wf2_restock(
  p_source_line_id uuid, p_qty_base numeric, p_note text, p_entry_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_left    numeric := p_qty_base;
  v_give    numeric;
  c         record;
  v_product uuid;
  v_unit    text;
  v_conv    numeric;
  v_cost    numeric;
  v_batch   uuid;
  v_first   uuid;
  v_note    text := p_note;
  v_to_zone text;
  /* Phần ghi sổ xuất mà kho KHÔNG hề trừ đi đâu — hàng bán âm. */
  v_untaken numeric := 0;
  v_back    numeric;
BEGIN
  IF COALESCE(p_qty_base, 0) <= 0 THEN RETURN; END IF;

  SELECT product_id, unit_name, COALESCE(conversion_factor_snapshot, 1), COALESCE(unit_cost, 0), batch_id
    INTO v_product, v_unit, v_conv, v_cost, v_batch
  FROM stock_entry_lines WHERE id = p_source_line_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Hệ số quy đổi 0 hoặc âm thì phép chia ở cuối hàm trả NULL, và cột
  -- quantity là NOT NULL — lỗi 23502 ở một chỗ chẳng liên quan gì.
  IF COALESCE(v_conv, 0) <= 0 THEN v_conv := 1; END IF;

  -- ⚠ TRỪ DẦN dấu vết đã hoàn. Không trừ thì lần hoàn sau lại thấy đủ số
  --   cũ: sửa đơn giảm 4 rồi huỷ đơn sẽ hoàn thêm cả 10, kho dôi ra 4
  --   thùng không có thật.
  FOR c IN
    SELECT id, batch_id, qty_in_base_uom
    FROM stock_line_consumptions
    WHERE line_id = p_source_line_id AND qty_in_base_uom > 0
    ORDER BY created_at DESC, id DESC
    FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_give := LEAST(c.qty_in_base_uom, v_left);
    UPDATE batches SET qty_on_hand = qty_on_hand + v_give WHERE id = c.batch_id;
    UPDATE stock_line_consumptions
    SET qty_in_base_uom = qty_in_base_uom - v_give
    WHERE id = c.id;
    v_left := v_left - v_give;
    v_first := COALESCE(v_first, c.batch_id);
  END LOOP;

  IF v_left > 0 THEN
    IF v_batch IS NOT NULL THEN
      /* Dòng xuất có ghi lô — chứng từ thời 107..118, chưa có bảng dấu
         vết. Hoàn về đúng lô ấy. */
      SELECT warehouse_zone INTO v_to_zone FROM batches WHERE id = v_batch;
      UPDATE batches SET qty_on_hand = qty_on_hand + v_left WHERE id = v_batch;
      v_first := COALESCE(v_first, v_batch);
      v_note := v_note || ' • phần không có dấu vết lô, hoàn về lô ghi trên dòng xuất'
                       || COALESCE(' ở kho ' || v_to_zone, '');
      v_left := 0;
    ELSE
      /**
       * ⚠ KHÔNG ĐOÁN LÔ, KHÔNG DỰNG HÀNG. Dòng xuất không ghi lô và
       *   không có dấu vết nghĩa là lúc ghi sổ KHÔNG MỘT LÔ NÀO bị trừ
       *   — hàng bán âm, hoặc chứng từ trước mig 107. Cộng số này vào
       *   một lô nào đó là tự tạo ra hàng không có thật.
       *
       * ⚠ VÀ KHÔNG CHẶN NGƯỜI DÙNG. Không có gì để hoàn thì huỷ hoá đơn
       *   vẫn phải xong; ném lỗi ở đây là giam tờ hoá đơn lại vì một
       *   việc lẽ ra không cần làm.
       */
      v_untaken := v_left;
      v_left    := 0;
    END IF;
  END IF;

  v_back := p_qty_base - v_untaken;

  IF v_untaken > 0 THEN
    /* ⚠ NÓI RA, ĐỪNG IM. Người kiểm kê phải biết tờ huỷ này không trả
       lại kho đơn vị nào, và vì sao. */
    v_note := v_note || ' • ⚠ '
              /* `FM` bỏ số 0 thừa nhưng CHỪA LẠI dấu chấm: 1 ra "1." */
              || trim(trailing '.' from to_char(v_untaken, 'FM999999990.999999'))
              || ' đơn vị bán âm: lúc ghi sổ phiếu xuất kho không có lô nào'
              || ' nên không trừ đi đâu — huỷ cũng không hoàn về đâu.';
  END IF;

  /* ⚠ GHI SỐ THỰC HOÀN. `p_qty_base` là số trên hoá đơn, không phải số
     quay lại kho. Ghi nhầm cái trước là sổ nhập dôi ra đúng phần bán âm. */
  INSERT INTO stock_entry_lines (
    entry_id, product_id, batch_id, unit_name, quantity,
    qty_in_transaction_uom, qty_in_base_uom, transaction_uom,
    conversion_factor_snapshot, unit_cost, notes
  ) VALUES (
    p_entry_id, v_product, v_first, v_unit,
    round(v_back / NULLIF(v_conv, 0))::int,
    v_back / NULLIF(v_conv, 0), v_back, v_unit,
    v_conv, v_cost, v_note
  );
END;
$$;

REVOKE ALL ON FUNCTION public._wf2_restock(uuid, numeric, text, uuid) FROM PUBLIC;

DO $$
BEGIN
  RAISE NOTICE '--- 157: huỷ hoá đơn bán âm không còn bị chặn, và không còn dựng tồn kho ảo ---';
END $$;

NOTIFY pgrst, 'reload schema';
