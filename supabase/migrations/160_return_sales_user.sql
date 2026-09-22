-- ====================================================================
-- PHIẾU TRẢ HÀNG ĐỨNG TÊN NHÂN VIÊN
--
-- Chủ nhà chốt 22/09/2026: "phần Trả hàng: phiếu do NPP lập có thể gán
-- được cho nhân viên".
--
-- Đây là bản sao của mig 153 cho `returns`, và nó có cùng một lý do.
--
-- VÌ SAO CẦN
--
--   `returns` chỉ có `requested_by` — NGƯỜI BẤM NÚT, không phải NGƯỜI
--   PHỤ TRÁCH KHÁCH. NPP ngồi văn phòng lập hộ một phiếu trả thì cả
--   phiếu ấy mang tên NPP, còn nhân viên đi tuyến — người thật sự đứng
--   ra nhận lại hàng — không có dòng nào.
--
-- ⚠ VÀ BÁO CÁO NHÂN VIÊN ĐANG PHẢI ĐOÁN. `reports/employees` hiện quy
--   phiếu trả về nhân viên bằng đường VÒNG: tìm các đơn của cùng khách
--   rồi lấy `sales_user_id` của đơn (xem `orderByCustomer` trong tệp
--   ấy). Khách mua của hai nhân viên khác nhau là phép đoán ấy sai, và
--   nó sai vào đúng con số trừ doanh số.
--
-- ⚠ KHÔNG ĐỤNG `requested_by`. Hai cột trả lời hai câu khác nhau: ai
--   GÕ phiếu, và phiếu tính cho AI. Gộp làm một là mất dấu vết người
--   thao tác — thứ duy nhất lần ra được khi một phiếu bị lập sai.
--
-- ⚠ RLS KHÔNG CANH CỘT NÀY, y như `sales_orders`. Chính sách INSERT của
--   `returns` chỉ đòi đúng `org_id` và vai trò thuộc nhóm; nó không nói
--   gì về việc phiếu đứng tên ai. Nghĩa là một nhân viên gửi thẳng
--   PostgREST một phiếu mang tên đồng nghiệp thì cơ sở dữ liệu nhận —
--   và đó là ghi khoản TRỪ doanh số sang tên người khác. Chặn ở
--   TRIGGER, không chặn ở giao diện: giao diện chỉ là lớp trên cùng.
--
-- ⚠ ĐỂ TRỐNG THÌ THEO ĐƠN GỐC, KHÔNG THEO NGƯỜI GÕ. Đây là chỗ bản đầu
--   của migration này SAI, và sai nặng hơn cả cái nó đi sửa.
--
--   Phiếu trả không chỉ sinh ra ở màn Trả hàng. Nó còn sinh ở:
--     · `createOrderRecords` — hàng trả gõ kèm lúc lập đơn.
--     · `order-edit.ts`      — hàng trả thêm vào lúc mở đơn ra sửa.
--     · màn bàn giao chuyến  — tài xế ghi hàng khách trả tại cửa.
--     · `reissue_invoice`    — mig 152 tự dựng phiếu trả khi xuất lại.
--   Bốn chỗ ấy KHÔNG có ô chọn người, và người bấm nút ở đó thường
--   không phải người phụ trách khách: NPP ngồi văn phòng, hay tài xế.
--   Lấy người gõ làm người đứng tên thì đơn tính cho nhân viên còn
--   phiếu trả tính cho NPP — doanh số một đằng, khoản trừ một nẻo.
--   Phép đoán cũ ít ra còn quy được về đúng người.
--
--   Nên: phiếu có `order_id` thì THEO `sales_orders.sales_user_id` của
--   đơn ấy. Đó không phải phỏng đoán — đơn đã ghi sẵn tên, phiếu chỉ
--   đọc lại.
--
-- ⚠ KHÔNG CÓ ĐƠN GỐC THÌ LÀ CHÍNH MÌNH — nhưng chỉ khi mình có bán
--   hàng. Mặc định sang một tài khoản kho hay kế toán là dựng ra đúng
--   "dòng trừ doanh số không ai nhận" mà khối kiểm bên dưới đang chặn.
--   Không ai nhận thì để rỗng, và rỗng đọc đúng là "chưa gán".
--
-- ⚠ PHIẾU CŨ ĐỂ RỖNG, KHÔNG BACKFILL. Đoán ngược "phiếu này chắc của
--   nhân viên X" từ đơn của cùng khách là ghi một con số phỏng đoán vào
--   sổ rồi quên mất rằng nó là phỏng đoán — đúng cái đường vòng mà
--   migration này sinh ra để bỏ. Rỗng đọc đúng là "chưa gán".
--
-- ⚠ ĐÁNH SỐ 160. Nhánh `newdesign` đang giữ 156, 157 và 159; `main`
--   giữ 158. Trùng số là hai tệp cùng số sau khi gộp.
-- ====================================================================

ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS sales_user_id uuid REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_returns_sales_user ON returns(sales_user_id);

COMMENT ON COLUMN returns.sales_user_id IS
  'Nhân viên phiếu trả này tính cho. Rỗng = chưa gán. KHÁC requested_by '
  '(người gõ phiếu). Báo cáo nhân viên đếm theo cột này.';

-- ---------------------------------------------------------------------
-- Ai được đặt cột này, và đặt cho ai
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_return_sales_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me   uuid := auth.uid();
  v_role text;
  v_ord  uuid;
  u      record;
BEGIN
  /**
   * ĐIỀN MẶC ĐỊNH — LÀM TRƯỚC, VÀ LÀM CHO CẢ ĐƯỜNG RPC.
   *
   * ⚠ Cờ `npp.via_rpc` miễn phần KIỂM QUYỀN, không miễn phần điền. RPC
   *   `SECURITY DEFINER` tự chịu trách nhiệm chọn ai đứng tên; nhưng
   *   `reissue_invoice` (mig 152) dựng phiếu trả mà không truyền cột
   *   này, và nếu khối điền nằm sau cờ thì phiếu ấy rỗng vĩnh viễn.
   */
  IF NEW.sales_user_id IS NULL THEN
    IF NEW.order_id IS NOT NULL THEN
      SELECT so.sales_user_id INTO v_ord
      FROM sales_orders so WHERE so.id = NEW.order_id;
      NEW.sales_user_id := v_ord;
    END IF;
    IF NEW.sales_user_id IS NULL
       AND v_me IS NOT NULL
       AND public.user_role() IN ('sales', 'manager', 'owner') THEN
      NEW.sales_user_id := v_me;
    END IF;
    RETURN NEW;
  END IF;

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

  IF NEW.sales_user_id = v_me THEN
    RETURN NEW;
  END IF;

  v_role := public.user_role();
  IF v_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION
      'PHIEU_TRA_HO_KHONG_DUOC_PHEP: chỉ chủ nhà phân phối hoặc quản lý mới lập phiếu trả đứng tên nhân viên khác.'
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
  --   dựng ra một dòng trừ doanh số không ai nhận.
  IF u.role NOT IN ('sales', 'manager', 'owner') THEN
    RAISE EXCEPTION
      'NHAN_VIEN_KHONG_BAN_HANG: % không phải vai trò bán hàng, không đứng tên phiếu trả được.',
      u.role USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- ⚠ CANH CẢ `UPDATE`, KHÔNG CHỈ `INSERT` — bài học của mig 155. Chặn
--   mỗi lúc chèn thì nhân viên lập phiếu đứng tên mình rồi `UPDATE` một
--   phát sang tên đồng nghiệp, và cửa sau ấy rộng y như cửa trước.
DROP TRIGGER IF EXISTS trg_returns_guard_sales_user ON returns;
CREATE TRIGGER trg_returns_guard_sales_user
  BEFORE INSERT OR UPDATE OF sales_user_id ON returns
  FOR EACH ROW EXECUTE FUNCTION public.guard_return_sales_user();

COMMENT ON FUNCTION public.guard_return_sales_user() IS
  'Để trống thì điền theo sales_user_id của đơn gốc, không có đơn gốc '
  'thì theo người đang gõ nếu người đó có vai trò bán hàng, không thì '
  'để rỗng. Đặt tay một tên khác chính mình thì chỉ owner/manager được, '
  'và người được gán phải cùng org, có vai trò bán hàng. Báo cáo nhân '
  'viên đếm theo cột này nên RLS không canh là ghi khoản trừ doanh số '
  'sang tên người khác.';

DO $$
DECLARE v_n int; v_cu int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_trigger
  WHERE tgname = 'trg_returns_guard_sales_user' AND NOT tgisinternal;
  SELECT count(*) INTO v_cu FROM returns WHERE sales_user_id IS NULL;
  IF v_n = 1 THEN
    RAISE NOTICE '--- 160: phiếu trả gán được cho nhân viên · % phiếu cũ để rỗng, chưa gán ---', v_cu;
  ELSE
    RAISE EXCEPTION '160: trigger canh người đứng tên phiếu trả KHÔNG được tạo';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
