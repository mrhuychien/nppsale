-- ====================================================================
-- LẬP PHIẾU TRẢ HÀNG (ĐẦU PHIẾU + DÒNG) TRONG MỘT GIAO DỊCH
--
-- Rơi ra từ đợt QA 22/09/2026.
--
-- ⚠ TRƯỚC ĐÂY `/returns/new` chèn đầu phiếu `returns` (trạng thái
--   `submitted`, đã mang sẵn `credit_note_amount`) rồi mới chèn dòng.
--   Dòng hỏng thì đầu phiếu NẰM LẠI: một phiếu trả có tiền mà không có
--   hàng. Và không ai dọn được — chính sách xoá của `returns` chỉ nhận
--   phiếu NHÁP (mig 165, 166).
--
-- ⚠ SAU: `create_return_with_lines(p_head, p_lines)` chèn cả hai trong
--   MỘT giao dịch. SECURITY INVOKER, CỐ Ý — RLS và trigger lập phiếu trả
--   (người đứng tên — mig 160, tính lại khoản có — trg_return_lines_sync_credit)
--   áp y như khi trình duyệt tự ghi. Không nới quyền nào.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.create_return_with_lines(p_head jsonb, p_lines jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_id uuid; v_n int;
BEGIN
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'BAD_PAYLOAD: phiếu trả cần ít nhất một dòng hàng.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO returns (org_id, customer_id, invoice_id, order_id, requested_by, reason, notes,
                       status, credit_note_amount, sales_user_id)
  VALUES (
    public.user_org_id(),
    (p_head->>'customer_id')::uuid,
    NULLIF(p_head->>'invoice_id', '')::uuid,
    NULLIF(p_head->>'order_id', '')::uuid,
    auth.uid(),
    p_head->>'reason',
    NULLIF(p_head->>'notes', ''),
    COALESCE(NULLIF(p_head->>'status', ''), 'submitted'),
    COALESCE((p_head->>'credit_note_amount')::numeric, 0),
    -- Rỗng → để trigger mig 160 tự điền, đúng như trình duyệt không gửi cột.
    NULLIF(p_head->>'sales_user_id', '')::uuid
  )
  RETURNING id INTO v_id;

  INSERT INTO return_lines (return_id, product_id, unit_name, quantity, unit_price, vat_rate,
                            line_total, is_exchange, note, reason)
  SELECT v_id,
         (l->>'product_id')::uuid,
         l->>'unit_name',
         (l->>'quantity')::numeric,
         COALESCE((l->>'unit_price')::numeric, 0),
         COALESCE((l->>'vat_rate')::numeric, 0),
         COALESCE((l->>'line_total')::numeric, 0),
         COALESCE((l->>'is_exchange')::boolean, false),
         NULLIF(l->>'note', ''),
         NULLIF(l->>'reason', '')
  FROM jsonb_array_elements(p_lines) AS l;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n <> jsonb_array_length(p_lines) THEN
    RAISE EXCEPTION 'LINES_SHORT: chỉ ghi được %/% dòng hàng trả.', v_n, jsonb_array_length(p_lines)
      USING ERRCODE = 'P0001';
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_return_with_lines(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_return_with_lines(jsonb, jsonb) TO authenticated;

DO $kiem$
BEGIN
  IF to_regprocedure('public.create_return_with_lines(jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION '171: chưa dựng được create_return_with_lines' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.create_return_with_lines(jsonb,jsonb)')) THEN
    RAISE EXCEPTION '171: create_return_with_lines phải là SECURITY INVOKER' USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE '--- 171: lập phiếu trả nay ghi đầu phiếu + dòng trong một giao dịch ---';
END;
$kiem$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Bảng tóm tắt — dấu vết lỗi cũ: phiếu trả chưa huỷ mà không có dòng
-- ---------------------------------------------------------------------
SELECT 'Phiếu trả chưa huỷ mà KHÔNG có dòng hàng (có tiền mà không có hàng)' AS hang_muc,
       count(*)::text AS so_phieu,
       coalesce(sum(r.credit_note_amount), 0)::text AS tong_khoan_co
FROM returns r
WHERE r.status <> 'cancelled'
  AND NOT EXISTS (SELECT 1 FROM return_lines l WHERE l.return_id = r.id);
