-- ====================================================================
-- 210 — SỬA HÓA ĐƠN KHI PHIẾU TRẢ THEO HÓA ĐƠN ĐÃ NHẬP KHO
--
-- VÌ SAO — chủ nhà 28/09/2026:
--   "khi sửa hoá đơn có phiếu nhập kho đã hoàn thành -> hệ thống sẽ hỏi
--    'Cần huỷ phiếu nhập trước?' y/n -> yes -> huỷ phiếu nhập, trên hoá đơn
--    sửa được tất cả thông tin, khi cập nhật -> cập nhật lại hết"
--   "No -> giữ nguyên phiếu nhập gắn vào hoá đơn mới."
--
-- Trước bản này: `reissue_invoice` gọi `cancel_invoice`, mà hàm ấy CHẶN hẳn
-- (LOCKED_RETURN_DONE) khi hóa đơn có phiếu trả đã hoàn thành — muốn sửa phải
-- ra phiếu "Huỷ nhập kho" bằng tay, sửa hóa đơn, rồi quay lại hoàn thành phiếu.
--
-- CÁCH LÀM — tải trọng `reissue_invoice` nhận thêm `tra_da_nhap`:
--   · 'lam_lai' (Có): phiếu TỰ SINH đã nhập kho → `cancel_return` (đảo kho, về
--     Chờ xử lý — luật mig 191) NGAY TRONG giao dịch lập lại, trước khi áp phần
--     sửa dòng trả; phiếu đi theo tờ mới như mọi phiếu chờ; xong tờ mới thì
--     `complete_return` lại vào ĐÚNG kho cũ (`destination_zone`) theo số mới.
--   · 'giu' (Không): phiếu giữ nguyên phiếu nhập — gỡ khỏi tờ cũ trước khi huỷ
--     tờ (để `cancel_invoice` khỏi chặn), gắn sang tờ mới, tính lại công nợ tờ mới.
--   · Phiếu TỰ LẬP đã hoàn thành gắn hóa đơn: luôn 'giu' (sửa nó ở phiếu, không ở
--     hóa đơn — luật mig 191).
--   · Có phiếu tự sinh đã nhập kho mà không gửi `tra_da_nhap` → REISSUE_RETURN_STOCKED
--     (màn hình phải hỏi trước, không đoán).
--   Tất cả trong MỘT giao dịch: bỏ ngang (lỗi, đóng màn) thì không có gì bị huỷ dở.
--
-- ⚠ VÁ CHUỖI thân `reissue_invoice` đang chạy (như 182/184): chèn một câu
--   PERFORM trước `_apply_return_edits` và một câu trước `RETURN QUERY` cuối.
-- ⚠ Hàm nội bộ SECURITY DEFINER — REVOKE (luật mig 166). Quyền duyệt trả hàng
--   (`returns.approve`) vẫn do `cancel_return` / `complete_return` tự kiểm.
-- ====================================================================

-- 1. Trước khi lập lại -------------------------------------------------
CREATE OR REPLACE FUNCTION public._tra_da_nhap_truoc_lap_lai(p_invoice_id uuid, p jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_mode text := NULLIF(btrim(COALESCE(p->>'tra_da_nhap', '')), '');
  v_st   jsonb := '[]'::jsonb;
  v_ma   text;
  r      record;
BEGIN
  PERFORM set_config('npp.tra_da_nhap_210', '', true);

  IF NOT EXISTS (SELECT 1 FROM returns rt WHERE rt.invoice_id = p_invoice_id AND rt.status = 'completed') THEN
    RETURN;
  END IF;

  IF v_mode IS NOT NULL AND v_mode NOT IN ('lam_lai', 'giu') THEN
    RAISE EXCEPTION 'BAD_TRA_DA_NHAP: % — chỉ nhận lam_lai hoặc giu', v_mode USING ERRCODE = 'P0001';
  END IF;

  IF v_mode IS NULL THEN
    SELECT string_agg(COALESCE(rt.return_code, rt.id::text), ', ' ORDER BY rt.created_at) INTO v_ma
    FROM returns rt
    WHERE rt.invoice_id = p_invoice_id AND rt.status = 'completed'
      AND COALESCE(rt.credit_with_invoice, false);
    IF v_ma IS NOT NULL THEN
      RAISE EXCEPTION 'REISSUE_RETURN_STOCKED: phiếu trả % đã nhập kho — chọn huỷ phiếu nhập hay giữ nguyên', v_ma
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  FOR r IN
    SELECT rt.id, COALESCE(rt.credit_with_invoice, false) AS tu_sinh, rt.destination_zone
    FROM returns rt
    WHERE rt.invoice_id = p_invoice_id AND rt.status = 'completed'
    ORDER BY rt.created_at
  LOOP
    IF v_mode = 'lam_lai' AND r.tu_sinh THEN
      -- Đảo kho, phiếu về Chờ xử lý, vẫn bám tờ này → đi theo tờ mới như phiếu chờ.
      PERFORM public.cancel_return(r.id, 'Sửa hóa đơn — nhập kho lại theo số mới');
      v_st := v_st || jsonb_build_array(jsonb_build_object(
        'id', r.id, 'lam', 'nhap_lai',
        'zone', CASE WHEN r.destination_zone IN ('sale', 'date') THEN r.destination_zone ELSE 'sale' END));
    ELSE
      -- Giữ phiếu nhập: gỡ khỏi tờ cũ để `cancel_invoice` không chặn, gắn lại sau.
      UPDATE returns SET invoice_id = NULL WHERE id = r.id;
      v_st := v_st || jsonb_build_array(jsonb_build_object('id', r.id, 'lam', 'gan_lai'));
    END IF;
  END LOOP;

  PERFORM set_config('npp.tra_da_nhap_210', v_st::text, true);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public._tra_da_nhap_truoc_lap_lai(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- 2. Sau khi có tờ mới --------------------------------------------------
CREATE OR REPLACE FUNCTION public._tra_da_nhap_sau_lap_lai(p_new_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_st  jsonb := NULLIF(current_setting('npp.tra_da_nhap_210', true), '')::jsonb;
  v_gan boolean := false;
  x     record;
BEGIN
  PERFORM set_config('npp.tra_da_nhap_210', '', true);
  IF v_st IS NULL OR jsonb_array_length(v_st) = 0 THEN
    RETURN;
  END IF;

  FOR x IN SELECT * FROM jsonb_to_recordset(v_st) AS t(id uuid, lam text, zone text)
  LOOP
    IF x.lam = 'gan_lai' THEN
      UPDATE returns SET invoice_id = p_new_invoice_id WHERE id = x.id;
      v_gan := true;
    ELSIF EXISTS (
      SELECT 1 FROM returns rt
      WHERE rt.id = x.id AND rt.status = 'submitted' AND rt.invoice_id = p_new_invoice_id
        AND EXISTS (SELECT 1 FROM return_lines rl WHERE rl.return_id = rt.id AND COALESCE(rl.quantity, 0) > 0)
    ) THEN
      -- Nhập lại đúng kho cũ theo số đã sửa. Phiếu bị bỏ hết dòng thì đã về Nháp — thôi.
      PERFORM public.complete_return(x.id, x.zone);
    END IF;
  END LOOP;

  IF v_gan THEN
    PERFORM public._wf2b_recompute_receivable(p_new_invoice_id);
  END IF;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public._tra_da_nhap_sau_lap_lai(uuid) FROM PUBLIC, anon, authenticated;

-- 3. Vá thân reissue_invoice -------------------------------------------
DO $p$
DECLARE
  v_src text;
  v_re1 text := '(v_edited\s*:=\s*public\._apply_return_edits\s*\()';
  v_re2 text := '(RETURN\s+QUERY\s+SELECT\s+v_new\.invoice_id)';
  v_n   int;
BEGIN
  v_src := pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure);
  IF position('(mig 210)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 210: reissue_invoice đã xử lý phiếu trả đã nhập kho, bỏ qua ---';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_re1, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '210: thấy % chỗ gọi _apply_return_edits trong reissue_invoice, cần đúng 1', v_n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_re2, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '210: thấy % câu RETURN QUERY cuối reissue_invoice, cần đúng 1', v_n USING ERRCODE = 'P0001';
  END IF;
  v_src := regexp_replace(v_src, v_re1,
    '-- (mig 210) Phiếu trả đã nhập kho: huỷ nhập để sửa lại, hoặc giữ nguyên gắn tờ mới.' || chr(10)
    || '  PERFORM public._tra_da_nhap_truoc_lap_lai(p_invoice_id, p);' || chr(10)
    || '  \1');
  v_src := regexp_replace(v_src, v_re2,
    '-- (mig 210) Nhập kho lại / gắn lại phiếu trả đã nhập vào tờ mới.' || chr(10)
    || '  PERFORM public._tra_da_nhap_sau_lap_lai(v_new.invoice_id);' || chr(10)
    || '  \1');
  EXECUTE v_src;
END;
$p$;

DO $chk$
DECLARE
  v_src text := pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure);
BEGIN
  IF position('_tra_da_nhap_truoc_lap_lai' IN v_src) = 0 OR position('_tra_da_nhap_sau_lap_lai' IN v_src) = 0 THEN
    RAISE EXCEPTION '210: reissue_invoice chưa có hai bước phiếu trả đã nhập kho' USING ERRCODE = 'P0001';
  END IF;
  -- Các miếng vá cũ còn nguyên.
  IF position('_apply_return_edits' IN v_src) = 0 OR position('(mig 182)' IN v_src) = 0
     OR position('(mig 184)' IN v_src) = 0 THEN
    RAISE EXCEPTION '210: reissue_invoice mất miếng vá cũ (149/182/184)' USING ERRCODE = 'P0001';
  END IF;
END;
$chk$;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 210: sửa hóa đơn có phiếu trả đã nhập kho' AS buoc,
       CASE WHEN position('(mig 210)' IN pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure)) > 0
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua;
