-- ====================================================================
-- 225 — LƯỢT SOẠN HÀNG (nhặt tổng → chia rổ theo đơn → hoàn tất), dùng chung máy tính + điện thoại
--
-- VÌ SAO — chủ nhà 02/10/2026: "thiết kế màn soạn hàng các tính năng kiểu như giao diện mẫu này" (mẫu máy tính
--   + di động: chọn hoá đơn → nhặt tổng theo kệ → chia vào rổ A–D theo từng đơn). Chủ nhà chốt:
--   · tiến độ "Lưu trên máy chủ" — mở máy tính hay điện thoại đều thấy cùng một lượt;
--   · bước cuối "Hoàn tất soạn" — đánh dấu các hoá đơn ĐÃ SOẠN (mig 224), KHÔNG trừ kho lần nữa (kho đã trừ
--     lúc ghi sổ hoá đơn);
--   · thiếu hàng: "Ghi thiếu, báo để sửa HĐ" — lượt ghi số thiếu, không tự đổi tiền / công nợ / kho.
--
-- CÁCH LÀM
--   1. `luot_soan`: mã SH-dd/mm-NN, danh sách hoá đơn (thứ tự = rổ A, B, C…), tiến độ jsonb
--      `{ "nhat": { "<product_id>": SL cơ sở đã nhặt }, "chia": { "<product_id>|<invoice_id>": true } }`.
--      Trình duyệt chỉ ĐỌC (RLS); mọi ghi qua RPC.
--   2. `cap_nhat_luot_soan` GỘP từng khoá (`||`, giá trị null = xoá khoá) — hai máy bấm hai mặt hàng khác nhau
--      không đè nhau.
--   3. `hoan_tat_luot_soan` → lượt 'xong' + đánh dấu soạn hoá đơn. `huy_luot_soan` → lượt 'huy'.
-- ====================================================================

CREATE TABLE IF NOT EXISTS luot_soan (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ma          text NOT NULL,
  invoice_ids uuid[] NOT NULL DEFAULT '{}',
  trang_thai  text NOT NULL DEFAULT 'dang_soan' CHECK (trang_thai IN ('dang_soan', 'xong', 'huy')),
  tien_do     jsonb NOT NULL DEFAULT '{"nhat": {}, "chia": {}}'::jsonb,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  xong_luc    timestamptz,
  xong_boi    uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_luot_soan_org_trang_thai ON luot_soan (org_id, trang_thai, created_at DESC);

ALTER TABLE luot_soan ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS luot_soan_doc ON luot_soan;
CREATE POLICY luot_soan_doc ON luot_soan FOR SELECT
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'manager', 'warehouse', 'accountant'));
REVOKE INSERT, UPDATE, DELETE ON luot_soan FROM anon, authenticated;
GRANT SELECT ON luot_soan TO authenticated;

-- ── Kiểm quyền + hoá đơn hợp lệ (nội bộ) ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._luot_soan_quyen()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_org uuid := public.user_org_id();
BEGIN
  IF v_org IS NULL OR public.user_role() NOT IN ('owner', 'manager', 'warehouse', 'accountant') THEN
    RAISE EXCEPTION 'KHONG_DU_QUYEN: chỉ chủ NPP, quản lý, thủ kho, kế toán soạn hàng' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_org;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._luot_soan_quyen() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._luot_soan_hoa_don(p_org uuid, p_ids uuid[])
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_ids uuid[];
BEGIN
  -- Giữ đúng thứ tự (= thứ tự rổ), bỏ trùng.
  SELECT COALESCE(array_agg(x ORDER BY o), '{}') INTO v_ids
  FROM (SELECT DISTINCT ON (x) x, o FROM unnest(COALESCE(p_ids, '{}')) WITH ORDINALITY AS t(x, o) ORDER BY x, o) d;
  IF array_length(v_ids, 1) > 26 THEN
    RAISE EXCEPTION 'QUA_NHIEU_RO: một lượt soạn tối đa 26 hoá đơn (rổ A–Z)' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_ids) x
             WHERE NOT EXISTS (SELECT 1 FROM sales_invoices s WHERE s.id = x AND s.org_id = p_org AND s.status = 'posted')) THEN
    RAISE EXCEPTION 'HOA_DON_KHONG_HOP_LE: chỉ soạn hoá đơn đã ghi sổ của NPP' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_ids;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._luot_soan_hoa_don(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

-- ── Tạo lượt ──────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tao_luot_soan(p_invoice_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid := public._luot_soan_quyen();
  v_ids uuid[] := public._luot_soan_hoa_don(v_org, p_invoice_ids);
  v_ngay text := to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM');
  v_n int;
  v_id uuid;
BEGIN
  IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'CHUA_CHON_HOA_DON' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('luot_soan:' || v_org::text));
  SELECT count(*) + 1 INTO v_n FROM luot_soan
   WHERE org_id = v_org AND (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  INSERT INTO luot_soan (org_id, ma, invoice_ids, created_by)
  VALUES (v_org, 'SH-' || v_ngay || '-' || lpad(v_n::text, 2, '0'), v_ids, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.tao_luot_soan(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tao_luot_soan(uuid[]) TO authenticated;

-- ── Cập nhật: đổi danh sách hoá đơn và / hoặc gộp tiến độ ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cap_nhat_luot_soan(
  p_id uuid,
  p_invoice_ids uuid[] DEFAULT NULL,
  p_nhat jsonb DEFAULT NULL,
  p_chia jsonb DEFAULT NULL
)
RETURNS luot_soan
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid := public._luot_soan_quyen();
  v luot_soan;
BEGIN
  SELECT * INTO v FROM luot_soan WHERE id = p_id AND org_id = v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KHONG_TIM_THAY_LUOT' USING ERRCODE = 'P0001'; END IF;
  IF v.trang_thai <> 'dang_soan' THEN
    RAISE EXCEPTION 'LUOT_DA_DONG: lượt soạn đã hoàn tất / huỷ' USING ERRCODE = 'P0001';
  END IF;
  IF p_invoice_ids IS NOT NULL THEN
    v.invoice_ids := public._luot_soan_hoa_don(v_org, p_invoice_ids);
  END IF;
  IF p_nhat IS NOT NULL AND jsonb_typeof(p_nhat) = 'object' THEN
    v.tien_do := jsonb_set(v.tien_do, '{nhat}', jsonb_strip_nulls(COALESCE(v.tien_do -> 'nhat', '{}') || p_nhat));
  END IF;
  IF p_chia IS NOT NULL AND jsonb_typeof(p_chia) = 'object' THEN
    v.tien_do := jsonb_set(v.tien_do, '{chia}', jsonb_strip_nulls(COALESCE(v.tien_do -> 'chia', '{}') || p_chia));
  END IF;
  UPDATE luot_soan SET invoice_ids = v.invoice_ids, tien_do = v.tien_do, updated_at = now()
   WHERE id = p_id RETURNING * INTO v;
  RETURN v;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.cap_nhat_luot_soan(uuid, uuid[], jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cap_nhat_luot_soan(uuid, uuid[], jsonb, jsonb) TO authenticated;

-- ── Hoàn tất: đóng lượt + đánh dấu hoá đơn đã soạn (KHÔNG trừ kho) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.hoan_tat_luot_soan(p_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid := public._luot_soan_quyen();
  v luot_soan;
  v_n integer;
BEGIN
  SELECT * INTO v FROM luot_soan WHERE id = p_id AND org_id = v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KHONG_TIM_THAY_LUOT' USING ERRCODE = 'P0001'; END IF;
  IF v.trang_thai <> 'dang_soan' THEN
    RAISE EXCEPTION 'LUOT_DA_DONG: lượt soạn đã hoàn tất / huỷ' USING ERRCODE = 'P0001';
  END IF;
  UPDATE luot_soan SET trang_thai = 'xong', xong_luc = now(), xong_boi = auth.uid(), updated_at = now() WHERE id = p_id;
  UPDATE sales_invoices
     SET soan_luc = COALESCE(soan_luc, now()), soan_boi = COALESCE(soan_boi, auth.uid())
   WHERE org_id = v_org AND id = ANY (v.invoice_ids) AND status = 'posted' AND soan_luc IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.hoan_tat_luot_soan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hoan_tat_luot_soan(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.huy_luot_soan(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_org uuid := public._luot_soan_quyen();
BEGIN
  UPDATE luot_soan SET trang_thai = 'huy', updated_at = now()
   WHERE id = p_id AND org_id = v_org AND trang_thai = 'dang_soan';
  IF NOT FOUND THEN RAISE EXCEPTION 'KHONG_TIM_THAY_LUOT: không có lượt đang soạn này' USING ERRCODE = 'P0001'; END IF;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.huy_luot_soan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.huy_luot_soan(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 225: lượt soạn hàng' AS buoc,
       CASE WHEN to_regclass('public.luot_soan') IS NOT NULL
             AND to_regprocedure('public.cap_nhat_luot_soan(uuid,uuid[],jsonb,jsonb)') IS NOT NULL
             AND to_regprocedure('public.hoan_tat_luot_soan(uuid)') IS NOT NULL
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua,
       (SELECT count(*) FROM luot_soan WHERE trang_thai = 'dang_soan') AS luot_dang_soan;
