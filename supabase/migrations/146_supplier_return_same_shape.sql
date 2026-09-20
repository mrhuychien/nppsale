-- ====================================================================
-- 146 — PHIẾU TRẢ NCC DÙNG ĐÚNG KHUÔN PHIẾU NHẬP HÀNG
-- ====================================================================
--
-- VÌ SAO
--   Chủ nhà chốt: "hãy làm phiếu trả NCC tương tự". Hai chứng từ này là
--   hai chiều của cùng một việc với cùng một NCC, nên chúng phải có
--   cùng bộ ô và cùng phép tính. Hiện `supplier_return_lines` thiếu
--   `line_discount` và `sort_order`, còn `supplier_returns` thiếu
--   `discount` và `vat_override` — tức là bốn ô mà phiếu nhập có thì
--   phiếu trả không.
--
-- ⚠ VÀ MỘT LỖ HỔNG NẶNG HƠN: `complete_supplier_return` ĐANG NHẬN SỐ
--   TIỀN TỪ TRÌNH DUYỆT. Nó đọc `supplier_returns.total` — con số do
--   màn hình ghi xuống — rồi ghi thẳng vào `payables.amount` (số âm,
--   khoản NCC trả lại mình). Một lỗi làm tròn, một ô để trống, hay một
--   tab mở lâu là công nợ NCC lệch mà không có chỗ nào đối chiếu. Đúng
--   cái đã sửa cho phiếu nhập ở migration 142 và chưa sửa cho phiếu trả.
--
--   Từ đây RPC tự cộng lại từ dòng hàng, đúng quy ước của phiếu nhập:
--
--     tiền dòng = quantity × unit_price − line_discount
--     subtotal  = Σ tiền dòng
--     vat       = vat_override, hoặc Σ (tiền dòng × vat_rate)
--     total     = subtotal + vat − discount
--
-- ⚠ PHÉP TRỪ KHO KHÔNG ĐỔI MỘT CHỮ. `line_discount` chỉ đụng tới TIỀN;
--   số lượng hàng trả về NCC vẫn là `quantity × conversion_factor` như
--   cũ. Lẫn hai thứ là giảm giá 10% biến thành trả thiếu 10% số hàng.
-- ====================================================================

ALTER TABLE supplier_returns
  -- Giảm giá toàn phiếu, trừ SAU thuế — cùng quy ước với phiếu nhập.
  ADD COLUMN IF NOT EXISTS discount numeric NOT NULL DEFAULT 0,
  -- Tiền thuế gõ tay theo giấy NCC. NULL = để máy chủ tự cộng.
  ADD COLUMN IF NOT EXISTS vat_override numeric;

ALTER TABLE supplier_return_lines
  ADD COLUMN IF NOT EXISTS line_discount numeric NOT NULL DEFAULT 0,
  -- STT người dùng nhìn thấy. Không có nó thì thứ tự dòng phụ thuộc
  -- thứ tự Postgres trả về, và tờ in mỗi lần một khác.
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN supplier_returns.vat_override IS
  'Tiền thuế GTGT gõ tay theo giấy của NCC. NULL = để máy chủ tự cộng '
  'từ thuế suất của từng dòng. Cùng quy ước với purchase_invoices.';

-- --------------------------------------------------------------------
-- complete_supplier_return — tính lại tiền ở máy chủ
-- --------------------------------------------------------------------
-- ⚠ CHÉP NGUYÊN VĂN THÂN HÀM CỦA MIGRATION 071 (bản đang chạy) rồi chỉ
--   đổi phần TIỀN. Lấy nhầm bản của 068/070 là mất phép chèn đủ cột đơn
--   vị vào `stock_entry_lines` và mất câu lỗi INSUFFICIENT_STOCK có kèm
--   tên mặt hàng — hai thứ hai migration đó sinh ra để sửa.
CREATE OR REPLACE FUNCTION complete_supplier_return(p_return_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_status text;
  v_supplier uuid;
  v_zone text;
  v_other_zone text;
  v_return_code text;
  v_uid uuid := auth.uid();
  v_entry_id uuid;
  v_payable_id uuid;
  v_seq int := 0;
  v_base_qty numeric;
  v_need numeric;
  v_take numeric;
  v_batch record;
  v_pname text;
  v_punit text;
  v_avail_zone numeric;
  v_avail_other numeric;
  v_discount numeric;
  v_vat_ovr numeric;
  v_sub numeric := 0;
  v_vat numeric := 0;
  v_total numeric;
  r record;
BEGIN
  SELECT org_id, status, supplier_id, warehouse_zone, return_code,
         COALESCE(discount, 0), vat_override
    INTO v_org, v_status, v_supplier, v_zone, v_return_code, v_discount, v_vat_ovr
  FROM supplier_returns WHERE id = p_return_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PHIEU_KHONG_TON_TAI: Không tìm thấy phiếu trả NCC này.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'SAI_DON_VI: Phiếu trả này không thuộc đơn vị của bạn.'
      USING ERRCODE = 'P0001';
  END IF;
  -- ⚠ IDEMPOTENT: bấm hai lần không được xuất kho hai lần.
  IF v_status = 'completed' THEN
    RETURN p_return_id;
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'PHIEU_KHONG_CON_NHAP: Phiếu đang ở trạng thái "%" — chỉ phiếu nháp mới gửi được.', v_status
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM supplier_return_lines WHERE return_id = p_return_id) THEN
    RAISE EXCEPTION 'PHIEU_KHONG_CO_HANG: Phiếu chưa có dòng hàng nào.'
      USING ERRCODE = 'P0001';
  END IF;

  v_other_zone := CASE WHEN v_zone = 'sale' THEN 'date' ELSE 'sale' END;

  IF v_return_code IS NULL OR v_return_code = '' THEN
    v_return_code := 'TH-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS');
    UPDATE supplier_returns SET return_code = v_return_code WHERE id = p_return_id;
  END IF;

  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, supplier_id, notes, warehouse_zone)
  VALUES (
    v_org,
    'XK-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS'),
    'export', 'posted', now(), v_uid, v_supplier,
    'Xuất kho trả NCC — phiếu ' || v_return_code || ' (kho: ' || v_zone || ')',
    v_zone
  )
  RETURNING id INTO v_entry_id;

  FOR r IN
    SELECT l.id, l.product_id, l.unit_name, l.quantity, l.unit_price,
           COALESCE(l.line_discount, 0) AS line_discount,
           COALESCE(l.vat_rate, 0)      AS vat_rate,
           COALESCE(l.conversion_factor, 1) AS cf
    FROM supplier_return_lines l
    WHERE l.return_id = p_return_id
    ORDER BY l.sort_order, l.id
  LOOP
    /**
     * ⚠ TIỀN VÀ HÀNG TÍNH RIÊNG. `line_discount` chỉ trừ TIỀN; số lượng
     *   hàng trả vẫn là `quantity × conversion_factor`. Lẫn hai thứ là
     *   giảm giá 10% biến thành trả thiếu 10% số hàng.
     */
    v_sub := v_sub + (COALESCE(r.quantity, 0) * COALESCE(r.unit_price, 0) - r.line_discount);
    v_vat := v_vat + (COALESCE(r.quantity, 0) * COALESCE(r.unit_price, 0) - r.line_discount) * r.vat_rate;

    v_base_qty := COALESCE(r.quantity, 0) * r.cf;
    v_need := v_base_qty;
    IF v_need <= 0 THEN
      CONTINUE;
    END IF;

    FOR v_batch IN
      SELECT id, qty_on_hand, unit_cost
      FROM batches
      WHERE org_id = v_org
        AND product_id = r.product_id
        AND warehouse_zone = v_zone
        AND COALESCE(status, 'available') = 'available'
        AND qty_on_hand > 0
      -- FIFO: hạn cũ đi trước; `id` ở cuối cho thứ tự ổn định.
      ORDER BY expires_at NULLS LAST, created_at, id
      FOR UPDATE
    LOOP
      EXIT WHEN v_need <= 0;
      v_take := LEAST(v_need, v_batch.qty_on_hand);

      UPDATE batches SET qty_on_hand = qty_on_hand - v_take WHERE id = v_batch.id;

      -- ⚠ CHÉP Y NGUYÊN 071. Migration này CHỈ đụng tới TIỀN; đổi thêm
      --   `conversion_factor_snapshot` hay kiểu của `quantity` ở đây là
      --   lén sửa tờ phiếu xuất kho trong một migration nói về giảm giá.
      v_seq := v_seq + 1;
      INSERT INTO stock_entry_lines (
        entry_id, product_id, batch_id, unit_name, quantity,
        qty_in_base_uom, qty_in_transaction_uom, transaction_uom,
        conversion_factor_snapshot, unit_cost
      ) VALUES (
        v_entry_id, r.product_id, v_batch.id, r.unit_name, v_take,
        v_take, v_take, r.unit_name,
        1, COALESCE(v_batch.unit_cost, 0)
      );

      v_need := v_need - v_take;
    END LOOP;

    IF v_need > 0 THEN
      SELECT name, base_unit INTO v_pname, v_punit FROM products WHERE id = r.product_id;
      SELECT COALESCE(SUM(qty_on_hand), 0) INTO v_avail_zone
      FROM batches
      WHERE org_id = v_org AND product_id = r.product_id
        AND warehouse_zone = v_zone
        AND COALESCE(status, 'available') = 'available';
      SELECT COALESCE(SUM(qty_on_hand), 0) INTO v_avail_other
      FROM batches
      WHERE org_id = v_org AND product_id = r.product_id
        AND warehouse_zone = v_other_zone
        AND COALESCE(status, 'available') = 'available';

      -- ⚠ GIỮ NGUYÊN VĂN CÂU LỖI CỦA 071, kể cả dấu `|`. Màn hình dịch
      --   câu này bằng `friendlyReturnError`, và nó nhận dạng bằng đúng
      --   chuỗi `INSUFFICIENT_STOCK` rồi cắt theo dấu `|`. Đổi chữ ở đây
      --   là người dùng nhận nguyên câu lỗi thô của Postgres.
      RAISE EXCEPTION
        'INSUFFICIENT_STOCK | % (%): cần %, kho % còn %, kho % còn %',
        COALESCE(v_pname, r.product_id::text),
        COALESCE(v_punit, 'đv cơ sở'),
        v_base_qty,
        CASE WHEN v_zone = 'date' THEN 'hàng date' ELSE 'hàng bán' END,
        v_avail_zone,
        CASE WHEN v_other_zone = 'date' THEN 'hàng date' ELSE 'hàng bán' END,
        v_avail_other
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- ⚠ TIỀN THUẾ: SỐ GÕ TAY THẮNG SỐ TỰ CỘNG, cùng luật với phiếu nhập.
  IF v_vat_ovr IS NOT NULL THEN
    v_vat := GREATEST(0, v_vat_ovr);
  END IF;

  v_total := GREATEST(0, v_sub + v_vat - v_discount);

  /**
   * ⚠ DÒNG NỢ MANG SỐ ÂM — đây là khoản NCC trả lại mình. Ghi số dương
   *   là cộng thêm nợ thay vì giảm nợ, và công nợ NCC sai gấp đôi giá
   *   trị phiếu.
   */
  INSERT INTO payables (org_id, supplier_id, stock_entry_id, invoice_number, amount, paid, status, notes)
  VALUES (
    v_org, v_supplier, v_entry_id, v_return_code,
    -v_total, 0, 'open',
    'Hoàn trả NCC — phiếu ' || v_return_code
  )
  RETURNING id INTO v_payable_id;

  UPDATE supplier_returns
  SET status = 'completed',
      subtotal = v_sub,
      vat = v_vat,
      total = v_total,
      completed_at = now(),
      completed_by = v_uid,
      stock_entry_id = v_entry_id,
      payable_credit_id = v_payable_id
  WHERE id = p_return_id;

  RETURN p_return_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION complete_supplier_return(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_supplier_return(uuid) TO authenticated;

COMMENT ON FUNCTION complete_supplier_return(uuid) IS
  'Gửi phiếu trả NCC: xuất kho FIFO trong đúng warehouse_zone + ghi '
  'khoản GIẢM công nợ NCC (payables.amount âm). Tiền tính lại từ dòng '
  'hàng, không nhận số của trình duyệt. Một giao dịch, idempotent.';

DO $$
DECLARE v_n bigint;
BEGIN
  SELECT COUNT(*) INTO v_n FROM supplier_returns WHERE status = 'completed';
  RAISE NOTICE '--- 146: % phiếu trả NCC đã gửi từ trước GIỮ NGUYÊN số tiền đã ghi; phép tính mới chỉ áp cho phiếu gửi từ nay ---', v_n;
END $$;

NOTIFY pgrst, 'reload schema';
