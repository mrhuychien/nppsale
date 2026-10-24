-- ====================================================================
-- SỐ PHIÊN SỔ KHÁCH BÁN HÀNG — POS / màn bán hàng dùng lại sổ khách đã lưu trên máy khi khách chưa đổi
--
-- VÌ SAO — chủ nhà 23/10/2026 "tốc độ load trang chậm lắm" → đợt 4 (24/10/2026 "lần lượt hoàn thành toàn bộ"):
--   POS / màn bán hàng mở là kéo CẢ sổ khách (≈570 KB với 3.000 khách) về máy dù sổ khách hầu như không đổi trong
--   ngày. Sản phẩm đã có số phiên (mig 209) để máy biết danh mục chưa đổi thì dùng lại bản lưu; sổ khách chưa có
--   nên vẫn tải lại mỗi lần. Nay thêm số phiên thứ hai `phien_khach` NGAY TRÊN DÒNG `danh_muc_ban_phien` — máy hỏi
--   MỘT câu là có cả hai số, không thêm vòng mạng.
--
-- LÀM GÌ
--   1. Cột `phien_khach bigint` + `luc_khach` trên bảng một dòng `danh_muc_ban_phien` (mig 209) — ai đăng nhập cũng
--      đọc được (chính sách SELECT của mig 209), không ai ghi thẳng được (REVOKE của mig 209 phủ cả cột mới).
--   2. Trigger MỨC CÂU LỆNH (một lần mỗi câu — nhập 3.000 khách là một lần tăng) `trg_phien_khach_ban` trên:
--      · `customers` (sổ khách), `customer_groups` (tên nhóm nằm trong sổ khách POS, nhóm = bảng giá),
--      · `customer_assignments` (NVBH thấy khách theo phân công — chính sách `customer_select`),
--      · `user_permission_overrides`, `role_permissions` (quyền `customer.view_all` mở cả sổ cho một người / một vai).
--      Thêm / sửa / xoá / truncate đều tăng số.
--   ⚠ KHÔNG gắn vào `sales_orders` (vế `user_sells_to_customer` của chính sách — đơn đứng tên NVBH cũng mở khách ấy):
--     tăng số mỗi đơn là bản lưu vô dụng; NVBH tự lên đơn thì đã thấy khách từ trước. Khách chỉ thấy qua đơn người
--     khác lập hộ sẽ hiện khi sổ khách có bất kỳ thay đổi nào, hoặc khi được phân công.
--   ⚠ `customers.debt` KHÔNG do trigger ghi (nợ tính từ `receivables`) nên bán hàng / thu tiền không làm số này nhảy.
--   ⚠ Idempotent: chạy lại không đổi gì thêm (hai số giữ nguyên, trigger không nhân đôi).
-- ====================================================================

ALTER TABLE public.danh_muc_ban_phien ADD COLUMN IF NOT EXISTS phien_khach bigint NOT NULL DEFAULT 1;
ALTER TABLE public.danh_muc_ban_phien ADD COLUMN IF NOT EXISTS luc_khach timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public._tang_phien_khach_ban()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  UPDATE public.danh_muc_ban_phien SET phien_khach = phien_khach + 1, luc_khach = now() WHERE id = 1;
  RETURN NULL;
END
$fn$;
-- Hàm trigger: không ai gọi thẳng qua /rpc (luật mig 166 / 207).
REVOKE EXECUTE ON FUNCTION public._tang_phien_khach_ban() FROM PUBLIC, anon, authenticated;

DO $trg$
DECLARE
  b text;
BEGIN
  FOREACH b IN ARRAY ARRAY['customers', 'customer_groups', 'customer_assignments', 'user_permission_overrides', 'role_permissions'] LOOP
    IF to_regclass('public.' || b) IS NULL THEN
      RAISE NOTICE 'mig 254: sổ không có bảng %, bỏ qua', b;
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_phien_khach_ban ON public.%I', b);
    EXECUTE format(
      'CREATE TRIGGER trg_phien_khach_ban AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I '
      'FOR EACH STATEMENT EXECUTE FUNCTION public._tang_phien_khach_ban()', b);
  END LOOP;
END
$trg$;

NOTIFY pgrst, 'reload schema';

SELECT 'Số phiên sổ khách bán hàng (mig 254)' AS hang_muc,
       (SELECT phien_khach FROM public.danh_muc_ban_phien WHERE id = 1) AS phien_khach,
       (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_phien_khach_ban' AND NOT tgisinternal) AS so_trigger;
