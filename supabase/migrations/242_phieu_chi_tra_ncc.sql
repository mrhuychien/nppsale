-- ====================================================================
-- 242 — PHIẾU CHI TRẢ NHÀ CUNG CẤP: chi một cục, tự trừ vào các khoản nợ cũ nhất
--
-- VÌ SAO — chủ nhà 09/10/2026: "Trong quỹ tiền mặt có phiếu thu và phiếu chi, phiếu chi thêm phần chi cho ncc và
--   chọn NCC là xong, phiếu chi xuất hiện xong giao dịch NCC là xong, ko nhất thiết phiếu chi phải chi trả đúng hóa
--   đơn nào đó, có thể chi trả ncc 1 cục 200 triệu, nhiều hóa đơn nợ ...".
--   Trước đây trả NCC chỉ có ở từng dòng công nợ (`record_payable_payment`, mig 167): mỗi lần một phiếu nhập, không
--   quá số còn nợ của chính dòng ấy — trả 200 triệu cho 15 phiếu nhập là 15 lần bấm.
--
-- CÁCH LÀM
--   1. Bảng `supplier_payments` — phiếu chi trả NCC, mã PCNCC-xxxx theo NPP (như PTNCC- của phiếu trả NCC, mig 240):
--      NCC, ngày chi, số tiền, hình thức (tiền mặt / chuyển khoản), số tham chiếu, ghi chú, trạng thái.
--   2. Tiền của phiếu chi TỰ TRỪ vào các khoản nợ còn mở của NCC, khoản CŨ NHẤT trước (nợ đầu kỳ trước, rồi theo ngày
--      ghi nợ). Mỗi phần trừ là một dòng `payable_payments` gắn `supplier_payment_id` — mọi chỗ đang đọc công nợ
--      (`payables.paid`), dòng tiền / tồn quỹ (`payable_payments`), sổ NCC đều đúng ngay. KHÔNG tính vào chi phí /
--      lãi lỗ: trả NCC là trả nợ, không phải chi phí.
--      Trả DƯ (nhiều hơn số còn nợ) → phần dư nằm ở dòng "Trả trước NCC" của chính phiếu (amount 0, paid = phần dư,
--      trạng thái 'open' để tổng nợ NCC trừ nó — như dòng âm của phiếu trả NCC). Có khoản nợ mới (phiếu nhập hoàn
--      thành, nợ đầu kỳ…) thì tiền trả trước tự dồn vào (trigger `trg_tra_truoc_vao_no_moi`).
--      ⚠ Không đụng dòng âm của phiếu trả NCC — cấn trừ chúng sẽ khoá huỷ / sửa phiếu trả (DA_CAN_TRU).
--   3. Huỷ phiếu chi (`huy_phieu_chi_ncc`): gỡ mọi phần đã trừ, các khoản nợ về đúng số trước, phiếu ở Đã huỷ.
--   4. Huỷ phiếu nhập (`cancel_purchase_invoice`, bản mig 238 + một khối): phần phiếu chi đã tự trừ vào phiếu nhập trả
--      về "trả trước" của chính phiếu chi (không mất khoản đã chi) rồi dồn sang khoản nợ khác; chỉ tiền trả THẲNG vào
--      phiếu (Ghi trả NCC) mới còn chặn DA_TRA_TIEN như cũ.
--   5. Quyền như ghi trả tiền NCC (mig 167): Chủ NPP, Kế toán. Đọc phiếu chi: Chủ / Quản lý / Kế toán (RLS công nợ NCC).
--   ⚠ Mọi UPDATE / DELETE có WHERE (Supabase nạp `safeupdate` cho lượt gọi qua API — mig 236).
-- ====================================================================

-- ── 1. Bảng phiếu chi trả NCC ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  seq               integer NOT NULL,
  code              text NOT NULL,
  supplier_id       uuid NOT NULL REFERENCES suppliers(id),
  paid_date         date NOT NULL,
  amount            numeric NOT NULL CHECK (amount > 0),
  method            text NOT NULL CHECK (method IN ('cash', 'transfer')),
  reference_code    text,
  notes             text,
  status            text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'cancelled')),
  -- Dòng "Trả trước NCC" giữ phần chưa trừ được vào khoản nợ nào; hết tiền thì dòng bị xoá → NULL.
  prepay_payable_id uuid REFERENCES payables(id) ON DELETE SET NULL,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  cancelled_at      timestamptz,
  cancelled_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  cancel_reason     text,
  CONSTRAINT uq_supplier_payments_seq UNIQUE (org_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_org_ngay ON public.supplier_payments (org_id, paid_date DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON public.supplier_payments (supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_prepay ON public.supplier_payments (prepay_payable_id);

COMMENT ON TABLE public.supplier_payments IS
  'Phiếu chi trả NCC (mig 242): chi một cục, tự trừ vào khoản nợ cũ nhất (payable_payments.supplier_payment_id); phần dư là dòng trả trước.';

ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS phieu_chi_ncc_doc ON public.supplier_payments;
CREATE POLICY phieu_chi_ncc_doc ON public.supplier_payments
  FOR SELECT
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'manager', 'accountant'));
-- Không có chính sách ghi: chỉ RPC (definer) ghi được.

ALTER TABLE public.payable_payments ADD COLUMN IF NOT EXISTS supplier_payment_id uuid REFERENCES public.supplier_payments(id);
CREATE INDEX IF NOT EXISTS idx_payable_payments_phieu_chi ON public.payable_payments (supplier_payment_id);

-- ── 2. Dồn tiền trả trước của NCC vào các khoản nợ còn mở, cũ nhất trước ─────────────────────────
CREATE OR REPLACE FUNCTION public._don_tra_truoc_ncc(p_org uuid, p_supplier uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r      record;
  d      record;
  v_con  numeric;
  v_lay  numeric;
  v_tong numeric := 0;
BEGIN
  -- ⚠ Khoá cả sổ nợ của NCC theo thứ tự id — hai lượt chi / dồn cùng lúc không trừ trùng một khoản.
  PERFORM 1 FROM payables WHERE org_id = p_org AND supplier_id = p_supplier ORDER BY id FOR UPDATE;

  -- Tiền đang nằm ở dòng trả trước, tiền chi trước dồn trước.
  FOR r IN
    SELECT pp.id, pp.payable_id, pp.amount, pp.method, pp.paid_at, pp.paid_by, pp.notes,
           pp.supplier_payment_id, pp.verified_by, pp.verified_at
    FROM payable_payments pp
    JOIN supplier_payments sp ON sp.id = pp.supplier_payment_id AND sp.prepay_payable_id = pp.payable_id
    WHERE sp.org_id = p_org AND sp.supplier_id = p_supplier AND sp.status = 'posted' AND pp.amount > 0
    ORDER BY pp.paid_at, pp.id
  LOOP
    v_con := r.amount;
    WHILE v_con > 0 LOOP
      -- Khoản nợ cũ nhất còn phải trả: nợ đầu kỳ trước, rồi theo ngày ghi nợ. Dòng trả trước không phải khoản nợ.
      SELECT p.id, p.amount, COALESCE(p.paid, 0) AS paid INTO d
      FROM payables p
      WHERE p.org_id = p_org AND p.supplier_id = p_supplier
        AND p.amount - COALESCE(p.paid, 0) > 0
        AND NOT EXISTS (SELECT 1 FROM supplier_payments s2 WHERE s2.prepay_payable_id = p.id)
      ORDER BY p.opening_balance DESC, p.created_at, p.id
      LIMIT 1;
      EXIT WHEN NOT FOUND;

      v_lay := LEAST(v_con, d.amount - d.paid);
      -- ⚠ Chốt chống lặp mãi: không lấy được đồng nào thì dừng (điều kiện chọn khoản ở trên đã loại trường hợp này).
      EXIT WHEN v_lay <= 0;
      INSERT INTO payable_payments (payable_id, amount, method, paid_at, paid_by, notes, supplier_payment_id, verified_by, verified_at)
      VALUES (d.id, v_lay, r.method, r.paid_at, r.paid_by, r.notes, r.supplier_payment_id, r.verified_by, r.verified_at);
      UPDATE payables
      SET paid = d.paid + v_lay,
          status = CASE WHEN d.paid + v_lay >= d.amount THEN 'paid' ELSE 'partial' END
      WHERE id = d.id;
      UPDATE payables SET paid = COALESCE(paid, 0) - v_lay WHERE id = r.payable_id;
      v_con := v_con - v_lay;
      v_tong := v_tong + v_lay;
    END LOOP;

    IF v_con <= 0 THEN
      DELETE FROM payable_payments WHERE id = r.id;
    ELSIF v_con < r.amount THEN
      UPDATE payable_payments SET amount = v_con WHERE id = r.id;
    END IF;
  END LOOP;

  -- Dòng trả trước đã hết tiền → xoá (khoá ngoại đưa supplier_payments.prepay_payable_id về NULL).
  DELETE FROM payables p
  USING supplier_payments sp
  WHERE sp.prepay_payable_id = p.id
    AND sp.org_id = p_org AND sp.supplier_id = p_supplier
    AND COALESCE(p.paid, 0) <= 0
    AND NOT EXISTS (SELECT 1 FROM payable_payments x WHERE x.payable_id = p.id);

  RETURN v_tong;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._don_tra_truoc_ncc(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. Trả phần phiếu chi đã trừ vào MỘT khoản nợ về "trả trước" của chính phiếu chi ──────────────
CREATE OR REPLACE FUNCTION public._tra_phan_bo_ve_truoc(p_payable uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r      record;
  v_line uuid;
  v_tong numeric := 0;
BEGIN
  PERFORM 1 FROM payables WHERE id = p_payable FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT pp.id, pp.amount, pp.paid_at, sp.id AS sp_id, sp.code, sp.org_id, sp.supplier_id
    FROM payable_payments pp
    JOIN supplier_payments sp ON sp.id = pp.supplier_payment_id
    WHERE pp.payable_id = p_payable AND sp.status = 'posted'
      AND sp.prepay_payable_id IS DISTINCT FROM p_payable
    ORDER BY pp.paid_at, pp.id
  LOOP
    SELECT prepay_payable_id INTO v_line FROM supplier_payments WHERE id = r.sp_id FOR UPDATE;
    IF v_line IS NULL THEN
      INSERT INTO payables (org_id, supplier_id, invoice_number, amount, paid, status, notes, created_at)
      VALUES (r.org_id, r.supplier_id, r.code, 0, 0, 'open', 'Trả trước NCC — phiếu chi ' || r.code, r.paid_at)
      RETURNING id INTO v_line;
      UPDATE supplier_payments SET prepay_payable_id = v_line WHERE id = r.sp_id;
    END IF;
    UPDATE payable_payments SET payable_id = v_line WHERE id = r.id;
    UPDATE payables SET paid = COALESCE(paid, 0) + r.amount WHERE id = v_line;
    v_tong := v_tong + r.amount;
  END LOOP;

  IF v_tong > 0 THEN
    UPDATE payables
    SET paid = COALESCE(paid, 0) - v_tong,
        status = CASE WHEN COALESCE(paid, 0) - v_tong <= 0 THEN 'open'
                      WHEN COALESCE(paid, 0) - v_tong >= amount THEN 'paid'
                      ELSE 'partial' END
    WHERE id = p_payable;
  END IF;
  RETURN v_tong;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._tra_phan_bo_ve_truoc(uuid) FROM PUBLIC, anon, authenticated;

-- ── 4. Lập phiếu chi trả NCC ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chi_tra_ncc(
  p_supplier_id uuid,
  p_amount      numeric,
  p_paid_date   date DEFAULT NULL,
  p_method      text DEFAULT 'cash',
  p_notes       text DEFAULT NULL,
  p_reference   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org  uuid := public.user_org_id();
  v_uid  uuid := auth.uid();
  v_ngay date := COALESCE(p_paid_date, public.vn_today());
  v_luc  timestamptz;
  v_seq  integer;
  v_code text;
  v_id   uuid;
  v_line uuid;
  v_ghi  text := NULLIF(btrim(COALESCE(p_notes, '')), '');
  v_du   numeric;
BEGIN
  -- ⚠ KIỂM VAI (luật mig 166) — cùng vai với `record_payable_payment` (mig 167) / RLS "Manage payables".
  IF COALESCE(public.user_role(), '') NOT IN ('owner', 'accountant') THEN
    RAISE EXCEPTION 'FORBIDDEN: chỉ chủ NPP hoặc kế toán được lập phiếu chi trả NCC.' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'BAD_AMOUNT: Số tiền chi phải lớn hơn 0.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_method, '') NOT IN ('cash', 'transfer') THEN
    RAISE EXCEPTION 'BAD_METHOD: Hình thức chi chỉ là tiền mặt hoặc chuyển khoản.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM suppliers WHERE id = p_supplier_id AND org_id = v_org) THEN
    RAISE EXCEPTION 'NCC_KHONG_HOP_LE: Nhà cung cấp không thuộc đơn vị của bạn.' USING ERRCODE = 'P0001';
  END IF;
  IF v_ngay > public.vn_today() THEN
    RAISE EXCEPTION 'NGAY_TUONG_LAI: Ngày chi không được sau hôm nay.' USING ERRCODE = 'P0001';
  END IF;
  -- Lúc chi (dòng tiền tính theo ngày): chi hôm nay → bây giờ; ghi lùi ngày → 12:00 giờ VN của ngày ấy.
  v_luc := CASE WHEN v_ngay = public.vn_today() THEN now()
                ELSE (v_ngay + time '12:00') AT TIME ZONE 'Asia/Ho_Chi_Minh' END;

  -- Số phiếu theo NPP — khoá để hai người lập cùng lúc không trùng số.
  PERFORM pg_advisory_xact_lock(hashtext('supplier_payments:' || v_org::text));
  SELECT COALESCE(max(seq), 0) + 1 INTO v_seq FROM supplier_payments WHERE org_id = v_org;
  v_code := 'PCNCC-' || public._so_chung_tu(v_seq);

  -- Cả số tiền vào dòng trả trước của chính phiếu, rồi dồn sang các khoản nợ cũ nhất.
  INSERT INTO payables (org_id, supplier_id, invoice_number, amount, paid, status, notes, created_at)
  VALUES (v_org, p_supplier_id, v_code, 0, p_amount, 'open', 'Trả trước NCC — phiếu chi ' || v_code, v_luc)
  RETURNING id INTO v_line;
  INSERT INTO supplier_payments (org_id, seq, code, supplier_id, paid_date, amount, method, reference_code, notes,
                                 prepay_payable_id, created_by)
  VALUES (v_org, v_seq, v_code, p_supplier_id, v_ngay, p_amount, p_method,
          NULLIF(btrim(COALESCE(p_reference, '')), ''), v_ghi, v_line, v_uid)
  RETURNING id INTO v_id;
  INSERT INTO payable_payments (payable_id, amount, method, paid_at, paid_by, notes, supplier_payment_id)
  VALUES (v_line, p_amount, p_method, v_luc, v_uid, 'Phiếu chi ' || v_code || COALESCE(' — ' || v_ghi, ''), v_id);

  PERFORM public._don_tra_truoc_ncc(v_org, p_supplier_id);

  SELECT COALESCE(sum(pp.amount), 0) INTO v_du
  FROM payable_payments pp JOIN supplier_payments sp ON sp.id = pp.supplier_payment_id AND sp.prepay_payable_id = pp.payable_id
  WHERE sp.id = v_id;

  RETURN jsonb_build_object(
    'id', v_id, 'code', v_code, 'so_tien', p_amount,
    'da_tru_no', p_amount - v_du,
    'tra_truoc', v_du,
    'so_khoan', (SELECT count(DISTINCT pp.payable_id) FROM payable_payments pp
                 WHERE pp.supplier_payment_id = v_id
                   AND pp.payable_id IS DISTINCT FROM (SELECT prepay_payable_id FROM supplier_payments WHERE id = v_id)));
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.chi_tra_ncc(uuid, numeric, date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chi_tra_ncc(uuid, numeric, date, text, text, text) TO authenticated;

-- ── 5. Huỷ phiếu chi trả NCC ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.huy_phieu_chi_ncc(p_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v    supplier_payments%ROWTYPE;
  r    record;
  v_go numeric := 0;
BEGIN
  SELECT * INTO v FROM supplier_payments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PHIEU_KHONG_TON_TAI: Không tìm thấy phiếu chi này.' USING ERRCODE = 'P0001';
  END IF;
  IF v.org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'SAI_DON_VI: Phiếu chi này không thuộc đơn vị của bạn.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(public.user_role(), '') NOT IN ('owner', 'accountant') THEN
    RAISE EXCEPTION 'FORBIDDEN: chỉ chủ NPP hoặc kế toán được huỷ phiếu chi trả NCC.' USING ERRCODE = '42501';
  END IF;
  -- ⚠ IDEMPOTENT — bấm hai lần không gỡ tiền hai lần.
  IF v.status = 'cancelled' THEN
    RETURN jsonb_build_object('id', p_id, 'code', v.code, 'da_huy', false, 'so_tien_go', 0);
  END IF;

  PERFORM 1 FROM payables WHERE org_id = v.org_id AND supplier_id = v.supplier_id ORDER BY id FOR UPDATE;

  -- Gỡ từng phần đã trừ — khoản nợ về đúng số trước khi chi.
  FOR r IN
    SELECT payable_id, sum(amount) AS tien FROM payable_payments WHERE supplier_payment_id = p_id GROUP BY payable_id
  LOOP
    UPDATE payables
    SET paid = COALESCE(paid, 0) - r.tien,
        status = CASE WHEN COALESCE(paid, 0) - r.tien <= 0 THEN 'open'
                      WHEN COALESCE(paid, 0) - r.tien >= amount THEN 'paid'
                      ELSE 'partial' END
    WHERE id = r.payable_id;
    v_go := v_go + r.tien;
  END LOOP;
  DELETE FROM payable_payments WHERE supplier_payment_id = p_id;

  UPDATE supplier_payments
  SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
      cancel_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''), prepay_payable_id = NULL
  WHERE id = p_id;
  IF v.prepay_payable_id IS NOT NULL THEN
    DELETE FROM payables
    WHERE id = v.prepay_payable_id
      AND NOT EXISTS (SELECT 1 FROM payable_payments x WHERE x.payable_id = v.prepay_payable_id);
  END IF;

  -- Khoản nợ vừa mở lại: tiền trả trước của các phiếu chi khác (nếu có) dồn vào.
  PERFORM public._don_tra_truoc_ncc(v.org_id, v.supplier_id);

  RETURN jsonb_build_object('id', p_id, 'code', v.code, 'da_huy', true, 'so_tien_go', v_go);
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.huy_phieu_chi_ncc(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.huy_phieu_chi_ncc(uuid, text) TO authenticated;

-- ── 6. Khoản nợ mới của NCC đang có tiền trả trước → tự dồn vào ──────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_tra_truoc_vao_no_moi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM supplier_payments sp
             JOIN payable_payments pp ON pp.payable_id = sp.prepay_payable_id AND pp.supplier_payment_id = sp.id
             WHERE sp.org_id = NEW.org_id AND sp.supplier_id = NEW.supplier_id
               AND sp.status = 'posted' AND pp.amount > 0) THEN
    PERFORM public._don_tra_truoc_ncc(NEW.org_id, NEW.supplier_id);
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._trg_tra_truoc_vao_no_moi() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tra_truoc_vao_no_moi ON public.payables;
CREATE TRIGGER trg_tra_truoc_vao_no_moi
  AFTER INSERT ON public.payables
  FOR EACH ROW WHEN (NEW.amount > 0)
  EXECUTE FUNCTION public._trg_tra_truoc_vao_no_moi();

-- ── 7. Huỷ phiếu nhập: bản mig 238 + phần phiếu chi đã trừ vào phiếu trả về "trả trước" ─────────────
CREATE OR REPLACE FUNCTION public.cancel_purchase_invoice(p_invoice_id uuid, p_reason text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_org      uuid;
  v_status   text;
  v_entry    uuid;
  v_payable  uuid;
  v_uid      uuid := auth.uid();
  v_paid     numeric;
  v_bad      text;
  -- (mig 238) NPP cho phép tồn kho âm → huỷ được phiếu nhập dù hàng đã xuất bớt.
  v_cho_am   boolean;
  -- (mig 242) NCC của phiếu — phần phiếu chi trả về "trả trước" rồi dồn sang khoản nợ khác của NCC này.
  v_supplier uuid;
BEGIN
  SELECT org_id, status, stock_entry_id, payable_id, supplier_id
    INTO v_org, v_status, v_entry, v_payable, v_supplier
  FROM purchase_invoices WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PHIEU_KHONG_TON_TAI: Không tìm thấy phiếu nhập này.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'SAI_DON_VI: Phiếu nhập này không thuộc đơn vị của bạn.'
      USING ERRCODE = 'P0001';
  END IF;
  -- ⚠ KIỂM VAI (mig 166). Hàm SECURITY DEFINER bỏ qua RLS, nên phải
  --   tự kiểm đúng vai mà RLS của bảng đang kiểm. Bỏ qua khi được
  --   gọi từ trong một RPC khác đã tự kiểm quyền (npp.via_rpc).
  IF current_setting('npp.via_rpc', true) IS DISTINCT FROM 'on'
     AND COALESCE(public.user_role(), '') NOT IN ('owner', 'manager', 'accountant', 'warehouse') THEN
    RAISE EXCEPTION 'FORBIDDEN: vai trò của bạn không được làm thao tác kho / mua hàng này.'
      USING ERRCODE = '42501';
  END IF;
  -- Idempotent.
  IF v_status = 'cancelled' THEN
    RETURN p_invoice_id;
  END IF;

  -- Phiếu còn tạm thì huỷ là đổi một chữ; chưa đụng gì tới kho hay nợ.
  IF v_status = 'draft' THEN
    UPDATE purchase_invoices
    SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid,
        cancel_reason = p_reason
    WHERE id = p_invoice_id;
    RETURN p_invoice_id;
  END IF;

  -- 4.1 Tiền đã trả rồi thì không huỷ được.
  --   (mig 242) Phần PHIẾU CHI TRẢ NCC tự trừ vào phiếu này không chặn: trả về "trả trước" của chính phiếu chi (tiền
  --   đã chi không mất), cuối hàm dồn sang khoản nợ khác. Chỉ tiền trả THẲNG vào phiếu (Ghi trả NCC) còn chặn.
  IF v_payable IS NOT NULL THEN
    PERFORM public._tra_phan_bo_ve_truoc(v_payable);
    SELECT COALESCE(paid, 0) INTO v_paid FROM payables WHERE id = v_payable;
    IF COALESCE(v_paid, 0) > 0 THEN
      RAISE EXCEPTION 'DA_TRA_TIEN: Phiếu này đã trả NCC % — huỷ phiếu là xoá mất khoản đã trả. Gỡ phiếu chi trước, hoặc lập phiếu trả hàng NCC.', v_paid
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT COALESCE(allow_oversell, false) INTO v_cho_am FROM organizations WHERE id = v_org;

  -- 4.2 Hàng đã động thì không huỷ được — TRỪ KHI NPP cho phép tồn kho âm (mig 238). Nói rõ MẶT HÀNG NÀO — bắt
  --     người dùng tự dò cả phiếu là bỏ phí việc mình vừa tra ra.
  IF v_entry IS NOT NULL THEN
    SELECT string_agg(
             p.name || ' (nhập ' || b.qty_initial || ', còn ' || b.qty_on_hand || ')',
             ' · ' ORDER BY p.name)
      INTO v_bad
    FROM stock_entry_lines sel
    JOIN batches  b ON b.id = sel.batch_id
    JOIN products p ON p.id = sel.product_id
    WHERE sel.entry_id = v_entry
      AND b.qty_on_hand <> b.qty_initial;

    IF v_bad IS NOT NULL AND NOT COALESCE(v_cho_am, false) THEN
      RAISE EXCEPTION 'HANG_DA_XUAT: Không huỷ được vì hàng của phiếu đã xuất bớt — %. Lập phiếu trả hàng NCC hoặc phiếu điều chỉnh kho — hoặc bật "Cho phép bán vượt tồn kho" (Cài đặt › Đơn vị) để huỷ: phần đã xuất thành tồn âm.', v_bad
        USING ERRCODE = 'P0001';
    END IF;

    -- (mig 238) Trừ ĐÚNG SỐ ĐÃ NHẬP khỏi lô rồi đóng phiếu kho. Chưa xuất gì → 0 như cũ; đã xuất X (chỉ khi cho phép
    --   tồn âm) → lô −X, khớp thẻ kho. Lô còn dương (hàng trả về vượt số đã xuất) thì giữ mở cho số hàng ấy.
    UPDATE batches b
    SET qty_on_hand = b.qty_on_hand - b.qty_initial,
        status = CASE WHEN b.qty_on_hand - b.qty_initial > 0 THEN b.status ELSE 'cancelled' END
    FROM stock_entry_lines sel
    WHERE sel.entry_id = v_entry AND b.id = sel.batch_id;

    UPDATE stock_entries SET status = 'cancelled' WHERE id = v_entry;
  END IF;

  /**
   * 4.3 Đóng phiếu TRƯỚC, xoá công nợ SAU.
   *
   * ⚠ THỨ TỰ NÀY LÀ BẮT BUỘC, KHÔNG PHẢI SỞ THÍCH.
   *   `purchase_invoices.payable_id` có khoá ngoại trỏ tới `payables`,
   *   nên xoá dòng nợ khi phiếu còn trỏ vào nó là Postgres từ chối
   *   ("still referenced from table"). Phải gỡ con trỏ trước.
   *
   * ⚠ XOÁ HẲN DÒNG NỢ, KHÔNG ĐÁNH DẤU. `payables.status` chỉ nhận
   *   open/partial/paid/overdue — không có 'cancelled'. Để nó lại ở
   *   'open' là một khoản nợ ma vẫn cộng vào công nợ NCC mãi mãi. Vết
   *   tích nằm ở chính phiếu: `cancelled_at`, `cancelled_by`,
   *   `cancel_reason`. An toàn vì mục 4.1 đã chắc chắn chưa trả đồng nào.
   */
  UPDATE purchase_invoices
  SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid,
      cancel_reason = p_reason, payable_id = NULL
  WHERE id = p_invoice_id;

  IF v_payable IS NOT NULL THEN
    DELETE FROM payables WHERE id = v_payable;
    -- (mig 242) Tiền phiếu chi vừa trả về "trả trước" → dồn sang khoản nợ khác còn mở của NCC.
    PERFORM public._don_tra_truoc_ncc(v_org, v_supplier);
  END IF;

  RETURN p_invoice_id;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.cancel_purchase_invoice(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_invoice(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 242: phiếu chi trả NCC (chi một cục, tự trừ nợ cũ nhất)' AS buoc,
       CASE WHEN to_regclass('public.supplier_payments') IS NOT NULL
             AND to_regprocedure('public.chi_tra_ncc(uuid,numeric,date,text,text,text)') IS NOT NULL
             AND to_regprocedure('public.huy_phieu_chi_ncc(uuid,text)') IS NOT NULL
             AND position('_tra_phan_bo_ve_truoc' IN pg_get_functiondef('public.cancel_purchase_invoice(uuid,text)'::regprocedure)) > 0
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua,
       (SELECT count(*) FROM payables WHERE status <> 'paid' AND amount - COALESCE(paid, 0) > 0) AS khoan_no_ncc_dang_mo;
