-- ====================================================================
-- 213 — SỬA NHÓM SAI TIỀN 4–5 (quét luồng 28/09/2026, docs/quet-luong-2026-09-28.md)
--
-- VÌ SAO — chủ nhà 28/09/2026: "lần lượt xử lý đến khi hoàn thành nhóm sai tiền 1–7".
--
--   4. SỬA HÓA ĐƠN MẤT GIẢM GIÁ ĐƠN VÀ DỜI NGÀY. `sales_invoices` không lưu giảm giá
--      đơn; tải trọng thiếu khoá `discount` (màn sửa trên điện thoại) là tờ mới mất
--      giảm giá → khách bị ghi nợ thêm. Thiếu `invoice_date` thì `post_invoice` lấy
--      hôm nay → doanh thu tờ tháng trước nhảy sang tháng này.
--      → `reissue_invoice` điền MẶC ĐỊNH TỪ TỜ CŨ khi tải trọng không có: ngày hóa
--        đơn, điều khoản thanh toán, giảm giá đơn (= Σ line_total − subtotal của tờ cũ).
--        Có khoá (kể cả `discount: 0`) thì theo tải trọng.
--   5. PHIẾU TRẢ TỰ LẬP (lập ở /returns/new, mang cả order_id lẫn invoice_id) BỊ BIẾN
--      THÀNH TỰ SINH khi sửa hóa đơn: `reissue_invoice` gỡ invoice_id của mọi phiếu
--      nháp/chờ, rồi câu gắn của `post_invoice` (`order_id = đơn AND invoice_id IS NULL`)
--      gắn nó thành tự sinh, Chờ xử lý, trừ nợ khi chưa ai duyệt.
--      → `reissue_invoice` ghi nhớ phiếu tự lập của tờ; câu gắn bỏ qua chúng (chúng
--        vẫn đi sang tờ mới qua đường `v_rets` cũ, giữ nguyên trạng thái / cờ).
--      → `cancel_invoice`: phiếu tự lập gắn tờ bị huỷ theo tờ (như phiếu POS), không
--        còn hạ thành "Nháp theo đơn" bị khoá.
--  (14) Phiếu nháp RỖNG (vd. tự sinh bị bỏ hết dòng khi sửa hóa đơn) huỷ được.
-- ⚠ Hàm nội bộ SECURITY DEFINER — REVOKE (luật mig 166).
-- ====================================================================

-- 1. Mặc định từ tờ cũ + ghi nhớ phiếu tự lập -------------------------------
CREATE OR REPLACE FUNCTION public._mac_dinh_lap_lai(p_invoice_id uuid, p jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_old  record;
  v_giam numeric;
  v_out  jsonb := COALESCE(p, '{}'::jsonb);
  v_ids  uuid[];
BEGIN
  SELECT si.invoice_date, si.payment_terms, si.subtotal INTO v_old
  FROM sales_invoices si WHERE si.id = p_invoice_id;

  IF NULLIF(v_out->>'invoice_date', '') IS NULL AND v_old.invoice_date IS NOT NULL THEN
    v_out := jsonb_set(v_out, '{invoice_date}', to_jsonb(v_old.invoice_date::text));
  END IF;
  IF NULLIF(v_out->>'payment_terms', '') IS NULL AND v_old.payment_terms IS NOT NULL THEN
    v_out := jsonb_set(v_out, '{payment_terms}', to_jsonb(v_old.payment_terms));
  END IF;
  IF NOT (v_out ? 'discount') THEN
    SELECT round(COALESCE(sum(sil.line_total), 0) - COALESCE(v_old.subtotal, 0)) INTO v_giam
    FROM sales_invoice_lines sil WHERE sil.invoice_id = p_invoice_id;
    IF v_giam > 0 THEN
      v_out := jsonb_set(v_out, '{discount}', to_jsonb(v_giam));
    END IF;
  END IF;

  -- Phiếu TỰ LẬP đang nháp/chờ của tờ: câu gắn của post_invoice phải bỏ qua chúng.
  SELECT COALESCE(array_agg(rt.id), '{}') INTO v_ids
  FROM returns rt
  WHERE rt.invoice_id = p_invoice_id AND rt.status IN ('draft', 'submitted')
    AND NOT COALESCE(rt.credit_with_invoice, false);
  PERFORM set_config('npp.giu_phieu_tu_lap', v_ids::text, true);

  RETURN v_out;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._mac_dinh_lap_lai(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- Bước sau của mig 210 dọn luôn ghi nhớ này.
DO $p$
DECLARE
  v_src text := pg_get_functiondef('public._tra_da_nhap_sau_lap_lai(uuid)'::regprocedure);
  v_re  text := '(PERFORM\s+set_config\(''npp\.tra_da_nhap_210'',\s*'''',\s*true\);)';
BEGIN
  IF position('npp.giu_phieu_tu_lap' IN v_src) > 0 THEN
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_src, v_re, 'g')) <> 1 THEN
    RAISE EXCEPTION '213: không thấy đúng một chỗ dọn trong _tra_da_nhap_sau_lap_lai' USING ERRCODE = 'P0001';
  END IF;
  EXECUTE regexp_replace(v_src, v_re,
    '\1' || chr(10) || '  PERFORM set_config(''npp.giu_phieu_tu_lap'', '''', true); -- (mig 213)');
END;
$p$;

-- 2. reissue_invoice gọi bước mặc định đầu tiên ----------------------------
DO $p$
DECLARE
  v_src text := pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure);
  v_re  text := '(PERFORM\s+public\._tra_da_nhap_truoc_lap_lai\(p_invoice_id,\s*p\);)';
BEGIN
  IF position('(mig 213)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 213: reissue_invoice đã điền mặc định từ tờ cũ, bỏ qua ---';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_src, v_re, 'g')) <> 1 THEN
    RAISE EXCEPTION '213: reissue_invoice chưa có bước mig 210 — chạy mig 210 trước' USING ERRCODE = 'P0001';
  END IF;
  EXECUTE regexp_replace(v_src, v_re,
    '-- (mig 213) Thiếu ngày / điều khoản / giảm giá đơn thì lấy của tờ cũ; ghi nhớ phiếu tự lập.' || chr(10)
    || '  p := public._mac_dinh_lap_lai(p_invoice_id, p);' || chr(10)
    || '  \1');
END;
$p$;

-- 3. post_invoice: câu gắn bỏ qua phiếu tự lập đang được lập lại -----------
DO $p$
DECLARE
  v_src text := pg_get_functiondef('public.post_invoice(jsonb)'::regprocedure);
  v_re  text := '(WHERE\s+ret\.order_id\s*=\s*v_order\s+AND\s+ret\.invoice_id\s+IS\s+NULL\s+AND\s+ret\.status\s+IN\s+\(''draft'',\s*''submitted''\))(\s*;)';
BEGIN
  IF position('(mig 213)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 213: post_invoice đã bỏ qua phiếu tự lập, bỏ qua ---';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_src, v_re, 'g')) <> 1 THEN
    RAISE EXCEPTION '213: không thấy đúng một câu gắn phiếu trả trong post_invoice' USING ERRCODE = 'P0001';
  END IF;
  EXECUTE regexp_replace(v_src, v_re,
    '\1' || chr(10)
    || '    -- (mig 213) Phiếu tự lập của tờ đang lập lại: giữ nguyên, không biến thành tự sinh.' || chr(10)
    || '    AND ret.id <> ALL (COALESCE(NULLIF(current_setting(''npp.giu_phieu_tu_lap'', true), '''')::uuid[], ''{}''::uuid[]))\2');
END;
$p$;

-- 4. cancel_invoice: phiếu tự lập gắn tờ bị huỷ theo tờ ---------------------
DO $p$
DECLARE
  v_oid oid;
  v_src text;
  v_re1 text := '(AND\s+status\s+IN\s+\(''draft'',\s*''submitted''\)\s+AND\s+order_id\s+IS\s+NOT\s+NULL)(\s*;)';
  v_re2 text := '(AND\s+status\s+IN\s+\(''draft'',\s*''submitted''\)\s+)AND\s+order_id\s+IS\s+NULL(\s*;)';
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'cancel_invoice';
  v_src := pg_get_functiondef(v_oid);
  IF position('(mig 213)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 213: cancel_invoice đã huỷ phiếu tự lập theo tờ, bỏ qua ---';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_src, v_re1, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_src, v_re2, 'g')) <> 1 THEN
    RAISE EXCEPTION '213: không thấy đúng hai câu xử lý phiếu trả trong cancel_invoice' USING ERRCODE = 'P0001';
  END IF;
  v_src := regexp_replace(v_src, v_re1, '\1 AND credit_with_invoice /* (mig 213) chỉ phiếu theo đơn */\2');
  v_src := regexp_replace(v_src, v_re2,
    '\1AND (order_id IS NULL OR NOT credit_with_invoice) /* (mig 213) phiếu tự lập huỷ theo tờ */\2');
  EXECUTE v_src;
END;
$p$;

-- 5. cancel_return: nháp rỗng huỷ được ------------------------------------
DO $p$
DECLARE
  v_src text := pg_get_functiondef('public.cancel_return(uuid, text)'::regprocedure);
  v_re  text := '(IF\s+r\.status\s+IN\s+\(''draft'',\s*''submitted''\)\s+THEN)';
BEGIN
  IF position('(mig 213)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 213: cancel_return đã cho huỷ nháp rỗng, bỏ qua ---';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_src, v_re, 'g')) <> 1 THEN
    RAISE EXCEPTION '213: không thấy đúng một nhánh nháp/chờ trong cancel_return' USING ERRCODE = 'P0001';
  END IF;
  EXECUTE regexp_replace(v_src, v_re,
    '-- (mig 213) Nháp RỖNG (vd. tự sinh bị bỏ hết dòng khi sửa hóa đơn) — không còn gì' || chr(10)
    || '  --   để theo hóa đơn / đơn; cho dọn.' || chr(10)
    || '  IF r.status = ''draft'' AND NOT EXISTS (SELECT 1 FROM return_lines rl WHERE rl.return_id = p_return_id) THEN' || chr(10)
    || '    UPDATE returns SET status = ''cancelled'', cancelled_at = now(), cancel_reason = p_reason WHERE id = p_return_id;' || chr(10)
    || '    RETURN;' || chr(10)
    || '  END IF;' || chr(10)
    || '  \1');
END;
$p$;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 213: sửa HĐ giữ ngày / giảm giá; phiếu tự lập giữ nguyên' AS buoc,
       CASE WHEN position('(mig 213)' IN pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure)) > 0
             AND position('(mig 213)' IN pg_get_functiondef('public.post_invoice(jsonb)'::regprocedure)) > 0
             AND position('(mig 213)' IN pg_get_functiondef('public.cancel_return(uuid, text)'::regprocedure)) > 0
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua;
