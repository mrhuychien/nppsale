-- ====================================================================
-- 153_order_sales_user_guard
--
-- NPP LẬP ĐƠN GIÚP NHÂN VIÊN — và chỉ NPP mới được làm việc đó.
--
-- ⚠ CHỦ NHÀ CHỐT 21/09/2026: "Thêm phần tạo đơn hàng giúp nhân viên cho
--   NPP. NPP tạo đơn xong chọn nhân viên -> thành đơn hàng của nhân
--   viên".
--
-- Trước migration này `sales_orders.sales_user_id` luôn bằng người đang
-- đăng nhập (`create.ts` gán cứng `ctx.userId`). Mở ô chọn ra là mở
-- luôn một lỗ, và lỗ ấy đụng TIỀN:
--
-- ⚠ RLS KHÔNG HỀ CANH CỘT NÀY. Chính sách INSERT của `sales_orders`
--   (mig 002) chỉ đòi `org_id` đúng và vai trò thuộc
--   (owner, manager, sales) — KHÔNG nói gì về `sales_user_id`. Nghĩa là
--   một nhân viên bán hàng gửi thẳng một đơn mang mã của đồng nghiệp
--   thì cơ sở dữ liệu nhận. Mà hoa hồng, doanh số, bảng lương đều đếm
--   theo cột ấy — đó là ghi doanh số của người này sang tên người khác.
--
-- ⚠ CHẶN Ở TRIGGER, KHÔNG CHẶN Ở GIAO DIỆN. Giao diện chỉ hiện ô chọn
--   cho NPP là đủ cho người dùng thật, nhưng `sales_orders` ghi trực
--   tiếp từ trình duyệt — ai gọi PostgREST bằng tay vẫn đi thẳng qua
--   giao diện. Luật về tiền phải nằm ở nơi không bỏ qua được.
--
-- ⚠ ĐỂ TRỐNG THÌ LÀ CHÍNH MÌNH. Giữ nguyên hành vi cũ cho mọi nơi gọi
--   chưa sửa, và cho đơn xếp hàng ngoại tuyến từ bản cũ.
--
-- ⚠ NGƯỜI ĐƯỢC GÁN PHẢI CÙNG ĐƠN VỊ VÀ CÓ VAI TRÒ BÁN HÀNG. Gán cho
--   một tài khoản kho hay một người ở đơn vị khác là dựng ra một dòng
--   doanh số không ai nhận, và nó chỉ lộ ra ở kỳ tính lương.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.guard_order_sales_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me   uuid := auth.uid();
  v_role text;
  u      record;
BEGIN
  -- ⚠ RPC `SECURITY DEFINER` tự chịu trách nhiệm phần của nó; cờ này là
  --   quy ước sẵn có của kho mã (xem mig 119/120).
  IF COALESCE(current_setting('npp.via_rpc', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  -- Không có phiên đăng nhập (seed, backfill, job) thì không canh được
  -- gì có ý nghĩa — để nguyên.
  IF v_me IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.sales_user_id IS NULL THEN
    NEW.sales_user_id := v_me;
    RETURN NEW;
  END IF;

  IF NEW.sales_user_id = v_me THEN
    RETURN NEW;
  END IF;

  v_role := public.user_role();
  IF v_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION
      'DON_HO_KHONG_DUOC_PHEP: chỉ chủ nhà phân phối hoặc quản lý mới lập đơn đứng tên nhân viên khác.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT us.id, us.org_id, us.role INTO u
  FROM users us WHERE us.id = NEW.sales_user_id;

  IF NOT FOUND OR u.org_id <> NEW.org_id THEN
    RAISE EXCEPTION
      'NHAN_VIEN_KHONG_HOP_LE: nhân viên được chọn không thuộc đơn vị này.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ⚠ CHỈ VAI TRÒ CÓ BÁN HÀNG. Gán cho tài khoản kho hay kế toán là
  --   dựng ra một dòng doanh số không ai nhận.
  IF u.role NOT IN ('sales', 'manager', 'owner') THEN
    RAISE EXCEPTION
      'NHAN_VIEN_KHONG_BAN_HANG: % không phải vai trò bán hàng, không đứng tên đơn được.',
      u.role USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_guard_sales_user ON sales_orders;
CREATE TRIGGER trg_orders_guard_sales_user
  BEFORE INSERT ON sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_sales_user();

COMMENT ON FUNCTION public.guard_order_sales_user() IS
  'Chỉ owner/manager được đặt sales_user_id khác chính mình; người được '
  'gán phải cùng org và có vai trò bán hàng. Hoa hồng và lương đếm theo '
  'cột này nên RLS không canh là ghi doanh số sang tên người khác.';

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_trigger
  WHERE tgname = 'trg_orders_guard_sales_user' AND NOT tgisinternal;
  IF v_n = 1 THEN
    RAISE NOTICE '--- 153: NPP lập đơn giúp nhân viên được, nhân viên thì không đổi tên người khác ---';
  ELSE
    RAISE WARNING '--- 153 ⚠ trigger chưa dựng được ---';
  END IF;
END $$;
