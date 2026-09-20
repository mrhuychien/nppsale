-- ====================================================================
-- 142 — PHIẾU NHẬP HÀNG: ĐÁNH THỨC MÔ HÌNH ĐÚNG ĐÃ NẰM SẴN
-- ====================================================================
--
-- CHUYỆN ĐÃ XẢY RA — đọc kỹ trước khi sửa gì ở đây.
--
--   Migration 065 đã dựng đúng mô hình chủ nhà đang yêu cầu: bảng
--   `purchase_invoices` với ba trạng thái draft/completed/cancelled, và
--   RPC `complete_purchase_invoice` làm một transaction gồm nhập kho +
--   ghi công nợ NCC. Nhưng KHÔNG MỘT MÀN NÀO trong app gọi tới nó —
--   `grep` cả `src/` chỉ ra đúng một chỗ đọc bảng đó, là báo cáo NCC.
--
--   Việc nhập hàng thật đang chạy ở `/inventory/stock-in`: 999 dòng
--   TypeScript tự ghi thẳng `stock_entries` → `batches` →
--   `stock_entry_lines` → `payables` bằng một vòng lặp TỪ TRÌNH DUYỆT,
--   không transaction. Mạng rớt giữa chừng là kho đã cộng mà công nợ
--   chưa ghi, hoặc ngược lại — và không có gì dọn lại.
--
--   Chủ nhà đã tự gỡ nút thắt này trong chính yêu cầu: "Phiếu nhập kho
--   chuyển hẳn sang phần Kho vận (dùng để nhập kho thông thường)". Tức
--   là `stock_entries` trở về đúng việc của nó — một lần chuyển động
--   kho — còn PHIẾU NHẬP HÀNG (có NCC, có hoá đơn đầu vào, có công nợ)
--   là chứng từ riêng, chính là `purchase_invoices`.
--
--   Nên migration này KHÔNG dựng bảng mới. Nó bù những cột mô hình cũ
--   còn thiếu so với yêu cầu, rồi viết lại RPC cho đủ.
--
-- ⚠ LỊCH SỬ NHẬP HÀNG CŨ KHÔNG TỰ CHUYỂN SANG. Mọi phiếu nhập từ trước
--   nằm ở `stock_entries`, không ở `purchase_invoices`. Migration này
--   KHÔNG chép chúng sang — chép là đoán lại giá, thuế và giảm giá của
--   những chứng từ không ghi mấy con số đó, rồi dựng ra công nợ thứ hai
--   cho cùng một lần nhập. Màn "Hoá đơn mua (tra cứu)" vẫn đọc
--   `stock_entries` nên lịch sử cũ không mất đi đâu cả. Nếu chủ nhà muốn
--   gộp một mối, đó là một migration backfill RIÊNG và phải bàn trước.
--
-- ⚠ QUY ƯỚC TIỀN CỦA PHIẾU NHẬP KHÁC PHIẾU BÁN — cố ý, và phải nhớ.
--   Bên bán, `line_discount` chỉ GHI NHỚ đã giảm bao nhiêu so với giá
--   bảng; chiết khấu đã nằm sẵn trong `unit_price` (xem
--   `src/lib/sell/create-order.ts`). Bên mua thì NCC ghi giảm giá thành
--   một dòng riêng trên hoá đơn giấy, nên ở đây nó TRỪ THẬT:
--
--     tiền dòng   = quantity × unit_price − line_discount
--     subtotal    = Σ tiền dòng
--     vat         = Σ (tiền dòng × vat_rate)
--     total       = subtotal + vat − discount        ← "Cần trả NCC"
--
--   `discount` ở đầu phiếu trừ SAU thuế: nó là khoản NCC bớt lúc thanh
--   toán, không phải khoản làm đổi căn cứ tính thuế. Nếu thực tế của
--   chủ nhà ngược lại (giảm giá làm giảm cả tiền thuế) thì phải sửa ở
--   ĐÂY, và sửa thì mọi phiếu cũ vẫn giữ nguyên số đã ghi.
--
-- ⚠ TIỀN TÍNH LẠI Ở MÁY CHỦ, KHÔNG NHẬN SỐ TỪ TRÌNH DUYỆT. Bản cũ nhận
--   `total` do trình duyệt gửi lên rồi ghi thẳng vào `payables.amount`.
--   Một lỗi làm tròn, một ô để trống, hay một tab mở lâu với bảng giá cũ
--   là công nợ NCC lệch mà không có chỗ nào đối chiếu.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. Cột còn thiếu
-- --------------------------------------------------------------------
ALTER TABLE purchase_invoices
  -- Mã phiếu của MÌNH. `invoice_number` là số hoá đơn NCC đưa (có thể
  -- trùng, có thể trống); không dùng nó làm mã phiếu được.
  ADD COLUMN IF NOT EXISTS receipt_code text,
  -- Giảm giá toàn phiếu, trừ sau thuế — xem quy ước ở đầu tệp.
  ADD COLUMN IF NOT EXISTS discount numeric NOT NULL DEFAULT 0,
  -- Kho đích: hàng nhập về vào kho bán hay kho cận date.
  ADD COLUMN IF NOT EXISTS warehouse_zone text NOT NULL DEFAULT 'sale',
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'purchase_invoices'::regclass
      AND conname = 'purchase_invoices_zone_chk'
  ) THEN
    ALTER TABLE purchase_invoices
      ADD CONSTRAINT purchase_invoices_zone_chk
      CHECK (warehouse_zone IN ('sale', 'date'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pinv_receipt_code
  ON purchase_invoices(org_id, receipt_code) WHERE receipt_code IS NOT NULL;

ALTER TABLE purchase_invoice_lines
  -- Giảm giá của DÒNG, trừ thật — xem quy ước ở đầu tệp.
  ADD COLUMN IF NOT EXISTS line_discount numeric NOT NULL DEFAULT 0,
  -- STT người dùng nhìn thấy. Không có nó thì thứ tự dòng phụ thuộc vào
  -- thứ tự Postgres trả về, và tờ in mỗi lần một khác.
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- --------------------------------------------------------------------
-- 2. Đánh số phiếu — PN-0001, chạy theo org
-- --------------------------------------------------------------------
-- ⚠ KHÔNG NHÚNG NGÀY VÀO MÃ. Chủ nhà đã chốt chuyện này một lần rồi cho
--   mã đơn hàng (migration 130): mã có ngày thì đọc số không ra thứ tự,
--   và hai phiếu cùng ngày vẫn phải thêm hậu tố.
CREATE OR REPLACE FUNCTION public.next_purchase_receipt_code(p_org uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  -- ⚠ KHOÁ THEO ORG TRONG SUỐT GIAO DỊCH. Hai người bấm "Hoàn thành"
  --   cùng lúc mà không khoá là hai phiếu mang cùng một mã, và chỉ chỉ
  --   mục duy nhất mới kêu — sau khi kho đã cộng.
  PERFORM pg_advisory_xact_lock(hashtext('purchase_receipt_code:' || p_org::text));
  SELECT COALESCE(MAX(NULLIF(regexp_replace(receipt_code, '^PN-', ''), '')::integer), 0) + 1
    INTO v_n
  FROM purchase_invoices
  WHERE org_id = p_org AND receipt_code ~ '^PN-[0-9]+$';
  RETURN 'PN-' || lpad(v_n::text, 4, '0');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.next_purchase_receipt_code(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_purchase_receipt_code(uuid) TO authenticated;

-- --------------------------------------------------------------------
-- 3. complete_purchase_invoice — viết lại
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_purchase_invoice(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org        uuid;
  v_status     text;
  v_supplier   uuid;
  v_inv_number text;
  v_zone       text;
  v_discount   numeric;
  v_code       text;
  v_uid        uuid := auth.uid();
  v_entry_id   uuid;
  v_payable_id uuid;
  v_seq        int := 0;
  v_batch_id   uuid;
  v_base_qty   numeric;
  v_unit_cost  numeric;
  v_shelf      int;
  v_sub        numeric := 0;
  v_vat        numeric := 0;
  v_total      numeric;
  r            record;
BEGIN
  SELECT org_id, status, supplier_id, invoice_number, warehouse_zone,
         COALESCE(discount, 0), receipt_code
    INTO v_org, v_status, v_supplier, v_inv_number, v_zone, v_discount, v_code
  FROM purchase_invoices WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PHIEU_KHONG_TON_TAI: Không tìm thấy phiếu nhập này.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'SAI_DON_VI: Phiếu nhập này không thuộc đơn vị của bạn.'
      USING ERRCODE = 'P0001';
  END IF;
  -- ⚠ IDEMPOTENT. Bấm hai lần, hoặc bấm rồi mạng rớt rồi bấm lại, KHÔNG
  --   được nhập kho hai lần.
  IF v_status = 'completed' THEN
    RETURN p_invoice_id;
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'PHIEU_KHONG_CON_TAM: Phiếu đang ở trạng thái "%" — chỉ phiếu tạm mới hoàn thành được.', v_status
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM purchase_invoice_lines WHERE invoice_id = p_invoice_id) THEN
    RAISE EXCEPTION 'PHIEU_KHONG_CO_HANG: Phiếu chưa có dòng hàng nào.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_code IS NULL THEN
    v_code := public.next_purchase_receipt_code(v_org);
  END IF;

  -- 3.1 Phiếu nhập kho đi kèm.
  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, supplier_id, notes)
  VALUES (
    v_org, v_code, 'import', 'posted', now(), v_uid, v_supplier,
    'Nhập kho từ phiếu nhập hàng ' || v_code
  )
  RETURNING id INTO v_entry_id;

  FOR r IN
    SELECT l.product_id, l.unit_name, l.quantity, l.unit_price,
           COALESCE(l.line_discount, 0) AS line_discount,
           COALESCE(l.vat_rate, 0)      AS vat_rate,
           COALESCE(l.conversion_factor, 1) AS cf,
           p.shelf_life_days
    FROM purchase_invoice_lines l
    JOIN products p ON p.id = l.product_id
    WHERE l.invoice_id = p_invoice_id
    ORDER BY l.sort_order, l.id
  LOOP
    v_seq := v_seq + 1;
    v_base_qty := COALESCE(r.quantity, 0) * r.cf;

    IF v_base_qty <= 0 THEN
      RAISE EXCEPTION 'SO_LUONG_KHONG_HOP_LE: Dòng % có số lượng không lớn hơn 0.', v_seq
        USING ERRCODE = 'P0001';
    END IF;

    -- ⚠ GIÁ VỐN TÍNH TRÊN TIỀN ĐÃ TRỪ GIẢM GIÁ DÒNG, và theo ĐƠN VỊ CƠ
    --   SỞ. Lấy thẳng `unit_price` là ghi giá một thùng thành giá một
    --   hộp; bỏ qua giảm giá là ghi giá vốn cao hơn số thật sự đã trả,
    --   và mọi báo cáo lãi lỗ sau đó đều thấp hơn thực tế.
    v_unit_cost := (COALESCE(r.quantity, 0) * COALESCE(r.unit_price, 0) - r.line_discount)
                   / v_base_qty;

    v_sub := v_sub + (COALESCE(r.quantity, 0) * COALESCE(r.unit_price, 0) - r.line_discount);
    v_vat := v_vat + (COALESCE(r.quantity, 0) * COALESCE(r.unit_price, 0) - r.line_discount) * r.vat_rate;

    v_shelf := COALESCE(r.shelf_life_days, 0);

    INSERT INTO batches (
      org_id, product_id, batch_code, manufactured_at, expires_at,
      qty_initial, qty_on_hand, status, unit_cost, warehouse_zone
    ) VALUES (
      v_org, r.product_id,
      v_code || '-' || lpad(v_seq::text, 3, '0'),
      public.vn_today(),
      CASE WHEN v_shelf > 0 THEN public.vn_today() + v_shelf ELSE DATE '2099-12-31' END,
      v_base_qty, v_base_qty, 'available', v_unit_cost,
      -- ⚠ KHO ĐÍCH DO NGƯỜI NHẬP CHỌN. Mặc định cứng vào 'sale' là đưa
      --   một lô hàng cận date vào kho bán, và từ mig 138 thì kho bán
      --   mới là kho được bán ra.
      v_zone
    )
    RETURNING id INTO v_batch_id;

    /**
     * ⚠ PHẢI ĐIỀN CẢ BỘ CỘT ĐƠN VỊ. `stock_entry_lines` được mở rộng
     *   sau migration 065 (`qty_in_base_uom` NOT NULL, `transaction_uom`,
     *   `conversion_factor_snapshot`), mà bản RPC cũ thì không biết —
     *   nó chèn thiếu cột và NGÃ NGAY. Đó cũng là bằng chứng thêm rằng
     *   RPC đó chưa từng chạy một lần nào: nếu có, nó đã nổ.
     *
     * ⚠ `quantity` LÀ `integer` — phải làm tròn, không để Postgres tự
     *   cắt. Số thật đi vào `qty_in_base_uom` (numeric 18,6).
     */
    INSERT INTO stock_entry_lines (
      entry_id, product_id, batch_id, unit_name, quantity, unit_cost,
      qty_in_base_uom, qty_in_transaction_uom, transaction_uom,
      conversion_factor_snapshot
    )
    VALUES (
      v_entry_id, r.product_id, v_batch_id, r.unit_name,
      ROUND(v_base_qty)::integer, v_unit_cost,
      v_base_qty, COALESCE(r.quantity, 0), r.unit_name, r.cf
    );
  END LOOP;

  -- 3.2 Tiền — TÍNH LẠI TỪ DÒNG, không nhận số của trình duyệt.
  v_total := GREATEST(0, v_sub + v_vat - v_discount);

  -- 3.3 Công nợ NCC.
  INSERT INTO payables (org_id, supplier_id, stock_entry_id, invoice_number, amount, paid, status, notes)
  VALUES (
    v_org, v_supplier, v_entry_id, v_inv_number, v_total, 0, 'open',
    'Phiếu nhập hàng ' || v_code
  )
  RETURNING id INTO v_payable_id;

  UPDATE purchase_invoices
  SET status = 'completed',
      receipt_code = v_code,
      subtotal = v_sub,
      vat = v_vat,
      total = v_total,
      completed_at = now(),
      stock_entry_id = v_entry_id,
      payable_id = v_payable_id
  WHERE id = p_invoice_id;

  RETURN p_invoice_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_purchase_invoice(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_purchase_invoice(uuid) TO authenticated;

COMMENT ON FUNCTION public.complete_purchase_invoice(uuid) IS
  'Hoàn thành phiếu nhập hàng: nhập kho vào đúng warehouse_zone + ghi '
  'công nợ NCC, trong MỘT giao dịch. Tiền tính lại từ dòng hàng. '
  'Idempotent: gọi lại trên phiếu đã hoàn thành thì không làm gì.';

-- --------------------------------------------------------------------
-- 4. cancel_purchase_invoice — đảo ngược
-- --------------------------------------------------------------------
-- ⚠ CHỈ HUỶ ĐƯỢC KHI HÀNG CHƯA ĐỘNG VÀ TIỀN CHƯA TRẢ. Trừ ngược một lô
--   đã bán mất một phần là đẩy tồn xuống âm và xoá mất vết của chính
--   lần bán đó. Thà từ chối và bảo người dùng lập phiếu điều chỉnh.
CREATE OR REPLACE FUNCTION public.cancel_purchase_invoice(
  p_invoice_id uuid,
  p_reason     text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org      uuid;
  v_status   text;
  v_entry    uuid;
  v_payable  uuid;
  v_uid      uuid := auth.uid();
  v_paid     numeric;
  v_bad      text;
BEGIN
  SELECT org_id, status, stock_entry_id, payable_id
    INTO v_org, v_status, v_entry, v_payable
  FROM purchase_invoices WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PHIEU_KHONG_TON_TAI: Không tìm thấy phiếu nhập này.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'SAI_DON_VI: Phiếu nhập này không thuộc đơn vị của bạn.'
      USING ERRCODE = 'P0001';
  END IF;
  -- Idempotent.
  IF v_status = 'cancelled' THEN
    RETURN p_invoice_id;
  END IF;

  -- Phiếu còn tạm thì huỷ là đổi một chữ; chưa đụng gì tới kho hay nợ.
  IF v_status = 'draft' THEN
    UPDATE purchase_invoices
    SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid,
        cancel_reason = p_reason
    WHERE id = p_invoice_id;
    RETURN p_invoice_id;
  END IF;

  -- 4.1 Tiền đã trả rồi thì không huỷ được.
  IF v_payable IS NOT NULL THEN
    SELECT COALESCE(paid, 0) INTO v_paid FROM payables WHERE id = v_payable;
    IF COALESCE(v_paid, 0) > 0 THEN
      RAISE EXCEPTION 'DA_TRA_TIEN: Phiếu này đã trả NCC % — huỷ phiếu là xoá mất khoản đã trả. Gỡ phiếu chi trước, hoặc lập phiếu trả hàng NCC.', v_paid
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 4.2 Hàng đã động thì không huỷ được. Nói rõ MẶT HÀNG NÀO — bắt người
  --     dùng tự dò cả phiếu là bỏ phí việc mình vừa tra ra.
  IF v_entry IS NOT NULL THEN
    SELECT string_agg(
             p.name || ' (nhập ' || b.qty_initial || ', còn ' || b.qty_on_hand || ')',
             ' · ' ORDER BY p.name)
      INTO v_bad
    FROM stock_entry_lines sel
    JOIN batches  b ON b.id = sel.batch_id
    JOIN products p ON p.id = sel.product_id
    WHERE sel.entry_id = v_entry
      AND b.qty_on_hand <> b.qty_initial;

    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'HANG_DA_XUAT: Không huỷ được vì hàng của phiếu đã xuất bớt — %. Lập phiếu trả hàng NCC hoặc phiếu điều chỉnh kho.', v_bad
        USING ERRCODE = 'P0001';
    END IF;

    -- Trừ sạch lô của phiếu này rồi đóng phiếu kho.
    UPDATE batches b
    SET qty_on_hand = 0, status = 'cancelled'
    FROM stock_entry_lines sel
    WHERE sel.entry_id = v_entry AND b.id = sel.batch_id;

    UPDATE stock_entries SET status = 'cancelled' WHERE id = v_entry;
  END IF;

  /**
   * 4.3 Đóng phiếu TRƯỚC, xoá công nợ SAU.
   *
   * ⚠ THỨ TỰ NÀY LÀ BẮT BUỘC, KHÔNG PHẢI SỞ THÍCH.
   *   `purchase_invoices.payable_id` có khoá ngoại trỏ tới `payables`,
   *   nên xoá dòng nợ khi phiếu còn trỏ vào nó là Postgres từ chối
   *   ("still referenced from table"). Phải gỡ con trỏ trước.
   *
   * ⚠ XOÁ HẲN DÒNG NỢ, KHÔNG ĐÁNH DẤU. `payables.status` chỉ nhận
   *   open/partial/paid/overdue — không có 'cancelled'. Để nó lại ở
   *   'open' là một khoản nợ ma vẫn cộng vào công nợ NCC mãi mãi. Vết
   *   tích nằm ở chính phiếu: `cancelled_at`, `cancelled_by`,
   *   `cancel_reason`. An toàn vì mục 4.1 đã chắc chắn chưa trả đồng nào.
   */
  UPDATE purchase_invoices
  SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid,
      cancel_reason = p_reason, payable_id = NULL
  WHERE id = p_invoice_id;

  IF v_payable IS NOT NULL THEN
    DELETE FROM payables WHERE id = v_payable;
  END IF;

  RETURN p_invoice_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_purchase_invoice(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_invoice(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.cancel_purchase_invoice(uuid, text) IS
  'Huỷ phiếu nhập hàng và đảo ngược: trừ sạch lô đã nhập, xoá công nợ '
  'NCC. Từ chối nếu hàng đã xuất bớt hoặc đã trả tiền. Idempotent.';

-- --------------------------------------------------------------------
-- 5. Báo cáo hiện trạng
-- --------------------------------------------------------------------
DO $$
DECLARE
  v_pinv  bigint;
  v_entry bigint;
  v_code  bigint;
BEGIN
  SELECT COUNT(*) INTO v_pinv  FROM purchase_invoices;
  SELECT COUNT(*) INTO v_entry FROM stock_entries WHERE type = 'import' AND status = 'posted';
  SELECT COUNT(*) INTO v_code  FROM purchase_invoices WHERE receipt_code IS NOT NULL;
  RAISE NOTICE '--- 142: % phiếu nhập hàng trong purchase_invoices (% đã có mã PN) ---', v_pinv, v_code;
  RAISE NOTICE '--- 142: % phiếu nhập kho cũ nằm ở stock_entries — KHÔNG chuyển sang, vẫn tra cứu được ở màn cũ ---', v_entry;
END $$;

NOTIFY pgrst, 'reload schema';
