-- ====================================================================
-- 155_guard_sales_user_on_update
--
-- CANH `sales_user_id` CẢ KHI SỬA ĐƠN, KHÔNG CHỈ KHI LẬP ĐƠN.
--
-- Mig 153 dựng `trg_orders_guard_sales_user` chỉ ở `BEFORE INSERT`, vì
-- lúc ấy đường SỬA đơn không hề ghi cột này. Nay nó có ghi (chủ nhà báo
-- 21/09/2026: "Sửa -> gán nhân viên lưu lại đơn ko hiệu lực"), nên cái
-- lỗ mà mig 153 bịt ở đường tạo đơn đang mở toang ở đường sửa:
--
-- ⚠ RLS KHÔNG CANH CỘT NÀY KHI SỬA. `"Admin roles can update orders"`
--   (mig 119) chỉ đòi đúng đơn vị và vai trò owner/manager/warehouse —
--   `WITH CHECK (org_id = public.user_org_id())`, không một lời nào về
--   `sales_user_id`. Nghĩa là một tài khoản KHO sửa được đơn và gán
--   doanh số cho bất kỳ ai. Hoa hồng và lương đếm theo cột ấy.
--
--   (Vế NVBH thì RLS đã canh sẵn: `"Sales can update own open orders"`
--   có `WITH CHECK (sales_user_id = auth.uid())`, nên NVBH không đẩy
--   đơn sang tên người khác được. Thiếu đúng vế owner/manager/warehouse.)
--
-- ⚠ CHỈ CANH KHI CỘT THẬT SỰ ĐỔI. Một đơn cũ có thể đang đứng tên người
--   nay đã chuyển sang làm kho, hoặc đã nghỉ. Bắt mọi lần sửa đơn ấy
--   phải qua phép kiểm vai trò là KHOÁ CỨNG một đơn hợp lệ vì lý do
--   không liên quan gì tới lần sửa này.
--
-- ⚠ SỬA MÀ ĐỂ RỖNG THÌ GIỮ NGUYÊN NGƯỜI CŨ, KHÔNG GÁN NGƯỜI ĐANG SỬA.
--   Khác hẳn lúc INSERT. Nếu gán người đang sửa thì NPP mở một đơn của
--   nhân viên ra, bấm Lưu, là đơn nhảy sang tên NPP — đúng cái chủ nhà
--   vừa báo, chỉ ngược chiều. Và để `NULL` thì đơn thành một dòng doanh
--   số không ai nhận, chỉ lộ ra ở kỳ tính lương.
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

  -- ⚠ SỬA MÀ KHÔNG ĐỔI NGƯỜI ĐỨNG TÊN THÌ KHÔNG CÓ GÌ ĐỂ CANH. Xem đầu
  --   tệp: canh ở đây là khoá cứng những đơn cũ hợp lệ.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.sales_user_id IS NULL THEN
      NEW.sales_user_id := OLD.sales_user_id;
    END IF;
    IF NEW.sales_user_id IS NOT DISTINCT FROM OLD.sales_user_id THEN
      RETURN NEW;
    END IF;
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
  BEFORE INSERT OR UPDATE OF sales_user_id ON sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_sales_user();

COMMENT ON FUNCTION public.guard_order_sales_user() IS
  'Chỉ owner/manager được đặt sales_user_id khác chính mình; người được '
  'gán phải cùng org và có vai trò bán hàng. Canh cả INSERT lẫn UPDATE: '
  'RLS không nói gì về cột này ở cả hai chiều, mà hoa hồng và lương đếm '
  'theo nó. Sửa mà để rỗng thì giữ nguyên người cũ.';

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE v_n int; v_src text; v_thieu text := '';
BEGIN
  SELECT count(*) INTO v_n FROM pg_trigger
  WHERE tgname = 'trg_orders_guard_sales_user' AND NOT tgisinternal;
  IF v_n <> 1 THEN
    RAISE WARNING '--- 155 ⚠ trigger chưa dựng được ---';
    RETURN;
  END IF;

  -- ⚠ tgtype bit 2 = BEFORE, bit 4 = INSERT, bit 16 = UPDATE.
  SELECT CASE WHEN (tgtype & 4) > 0 AND (tgtype & 16) > 0 THEN 'ok' ELSE 'thieu' END
  INTO v_src FROM pg_trigger
  WHERE tgname = 'trg_orders_guard_sales_user' AND NOT tgisinternal;
  IF v_src <> 'ok' THEN
    v_thieu := v_thieu || ' [trigger không chạy đủ cả INSERT lẫn UPDATE]';
  END IF;

  SELECT pg_get_functiondef(pr.oid) INTO v_src
  FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public' AND pr.proname = 'guard_order_sales_user';
  IF position('OLD.sales_user_id' IN v_src) = 0 THEN
    v_thieu := v_thieu || ' [mất vế giữ nguyên người cũ khi sửa — đơn sẽ nhảy sang tên người đang sửa]';
  END IF;

  IF v_thieu = '' THEN
    RAISE NOTICE '--- 155: đổi người đứng tên đơn bị canh ở cả lập đơn lẫn sửa đơn ---';
  ELSE
    RAISE WARNING '--- 155 ⚠ THIẾU:% ---', v_thieu;
  END IF;
END $$;
