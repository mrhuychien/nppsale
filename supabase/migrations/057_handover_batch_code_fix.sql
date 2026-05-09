-- ====================================================================
-- Fix confirm_driver_handover RPC: tạo batch mới khi cần restock
-- nhưng INSERT thiếu các cột NOT NULL của bảng batches:
--   • batch_code   → "BG-<entry_code>-<short_pid>"
--   • expires_at   → '2099-12-31' (sentinel cho "không hết hạn")
--   • qty_initial  → bằng qty_on_hand vào lúc tạo
-- Lỗi user gặp ở UI:
--   "null value in column \"batch_code\" of relation \"batches\"
--    violates not-null constraint"
-- ====================================================================

CREATE OR REPLACE FUNCTION confirm_driver_handover(p_handover_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_org       uuid;
  v_delivery  uuid;
  v_status    text;
  v_entry_id  uuid;
  v_entry_code text;
  v_line_id   uuid;
  v_seq       int;
  r           record;
  v_batch_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  SELECT org_id, delivery_id, status
    INTO v_org, v_delivery, v_status
  FROM driver_handovers
  WHERE id = p_handover_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'HANDOVER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'confirmed' THEN
    RETURN;
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- 1) Flip failed orders.
  UPDATE sales_orders so
  SET status = 'cancelled',
      current_workflow_stage = 'delivery_failed'
  FROM driver_handover_failed_orders dhfo
  WHERE dhfo.handover_id = p_handover_id
    AND dhfo.order_id    = so.id;

  -- 2) Restore stock — one stock_entry per handover, lines per item.
  IF EXISTS (SELECT 1 FROM driver_handover_items WHERE handover_id = p_handover_id) THEN
    v_entry_code := 'BG-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS');
    INSERT INTO stock_entries (
      org_id, entry_code, type, status, posted_at, created_by, notes, ref_order_ids
    ) VALUES (
      v_org,
      v_entry_code,
      'import',
      'posted',
      now(),
      v_uid,
      'Bàn giao lại từ chuyến giao ' || v_delivery::text,
      COALESCE(
        (SELECT jsonb_agg(DISTINCT order_id)
           FROM driver_handover_failed_orders
          WHERE handover_id = p_handover_id),
        '[]'::jsonb
      )
    )
    RETURNING id INTO v_entry_id;

    v_seq := 0;
    FOR r IN
      SELECT id, source_type, swap_movement_id,
             product_id, qty, unit_name, conversion_factor,
             qty_in_base_uom, destination_zone, unit_cost
      FROM driver_handover_items
      WHERE handover_id = p_handover_id
    LOOP
      v_seq := v_seq + 1;

      SELECT id INTO v_batch_id
      FROM batches
      WHERE org_id = v_org
        AND product_id = r.product_id
        AND COALESCE(warehouse_zone, 'sale') = r.destination_zone
      ORDER BY created_at ASC
      LIMIT 1;

      IF v_batch_id IS NULL THEN
        -- Schema yêu cầu batch_code + expires_at + qty_initial NOT NULL.
        -- Sentinel expires_at='2099-12-31' = "không hết hạn / không
        -- track date". Code giải mã: BG-<entry_code>-<seq>-<pid_4>.
        INSERT INTO batches (
          org_id, product_id, warehouse_zone,
          batch_code, expires_at,
          qty_initial, qty_on_hand, unit_cost
        ) VALUES (
          v_org, r.product_id, r.destination_zone,
          v_entry_code || '-' || lpad(v_seq::text, 2, '0') || '-' || substr(r.product_id::text, 1, 4),
          '2099-12-31',
          0, 0, COALESCE(r.unit_cost, 0)
        )
        RETURNING id INTO v_batch_id;
      END IF;

      INSERT INTO stock_entry_lines (
        entry_id, product_id, batch_id, unit_name, quantity,
        qty_in_base_uom, qty_in_transaction_uom,
        transaction_uom, conversion_factor_snapshot,
        unit_cost
      ) VALUES (
        v_entry_id,
        r.product_id,
        v_batch_id,
        r.unit_name,
        r.qty_in_base_uom,
        r.qty_in_base_uom,
        r.qty,
        r.unit_name,
        r.conversion_factor,
        COALESCE(r.unit_cost, 0)
      )
      RETURNING id INTO v_line_id;

      UPDATE batches
      SET qty_on_hand = qty_on_hand + r.qty_in_base_uom,
          qty_initial = qty_initial + r.qty_in_base_uom
      WHERE id = v_batch_id;

      INSERT INTO fifo_layers (
        org_id, product_id, warehouse_zone,
        source_line_id, qty_in_base_uom_remaining, unit_cost, posting_at
      ) VALUES (
        v_org, r.product_id, r.destination_zone,
        v_line_id, r.qty_in_base_uom, COALESCE(r.unit_cost, 0), now()
      );

      -- Q7: when this row was 'unused_swap_stock', bump the linked
      -- movement's returned-qty so future handover views drop it.
      IF r.source_type = 'unused_swap_stock' AND r.swap_movement_id IS NOT NULL THEN
        UPDATE swap_stock_movements
        SET qty_returned_in_base_uom = qty_returned_in_base_uom + r.qty_in_base_uom
        WHERE id = r.swap_movement_id;
      END IF;
    END LOOP;
  END IF;

  -- 3) Stamp handover + close out the delivery.
  UPDATE driver_handovers
  SET status = 'confirmed',
      confirmed_at = now()
  WHERE id = p_handover_id;

  UPDATE deliveries
  SET status = 'completed',
      completed_at = COALESCE(completed_at, now())
  WHERE id = v_delivery;

  -- 4) Close any open workflow_session(s) for this delivery.
  UPDATE workflow_sessions
  SET closed_at = now()
  WHERE entity_type = 'delivery'
    AND entity_id   = v_delivery
    AND closed_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION confirm_driver_handover(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confirm_driver_handover(uuid) TO authenticated;
