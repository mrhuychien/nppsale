-- ====================================================================
-- 232 — NHÀ CUNG CẤP: hồ sơ pháp lý, CHẶN XOÁ khi đã có chứng từ, GỘP hai NCC
--
-- VÌ SAO — chủ nhà 05/10/2026:
--   · "Viết lại giao diện nhà cung cấp chi tiết" — thiết kế mới có tab Tổng quan (Hạn mức công nợ, Người tạo)
--     và Thông tin pháp lý (Tên pháp nhân, Loại hình, Người đại diện, Số giấy phép ĐKKD, Ngày cấp, Địa chỉ đăng
--     ký) mà bảng `suppliers` chưa có cột.
--   · "Xem lại phần xóa NCC?" — màn chi tiết xoá thẳng dòng `suppliers` từ trình duyệt: NCC đã có phiếu nhập /
--     phiếu trả / công nợ / đơn đặt thì vấp khoá ngoại NO ACTION (lỗi thô tiếng Anh); còn `stock_entries` và
--     `products.primary_supplier_id` là ON DELETE SET NULL → xoá được nhưng LẶNG LẼ gỡ NCC khỏi phiếu kho cũ và
--     mặt hàng. Thiết kế chốt: "Không thể xóa nếu nhà cung cấp đã có phiếu nhập hoặc còn công nợ."
--   · "Thêm chức năng gộp NCC" — hai NCC trùng tên (băng "N nhà cung cấp bị trùng tên · Gộp" ở danh sách điện
--     thoại) trước nay chỉ lọc được, không gộp được.
--
-- CÁCH LÀM (cùng khuôn nhân viên nghỉ việc, mig 223)
--   1. Cột mới trên `suppliers` (đều cho NULL, không cần điền lại dữ liệu cũ): legal_name, business_type,
--      representative, business_license_no, business_license_date, registered_address, credit_limit, created_by.
--      `created_by` do trigger `_ncc_nguoi_tao` ghi (trình duyệt không tự khai người khác), sửa không đổi được.
--   2. `_ncc_dem_chung_tu(id)` — đếm theo MỌI khoá ngoại trỏ vào `suppliers` trừ loại CASCADE (tự theo bảng mới
--      thêm sau này): phiếu nhập, phiếu trả NCC, dòng công nợ NCC, đơn đặt NCC, phiếu kho, mặt hàng.
--   3. Trigger `trg_ncc_chan_xoa` (BEFORE DELETE): còn chứng từ / mặt hàng → `NCC_CO_CHUNG_TU`. Xoá cả NPP
--      (organizations ON DELETE CASCADE) thì cho qua.
--   4. RPC `so_chung_tu_ncc(id)` cho màn hình hỏi trước khi xoá; RPC `gop_nha_cung_cap(p_tu, p_vao)` (Chủ NPP /
--      Quản lý / Kế toán): chuyển mọi chứng từ + mặt hàng + phân công nhân viên sang NCC giữ lại trong MỘT giao
--      dịch, chép các ô hồ sơ còn trống, ghi chú lại, rồi xoá NCC bị gộp (xoá không được thì ngừng hợp tác).
--      Công nợ chỉ đổi NCC đứng tên — số tiền, số đã trả giữ nguyên, nên nợ NCC giữ lại = tổng hai bên.
-- ====================================================================

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS legal_name text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS business_type text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS representative text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS business_license_no text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS business_license_date date;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS registered_address text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS credit_limit numeric;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS created_by uuid;

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_created_by_fkey') THEN
    ALTER TABLE suppliers ADD CONSTRAINT suppliers_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_credit_limit_chk') THEN
    ALTER TABLE suppliers ADD CONSTRAINT suppliers_credit_limit_chk
      CHECK (credit_limit IS NULL OR credit_limit >= 0);
  END IF;
END;
$chk$;

-- ── Người tạo: ghi lúc tạo, không sửa được ────────────────────────────────────────────────────────
-- ⚠ KHÔNG SECURITY DEFINER: `_la_trinh_duyet()` đọc `current_user` — hàm definer thì luôn ra chủ hàm.
CREATE OR REPLACE FUNCTION public._ncc_nguoi_tao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF public._la_trinh_duyet() OR NEW.created_by IS NULL THEN
      NEW.created_by := (SELECT u.id FROM users u WHERE u.id = auth.uid());
    END IF;
  ELSE
    NEW.created_by := OLD.created_by;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._ncc_nguoi_tao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ncc_nguoi_tao ON suppliers;
CREATE TRIGGER trg_ncc_nguoi_tao
  BEFORE INSERT OR UPDATE OF created_by ON suppliers
  FOR EACH ROW EXECUTE FUNCTION public._ncc_nguoi_tao();

-- ── Đếm chứng từ / mặt hàng gắn với một NCC ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._ncc_dem_chung_tu(p_supplier_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  c record;
  v_n bigint;
  v_tong bigint := 0;
  v_ct jsonb := '[]'::jsonb;
BEGIN
  -- Mọi khoá ngoại trỏ vào NCC trừ CASCADE (phân công NV `user_suppliers` không phải chứng từ).
  FOR c IN
    SELECT k.conrelid::regclass::text AS bang, a.attname::text AS cot
    FROM pg_constraint k
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
    JOIN pg_class t ON t.oid = k.conrelid
    WHERE k.contype = 'f' AND k.confdeltype <> 'c'
      AND k.confrelid = 'public.suppliers'::regclass
      AND t.relnamespace = 'public'::regnamespace
    ORDER BY 1, 2
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', c.bang, c.cot) INTO v_n USING p_supplier_id;
    IF v_n > 0 THEN
      v_tong := v_tong + v_n;
      v_ct := v_ct || jsonb_build_object(
        'bang', c.bang, 'cot', c.cot, 'so', v_n,
        'nhan', CASE c.bang
                  WHEN 'purchase_invoices' THEN 'phiếu nhập'
                  WHEN 'supplier_returns' THEN 'phiếu trả NCC'
                  WHEN 'payables' THEN 'dòng công nợ NCC'
                  WHEN 'purchase_orders' THEN 'đơn đặt hàng NCC'
                  WHEN 'stock_entries' THEN 'phiếu kho'
                  WHEN 'products' THEN 'mặt hàng'
                  ELSE c.bang END);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('tong', v_tong, 'chi_tiet', v_ct);
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._ncc_dem_chung_tu(uuid) FROM PUBLIC, anon, authenticated;

-- ── Chặn xoá NCC đã có chứng từ ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._ncc_chan_xoa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v jsonb;
  v_mo_ta text;
BEGIN
  -- Xoá cả NPP (organizations → suppliers CASCADE): chứng từ cũng đi theo, không chặn.
  IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = OLD.org_id) THEN
    RETURN OLD;
  END IF;
  v := public._ncc_dem_chung_tu(OLD.id);
  IF (v->>'tong')::bigint > 0 THEN
    SELECT string_agg((e->>'so') || ' ' || (e->>'nhan'), ', ') INTO v_mo_ta
    FROM jsonb_array_elements(v->'chi_tiet') e;
    RAISE EXCEPTION 'NCC_CO_CHUNG_TU: không xoá được nhà cung cấp "%" — đã có %. Dùng "Ngừng hợp tác" hoặc "Gộp vào NCC khác".',
      OLD.name, v_mo_ta USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._ncc_chan_xoa() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ncc_chan_xoa ON suppliers;
CREATE TRIGGER trg_ncc_chan_xoa
  BEFORE DELETE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION public._ncc_chan_xoa();

-- ── RPC: số chứng từ của NCC (màn hình hỏi trước khi xoá) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.so_chung_tu_ncc(p_supplier_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid := public.user_org_id();
  v jsonb;
BEGIN
  IF v_org IS NULL OR public.user_role() NOT IN ('owner', 'manager', 'accountant', 'warehouse') THEN
    RAISE EXCEPTION 'KHONG_DU_QUYEN' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM suppliers WHERE id = p_supplier_id AND org_id = v_org) THEN
    RAISE EXCEPTION 'KHONG_TIM_THAY_NCC' USING ERRCODE = 'P0001';
  END IF;
  v := public._ncc_dem_chung_tu(p_supplier_id);
  RETURN v || jsonb_build_object(
    'nhan_vien', (SELECT count(*) FROM user_suppliers WHERE supplier_id = p_supplier_id),
    'so_khoan_no', (SELECT count(*) FROM payables WHERE supplier_id = p_supplier_id AND status <> 'paid'),
    -- Không kẹp dòng âm (mig 231).
    'con_no', (SELECT COALESCE(sum(COALESCE(amount, 0) - COALESCE(paid, 0)), 0)
               FROM payables WHERE supplier_id = p_supplier_id AND status <> 'paid')
  );
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.so_chung_tu_ncc(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.so_chung_tu_ncc(uuid) TO authenticated;

-- ── RPC: gộp NCC p_tu vào p_vao ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gop_nha_cung_cap(p_tu uuid, p_vao uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid := public.user_org_id();
  v_tu suppliers%ROWTYPE;
  v_vao suppliers%ROWTYPE;
  c record;
  v_n bigint;
  v_ct jsonb := '[]'::jsonb;
  v_nv bigint;
  v_xoa boolean := false;
  v_ngay text := to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY');
BEGIN
  IF v_org IS NULL OR public.user_role() NOT IN ('owner', 'manager', 'accountant') THEN
    RAISE EXCEPTION 'KHONG_DU_QUYEN: chỉ Chủ NPP / Quản lý / Kế toán được gộp nhà cung cấp' USING ERRCODE = 'P0001';
  END IF;
  IF p_tu IS NULL OR p_vao IS NULL OR p_tu = p_vao THEN
    RAISE EXCEPTION 'GOP_NCC_TRUNG: chọn hai nhà cung cấp khác nhau' USING ERRCODE = 'P0001';
  END IF;
  -- Khoá theo thứ tự id — hai lượt gộp chéo nhau không khoá chết.
  PERFORM 1 FROM suppliers WHERE id IN (p_tu, p_vao) ORDER BY id FOR UPDATE;
  SELECT * INTO v_tu FROM suppliers WHERE id = p_tu AND org_id = v_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'KHONG_TIM_THAY_NCC: nhà cung cấp cần gộp không còn / không thuộc NPP' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_vao FROM suppliers WHERE id = p_vao AND org_id = v_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'KHONG_TIM_THAY_NCC: nhà cung cấp giữ lại không còn / không thuộc NPP' USING ERRCODE = 'P0001';
  END IF;

  -- 0. Mỗi NCC chỉ một dòng nợ đầu kỳ (`uq_payables_opening`): hai bên cùng có thì dòng của NCC bị gộp thành
  --    khoản nợ thường — số tiền / đã trả giữ nguyên, ghi chú nguồn gốc.
  IF EXISTS (SELECT 1 FROM payables WHERE supplier_id = p_vao AND opening_balance) THEN
    UPDATE payables SET opening_balance = false,
      notes = concat_ws(' · ', NULLIF(btrim(notes), ''), format('Nợ đầu kỳ của NCC %s (gộp ngày %s)', v_tu.name, v_ngay))
    WHERE supplier_id = p_tu AND opening_balance;
  END IF;

  -- 1. Mọi bảng trỏ vào NCC (trừ phân công NV — có khoá chính (user_id, supplier_id), làm riêng bên dưới).
  FOR c IN
    SELECT k.conrelid::regclass::text AS bang, a.attname::text AS cot
    FROM pg_constraint k
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
    JOIN pg_class t ON t.oid = k.conrelid
    WHERE k.contype = 'f'
      AND k.confrelid = 'public.suppliers'::regclass
      AND t.relnamespace = 'public'::regnamespace
      AND k.conrelid <> 'public.user_suppliers'::regclass
    ORDER BY 1, 2
  LOOP
    EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', c.bang, c.cot, c.cot) USING p_vao, p_tu;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      v_ct := v_ct || jsonb_build_object('bang', c.bang, 'cot', c.cot, 'so', v_n);
    END IF;
  END LOOP;

  -- 2. Phân công nhân viên: ai đã phụ trách NCC giữ lại thì bỏ dòng trùng.
  INSERT INTO user_suppliers (user_id, supplier_id, org_id)
  SELECT us.user_id, p_vao, us.org_id FROM user_suppliers us WHERE us.supplier_id = p_tu
  ON CONFLICT (user_id, supplier_id) DO NOTHING;
  GET DIAGNOSTICS v_nv = ROW_COUNT;
  DELETE FROM user_suppliers WHERE supplier_id = p_tu;

  -- 3. Hồ sơ: ô nào NCC giữ lại còn trống thì lấy của NCC bị gộp; ghi chú lại việc gộp.
  UPDATE suppliers s SET
    category              = COALESCE(NULLIF(btrim(s.category), ''), v_tu.category),
    contact_name          = COALESCE(NULLIF(btrim(s.contact_name), ''), v_tu.contact_name),
    phone                 = COALESCE(NULLIF(btrim(s.phone), ''), v_tu.phone),
    email                 = COALESCE(NULLIF(btrim(s.email), ''), v_tu.email),
    address               = COALESCE(NULLIF(btrim(s.address), ''), v_tu.address),
    tax_code              = COALESCE(NULLIF(btrim(s.tax_code), ''), v_tu.tax_code),
    bank_account          = COALESCE(NULLIF(btrim(s.bank_account), ''), v_tu.bank_account),
    bank_name             = COALESCE(NULLIF(btrim(s.bank_name), ''), v_tu.bank_name),
    legal_name            = COALESCE(NULLIF(btrim(s.legal_name), ''), v_tu.legal_name),
    business_type         = COALESCE(NULLIF(btrim(s.business_type), ''), v_tu.business_type),
    representative        = COALESCE(NULLIF(btrim(s.representative), ''), v_tu.representative),
    business_license_no   = COALESCE(NULLIF(btrim(s.business_license_no), ''), v_tu.business_license_no),
    business_license_date = COALESCE(s.business_license_date, v_tu.business_license_date),
    registered_address    = COALESCE(NULLIF(btrim(s.registered_address), ''), v_tu.registered_address),
    credit_limit          = COALESCE(s.credit_limit, v_tu.credit_limit),
    notes = concat_ws(E'\n', NULLIF(btrim(s.notes), ''),
      format('Gộp từ NCC %s%s ngày %s.', v_tu.name, COALESCE(' (' || v_tu.code || ')', ''), v_ngay),
      CASE WHEN NULLIF(btrim(v_tu.notes), '') IS NOT NULL THEN 'Ghi chú NCC cũ: ' || btrim(v_tu.notes) END)
  WHERE s.id = p_vao;

  -- 4. Xoá NCC bị gộp; xoá không được (bảng lạ ngoài public còn trỏ vào) thì ngừng hợp tác + ghi chú.
  BEGIN
    DELETE FROM suppliers WHERE id = p_tu;
    v_xoa := true;
  EXCEPTION WHEN others THEN
    UPDATE suppliers SET is_active = false,
      notes = concat_ws(E'\n', NULLIF(btrim(notes), ''),
        format('Đã gộp vào NCC %s%s ngày %s.', v_vao.name, COALESCE(' (' || v_vao.code || ')', ''), v_ngay))
    WHERE id = p_tu;
  END;

  RETURN jsonb_build_object(
    'vao', p_vao, 'tu_ten', v_tu.name, 'tu_ma', v_tu.code,
    'da_chuyen', v_ct, 'nhan_vien', v_nv, 'da_xoa', v_xoa);
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.gop_nha_cung_cap(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gop_nha_cung_cap(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 232: NCC hồ sơ pháp lý · chặn xoá · gộp' AS buoc,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'suppliers' AND column_name = 'registered_address')
             AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ncc_chan_xoa')
             AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ncc_nguoi_tao')
             AND to_regprocedure('public.so_chung_tu_ncc(uuid)') IS NOT NULL
             AND to_regprocedure('public.gop_nha_cung_cap(uuid,uuid)') IS NOT NULL
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua,
       (SELECT count(*) FROM suppliers) AS so_ncc,
       (SELECT count(*) FROM suppliers s WHERE (public._ncc_dem_chung_tu(s.id)->>'tong')::bigint > 0) AS ncc_co_chung_tu;
