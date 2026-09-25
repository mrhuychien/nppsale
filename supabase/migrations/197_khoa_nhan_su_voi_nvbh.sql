-- ====================================================================
-- NVBH KHÔNG ĐỌC ĐƯỢC LƯƠNG / THƯỞNG / CHẤM CÔNG CỦA NGƯỜI KHÁC
--
-- VÌ SAO — chủ nhà 25/09/2026: "Rà soát lại bảng phân quyền … Xây dựng cho tao phân
--   quyền mẫu cho nhân viên bán hàng: Đủ để nhân viên bán hàng; Không xem được các
--   thông tin quan trọng của nhà phân phối".
--   Rà ra ba bảng nhân sự có chính sách ĐỌC chỉ là `org_id = user_org_id()` — mọi tài
--   khoản của NPP (kể cả NVBH) gọi thẳng API là đọc được:
--     · hr_salary_config — lương cơ bản, phụ cấp, bậc thưởng KPI;
--     · hr_monthly_bonus — cơ chế thưởng tháng;
--     · hr_attendance    — chấm công của MỌI nhân viên.
--   Màn Nhân sự vốn đã ẩn với NVBH; đây là khoá ở tầng dữ liệu (quyền đổi qua RLS /
--   RPC, không tin trình duyệt). Mục tiêu doanh số NVBH cần thì đọc qua
--   `my_sales_target()` (mig 196) — một con số, không mở cả bảng.
--   Bảng lương (`hr_payroll`) đã đúng từ trước: chỉ của mình hoặc chủ / kế toán / quản lý.
-- ====================================================================

DROP POLICY IF EXISTS "View salary config" ON public.hr_salary_config;
CREATE POLICY "View salary config" ON public.hr_salary_config
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id()
         AND public.user_role() IN ('owner', 'manager', 'accountant'));

DROP POLICY IF EXISTS "View monthly bonus" ON public.hr_monthly_bonus;
CREATE POLICY "View monthly bonus" ON public.hr_monthly_bonus
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id()
         AND public.user_role() IN ('owner', 'manager', 'accountant'));

DROP POLICY IF EXISTS "View attendance" ON public.hr_attendance;
CREATE POLICY "View attendance" ON public.hr_attendance
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id()
         AND (user_id = (SELECT auth.uid())
              OR public.user_role() IN ('owner', 'manager', 'accountant')));

NOTIFY pgrst, 'reload schema';

SELECT tablename AS bang, policyname AS chinh_sach,
       CASE WHEN position('user_role()' IN qual) > 0 THEN 'đã khoá theo vai' ELSE 'CHƯA — ai trong NPP cũng đọc được' END AS trang_thai
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('hr_salary_config', 'hr_monthly_bonus', 'hr_attendance')
  AND cmd = 'SELECT'
ORDER BY 1;
