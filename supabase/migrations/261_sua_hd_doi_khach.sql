-- ====================================================================
-- 261 — SỬA HOÁ ĐƠN ĐỔI ĐƯỢC KHÁCH HÀNG
--
-- VÌ SAO — chủ nhà 12/11/2026: "E sửa phần sửa hoá đơn cho phép đổi khách hàng (cả trên đt và pos)".
--   `reissue_invoice` (Sửa HĐ) huỷ tờ cũ rồi gọi `post_invoice` theo ĐƠN — khách lấy từ `sales_orders.customer_id`, nên
--   chọn nhầm khách lúc lên đơn là không sửa được: phải huỷ hoá đơn (= huỷ đơn, mig 217) rồi lên lại từ đầu.
--
-- ⚠ LUẬT (một đơn một hoá đơn — mig 217):
--   · Tải trọng mang `customer_id` khác khách của tờ → tờ mới, ĐƠN của tờ và mọi phiếu trả sẽ bám tờ mới (phiếu theo đơn,
--     phiếu tự lập gắn tờ, phiếu đã nhập kho giữ nguyên — mig 210) sang khách mới. Phiếu trả bám hoá đơn phải cùng khách
--     với hoá đơn (`_phieu_tra_dung_khach_hoa_don`), nên đổi khi chúng đang KHÔNG bám tờ nào: ngay trước `post_invoice`.
--   · Tờ cũ (đã huỷ) giữ khách cũ — lịch sử. Công nợ: tờ cũ xoá theo `cancel_invoice`, tờ mới ghi cho khách mới.
--   · KHÔNG đổi người bán / người giữ nợ (mig 182 / 227): nhầm khách không đổi ai đã bán.
--   · Đổi khách của đơn làm `trg_sales_orders_bump_edit` tăng số sửa của đơn (DH-…-n) — như mọi lần sửa khách của đơn.
--   · ĐÃ THU TIỀN thì KHÔNG đổi (REISSUE_DOI_KHACH_DA_THU): phiếu thu là của khách cũ; mig 184 chuyển tiền thu sang tờ mới —
--     đổi khách là chuyển tiền của người này sang nợ của người khác. Huỷ phiếu thu trước. Cùng phép kiểm của `cancel_invoice`.
--   · Khách mới phải cùng NPP và người sửa NHÌN THẤY được (cùng điều kiện chính sách `customer_select`, mig 260) —
--     `reissue_invoice` là SECURITY DEFINER, RLS không tự chặn (REISSUE_KHACH_KHONG_HOP_LE).
--   · Kiểm SỚM (ngay sau `_mac_dinh_lap_lai`, trước khi đụng phiếu trả / tiền thu), áp MUỘN (ngay trước `post_invoice`) —
--     qua cờ phiên `npp.doi_khach_lap_lai` (chỉ hàm trong giao dịch này đặt).
-- ⚠ VÁ CHUỖI BẢN ĐANG CHẠY (như mig 210 / 247): mỗi chỗ vá phải thấy đúng 1 lần, không thì dừng.
-- ====================================================================

-- 1) Kiểm sớm: khách mới hợp lệ, tờ chưa thu tiền → đặt cờ phiên -----------------------------------
CREATE OR REPLACE FUNCTION public._doi_khach_lap_lai_kiem(p_invoice_id uuid, p jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_moi uuid;
  v_hd  record;
BEGIN
  PERFORM set_config('npp.doi_khach_lap_lai', '', true);
  v_moi := NULLIF(btrim(COALESCE(p->>'customer_id', '')), '')::uuid;
  IF v_moi IS NULL THEN
    RETURN;
  END IF;

  SELECT si.customer_id, si.order_id, si.org_id INTO v_hd
    FROM sales_invoices si WHERE si.id = p_invoice_id;
  IF NOT FOUND OR v_hd.customer_id = v_moi THEN
    RETURN;
  END IF;

  -- Cùng điều kiện chính sách `customer_select` (mig 260): vai xem hết / quyền xem hết / được phân công / tự tạo / đã bán.
  IF NOT EXISTS (
    SELECT 1 FROM customers c
     WHERE c.id = v_moi
       AND c.org_id = v_hd.org_id
       AND (public.user_role() IN ('owner', 'manager', 'accountant')
            OR public.user_has_permission(auth.uid(), 'customer.view_all')
            OR EXISTS (SELECT 1 FROM customer_assignments ca
                        WHERE ca.customer_id = c.id AND ca.user_id = auth.uid() AND ca.status = 'active')
            OR c.created_by = auth.uid()
            OR c.id IN (SELECT public.khach_toi_da_ban()))
  ) THEN
    RAISE EXCEPTION 'REISSUE_KHACH_KHONG_HOP_LE: không tìm thấy khách hàng mới, hoặc bạn không được bán cho khách này'
      USING ERRCODE = 'P0001';
  END IF;

  -- Cùng phép kiểm "đã thu" của `cancel_invoice` (kể cả dòng phiếu thu cũ chỉ ghi `order_id`).
  IF EXISTS (SELECT 1 FROM receivables r WHERE r.invoice_id = p_invoice_id AND COALESCE(r.paid, 0) <> 0)
     OR EXISTS (
       SELECT 1 FROM cash_receipt_lines crl
         JOIN cash_receipts cr ON cr.id = crl.receipt_id
        WHERE cr.status <> 'voided'
          AND (crl.invoice_id = p_invoice_id OR (crl.invoice_id IS NULL AND crl.order_id = v_hd.order_id)))
  THEN
    RAISE EXCEPTION 'REISSUE_DOI_KHACH_DA_THU: hoá đơn đã thu tiền của khách cũ — huỷ phiếu thu trước rồi mới đổi khách'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('npp.doi_khach_lap_lai', v_moi::text, true);
END;
$fn$;

-- 2) Áp muộn (ngay trước post_invoice): phiếu trả sắp bám tờ mới + đơn sang khách mới, ghi nhật ký đơn ------------
CREATE OR REPLACE FUNCTION public._doi_khach_lap_lai_ap(p_invoice_id uuid, p_rets uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_moi uuid := NULLIF(current_setting('npp.doi_khach_lap_lai', true), '')::uuid;
  v_hd  record;
  v_gan uuid[];
BEGIN
  PERFORM set_config('npp.doi_khach_lap_lai', '', true);
  IF v_moi IS NULL THEN
    RETURN;
  END IF;

  SELECT si.customer_id, si.order_id, si.org_id, si.invoice_code INTO v_hd
    FROM sales_invoices si WHERE si.id = p_invoice_id;

  -- Phiếu đã nhập kho "giữ nguyên" (mig 210): đang gỡ khỏi tờ cũ, gắn lại vào tờ mới sau `post_invoice`.
  SELECT COALESCE(array_agg(x.id), '{}') INTO v_gan
    FROM jsonb_to_recordset(COALESCE(NULLIF(current_setting('npp.tra_da_nhap_210', true), '')::jsonb, '[]'::jsonb))
         AS x(id uuid, lam text)
   WHERE x.lam = 'gan_lai';

  -- Lúc này tờ cũ đã huỷ: mọi phiếu sẽ bám tờ mới đều đang KHÔNG bám hoá đơn nào → đổi khách được.
  UPDATE returns rt
     SET customer_id = v_moi
   WHERE rt.invoice_id IS NULL
     AND rt.status <> 'cancelled'
     AND rt.customer_id IS DISTINCT FROM v_moi
     AND (rt.order_id = v_hd.order_id OR rt.id = ANY (COALESCE(p_rets, '{}'::uuid[])) OR rt.id = ANY (v_gan));

  UPDATE sales_orders so SET customer_id = v_moi WHERE so.id = v_hd.order_id;

  INSERT INTO order_activity_log (org_id, order_id, action, workflow_stage, changes, actor_id)
  VALUES (v_hd.org_id, v_hd.order_id, 'edit_after_complete', NULL,
          jsonb_build_object(
            'doi_khach', jsonb_build_object(
              'from', (SELECT c.store_name FROM customers c WHERE c.id = v_hd.customer_id),
              'to',   (SELECT c.store_name FROM customers c WHERE c.id = v_moi)),
            'customer_id', jsonb_build_object('from', v_hd.customer_id, 'to', v_moi),
            'invoice_id', p_invoice_id,
            'invoice_code', v_hd.invoice_code),
          auth.uid());
END;
$fn$;

-- Hàm nội bộ: chỉ `reissue_invoice` (SECURITY DEFINER) gọi — luật mig 166.
REVOKE EXECUTE ON FUNCTION public._doi_khach_lap_lai_kiem(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._doi_khach_lap_lai_ap(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

-- 3) reissue_invoice: kiểm ngay sau phần mặc định, áp ngay trước post_invoice -------------------------------------
DO $p$
DECLARE
  v_src text := pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure);
  v_a1  text := '  p := public._mac_dinh_lap_lai(p_invoice_id, p);';
  v_b1  text := '  p := public._mac_dinh_lap_lai(p_invoice_id, p);' || chr(10)
              || '  PERFORM public._doi_khach_lap_lai_kiem(p_invoice_id, p); -- (mig 261) đổi khách: kiểm trước khi đụng gì';
  v_a2  text := '  -- (mig 247) Dòng cùng mặt hàng + đơn vị với tờ cũ';
  v_b2  text := '  -- (mig 261) Đổi khách: phiếu trả sắp bám tờ mới + đơn sang khách mới (tờ cũ đã huỷ, phiếu đang không bám tờ nào).' || chr(10)
              || '  PERFORM public._doi_khach_lap_lai_ap(p_invoice_id, v_rets);' || chr(10)
              || '  -- (mig 247) Dòng cùng mặt hàng + đơn vị với tờ cũ';
  v_n1  int;
  v_n2  int;
BEGIN
  IF position('(mig 261)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 261: reissue_invoice đã nhận đổi khách, bỏ qua ---';
    RETURN;
  END IF;
  v_n1 := (length(v_src) - length(replace(v_src, v_a1, ''))) / length(v_a1);
  v_n2 := (length(v_src) - length(replace(v_src, v_a2, ''))) / length(v_a2);
  IF v_n1 <> 1 OR v_n2 <> 1 THEN
    RAISE EXCEPTION '261: reissue_invoice thấy % / % chỗ cần vá, cần đúng 1 / 1', v_n1, v_n2 USING ERRCODE = 'P0001';
  END IF;
  EXECUTE replace(replace(v_src, v_a1, v_b1), v_a2, v_b2);
END;
$p$;

NOTIFY pgrst, 'reload schema';

-- Tóm tắt: đã vá + hai hàm phụ có mặt và không gọi thẳng được từ trình duyệt.
SELECT
  position('(mig 261)' IN pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure)) > 0 AS reissue_doi_khach,
  to_regprocedure('public._doi_khach_lap_lai_kiem(uuid, jsonb)') IS NOT NULL
    AND NOT has_function_privilege('authenticated', 'public._doi_khach_lap_lai_kiem(uuid, jsonb)', 'EXECUTE') AS ham_kiem,
  to_regprocedure('public._doi_khach_lap_lai_ap(uuid, uuid[])') IS NOT NULL
    AND NOT has_function_privilege('authenticated', 'public._doi_khach_lap_lai_ap(uuid, uuid[])', 'EXECUTE') AS ham_ap;
