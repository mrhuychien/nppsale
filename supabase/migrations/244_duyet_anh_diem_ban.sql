-- ====================================================================
-- 244 — DUYỆT ẢNH + VỊ TRÍ ĐIỂM BÁN: đã duyệt thì đổi / xoá phải xin duyệt
--
-- VÌ SAO — chủ nhà 12/10/2026: "Khi nhân viên cập nhật ảnh điểm bán và định vị. Chủ NPP đã phê duyệt thì khi thay
--   đổi hoặc xoá ảnh+vị trí cần nhà phân phối phê duyệt." (cùng lượt: "Khi đi tuyến chỉ cần checkin ko cần chụp
--   ảnh" — phần ấy ở giao diện, không cần migration).
--   Trước đây (mig 103 + đợt sửa sáng 12/10) NVBH chụp / chụp lại / xoá ảnh, dời / xoá vị trí điểm bán thẳng tay,
--   không ai duyệt: bộ ảnh + toạ độ đã kiểm xong vẫn bị đổi bất cứ lúc nào, không ai biết.
--
-- CÁCH LÀM
--   1. `customers.photo_approved_at / photo_approved_by` — bộ ảnh + vị trí của điểm bán ĐÃ DUYỆT. Chưa duyệt thì NVBH
--      sửa thẳng như cũ; người duyệt bấm "Duyệt ảnh + vị trí" (`duyet_anh_diem_ban`) là khoá; "Bỏ duyệt" là mở lại.
--   2. Người duyệt = người có quyền `customers.approve` (`user_has_permission`): chủ NPP luôn có; ai khác do chủ NPP
--      cấp ở Phân quyền (ô Khách hàng → Duyệt). Người duyệt sửa thẳng được cả khi đã duyệt.
--   3. Đã duyệt → trigger chặn mọi ghi thẳng vào `customer_photos` và `customers.gps_lat / gps_lng` của điểm bán ấy
--      (ANH_DA_DUYET / VI_TRI_DA_DUYET); hai cột duyệt chỉ đổi qua RPC (DUYET_QUA_NUT). Thay đổi của NVBH thành YÊU
--      CẦU (`customer_photo_requests`, `xin_doi_anh_diem_ban`): thêm / thay / xoá MỘT ảnh, đặt / xoá vị trí — chưa đổi
--      gì cho tới khi được duyệt. Mỗi ô ảnh và vị trí chỉ một yêu cầu đang chờ; gửi lại thì yêu cầu cũ bị thay.
--   4. `duyet_yeu_cau_anh_diem_ban(ids, dong_y, ghi_chu)`: đồng ý → áp vào ảnh / vị trí (điểm bán vẫn đã duyệt);
--      từ chối → bỏ. Yêu cầu lỗi thời (ảnh gốc đã đổi) tự huỷ. `huy_yeu_cau_anh_diem_ban(id)`: người gửi rút yêu cầu.
--      Các RPC trả `file_bo` — URL ảnh không còn dùng — để màn gọi /api/customers/photo-cleanup xoá file.
--   5. Thông báo loại `customer_photo_review`: yêu cầu mới → người duyệt; kết quả → người gửi; ảnh đầu tiên của điểm
--      bán chưa duyệt → người duyệt (để biết có điểm bán chờ duyệt).
--   ⚠ Mọi UPDATE / DELETE có WHERE (safeupdate — mig 236). Hai cột duyệt chỉ RPC ghi được — qua cờ phiên
--     `npp.duyet_anh_diem_ban` (như `npp.reissue_chuyen_thu`). Lượt không có người đăng nhập (khoá máy chủ, SQL tay)
--     không bị khoá.
-- ====================================================================

-- ── 1. Cột duyệt trên điểm bán ───────────────────────────────────────────────────────────────────
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS photo_approved_at timestamptz;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS photo_approved_by uuid REFERENCES users(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.customers.photo_approved_at IS
  'Mig 244: bộ ảnh + vị trí điểm bán đã duyệt lúc này — từ đó NVBH đổi / xoá phải gửi yêu cầu (customer_photo_requests).';

-- ── 2. Yêu cầu đổi ảnh / vị trí ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_photo_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id   uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  -- photo_add (ô trống) · photo_replace / photo_delete (ảnh photo_id) · pin_set (pin_lat/pin_lng) · pin_clear.
  kind          text NOT NULL CHECK (kind IN ('photo_add', 'photo_replace', 'photo_delete', 'pin_set', 'pin_clear')),
  -- Ảnh gốc bị đổi / xoá trước khi duyệt → NULL, yêu cầu thành lỗi thời (duyệt sẽ tự huỷ).
  photo_id      uuid REFERENCES customer_photos(id) ON DELETE SET NULL,
  slot          smallint CHECK (slot BETWEEN 1 AND 3),
  -- Ảnh MỚI (thêm / thay): file đã tải lên kho, chưa gắn vào điểm bán.
  photo_url     text,
  taken_at      timestamptz,
  gps_lat       numeric,
  gps_lng       numeric,
  gps_accuracy  numeric,
  pin_lat       numeric,
  pin_lng       numeric,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  decision_note text,
  CONSTRAINT yc_anh_moi_du_truong CHECK (kind NOT IN ('photo_add', 'photo_replace')
                                         OR (photo_url IS NOT NULL AND taken_at IS NOT NULL AND slot IS NOT NULL)),
  CONSTRAINT yc_xoa_anh_co_o CHECK (kind <> 'photo_delete' OR slot IS NOT NULL),
  CONSTRAINT yc_vi_tri_du_truong CHECK (kind <> 'pin_set' OR (pin_lat IS NOT NULL AND pin_lng IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_customer_photo_requests_customer ON public.customer_photo_requests (customer_id, status);
CREATE INDEX IF NOT EXISTS idx_customer_photo_requests_org_cho ON public.customer_photo_requests (org_id) WHERE status = 'pending';
-- Mỗi ô ảnh / vị trí chỉ MỘT yêu cầu đang chờ (RPC huỷ yêu cầu cũ trước khi chèn yêu cầu mới).
CREATE UNIQUE INDEX IF NOT EXISTS uq_yc_anh_cho_moi_o ON public.customer_photo_requests (customer_id, slot)
  WHERE status = 'pending' AND kind IN ('photo_add', 'photo_replace', 'photo_delete');
CREATE UNIQUE INDEX IF NOT EXISTS uq_yc_vi_tri_cho ON public.customer_photo_requests (customer_id)
  WHERE status = 'pending' AND kind IN ('pin_set', 'pin_clear');

COMMENT ON TABLE public.customer_photo_requests IS
  'Mig 244: yêu cầu đổi ảnh / vị trí của điểm bán đã duyệt — chỉ RPC ghi; duyệt qua duyet_yeu_cau_anh_diem_ban.';

ALTER TABLE public.customer_photo_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_photo_requests FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.customer_photo_requests FROM authenticated;
GRANT SELECT ON public.customer_photo_requests TO authenticated;
-- Thấy yêu cầu khi và chỉ khi thấy điểm bán (như ảnh — mig 103). KHÔNG có policy ghi: chỉ RPC ghi được.
DROP POLICY IF EXISTS "View customer photo requests" ON public.customer_photo_requests;
CREATE POLICY "View customer photo requests" ON public.customer_photo_requests
  FOR SELECT USING (org_id = public.user_org_id() AND EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id));

-- ── 3. Loại thông báo mới (giữ nguyên các loại của mig 221) ──────────────────────────────────────
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'order_pending_approval',
    'order_approved',
    'order_cancelled',
    'order_completed',
    'order_edited',
    'invoice_cancelled',
    'return_completed',
    'payment_received',
    'receivable_overdue',
    'visit_logged',
    'customer_photo_missing',
    'customer_route_missing',
    'customer_photo_review',
    'info'
  ));

-- ── 4. Hàm nội bộ ────────────────────────────────────────────────────────────────────────────────
-- Câu ngắn cho một yêu cầu — thông báo + màn dùng chung một cách gọi.
CREATE OR REPLACE FUNCTION public._mo_ta_yeu_cau_anh(p_kind text, p_slot integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE p_kind
    WHEN 'photo_add'     THEN 'Thêm ảnh ' || COALESCE(p_slot::text, '')
    WHEN 'photo_replace' THEN 'Thay ảnh ' || COALESCE(p_slot::text, '')
    WHEN 'photo_delete'  THEN 'Xoá ảnh ' || COALESCE(p_slot::text, '')
    WHEN 'pin_set'       THEN 'Dời vị trí'
    WHEN 'pin_clear'     THEN 'Xoá vị trí'
    ELSE p_kind END;
$fn$;

-- Người duyệt ảnh điểm bán của một NPP: còn làm, có quyền customers.approve.
CREATE OR REPLACE FUNCTION public._nguoi_duyet_anh_diem_ban(p_org uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT u.id FROM users u
  WHERE u.org_id = p_org AND u.is_active IS NOT FALSE AND public.user_has_permission(u.id, 'customers.approve');
$fn$;
REVOKE EXECUTE ON FUNCTION public._nguoi_duyet_anh_diem_ban(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._bao_tin_anh_diem_ban(p_org uuid, p_users uuid[], p_title text, p_body text,
                                                        p_link text, p_meta jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  INSERT INTO notifications (org_id, user_id, type, title, body, link_url, metadata)
  SELECT p_org, x, 'customer_photo_review', p_title, p_body, p_link, COALESCE(p_meta, '{}'::jsonb)
  FROM (SELECT DISTINCT unnest(p_users) AS x) d
  WHERE x IS NOT NULL;
$fn$;
REVOKE EXECUTE ON FUNCTION public._bao_tin_anh_diem_ban(uuid, uuid[], text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Điểm bán này có đang khoá với người đang gọi không: đã duyệt, và người gọi không có quyền duyệt. Không cần cờ phiên:
-- RPC nào ghi ảnh / toạ độ cũng chỉ người có quyền duyệt gọi được (NV chỉ GỬI yêu cầu).
CREATE OR REPLACE FUNCTION public._anh_diem_ban_bi_khoa(p_customer uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT p_customer IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM customers c WHERE c.id = p_customer AND c.photo_approved_at IS NOT NULL)
     AND NOT public.user_has_permission(auth.uid(), 'customers.approve');
$fn$;
REVOKE EXECUTE ON FUNCTION public._anh_diem_ban_bi_khoa(uuid) FROM PUBLIC, anon, authenticated;

-- ── 5. Trigger khoá ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_khoa_anh_diem_ban()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_cu  uuid;
  v_moi uuid;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_cu := OLD.customer_id; END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_moi := NEW.customer_id; END IF;
  IF public._anh_diem_ban_bi_khoa(v_cu) OR public._anh_diem_ban_bi_khoa(v_moi) THEN
    RAISE EXCEPTION 'ANH_DA_DUYET: Ảnh điểm bán đã được duyệt — thêm / thay / xoá ảnh phải gửi yêu cầu để chủ NPP duyệt.'
      USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._trg_khoa_anh_diem_ban() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_khoa_anh_diem_ban ON public.customer_photos;
CREATE TRIGGER trg_khoa_anh_diem_ban
  BEFORE INSERT OR UPDATE OR DELETE ON public.customer_photos
  FOR EACH ROW EXECUTE FUNCTION public._trg_khoa_anh_diem_ban();

CREATE OR REPLACE FUNCTION public._trg_khoa_vi_tri_diem_ban()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR COALESCE(current_setting('npp.duyet_anh_diem_ban', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.photo_approved_at IS NOT NULL OR NEW.photo_approved_by IS NOT NULL THEN
      RAISE EXCEPTION 'DUYET_QUA_NUT: Duyệt ảnh điểm bán chỉ qua nút Duyệt.' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.photo_approved_at IS DISTINCT FROM OLD.photo_approved_at
     OR NEW.photo_approved_by IS DISTINCT FROM OLD.photo_approved_by THEN
    RAISE EXCEPTION 'DUYET_QUA_NUT: Duyệt / bỏ duyệt ảnh điểm bán chỉ qua nút Duyệt.' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.photo_approved_at IS NOT NULL
     AND (NEW.gps_lat IS DISTINCT FROM OLD.gps_lat OR NEW.gps_lng IS DISTINCT FROM OLD.gps_lng)
     AND NOT public.user_has_permission(auth.uid(), 'customers.approve') THEN
    RAISE EXCEPTION 'VI_TRI_DA_DUYET: Vị trí điểm bán đã được duyệt — dời / xoá vị trí phải gửi yêu cầu để chủ NPP duyệt.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._trg_khoa_vi_tri_diem_ban() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_khoa_vi_tri_diem_ban ON public.customers;
CREATE TRIGGER trg_khoa_vi_tri_diem_ban
  BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public._trg_khoa_vi_tri_diem_ban();

-- Ảnh ĐẦU TIÊN của một điểm bán chưa duyệt → báo người duyệt (biết có điểm bán chờ duyệt).
CREATE OR REPLACE FUNCTION public._trg_bao_anh_dau_cho_duyet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_kh record;
BEGIN
  SELECT c.id, c.org_id, c.store_name, c.photo_approved_at INTO v_kh FROM customers c WHERE c.id = NEW.customer_id;
  IF NOT FOUND OR v_kh.photo_approved_at IS NOT NULL THEN RETURN NEW; END IF;
  IF (SELECT count(*) FROM customer_photos p WHERE p.customer_id = NEW.customer_id) <> 1 THEN RETURN NEW; END IF;
  PERFORM public._bao_tin_anh_diem_ban(
    v_kh.org_id,
    ARRAY(SELECT u FROM public._nguoi_duyet_anh_diem_ban(v_kh.org_id) u WHERE u IS DISTINCT FROM auth.uid()),
    'Ảnh điểm bán chờ duyệt: ' || v_kh.store_name,
    COALESCE((SELECT full_name FROM users WHERE id = NEW.uploaded_by), 'Nhân viên')
      || ' vừa chụp ảnh điểm bán — mở để duyệt ảnh + vị trí.',
    '/customers/' || NEW.customer_id,
    jsonb_build_object('customer_id', NEW.customer_id, 'kind', 'new_photo'));
  RETURN NEW;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._trg_bao_anh_dau_cho_duyet() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bao_anh_dau_cho_duyet ON public.customer_photos;
CREATE TRIGGER trg_bao_anh_dau_cho_duyet
  AFTER INSERT ON public.customer_photos
  FOR EACH ROW EXECUTE FUNCTION public._trg_bao_anh_dau_cho_duyet();

-- ── 6. RPC: duyệt / bỏ duyệt bộ ảnh + vị trí của điểm bán ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.duyet_anh_diem_ban(p_customer_id uuid, p_duyet boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid := public.user_org_id();
  v_kh  record;
  v_bo  text[];
BEGIN
  IF v_uid IS NULL OR NOT public.user_has_permission(v_uid, 'customers.approve') THEN
    RAISE EXCEPTION 'FORBIDDEN: chỉ chủ NPP (hoặc người được cấp quyền Duyệt khách hàng) được duyệt ảnh điểm bán.'
      USING ERRCODE = '42501';
  END IF;
  SELECT c.id, c.org_id, c.gps_lat, c.gps_lng INTO v_kh FROM customers c WHERE c.id = p_customer_id FOR UPDATE;
  IF NOT FOUND OR v_kh.org_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'KHACH_KHONG_HOP_LE: Điểm bán không thuộc đơn vị của bạn.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('npp.duyet_anh_diem_ban', 'on', true);

  IF COALESCE(p_duyet, true) THEN
    IF v_kh.gps_lat IS NULL AND NOT EXISTS (SELECT 1 FROM customer_photos WHERE customer_id = p_customer_id) THEN
      RAISE EXCEPTION 'CHUA_CO_GI_DE_DUYET: Điểm bán chưa có ảnh hay vị trí để duyệt.' USING ERRCODE = 'P0001';
    END IF;
    UPDATE customers SET photo_approved_at = now(), photo_approved_by = v_uid WHERE id = p_customer_id;
    RETURN jsonb_build_object('duyet', true, 'file_bo', '[]'::jsonb);
  END IF;

  -- Bỏ duyệt: NV sửa thẳng lại được → các yêu cầu đang chờ không còn nghĩa.
  WITH bo AS (
    UPDATE customer_photo_requests
       SET status = 'cancelled', decided_by = v_uid, decided_at = now(),
           decision_note = 'Bỏ duyệt — nhân viên sửa thẳng được'
     WHERE customer_id = p_customer_id AND status = 'pending'
    RETURNING photo_url
  )
  SELECT COALESCE(array_agg(photo_url) FILTER (WHERE photo_url IS NOT NULL), '{}') INTO v_bo FROM bo;
  UPDATE customers SET photo_approved_at = NULL, photo_approved_by = NULL WHERE id = p_customer_id;
  RETURN jsonb_build_object('duyet', false, 'file_bo', to_jsonb(v_bo));
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.duyet_anh_diem_ban(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.duyet_anh_diem_ban(uuid, boolean) TO authenticated;

-- ── 7. RPC: NV gửi yêu cầu đổi (điểm bán đã duyệt) ───────────────────────────────────────────────
-- Một lượt gọi = phần ảnh (none | add | replace | delete) + phần vị trí (keep | set | clear) → tối đa 2 yêu cầu,
-- duyệt riêng được (ảnh đúng mà vị trí sai thì duyệt ảnh, từ chối vị trí). Một thông báo cho người duyệt.
CREATE OR REPLACE FUNCTION public.xin_doi_anh_diem_ban(
  p_customer_id  uuid,
  p_photo_action text DEFAULT 'none',
  p_photo_id     uuid DEFAULT NULL,
  p_slot         integer DEFAULT NULL,
  p_photo_url    text DEFAULT NULL,
  p_taken_at     timestamptz DEFAULT NULL,
  p_gps_lat      numeric DEFAULT NULL,
  p_gps_lng      numeric DEFAULT NULL,
  p_gps_accuracy numeric DEFAULT NULL,
  p_pin_action   text DEFAULT 'keep',
  p_pin_lat      numeric DEFAULT NULL,
  p_pin_lng      numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid      uuid := auth.uid();
  v_org      uuid := public.user_org_id();
  v_role     text := public.user_role();
  v_anh_hd   text := COALESCE(p_photo_action, 'none');
  v_vt_hd    text := COALESCE(p_pin_action, 'keep');
  v_kh       record;
  v_photo_id uuid;
  v_slot     integer;
  v_id       uuid;
  v_ids      uuid[] := '{}';
  v_mo_ta    text[] := '{}';
  v_bo       text[];
BEGIN
  -- ⚠ KIỂM VAI (luật mig 166) — cùng vai với policy "Manage customer photos" (mig 103).
  IF v_uid IS NULL OR COALESCE(v_role, '') NOT IN ('owner', 'manager', 'sales') THEN
    RAISE EXCEPTION 'FORBIDDEN: vai trò của bạn không được sửa ảnh điểm bán.' USING ERRCODE = '42501';
  END IF;
  SELECT c.id, c.org_id, c.store_name, c.created_by, c.photo_approved_at INTO v_kh
  FROM customers c WHERE c.id = p_customer_id FOR UPDATE;
  IF NOT FOUND OR v_kh.org_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'KHACH_KHONG_HOP_LE: Điểm bán không thuộc đơn vị của bạn.' USING ERRCODE = 'P0001';
  END IF;
  -- NVBH chỉ với điểm bán mình thấy — cùng các nhánh của RLS `customer_select`.
  IF v_role = 'sales' AND NOT (
       public.user_has_permission(v_uid, 'customer.view_all')
       OR EXISTS (SELECT 1 FROM customer_assignments ca
                  WHERE ca.customer_id = p_customer_id AND ca.user_id = v_uid AND ca.status = 'active')
       OR v_kh.created_by = v_uid
       OR public.user_sells_to_customer(p_customer_id)) THEN
    RAISE EXCEPTION 'KHONG_PHU_TRACH: Bạn không phụ trách điểm bán này.' USING ERRCODE = '42501';
  END IF;
  IF v_kh.photo_approved_at IS NULL THEN
    RAISE EXCEPTION 'CHUA_DUYET: Ảnh điểm bán chưa được duyệt — sửa thẳng được, không cần gửi yêu cầu.' USING ERRCODE = 'P0001';
  END IF;
  IF v_anh_hd NOT IN ('none', 'add', 'replace', 'delete') OR v_vt_hd NOT IN ('keep', 'set', 'clear') THEN
    RAISE EXCEPTION 'YEU_CAU_SAI: Thao tác không hợp lệ (ảnh %, vị trí %).', v_anh_hd, v_vt_hd USING ERRCODE = 'P0001';
  END IF;
  IF v_anh_hd = 'none' AND v_vt_hd = 'keep' THEN
    RAISE EXCEPTION 'YEU_CAU_RONG: Không có gì để đổi.' USING ERRCODE = 'P0001';
  END IF;

  IF v_anh_hd IN ('replace', 'delete') THEN
    SELECT p.id, p.slot INTO v_photo_id, v_slot FROM customer_photos p
    WHERE p.id = p_photo_id AND p.customer_id = p_customer_id;
    IF v_photo_id IS NULL THEN
      RAISE EXCEPTION 'ANH_KHONG_TON_TAI: Ảnh này không còn — tải lại trang.' USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_anh_hd = 'add' THEN
    v_slot := p_slot;
    IF v_slot IS NULL OR v_slot NOT BETWEEN 1 AND 3 THEN
      RAISE EXCEPTION 'O_ANH_SAI: Ô ảnh phải từ 1 đến 3.' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM customer_photos WHERE customer_id = p_customer_id AND slot = v_slot) THEN
      RAISE EXCEPTION 'O_DA_CO_ANH: Ô ảnh % đã có ảnh — dùng Chụp lại.', v_slot USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF v_anh_hd IN ('add', 'replace') AND (
       p_photo_url IS NULL OR p_taken_at IS NULL
       OR position('/storage/v1/object/public/customer-photos/' || v_org::text || '/' || p_customer_id::text || '/'
                   IN p_photo_url) = 0) THEN
    RAISE EXCEPTION 'FILE_SAI: Ảnh mới không nằm trong kho ảnh của điểm bán này.' USING ERRCODE = 'P0001';
  END IF;
  IF v_vt_hd = 'set' AND (p_pin_lat IS NULL OR p_pin_lng IS NULL
                          OR p_pin_lat NOT BETWEEN -90 AND 90 OR p_pin_lng NOT BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'TOA_DO_SAI: Toạ độ vị trí mới không hợp lệ.' USING ERRCODE = 'P0001';
  END IF;

  -- Yêu cầu cũ cùng ô ảnh / cùng vị trí đang chờ → thay bằng yêu cầu mới; file ảnh của yêu cầu cũ trả về để dọn.
  WITH bo AS (
    UPDATE customer_photo_requests r
       SET status = 'cancelled', decided_by = v_uid, decided_at = now(), decision_note = 'Thay bằng yêu cầu mới'
     WHERE r.customer_id = p_customer_id AND r.status = 'pending'
       AND ((v_anh_hd <> 'none' AND r.kind IN ('photo_add', 'photo_replace', 'photo_delete') AND r.slot = v_slot)
         OR (v_vt_hd <> 'keep' AND r.kind IN ('pin_set', 'pin_clear')))
    RETURNING r.photo_url
  )
  SELECT COALESCE(array_agg(photo_url) FILTER (WHERE photo_url IS NOT NULL), '{}') INTO v_bo FROM bo;

  IF v_anh_hd <> 'none' THEN
    INSERT INTO customer_photo_requests (org_id, customer_id, kind, photo_id, slot, photo_url, taken_at,
                                         gps_lat, gps_lng, gps_accuracy, requested_by)
    VALUES (v_org, p_customer_id, 'photo_' || v_anh_hd, v_photo_id, v_slot,
            CASE WHEN v_anh_hd = 'delete' THEN NULL ELSE p_photo_url END,
            CASE WHEN v_anh_hd = 'delete' THEN NULL ELSE p_taken_at END,
            CASE WHEN v_anh_hd = 'delete' THEN NULL ELSE p_gps_lat END,
            CASE WHEN v_anh_hd = 'delete' THEN NULL ELSE p_gps_lng END,
            CASE WHEN v_anh_hd = 'delete' THEN NULL ELSE p_gps_accuracy END,
            v_uid)
    RETURNING id INTO v_id;
    v_ids := v_ids || v_id;
    v_mo_ta := v_mo_ta || public._mo_ta_yeu_cau_anh('photo_' || v_anh_hd, v_slot);
  END IF;
  IF v_vt_hd <> 'keep' THEN
    INSERT INTO customer_photo_requests (org_id, customer_id, kind, pin_lat, pin_lng, requested_by)
    VALUES (v_org, p_customer_id, 'pin_' || v_vt_hd,
            CASE WHEN v_vt_hd = 'set' THEN p_pin_lat END, CASE WHEN v_vt_hd = 'set' THEN p_pin_lng END, v_uid)
    RETURNING id INTO v_id;
    v_ids := v_ids || v_id;
    v_mo_ta := v_mo_ta || public._mo_ta_yeu_cau_anh('pin_' || v_vt_hd, NULL);
  END IF;

  PERFORM public._bao_tin_anh_diem_ban(
    v_org,
    ARRAY(SELECT u FROM public._nguoi_duyet_anh_diem_ban(v_org) u WHERE u <> v_uid),
    'Yêu cầu duyệt ảnh điểm bán: ' || v_kh.store_name,
    COALESCE((SELECT full_name FROM users WHERE id = v_uid), 'Nhân viên') || ' xin: ' || array_to_string(v_mo_ta, ' · '),
    '/customers/' || p_customer_id,
    jsonb_build_object('customer_id', p_customer_id, 'request_ids', to_jsonb(v_ids), 'kind', 'request'));

  RETURN jsonb_build_object('ids', to_jsonb(v_ids), 'file_bo', to_jsonb(v_bo));
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.xin_doi_anh_diem_ban(uuid, text, uuid, integer, text, timestamptz, numeric, numeric,
                                                       numeric, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.xin_doi_anh_diem_ban(uuid, text, uuid, integer, text, timestamptz, numeric, numeric,
                                                      numeric, text, numeric, numeric) TO authenticated;

-- ── 8. RPC: người duyệt đồng ý / từ chối (một hay nhiều yêu cầu) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.duyet_yeu_cau_anh_diem_ban(p_request_ids uuid[], p_dong_y boolean,
                                                             p_ghi_chu text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid      uuid := auth.uid();
  v_org      uuid := public.user_org_id();
  v_ghi      text := NULLIF(btrim(COALESCE(p_ghi_chu, '')), '');
  v_r        record;
  v_goc_id   uuid;
  v_goc_url  text;
  v_loi_thoi boolean;
  v_dem      integer := 0;
  v_xong     integer := 0;
  v_bo_qua   integer := 0;
  v_bo       text[] := '{}';
  v_khs      uuid[] := '{}';
BEGIN
  IF v_uid IS NULL OR NOT public.user_has_permission(v_uid, 'customers.approve') THEN
    RAISE EXCEPTION 'FORBIDDEN: chỉ chủ NPP (hoặc người được cấp quyền Duyệt khách hàng) được duyệt ảnh điểm bán.'
      USING ERRCODE = '42501';
  END IF;
  IF p_dong_y IS NULL OR COALESCE(array_length(p_request_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'YEU_CAU_RONG: Chưa chọn yêu cầu nào.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('npp.duyet_anh_diem_ban', 'on', true);

  FOR v_r IN
    SELECT r.* FROM customer_photo_requests r
    WHERE r.id = ANY (p_request_ids)
    ORDER BY r.requested_at, r.id
    FOR UPDATE
  LOOP
    v_dem := v_dem + 1;
    IF v_r.org_id IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'SAI_DON_VI: Yêu cầu không thuộc đơn vị của bạn.' USING ERRCODE = 'P0001';
    END IF;
    IF v_r.status <> 'pending' THEN
      RAISE EXCEPTION 'DA_XU_LY: Yêu cầu "%" đã được xử lý rồi — tải lại trang.', public._mo_ta_yeu_cau_anh(v_r.kind, v_r.slot)
        USING ERRCODE = 'P0001';
    END IF;

    IF NOT p_dong_y THEN
      UPDATE customer_photo_requests
         SET status = 'rejected', decided_by = v_uid, decided_at = now(), decision_note = v_ghi
       WHERE id = v_r.id;
      IF v_r.photo_url IS NOT NULL THEN v_bo := v_bo || v_r.photo_url; END IF;
      v_xong := v_xong + 1;
      CONTINUE;
    END IF;

    -- Đồng ý → áp vào ảnh / vị trí. Ảnh gốc đã đổi (ô đã có ảnh, ảnh cần thay / xoá không còn) → yêu cầu lỗi thời.
    v_loi_thoi := false;
    IF v_r.kind = 'photo_add' THEN
      IF EXISTS (SELECT 1 FROM customer_photos WHERE customer_id = v_r.customer_id AND slot = v_r.slot) THEN
        v_loi_thoi := true;
      ELSE
        INSERT INTO customer_photos (org_id, customer_id, slot, photo_url, taken_at, gps_lat, gps_lng, gps_accuracy,
                                     uploaded_by)
        VALUES (v_r.org_id, v_r.customer_id, v_r.slot, v_r.photo_url, v_r.taken_at, v_r.gps_lat, v_r.gps_lng,
                v_r.gps_accuracy, v_r.requested_by);
      END IF;
    ELSIF v_r.kind IN ('photo_replace', 'photo_delete') THEN
      v_goc_id := NULL;
      SELECT p.id, p.photo_url INTO v_goc_id, v_goc_url FROM customer_photos p
      WHERE p.id = v_r.photo_id AND p.customer_id = v_r.customer_id;
      IF v_goc_id IS NULL THEN
        v_loi_thoi := true;
      ELSIF v_r.kind = 'photo_replace' THEN
        UPDATE customer_photos
           SET photo_url = v_r.photo_url, taken_at = v_r.taken_at, gps_lat = v_r.gps_lat, gps_lng = v_r.gps_lng,
               gps_accuracy = v_r.gps_accuracy, uploaded_by = v_r.requested_by
         WHERE id = v_goc_id;
        v_bo := v_bo || v_goc_url;
      ELSE
        DELETE FROM customer_photos WHERE id = v_goc_id;
        v_bo := v_bo || v_goc_url;
      END IF;
    ELSIF v_r.kind = 'pin_set' THEN
      UPDATE customers SET gps_lat = v_r.pin_lat, gps_lng = v_r.pin_lng WHERE id = v_r.customer_id;
    ELSIF v_r.kind = 'pin_clear' THEN
      UPDATE customers SET gps_lat = NULL, gps_lng = NULL WHERE id = v_r.customer_id;
    END IF;

    IF v_loi_thoi THEN
      UPDATE customer_photo_requests
         SET status = 'cancelled', decided_by = v_uid, decided_at = now(),
             decision_note = 'Ảnh gốc đã đổi — yêu cầu không còn áp được'
       WHERE id = v_r.id;
      IF v_r.photo_url IS NOT NULL THEN v_bo := v_bo || v_r.photo_url; END IF;
      v_bo_qua := v_bo_qua + 1;
    ELSE
      UPDATE customer_photo_requests
         SET status = 'approved', decided_by = v_uid, decided_at = now(), decision_note = v_ghi
       WHERE id = v_r.id;
      v_xong := v_xong + 1;
      IF NOT v_r.customer_id = ANY (v_khs) THEN v_khs := v_khs || v_r.customer_id; END IF;
    END IF;
  END LOOP;

  IF v_dem <> (SELECT count(DISTINCT x) FROM unnest(p_request_ids) x) THEN
    RAISE EXCEPTION 'YEU_CAU_KHONG_TON_TAI: Có yêu cầu không còn — tải lại trang.' USING ERRCODE = 'P0001';
  END IF;

  -- Điểm bán vẫn "đã duyệt" — ghi mốc duyệt mới nhất.
  IF array_length(v_khs, 1) > 0 THEN
    UPDATE customers SET photo_approved_at = now(), photo_approved_by = v_uid WHERE id = ANY (v_khs);
  END IF;

  -- Báo người gửi (gộp theo điểm bán + người gửi).
  INSERT INTO notifications (org_id, user_id, type, title, body, link_url, metadata)
  SELECT v_org, r.requested_by, 'customer_photo_review',
         CASE WHEN p_dong_y THEN 'Đã duyệt ảnh điểm bán: ' ELSE 'Từ chối ảnh điểm bán: ' END || c.store_name,
         string_agg(public._mo_ta_yeu_cau_anh(r.kind, r.slot)
                      || CASE WHEN r.status = 'cancelled' THEN ' (không còn áp được)' ELSE '' END,
                    ' · ' ORDER BY r.slot NULLS LAST, r.kind)
           || COALESCE(' — ' || v_ghi, ''),
         '/customers/' || r.customer_id,
         jsonb_build_object('customer_id', r.customer_id, 'kind', CASE WHEN p_dong_y THEN 'approved' ELSE 'rejected' END)
  FROM customer_photo_requests r
  JOIN customers c ON c.id = r.customer_id
  WHERE r.id = ANY (p_request_ids) AND r.requested_by IS NOT NULL AND r.requested_by <> v_uid
  GROUP BY r.customer_id, r.requested_by, c.store_name;

  RETURN jsonb_build_object('xong', v_xong, 'bo_qua', v_bo_qua, 'file_bo', to_jsonb(v_bo));
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.duyet_yeu_cau_anh_diem_ban(uuid[], boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.duyet_yeu_cau_anh_diem_ban(uuid[], boolean, text) TO authenticated;

-- ── 9. RPC: rút yêu cầu (người gửi; người duyệt cũng bỏ được) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.huy_yeu_cau_anh_diem_ban(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid := public.user_org_id();
  v_r   record;
BEGIN
  SELECT r.* INTO v_r FROM customer_photo_requests r WHERE r.id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_r.org_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'YEU_CAU_KHONG_TON_TAI: Không tìm thấy yêu cầu này.' USING ERRCODE = 'P0001';
  END IF;
  IF v_uid IS NULL OR (v_r.requested_by IS DISTINCT FROM v_uid
                       AND NOT public.user_has_permission(v_uid, 'customers.approve')) THEN
    RAISE EXCEPTION 'FORBIDDEN: chỉ người gửi hoặc người duyệt được rút yêu cầu.' USING ERRCODE = '42501';
  END IF;
  IF v_r.status <> 'pending' THEN
    RAISE EXCEPTION 'DA_XU_LY: Yêu cầu đã được xử lý rồi — tải lại trang.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE customer_photo_requests
     SET status = 'cancelled', decided_by = v_uid, decided_at = now(),
         decision_note = CASE WHEN v_r.requested_by = v_uid THEN 'Người gửi rút yêu cầu' ELSE 'Người duyệt bỏ yêu cầu' END
   WHERE id = p_request_id;
  RETURN jsonb_build_object('file_bo', CASE WHEN v_r.photo_url IS NULL THEN '[]'::jsonb
                                            ELSE jsonb_build_array(v_r.photo_url) END);
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.huy_yeu_cau_anh_diem_ban(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.huy_yeu_cau_anh_diem_ban(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 244: duyệt ảnh + vị trí điểm bán' AS buoc,
       CASE WHEN to_regclass('public.customer_photo_requests') IS NOT NULL
             AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'photo_approved_at')
             AND to_regprocedure('public.xin_doi_anh_diem_ban(uuid,text,uuid,integer,text,timestamptz,numeric,numeric,numeric,text,numeric,numeric)') IS NOT NULL
             AND to_regprocedure('public.duyet_yeu_cau_anh_diem_ban(uuid[],boolean,text)') IS NOT NULL
             AND to_regprocedure('public.huy_yeu_cau_anh_diem_ban(uuid)') IS NOT NULL
             AND to_regprocedure('public.duyet_anh_diem_ban(uuid,boolean)') IS NOT NULL
             AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_khoa_anh_diem_ban')
             AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_khoa_vi_tri_diem_ban')
             AND position('customer_photo_review' IN (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
                                                      WHERE c.conname = 'notifications_type_check')) > 0
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua,
       (SELECT count(*) FROM customers WHERE photo_approved_at IS NOT NULL) AS diem_ban_da_duyet,
       (SELECT count(*) FROM customer_photo_requests WHERE status = 'pending') AS yeu_cau_dang_cho;
