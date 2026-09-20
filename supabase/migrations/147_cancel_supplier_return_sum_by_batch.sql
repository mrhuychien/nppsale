-- ====================================================================
-- 147 — HUỶ PHIẾU TRẢ NCC CỘNG TRẢ THIẾU KHI MỘT LÔ BỊ LẤY NHIỀU LẦN
-- ====================================================================
--
-- VÌ SAO
--   `cancel_supplier_return` (migration 143, dòng 120) cộng hàng về kho
--   bằng một câu:
--
--     UPDATE batches b
--     SET qty_on_hand = b.qty_on_hand + sel.qty_in_base_uom
--     FROM stock_entry_lines sel
--     WHERE sel.entry_id = v_entry AND b.id = sel.batch_id;
--
--   ⚠ POSTGRES CHỈ DÙNG **MỘT** DÒNG NGUỒN khi `UPDATE … FROM` khớp
--     cùng một dòng đích nhiều lần. Những dòng nguồn còn lại bị bỏ
--     IM LẶNG — không lỗi, không cảnh báo, không dòng nhật ký nào.
--
--   Nên một phiếu trả lấy hai lần từ CÙNG một lô (hai dòng cùng mặt
--   hàng trên một phiếu) thì lúc huỷ chỉ cộng trả về một phần. Đã dựng
--   lại trên Postgres 16: phiếu lấy 10 + 5 = 15 đơn vị từ một lô, huỷ
--   xong kho chỉ nhận lại 10. Năm đơn vị biến mất khỏi kho và không có
--   gì kêu lên.
--
--   Chứng minh tối giản, chạy được ở bất kỳ đâu:
--     CREATE TEMP TABLE t(id int PRIMARY KEY, q numeric);
--     INSERT INTO t VALUES (1, 0);
--     CREATE TEMP TABLE s(id int, q numeric);
--     INSERT INTO s VALUES (1, 10), (1, 5);
--     UPDATE t SET q = t.q + s.q FROM s WHERE s.id = t.id;
--     SELECT q FROM t;   -- ra 10, KHÔNG phải 15
--
-- CÁCH SỬA
--   Gom `SUM(qty_in_base_uom)` theo `batch_id` TRƯỚC rồi mới cộng. Sau
--   đó mỗi lô chỉ còn đúng một dòng nguồn, và phép cộng trả đủ.
--
-- ⚠ CHỈ ĐỔI ĐÚNG CÂU CỘNG TRẢ. Mọi chốt chặn khác của 143 — đã cấn trừ
--   tiền, lô đã đóng, idempotent, thứ tự gỡ con trỏ trước khi xoá dòng
--   nợ — giữ nguyên từng chữ. Đây là một phép sửa số học, không phải
--   một lần viết lại phép huỷ.
--
-- ⚠ KHÔNG ĐỘNG VÀO TỒN KHO HIỆN TẠI. Những phiếu ĐÃ GỬI mà CHƯA huỷ thì
--   chưa có gì sai — kho đang đúng. Chỉ những phiếu đã huỷ TRƯỚC
--   migration này mới có thể đã hụt, và migration không tự cộng bù:
--   cộng mò vào kho là một bút toán không ai ký. Phần DO ở cuối ĐẾM và
--   BÁO RA để chủ nhà biết có phiếu nào dính hay không.
--
-- ⚠ `cancel_purchase_invoice` (migration 142) KHÔNG dính lỗi này, đã
--   kiểm: nó `SET qty_on_hand = 0, status = 'cancelled'` — phép GÁN,
--   nên khớp nhiều dòng nguồn vẫn ra đúng một kết quả. Và câu
--   `UPDATE batches` ở migration 107 dùng truy vấn con tương quan, cũng
--   không dính. Toàn kho mã chỉ có đúng một chỗ CỘNG DỒN kiểu này.
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
     *
     * ⚠ GOM `SUM` THEO LÔ TRƯỚC (migration 147). Không gom thì Postgres
     *   chỉ lấy MỘT dòng `stock_entry_lines` cho mỗi lô và bỏ im lặng
     *   phần còn lại — một phiếu lấy 10 rồi lấy thêm 5 từ cùng một lô
     *   sẽ chỉ được cộng trả 10. Xem chú thích đầu tệp.
     */
    WITH gom AS (
      SELECT sel.batch_id, SUM(sel.qty_in_base_uom) AS qty
      FROM stock_entry_lines sel
      WHERE sel.entry_id = v_entry AND sel.batch_id IS NOT NULL
      GROUP BY sel.batch_id
    )
    UPDATE batches b
    SET qty_on_hand = b.qty_on_hand + gom.qty
    FROM gom
    WHERE b.id = gom.batch_id;
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
  'lấy (gom SUM theo lô — xem migration 147), xoá khoản giảm công nợ '
  'NCC. Từ chối nếu đã cấn trừ tiền hoặc lô đã đóng. Idempotent.';

-- --------------------------------------------------------------------
-- Báo cáo hiện trạng: phiếu nào ĐÃ HUỶ mà có lô bị lấy nhiều lần thì
-- kho đang hụt đúng phần chênh — liệt kê ra để chủ nhà quyết, KHÔNG tự
-- cộng bù (cộng mò vào kho là một bút toán không ai ký).
-- --------------------------------------------------------------------
DO $$
DECLARE
  v_da_huy   bigint := 0;
  v_hut      numeric := 0;
  v_con_song bigint := 0;
  r          record;
BEGIN
  /* Những phiếu ĐÃ HUỶ có lô bị lấy nhiều lần — kho đã hụt thật.
   *
   * ⚠ SỐ HỤT LÀ CẬN DƯỚI, không phải con số chính xác. Postgres chọn
   *   MỘT dòng nguồn bất kỳ, không phải dòng lớn nhất; `SUM - MAX` là
   *   trường hợp nó vô tình chọn đúng dòng lớn nhất, tức là hụt ÍT
   *   NHẤT chừng này. Không chắc thì nói là không chắc — đừng in một
   *   con số tròn trịa cho một thứ cơ sở dữ liệu không ghi lại. */
  FOR r IN
    SELECT sr.id, sr.return_code, SUM(x.thua) AS thieu
    FROM supplier_returns sr
    JOIN (
      SELECT sel.entry_id, sel.batch_id,
             SUM(sel.qty_in_base_uom) - MAX(sel.qty_in_base_uom) AS thua
      FROM stock_entry_lines sel
      WHERE sel.batch_id IS NOT NULL
      GROUP BY sel.entry_id, sel.batch_id
      HAVING COUNT(*) > 1
    ) x ON x.entry_id = sr.stock_entry_id
    WHERE sr.status = 'cancelled'
    GROUP BY sr.id, sr.return_code
  LOOP
    v_da_huy := v_da_huy + 1;
    v_hut := v_hut + COALESCE(r.thieu, 0);
    RAISE NOTICE '--- 147: phiếu ĐÃ HUỶ % (%) đã cộng trả thiếu ÍT NHẤT % đơn vị cơ sở ---',
      COALESCE(r.return_code, '(chưa có mã)'), r.id, r.thieu;
  END LOOP;

  /* Những phiếu CÒN HIỆU LỰC có lô bị lấy nhiều lần — kho đang ĐÚNG,
     nhưng nếu huỷ bằng bản cũ thì sẽ hụt. Từ nay huỷ đã đúng. */
  SELECT COUNT(DISTINCT sr.id) INTO v_con_song
  FROM supplier_returns sr
  JOIN (
    SELECT sel.entry_id, sel.batch_id
    FROM stock_entry_lines sel
    WHERE sel.batch_id IS NOT NULL
    GROUP BY sel.entry_id, sel.batch_id
    HAVING COUNT(*) > 1
  ) x ON x.entry_id = sr.stock_entry_id
  WHERE sr.status = 'completed';

  RAISE NOTICE '--- 147: % phiếu trả NCC đã huỷ từ trước bị cộng trả thiếu, tổng ÍT NHẤT % đơn vị cơ sở — KHÔNG tự cộng bù, lập phiếu nhập kho điều chỉnh nếu cần ---', v_da_huy, v_hut;
  RAISE NOTICE '--- 147: % phiếu trả NCC đang còn hiệu lực có lô bị lấy nhiều lần — kho hiện ĐÚNG, và từ nay huỷ cũng đúng ---', v_con_song;
END $$;

NOTIFY pgrst, 'reload schema';
