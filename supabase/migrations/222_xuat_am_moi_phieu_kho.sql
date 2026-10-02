-- ====================================================================
-- 222 — BẬT "CHO PHÉP BÁN VƯỢT TỒN" THÌ MỌI PHIẾU XUẤT KHO ĐỀU XUẤT ÂM ĐƯỢC
--
-- VÌ SAO — chủ nhà 02/10/2026: "Khi bật cho phép xuất tồn âm thì các phiếu xuất, trả ... liên quan đến kho cho
--   phép âm hết, hiện tại xuất trả NCC ko cho phép xuất tồn âm".
--   Cờ `organizations.allow_oversell` (Cài đặt › Đơn vị: "Cho phép bán vượt tồn kho") mới chỉ có tác dụng ở
--   `post_stock_export` (bán hàng / xuất hàng theo HĐ). Hai đường xuất kho còn lại vẫn chặn cứng:
--     - `complete_supplier_return` (trả hàng NCC, mig 146) → INSUFFICIENT_STOCK;
--     - `post_stock_issue` (phiếu xuất kho lẻ: hỏng, biếu, khác — mig 144) → KHONG_DU_TON.
--
-- CÁCH LÀM — chép NGUYÊN hai hàm (146, 144), chỉ thêm: đọc `allow_oversell`; bật thì phần thiếu vẫn ghi lên phiếu
--   (không gắn lô, không trừ lô), y như `post_stock_export` (mig 138). Tắt thì y như cũ (vẫn báo thiếu).
--   Huỷ phiếu trả NCC (`cancel_supplier_return`, mig 147): dòng không lô (phần thiếu) không còn chặn huỷ.
--   ⚠ Chuyển kho (`post_stock_transfer`, mig 148) KHÔNG đổi: chuyển hàng không có thật từ kho này sang kho kia là
--     đẻ ra tồn ở kho nhận.
-- ⚠ Hàm người dùng gọi (SECURITY DEFINER, tự kiểm org) — giữ GRANT cho authenticated như bản cũ.
-- ====================================================================

-- 1. Trả hàng NCC
CREATE OR REPLACE FUNCTION public.complete_supplier_return(p_return_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
  -- (mig 222) Đơn vị cho bán vượt tồn → phiếu trả NCC cũng xuất được khi kho không đủ.
  v_cho_am boolean;
  v_gia_von numeric;
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
  SELECT COALESCE(allow_oversell, false) INTO v_cho_am FROM organizations WHERE id = v_org;

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

    IF v_need > 0 AND v_cho_am THEN
      /* (mig 222) CHO XUẤT ÂM — như `post_stock_export`: phần thiếu vẫn ghi lên phiếu (không gắn lô, không trừ lô
         nào), tồn kho xuống dưới số trên phiếu cho tới khi nhập bù / kiểm kê. Giá vốn = giá lô gần nhất của mã.
         Huỷ phiếu (`cancel_supplier_return`) chỉ hoàn dòng có lô — phần thiếu không bị cộng khống lại. */
      SELECT unit_cost INTO v_gia_von FROM batches
       WHERE org_id = v_org AND product_id = r.product_id
       ORDER BY received_at DESC NULLS LAST, created_at DESC, id DESC LIMIT 1;
      v_seq := v_seq + 1;
      INSERT INTO stock_entry_lines (
        entry_id, product_id, batch_id, unit_name, quantity,
        qty_in_base_uom, qty_in_transaction_uom, transaction_uom,
        conversion_factor_snapshot, unit_cost, notes
      ) VALUES (
        v_entry_id, r.product_id, NULL, r.unit_name, v_need,
        v_need, v_need, r.unit_name,
        1, COALESCE(v_gia_von, 0), 'Xuất vượt tồn (đơn vị cho bán vượt tồn kho)'
      );
      v_need := 0;
    END IF;

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
$fn$;

-- 2. Phiếu xuất kho lẻ
CREATE OR REPLACE FUNCTION public.post_stock_issue(p_entry_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
  -- (mig 222) Đơn vị cho bán vượt tồn → phiếu xuất kho cũng ghi sổ được khi kho không đủ.
  v_cho_am   boolean;
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
  SELECT COALESCE(allow_oversell, false) INTO v_cho_am FROM organizations WHERE id = v_org;
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

    IF v_avail < r.need AND NOT v_cho_am THEN
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
    -- (mig 222) Cho xuất âm: phần thiếu nằm trên phiếu, không trừ lô nào (như `post_stock_export`); huỷ phiếu
    --   (`cancel_stock_entry`) chỉ hoàn theo vết lấy lô nên không cộng khống phần ấy.
    IF v_need > 0 AND NOT v_cho_am THEN
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
$fn$;

-- 3. Huỷ phiếu trả NCC — dòng phần thiếu (không lô) không chặn huỷ (bản 147 + một điều kiện)
CREATE OR REPLACE FUNCTION public.cancel_supplier_return(
  p_return_id uuid,
  p_reason    text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
      -- (mig 222) Dòng KHÔNG LÔ là phần xuất vượt tồn — không trừ lô nào nên không có gì để hoàn, không chặn huỷ.
      AND sel.batch_id IS NOT NULL
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
$fn$;

REVOKE EXECUTE ON FUNCTION public.complete_supplier_return(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_supplier_return(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.post_stock_issue(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_stock_issue(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_supplier_return(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_supplier_return(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 222: xuất âm theo cờ cho bán vượt tồn (trả NCC, phiếu xuất kho)' AS buoc,
       CASE WHEN position('v_cho_am' IN pg_get_functiondef('public.complete_supplier_return(uuid)'::regprocedure)) > 0
             AND position('v_cho_am' IN pg_get_functiondef('public.post_stock_issue(uuid)'::regprocedure)) > 0
             AND position('(mig 222)' IN pg_get_functiondef('public.cancel_supplier_return(uuid, text)'::regprocedure)) > 0
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua,
       (SELECT count(*) FROM organizations WHERE allow_oversell) AS don_vi_dang_cho_ban_vuot_ton;
