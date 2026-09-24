-- ====================================================================
-- SỬA HÓA ĐƠN ĐÃ CÓ TIỀN THU: HUỶ TỜ CŨ, LẬP TỜ MỚI, PHIẾU THU ĐI THEO
--
-- Chủ nhà chốt 24/09/2026: "Sửa hoá đơn: Khi thay đổi thông tin trên hóa đơn,
-- hệ thống sẽ: Hủy hóa đơn cũ và tạo hóa đơn mới · Tất cả các phiếu thanh
-- toán của hóa đơn cũ sẽ được gắn với hóa đơn mới".
--
-- Trước nay `reissue_invoice` gọi `cancel_invoice`, và hàm ấy TỪ CHỐI khi tờ
-- đã có tiền thu (LOCKED_HAS_PAYMENT) — người dùng phải huỷ phiếu thu, lập
-- lại, rồi thu lại từ đầu.
--
-- CÁCH LÀM, TRONG CÙNG MỘT GIAO DỊCH CỦA `reissue_invoice`:
--   1. TRƯỚC khi huỷ: ghi nhớ công nợ cũ (số đã thu), các dòng phiếu thu bám
--      tờ cũ (theo `receivable_id` hoặc `invoice_id`) và các dòng `payments`
--      của công nợ cũ. Gỡ `payments` (khoá ngoại NO ACTION tới công nợ — để lại
--      thì `cancel_invoice` không xoá được công nợ cũ và cả lệnh rollback).
--   2. `cancel_invoice` bỏ qua RIÊNG khoá tiền thu, chỉ trong lượt này — cờ
--      `npp.reissue_chuyen_thu` do chính `reissue_invoice` bật. Huỷ HĐ trực tiếp
--      vẫn bị khoá như cũ.
--   3. SAU khi lập tờ mới: dựng lại `payments` (cùng số tiền, người thu, ngày
--      thu, người xác nhận) trên công nợ MỚI, trỏ dòng phiếu thu sang tờ mới +
--      công nợ mới, cộng số đã thu vào công nợ mới rồi tính lại trạng thái.
--
-- ⚠ PHIẾU THU ĐÃ HUỶ: dòng của nó chỉ đổi `invoice_id` sang tờ mới (để lần ra
--   được), KHÔNG gắn công nợ mới — tiền của nó đã được trừ khi huỷ phiếu.
-- ⚠ HUỶ PHIẾU THU SAU NÀY vẫn đúng: `void_cash_receipt` trừ `paid` theo
--   `receivable_id` và xoá `payment_id` của dòng — cả hai đều đã trỏ sang mới.
-- ⚠ THU DƯ: tờ mới nhỏ hơn số đã thu thì công nợ mới `paid > amount` — đúng cơ
--   chế "dư có" sẵn có (`GREATEST(0, paid − amount)`), trừ vào lần thu sau.
-- ⚠ NHỚ GIỮA HAI BƯỚC QUA `set_config(..., true)` (hết giao dịch là mất) —
--   không phải khai báo thêm biến trong thân hàm đang chạy.
-- ⚠ VÁ CHUỖI BẢN ĐANG CHẠY, khớp dung sai (bài học mig 182). Bí danh bảng bắt
--   buộc trong `reissue_invoice` (RETURNS TABLE có cột `invoice_id`).
-- ====================================================================

-- 1. cancel_invoice: bỏ qua khoá tiền thu khi chính reissue_invoice gọi.
DO $p1$
DECLARE
  v_src text;
  v_n   int;
  v_mau text := 'IF[ \t\r\n]+EXISTS[ \t\r\n]*\([ \t\r\n]*SELECT[ \t]+1[ \t]+FROM[ \t]+receivables[ \t]+r[ \t\r\n]+WHERE[ \t]+r\.invoice_id[ \t]*=[ \t]*p_invoice_id[ \t]+AND[ \t]+COALESCE\(r\.paid,[ \t]*0\)[ \t]*>[ \t]*0';
BEGIN
  v_src := pg_get_functiondef('public.cancel_invoice(uuid, text)'::regprocedure);
  IF position('(mig 184)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 184: cancel_invoice đã nhận cờ chuyển phiếu thu, bỏ qua ---';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_mau, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '184: thấy % chỗ khoá tiền thu trong cancel_invoice, cần đúng 1', v_n USING ERRCODE = 'P0001';
  END IF;
  v_src := regexp_replace(v_src, v_mau,
    'IF COALESCE(current_setting(''npp.reissue_chuyen_thu'', true), '''') = ''on'' THEN
    -- (mig 184) Lập lại hóa đơn: tiền thu CHUYỂN sang tờ mới — không khoá.
    NULL;
  ELSIF EXISTS (
    SELECT 1 FROM receivables r
    WHERE r.invoice_id = p_invoice_id AND COALESCE(r.paid, 0) > 0');
  EXECUTE v_src;
END;
$p1$;

-- 2. reissue_invoice: ghi nhớ + gỡ trước khi huỷ, dựng lại sau khi lập.
DO $p2$
DECLARE
  v_src  text;
  v_n    int;
  v_huy  text := '(\r?\n[ \t]*)(PERFORM[ \t]+public\.cancel_invoice\()';
  v_cuoi text := '(\r?\n[ \t]*RETURN[ \t]+QUERY[ \t]+SELECT[ \t\r\n]+v_new\.invoice_id)';
BEGIN
  v_src := pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure);
  IF position('(mig 184)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 184: reissue_invoice đã chuyển phiếu thu, bỏ qua ---';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_huy, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '184: thấy % lời gọi cancel_invoice trong reissue_invoice, cần đúng 1', v_n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_cuoi, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '184: thấy % câu RETURN QUERY cuối reissue_invoice, cần đúng 1', v_n USING ERRCODE = 'P0001';
  END IF;

  v_src := regexp_replace(v_src, v_huy, '\1-- (mig 184) Ghi nhớ tiền thu của tờ cũ rồi gỡ `payments` — dựng lại trên tờ mới ở cuối hàm.
  DECLARE
    v184_rec  uuid;
    v184_paid numeric;
    v184_st   jsonb;
  BEGIN
    PERFORM set_config(''npp.via_rpc'', ''on'', true);
    SELECT rc184.id, COALESCE(rc184.paid, 0) INTO v184_rec, v184_paid
    FROM receivables rc184 WHERE rc184.invoice_id = p_invoice_id LIMIT 1;
    v184_st := jsonb_build_object(
      ''paid'', COALESCE(v184_paid, 0),
      ''payments'', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          ''id'', pm184.id, ''collected_by'', pm184.collected_by, ''amount'', pm184.amount,
          ''method'', pm184.method, ''collected_at'', pm184.collected_at,
          ''verified_by'', pm184.verified_by, ''verified_at'', pm184.verified_at))
        FROM payments pm184 WHERE v184_rec IS NOT NULL AND pm184.receivable_id = v184_rec), ''[]''::jsonb),
      ''lines'', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          ''id'', crl184.id, ''payment_id'', crl184.payment_id,
          ''voided'', cr184.status = ''voided''))
        FROM cash_receipt_lines crl184
        JOIN cash_receipts cr184 ON cr184.id = crl184.receipt_id
        WHERE crl184.invoice_id = p_invoice_id
           OR (v184_rec IS NOT NULL AND crl184.receivable_id = v184_rec)), ''[]''::jsonb));
    PERFORM set_config(''npp.reissue_stash'', v184_st::text, true);
    IF v184_rec IS NOT NULL THEN
      UPDATE cash_receipt_lines crl184 SET payment_id = NULL
       WHERE crl184.payment_id IN (SELECT pm184.id FROM payments pm184 WHERE pm184.receivable_id = v184_rec);
      DELETE FROM payments pm184 WHERE pm184.receivable_id = v184_rec;
    END IF;
    PERFORM set_config(''npp.reissue_chuyen_thu'', ''on'', true);
  END;
\1\2');

  v_src := regexp_replace(v_src, v_cuoi, '
  -- (mig 184) Tiền thu của tờ cũ gắn sang tờ mới: payments dựng lại trên công nợ
  --   mới, dòng phiếu thu trỏ sang, số đã thu cộng vào, tính lại trạng thái.
  DECLARE
    v184_st   jsonb := NULLIF(current_setting(''npp.reissue_stash'', true), '''')::jsonb;
    v184_rec  uuid;
    v184_map  jsonb := ''{}''::jsonb;
    v184_pm   record;
    v184_pid  uuid;
  BEGIN
    PERFORM set_config(''npp.reissue_chuyen_thu'', '''', true);
    PERFORM set_config(''npp.reissue_stash'', '''', true);
    IF v184_st IS NOT NULL THEN
      PERFORM set_config(''npp.via_rpc'', ''on'', true);
      SELECT rc184.id INTO v184_rec FROM receivables rc184 WHERE rc184.invoice_id = v_new.invoice_id LIMIT 1;
      IF v184_rec IS NULL AND (v184_st->>''paid'')::numeric > 0 THEN
        RAISE EXCEPTION ''REISSUE_NO_RECEIVABLE: tờ mới không có công nợ để gắn % đã thu'', v184_st->>''paid''
          USING ERRCODE = ''P0001'';
      END IF;
      FOR v184_pm IN
        SELECT * FROM jsonb_to_recordset(v184_st->''payments'') AS x(
          id uuid, collected_by uuid, amount numeric, method text,
          collected_at timestamptz, verified_by uuid, verified_at timestamptz)
      LOOP
        INSERT INTO payments (receivable_id, collected_by, amount, method, collected_at, verified_by, verified_at)
        VALUES (v184_rec, v184_pm.collected_by, v184_pm.amount, v184_pm.method,
                v184_pm.collected_at, v184_pm.verified_by, v184_pm.verified_at)
        RETURNING id INTO v184_pid;
        v184_map := v184_map || jsonb_build_object(v184_pm.id::text, v184_pid);
      END LOOP;
      UPDATE cash_receipt_lines crl184
         SET invoice_id    = v_new.invoice_id,
             receivable_id = CASE WHEN x.voided THEN crl184.receivable_id ELSE v184_rec END,
             payment_id    = CASE WHEN x.payment_id IS NULL THEN crl184.payment_id
                                  ELSE (v184_map->>x.payment_id::text)::uuid END
        FROM jsonb_to_recordset(v184_st->''lines'') AS x(id uuid, payment_id uuid, voided boolean)
       WHERE crl184.id = x.id;
      IF v184_rec IS NOT NULL THEN
        UPDATE receivables rc184 SET paid = COALESCE(rc184.paid, 0) + COALESCE((v184_st->>''paid'')::numeric, 0)
         WHERE rc184.id = v184_rec;
        PERFORM public._wf2b_recompute_receivable(v_new.invoice_id);
      END IF;
    END IF;
  END;
\1');
  EXECUTE v_src;
END;
$p2$;

DO $kiem$
BEGIN
  IF position('(mig 184)' IN pg_get_functiondef('public.cancel_invoice(uuid, text)'::regprocedure)) = 0
     OR position('(mig 184)' IN pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '184: chưa vá đủ hai hàm' USING ERRCODE = 'P0001';
  END IF;
  -- Khoá tiền thu của Huỷ HĐ trực tiếp phải còn.
  IF position('LOCKED_HAS_PAYMENT' IN pg_get_functiondef('public.cancel_invoice(uuid, text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '184: cancel_invoice mất khoá tiền thu' USING ERRCODE = 'P0001';
  END IF;
  -- Các miếng vá cũ của reissue_invoice còn nguyên (149 / 152 / 182).
  IF position('_apply_return_edits' IN pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure)) = 0
     OR position('(mig 182)' IN pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '184: reissue_invoice mất miếng vá cũ' USING ERRCODE = 'P0001';
  END IF;
END;
$kiem$;

NOTIFY pgrst, 'reload schema';

SELECT 'Sửa HĐ đã thu tiền: phiếu thu chuyển sang HĐ mới' AS hang_muc,
       CASE WHEN position('(mig 184)' IN pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure)) > 0
            THEN 'có' ELSE 'CHƯA' END AS trang_thai;
