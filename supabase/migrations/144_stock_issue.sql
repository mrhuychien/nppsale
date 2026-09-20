-- ====================================================================
-- 144 — PHIẾU XUẤT KHO: BẢN ĐỐI XỨNG CỦA PHIẾU NHẬP KHO
-- ====================================================================
--
-- VÌ SAO
--   Chủ nhà chốt: "Làm thêm phiếu xuất kho tương tự phiếu nhập kho để
--   nhập xuất lẻ."
--
--   Kho hiện có nhiều đường CỘNG hàng (phiếu nhập hàng, phiếu nhập kho,
--   huỷ phiếu trả NCC) nhưng đường TRỪ thì chỉ có ba, và cả ba đều gắn
--   với một chứng từ khác: bán hàng (`post_stock_export`), trả hàng NCC
--   (`complete_supplier_return`), và kiểm kê (`post_stock_adjustment`).
--
--   Không có đường nào cho việc thường ngày: hàng vỡ, hàng biếu, hàng
--   mang đi hội chợ, hàng chuyển sang chi nhánh. Không có phiếu thì mấy
--   việc ấy hoặc không được ghi (tồn trên máy cao hơn tồn thật), hoặc
--   được ghi bằng một phiếu kiểm kê giả — và kiểm kê thì ghi lệch vào
--   CHI PHÍ HAO HỤT, làm bẩn báo cáo lãi lỗ.
--
-- ⚠ DÙNG LẠI `stock_entries` type='export'. Không dựng bảng mới: đây
--   đúng là một lần chuyển động kho, không hơn. Nghĩa là nó cũng thừa
--   hưởng luôn `cancel_stock_entry` (migration 139) để huỷ.
--
-- ⚠ GHI VẾT LẤY LÔ VÀO `stock_line_consumptions`. Migration 139 từ chối
--   huỷ những phiếu xuất KHÔNG có vết này (nó báo "6 phiếu xuất KHÔNG
--   có vết lấy lô" khi chạy). Phiếu mới mà không ghi vết là đẻ thêm
--   đúng loại phiếu không huỷ được ấy.
--
-- ⚠ FIFO TRONG ĐÚNG MỘT ZONE. Lấy tràn sang zone kia là tự ý bán hàng
--   cận date (xem migration 138) hoặc rút hàng bán để bù cho một phiếu
--   lẽ ra chỉ đụng kho date.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. Cột cho phiếu xuất lẻ
-- --------------------------------------------------------------------
ALTER TABLE stock_entries
  -- Lý do xuất: damaged / gift / transfer / other. Để TEXT tự do có
  -- nhãn ở giao diện, không thêm CHECK — lý do là chuyện nghiệp vụ,
  -- thêm một loại không nên phải chạy migration.
  ADD COLUMN IF NOT EXISTS issue_reason text,
  ADD COLUMN IF NOT EXISTS warehouse_zone text NOT NULL DEFAULT 'sale';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'stock_entries'::regclass AND conname = 'stock_entries_zone_chk'
  ) THEN
    ALTER TABLE stock_entries
      ADD CONSTRAINT stock_entries_zone_chk CHECK (warehouse_zone IN ('sale', 'date'));
  END IF;
END $$;

-- --------------------------------------------------------------------
-- 2. post_stock_issue — ghi sổ một phiếu xuất lẻ
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_stock_issue(p_entry_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org      uuid;
  v_status   text;
  v_type     text;
  v_zone     text;
  v_code     text;
  v_uid      uuid := auth.uid();
  v_need     numeric;
  v_take     numeric;
  v_avail    numeric;
  v_pname    text;
  v_batch    record;
  r          record;
BEGIN
  SELECT org_id, status, type, warehouse_zone, entry_code
    INTO v_org, v_status, v_type, v_zone, v_code
  FROM stock_entries WHERE id = p_entry_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PHIEU_KHONG_TON_TAI: Không tìm thấy phiếu xuất kho này.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'SAI_DON_VI: Phiếu này không thuộc đơn vị của bạn.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_type <> 'export' THEN
    RAISE EXCEPTION 'SAI_LOAI_PHIEU: Phiếu này không phải phiếu xuất kho.'
      USING ERRCODE = 'P0001';
  END IF;
  -- ⚠ IDEMPOTENT. Bấm hai lần, hoặc bấm rồi mạng rớt rồi bấm lại,
  --   KHÔNG được trừ kho hai lần.
  IF v_status = 'posted' THEN
    RETURN p_entry_id;
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'PHIEU_KHONG_CON_TAM: Phiếu đang ở trạng thái "%" — chỉ phiếu tạm mới ghi sổ được.', v_status
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM stock_entry_lines WHERE entry_id = p_entry_id) THEN
    RAISE EXCEPTION 'PHIEU_KHONG_CO_HANG: Phiếu chưa có dòng hàng nào.'
      USING ERRCODE = 'P0001';
  END IF;

  /**
   * LƯỢT MỘT — KIỂM ĐỦ HÀNG, GOM THEO MẶT HÀNG.
   *
   * ⚠ GOM TRƯỚC KHI KIỂM. Người dùng có thể lỡ thêm cùng một mã thành
   *   hai dòng; kiểm từng dòng riêng thì mỗi dòng tự thấy "đủ hàng"
   *   trong khi tổng hai dòng thì không, và kho xuống âm.
   *
   * ⚠ KIỂM TRỌN VẸN TRƯỚC KHI TRỪ MỘT ĐƠN VỊ NÀO. Trừ dần rồi mới phát
   *   hiện thiếu ở mặt hàng thứ năm là đã đụng vào bốn mặt hàng đầu —
   *   đúng là giao dịch sẽ quay lui, nhưng thông báo lỗi lúc đó chỉ nói
   *   được về một mặt hàng. Kiểm trước thì nói được ngay cái nào thiếu.
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
      AND warehouse_zone = v_zone AND COALESCE(status, 'available') = 'available';

    IF v_avail < r.need THEN
      SELECT name INTO v_pname FROM products WHERE id = r.product_id;
      RAISE EXCEPTION
        'KHONG_DU_TON: % — cần % %, kho % chỉ còn %. Giảm số lượng, đổi kho, hoặc nhập bù rồi ghi sổ lại.',
        COALESCE(v_pname, r.product_id::text),
        r.need, COALESCE(r.unit_name, 'đv cơ sở'),
        CASE WHEN v_zone = 'date' THEN 'hàng date' ELSE 'hàng bán' END,
        v_avail
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  /**
   * LƯỢT HAI — TRỪ THẬT, THEO TỪNG DÒNG.
   *
   * ⚠ PHẢI ĐI THEO DÒNG, KHÔNG THEO MẶT HÀNG ĐÃ GOM.
   *   `stock_line_consumptions` khoá theo `line_id` chứ không theo
   *   `entry_id`, nên mỗi vết lấy lô phải gắn được vào đúng dòng phiếu
   *   đã sinh ra nó. Gom rồi ghi vết là không có `line_id` để ghi.
   */
  FOR r IN
    SELECT sel.id AS line_id, sel.product_id, sel.qty_in_base_uom AS need
    FROM stock_entry_lines sel
    WHERE sel.entry_id = p_entry_id AND sel.qty_in_base_uom > 0
    ORDER BY sel.id
  LOOP
    v_need := r.need;

    FOR v_batch IN
      SELECT id, qty_on_hand, unit_cost
      FROM batches
      WHERE org_id = v_org
        AND product_id = r.product_id
        AND warehouse_zone = v_zone
        AND COALESCE(status, 'available') = 'available'
        AND qty_on_hand > 0
      -- ⚠ FIFO: hạn cũ đi trước. `id` ở cuối để thứ tự ỔN ĐỊNH khi hai
      --   lô cùng hạn cùng ngày tạo — không có nó thì hai lần chạy cho
      --   hai kết quả khác nhau.
      ORDER BY expires_at NULLS LAST, created_at, id
      FOR UPDATE
    LOOP
      EXIT WHEN v_need <= 0;
      v_take := LEAST(v_need, v_batch.qty_on_hand);

      UPDATE batches SET qty_on_hand = qty_on_hand - v_take WHERE id = v_batch.id;

      -- ⚠ VẾT LẤY LÔ — thứ làm cho phiếu này huỷ được sau này
      --   (`cancel_stock_entry`, migration 139). Phiếu xuất không có
      --   vết thì migration đó TỪ CHỐI huỷ.
      INSERT INTO stock_line_consumptions (line_id, batch_id, qty_in_base_uom, unit_cost)
      VALUES (r.line_id, v_batch.id, v_take, v_batch.unit_cost);

      v_need := v_need - v_take;
    END LOOP;

    -- ⚠ CHỐT CHẶN DỰ PHÒNG. Lượt một đã kiểm đủ, nhưng một giao dịch
    --   khác có thể vừa lấy mất hàng giữa hai lượt. Thà nổ ở đây còn
    --   hơn ghi sổ một phiếu xuất thiếu trong im lặng.
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

REVOKE EXECUTE ON FUNCTION public.post_stock_issue(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_stock_issue(uuid) TO authenticated;

COMMENT ON FUNCTION public.post_stock_issue(uuid) IS
  'Ghi sổ phiếu xuất kho lẻ: trừ kho FIFO trong đúng warehouse_zone và '
  'ghi vết lấy lô vào stock_line_consumptions (để cancel_stock_entry huỷ '
  'được). Một giao dịch, idempotent.';

-- --------------------------------------------------------------------
-- 3. Báo cáo hiện trạng
-- --------------------------------------------------------------------
DO $$
DECLARE
  v_exp  bigint;
  v_no   bigint;
BEGIN
  SELECT COUNT(*) INTO v_exp FROM stock_entries WHERE type = 'export' AND status = 'posted';
  -- ⚠ `stock_line_consumptions` KHOÁ THEO `line_id`, không theo
  --   `entry_id` — phải đi vòng qua `stock_entry_lines`.
  SELECT COUNT(*) INTO v_no
  FROM stock_entries e
  WHERE e.type = 'export' AND e.status = 'posted'
    AND NOT EXISTS (
      SELECT 1
      FROM stock_entry_lines sel
      JOIN stock_line_consumptions c ON c.line_id = sel.id
      WHERE sel.entry_id = e.id
    );
  RAISE NOTICE '--- 144: % phiếu xuất đã ghi sổ, trong đó % phiếu CŨ không có vết lấy lô (huỷ sẽ bị từ chối) ---', v_exp, v_no;
  RAISE NOTICE '--- 144: phiếu xuất lẻ lập từ nay LUÔN có vết, nên huỷ được ---';
END $$;

NOTIFY pgrst, 'reload schema';
