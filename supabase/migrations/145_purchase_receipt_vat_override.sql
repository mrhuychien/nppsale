-- ====================================================================
-- 145 — TIỀN THUẾ GTGT GÕ TAY ĐƯỢC TRÊN PHIẾU NHẬP HÀNG
-- ====================================================================
--
-- VÌ SAO
--   Chủ nhà báo: "Tiền thuế GTGT chưa nhập được?". Đúng — và đó là chỗ
--   tôi làm thiếu so với chính yêu cầu ban đầu ("Các thông tin khác cần:
--   Số hoá đơn đầu vào, Giảm giá, VAT"). Bản đầu chỉ cho gõ THUẾ SUẤT
--   của từng dòng, giấu trong modal chi tiết mặt hàng. Không có chỗ nào
--   gõ SỐ TIỀN thuế.
--
--   Hai thứ ấy khác nhau, và hoá đơn giấy của NCC ghi cái thứ hai. Người
--   nhập hàng cầm tờ hoá đơn có một dòng "Tiền thuế GTGT: 236.000" và
--   phải gõ lại được ĐÚNG con số đó — nếu không, công nợ NCC trên máy
--   lệch với tờ giấy hai bên cùng ký, và mỗi lần đối chiếu là một lần
--   cãi nhau về vài nghìn đồng làm tròn.
--
-- ⚠ LÀ SỐ ĐÈ, KHÔNG PHẢI SỐ THAY THẾ. `vat_override` để NULL thì máy
--   chủ vẫn tự cộng thuế từ dòng hàng như cũ. Gõ vào thì con số gõ tay
--   thắng. Cách này giữ được cả hai đường: phiếu bình thường không phải
--   gõ gì, phiếu có sai lệch làm tròn thì khớp được với tờ giấy.
--
-- ⚠ CHỈ ĐÈ TIỀN THUẾ, KHÔNG ĐÈ TIỀN HÀNG. `subtotal` vẫn tính từ dòng.
--   Cho gõ tay cả tiền hàng là mở đường cho một phiếu mà tổng không
--   bằng tổng các dòng của chính nó — không ai đối chiếu nổi.
--
-- ⚠ THUẾ SUẤT TỪNG DÒNG VẪN GIỮ NGUYÊN, và vẫn được ghi xuống. Nó là
--   thứ hoá đơn điện tử và báo cáo thuế cần; `vat_override` chỉ sửa
--   TỔNG. Xoá thuế suất dòng đi để "cho gọn" là mất dữ liệu không dựng
--   lại được.
-- ====================================================================

ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS vat_override numeric;

COMMENT ON COLUMN purchase_invoices.vat_override IS
  'Tiền thuế GTGT gõ tay theo hoá đơn giấy của NCC. NULL = để máy chủ '
  'tự cộng từ thuế suất của từng dòng. Xem migration 145.';

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
  v_vat_ovr    numeric;
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
         COALESCE(discount, 0), receipt_code, vat_override
    INTO v_org, v_status, v_supplier, v_inv_number, v_zone, v_discount, v_code, v_vat_ovr
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

  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, supplier_id, notes, warehouse_zone)
  VALUES (
    v_org, v_code, 'import', 'posted', now(), v_uid, v_supplier,
    'Nhập kho từ phiếu nhập hàng ' || v_code, v_zone
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
    --   hộp; bỏ qua giảm giá là ghi giá vốn cao hơn số thật sự đã trả.
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
      --   một lô hàng cận date vào kho bán.
      v_zone
    )
    RETURNING id INTO v_batch_id;

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

  /**
   * ⚠ TIỀN THUẾ: SỐ GÕ TAY THẮNG SỐ TỰ CỘNG (migration 145).
   *   `vat_override` là tiền thuế đọc từ hoá đơn giấy của NCC. Để NULL
   *   thì vẫn tự cộng từ thuế suất từng dòng như cũ.
   *
   * ⚠ KẸP VỀ 0. Gõ nhầm số âm là công nợ NCC nhỏ hơn tiền hàng, và
   *   không ai đối chiếu ra vì sao.
   */
  IF v_vat_ovr IS NOT NULL THEN
    v_vat := GREATEST(0, v_vat_ovr);
  END IF;

  v_total := GREATEST(0, v_sub + v_vat - v_discount);

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

DO $$
DECLARE v_n bigint;
BEGIN
  SELECT COUNT(*) INTO v_n FROM purchase_invoices WHERE vat_override IS NOT NULL;
  RAISE NOTICE '--- 145: % phiếu đang dùng tiền thuế gõ tay (phần còn lại vẫn tự cộng từ dòng) ---', v_n;
END $$;

NOTIFY pgrst, 'reload schema';
