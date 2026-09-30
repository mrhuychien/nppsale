-- ====================================================================
-- 219 — NHẬP KHO CHỌN KHO NHẬN: KHO BÁN / KHO DATE
--
-- VÌ SAO — chủ nhà 30/09/2026: "làm migrate kho bán / kho date" (bản thiết kế màn Phiếu nhập kho trên điện
--   thoại có hai nút "Kho nhận: Kho bán / Kho date"). `post_stock_import` (mig 168) không nhận vùng kho —
--   mọi lô nhập vào đều là kho bán (mặc định `batches.warehouse_zone` = 'sale', mig 028); bấm "Kho date"
--   mà hàng vẫn vào kho bán là sai sổ kho.
--
-- CÁCH LÀM
--   `post_stock_import(p jsonb)` nhận thêm `p.warehouse_zone` ∈ ('sale','date'); thiếu = 'sale' (như cũ — bản
--   app cũ gọi vẫn chạy). Ghi vào CẢ `stock_entries.warehouse_zone` (mig 144) lẫn từng lô `batches.warehouse_zone`.
--   Trigger tự chuyển vùng (mig 028) chỉ đổi sale → date khi sắp hết hạn, không đẩy lô date về sale.
--   Còn lại giữ nguyên bản mig 168 (một giao dịch, kiểm NPP, công nợ NCC).
-- ====================================================================

CREATE OR REPLACE FUNCTION public.post_stock_import(p jsonb)
RETURNS TABLE (entry_id uuid, entry_code text, payable_id uuid, lines_written int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org      uuid := public.user_org_id();
  v_entry    uuid;
  v_code     text := NULLIF(trim(p->>'entry_code'), '');
  v_posted   timestamptz := COALESCE((p->>'posted_at')::timestamptz, now());
  v_supplier uuid := NULLIF(p->>'supplier_id', '')::uuid;
  v_pay_amt  numeric := COALESCE((p->'payable'->>'amount')::numeric, 0);
  v_payable  uuid;
  v_batch    uuid;
  v_n        int := 0;
  -- (mig 219) Kho nhận: 'sale' (kho bán) / 'date' (kho date). Thiếu = kho bán như trước.
  v_zone     text := COALESCE(NULLIF(trim(p->>'warehouse_zone'), ''), 'sale');
  l          jsonb;
BEGIN
  IF COALESCE(public.user_role(), '') NOT IN ('owner', 'warehouse') THEN
    RAISE EXCEPTION 'FORBIDDEN: chỉ chủ NPP hoặc thủ kho được lập phiếu nhập kho.'
      USING ERRCODE = '42501';
  END IF;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: tài khoản chưa gắn đơn vị.' USING ERRCODE = '42501';
  END IF;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'BAD_PAYLOAD: thiếu mã phiếu.' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'lines') = 0 THEN
    RAISE EXCEPTION 'BAD_PAYLOAD: phiếu nhập cần ít nhất một dòng hàng.' USING ERRCODE = 'P0001';
  END IF;
  IF v_supplier IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM suppliers WHERE id = v_supplier AND org_id = v_org
  ) THEN
    RAISE EXCEPTION 'ORG_MISMATCH: nhà cung cấp không thuộc đơn vị của bạn.' USING ERRCODE = '42501';
  END IF;
  IF v_zone NOT IN ('sale', 'date') THEN
    RAISE EXCEPTION 'BAD_PAYLOAD: kho nhận chỉ là kho bán (sale) hoặc kho date (date).' USING ERRCODE = 'P0001';
  END IF;
  IF v_pay_amt < 0 THEN
    RAISE EXCEPTION 'BAD_PAYLOAD: số tiền công nợ NCC không được âm.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, supplier_id, notes, warehouse_zone)
  VALUES (v_org, v_code, 'import', 'posted', v_posted, auth.uid(), v_supplier, NULLIF(p->>'notes', ''), v_zone)
  RETURNING id INTO v_entry;

  FOR l IN SELECT * FROM jsonb_array_elements(p->'lines')
  LOOP
    IF NOT EXISTS (SELECT 1 FROM products WHERE id = (l->>'product_id')::uuid AND org_id = v_org) THEN
      RAISE EXCEPTION 'ORG_MISMATCH: sản phẩm % không thuộc đơn vị của bạn.', l->>'product_id'
        USING ERRCODE = '42501';
    END IF;
    IF COALESCE((l->>'base_qty')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'BAD_PAYLOAD: dòng % có số lượng không hợp lệ.', v_n + 1 USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE((l->>'base_cost')::numeric, 0) < 0 THEN
      RAISE EXCEPTION 'BAD_PAYLOAD: dòng % có giá vốn âm.', v_n + 1 USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO batches (org_id, product_id, batch_code, manufactured_at, expires_at, location,
                         qty_initial, qty_on_hand, unit_cost, received_at, warehouse_zone)
    VALUES (
      v_org,
      (l->>'product_id')::uuid,
      COALESCE(NULLIF(trim(l->>'batch_code'), ''), 'LOT-' || v_code || '-' || (v_n + 1)),
      NULLIF(l->>'manufactured_at', '')::date,
      COALESCE(NULLIF(l->>'expires_at', '')::date, DATE '2099-12-31'),
      NULLIF(trim(l->>'location'), ''),
      (l->>'base_qty')::numeric,
      (l->>'base_qty')::numeric,
      COALESCE((l->>'base_cost')::numeric, 0),
      -- Khoá thứ tự FIFO (mig 107): ngày GHI SỔ của phiếu, không phải lúc tạo.
      v_posted,
      v_zone
    )
    RETURNING id INTO v_batch;

    INSERT INTO stock_entry_lines (entry_id, product_id, batch_id, unit_name, quantity, qty_in_base_uom,
                                   qty_in_transaction_uom, transaction_uom, conversion_factor_snapshot, unit_cost)
    VALUES (
      v_entry,
      (l->>'product_id')::uuid,
      v_batch,
      COALESCE(l->>'unit_name', ''),
      (l->>'base_qty')::numeric,
      (l->>'base_qty')::numeric,
      COALESCE((l->>'qty_tx')::numeric, (l->>'base_qty')::numeric),
      COALESCE(l->>'unit_name', ''),
      COALESCE((l->>'conv')::numeric, 1),
      COALESCE((l->>'base_cost')::numeric, 0)
    );
    v_n := v_n + 1;
  END LOOP;

  IF v_supplier IS NOT NULL AND v_pay_amt > 0 THEN
    INSERT INTO payables (org_id, supplier_id, stock_entry_id, invoice_number, amount, paid, status, notes)
    VALUES (v_org, v_supplier, v_entry, NULLIF(trim(p->'payable'->>'invoice_number'), ''),
            v_pay_amt, 0, 'open', 'Nhập kho ' || v_code)
    RETURNING id INTO v_payable;
  END IF;

  RETURN QUERY SELECT v_entry, v_code, v_payable, v_n;
END;
$fn$;


REVOKE ALL ON FUNCTION public.post_stock_import(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_stock_import(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 219: nhập kho chọn kho nhận (kho bán / kho date)' AS buoc,
       CASE WHEN position('v_zone' IN pg_get_functiondef('public.post_stock_import(jsonb)'::regprocedure)) > 0
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua;
