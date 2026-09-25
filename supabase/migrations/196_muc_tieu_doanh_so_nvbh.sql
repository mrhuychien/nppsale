-- ====================================================================
-- MỤC TIÊU DOANH SỐ CHO TRANG CHỦ NVBH
--
-- VÌ SAO — chủ nhà 25/09/2026: "Làm lại trang chủ cho nhân viên bán hàng theo mẫu"
--   (mẫu: "Doanh số của tôi … 75% · mục tiêu 80 tr · Còn 4 ngày · cần thêm 19,7 tr").
--   Mục tiêu tháng đang nằm ở cấu hình lương (`hr_salary_config.kpi_target_revenue`,
--   mig 061) — bảng nhân sự, NVBH không được đọc thẳng (lương / thưởng của NPP).
--   Hàm này chỉ trả ĐÚNG MỘT SỐ: mục tiêu tháng của đơn vị người gọi.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.my_sales_target()
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT COALESCE(max(c.kpi_target_revenue), 0)::numeric
  FROM hr_salary_config c
  WHERE c.org_id = public.user_org_id()
$fn$;

REVOKE ALL ON FUNCTION public.my_sales_target() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_sales_target() TO authenticated;

COMMENT ON FUNCTION public.my_sales_target() IS
  'Mục tiêu doanh số THÁNG của đơn vị người gọi (max kpi_target_revenue) — trang chủ NVBH (mig 196).';

NOTIFY pgrst, 'reload schema';

SELECT 'Mục tiêu doanh số trang chủ NVBH' AS hang_muc,
       CASE WHEN to_regprocedure('public.my_sales_target()') IS NOT NULL THEN 'có' ELSE 'CHƯA' END AS trang_thai;
