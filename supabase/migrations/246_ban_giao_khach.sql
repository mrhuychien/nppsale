-- ====================================================================
-- 246 — BÀN GIAO KHÁCH GIỮA NHÂN VIÊN + DANH SÁCH "HÀNG KHÁCH ĐÃ LẤY"
--
-- VÌ SAO — chủ nhà 15/10/2026 (chuyển lời một NPP): "Gán cho toàn bộ khách hàng của nv A cho nv B (làm chung
--   khách hàng) Hoặc là như kiểu bàn giao lại khách hàng. Đã lấy sp gì, số lượng. Khi a có nv mới làm thì phải bàn
--   giao được các cty mà nv đó làm có những khách nào lấy thì phải có ds cho họ … thể hiện luôn trên máy của nv. Khi
--   họ muốn kiểm tra điểm bán sẽ có luôn. Vậy mình phải tạo: dskh tuyến đó, đã lấy hàng gì, số lượng, hàng cty nào
--   mà nv đó làm". Chủ nhà chốt cùng ngày: CẢ HAI kiểu (làm chung / chuyển hẳn); phạm vi toàn bộ khách của NV, theo
--   tuyến, theo công ty (NCC); thời gian chọn được (3 / 6 / 12 tháng / tất cả); chuyển hẳn thì CÔNG NỢ theo NV
--   nhận — doanh số các hoá đơn cũ vẫn của NV cũ.
--
-- 1. `receivables.giao_tu_nv` — nợ đã BÀN GIAO từ NV này sang NV đang đứng tên. `_wf2b_recompute_receivable`
--    (mig 194) và `_cong_no_phieu_tra` ghi lại người của CHỨNG TỪ mỗi lần tính lại nợ → không có dấu này thì nợ
--    vừa chuyển cho B quay về A ở lần sửa hoá đơn / trả hàng kế tiếp. Trigger `_cong_no_giu_ve_npp` (mig 223) nay:
--    tính lại vẫn ghi NV giao → giữ NV đang đứng tên; chứng từ đổi sang người KHÁC (sửa người bán) → theo chứng từ
--    như mig 194 và bỏ dấu. Chỉ RPC (cờ `npp.giao_cong_no`) đặt / xoá được dấu. `reissue_invoice` (mig 227) chép
--    dấu sang tờ mới cùng người giữ nợ.
-- 2. `ban_giao_khach_log` — nhật ký: ai giao, từ ai, cho ai, kiểu, bộ lọc, khách nào, kết quả.
-- 3. `ban_giao_khach(...)` — xem trước (`p_thuc_hien` = false) / thực hiện. Chủ NPP / quản lý (cùng luật RLS
--    `customer_assignments`). Nguồn: khách của một NV · khách chưa ai phụ trách · mọi khách; lọc tuyến, công ty
--    (khách đã lấy hàng công ty ấy, theo hoá đơn đã ghi sổ từ ngày chọn).
--      Làm chung: thêm NV nhận (phụ nếu khách đã có NV chính còn làm, không thì chính); NV giao giữ nguyên.
--      Chuyển hẳn (chỉ từ một NV): NV nhận thay đúng vai của NV giao, NV giao thôi phụ trách; nợ CHƯA THU XONG của
--      NV giao với các khách ấy sang NV nhận (đã thu xong giữ tên cũ — lịch sử). Hoá đơn / doanh số không đổi.
--      Lịch đi tuyến của NV giao: khách MỚI với NV nhận thì NV nhận được chép (làm chung) / chuyển (chuyển hẳn) sang;
--      chuyển hẳn thì NV giao mất lịch của các khách ấy.
--      NV nhận thành phụ trách chính + `p_giao_no_npp` → nhận luôn nợ NPP đang giữ của khách ấy (NV cũ nghỉ việc —
--      mig 223, như màn phân công từng khách).
-- 4. `hang_khach_da_lay(...)` — khách + hàng đã lấy: SL quy về ĐƠN VỊ CƠ SỞ (cùng luật `heSoQuyDoi`: ưu tiên hệ số
--    chụp trên dòng hoá đơn; dòng trả tra danh mục), THUẦN = hoá đơn đã ghi sổ (theo `invoice_date`) − hàng trả đã
--    trừ (`revenue_date`, mig 192), bỏ dòng hàng đổi cả hai phía; số lần lấy, lần lấy cuối.
--    NVBH: chỉ khách mình đang phụ trách, chỉ hàng công ty mình làm (như RLS sản phẩm mig 081: NCC của mình + hàng
--    chưa gán NCC). Chủ / quản lý / kế toán: theo NV chọn (khách + công ty của NV ấy) hoặc theo danh sách khách đưa
--    vào (mọi hàng). Chỉ SỐ LƯỢNG — không có tiền. Trả MỘT jsonb (không vướng trần 1.000 dòng của PostgREST).
-- ====================================================================

-- 1) Dấu bàn giao nợ ---------------------------------------------------------------------------------
-- ⚠ Không gắn khoá ngoại: ON DELETE SET NULL chạy qua trigger dưới (khoá cột) là vỡ; dấu chỉ để so người.
ALTER TABLE public.receivables ADD COLUMN IF NOT EXISTS giao_tu_nv uuid;
COMMENT ON COLUMN public.receivables.giao_tu_nv IS
  'Nợ đã bàn giao từ NV này sang NV đang đứng tên (mig 246). Tính lại theo chứng từ vẫn ghi NV này thì giữ NV đang đứng tên. Chỉ RPC bàn giao đổi được.';

CREATE OR REPLACE FUNCTION public._cong_no_giu_ve_npp()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF current_setting('npp.giao_cong_no', true) = 'on' THEN
    IF NEW.sales_user_id IS NOT NULL THEN NEW.ve_npp_luc := NULL; END IF;
    RETURN NEW;
  END IF;
  -- (mig 246) Dấu bàn giao chỉ RPC (cờ trên) đặt / xoá được.
  IF TG_OP = 'UPDATE' THEN
    NEW.giao_tu_nv := OLD.giao_tu_nv;
  ELSE
    NEW.giao_tu_nv := NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.ve_npp_luc IS NOT NULL THEN
    NEW.sales_user_id := OLD.sales_user_id;
    NEW.ve_npp_luc := OLD.ve_npp_luc;
    RETURN NEW;
  END IF;
  -- (mig 246) Nợ đã bàn giao: tính lại theo hoá đơn / phiếu trả (vẫn ghi NV giao) → giữ NV đang đứng tên.
  --   Chứng từ đổi sang người KHÁC (sửa người bán) → theo chứng từ như mig 194, bỏ dấu.
  IF TG_OP = 'UPDATE' AND OLD.giao_tu_nv IS NOT NULL THEN
    IF NEW.sales_user_id IS NOT DISTINCT FROM OLD.giao_tu_nv THEN
      NEW.sales_user_id := OLD.sales_user_id;
      RETURN NEW;
    END IF;
    IF NEW.sales_user_id IS DISTINCT FROM OLD.sales_user_id THEN
      NEW.giao_tu_nv := NULL;
    END IF;
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

-- Ghi thẳng cột dấu cũng qua trigger (để bị giữ nguyên).
DROP TRIGGER IF EXISTS trg_cong_no_giu_ve_npp ON public.receivables;
CREATE TRIGGER trg_cong_no_giu_ve_npp
  BEFORE INSERT OR UPDATE OF sales_user_id, ve_npp_luc, giao_tu_nv ON public.receivables
  FOR EACH ROW EXECUTE FUNCTION public._cong_no_giu_ve_npp();

-- reissue_invoice: tờ mới giữ cả DẤU BÀN GIAO của tờ cũ (cạnh người giữ nợ — mig 227).
DO $p$
DECLARE
  v_src text := pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure);
  v_a1 text := 'jsonb_build_object(''u'', rc227.sales_user_id, ''t'', rc227.ve_npp_luc)';
  v_b1 text := 'jsonb_build_object(''u'', rc227.sales_user_id, ''t'', rc227.ve_npp_luc, ''g'', rc227.giao_tu_nv /* (mig 246) dấu bàn giao nợ */)';
  v_a2 text := 've_npp_luc    = NULLIF(v227->>''t'', '''')::timestamptz';
  v_b2 text := 've_npp_luc    = NULLIF(v227->>''t'', '''')::timestamptz,' || chr(10)
            || '             giao_tu_nv    = NULLIF(v227->>''g'', '''')::uuid /* (mig 246) */';
  v_n1 int;
  v_n2 int;
BEGIN
  IF position('(mig 246)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 246: reissue_invoice đã chép dấu bàn giao nợ, bỏ qua ---';
    RETURN;
  END IF;
  v_n1 := (length(v_src) - length(replace(v_src, v_a1, ''))) / length(v_a1);
  v_n2 := (length(v_src) - length(replace(v_src, v_a2, ''))) / length(v_a2);
  IF v_n1 <> 1 OR v_n2 <> 1 THEN
    RAISE EXCEPTION '246: reissue_invoice thấy % / % chỗ cần vá, cần đúng 1 / 1 (chạy mig 227 trước)', v_n1, v_n2
      USING ERRCODE = 'P0001';
  END IF;
  EXECUTE replace(replace(v_src, v_a1, v_b1), v_a2, v_b2);
END;
$p$;

-- 2) Nhật ký bàn giao -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ban_giao_khach_log (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  nguon    text NOT NULL CHECK (nguon IN ('nv', 'chua_ai', 'tat_ca')),
  tu_nv    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  den_nv   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  kieu     text NOT NULL CHECK (kieu IN ('chung', 'chuyen')),
  bo_loc   jsonb NOT NULL DEFAULT '{}'::jsonb,
  khach    uuid[] NOT NULL DEFAULT '{}',
  ket_qua  jsonb NOT NULL DEFAULT '{}'::jsonb,
  tao_boi  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  tao_luc  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ban_giao_khach_log IS 'Nhật ký bàn giao khách giữa nhân viên (mig 246). Chỉ RPC ban_giao_khach ghi.';
CREATE INDEX IF NOT EXISTS idx_ban_giao_khach_log_org ON public.ban_giao_khach_log (org_id, tao_luc DESC);
ALTER TABLE public.ban_giao_khach_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ban_giao_khach_log_select ON public.ban_giao_khach_log;
CREATE POLICY ban_giao_khach_log_select ON public.ban_giao_khach_log
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'manager'));
REVOKE ALL ON public.ban_giao_khach_log FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ban_giao_khach_log FROM authenticated;
GRANT SELECT ON public.ban_giao_khach_log TO authenticated;

-- Đọc hàng trả theo khách (hàng khách đã lấy).
CREATE INDEX IF NOT EXISTS idx_returns_customer ON public.returns (customer_id);

-- 3) Bàn giao khách ----------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.ban_giao_khach(uuid, text, text, uuid, text[], uuid[], date, uuid[], boolean, boolean);
CREATE FUNCTION public.ban_giao_khach(
  p_den_nv      uuid,
  p_kieu        text    DEFAULT 'chung',
  p_nguon       text    DEFAULT 'nv',
  p_tu_nv       uuid    DEFAULT NULL,
  p_tuyen       text[]  DEFAULT NULL,
  p_ncc         uuid[]  DEFAULT NULL,
  p_tu_ngay     date    DEFAULT NULL,
  p_khach       uuid[]  DEFAULT NULL,
  p_giao_no_npp boolean DEFAULT true,
  p_thuc_hien   boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_org    uuid := public.user_org_id();
  v_uid    uuid := auth.uid();
  v_tuyen  text[] := COALESCE(p_tuyen, '{}');
  v_ncc    uuid[] := COALESCE(p_ncc, '{}');
  v_npp    boolean := COALESCE(p_giao_no_npp, true);
  v_rows   jsonb;
  v_ids    uuid[];
  v_moi    uuid[];
  v_chinh  uuid[];
  v_tong   jsonb;
  v_lich   int := 0;
  v_bo     int := 0;
  v_no_so  int := 0;
  v_no_tien numeric := 0;
  v_npp_so int := 0;
  v_npp_tien numeric := 0;
  v_kq     jsonb;
  v_log    uuid;
  v_ten_giao text;
  v_ten_nhan text;
BEGIN
  IF v_org IS NULL OR v_uid IS NULL OR public.user_role() NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'KHONG_DU_QUYEN: chỉ Chủ NPP / Quản lý được bàn giao khách' USING ERRCODE = 'P0001';
  END IF;
  IF p_kieu IS NULL OR p_kieu NOT IN ('chung', 'chuyen') THEN
    RAISE EXCEPTION 'KIEU_KHONG_HOP_LE: chọn Làm chung hoặc Chuyển hẳn' USING ERRCODE = 'P0001';
  END IF;
  IF p_nguon IS NULL OR p_nguon NOT IN ('nv', 'chua_ai', 'tat_ca') THEN
    RAISE EXCEPTION 'NGUON_KHONG_HOP_LE: chọn khách của một NV, khách chưa ai phụ trách hoặc mọi khách' USING ERRCODE = 'P0001';
  END IF;
  IF p_nguon = 'nv' AND p_tu_nv IS NULL THEN
    RAISE EXCEPTION 'CHON_NV_GIAO: chọn nhân viên giao khách' USING ERRCODE = 'P0001';
  END IF;
  IF p_kieu = 'chuyen' AND p_nguon <> 'nv' THEN
    RAISE EXCEPTION 'CHUYEN_CAN_NV_GIAO: chuyển hẳn chỉ làm được với khách của một nhân viên' USING ERRCODE = 'P0001';
  END IF;
  IF p_nguon = 'nv' AND p_tu_nv = p_den_nv THEN
    RAISE EXCEPTION 'CUNG_MOT_NV: nhân viên giao và nhân viên nhận là một người' USING ERRCODE = 'P0001';
  END IF;
  IF p_nguon = 'nv' THEN
    SELECT full_name INTO v_ten_giao FROM users WHERE id = p_tu_nv AND org_id = v_org;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'KHONG_TIM_THAY_NV_GIAO' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  SELECT full_name INTO v_ten_nhan FROM users
   WHERE id = p_den_nv AND org_id = v_org AND role = 'sales' AND COALESCE(is_active, true) AND left_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NV_NHAN_KHONG_HOP_LE: người nhận phải là nhân viên bán hàng đang làm' USING ERRCODE = 'P0001';
  END IF;

  IF p_thuc_hien THEN
    -- Hai lượt bàn giao cùng lúc của một NPP đi lần lượt, không đè nhau.
    PERFORM pg_advisory_xact_lock(hashtext('ban_giao_khach:' || v_org::text));
  END IF;

  WITH k AS (
    SELECT c.id, c.store_name, c.owner_name, c.phone, c.address, c.ward, c.channel, c.status,
           (SELECT ca.role FROM customer_assignments ca
             WHERE ca.customer_id = c.id AND ca.user_id = p_tu_nv AND ca.status = 'active') AS vai_giao,
           (SELECT ca.role FROM customer_assignments ca
             WHERE ca.customer_id = c.id AND ca.user_id = p_den_nv AND ca.status = 'active') AS vai_nhan,
           -- Đã có NV CHÍNH còn làm (không tính NV nhận) → làm chung thì NV nhận là phụ.
           EXISTS (SELECT 1 FROM customer_assignments ca JOIN users u ON u.id = ca.user_id
                    WHERE ca.customer_id = c.id AND ca.status = 'active' AND ca.role = 'primary'
                      AND ca.user_id <> p_den_nv AND u.left_at IS NULL AND COALESCE(u.is_active, true)) AS co_chinh
      FROM customers c
     WHERE c.org_id = v_org
       AND (p_khach IS NULL OR c.id = ANY (p_khach))
       AND (cardinality(v_tuyen) = 0
            OR COALESCE(NULLIF(btrim(c.channel), ''), '__chua_co_tuyen') = ANY (v_tuyen))
       AND CASE p_nguon
             WHEN 'nv' THEN EXISTS (SELECT 1 FROM customer_assignments ca
                                     WHERE ca.customer_id = c.id AND ca.user_id = p_tu_nv AND ca.status = 'active')
             -- Chưa ai phụ trách = không còn phân công nào của người CÒN LÀM.
             WHEN 'chua_ai' THEN NOT EXISTS (SELECT 1 FROM customer_assignments ca JOIN users u ON u.id = ca.user_id
                                     WHERE ca.customer_id = c.id AND ca.status = 'active'
                                       AND u.left_at IS NULL AND COALESCE(u.is_active, true))
             ELSE true
           END
       AND (cardinality(v_ncc) = 0 OR EXISTS (
             SELECT 1
               FROM sales_invoices i
               JOIN sales_invoice_lines l ON l.invoice_id = i.id
               JOIN products p ON p.id = l.product_id
              WHERE i.org_id = v_org AND i.customer_id = c.id AND i.status = 'posted' AND NOT l.is_exchange
                AND (p_tu_ngay IS NULL OR i.invoice_date >= p_tu_ngay)
                AND p.primary_supplier_id = ANY (v_ncc)))
  ), x AS (
    SELECT k.*,
           CASE WHEN p_kieu = 'chuyen'
                  THEN CASE WHEN k.vai_giao = 'primary' OR k.vai_nhan = 'primary' THEN 'primary' ELSE 'secondary' END
                WHEN k.vai_nhan IS NOT NULL THEN k.vai_nhan
                WHEN k.co_chinh THEN 'secondary'
                ELSE 'primary'
           END AS se_la
      FROM k
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', x.id, 'store_name', x.store_name, 'owner_name', x.owner_name, 'phone', x.phone,
           'address', x.address, 'ward', x.ward, 'channel', x.channel, 'status', x.status,
           'vai_giao', x.vai_giao, 'vai_nhan', x.vai_nhan, 'se_la', x.se_la,
           'nv_chinh', (SELECT string_agg(u.full_name, ', ' ORDER BY u.full_name)
                          FROM customer_assignments ca JOIN users u ON u.id = ca.user_id
                         WHERE ca.customer_id = x.id AND ca.status = 'active' AND ca.role = 'primary'),
           'no_chuyen', CASE WHEN p_kieu = 'chuyen' THEN (
               SELECT jsonb_build_object('so', count(*), 'tien', COALESCE(sum(COALESCE(rc.amount, 0) - COALESCE(rc.paid, 0)), 0))
                 FROM receivables rc
                WHERE rc.org_id = v_org AND rc.customer_id = x.id AND rc.sales_user_id = p_tu_nv AND rc.status <> 'paid')
             END,
           'no_npp', CASE WHEN v_npp AND x.se_la = 'primary' THEN (
               SELECT jsonb_build_object('so', count(*), 'tien', COALESCE(sum(COALESCE(rc.amount, 0) - COALESCE(rc.paid, 0)), 0))
                 FROM receivables rc
                WHERE rc.org_id = v_org AND rc.customer_id = x.id AND rc.ve_npp_luc IS NOT NULL AND rc.status <> 'paid')
             END,
           'lich', CASE WHEN p_nguon = 'nv' AND x.vai_nhan IS NULL THEN (
               SELECT COALESCE(jsonb_agg(DISTINCT pj.day_of_week ORDER BY pj.day_of_week), '[]'::jsonb)
                 FROM pjp_routes pj
                WHERE pj.org_id = v_org AND pj.sales_user_id = p_tu_nv AND pj.customer_id = x.id)
             END
         ) ORDER BY x.store_name, x.id), '[]'::jsonb)
    INTO v_rows
    FROM x;

  SELECT COALESCE(array_agg((e->>'id')::uuid), '{}'),
         COALESCE(array_agg((e->>'id')::uuid) FILTER (WHERE e->>'vai_nhan' IS NULL), '{}'),
         COALESCE(array_agg((e->>'id')::uuid) FILTER (WHERE e->>'se_la' = 'primary'), '{}')
    INTO v_ids, v_moi, v_chinh
    FROM jsonb_array_elements(v_rows) e;

  v_tong := (
    SELECT jsonb_build_object(
      'so_khach', count(*),
      'them_moi', count(*) FILTER (WHERE e->>'vai_nhan' IS NULL),
      'da_co', count(*) FILTER (WHERE e->>'vai_nhan' IS NOT NULL),
      'len_chinh', count(*) FILTER (WHERE e->>'se_la' = 'primary' AND COALESCE(e->>'vai_nhan', '') <> 'primary'),
      'no_chuyen', jsonb_build_object(
          'so', COALESCE(sum((e->'no_chuyen'->>'so')::int), 0),
          'tien', COALESCE(sum((e->'no_chuyen'->>'tien')::numeric), 0)),
      'no_npp', jsonb_build_object(
          'so', COALESCE(sum((e->'no_npp'->>'so')::int), 0),
          'tien', COALESCE(sum((e->'no_npp'->>'tien')::numeric), 0)),
      'lich', COALESCE((SELECT count(*) FROM pjp_routes pj
                         WHERE p_nguon = 'nv' AND pj.org_id = v_org AND pj.sales_user_id = p_tu_nv
                           AND pj.customer_id = ANY (v_moi)), 0),
      'bo_qua', CASE WHEN p_khach IS NULL THEN 0
                     ELSE (SELECT count(DISTINCT q) FROM unnest(p_khach) q) - count(*) END)
      FROM jsonb_array_elements(v_rows) e);

  IF NOT COALESCE(p_thuc_hien, false) THEN
    RETURN jsonb_build_object('khach', v_rows, 'tong', v_tong);
  END IF;

  IF cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'KHONG_CO_KHACH: không còn khách nào khớp để bàn giao' USING ERRCODE = 'P0001';
  END IF;

  -- NV nhận: thêm mới / bật lại phân công đã tắt / nâng vai (chuyển hẳn thay vai chính của NV giao).
  INSERT INTO customer_assignments AS ca (customer_id, user_id, role, status, assigned_at)
  SELECT (e->>'id')::uuid, p_den_nv, e->>'se_la', 'active', public.vn_today()
    FROM jsonb_array_elements(v_rows) e
   WHERE e->>'vai_nhan' IS NULL OR e->>'vai_nhan' IS DISTINCT FROM e->>'se_la'
  ON CONFLICT (customer_id, user_id) DO UPDATE
     SET role = EXCLUDED.role,
         assigned_at = CASE WHEN ca.status = 'active' THEN ca.assigned_at ELSE EXCLUDED.assigned_at END,
         status = 'active';

  -- Lịch đi tuyến của NV giao → NV nhận, chỉ với khách MỚI của NV nhận (khách đã có giữ lịch riêng của họ).
  --   Xếp sau các điểm NV nhận đã có trong cùng ngày.
  IF p_nguon = 'nv' AND cardinality(v_moi) > 0 THEN
    INSERT INTO pjp_routes (org_id, sales_user_id, day_of_week, customer_id, visit_order, is_active)
    SELECT v_org, p_den_nv, a.day_of_week, a.customer_id,
           COALESCE((SELECT max(b.visit_order) FROM pjp_routes b
                      WHERE b.sales_user_id = p_den_nv AND b.day_of_week = a.day_of_week), 0) + COALESCE(a.visit_order, 0),
           a.is_active
      FROM pjp_routes a
     WHERE a.org_id = v_org AND a.sales_user_id = p_tu_nv AND a.customer_id = ANY (v_moi)
    ON CONFLICT (sales_user_id, day_of_week, customer_id) DO NOTHING;
    GET DIAGNOSTICS v_lich = ROW_COUNT;
  END IF;

  IF p_kieu = 'chuyen' THEN
    DELETE FROM pjp_routes WHERE org_id = v_org AND sales_user_id = p_tu_nv AND customer_id = ANY (v_ids);
    DELETE FROM customer_assignments WHERE user_id = p_tu_nv AND customer_id = ANY (v_ids);
    GET DIAGNOSTICS v_bo = ROW_COUNT;

    -- Nợ chưa thu xong của NV giao → NV nhận, đánh dấu bàn giao (tính lại theo HĐ vẫn giữ NV nhận).
    --   Chuyển ngược về đúng người gốc thì bỏ dấu.
    PERFORM set_config('npp.giao_cong_no', 'on', true);
    WITH x AS (
      UPDATE receivables rc
         SET sales_user_id = p_den_nv,
             giao_tu_nv = NULLIF(COALESCE(rc.giao_tu_nv, p_tu_nv), p_den_nv)
       WHERE rc.org_id = v_org AND rc.customer_id = ANY (v_ids) AND rc.sales_user_id = p_tu_nv AND rc.status <> 'paid'
      RETURNING COALESCE(rc.amount, 0) - COALESCE(rc.paid, 0) AS con
    )
    SELECT count(*), COALESCE(sum(con), 0) INTO v_no_so, v_no_tien FROM x;
  END IF;

  -- Nợ NPP đang giữ (NV cũ nghỉ việc) của khách mà NV nhận làm phụ trách chính → NV nhận (như giao_cong_no_npp).
  IF v_npp AND cardinality(v_chinh) > 0 THEN
    PERFORM set_config('npp.giao_cong_no', 'on', true);
    WITH x AS (
      UPDATE receivables rc
         SET sales_user_id = p_den_nv
       WHERE rc.org_id = v_org AND rc.customer_id = ANY (v_chinh) AND rc.ve_npp_luc IS NOT NULL AND rc.status <> 'paid'
      RETURNING COALESCE(rc.amount, 0) - COALESCE(rc.paid, 0) AS con
    )
    SELECT count(*), COALESCE(sum(con), 0) INTO v_npp_so, v_npp_tien FROM x;
  END IF;
  PERFORM set_config('npp.giao_cong_no', '', true);

  v_kq := jsonb_build_object(
    'so_khach', cardinality(v_ids),
    'them_moi', (v_tong->>'them_moi')::int,
    'da_co', (v_tong->>'da_co')::int,
    'len_chinh', (v_tong->>'len_chinh')::int,
    'bo_khoi_nv_giao', v_bo,
    'lich', v_lich,
    'no_chuyen', jsonb_build_object('so', v_no_so, 'tien', v_no_tien),
    'no_npp', jsonb_build_object('so', v_npp_so, 'tien', v_npp_tien),
    'bo_qua', (v_tong->>'bo_qua')::int);

  INSERT INTO ban_giao_khach_log (org_id, nguon, tu_nv, den_nv, kieu, bo_loc, khach, ket_qua, tao_boi)
  VALUES (v_org, p_nguon, CASE WHEN p_nguon = 'nv' THEN p_tu_nv END, p_den_nv, p_kieu,
          jsonb_build_object('tuyen', to_jsonb(v_tuyen), 'ncc', to_jsonb(v_ncc), 'tu_ngay', p_tu_ngay, 'giao_no_npp', v_npp),
          v_ids, v_kq, v_uid)
  RETURNING id INTO v_log;

  -- Báo lên điện thoại: NV nhận (mở danh sách hàng khách đã lấy), NV giao khi chuyển hẳn.
  INSERT INTO notifications (org_id, user_id, type, title, body, link_url, metadata)
  VALUES (v_org, p_den_nv, 'info',
          'Bạn được giao ' || cardinality(v_ids) || ' khách',
          CASE p_nguon WHEN 'nv' THEN 'Từ ' || COALESCE(v_ten_giao, 'nhân viên khác')
                                    || CASE WHEN p_kieu = 'chuyen' THEN ' (chuyển hẳn)' ELSE ' (làm chung)' END
                       WHEN 'chua_ai' THEN 'Khách chưa có nhân viên phụ trách'
                       ELSE 'Làm chung với nhân viên đang phụ trách' END
          || CASE WHEN v_no_so + v_npp_so > 0 THEN ' · nhận ' || (v_no_so + v_npp_so) || ' khoản nợ' ELSE '' END,
          '/customers/hang-da-lay', jsonb_build_object('ban_giao_id', v_log));
  IF p_kieu = 'chuyen' THEN
    INSERT INTO notifications (org_id, user_id, type, title, body, link_url, metadata)
    VALUES (v_org, p_tu_nv, 'info',
            cardinality(v_ids) || ' khách của bạn đã chuyển cho ' || COALESCE(v_ten_nhan, 'nhân viên khác'),
            CASE WHEN v_no_so > 0 THEN 'Kèm ' || v_no_so || ' khoản nợ chưa thu' ELSE NULL END,
            '/customers', jsonb_build_object('ban_giao_id', v_log));
  END IF;

  RETURN v_kq || jsonb_build_object('log_id', v_log);
END;
$fn$;
REVOKE ALL ON FUNCTION public.ban_giao_khach(uuid, text, text, uuid, text[], uuid[], date, uuid[], boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ban_giao_khach(uuid, text, text, uuid, text[], uuid[], date, uuid[], boolean, boolean) TO authenticated;
COMMENT ON FUNCTION public.ban_giao_khach(uuid, text, text, uuid, text[], uuid[], date, uuid[], boolean, boolean) IS
  'Bàn giao khách giữa nhân viên: xem trước / thực hiện; làm chung hoặc chuyển hẳn (nợ theo NV nhận) — mig 246.';

-- 4) Hàng khách đã lấy -------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.hang_khach_da_lay(uuid, uuid[], date, text[]);
CREATE FUNCTION public.hang_khach_da_lay(
  p_nv    uuid   DEFAULT NULL,
  p_khach uuid[] DEFAULT NULL,
  p_tu    date   DEFAULT NULL,
  p_tuyen text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_org   uuid := public.user_org_id();
  v_uid   uuid := auth.uid();
  v_role  text := public.user_role();
  v_tuyen text[] := COALESCE(p_tuyen, '{}');
  v_nv    uuid;
  v_ids   uuid[];
BEGIN
  IF v_org IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION 'KHONG_DU_QUYEN' USING ERRCODE = 'P0001';
  END IF;
  IF v_role = 'sales' THEN
    v_nv := v_uid;  -- NVBH: chỉ khách + công ty của chính mình (bỏ qua p_nv).
  ELSIF v_role IN ('owner', 'manager', 'accountant') THEN
    v_nv := p_nv;
    IF v_nv IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = v_nv AND org_id = v_org) THEN
      RAISE EXCEPTION 'KHONG_TIM_THAY_NV' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    RAISE EXCEPTION 'KHONG_DU_QUYEN: vai này không xem hàng khách đã lấy' USING ERRCODE = 'P0001';
  END IF;

  -- Không chọn NV cũng không đưa danh sách khách → không đọc cả sổ.
  IF v_nv IS NULL AND p_khach IS NULL THEN
    RETURN jsonb_build_object('nv', NULL, 'khach', '[]'::jsonb, 'hang', '[]'::jsonb, 'sp', '[]'::jsonb, 'ncc', '[]'::jsonb);
  END IF;

  SELECT COALESCE(array_agg(c.id), '{}') INTO v_ids
    FROM customers c
   WHERE c.org_id = v_org
     AND (p_khach IS NULL OR c.id = ANY (p_khach))
     AND (v_nv IS NULL OR EXISTS (SELECT 1 FROM customer_assignments ca
                                   WHERE ca.customer_id = c.id AND ca.user_id = v_nv AND ca.status = 'active'))
     AND (cardinality(v_tuyen) = 0
          OR COALESCE(NULLIF(btrim(c.channel), ''), '__chua_co_tuyen') = ANY (v_tuyen));

  RETURN (
    WITH
    sp AS (
      -- Hàng của công ty NV làm + hàng chưa gán công ty (đúng phần NV ấy thấy — RLS sản phẩm mig 081).
      SELECT p.id, p.sku, p.name, p.base_unit, p.primary_supplier_id
        FROM products p
       WHERE p.org_id = v_org
         AND (v_nv IS NULL OR p.primary_supplier_id IS NULL
              OR EXISTS (SELECT 1 FROM user_suppliers us
                          WHERE us.user_id = v_nv AND us.supplier_id = p.primary_supplier_id))
    ),
    di AS (
      -- Hoá đơn đã ghi sổ; hệ số chụp trên dòng trước, rồi mới tra danh mục (cùng luật heSoQuyDoi).
      SELECT i.customer_id AS k, l.product_id AS p,
             sum(COALESCE(l.quantity, 0) * CASE
                   WHEN l.conversion_factor > 0 THEN l.conversion_factor
                   WHEN COALESCE(l.unit_name, '') = '' OR l.unit_name = s.base_unit THEN 1
                   ELSE COALESCE(NULLIF(u.conversion, 0), 1) END) AS sl,
             count(DISTINCT i.id) AS lan,
             max(i.invoice_date) AS cuoi
        FROM sales_invoices i
        JOIN sales_invoice_lines l ON l.invoice_id = i.id
        JOIN sp s ON s.id = l.product_id
        LEFT JOIN product_units u ON u.product_id = l.product_id AND u.unit_name = l.unit_name
       WHERE i.org_id = v_org AND i.status = 'posted' AND i.customer_id = ANY (v_ids)
         AND NOT l.is_exchange
         AND (p_tu IS NULL OR i.invoice_date >= p_tu)
       GROUP BY 1, 2
    ),
    tra AS (
      -- Hàng trả ĐÃ TRỪ (revenue_date có giá trị — mig 192); dòng trả không chụp hệ số → tra danh mục.
      SELECT r.customer_id AS k, rl.product_id AS p,
             sum(COALESCE(rl.quantity, 0) * CASE
                   WHEN COALESCE(rl.unit_name, '') = '' OR rl.unit_name = s.base_unit THEN 1
                   ELSE COALESCE(NULLIF(u.conversion, 0), 1) END) AS sl
        FROM returns r
        JOIN return_lines rl ON rl.return_id = r.id
        JOIN sp s ON s.id = rl.product_id
        LEFT JOIN product_units u ON u.product_id = rl.product_id AND u.unit_name = rl.unit_name
       WHERE r.org_id = v_org AND r.customer_id = ANY (v_ids)
         AND r.revenue_date IS NOT NULL
         AND (p_tu IS NULL OR r.revenue_date >= p_tu)
         AND NOT rl.is_exchange
       GROUP BY 1, 2
    ),
    hang AS (
      SELECT COALESCE(d.k, t.k) AS k, COALESCE(d.p, t.p) AS p,
             round(COALESCE(d.sl, 0), 3) AS di, round(COALESCE(t.sl, 0), 3) AS tra,
             COALESCE(d.lan, 0) AS lan, d.cuoi
        FROM di d FULL JOIN tra t ON t.k = d.k AND t.p = d.p
    )
    SELECT jsonb_build_object(
      'nv', v_nv,
      'khach', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', c.id, 'store_name', c.store_name, 'owner_name', c.owner_name, 'phone', c.phone,
                 'address', c.address, 'ward', c.ward, 'channel', c.channel, 'status', c.status,
                 'nv_chinh', (SELECT string_agg(us.full_name, ', ' ORDER BY us.full_name)
                                FROM customer_assignments ca JOIN users us ON us.id = ca.user_id
                               WHERE ca.customer_id = c.id AND ca.status = 'active' AND ca.role = 'primary'))
                 ORDER BY c.store_name, c.id)
          FROM customers c WHERE c.id = ANY (v_ids)), '[]'::jsonb),
      'hang', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('k', h.k, 'p', h.p, 'di', h.di, 'tra', h.tra, 'sl', h.di - h.tra,
                                            'lan', h.lan, 'cuoi', h.cuoi)
                         ORDER BY h.k, h.di - h.tra DESC, h.p)
          FROM hang h), '[]'::jsonb),
      'sp', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', s.id, 'sku', s.sku, 'name', s.name, 'base_unit', s.base_unit,
                                            'ncc', s.primary_supplier_id) ORDER BY s.name, s.id)
          FROM sp s WHERE s.id IN (SELECT h.p FROM hang h)), '[]'::jsonb),
      -- Công ty có hàng trong danh sách + công ty NV làm (để màn nói được "hàng các công ty …" kể cả khi chưa có hàng).
      'ncc', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name) ORDER BY n.name, n.id)
          FROM suppliers n
         WHERE n.org_id = v_org
           AND (n.id IN (SELECT s.primary_supplier_id FROM sp s WHERE s.id IN (SELECT h.p FROM hang h))
                OR (v_nv IS NOT NULL AND n.id IN (SELECT us.supplier_id FROM user_suppliers us WHERE us.user_id = v_nv)))),
        '[]'::jsonb)
    )
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.hang_khach_da_lay(uuid, uuid[], date, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hang_khach_da_lay(uuid, uuid[], date, text[]) TO authenticated;
COMMENT ON FUNCTION public.hang_khach_da_lay(uuid, uuid[], date, text[]) IS
  'Khách + hàng đã lấy (SL đơn vị cơ sở, HĐ ghi sổ − hàng trả đã trừ, bỏ hàng đổi); NVBH chỉ khách + công ty của mình — mig 246.';

NOTIFY pgrst, 'reload schema';

SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'receivables' AND column_name = 'giao_tu_nv') AS cot_dau_ban_giao,
  position('(mig 246)' IN pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure)) > 0 AS reissue_chep_dau,
  to_regclass('public.ban_giao_khach_log') IS NOT NULL AS bang_nhat_ky,
  to_regprocedure('public.ban_giao_khach(uuid, text, text, uuid, text[], uuid[], date, uuid[], boolean, boolean)') IS NOT NULL AS rpc_ban_giao,
  to_regprocedure('public.hang_khach_da_lay(uuid, uuid[], date, text[])') IS NOT NULL AS rpc_hang_da_lay;
