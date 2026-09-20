-- ====================================================================
-- 148 — CHUYỂN KHO: PHIẾU XUẤT KHO LÀM LUÔN VIỆC CHUYỂN GIỮA HAI KHO
-- ====================================================================
--
-- VÌ SAO
--   Chủ nhà chốt 20/09/2026: "Tích hợp thêm chuyển kho vào phiếu xuất
--   kho (VD chuyển từ kho hàng bán sang hàng date)".
--
--   Việc này vẫn xảy ra hằng ngày mà không có chỗ ghi. `stock_entries`
--   đã có sẵn loại `transfer` từ migration 001, nhưng KHÔNG có hàm nào
--   ghi sổ nó — nên trước hôm nay người dùng hoặc không ghi gì (tồn
--   theo kho sai), hoặc lập một phiếu xuất rồi một phiếu nhập (hàng
--   biến mất khỏi sổ rồi xuất hiện lại như hàng mới, mất hạn dùng và
--   mất giá vốn của lô).
--
-- ⚠ CHUYỂN KHO KHÔNG PHẢI XUẤT RỒI NHẬP. Lô hàng phải giữ NGUYÊN hạn
--   dùng và giá vốn khi sang kho mới. Xuất-rồi-nhập là khai một lô mới
--   với hạn do người gõ đặt — FIFO sau đó lấy sai thứ tự, và giá vốn
--   của mọi báo cáo lãi lỗ lệch đi.
--
-- ⚠ VÀ ĐÂY LÀ CÁI BẪY NẶNG NHẤT CỦA MIGRATION NÀY: trigger
--   `trg_batches_auto_zone_ins` (migration 028) chạy BEFORE INSERT trên
--   `batches` và TỰ ĐẨY mọi lô cận hạn về kho `date`. Nghĩa là nếu
--   phép chuyển kho tạo lô đích bằng một câu INSERT bình thường thì
--   một phiếu "chuyển từ kho date sang kho bán" sẽ lặng lẽ đáp xuống
--   ĐÚNG kho date — không lỗi, không cảnh báo, và người dùng đứng nhìn
--   một phiếu báo thành công mà hàng không nhúc nhích.
--
--   Hàm này KHÔNG lách trigger đó. Nó TỪ CHỐI thẳng, kèm tên mặt hàng
--   và hạn dùng: chuyển hàng cận hạn vào kho bán là phá đúng cái luật
--   mà migration 028 và 138 dựng lên (chỉ kho hàng bán mới xuất bán
--   được, và hàng gần hạn thì không được nằm ở đó). Lách trigger là
--   dùng một migration về chuyển kho để gỡ một chốt an toàn của kho.
--
-- ⚠ HUỶ PHIẾU CHUYỂN KHO: `cancel_stock_entry` (migration 139) chỉ
--   hoàn được `import` và `export`, và migration này CỐ Ý KHÔNG mở rộng
--   nó. Đảo một phép chuyển bằng cách trừ ngược kho đích là sai khi lô
--   ở kho đích đã bán đi một phần — và nó sai trong IM LẶNG, vì phép
--   trừ vẫn chạy được, chỉ là trừ vào hàng của người khác.
--
--   Đường đúng và đối xứng là LẬP MỘT PHIẾU CHUYỂN NGƯỢC LẠI: nó đi qua
--   đúng phép kiểm tồn và đúng FIFO của chiều xuôi. Nên nút Huỷ hiện
--   vẫn từ chối phiếu chuyển kho, với câu lỗi sẵn có của migration 139;
--   giao diện nói rõ đường đi ngược lại.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. Kho ĐÍCH của phiếu chuyển
-- --------------------------------------------------------------------
-- ⚠ `warehouse_zone` SẴN CÓ LÀ KHO NGUỒN. Đặt thêm một cột cho kho đích
--   chứ không nhét cả hai vào một cột: một cột mang hai nghĩa tuỳ loại
--   phiếu là chỗ để mọi câu truy vấn sau này đọc sai một nửa số phiếu.
ALTER TABLE stock_entries
  ADD COLUMN IF NOT EXISTS dest_warehouse_zone text
    CHECK (dest_warehouse_zone IS NULL OR dest_warehouse_zone IN ('sale', 'date'));

COMMENT ON COLUMN stock_entries.dest_warehouse_zone IS
  'Kho ĐÍCH của phiếu chuyển kho (type = transfer). NULL với mọi loại '
  'phiếu khác. Kho NGUỒN nằm ở warehouse_zone như thường lệ.';

-- --------------------------------------------------------------------
-- 2. post_stock_transfer — ghi sổ một phiếu chuyển kho
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_stock_transfer(p_entry_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org       uuid;
  v_status    text;
  v_type      text;
  v_src       text;
  v_dst       text;
  v_code      text;
  v_threshold integer;
  v_need      numeric;
  v_take      numeric;
  v_avail     numeric;
  v_pname     text;
  v_dest_id   uuid;
  v_batch     record;
  r           record;
BEGIN
  SELECT org_id, status, type, warehouse_zone, dest_warehouse_zone, entry_code
    INTO v_org, v_status, v_type, v_src, v_dst, v_code
  FROM stock_entries WHERE id = p_entry_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PHIEU_KHONG_TON_TAI: Không tìm thấy phiếu chuyển kho này.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'SAI_DON_VI: Phiếu này không thuộc đơn vị của bạn.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_type <> 'transfer' THEN
    RAISE EXCEPTION 'SAI_LOAI_PHIEU: Phiếu này không phải phiếu chuyển kho.'
      USING ERRCODE = 'P0001';
  END IF;
  -- ⚠ IDEMPOTENT. Bấm hai lần, hoặc bấm rồi mạng rớt rồi bấm lại,
  --   KHÔNG được chuyển hàng hai lần.
  IF v_status = 'posted' THEN
    RETURN p_entry_id;
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'PHIEU_KHONG_CON_TAM: Phiếu đang ở trạng thái "%" — chỉ phiếu tạm mới ghi sổ được.', v_status
      USING ERRCODE = 'P0001';
  END IF;
  IF v_dst IS NULL THEN
    RAISE EXCEPTION 'THIEU_KHO_DICH: Phiếu chuyển kho chưa chọn kho đích.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_dst = v_src THEN
    RAISE EXCEPTION 'TRUNG_KHO: Kho nguồn và kho đích đang là một (%). Chọn hai kho khác nhau.', v_src
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM stock_entry_lines WHERE entry_id = p_entry_id) THEN
    RAISE EXCEPTION 'PHIEU_KHONG_CO_HANG: Phiếu chưa có dòng hàng nào.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Ngưỡng "gần hạn" — đúng con số mà trigger tự động phân kho đang dùng.
  SELECT date_warehouse_threshold_days INTO v_threshold
  FROM pricing_rules WHERE org_id = v_org;
  IF v_threshold IS NULL THEN
    v_threshold := 30;
  END IF;

  /**
   * LƯỢT MỘT — KIỂM ĐỦ HÀNG, GOM THEO MẶT HÀNG.
   *
   * ⚠ GOM TRƯỚC KHI KIỂM. Người dùng có thể lỡ thêm cùng một mã thành
   *   hai dòng; kiểm từng dòng riêng thì mỗi dòng tự thấy "đủ hàng"
   *   trong khi tổng hai dòng thì không.
   */
  FOR r IN
    SELECT sel.product_id,
           MIN(sel.unit_name) AS unit_name,
           SUM(sel.qty_in_base_uom) AS need
    FROM stock_entry_lines sel
    WHERE sel.entry_id = p_entry_id
    GROUP BY sel.product_id
    HAVING SUM(sel.qty_in_base_uom) > 0
  LOOP
    SELECT COALESCE(SUM(qty_on_hand), 0) INTO v_avail
    FROM batches
    WHERE org_id = v_org AND product_id = r.product_id
      AND warehouse_zone = v_src AND COALESCE(status, 'available') = 'available';

    IF v_avail < r.need THEN
      SELECT name INTO v_pname FROM products WHERE id = r.product_id;
      RAISE EXCEPTION
        'KHONG_DU_TON: % — cần % %, kho % chỉ còn %. Giảm số lượng hoặc đổi kho nguồn.',
        COALESCE(v_pname, r.product_id::text),
        r.need, COALESCE(r.unit_name, 'đv cơ sở'),
        CASE WHEN v_src = 'date' THEN 'hàng date' ELSE 'hàng bán' END,
        v_avail
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  /**
   * LƯỢT HAI — CHUYỂN THẬT, THEO TỪNG DÒNG.
   *
   * ⚠ PHẢI ĐI THEO DÒNG, KHÔNG THEO MẶT HÀNG ĐÃ GOM.
   *   `stock_line_consumptions` khoá theo `line_id`, nên mỗi vết lấy lô
   *   phải gắn được vào đúng dòng phiếu đã sinh ra nó.
   */
  FOR r IN
    SELECT sel.id AS line_id, sel.product_id, sel.qty_in_base_uom AS need
    FROM stock_entry_lines sel
    WHERE sel.entry_id = p_entry_id AND sel.qty_in_base_uom > 0
    ORDER BY sel.id
  LOOP
    v_need := r.need;

    FOR v_batch IN
      SELECT id, qty_on_hand, unit_cost, batch_code, expires_at,
             manufactured_at, location, received_at
      FROM batches
      WHERE org_id = v_org
        AND product_id = r.product_id
        AND warehouse_zone = v_src
        AND COALESCE(status, 'available') = 'available'
        AND qty_on_hand > 0
      -- ⚠ FIFO: hạn cũ đi trước; `id` ở cuối cho thứ tự ổn định.
      ORDER BY expires_at NULLS LAST, created_at, id
      FOR UPDATE
    LOOP
      EXIT WHEN v_need <= 0;

      /**
       * ⚠ TỪ CHỐI CHỨ KHÔNG LÁCH. Trigger `trg_batches_auto_zone_ins`
       *   (migration 028) tự đẩy mọi lô cận hạn về kho `date`. Đưa một
       *   lô cận hạn vào kho bán thì hoặc trigger bẻ ngược lại trong im
       *   lặng, hoặc ta phải lách trigger — mà lách là gỡ đúng cái chốt
       *   an toàn "hàng gần hạn không nằm ở kho bán". Nói thẳng ra vẫn
       *   hơn, kèm tên hàng và hạn dùng để người dùng biết vì sao.
       */
      IF v_dst = 'sale'
         AND v_batch.expires_at IS NOT NULL
         AND v_batch.expires_at <= CURRENT_DATE + (v_threshold || ' days')::interval
      THEN
        SELECT name INTO v_pname FROM products WHERE id = r.product_id;
        RAISE EXCEPTION
          'HANG_GAN_HAN: % (lô %, hạn %) chỉ còn dưới % ngày nên không chuyển sang kho hàng bán được — hệ thống sẽ tự đẩy về kho hàng date. Bán hàng gần hạn qua kênh hàng date.',
          COALESCE(v_pname, r.product_id::text), v_batch.batch_code,
          to_char(v_batch.expires_at, 'DD/MM/YYYY'), v_threshold
          USING ERRCODE = 'P0001';
      END IF;

      v_take := LEAST(v_need, v_batch.qty_on_hand);

      -- Rời kho nguồn.
      UPDATE batches SET qty_on_hand = qty_on_hand - v_take WHERE id = v_batch.id;

      /**
       * Vào kho đích — GỘP VÀO LÔ CÙNG DANH TÍNH nếu đã có.
       *
       * ⚠ CÙNG DANH TÍNH = cùng mặt hàng, cùng mã lô, cùng hạn, cùng
       *   giá vốn. Thiếu `unit_cost` trong khoá gộp là trộn hai lô mua
       *   ở hai giá thành một, và giá vốn của cả cụm sai từ đó trở đi.
       */
      SELECT id INTO v_dest_id
      FROM batches
      WHERE org_id = v_org
        AND product_id = r.product_id
        AND warehouse_zone = v_dst
        AND batch_code IS NOT DISTINCT FROM v_batch.batch_code
        AND expires_at IS NOT DISTINCT FROM v_batch.expires_at
        AND unit_cost IS NOT DISTINCT FROM v_batch.unit_cost
        AND COALESCE(status, 'available') = 'available'
      LIMIT 1
      FOR UPDATE;

      IF v_dest_id IS NULL THEN
        INSERT INTO batches (
          org_id, product_id, batch_code, manufactured_at, expires_at,
          location, qty_initial, qty_on_hand, status, unit_cost,
          warehouse_zone, zone_moved_at, received_at
        ) VALUES (
          v_org, r.product_id, v_batch.batch_code, v_batch.manufactured_at,
          v_batch.expires_at, v_batch.location, v_take, v_take, 'available',
          v_batch.unit_cost, v_dst, now(),
          /* ⚠ GIỮ NGUYÊN `received_at` CỦA LÔ GỐC. Đặt `now()` là nói
             dối FIFO: lô cũ vừa chuyển kho bỗng thành lô mới nhất và
             được bán sau cùng. */
          v_batch.received_at
        )
        RETURNING id INTO v_dest_id;
      ELSE
        UPDATE batches
        SET qty_on_hand = qty_on_hand + v_take,
            qty_initial = qty_initial + v_take
        WHERE id = v_dest_id;
      END IF;

      /**
       * ⚠ VẾT LẤY LÔ vẫn ghi như phiếu xuất — nó là thứ trả lời được
       *   câu "hàng này đi từ lô nào". Phiếu chuyển kho KHÔNG huỷ được
       *   bằng `cancel_stock_entry` (xem chú thích đầu tệp), nhưng vết
       *   này là dữ liệu tra soát, không chỉ là nguyên liệu để huỷ.
       */
      INSERT INTO stock_line_consumptions (line_id, batch_id, qty_in_base_uom, unit_cost)
      VALUES (r.line_id, v_batch.id, v_take, v_batch.unit_cost);

      v_need := v_need - v_take;
    END LOOP;

    -- ⚠ CHỐT CHẶN DỰ PHÒNG: một giao dịch khác có thể vừa lấy mất hàng
    --   giữa hai lượt. Thà nổ ở đây còn hơn ghi sổ một phiếu chuyển
    --   thiếu trong im lặng.
    IF v_need > 0 THEN
      SELECT name INTO v_pname FROM products WHERE id = r.product_id;
      RAISE EXCEPTION
        'KHONG_DU_TON: % — hàng vừa bị lấy mất trong lúc ghi sổ, còn thiếu %. Thử lại.',
        COALESCE(v_pname, r.product_id::text), v_need
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  UPDATE stock_entries
  SET status = 'posted', posted_at = now()
  WHERE id = p_entry_id;

  RETURN p_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.post_stock_transfer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_stock_transfer(uuid) TO authenticated;

COMMENT ON FUNCTION public.post_stock_transfer(uuid) IS
  'Ghi sổ phiếu chuyển kho: chuyển FIFO từ warehouse_zone sang '
  'dest_warehouse_zone, GIỮ NGUYÊN hạn dùng và giá vốn của từng lô. '
  'Từ chối nếu đưa hàng gần hạn vào kho bán. Một giao dịch, idempotent.';

-- --------------------------------------------------------------------
-- Báo cáo hiện trạng
-- --------------------------------------------------------------------
DO $$
DECLARE v_n bigint;
BEGIN
  SELECT COUNT(*) INTO v_n FROM stock_entries WHERE type = 'transfer';
  RAISE NOTICE '--- 148: % phiếu chuyển kho đã có từ trước (chưa có hàm ghi sổ nên đều là phiếu tạm hoặc nhập tay) ---', v_n;
END $$;

NOTIFY pgrst, 'reload schema';
