-- ====================================================================
-- 215 — CÁC ĐIỂM CHỦ NHÀ CHỐT SAU QUÉT LUỒNG (docs/quet-luong-2026-09-28.md)
--
-- VÌ SAO — chủ nhà 28/09/2026 trả lời năm điểm cần chốt:
--   · "ok" — Sửa hóa đơn của ĐƠN ĐÃ ĐÓNG: đơn 2 HĐ sửa không được
--     (ORDER_NOT_INVOICEABLE); đơn 1 HĐ sửa xong mất trạng thái đóng.
--     → post_invoice nhận đơn 'closed' khi đang LẬP LẠI; reissue_invoice ghi nhớ dấu
--       đóng và trả lại sau khi lập (đơn chưa xuất đủ thì vẫn 'closed').
--   · "ok cho" — Huỷ phiếu trả khi hàng đã bán hết (tồn âm): GIỮ NHƯ CŨ, không đổi.
--   · "ok" — Chống bấm Lưu phiếu thu hai lần → `cash_receipts.client_key` duy nhất theo
--     NPP; `create_cash_receipt` gặp lại khoá cũ thì trả lại phiếu đã lập.
--   · "có cấm" — Màn quyết toán chuyến giao: chặn ở giao diện (cửa vào) — mig 214 đã
--     khoá ghi thẳng công nợ / phiếu thu nên màn ấy cũng không ghi được nữa.
--   · "ko, sửa lại" — Quản lý không lập được phiếu thu, thủ kho không nhập kho phiếu
--     trả là KHÔNG cố ý → mở `receivables.create/update` cho quản lý, `returns.approve`
--     cho thủ kho (mọi NPP; quyền riêng từng người giữ nguyên).
-- ⚠ Hàm nội bộ SECURITY DEFINER — REVOKE (luật mig 166).
-- ====================================================================

-- 1. Đơn đã đóng: ghi nhớ trước khi lập lại, trả lại sau --------------------
CREATE OR REPLACE FUNCTION public._nho_don_dong_lap_lai(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  o record;
BEGIN
  SELECT so.id, so.closed_at, so.closed_by INTO o
  FROM sales_invoices si JOIN sales_orders so ON so.id = si.order_id
  WHERE si.id = p_invoice_id AND so.status = 'closed';
  PERFORM set_config('npp.don_dong_215',
    CASE WHEN o.id IS NULL THEN ''
         ELSE jsonb_build_object('id', o.id, 'closed_at', o.closed_at, 'closed_by', o.closed_by)::text END,
    true);
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._nho_don_dong_lap_lai(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._tra_don_dong_lap_lai()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v jsonb := NULLIF(current_setting('npp.don_dong_215', true), '')::jsonb;
BEGIN
  PERFORM set_config('npp.don_dong_215', '', true);
  IF v IS NULL THEN RETURN; END IF;
  PERFORM set_config('npp.via_rpc', 'on', true);
  -- Đã xuất đủ sau khi sửa thì 'completed' là đúng; còn thiếu thì vẫn là đơn ĐÃ ĐÓNG.
  UPDATE sales_orders
  SET status = 'closed',
      closed_at = COALESCE(closed_at, (v->>'closed_at')::timestamptz),
      closed_by = COALESCE(closed_by, NULLIF(v->>'closed_by', '')::uuid)
  WHERE id = (v->>'id')::uuid AND status IN ('partially_invoiced', 'submitted', 'closed');
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._tra_don_dong_lap_lai() FROM PUBLIC, anon, authenticated;

DO $p$
DECLARE
  v_src text := pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure);
  v_re1 text := '(p\s*:=\s*public\._mac_dinh_lap_lai\(p_invoice_id,\s*p\);)';
  v_re2 text := '(PERFORM\s+public\._tra_da_nhap_sau_lap_lai\(v_new\.invoice_id\);)';
BEGIN
  IF position('(mig 215)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 215: reissue_invoice đã giữ đơn đã đóng, bỏ qua ---';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_src, v_re1, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_src, v_re2, 'g')) <> 1 THEN
    RAISE EXCEPTION '215: reissue_invoice chưa có bước mig 210 / 213 — chạy hai bản ấy trước' USING ERRCODE = 'P0001';
  END IF;
  v_src := regexp_replace(v_src, v_re1,
    '\1' || chr(10) || '  PERFORM public._nho_don_dong_lap_lai(p_invoice_id); -- (mig 215) đơn đã đóng');
  v_src := regexp_replace(v_src, v_re2,
    '\1' || chr(10) || '  PERFORM public._tra_don_dong_lap_lai(); -- (mig 215) trả lại dấu đóng đơn');
  EXECUTE v_src;
END;
$p$;

DO $p$
DECLARE
  v_src text := pg_get_functiondef('public.post_invoice(jsonb)'::regprocedure);
  v_re  text := '(IF\s+o\.status\s+NOT\s+IN\s+\(''submitted'',\s*''partially_invoiced''\))(\s+THEN)';
BEGIN
  IF position('(mig 215)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 215: post_invoice đã nhận đơn đóng khi lập lại, bỏ qua ---';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_src, v_re, 'g')) <> 1 THEN
    RAISE EXCEPTION '215: không thấy đúng một chỗ kiểm trạng thái đơn trong post_invoice' USING ERRCODE = 'P0001';
  END IF;
  EXECUTE regexp_replace(v_src, v_re,
    '\1' || chr(10)
    || '     AND NOT (o.status = ''closed'' AND p->>''reissue_of'' IS NOT NULL) /* (mig 215) sửa HĐ của đơn đã đóng */\2');
END;
$p$;

-- 2. Phiếu thu chống gửi trùng ---------------------------------------------
ALTER TABLE public.cash_receipts ADD COLUMN IF NOT EXISTS client_key text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_receipts_client_key
  ON public.cash_receipts(org_id, client_key) WHERE client_key IS NOT NULL;
COMMENT ON COLUMN public.cash_receipts.client_key IS
  'Khoá màn hình gửi kèm khi lập phiếu thu — bấm Lưu hai lần ra một phiếu (mig 215).';

DO $p$
DECLARE
  v_src text := pg_get_functiondef('public.create_cash_receipt(jsonb)'::regprocedure);
  v_re1 text := '(IF\s+NOT\s+public\.user_has_permission\(auth\.uid\(\),\s*''receivables\.create''\)\s+THEN\s+RAISE\s+EXCEPTION\s+''FORBIDDEN:[^'']*''\s+USING\s+ERRCODE\s*=\s*''P0001'';\s+END\s+IF;)';
  v_re2 text := '(received_by,\s*received_at,\s*collected_by,\s*created_by,\s*notes)(\s*\))';
  v_re3 text := '(auth\.uid\(\),\s*now\(\),\s*auth\.uid\(\),\s*auth\.uid\(\),\s*p->>''notes'')(\s*\))';
BEGIN
  IF position('(mig 215)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 215: create_cash_receipt đã chống gửi trùng, bỏ qua ---';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_src, v_re1, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_src, v_re2, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_src, v_re3, 'g')) <> 1 THEN
    RAISE EXCEPTION '215: không khớp chỗ vá trong create_cash_receipt' USING ERRCODE = 'P0001';
  END IF;
  v_src := regexp_replace(v_src, v_re1,
    '\1' || chr(10)
    || '  -- (mig 215) Gửi trùng (bấm Lưu hai lần, mạng chập chờn) → trả lại phiếu đã lập.' || chr(10)
    || '  IF NULLIF(p->>''client_key'', '''') IS NOT NULL THEN' || chr(10)
    || '    PERFORM pg_advisory_xact_lock(hashtext(''cash_receipt:'' || (p->>''client_key'')));' || chr(10)
    || '    SELECT cr.id INTO v_receipt FROM cash_receipts cr' || chr(10)
    || '    WHERE cr.org_id = v_org AND cr.client_key = p->>''client_key'';' || chr(10)
    || '    IF v_receipt IS NOT NULL THEN RETURN v_receipt; END IF;' || chr(10)
    || '  END IF;');
  v_src := regexp_replace(v_src, v_re2, '\1, client_key\2');
  v_src := regexp_replace(v_src, v_re3, '\1, NULLIF(p->>''client_key'', '''')\2');
  EXECUTE v_src;
END;
$p$;

-- 3. Quyền: quản lý lập / huỷ phiếu thu; thủ kho nhập kho phiếu trả -----------
INSERT INTO role_permissions (org_id, role, module, action, allowed)
SELECT o.id, x.role, x.module, x.action, true
FROM organizations o
CROSS JOIN (VALUES ('manager', 'receivables', 'create'),
                   ('manager', 'receivables', 'update'),
                   ('warehouse', 'returns', 'approve')) AS x(role, module, action)
ON CONFLICT (org_id, role, module, action) DO UPDATE SET allowed = true;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 215: đơn đã đóng, phiếu thu trùng, quyền' AS buoc,
       CASE WHEN position('(mig 215)' IN pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure)) > 0
             AND position('(mig 215)' IN pg_get_functiondef('public.post_invoice(jsonb)'::regprocedure)) > 0
             AND position('(mig 215)' IN pg_get_functiondef('public.create_cash_receipt(jsonb)'::regprocedure)) > 0
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua,
       (SELECT count(*) FROM role_permissions
         WHERE allowed AND ((role = 'manager' AND module = 'receivables' AND action IN ('create', 'update'))
                         OR (role = 'warehouse' AND module = 'returns' AND action = 'approve'))) AS o_quyen_da_mo;
