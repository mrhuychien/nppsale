-- ====================================================================
-- DOANH SỐ NHÂN VIÊN KHỚP CÔNG NỢ NHÂN VIÊN
--
-- VÌ SAO — chủ nhà 25/09/2026: "rà soát lại toàn bộ cho tao tại sao doanh số nhân
--   viên lại lệch so với công nợ nhân viên".
--
-- Rà ra bốn chỗ làm cùng một đồng tiền rơi vào HAI người khác nhau, hoặc hai màn cộng
-- hai kiểu:
--   1. `_wf2b_recompute_receivable` chỉ ghi `sales_user_id` / `customer_id` lúc LẬP
--      dòng công nợ; tính lại thì chỉ đổi số tiền. Hóa đơn đổi người (hay dòng cũ từ
--      mig 124) là nợ kẹt ở người cũ mãi mãi, trong khi doanh số đã sang người mới.
--   2. Phiếu trả GẮN HÓA ĐƠN được gán người khác người đứng tên hóa đơn: doanh số trừ
--      vào người của phiếu, còn công nợ trừ vào dòng nợ của hóa đơn (người của HĐ).
--      → Luật mới: phiếu trả gắn HĐ LUÔN theo người đứng tên HĐ (trigger), gán lại ở HĐ.
--   3. Gán lại người cho phiếu trả tự lập không làm dòng công nợ âm (`return_id`, mig
--      191) đổi theo → trigger đẩy người sang dòng nợ. Phiếu không ghi tên người thì
--      điền một lần theo luật: HĐ gắn → đơn gắn → HĐ gần nhất của khách (đúng đường đoán
--      của màn doanh số), để hai bên đọc CÙNG một cột.
--   4. (mig 195) `receivables_by_rep` / `receivables_summary` kẹp từng dòng về 0
--      (`GREATEST(0, …)`) — sai luật công nợ âm (mig 186): dư có của khách phải được
--      trừ vào tổng nợ. Dòng không có nhân viên thì hiện thành một dòng riêng thay vì
--      biến mất.
-- Còn lại là khác khái niệm, không phải lỗi: doanh số tính trong KỲ, công nợ là mọi
-- khoản còn mở; phiếu thu giảm nợ không đụng doanh số; nợ đầu kỳ không có doanh số.
-- Soi từng nhân viên: `scripts/sql/doi-soat-doanh-so-cong-no-nv.sql`.
-- ====================================================================

-- 1. Tính lại công nợ của hóa đơn: đồng bộ luôn người + khách ----------
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

-- 2. Người đứng tên phiếu trả -------------------------------------------
-- Luật: gắn HĐ → người của HĐ; không thì giữ người đã ghi; trống thì đơn gắn → HĐ gần
-- nhất của khách.
CREATE OR REPLACE FUNCTION public._nguoi_cua_phieu_tra(
  p_invoice uuid, p_order uuid, p_customer uuid, p_org uuid, p_hien_tai uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT COALESCE(
    (SELECT si.sales_user_id FROM sales_invoices si WHERE si.id = p_invoice),
    p_hien_tai,
    (SELECT so.sales_user_id FROM sales_orders so WHERE so.id = p_order),
    (SELECT si.sales_user_id FROM sales_invoices si
      WHERE si.customer_id = p_customer AND si.org_id = p_org
        AND si.status = 'posted' AND si.sales_user_id IS NOT NULL
      ORDER BY si.invoice_date DESC, si.created_at DESC LIMIT 1))
$fn$;

REVOKE EXECUTE ON FUNCTION public._nguoi_cua_phieu_tra(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._phieu_tra_theo_nguoi_hoa_don()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $trg$
BEGIN
  NEW.sales_user_id := public._nguoi_cua_phieu_tra(
    NEW.invoice_id, NEW.order_id, NEW.customer_id, NEW.org_id, NEW.sales_user_id);
  RETURN NEW;
END;
$trg$;

REVOKE EXECUTE ON FUNCTION public._phieu_tra_theo_nguoi_hoa_don() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_phieu_tra_theo_nguoi_hoa_don ON public.returns;
CREATE TRIGGER trg_phieu_tra_theo_nguoi_hoa_don
  BEFORE INSERT OR UPDATE OF sales_user_id, invoice_id, order_id, customer_id ON public.returns
  FOR EACH ROW EXECUTE FUNCTION public._phieu_tra_theo_nguoi_hoa_don();

-- Phiếu trả đổi người → dòng công nợ âm của nó (`return_id`) đổi theo.
CREATE OR REPLACE FUNCTION public._phieu_tra_doi_nguoi_cong_no()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $trg$
BEGIN
  UPDATE receivables SET sales_user_id = NEW.sales_user_id
  WHERE return_id = NEW.id AND sales_user_id IS DISTINCT FROM NEW.sales_user_id;
  RETURN NULL;
END;
$trg$;

REVOKE EXECUTE ON FUNCTION public._phieu_tra_doi_nguoi_cong_no() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_phieu_tra_doi_nguoi_cong_no ON public.returns;
CREATE TRIGGER trg_phieu_tra_doi_nguoi_cong_no
  AFTER UPDATE OF sales_user_id ON public.returns
  FOR EACH ROW WHEN (NEW.sales_user_id IS DISTINCT FROM OLD.sales_user_id)
  EXECUTE FUNCTION public._phieu_tra_doi_nguoi_cong_no();

-- Hóa đơn đổi người → dòng nợ + mọi phiếu trả gắn nó đổi theo.
CREATE OR REPLACE FUNCTION public._hoa_don_doi_nguoi()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $trg$
BEGIN
  UPDATE receivables SET sales_user_id = NEW.sales_user_id
  WHERE invoice_id = NEW.id AND sales_user_id IS DISTINCT FROM NEW.sales_user_id;
  UPDATE returns SET sales_user_id = NEW.sales_user_id
  WHERE invoice_id = NEW.id AND sales_user_id IS DISTINCT FROM NEW.sales_user_id;
  RETURN NULL;
END;
$trg$;

REVOKE EXECUTE ON FUNCTION public._hoa_don_doi_nguoi() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_hoa_don_doi_nguoi ON public.sales_invoices;
CREATE TRIGGER trg_hoa_don_doi_nguoi
  AFTER UPDATE OF sales_user_id ON public.sales_invoices
  FOR EACH ROW WHEN (NEW.sales_user_id IS DISTINCT FROM OLD.sales_user_id)
  EXECUTE FUNCTION public._hoa_don_doi_nguoi();

-- 3. assign_doc_seller: phiếu trả gắn HĐ thì gán ở HĐ ---------------------
CREATE OR REPLACE FUNCTION public.assign_doc_seller(p_kind text, p_id uuid, p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid := public.user_org_id();
  v_hd  uuid;
BEGIN
  IF public.user_role() NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'ASSIGN_FORBIDDEN: chỉ NPP (chủ / quản lý) được gán người phụ trách'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_user IS NULL OR NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = p_user AND u.org_id = v_org
      AND u.role IN ('sales', 'manager', 'owner')
      AND COALESCE(u.is_active, true)
  ) THEN
    RAISE EXCEPTION 'ASSIGN_BAD_USER: người được gán phải là nhân viên bán hàng / quản lý / chủ đang hoạt động của đơn vị'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('npp.via_rpc', 'on', true);

  IF p_kind = 'invoice' THEN
    UPDATE sales_invoices SET sales_user_id = p_user WHERE id = p_id AND org_id = v_org;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DOC_NOT_FOUND: không tìm thấy hóa đơn' USING ERRCODE = 'P0001';
    END IF;
    -- Dòng nợ + phiếu trả gắn HĐ đổi theo: trigger `trg_hoa_don_doi_nguoi` (mig 194).
  ELSIF p_kind = 'return' THEN
    SELECT invoice_id INTO v_hd FROM returns WHERE id = p_id AND org_id = v_org;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DOC_NOT_FOUND: không tìm thấy phiếu trả' USING ERRCODE = 'P0001';
    END IF;
    IF v_hd IS NOT NULL THEN
      RAISE EXCEPTION 'RETURN_SELLER_FOLLOWS_INVOICE: phiếu trả gắn hóa đơn đi theo người đứng tên hóa đơn — gán lại ở hóa đơn'
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE returns SET sales_user_id = p_user WHERE id = p_id AND org_id = v_org;
  ELSE
    RAISE EXCEPTION 'ASSIGN_BAD_KIND: %', p_kind USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('npp.via_rpc', '', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.assign_doc_seller(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_doc_seller(text, uuid, uuid) TO authenticated;

-- 4. Hai hàm tổng công nợ (bỏ kẹp 0): tách sang mig 195 — tệp định nghĩa chúng không
--    được có SECURITY DEFINER (chốt tests/aging-thresholds).

-- 5. Ghi bù dữ liệu cũ ------------------------------------------------------
DO $bu$
DECLARE
  v_rc int; v_tra int; v_am int;
BEGIN
  -- Phiếu trả: người theo luật (gắn HĐ → người HĐ; trống → đơn → HĐ gần nhất của khách).
  UPDATE returns r
  SET sales_user_id = public._nguoi_cua_phieu_tra(r.invoice_id, r.order_id, r.customer_id, r.org_id, r.sales_user_id)
  WHERE r.sales_user_id IS DISTINCT FROM
        public._nguoi_cua_phieu_tra(r.invoice_id, r.order_id, r.customer_id, r.org_id, r.sales_user_id);
  GET DIAGNOSTICS v_tra = ROW_COUNT;

  -- Dòng nợ của hóa đơn: người + khách theo hóa đơn.
  UPDATE receivables rc
  SET sales_user_id = si.sales_user_id, customer_id = si.customer_id
  FROM sales_invoices si
  WHERE si.id = rc.invoice_id
    AND (rc.sales_user_id IS DISTINCT FROM si.sales_user_id
         OR rc.customer_id IS DISTINCT FROM si.customer_id);
  GET DIAGNOSTICS v_rc = ROW_COUNT;

  -- Dòng nợ âm của phiếu trả tự lập: người theo phiếu.
  UPDATE receivables rc
  SET sales_user_id = r.sales_user_id
  FROM returns r
  WHERE r.id = rc.return_id AND rc.sales_user_id IS DISTINCT FROM r.sales_user_id;
  GET DIAGNOSTICS v_am = ROW_COUNT;

  RAISE NOTICE '--- 194: sửa người % phiếu trả, % dòng nợ HĐ, % dòng nợ âm ---', v_tra, v_rc, v_am;
END;
$bu$;

NOTIFY pgrst, 'reload schema';

SELECT 'Người đứng tên công nợ khớp doanh số' AS hang_muc,
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hoa_don_doi_nguoi')
            THEN 'có' ELSE 'CHƯA' END AS trang_thai,
       (SELECT count(*) FROM receivables rc JOIN sales_invoices si ON si.id = rc.invoice_id
         WHERE rc.sales_user_id IS DISTINCT FROM si.sales_user_id) AS no_hd_lech_nguoi,
       (SELECT count(*) FROM returns r JOIN sales_invoices si ON si.id = r.invoice_id
         WHERE r.sales_user_id IS DISTINCT FROM si.sales_user_id AND si.sales_user_id IS NOT NULL) AS tra_lech_nguoi_hd,
       (SELECT count(*) FROM returns WHERE status = 'approved') AS phieu_tra_approved_cu;
