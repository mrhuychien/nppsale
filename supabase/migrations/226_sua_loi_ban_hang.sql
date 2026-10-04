-- ====================================================================
-- 226 — SỬA LỖI BÁN HÀNG / ĐƠN HÀNG (đội test 04/10/2026)
--
-- VÌ SAO
--   · Quyền giảm giá — chủ nhà 24/09/2026 (mig 185): "Cho phép giảm giá, set tối đa theo % hoặc
--     giá trị (nếu để trống, ko giới hạn) chức năng này có thể bật/tắt tuỳ chỉnh cho từng nhân viên
--     bán hàng … Mặc định là tắt … Nhà phân phối thì toàn quyền giảm giá dòng và giảm giá đơn."
--     CLAUDE.md §Quyền: "Tiền … chỉ đổi qua RPC"; "Giảm giá: nhân viên theo users.allow_discount
--     + trần discount_max_* (mig 185); chủ NPP / kế toán toàn quyền".
--     LỖI: mig 185 chỉ thêm cột, KHÔNG hàm / trigger nào đọc chúng — luật chỉ nằm ở giao diện
--     (`kiemGiamGia`). NVBH tắt quyền vẫn ghi được dòng giảm 300.000 qua `create_order_with_lines`;
--     NVBH trần 10% ghi được giảm 50%; và hạ thẳng `unit_price` dưới giá bảng (line_discount = 0)
--     thì không ai chặn — đường lách quanh chính luật ấy.
--   · Ngày đặt đơn — CLAUDE.md: "so bằng ngày theo giờ VN". `sales_orders.order_date` mặc định
--     CURRENT_DATE = ngày UTC (máy chủ chạy UTC — mig 140): đơn tạo 00:00–07:00 giờ VN mang ngày
--     HÔM QUA, trong khi Tổng quan NVBH / báo cáo cuối ngày so order_date với ngày VN.
--   · Đơn GỬI THẲNG (INSERT status 'submitted' — đường chính của /sell và POS) không có mốc
--     `submitted_at` và không có dòng lịch sử 'submitted': trigger đóng mốc (mig 119/124) và trigger
--     ghi lịch sử chỉ chạy khi UPDATE status. Bước "Gửi đơn" trên dòng thời gian đơn trống giờ.
--   · Dòng đơn số lượng âm / 0 / đơn giá âm ghi được (không CHECK, RPC không kiểm) — dòng âm kéo
--     tổng đơn và số "Đặt hàng" xuống; dòng 0 là dòng ma.
--
-- CÁCH LÀM
--   1. `order_date DEFAULT public.vn_today()` (mig 140). KHÔNG đổi timezone cả DB (cảnh báo mig 140).
--      KHÔNG sửa ngày các đơn cũ — sổ dùng chung với production, cần chủ nhà quyết (bảng tóm tắt đếm).
--   2. Trigger INSERT trên sales_orders: đơn vào thẳng 'submitted' → đóng mốc submitted_at; đơn vào
--      ở trạng thái khác 'draft' → ghi một dòng order_status_history (draft → trạng thái ấy). KHÔNG
--      đoán mốc cho đơn cũ (luật mig 119).
--   3. Trigger `trg_quyen_gia_dong_don` (BEFORE INSERT/UPDATE/DELETE trên sales_order_lines) — bắt
--      cả đường RPC lẫn ghi thẳng qua RLS:
--        · SL > 0, đơn giá ≥ 0, giảm dòng ≥ 0 (mọi người).
--        · Giảm THẬT của dòng = MAX(line_discount, SL × (giá bảng − đơn giá)) — giá bảng tra theo
--          đúng đơn vị + nhóm giá của khách (`_gia_bang_don_vi`, cùng 4 bậc với `unitPriceFor`).
--          Bán dưới giá bảng mà ghi line_discount = 0 vẫn là giảm giá.
--        · Chủ NPP / kế toán: toàn quyền (như `userDiscountRulesFrom`). Người khác: tắt quyền thì
--          không được giảm; có trần thì ≤ trần (% trên tiền hàng dòng trước giảm, hoặc số đồng).
--        · SỬA dòng mà KHÔNG tăng khoản giảm so với dòng cũ (đơn NPP đã giảm) → cho qua — cùng luật
--          `giamGoc` / `giamDonGoc` ở giao diện.
--        · Dung sai SL × 0,5 + 1 đồng: đơn giá sau giảm làm tròn về đồng (`netPriceOf`).
--   4. Giảm giá CẢ ĐƠN (= Σ SL × đơn giá − subtotal, như `giamCuaChungTu`): constraint trigger
--      DEFERRABLE INITIALLY DEFERRED trên sales_orders (đơn mới: dòng hàng chèn SAU đầu đơn). Khoản
--      giảm gốc khi sửa đơn: ảnh chụp `giam_don_goc` lấy ở lần đổi dòng đầu tiên (ứng dụng sửa
--      dòng và sửa đầu đơn bằng hai lệnh rời — không ảnh chụp thì đã mất số cũ).
--   5. CHECK trên bảng khi sổ chưa có dòng vi phạm (có thì để chủ nhà xem trước — bảng tóm tắt).
--      ⚠ KHÔNG viết lại `create_order_with_lines`: thân đang chạy là bản 169 + vá chuỗi của mig 183
--        (thuế dòng). RPC chạy một giao dịch, trigger dòng nổ (câu BAD_PAYLOAD / DISCOUNT_* tiếng
--        Việt) là đầu đơn vừa chèn cũng không còn — đủ, không cần chép lại cả hàm.
--
-- ⚠ Hàm trigger SECURITY DEFINER nội bộ: REVOKE EXECUTE (luật mig 166).
-- ====================================================================

-- ── 1. Ngày đặt đơn theo lịch VN ─────────────────────────────────────────────────────────────────
ALTER TABLE public.sales_orders ALTER COLUMN order_date SET DEFAULT public.vn_today();

-- ── 2. Đơn gửi thẳng: mốc submitted_at + lịch sử ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._don_moi_moc_gui()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF NEW.status = 'submitted' AND NEW.submitted_at IS NULL THEN
    NEW.submitted_at := now();
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._don_moi_moc_gui() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_don_moi_moc_gui ON public.sales_orders;
CREATE TRIGGER trg_don_moi_moc_gui
  BEFORE INSERT ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public._don_moi_moc_gui();

-- SECURITY DEFINER: order_status_history không có chính sách INSERT cho người dùng (như
-- log_order_status_change). Người ghi: chỉ khi có hồ sơ users (khoá ngoại changed_by).
CREATE OR REPLACE FUNCTION public._don_moi_lich_su()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.status IS DISTINCT FROM 'draft' THEN
    INSERT INTO order_status_history (order_id, from_status, to_status, changed_by)
    VALUES (NEW.id, 'draft', NEW.status, (SELECT u.id FROM users u WHERE u.id = (SELECT auth.uid())));
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._don_moi_lich_su() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_don_moi_lich_su ON public.sales_orders;
CREATE TRIGGER trg_don_moi_lich_su
  AFTER INSERT ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public._don_moi_lich_su();

-- ── 3. Giá bảng của đúng (mặt hàng + đơn vị + nhóm giá) — cùng 4 bậc với `unitPriceFor` ───────────
--   Bảng giá nhóm → bảng giá chung → giá bán đơn vị cơ sở → giá cơ sở × hệ số. Trùng dòng giá thì
--   lấy giá THẤP nhất (không bao giờ chặt hơn màn hình). 0 = chưa có giá → không có sàn.
CREATE OR REPLACE FUNCTION public._gia_bang_don_vi(p_product uuid, p_unit text, p_nhom uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
DECLARE
  v numeric;
  v_co_so text;
  v_he_so numeric;
BEGIN
  IF p_nhom IS NOT NULL THEN
    SELECT min(pl.price) INTO v FROM price_lists pl
    WHERE pl.product_id = p_product AND pl.unit_name = p_unit AND pl.group_id = p_nhom;
    IF v IS NOT NULL THEN RETURN v; END IF;
  END IF;
  SELECT min(pl.price) INTO v FROM price_lists pl
  WHERE pl.product_id = p_product AND pl.unit_name = p_unit AND pl.group_id IS NULL;
  IF v IS NOT NULL THEN RETURN v; END IF;

  SELECT p.base_unit, COALESCE(p.sell_price, 0) INTO v_co_so, v FROM products p WHERE p.id = p_product;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF p_unit = v_co_so THEN RETURN v; END IF;

  SELECT pu.conversion INTO v_he_so FROM product_units pu
  WHERE pu.product_id = p_product AND pu.unit_name = p_unit;
  IF v_he_so IS NOT NULL AND p_unit IS DISTINCT FROM v_co_so THEN
    v := public._gia_bang_don_vi(p_product, v_co_so, p_nhom);
    IF v > 0 THEN RETURN v * v_he_so; END IF;
  END IF;
  RETURN 0;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._gia_bang_don_vi(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- Khoản giảm CẢ ĐƠN hiện có trên sổ — cùng luật `giamCuaChungTu`: Σ SL × đơn giá (dòng SL > 0) −
-- subtotal; chênh ≤ MAX(1, số dòng) là sai số làm tròn, coi như không giảm.
CREATE OR REPLACE FUNCTION public._giam_don_hien_tai(p_order uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  WITH d AS (
    SELECT round(COALESCE(sum(l.quantity * l.unit_price), 0)) AS tien, count(*) AS n
    FROM sales_order_lines l WHERE l.order_id = p_order AND l.quantity > 0
  )
  SELECT CASE WHEN d.tien - round(COALESCE(so.subtotal, 0)) > GREATEST(1, d.n)
              THEN d.tien - round(COALESCE(so.subtotal, 0)) ELSE 0 END
  FROM sales_orders so, d
  WHERE so.id = p_order
$fn$;
REVOKE EXECUTE ON FUNCTION public._giam_don_hien_tai(uuid) FROM PUBLIC, anon, authenticated;

-- Ảnh chụp khoản giảm đơn TRƯỚC lần sửa dòng — chỉ hàm trigger đọc/ghi (RLS bật, không chính sách).
CREATE TABLE IF NOT EXISTS public.giam_don_goc (
  order_id uuid PRIMARY KEY REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  giam     numeric NOT NULL DEFAULT 0,
  chup_luc timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.giam_don_goc ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.giam_don_goc FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.giam_don_goc IS
  'Mig 226: khoản giảm cả đơn trước lần sửa dòng đầu tiên, để trigger quyền giảm đơn so với số cũ. Trigger tự xoá khi đầu đơn lưu xong.';

-- Người đang ghi được toàn quyền giá không? (chủ NPP / kế toán — như `userDiscountRulesFrom`).
-- Không có phiên (máy chủ / migration / cron) cũng coi là toàn quyền.
CREATE OR REPLACE FUNCTION public._quyen_giam_cua(p_uid uuid)
RETURNS TABLE (toan_quyen boolean, duoc_giam boolean, loai_tran text, tran numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT COALESCE(u.role IN ('owner', 'accountant'), true) OR p_uid IS NULL,
         COALESCE(u.allow_discount, false),
         COALESCE(u.discount_max_type, 'pct'),
         u.discount_max_value
  FROM (SELECT 1) x
  LEFT JOIN users u ON u.id = p_uid
$fn$;
REVOKE EXECUTE ON FUNCTION public._quyen_giam_cua(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._nhan_tran_giam(p_loai text, p_tran numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE WHEN p_loai = 'vnd'
              THEN 'tối đa ' || replace(to_char(round(p_tran), 'FM999,999,999,999'), ',', '.') || 'đ'
              ELSE 'tối đa ' || replace(trim_scale(p_tran)::text, '.', ',') || '%' END
$fn$;
REVOKE EXECUTE ON FUNCTION public._nhan_tran_giam(text, numeric) FROM PUBLIC, anon, authenticated;

-- ── 3b. Trigger dòng đơn ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._chot_gia_dong_don()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_order  uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  q        record;
  v_nhom   uuid;
  v_bang   numeric;
  v_giam   numeric;
  v_goc    numeric := 0;
  v_tien   numeric;
  v_tran   numeric;
  v_sai    numeric;
BEGIN
  -- (a) Chỉ kiểm khi dòng mới / xoá, hoặc đổi thứ ảnh hưởng tiền. Cập nhật `invoiced_qty` của RPC xuất
  --     hàng không đụng giá — cho qua, kể cả dòng cũ của sổ.
  IF TG_OP = 'UPDATE'
     AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity
     AND NEW.unit_price IS NOT DISTINCT FROM OLD.unit_price
     AND NEW.line_discount IS NOT DISTINCT FROM OLD.line_discount
     AND NEW.product_id IS NOT DISTINCT FROM OLD.product_id
     AND NEW.unit_name IS NOT DISTINCT FROM OLD.unit_name THEN
    RETURN NEW;
  END IF;

  SELECT * INTO q FROM public._quyen_giam_cua((SELECT auth.uid()));

  -- (b) Ảnh chụp giảm đơn gốc TRƯỚC lần đổi dòng đầu tiên của người BỊ GIỚI HẠN quyền, kể từ lần
  --     đầu đơn lưu gần nhất (trigger đầu đơn xoá ảnh khi lưu xong). Ứng dụng sửa dòng và sửa đầu
  --     đơn bằng hai lệnh RỜI — tới lúc đầu đơn lưu thì dòng đã đổi, không còn cách nào khác biết
  --     khoản giảm cũ.
  IF NOT q.toan_quyen
     AND NOT EXISTS (SELECT 1 FROM giam_don_goc g WHERE g.order_id = v_order)
     AND EXISTS (SELECT 1 FROM sales_orders so WHERE so.id = v_order AND so.status IN ('draft', 'submitted')) THEN
    INSERT INTO giam_don_goc (order_id, giam)
    VALUES (v_order, COALESCE(public._giam_don_hien_tai(v_order), 0))
    ON CONFLICT (order_id) DO NOTHING;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'BAD_PAYLOAD: số lượng của dòng hàng phải lớn hơn 0 (bỏ dòng thay vì để 0).'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.unit_price IS NULL OR NEW.unit_price < 0 THEN
    RAISE EXCEPTION 'BAD_PAYLOAD: đơn giá của dòng hàng không được âm.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(NEW.line_discount, 0) < 0 THEN
    RAISE EXCEPTION 'BAD_PAYLOAD: giảm giá dòng không được âm.' USING ERRCODE = 'P0001';
  END IF;

  -- (c) Quyền giảm giá (mig 185).
  IF q.toan_quyen THEN RETURN NEW; END IF;

  SELECT c.group_id INTO v_nhom
  FROM sales_orders so JOIN customers c ON c.id = so.customer_id
  WHERE so.id = NEW.order_id;
  v_bang := COALESCE(public._gia_bang_don_vi(NEW.product_id, NEW.unit_name, v_nhom), 0);

  -- Giảm THẬT: phần ghi ở line_discount, hoặc phần đơn giá thấp hơn giá bảng — lấy số lớn hơn.
  v_giam := GREATEST(COALESCE(NEW.line_discount, 0),
                     CASE WHEN v_bang > 0 THEN NEW.quantity * (v_bang - NEW.unit_price) ELSE 0 END, 0);
  IF TG_OP = 'UPDATE' AND OLD.product_id = NEW.product_id AND OLD.unit_name = NEW.unit_name THEN
    v_goc := GREATEST(COALESCE(OLD.line_discount, 0),
                      CASE WHEN v_bang > 0 THEN OLD.quantity * (v_bang - OLD.unit_price) ELSE 0 END, 0);
  END IF;
  v_sai := NEW.quantity * 0.5 + 1;

  -- Không tăng khoản giảm đã có (đơn NPP đã giảm) → cho qua.
  IF v_giam <= v_goc + v_sai THEN RETURN NEW; END IF;

  IF NOT q.duoc_giam THEN
    RAISE EXCEPTION 'DISCOUNT_NOT_ALLOWED: Bạn không có quyền giảm giá dòng (kể cả bán dưới giá bảng) — bỏ giảm giá ở các dòng rồi gửi lại.'
      USING ERRCODE = 'P0001';
  END IF;
  IF q.tran IS NOT NULL THEN
    v_tien := NEW.quantity * NEW.unit_price + v_giam;
    v_tran := CASE WHEN q.loai_tran = 'vnd' THEN q.tran
                   ELSE floor(v_tien * LEAST(100, q.tran) / 100) END;
    IF v_giam > v_tran + v_sai THEN
      RAISE EXCEPTION 'DISCOUNT_OVER_LIMIT: Giảm giá dòng vượt mức cho phép (%).', public._nhan_tran_giam(q.loai_tran, q.tran)
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._chot_gia_dong_don() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_quyen_gia_dong_don ON public.sales_order_lines;
CREATE TRIGGER trg_quyen_gia_dong_don
  BEFORE INSERT OR UPDATE OR DELETE ON public.sales_order_lines
  FOR EACH ROW EXECUTE FUNCTION public._chot_gia_dong_don();

-- ── 4. Giảm giá cả đơn — kiểm lúc chốt giao dịch ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._chot_giam_don()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  q       record;
  v_status text;
  v_giam  numeric;
  v_goc   numeric;
  v_tien  numeric;
  v_n     bigint;
  v_tran  numeric;
BEGIN
  -- Ảnh chụp chỉ sống tới khi đầu đơn lưu xong — đọc rồi xoá, với MỌI người ghi.
  DELETE FROM giam_don_goc g WHERE g.order_id = NEW.id RETURNING g.giam INTO v_goc;

  SELECT * INTO q FROM public._quyen_giam_cua((SELECT auth.uid()));
  IF q.toan_quyen THEN RETURN NULL; END IF;

  SELECT so.status INTO v_status FROM sales_orders so WHERE so.id = NEW.id;
  IF v_status IS NULL OR v_status NOT IN ('draft', 'submitted') THEN RETURN NULL; END IF;

  v_giam := COALESCE(public._giam_don_hien_tai(NEW.id), 0);
  IF TG_OP = 'INSERT' THEN
    v_goc := 0;
  ELSIF v_goc IS NULL THEN
    -- Không đổi dòng nào từ lần lưu trước: dòng hiện tại + subtotal CŨ cho đúng khoản giảm cũ.
    SELECT CASE WHEN round(COALESCE(sum(l.quantity * l.unit_price), 0)) - round(COALESCE(OLD.subtotal, 0)) > GREATEST(1, count(*))
                THEN round(COALESCE(sum(l.quantity * l.unit_price), 0)) - round(COALESCE(OLD.subtotal, 0)) ELSE 0 END
      INTO v_goc
    FROM sales_order_lines l WHERE l.order_id = NEW.id AND l.quantity > 0;
  END IF;
  IF v_giam <= GREATEST(COALESCE(v_goc, 0), 0) THEN RETURN NULL; END IF;

  IF NOT q.duoc_giam THEN
    RAISE EXCEPTION 'DISCOUNT_NOT_ALLOWED: Bạn không có quyền giảm giá đơn.' USING ERRCODE = 'P0001';
  END IF;
  IF q.tran IS NOT NULL THEN
    -- Nền trần = TIỀN GỘP (trước giảm dòng), cùng nền với `cartTotals` / POS.
    SELECT COALESCE(sum(l.quantity * l.unit_price + COALESCE(l.line_discount, 0)), 0), count(*)
      INTO v_tien, v_n
    FROM sales_order_lines l WHERE l.order_id = NEW.id AND l.quantity > 0;
    v_tran := CASE WHEN q.loai_tran = 'vnd' THEN q.tran
                   ELSE floor(v_tien * LEAST(100, q.tran) / 100) END;
    IF v_giam > v_tran + v_n + 1 THEN
      RAISE EXCEPTION 'DISCOUNT_OVER_LIMIT: Giảm giá đơn vượt mức cho phép (%).', public._nhan_tran_giam(q.loai_tran, q.tran)
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._chot_giam_don() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_quyen_giam_don ON public.sales_orders;
-- ⚠ WHEN: chỉ xếp hàng sự kiện khi có phiên người dùng và đơn còn sửa được. Ghi của máy chủ /
--   migration / kịch bản dựng dữ liệu (không phiên) không để lại sự kiện treo — sự kiện treo làm
--   `ALTER TABLE sales_orders` cùng giao dịch nổ "pending trigger events".
CREATE CONSTRAINT TRIGGER trg_quyen_giam_don
  AFTER INSERT OR UPDATE OF subtotal ON public.sales_orders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.status IN ('draft', 'submitted') AND auth.uid() IS NOT NULL)
  EXECUTE FUNCTION public._chot_giam_don();

-- ── 5. CHECK trên bảng — chỉ khi sổ sạch (có dòng vi phạm thì để chủ nhà xem trước) ──────────────
DO $chk$
DECLARE v_xau bigint;
BEGIN
  SELECT count(*) INTO v_xau FROM public.sales_order_lines
  WHERE quantity <= 0 OR unit_price < 0 OR line_discount < 0;
  IF v_xau > 0 THEN
    RAISE NOTICE '226: % dòng đơn cũ vi phạm (SL <= 0 / giá âm / giảm âm) — CHƯA thêm CHECK, trigger vẫn chặn dòng mới.', v_xau;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_order_lines_quantity_duong_check') THEN
    ALTER TABLE public.sales_order_lines
      ADD CONSTRAINT sales_order_lines_quantity_duong_check CHECK (quantity > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_order_lines_unit_price_khong_am_check') THEN
    ALTER TABLE public.sales_order_lines
      ADD CONSTRAINT sales_order_lines_unit_price_khong_am_check CHECK (unit_price >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_order_lines_line_discount_khong_am_check') THEN
    ALTER TABLE public.sales_order_lines
      ADD CONSTRAINT sales_order_lines_line_discount_khong_am_check CHECK (line_discount IS NULL OR line_discount >= 0);
  END IF;
END;
$chk$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Bảng tóm tắt.
-- ---------------------------------------------------------------------
SELECT 'mig 226: ngày đơn theo giờ VN' AS hang_muc,
       CASE WHEN (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
                  JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                  WHERE d.adrelid = 'public.sales_orders'::regclass AND a.attname = 'order_date') ILIKE '%vn_today%'
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua,
       (SELECT count(*) FROM sales_orders
        WHERE order_date <> (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)::text
         || ' đơn có ngày đặt khác ngày tạo theo giờ VN (không tự sửa — chờ chủ nhà)' AS ghi_chu
UNION ALL
SELECT 'mig 226: đơn gửi thẳng có mốc + lịch sử',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_don_moi_moc_gui')
             AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_don_moi_lich_su')
            THEN 'OK' ELSE 'THIẾU' END,
       (SELECT count(*) FROM sales_orders WHERE status <> 'draft' AND submitted_at IS NULL)::text
         || ' đơn cũ không có submitted_at (không đoán — luật mig 119)'
UNION ALL
SELECT 'mig 226: quyền giảm giá dòng + đơn ở máy chủ',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_quyen_gia_dong_don')
             AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_quyen_giam_don')
            THEN 'OK' ELSE 'THIẾU' END,
       (SELECT count(*) FROM users WHERE role NOT IN ('owner', 'accountant') AND allow_discount)::text
         || ' nhân viên đang bật quyền giảm giá'
UNION ALL
SELECT 'mig 226: dòng đơn SL > 0, giá / giảm không âm',
       CASE WHEN (SELECT count(*) FROM pg_constraint WHERE conname IN (
                    'sales_order_lines_quantity_duong_check', 'sales_order_lines_unit_price_khong_am_check',
                    'sales_order_lines_line_discount_khong_am_check')) = 3
            THEN 'OK' ELSE 'CHƯA CHECK' END,
       (SELECT count(*) FROM sales_order_lines WHERE quantity <= 0 OR unit_price < 0 OR line_discount < 0)::text
         || ' dòng cũ vi phạm';
