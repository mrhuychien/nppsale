-- ====================================================================
-- Fix complete_supplier_return: insert stock_entry_lines THIẾU các cột
-- split UOM (mig 039 đặt qty_in_base_uom NOT NULL) → 23502 NULL VIOLATION
-- khi gửi phiếu trả NCC. Bổ sung qty_in_base_uom / qty_in_transaction_
-- uom / transaction_uom / conversion_factor_snapshot.
--
-- v_take được tính theo base unit ngay từ đầu (= quantity × cf), nên
-- snapshot factor = 1; transaction_uom = r.unit_name của line trả.
-- ====================================================================

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
  v_total numeric;
  v_return_code text;
  v_uid uuid := auth.uid();
  v_entry_id uuid;
  v_payable_id uuid;
  v_seq int := 0;
  v_base_qty numeric;
  v_need numeric;
  v_take numeric;
  v_batch record;
  r record;
BEGIN
  SELECT org_id, status, supplier_id, warehouse_zone, total, return_code
    INTO v_org, v_status, v_supplier, v_zone, v_total, v_return_code
  FROM supplier_returns WHERE id = p_return_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPPLIER_RETURN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'completed' THEN
    RETURN p_return_id;
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'RETURN_NOT_DRAFT' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM supplier_return_lines WHERE return_id = p_return_id) THEN
    RAISE EXCEPTION 'RETURN_HAS_NO_LINES' USING ERRCODE = 'P0001';
  END IF;

  IF v_return_code IS NULL OR v_return_code = '' THEN
    v_return_code := 'TH-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS');
    UPDATE supplier_returns SET return_code = v_return_code WHERE id = p_return_id;
  END IF;

  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, supplier_id, notes)
  VALUES (
    v_org,
    'XK-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS'),
    'export', 'posted', now(), v_uid, v_supplier,
    'Xuất kho trả NCC — phiếu ' || v_return_code || ' (zone: ' || v_zone || ')'
  )
  RETURNING id INTO v_entry_id;

  FOR r IN
    SELECT l.id, l.product_id, l.unit_name, l.quantity, l.conversion_factor
    FROM supplier_return_lines l
    WHERE l.return_id = p_return_id
  LOOP
    v_base_qty := COALESCE(r.quantity, 0) * COALESCE(r.conversion_factor, 1);
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
      ORDER BY expires_at NULLS LAST, created_at
      FOR UPDATE
    LOOP
      EXIT WHEN v_need <= 0;
      v_take := LEAST(v_need, v_batch.qty_on_hand);

      UPDATE batches
      SET qty_on_hand = qty_on_hand - v_take
      WHERE id = v_batch.id;

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
      RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING
        ERRCODE = 'P0001',
        DETAIL = format('product_id=%s zone=%s thiếu %s đơn vị cơ sở', r.product_id, v_zone, v_need);
    END IF;
  END LOOP;

  INSERT INTO payables (org_id, supplier_id, stock_entry_id, invoice_number, amount, paid, status, notes)
  VALUES (
    v_org, v_supplier, v_entry_id, v_return_code,
    -COALESCE(v_total, 0), 0, 'open',
    'Hoàn trả NCC — phiếu ' || v_return_code
  )
  RETURNING id INTO v_payable_id;

  UPDATE supplier_returns
  SET status = 'completed',
      completed_at = now(),
      completed_by = v_uid,
      stock_entry_id = v_entry_id,
      payable_credit_id = v_payable_id
  WHERE id = p_return_id;

  RETURN p_return_id;
END;
$$;
