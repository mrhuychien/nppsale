-- ====================================================================
-- PHIẾU TRẢ HOÀN THÀNH PHẢI GẮN HÓA ĐƠN ĐÃ XUẤT; PHIẾU CẤN Ở PHIẾU THU KIỂU CŨ KHÔNG TRỪ HAI LẦN
--
-- VÌ SAO — chủ nhà 26/09/2026, trả lời bốn trường hợp còn treo sau đợt rà công nợ:
--   · "Phiếu trả gắn một đơn chưa xuất hóa đơn -> phiếu trả hoàn thành phải gắn với 1 hóa
--     đơn đã xuất chứ ko gắn với đơn hàng".
--     Trước đây: đơn đã ở trạng thái xuất nhưng KHÔNG còn hóa đơn ghi sổ nào (HĐ đã huỷ…)
--     thì phiếu vẫn hoàn thành — kho nhập, công nợ không trừ (không có HĐ để trừ), doanh số
--     lại trừ. Nay: hoàn thành phiếu gắn ĐƠN mà chưa gắn HĐ → đơn có đúng 1 HĐ đã ghi sổ thì
--     tự gắn HĐ đó; không có HĐ nào / nhiều HĐ → CHẶN, báo rõ.
--   · "Phiếu trả đã cấn trừ ở phiếu thu theo cách cũ -> rà lại".
--     Trước mig 191, "cấn trừ phiếu trả" ở phiếu thu không kiểm phiếu đã gắn hóa đơn chưa:
--     phiếu gắn HĐ vừa trừ vào công nợ của HĐ, vừa trừ thêm một lần như tiền đã thu. Nay:
--     phiếu đã cấn ở phiếu thu (`applied_receipt_id`) không trừ vào HĐ nữa — khoản có đã nằm
--     trong phiếu thu. Huỷ phiếu thu (trả `applied_receipt_id` về NULL) thì HĐ tự trừ lại.
--   · "Phiếu trả cũ ở trạng thái approved -> rà lại": không còn phiếu nào — CHECK của
--     `returns` chỉ nhận draft/submitted/completed/cancelled (mig 119 đổi approved → submitted,
--     mig 191 đổi phiếu tự lập submitted → draft). Câu tóm tắt cuối tệp đếm lại cho chắc.
-- ====================================================================

-- 1. Tính lại công nợ HĐ: bỏ phiếu đã cấn ở phiếu thu -------------------------------
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
    )
    -- ⚠ (mig 200) Phiếu đã CẤN Ở PHIẾU THU theo cách cũ: khoản có nằm trong tiền đã thu
    --   (payment 'return_credit'). Trừ lần nữa vào hóa đơn là trừ HAI LẦN.
    AND r.applied_receipt_id IS NULL;

  -- ⚠ KHÔNG KẸP VỀ 0 (mig 186): hàng trả lớn hơn hàng xuất là công nợ ÂM.
  v_net := COALESCE(v.total, 0) - v_credits;

  SELECT rc.id, COALESCE(rc.paid, 0) INTO v_id, v_paid
  FROM receivables rc WHERE rc.invoice_id = p_invoice_id LIMIT 1;

  IF v_id IS NULL AND v.status <> 'posted' THEN
    RETURN NULL;
  END IF;

  IF v_id IS NOT NULL THEN
    -- ⚠ (mig 194) Người + khách đi theo HÓA ĐƠN mỗi lần tính lại — bản cũ chỉ ghi lúc
    --   lập, hóa đơn đổi người là nợ kẹt ở người cũ.
    UPDATE receivables
    SET amount = v_net,
        sales_user_id = v.sales_user_id,
        customer_id = v.customer_id,
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

REVOKE EXECUTE ON FUNCTION public._wf2b_recompute_receivable(uuid) FROM PUBLIC, anon, authenticated;

-- 2. Phiếu trả đổi trạng thái cấn trừ ở phiếu thu → HĐ gắn nó tính lại ---------------
CREATE OR REPLACE FUNCTION public._phieu_tra_doi_can_tru()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $trg$
BEGIN
  IF NEW.invoice_id IS NOT NULL THEN
    PERFORM public._wf2b_recompute_receivable(NEW.invoice_id);
  END IF;
  RETURN NULL;
END;
$trg$;

REVOKE EXECUTE ON FUNCTION public._phieu_tra_doi_can_tru() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_phieu_tra_doi_can_tru ON public.returns;
CREATE TRIGGER trg_phieu_tra_doi_can_tru
  AFTER UPDATE OF applied_receipt_id ON public.returns
  FOR EACH ROW WHEN (NEW.applied_receipt_id IS DISTINCT FROM OLD.applied_receipt_id)
  EXECUTE FUNCTION public._phieu_tra_doi_can_tru();

-- 3. Hoàn thành phiếu gắn ĐƠN → phải có HĐ đã ghi sổ -------------------------------
CREATE OR REPLACE FUNCTION public._phieu_tra_hoan_thanh_gan_hd()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $trg$
DECLARE
  v_n  int;
  v_hd uuid;
  v_nv uuid;
BEGIN
  IF NEW.status <> 'completed' OR NEW.invoice_id IS NOT NULL OR NEW.order_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;
  SELECT count(*), min(si.id::text)::uuid INTO v_n, v_hd
  FROM sales_invoices si
  WHERE si.order_id = NEW.order_id AND si.status = 'posted';
  IF v_n = 0 THEN
    RAISE EXCEPTION 'RETURN_NEEDS_INVOICE: đơn gốc chưa có hóa đơn đã xuất — phiếu trả hoàn thành phải gắn với một hóa đơn đã xuất'
      USING ERRCODE = 'P0001';
  ELSIF v_n > 1 THEN
    RAISE EXCEPTION 'RETURN_NEEDS_INVOICE: đơn có % hóa đơn đã xuất — chọn hóa đơn cho phiếu trả trước khi hoàn thành', v_n
      USING ERRCODE = 'P0001';
  END IF;
  SELECT sales_user_id INTO v_nv FROM sales_invoices WHERE id = v_hd;
  NEW.invoice_id := v_hd;
  NEW.sales_user_id := COALESCE(v_nv, NEW.sales_user_id);
  RETURN NEW;
END;
$trg$;

REVOKE EXECUTE ON FUNCTION public._phieu_tra_hoan_thanh_gan_hd() FROM PUBLIC, anon, authenticated;

-- ⚠ Tên "trg_p…" chạy TRƯỚC "trg_zz_returns_revenue_date" (BEFORE chạy theo thứ tự tên).
DROP TRIGGER IF EXISTS trg_phieu_tra_hoan_thanh_gan_hd ON public.returns;
CREATE TRIGGER trg_phieu_tra_hoan_thanh_gan_hd
  BEFORE INSERT OR UPDATE OF status ON public.returns
  FOR EACH ROW EXECUTE FUNCTION public._phieu_tra_hoan_thanh_gan_hd();

-- 4. Ghi bù dữ liệu cũ --------------------------------------------------------------
DO $bu$
DECLARE
  v_gan int := 0; v_hai_lan int := 0; r record;
BEGIN
  -- 4a. Phiếu đã hoàn thành gắn đơn, chưa gắn HĐ, đơn có đúng 1 HĐ đã ghi sổ → gắn HĐ đó.
  FOR r IN
    SELECT ret.id, (SELECT min(si.id::text)::uuid FROM sales_invoices si
                    WHERE si.order_id = ret.order_id AND si.status = 'posted') AS hd
    FROM returns ret
    WHERE ret.status = 'completed' AND ret.invoice_id IS NULL AND ret.order_id IS NOT NULL
      AND (SELECT count(*) FROM sales_invoices si
           WHERE si.order_id = ret.order_id AND si.status = 'posted') = 1
  LOOP
    UPDATE returns SET invoice_id = r.hd WHERE id = r.id;
    PERFORM public._wf2b_recompute_receivable(r.hd);
    v_gan := v_gan + 1;
  END LOOP;

  -- 4b. HĐ có phiếu trả đã cấn ở phiếu thu → tính lại (hết trừ hai lần).
  FOR r IN
    SELECT DISTINCT ret.invoice_id FROM returns ret
    WHERE ret.applied_receipt_id IS NOT NULL AND ret.invoice_id IS NOT NULL
  LOOP
    PERFORM public._wf2b_recompute_receivable(r.invoice_id);
    v_hai_lan := v_hai_lan + 1;
  END LOOP;

  RAISE NOTICE '--- 200: gắn HĐ cho % phiếu trả theo đơn; tính lại % HĐ có phiếu cấn ở phiếu thu ---', v_gan, v_hai_lan;
END;
$bu$;

NOTIFY pgrst, 'reload schema';

SELECT 'Phiếu trả hoàn thành gắn HĐ; không trừ hai lần' AS hang_muc,
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_phieu_tra_hoan_thanh_gan_hd')
                 AND position('applied_receipt_id IS NULL' IN pg_get_functiondef('public._wf2b_recompute_receivable(uuid)'::regprocedure)) > 0
            THEN 'có' ELSE 'CHƯA' END AS trang_thai,
       (SELECT count(*) FROM returns WHERE status = 'completed' AND invoice_id IS NULL AND order_id IS NOT NULL) AS con_phieu_theo_don_chua_gan_hd,
       (SELECT count(*) FROM returns WHERE applied_receipt_id IS NOT NULL AND invoice_id IS NOT NULL) AS phieu_can_o_phieu_thu_gan_hd,
       (SELECT count(*) FROM returns WHERE status NOT IN ('draft', 'submitted', 'completed', 'cancelled')) AS phieu_trang_thai_cu;
