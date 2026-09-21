-- ====================================================================
-- HUỶ HOÁ ĐƠN BÁO `NO_BATCH_TO_RESTOCK` DÙ KHO CÓ HÀNG
--
-- Chủ nhà báo 21/09/2026, nguyên văn câu lỗi trên màn:
--     NO_BATCH_TO_RESTOCK: không tìm được lô để hoàn 1.000000 đơn vị
--
-- VÌ SAO XẢY RA
--
--   `_wf2_restock` (migration 120) hoàn hàng theo ba nấc:
--     1. về ĐÚNG các lô đã lấy, theo dấu vết `stock_line_consumptions`;
--     2. hết dấu vết thì về lô ghi trên chính dòng xuất (`batch_id`);
--     3. dòng không ghi lô nào thì về lô gần nhất CÙNG SẢN PHẨM.
--
--   Nấc 3 ghim cứng `warehouse_zone = 'sale'`. Nhưng phép XUẤT thì
--   KHÔNG ghim zone: `post_stock_export` (migration 119) duyệt mọi lô
--   `qty_on_hand > 0` của sản phẩm, kho nào cũng lấy. Nên một mặt hàng
--   chỉ có lô ở KHO CẬN DATE bán ra bình thường, mà huỷ hoá đơn thì
--   nấc 3 không tìm thấy lô nào ở kho bán và hàm ném lỗi.
--
--   Dòng xuất KHÔNG CÓ DẤU VẾT là dòng xuất trước migration 119 — đúng
--   loại chứng từ cũ còn nằm trong sổ của một nhà phân phối đang chạy.
--   Nên lỗi này chỉ nổ trên dữ liệu cũ, và nổ vào đúng lúc người dùng
--   cần huỷ một tờ hoá đơn.
--
--   Đã tái hiện trên Postgres 16: dòng xuất không dấu vết + mặt hàng
--   chỉ có lô ở kho cận date → ném `NO_BATCH_TO_RESTOCK`; thêm một lô
--   RỖNG ở kho bán (số lượng 0) → hoàn được ngay. Chỉ một biến khác
--   nhau, nên nguyên nhân là chỗ ghim zone chứ không phải thiếu hàng.
--
-- ⚠ VÀ HÀNG ĐANG HOÀN VỀ SAI KHO. Trong chính phép thử ấy, hàng rời
--   KHO CẬN DATE mà nấc 3 trả nó về KHO BÁN. Hàng cận hạn quay lại kho
--   bán là nó được bán tiếp cho khách sau — không ai thấy, vì con số
--   tồn vẫn đúng tổng.
--
-- ⚠ VÀ NẤC 3 THIẾU LỌC `org_id`. Hai nhà phân phối bán cùng một mã
--   hàng dùng chung bảng `products` thì lô của đơn vị kia lọt vào phép
--   chọn. Chưa nổ vì hệ đang chạy một đơn vị — nhưng đây là hàm
--   SECURITY DEFINER nên RLS không đỡ hộ.
--
-- SỬA GÌ
--
--   Giữ nguyên nấc 1 và nấc 2 — chúng đúng. Nấc 3 đổi thành bốn bước,
--   cùng một câu truy vấn, xếp theo độ CHẮC CHẮN giảm dần:
--     a. lô cùng sản phẩm, cùng đơn vị, ở ĐÚNG VÙNG KHO mà phiếu xuất
--        ghi — hàng rời kho nào thì về kho ấy;
--     b. rồi tới kho bán (giữ đúng hành vi cũ cho dữ liệu cũ);
--     c. rồi tới bất kỳ kho nào còn lại — thà hoàn đúng số vào sai kho
--        còn hơn chặn người dùng huỷ một tờ hoá đơn;
--     d. hết sạch thì mới ném lỗi, và câu lỗi GỌI TÊN mặt hàng.
--
--   Ghi chú dòng nhập nói rõ hàng về kho nào và vì sao con số này kém
--   chắc hơn — người kiểm kê phải đọc được điều đó.
--
-- ⚠ KHÔNG TỰ TẠO LÔ MỚI KHI SẢN PHẨM CHƯA TỪNG CÓ LÔ NÀO. Đó là dựng
--   hàng từ không khí kèm một giá vốn do máy đoán, và là quyết định của
--   chủ nhà chứ không phải của bản vá này. Trường hợp ấy vẫn ném lỗi —
--   nhưng nay câu lỗi nói rõ mặt hàng nào và phải làm gì.
--
-- ⚠ CHÉP NGUYÊN VĂN THÂN HÀM CỦA MIGRATION 120, chỉ đổi khối nấc 3 và
--   câu lỗi. Lấy nhầm một bản khác là mất phép trừ dần dấu vết ở nấc 1
--   — thứ giữ cho "sửa đơn giảm 4 rồi huỷ đơn" không hoàn thừa 4 đơn vị.
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
  v_org     uuid;
  v_zone    text;
  v_to_zone text;
  v_pname   text;
  v_psku    text;
BEGIN
  IF COALESCE(p_qty_base, 0) <= 0 THEN RETURN; END IF;

  SELECT product_id, unit_name, COALESCE(conversion_factor_snapshot, 1), COALESCE(unit_cost, 0), batch_id
    INTO v_product, v_unit, v_conv, v_cost, v_batch
  FROM stock_entry_lines WHERE id = p_source_line_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- ĐƠN VỊ và VÙNG KHO của phiếu xuất gốc — hai thứ nấc 3 cần.
  SELECT se.org_id, se.warehouse_zone
    INTO v_org, v_zone
  FROM stock_entry_lines sel
  JOIN stock_entries se ON se.id = sel.entry_id
  WHERE sel.id = p_source_line_id;

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
    IF v_batch IS NULL THEN
      /**
       * ⚠ BỐN BƯỚC, XẾP THEO ĐỘ CHẮC CHẮN GIẢM DẦN — xem đầu tệp.
       *   `ORDER BY` dưới đây là chỗ mang cả bốn: ưu tiên 1 là đúng
       *   vùng kho hàng vừa rời, 2 là kho bán, 3 là kho còn lại; trong
       *   mỗi bậc thì lô nhận gần đây nhất đi trước.
       *
       * ⚠ LỌC `org_id`. Bản cũ thiếu, và đây là hàm SECURITY DEFINER
       *   nên RLS không đỡ hộ: lô của đơn vị khác lọt vào phép chọn.
       */
      SELECT id, warehouse_zone
        INTO v_batch, v_to_zone
      FROM batches
      WHERE org_id = v_org
        AND product_id = v_product
      ORDER BY
        CASE
          WHEN warehouse_zone IS NOT DISTINCT FROM v_zone THEN 0
          WHEN warehouse_zone = 'sale'                    THEN 1
          ELSE 2
        END,
        received_at DESC NULLS LAST, created_at DESC
      LIMIT 1;
    ELSE
      SELECT warehouse_zone INTO v_to_zone FROM batches WHERE id = v_batch;
    END IF;

    IF v_batch IS NOT NULL THEN
      UPDATE batches SET qty_on_hand = qty_on_hand + v_left WHERE id = v_batch;
      v_first := COALESCE(v_first, v_batch);
      /* ⚠ NÓI RÕ VỀ KHO NÀO. Người kiểm kê phải biết con số này kém
         chắc hơn, và biết nó nằm ở đâu để đi đối chiếu. */
      v_note := v_note || ' • phần không có dấu vết lô, hoàn về lô gần nhất'
                       || COALESCE(' ở kho ' || v_to_zone, '');
      v_left := 0;
    END IF;
  END IF;

  IF v_left > 0 THEN
    /* ⚠ GỌI TÊN MẶT HÀNG. Câu lỗi cũ chỉ có con số, nên người dùng
       nhìn thấy "không tìm được lô để hoàn 1.000000 đơn vị" và không
       có cách nào biết là mặt hàng nào trong cả tờ hoá đơn. */
    SELECT name, sku INTO v_pname, v_psku FROM products WHERE id = v_product;
    RAISE EXCEPTION
      'NO_BATCH_TO_RESTOCK: "%" (%) chưa từng có lô nào trong kho, không hoàn được % đơn vị. Nhập một phiếu nhập cho mã này rồi huỷ lại.',
      COALESCE(v_pname, v_product::text), COALESCE(v_psku, '—'), v_left
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO stock_entry_lines (
    entry_id, product_id, batch_id, unit_name, quantity,
    qty_in_transaction_uom, qty_in_base_uom, transaction_uom,
    conversion_factor_snapshot, unit_cost, notes
  ) VALUES (
    p_entry_id, v_product, v_first, v_unit,
    round(p_qty_base / NULLIF(v_conv, 0))::int,
    p_qty_base / NULLIF(v_conv, 0), p_qty_base, v_unit,
    v_conv, v_cost, v_note
  );
END;
$$;

REVOKE ALL ON FUNCTION public._wf2_restock(uuid, numeric, text, uuid) FROM PUBLIC;

DO $$
BEGIN
  RAISE NOTICE '--- 156: huỷ hoá đơn hoàn được về kho hàng đã rời, không còn ghim cứng kho bán ---';
END $$;

NOTIFY pgrst, 'reload schema';
