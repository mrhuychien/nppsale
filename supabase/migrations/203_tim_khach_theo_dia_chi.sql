-- ====================================================================
-- TÌM KHÁCH THEO CẢ ĐỊA CHỈ (kể cả gõ không dấu)
--
-- VÌ SAO — chủ nhà 26/09/2026: "Sửa ô tìm kiếm ở màn danh sách khách hàng: thêm cả địa chỉ".
--   Ô tìm khách hỏi `store_name / owner_name / phone` bằng `ilike` và cột bỏ dấu `tim_kd`
--   (mig 177). `tim_kd` của khách chưa có địa chỉ, nên thêm cột địa chỉ ở giao diện thì gõ
--   có dấu mới ra — gõ "hang kenh" không ra "Hàng Kênh". Ghép thêm địa chỉ, phường, quận,
--   tỉnh vào `tim_kd`, rồi điền lại cho dòng cũ.
-- ====================================================================

DROP TRIGGER IF EXISTS trg_tim_kd ON public.customers;
CREATE TRIGGER trg_tim_kd BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public._trg_tim_kd(
    'store_name', 'owner_name', 'phone', 'tax_code', 'address', 'ward', 'district', 'province');

-- Điền lại cho dòng cũ — trigger tự tính; chỉ chạm dòng lệch.
UPDATE public.customers SET tim_kd = NULL
 WHERE tim_kd IS DISTINCT FROM public.khong_dau(concat_ws(' ', '',
   store_name, owner_name, phone, tax_code, address, ward, district, province));

NOTIFY pgrst, 'reload schema';

SELECT 'Khách chưa có địa chỉ trong tim_kd' AS hang_muc,
       count(*) FILTER (WHERE COALESCE(address, '') <> ''
         AND tim_kd NOT LIKE '%' || public.khong_dau(address) || '%') AS so_dong,
       count(*) AS tong_khach
FROM public.customers;
