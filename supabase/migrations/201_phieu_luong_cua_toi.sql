-- ====================================================================
-- PHIẾU LƯƠNG CỦA TÔI — nhân viên xem phiếu lương của chính mình
--
-- VÌ SAO — chủ nhà 26/09/2026: "NV bán hàng chỉ cần Module bán hàng và - Xem được công nợ
--   của mình - Xem được báo cáo bán hàng của mình - Xem được phiếu lương của mình. Còn lại
--   bỏ hết".
--   Bảng lương (`payroll_runs`, `payroll_run_items`, mig 050) chỉ chủ / quản lý / kế toán
--   đọc được (RLS) — đúng, vì trong đó có lương của MỌI người. Mở RLS cho nhân viên là lộ
--   lương đồng nghiệp; hàm này chỉ trả DÒNG CỦA NGƯỜI GỌI, và chỉ ở kỳ đã CHỐT (`locked`) —
--   kỳ nháp còn đang tính, số chưa phải số trả.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.my_payslips()
RETURNS TABLE (
  payroll_run_id     uuid,
  month              date,
  locked_at          timestamptz,
  base_salary        numeric,
  standard_workdays  numeric,
  actual_workdays    numeric,
  prorated_base      numeric,
  allowances         jsonb,
  kpi_bonus          numeric,
  order_count_bonus  numeric,
  activity_bonus     numeric,
  overtime           numeric,
  deductions         numeric,
  social_insurance   numeric,
  manual_adjustment  numeric,
  net_salary         numeric,
  computed_breakdown jsonb,
  notes              text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT pr.id, pr.month, pr.locked_at,
         i.base_salary::numeric, i.standard_workdays::numeric, i.actual_workdays::numeric,
         i.prorated_base::numeric, to_jsonb(i.allowances), i.kpi_bonus::numeric,
         i.order_count_bonus::numeric, i.activity_bonus::numeric, i.overtime::numeric,
         i.deductions::numeric, i.social_insurance::numeric, i.manual_adjustment::numeric,
         i.net_salary::numeric, to_jsonb(i.computed_breakdown), i.notes
  FROM payroll_run_items i
  JOIN payroll_runs pr ON pr.id = i.payroll_run_id
  WHERE i.user_id = (SELECT auth.uid())
    AND pr.org_id = public.user_org_id()
    AND pr.status = 'locked'
  ORDER BY pr.month DESC
$fn$;

REVOKE ALL ON FUNCTION public.my_payslips() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_payslips() TO authenticated;

COMMENT ON FUNCTION public.my_payslips() IS
  'Phiếu lương của CHÍNH người gọi, chỉ kỳ đã chốt (mig 201) — màn Phiếu lương của tôi.';

NOTIFY pgrst, 'reload schema';

SELECT 'Phiếu lương của tôi' AS hang_muc,
       CASE WHEN to_regprocedure('public.my_payslips()') IS NOT NULL THEN 'có' ELSE 'CHƯA' END AS trang_thai,
       (SELECT count(*) FROM payroll_runs WHERE status = 'locked') AS so_ky_da_chot;
