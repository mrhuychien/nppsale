-- ====================================================================
-- 143 — HUỶ PHIẾU TRẢ HÀNG NCC, ĐẢO NGƯỢC ĐÚNG NHỮNG GÌ ĐÃ LÀM
-- ====================================================================
--
-- VÌ SAO
--   Chủ nhà chốt: phiếu trả NCC phải có đủ ba trạng thái và "Huỷ thì
--   đảo ngược", giống hệt phiếu nhập hàng.
--
--   `supplier_returns` ĐÃ có sẵn ba trạng thái từ migration 068
--   (draft/completed/cancelled) và `complete_supplier_return` đã làm
--   đúng một giao dịch: trừ kho theo FIFO trong đúng zone, rồi ghi một
--   dòng công nợ ÂM (`payables.amount < 0`) — khoản NCC trả lại mình.
--
--   Nhưng KHÔNG CÓ ĐƯỜNG QUAY LẠI. Trạng thái `cancelled` tồn tại trong
--   CHECK constraint mà không hàm nào đặt được nó, và giao diện cũng
--   không có nút. Một phiếu gửi nhầm là hàng đã ra khỏi kho, công nợ đã
--   giảm, và không có cách nào sửa ngoài việc sửa tay trong cơ sở dữ
--   liệu.
--
-- ⚠ ĐẢO NGƯỢC BẰNG `stock_entry_lines.batch_id`, KHÔNG ĐI TÌM LÔ MỚI.
--   `complete_supplier_return` ghi lại ĐÚNG lô nào đã bị trừ và trừ bao
--   nhiêu. Cộng trả về đúng những lô ấy là khôi phục nguyên trạng — kể
--   cả hạn dùng và giá vốn của từng lô. Đi tìm lô theo FIFO lần nữa là
--   cộng hàng vào một lô KHÁC với hạn khác, và tồn thì đúng còn hạn thì
--   sai.
--
-- ⚠ TỪ CHỐI KHI NCC ĐÃ CẤN TRỪ TIỀN. Dòng công nợ của phiếu trả là số
--   ÂM; "đã trả" trên một dòng âm nghĩa là hai bên đã cấn trừ xong.
--   Xoá nó đi là xoá mất vết của lần cấn trừ ấy.
--
-- ⚠ KHÔNG KIỂM "HÀNG ĐÃ ĐỘNG" NHƯ BÊN PHIẾU NHẬP — và đây là chỗ hai
--   phép huỷ KHÁC NHAU, cố ý:
--     · Huỷ phiếu NHẬP là trừ đi số đã cộng. Nếu hàng đã bán bớt thì
--       trừ đủ là đẩy tồn xuống âm → phải từ chối.
--     · Huỷ phiếu TRẢ là cộng lại số đã trừ. Cộng luôn an toàn: kho chỉ
--       tăng, không có cách nào âm.
--   Cái phải canh ở đây là LÔ CÒN SỐNG: lô đã bị xoá hoặc đã đóng thì
--   cộng vào nó là cộng vào một chỗ không ai bán ra được.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.cancel_supplier_return(
  p_return_id uuid,
  p_reason    text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org     uuid;
  v_status  text;
  v_entry   uuid;
  v_payable uuid;
  v_uid     uuid := auth.uid();
  v_paid    numeric;
  v_dead    text;
  v_n       int := 0;
BEGIN
  SELECT org_id, status, stock_entry_id, payable_credit_id
    INTO v_org, v_status, v_entry, v_payable
  FROM supplier_returns WHERE id = p_return_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PHIEU_KHONG_TON_TAI: Không tìm thấy phiếu trả NCC này.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'SAI_DON_VI: Phiếu trả này không thuộc đơn vị của bạn.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ⚠ IDEMPOTENT. Bấm hai lần, hoặc bấm rồi mạng rớt rồi bấm lại, KHÔNG
  --   được cộng hàng về kho hai lần.
  IF v_status = 'cancelled' THEN
    RETURN p_return_id;
  END IF;

  -- Phiếu còn tạm thì huỷ là đổi một chữ; chưa đụng gì tới kho hay nợ.
  IF v_status = 'draft' THEN
    UPDATE supplier_returns
    SET status = 'cancelled', cancel_reason = p_reason
    WHERE id = p_return_id;
    RETURN p_return_id;
  END IF;

  -- 1) NCC đã cấn trừ tiền thì không huỷ được.
  IF v_payable IS NOT NULL THEN
    SELECT COALESCE(paid, 0) INTO v_paid FROM payables WHERE id = v_payable;
    IF COALESCE(v_paid, 0) <> 0 THEN
      RAISE EXCEPTION 'DA_CAN_TRU: Khoản giảm công nợ của phiếu này đã được cấn trừ (%). Gỡ phần cấn trừ trước rồi mới huỷ phiếu.', v_paid
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_entry IS NOT NULL THEN
    -- 2) Lô đã chết thì không cộng về được.
    SELECT string_agg(DISTINCT p.name, ' · ' ORDER BY p.name)
      INTO v_dead
    FROM stock_entry_lines sel
    JOIN products p ON p.id = sel.product_id
    LEFT JOIN batches b ON b.id = sel.batch_id
    WHERE sel.entry_id = v_entry
      AND (b.id IS NULL OR COALESCE(b.status, 'available') <> 'available');

    IF v_dead IS NOT NULL THEN
      RAISE EXCEPTION 'LO_DA_DONG: Không huỷ được vì lô hàng đã lấy không còn mở — %. Lập phiếu nhập kho điều chỉnh thay vì huỷ phiếu này.', v_dead
        USING ERRCODE = 'P0001';
    END IF;

    /**
     * 3) Cộng trả về ĐÚNG lô đã lấy.
     *
     * ⚠ `sel.quantity` LÀ SỐ THEO ĐƠN VỊ CƠ SỞ. `complete_supplier_return`
     *   ghi `v_take` (đã quy đổi) vào cả `quantity` lẫn
     *   `qty_in_base_uom`, nên cộng lại bằng chính cột đó là đối xứng.
     *   Dùng `qty_in_base_uom` cho chắc: nó là `numeric(18,6)` còn
     *   `quantity` là `integer` đã bị làm tròn.
     */
    UPDATE batches b
    SET qty_on_hand = b.qty_on_hand + sel.qty_in_base_uom
    FROM stock_entry_lines sel
    WHERE sel.entry_id = v_entry AND b.id = sel.batch_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    UPDATE stock_entries SET status = 'cancelled' WHERE id = v_entry;
  END IF;

  /**
   * 4) Gỡ con trỏ TRƯỚC, xoá dòng nợ SAU.
   *
   * ⚠ THỨ TỰ BẮT BUỘC. `supplier_returns.payable_credit_id` có khoá
   *   ngoại trỏ tới `payables`; xoá dòng nợ khi phiếu còn trỏ vào nó là
   *   Postgres từ chối. Đã gặp đúng lỗi này ở migration 142.
   *
   * ⚠ XOÁ HẲN, KHÔNG ĐÁNH DẤU. `payables.status` không có giá trị
   *   'cancelled'; để dòng âm nằm lại ở 'open' là một khoản giảm nợ ma
   *   trừ mãi vào công nợ NCC. Vết tích nằm ở chính phiếu.
   */
  UPDATE supplier_returns
  SET status = 'cancelled', cancel_reason = p_reason, payable_credit_id = NULL
  WHERE id = p_return_id;

  IF v_payable IS NOT NULL THEN
    DELETE FROM payables WHERE id = v_payable;
  END IF;

  RAISE NOTICE 'Huỷ phiếu trả NCC %: cộng trả % lô về kho.', p_return_id, v_n;
  RETURN p_return_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_supplier_return(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_supplier_return(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.cancel_supplier_return(uuid, text) IS
  'Huỷ phiếu trả hàng NCC và đảo ngược: cộng hàng trả về ĐÚNG lô đã '
  'lấy, xoá khoản giảm công nợ NCC. Từ chối nếu đã cấn trừ tiền hoặc lô '
  'đã đóng. Idempotent.';

-- --------------------------------------------------------------------
-- Cột lý do huỷ — 068 không có.
-- --------------------------------------------------------------------
ALTER TABLE supplier_returns
  ADD COLUMN IF NOT EXISTS cancel_reason text;

-- --------------------------------------------------------------------
-- Báo cáo hiện trạng
-- --------------------------------------------------------------------
DO $$
DECLARE
  v_done bigint;
  v_can  bigint;
BEGIN
  SELECT COUNT(*) INTO v_done FROM supplier_returns WHERE status = 'completed';
  SELECT COUNT(*) INTO v_can  FROM supplier_returns WHERE status = 'cancelled';
  RAISE NOTICE '--- 143: % phiếu trả NCC đã gửi (nay huỷ được), % phiếu đã huỷ từ trước ---', v_done, v_can;
END $$;

NOTIFY pgrst, 'reload schema';
