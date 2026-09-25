-- ====================================================================
-- PHIẾU TRẢ HÀNG POS ĐI QUA MỘT RPC + HUỶ PHIẾU TRẢ TÍNH LẠI CÔNG NỢ
--
-- Chủ nhà 25/09/2026: "rà soát lại xem có nghiệp vụ gì thực hiện trên pos mà
-- ko giống nghiệp vụ hiện tại ko ? Ví dụ khi hủy hóa đơn có rollback lại các
-- tài liệu liên quan ko ?"
--
-- Rà xong, đo trên Postgres thật, ba chỗ lệch:
--
--   1. POS "Ghi nhận & nhập kho" KHÔNG BAO GIỜ QUA ĐƯỢC. Màn POS chèn thẳng
--      phiếu `returns` ở 'draft' rồi gọi `complete_return`, mà hàm ấy (mig 158)
--      chỉ nhận 'submitted' → RETURN_NOT_SUBMITTED. Màn desktop lập phiếu ở
--      'submitted' nên không dính. Và vì đầu phiếu + dòng đã ghi trước khi RPC
--      hỏng, mỗi lần bấm lại đẻ thêm một phiếu nháp.
--   2. SỬA PHIẾU ĐÃ NHẬP KHO ở POS (màn 8, spec §7.2: "hoàn tác bút toán kho và
--      công nợ cũ rồi ghi lại theo số mới, trong cùng một giao dịch — giữ
--      nguyên số phiếu") chưa có RPC nào làm: trình duyệt xoá / chèn lại dòng
--      của một phiếu đã nhập kho mà kho và công nợ không đổi theo.
--   3. HUỶ PHIẾU TRẢ ĐANG CHỜ (`cancel_return`, nhánh 'submitted') chỉ đổi
--      trạng thái. Phiếu ĐI CÙNG HÓA ĐƠN đã trừ công nợ ngay từ 'submitted'
--      (mig 133) → huỷ xong công nợ vẫn trừ. Đo: hóa đơn 220.000, trả 50.000,
--      huỷ phiếu trả → công nợ vẫn 170.000. Lỗi ở máy chủ: dính cả desktop.
--
-- CÁCH LÀM:
--   A. `save_pos_return(p jsonb)` — lập / sửa / ghi nhận phiếu trả trong MỘT
--      giao dịch. Hỏng ở bước nào thì không còn gì nằm lại (hết phiếu mồ côi).
--      · Phiếu đã HUỶ: không sửa.
--      · Phiếu đã HOÀN THÀNH: phải ghi nhận lại (complete = true). Đảo bút toán
--        cũ bằng chính `cancel_return` (cùng các chốt: đã cấn trừ / hóa đơn gốc
--        đã thu tiền thì từ chối), đánh dấu phiếu nhập cũ đã đảo, đưa phiếu về
--        nháp, ghi dòng mới, rồi `complete_return` lại. Số phiếu giữ nguyên.
--      · `line_total` tính ở máy chủ — cùng công thức `_apply_return_adds`.
--   B. `cancel_return`: nhánh 'submitted' tính lại công nợ của hóa đơn.
--
-- ⚠ SECURITY DEFINER vì phải đổi ghi chú phiếu kho; kiểm quyền y như RLS của
--   `returns`: owner / manager / sales; nhân viên bán hàng chỉ sửa phiếu NHÁP
--   của mình. Ghi nhận / sửa phiếu đã nhập kho thì `complete_return` /
--   `cancel_return` tự kiểm `returns.approve`.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.save_pos_return(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_org      uuid := public.user_org_id();
  v_role     text := public.user_role();
  v_id       uuid := NULLIF(p->>'return_id', '')::uuid;
  v_cust     uuid := NULLIF(p->>'customer_id', '')::uuid;
  v_inv      uuid := NULLIF(p->>'invoice_id', '')::uuid;
  v_lines    jsonb := p->'lines';
  v_complete boolean := COALESCE((p->>'complete')::boolean, false);
  v_zone     text := COALESCE(NULLIF(p->>'zone', ''), 'sale');
  v_date     date := COALESCE(NULLIF(p->>'return_date', '')::date,
                              (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date);
  r          record;
  v_n        int;
BEGIN
  IF v_org IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: chưa đăng nhập' USING ERRCODE = 'P0001';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'sales') THEN
    RAISE EXCEPTION 'FORBIDDEN: vai trò của bạn không lập được phiếu trả' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(v_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'BAD_PAYLOAD: phiếu trả cần ít nhất một dòng hàng.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = v_cust AND c.org_id = v_org) THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND: không tìm thấy khách hàng' USING ERRCODE = 'P0001';
  END IF;
  IF v_inv IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sales_invoices si WHERE si.id = v_inv AND si.org_id = v_org
  ) THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND: không tìm thấy hóa đơn gốc' USING ERRCODE = 'P0001';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO returns (org_id, customer_id, invoice_id, requested_by, reason, notes, status, return_date)
    VALUES (v_org, v_cust, v_inv, auth.uid(), NULLIF(p->>'reason', ''), NULLIF(p->>'notes', ''),
            'draft', v_date)
    RETURNING id INTO v_id;
  ELSE
    SELECT ret.id, ret.org_id, ret.status, ret.sales_user_id INTO r
    FROM returns ret WHERE ret.id = v_id FOR UPDATE;
    IF NOT FOUND OR r.org_id <> v_org THEN
      RAISE EXCEPTION 'RETURN_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
    IF r.status = 'cancelled' THEN
      RAISE EXCEPTION 'RETURN_LOCKED: phiếu trả đã huỷ — không sửa được' USING ERRCODE = 'P0001';
    END IF;
    IF v_role = 'sales' AND (r.status <> 'draft' OR r.sales_user_id IS DISTINCT FROM auth.uid()) THEN
      RAISE EXCEPTION 'FORBIDDEN: nhân viên bán hàng chỉ sửa được phiếu nháp của mình' USING ERRCODE = 'P0001';
    END IF;

    IF r.status = 'completed' THEN
      IF NOT v_complete THEN
        RAISE EXCEPTION 'RETURN_COMPLETED: phiếu đã nhập kho — sửa xong phải bấm Ghi nhận để kho và công nợ đổi theo'
          USING ERRCODE = 'P0001';
      END IF;
      -- Đảo bút toán cũ bằng đúng đường huỷ (cùng các chốt tiền đã thu / cấn trừ).
      PERFORM public.cancel_return(v_id, 'Sửa phiếu trả trên POS — ghi nhận lại');
      -- ⚠ Đánh dấu phiếu nhập cũ đã đảo: `cancel_return` tìm phiếu nhập theo đúng
      --   câu ghi chú này — để nguyên thì lần huỷ sau đảo cả phiếu cũ lần nữa.
      UPDATE stock_entries
      SET notes = notes || ' (đã đảo khi sửa phiếu)'
      WHERE org_id = v_org AND type = 'import'
        AND notes = 'Nhập lại từ phiếu trả ' || v_id::text;
      UPDATE returns
      SET status = 'draft', cancelled_at = NULL, cancel_reason = NULL
      WHERE id = v_id;
    END IF;

    UPDATE returns
    SET customer_id = v_cust, invoice_id = v_inv,
        reason = NULLIF(p->>'reason', ''), notes = NULLIF(p->>'notes', ''),
        return_date = v_date
    WHERE id = v_id;
    DELETE FROM return_lines WHERE return_id = v_id;
  END IF;

  INSERT INTO return_lines (return_id, product_id, unit_name, quantity, unit_price, vat_rate,
                            line_total, is_exchange, note, reason)
  SELECT v_id,
         (l->>'product_id')::uuid,
         COALESCE(l->>'unit_name', ''),
         (l->>'quantity')::numeric,
         COALESCE((l->>'unit_price')::numeric, 0),
         COALESCE((l->>'vat_rate')::numeric, 0),
         -- ⚠ CÙNG CÔNG THỨC VỚI `_apply_return_adds` và `dongTraGhiSo`.
         round((l->>'quantity')::numeric * COALESCE((l->>'unit_price')::numeric, 0)
               * (1 + COALESCE((l->>'vat_rate')::numeric, 0))),
         COALESCE((l->>'is_exchange')::boolean, false),
         NULLIF(l->>'note', ''),
         CASE WHEN COALESCE((l->>'is_exchange')::boolean, false) THEN NULL ELSE NULLIF(l->>'reason', '') END
  FROM jsonb_array_elements(v_lines) AS l
  WHERE NULLIF(l->>'product_id', '') IS NOT NULL
    AND COALESCE((l->>'quantity')::numeric, 0) > 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'BAD_PAYLOAD: phiếu trả cần ít nhất một dòng hàng.' USING ERRCODE = 'P0001';
  END IF;

  IF v_complete THEN
    -- ⚠ `complete_return` chỉ nhận 'submitted' (mig 158).
    UPDATE returns SET status = 'submitted' WHERE id = v_id AND status = 'draft';
    PERFORM public.complete_return(v_id, v_zone);
  END IF;

  RETURN v_id;
END;
$fn$;

COMMENT ON FUNCTION public.save_pos_return(jsonb) IS
  'POS: lập / sửa / ghi nhận phiếu trả khách trong một giao dịch; sửa phiếu đã nhập kho thì đảo bút toán cũ rồi ghi lại, giữ số phiếu (mig 190).';

REVOKE ALL ON FUNCTION public.save_pos_return(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_pos_return(jsonb) TO authenticated;

-- B. `cancel_return`: huỷ phiếu đang chờ thì tính lại công nợ của hóa đơn.
DO $p$
DECLARE
  v_src  text;
  v_from text := E'    WHERE id = p_return_id;\n    RETURN;\n  END IF;';
  v_n    int;
BEGIN
  v_src := pg_get_functiondef('public.cancel_return(uuid, text)'::regprocedure);
  IF position('(mig 190)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 190: cancel_return đã tính lại công nợ, bỏ qua ---';
    RETURN;
  END IF;
  v_n := (length(v_src) - length(replace(v_src, v_from, ''))) / length(v_from);
  IF v_n <> 1 THEN
    RAISE EXCEPTION '190: thấy % chỗ kết thúc nhánh submitted trong cancel_return, cần đúng 1', v_n
      USING ERRCODE = 'P0001';
  END IF;
  v_src := replace(v_src, v_from,
    E'    WHERE id = p_return_id;\n'
    || E'    -- (mig 190) Phiếu đi cùng hóa đơn đã trừ công nợ từ lúc chờ — huỷ thì trả lại.\n'
    || E'    IF r.invoice_id IS NOT NULL THEN\n'
    || E'      PERFORM public._wf2b_recompute_receivable(r.invoice_id);\n'
    || E'    END IF;\n'
    || E'    RETURN;\n  END IF;');
  EXECUTE v_src;
END;
$p$;

-- Chữa công nợ đã lỡ: hóa đơn có phiếu trả đi cùng đã bị huỷ ở trạng thái chờ.
DO $chua$
DECLARE
  x record;
  n int := 0;
BEGIN
  FOR x IN
    SELECT DISTINCT ret.invoice_id
    FROM returns ret JOIN sales_invoices si ON si.id = ret.invoice_id
    WHERE ret.status = 'cancelled' AND ret.credit_with_invoice AND si.status = 'posted'
  LOOP
    PERFORM public._wf2b_recompute_receivable(x.invoice_id);
    n := n + 1;
  END LOOP;
  RAISE NOTICE '190: đã tính lại công nợ % hóa đơn', n;
END;
$chua$;

NOTIFY pgrst, 'reload schema';

SELECT 'Phiếu trả POS một giao dịch + huỷ phiếu trả tính lại công nợ' AS hang_muc,
       CASE WHEN to_regprocedure('public.save_pos_return(jsonb)') IS NOT NULL
                 AND position('(mig 190)' IN pg_get_functiondef('public.cancel_return(uuid, text)'::regprocedure)) > 0
            THEN 'có' ELSE 'CHƯA' END AS trang_thai;
