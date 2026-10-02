-- ====================================================================
-- 223 — NHÂN VIÊN NGHỈ VIỆC: không xoá khi đã có chứng từ, bàn giao khách + công nợ về NPP
--
-- VÌ SAO — chủ nhà 02/10/2026: "Phần xóa nhân viên hiện tại đang lỗi, xóa nhân viên mà các chứng từ
--   liên quan nhân viên thì làm thế nào ?" — chốt đề xuất: (1) chưa có chứng từ thì xoá hẳn; (2) đã có
--   chứng từ thì "Cho nghỉ việc" (khoá đăng nhập, ẩn khỏi ô chọn, giữ tên trên chứng từ cũ); (3) "khi nghỉ
--   bàn giao khách hàng và công nợ về npp. Npp sẽ phân phối lại sau".
--   Lỗi cũ: xoá auth.users dội xuống public.users, ~51 khoá ngoại NO ACTION (đơn, HĐ, công nợ, phiếu thu…)
--   chặn lại → "Database error deleting user". Người chưa có chứng từ thì xoá được nhưng lặng lẽ mất cả
--   phân công khách / lịch tuyến (ON DELETE CASCADE).
--
-- CÁCH LÀM
--   1. `users.left_at / left_by` — đã nghỉ (khác "Tạm khoá": tạm khoá không bàn giao gì).
--   2. `receivables.ve_npp_luc` — khoản nợ đã bàn giao về NPP. Doanh số vẫn của người cũ (theo HĐ), chỉ
--      người ĐỨNG TÊN NỢ đổi. Trigger `_cong_no_giu_ve_npp` giữ cờ: tính lại công nợ (thu tiền, phiếu trả,
--      sửa HĐ — mig 194 cho nợ "đi theo HĐ") không kéo nợ về người đã nghỉ; nợ mới sinh theo HĐ của người
--      đã nghỉ cũng về NPP.
--   3. RPC `so_chung_tu_nhan_vien` (đếm chứng từ chặn xoá + khách / tuyến / nợ đang giữ),
--      `cho_nhan_vien_nghi` (khoá, gỡ phân công khách + lịch tuyến, nợ chưa thu về NPP, thu hồi mã QR),
--      `giao_cong_no_npp` (NPP phân phối lại nợ của một khách cho NV mới).
-- ====================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS left_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS left_by uuid;
ALTER TABLE receivables ADD COLUMN IF NOT EXISTS ve_npp_luc timestamptz;

-- ── Người đã nghỉ thì không đứng tên nợ; nợ đã về NPP thì chỉ RPC phân phối lại mới đổi người ─────
CREATE OR REPLACE FUNCTION public._cong_no_giu_ve_npp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF current_setting('npp.giao_cong_no', true) = 'on' THEN
    IF NEW.sales_user_id IS NOT NULL THEN NEW.ve_npp_luc := NULL; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.ve_npp_luc IS NOT NULL THEN
    NEW.sales_user_id := OLD.sales_user_id;
    NEW.ve_npp_luc := OLD.ve_npp_luc;
    RETURN NEW;
  END IF;
  -- Tính lại nợ theo HĐ của người đã nghỉ: giữ người đang đứng tên (NV được NPP phân lại); chưa ai → NPP.
  IF NEW.sales_user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.sales_user_id AND u.left_at IS NOT NULL) THEN
    NEW.sales_user_id := CASE WHEN TG_OP = 'UPDATE' THEN OLD.sales_user_id END;
    IF NEW.sales_user_id IS NULL THEN NEW.ve_npp_luc := now(); END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._cong_no_giu_ve_npp() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cong_no_giu_ve_npp ON receivables;
CREATE TRIGGER trg_cong_no_giu_ve_npp
  BEFORE INSERT OR UPDATE OF sales_user_id, ve_npp_luc ON receivables
  FOR EACH ROW EXECUTE FUNCTION public._cong_no_giu_ve_npp();

-- ── Đếm chứng từ gắn với một nhân viên ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.so_chung_tu_nhan_vien(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid := public.user_org_id();
  c record;
  v_n bigint;
  v_tong bigint := 0;
  v_ct jsonb := '[]'::jsonb;
BEGIN
  IF v_org IS NULL OR public.user_role() <> 'owner' THEN
    RAISE EXCEPTION 'KHONG_DU_QUYEN: chỉ Chủ NPP' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND org_id = v_org) THEN
    RAISE EXCEPTION 'KHONG_TIM_THAY_NV' USING ERRCODE = 'P0001';
  END IF;
  -- Mọi khoá ngoại CHẶN XOÁ (NO ACTION / RESTRICT) trỏ vào người dùng — tự theo bảng mới thêm sau này.
  FOR c IN
    SELECT k.conrelid::regclass::text AS bang, a.attname::text AS cot
    FROM pg_constraint k
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
    JOIN pg_class t ON t.oid = k.conrelid
    WHERE k.contype = 'f' AND k.confdeltype IN ('a', 'r')
      AND k.confrelid IN ('public.users'::regclass, 'auth.users'::regclass)
      AND t.relnamespace = 'public'::regnamespace
    ORDER BY 1, 2
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', c.bang, c.cot) INTO v_n USING p_user_id;
    IF v_n > 0 THEN
      v_tong := v_tong + v_n;
      v_ct := v_ct || jsonb_build_object('bang', c.bang, 'cot', c.cot, 'so', v_n);
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'tong', v_tong,
    'chi_tiet', v_ct,
    'khach', (SELECT count(DISTINCT customer_id) FROM customer_assignments WHERE user_id = p_user_id),
    'lich_tuyen', (SELECT count(*) FROM pjp_routes WHERE sales_user_id = p_user_id),
    'so_khoan_no', (SELECT count(*) FROM receivables WHERE sales_user_id = p_user_id AND status <> 'paid'),
    'tien_no', (SELECT COALESCE(sum(COALESCE(amount, 0) - COALESCE(paid, 0)), 0)
                FROM receivables WHERE sales_user_id = p_user_id AND status <> 'paid')
  );
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.so_chung_tu_nhan_vien(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.so_chung_tu_nhan_vien(uuid) TO authenticated;

-- ── Cho nghỉ việc ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cho_nhan_vien_nghi(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid := public.user_org_id();
  v_role text;
  v_khach bigint;
  v_tuyen bigint;
  v_no bigint;
  v_tien numeric;
BEGIN
  IF v_org IS NULL OR public.user_role() <> 'owner' THEN
    RAISE EXCEPTION 'KHONG_DU_QUYEN: chỉ Chủ NPP' USING ERRCODE = 'P0001';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'TU_NGHI: không tự cho mình nghỉ việc' USING ERRCODE = 'P0001';
  END IF;
  SELECT role INTO v_role FROM users WHERE id = p_user_id AND org_id = v_org FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'KHONG_TIM_THAY_NV' USING ERRCODE = 'P0001';
  END IF;
  IF v_role = 'owner' THEN
    RAISE EXCEPTION 'NGHI_CHU_NPP: không cho Chủ NPP nghỉ việc' USING ERRCODE = 'P0001';
  END IF;

  UPDATE users SET is_active = false, left_at = COALESCE(left_at, now()), left_by = auth.uid()
  WHERE id = p_user_id;

  -- Khách + lịch tuyến về NPP (không ai phụ trách) — NPP phân lại sau.
  WITH x AS (DELETE FROM customer_assignments WHERE user_id = p_user_id RETURNING customer_id)
  SELECT count(DISTINCT customer_id) INTO v_khach FROM x;
  WITH x AS (DELETE FROM pjp_routes WHERE sales_user_id = p_user_id RETURNING 1)
  SELECT count(*) INTO v_tuyen FROM x;

  -- Nợ chưa thu về NPP. Nợ đã thu xong giữ tên người cũ (lịch sử).
  PERFORM set_config('npp.giao_cong_no', 'on', true);
  WITH x AS (
    UPDATE receivables SET sales_user_id = NULL, ve_npp_luc = now()
    WHERE org_id = v_org AND sales_user_id = p_user_id AND status <> 'paid'
    RETURNING COALESCE(amount, 0) - COALESCE(paid, 0) AS con
  )
  SELECT count(*), COALESCE(sum(con), 0) INTO v_no, v_tien FROM x;
  PERFORM set_config('npp.giao_cong_no', 'off', true);

  DELETE FROM qr_login_tokens WHERE user_id = p_user_id;
  DELETE FROM entity_locks WHERE locked_by = p_user_id;

  RETURN jsonb_build_object('khach', v_khach, 'lich_tuyen', v_tuyen, 'so_khoan_no', v_no, 'tien_no', v_tien);
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.cho_nhan_vien_nghi(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cho_nhan_vien_nghi(uuid) TO authenticated;

-- ── NPP phân phối lại nợ của một khách ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.giao_cong_no_npp(p_customer_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid := public.user_org_id();
  v_no bigint;
  v_tien numeric;
BEGIN
  IF v_org IS NULL OR public.user_role() NOT IN ('owner', 'manager', 'accountant') THEN
    RAISE EXCEPTION 'KHONG_DU_QUYEN' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND org_id = v_org
                   AND COALESCE(is_active, true) AND left_at IS NULL) THEN
    RAISE EXCEPTION 'NV_KHONG_HOP_LE: nhân viên đã nghỉ / bị khoá' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('npp.giao_cong_no', 'on', true);
  WITH x AS (
    UPDATE receivables SET sales_user_id = p_user_id
    WHERE org_id = v_org AND customer_id = p_customer_id AND ve_npp_luc IS NOT NULL AND status <> 'paid'
    RETURNING COALESCE(amount, 0) - COALESCE(paid, 0) AS con
  )
  SELECT count(*), COALESCE(sum(con), 0) INTO v_no, v_tien FROM x;
  PERFORM set_config('npp.giao_cong_no', 'off', true);
  RETURN jsonb_build_object('so_khoan_no', v_no, 'tien_no', v_tien);
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.giao_cong_no_npp(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.giao_cong_no_npp(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 223: nhân viên nghỉ việc' AS buoc,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'left_at')
             AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'receivables' AND column_name = 've_npp_luc')
             AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cong_no_giu_ve_npp')
             AND to_regprocedure('public.cho_nhan_vien_nghi(uuid)') IS NOT NULL
             AND to_regprocedure('public.giao_cong_no_npp(uuid,uuid)') IS NOT NULL
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua,
       (SELECT count(*) FROM users WHERE left_at IS NOT NULL) AS da_nghi;
