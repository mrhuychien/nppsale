-- ====================================================================
-- CÔNG NỢ ÂM KHI HÀNG TRẢ NHIỀU HƠN HÀNG XUẤT
--
-- Chủ nhà 24/09/2026: "ko ghi công nợ âm ? phải ghi cả công nợ âm chứ
-- (trường hợp tiền hàng trả nhiều hơn tiền hàng xuất)".
--
-- Trước nay `_wf2b_recompute_receivable` (bản mig 133) kẹp
--   v_net := GREATEST(0, total − tiền trả)
-- nên hóa đơn 100.000 kèm phiếu trả 150.000 ghi công nợ 0 — 50.000 khách
-- được trừ biến mất khỏi sổ, không trừ vào lần mua sau.
--
-- CÁCH LÀM:
--   1. Viết lại hàm, bỏ kẹp: công nợ của hóa đơn = total − tiền trả, có thể ÂM.
--      Khoản âm chính là "dư có" của khách: cơ chế sẵn có ở phiếu thu
--      (`GREATEST(0, paid − amount)`, mig 120 Q11) đọc được ngay — paid 0,
--      amount −50.000 → dư có 50.000, rút vào lần thu sau.
--   2. Trigger chuẩn hoá TRẠNG THÁI cho riêng dòng âm, ở MỌI đường ghi
--      (tính lại, rút dư có ở phiếu thu, huỷ phiếu thu): còn dư có → 'open'
--      (vẫn hiện, và trừ vào tổng nợ của khách); dùng hết → 'paid'.
--      Các CASE sẵn có (`paid >= amount → 'paid'`) sẽ đóng nhầm dòng âm ngay
--      từ đầu (0 ≥ −50.000); vá từng hàm là ba chỗ vá, trigger là một.
--   3. Tính lại công nợ cho các hóa đơn đã ghi sổ đang bị kẹp về 0.
--
-- ⚠ Dòng dương KHÔNG đổi gì: trigger chỉ chạy khi amount < 0.
-- ⚠ Thu tiền vào dòng âm vẫn bị chặn (BAD_RECEIVABLE_LINE — "thu vượt số còn
--   nợ", mig 120); màn Thu tiền cũng không liệt kê dòng âm.
-- ====================================================================

CREATE OR REPLACE FUNCTION public._wf2b_recompute_receivable(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v         record;
  v_credits numeric;
  v_net     numeric;
  v_id      uuid;
  v_paid    numeric;
BEGIN
  SELECT si.id, si.org_id, si.order_id, si.customer_id, si.sales_user_id,
         si.total, si.payment_terms, si.invoice_date, si.status
    INTO v
  FROM sales_invoices si WHERE si.id = p_invoice_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Hai luật trừ (mig 133): phiếu đi cùng hóa đơn trừ từ 'submitted', phiếu
  -- độc lập trừ khi 'completed'.
  SELECT COALESCE(sum(COALESCE(r.credit_note_amount, 0)), 0) INTO v_credits
  FROM returns r
  WHERE r.invoice_id = p_invoice_id
    AND (
      (r.credit_with_invoice AND r.status IN ('submitted', 'completed'))
      OR
      (NOT r.credit_with_invoice AND r.status = 'completed')
    );

  -- ⚠ KHÔNG KẸP VỀ 0 (mig 186): hàng trả lớn hơn hàng xuất là công nợ ÂM.
  v_net := COALESCE(v.total, 0) - v_credits;

  SELECT rc.id, COALESCE(rc.paid, 0) INTO v_id, v_paid
  FROM receivables rc WHERE rc.invoice_id = p_invoice_id LIMIT 1;

  IF v_id IS NULL AND v.status <> 'posted' THEN
    RETURN NULL;
  END IF;

  IF v_id IS NOT NULL THEN
    -- Trạng thái dòng âm do trigger `_cong_no_am_trang_thai` quyết.
    UPDATE receivables
    SET amount = v_net,
        status = CASE
                   WHEN v_paid >= v_net THEN 'paid'
                   WHEN v_paid > 0      THEN 'partial'
                   ELSE 'open'
                 END
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO receivables (
    org_id, order_id, invoice_id, customer_id, sales_user_id,
    amount, paid, due_date, status
  ) VALUES (
    v.org_id, v.order_id, v.id, v.customer_id, v.sales_user_id,
    v_net, 0,
    COALESCE(v.invoice_date, current_date)
      + public._wf2b_payment_terms_days(v.payment_terms),
    'open'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

COMMENT ON FUNCTION public._wf2b_recompute_receivable(uuid) IS
  'Công nợ của một hóa đơn = total − tiền trả; có thể ÂM khi hàng trả nhiều hơn hàng xuất (mig 186).';

-- ⚠ Hàm nội bộ SECURITY DEFINER — thu quyền gọi thẳng (luật mig 166).
REVOKE EXECUTE ON FUNCTION public._wf2b_recompute_receivable(uuid) FROM PUBLIC, anon, authenticated;

-- 2. Trạng thái của dòng âm — mọi đường ghi.
CREATE OR REPLACE FUNCTION public._cong_no_am_trang_thai()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $trg$
BEGIN
  IF NEW.amount < 0 THEN
    -- Còn dư có chưa dùng (paid > amount) → 'open'; dùng hết → 'paid'.
    NEW.status := CASE WHEN COALESCE(NEW.paid, 0) <= NEW.amount THEN 'paid' ELSE 'open' END;
  END IF;
  RETURN NEW;
END;
$trg$;

REVOKE EXECUTE ON FUNCTION public._cong_no_am_trang_thai() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cong_no_am_trang_thai ON public.receivables;
CREATE TRIGGER trg_cong_no_am_trang_thai
  BEFORE INSERT OR UPDATE ON public.receivables
  FOR EACH ROW EXECUTE FUNCTION public._cong_no_am_trang_thai();

-- 3. Tính lại các hóa đơn đang bị kẹp: công nợ 0 mà tiền trả > tổng hóa đơn.
DO $bu$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT si.id
    FROM sales_invoices si
    JOIN receivables rc ON rc.invoice_id = si.id
    WHERE si.status = 'posted'
      AND rc.amount = 0
      AND EXISTS (SELECT 1 FROM returns ret WHERE ret.invoice_id = si.id)
  LOOP
    PERFORM public._wf2b_recompute_receivable(r.id);
    n := n + 1;
  END LOOP;
  RAISE NOTICE '186: đã tính lại % hóa đơn', n;
END;
$bu$;

NOTIFY pgrst, 'reload schema';

SELECT 'Công nợ âm khi hàng trả > hàng xuất' AS hang_muc,
       CASE WHEN position('GREATEST(0' IN pg_get_functiondef('public._wf2b_recompute_receivable(uuid)'::regprocedure)) = 0
                 AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cong_no_am_trang_thai')
            THEN 'có' ELSE 'CHƯA' END AS trang_thai,
       (SELECT count(*) FROM receivables WHERE amount < 0) AS so_dong_cong_no_am;
