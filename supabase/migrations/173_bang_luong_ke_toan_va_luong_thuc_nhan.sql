-- ====================================================================
-- BẢNG LƯƠNG: KẾ TOÁN ĐƯỢC LÀM, VÀ LƯƠNG THỰC NHẬN DO MÁY CHỦ TÍNH
--
-- Rơi ra từ đợt QA 22/09/2026; chủ nhà chốt 23/09/2026: "fix".
--
-- ⚠ HAI LỖI:
--
--   1. QUYỀN LỆCH NHAU GIỮA CÁC LỚP. `compute_payroll_run` và
--      `lock_payroll_run` cho owner / manager / ACCOUNTANT; middleware `/hr`
--      cũng cho accountant. Nhưng RLS của `payroll_runs` và
--      `payroll_run_items` (mig 050) chỉ cho owner / manager — kế toán vào
--      `/hr/payroll/runs`, bấm Tính lương thì RPC chạy, còn đọc lại kỳ
--      lương thì RLS giấu hết, và sửa dòng lương thì bị từ chối.
--      Vai đúng là vai mà HAI RPC đã chọn: owner, manager, accountant.
--
--   2. LƯƠNG THỰC NHẬN TÍNH Ở TRÌNH DUYỆT. `setManualAdjustment`
--      (src/lib/payroll/run.ts) đọc dòng lương, tự cộng trừ, rồi ghi
--      `net_salary` xuống. Ai sửa được dòng lương là ghi được MỘT CON SỐ
--      BẤT KỲ vào cột lương thực nhận — nó không cần khớp với các khoản.
--      Nay trigger tính lại `net_salary` trên MỌI lần chèn / sửa, bằng
--      đúng công thức `compute_payroll_run` đang dùng; trình duyệt gửi gì
--      vào cột ấy cũng bị ghi đè.
--
-- ⚠ KỲ ĐÃ KHOÁ KHÔNG ĐỤNG TỚI. `trg_enforce_payroll_lock` chặn mọi lần sửa
--   dòng của kỳ đã khoá — đúng ý: phiếu lương đã chốt là chứng từ. Dòng
--   lệch ở kỳ khoá chỉ được ĐẾM ở bảng tóm tắt, không sửa.
-- ====================================================================

DROP POLICY IF EXISTS org_iso_pr ON payroll_runs;
CREATE POLICY org_iso_pr ON payroll_runs
  FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'manager', 'accountant'))
  WITH CHECK (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'manager', 'accountant'));

DROP POLICY IF EXISTS org_iso_pri ON payroll_run_items;
CREATE POLICY org_iso_pri ON payroll_run_items
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM payroll_runs pr
    WHERE pr.id = payroll_run_items.payroll_run_id
      AND pr.org_id = public.user_org_id()
      AND public.user_role() IN ('owner', 'manager', 'accountant')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM payroll_runs pr
    WHERE pr.id = payroll_run_items.payroll_run_id
      AND pr.org_id = public.user_org_id()
      AND public.user_role() IN ('owner', 'manager', 'accountant')
  ));


-- ---------------------------------------------------------------------
-- Lương thực nhận = tổng thu − tổng trừ, tính ở máy chủ
-- ---------------------------------------------------------------------
-- ⚠ CÙNG CÔNG THỨC VỚI `compute_payroll_run` (mig 096):
--     prorated_base + allowances + kpi_bonus + order_count_bonus
--   + activity_bonus + overtime + manual_adjustment
--   − deductions − social_insurance
CREATE OR REPLACE FUNCTION public._trg_tinh_luong_thuc_nhan()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.net_salary :=
      COALESCE(NEW.prorated_base, 0)
    + COALESCE(NEW.allowances, 0)
    + COALESCE(NEW.kpi_bonus, 0)
    + COALESCE(NEW.order_count_bonus, 0)
    + COALESCE(NEW.activity_bonus, 0)
    + COALESCE(NEW.overtime, 0)
    + COALESCE(NEW.manual_adjustment, 0)
    - COALESCE(NEW.deductions, 0)
    - COALESCE(NEW.social_insurance, 0);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tinh_luong_thuc_nhan ON payroll_run_items;
CREATE TRIGGER trg_tinh_luong_thuc_nhan
  BEFORE INSERT OR UPDATE ON payroll_run_items
  FOR EACH ROW EXECUTE FUNCTION public._trg_tinh_luong_thuc_nhan();

-- Kỳ CHƯA khoá: tính lại cho khớp (trigger ở trên làm việc ấy khi chạm dòng).
DROP TABLE IF EXISTS _173_lech;
CREATE TEMP TABLE _173_lech AS
SELECT i.id, pr.status = 'locked' AS da_khoa, i.net_salary AS cu,
       COALESCE(i.prorated_base,0) + COALESCE(i.allowances,0) + COALESCE(i.kpi_bonus,0)
     + COALESCE(i.order_count_bonus,0) + COALESCE(i.activity_bonus,0) + COALESCE(i.overtime,0)
     + COALESCE(i.manual_adjustment,0) - COALESCE(i.deductions,0) - COALESCE(i.social_insurance,0) AS dung
FROM payroll_run_items i JOIN payroll_runs pr ON pr.id = i.payroll_run_id;
DELETE FROM _173_lech WHERE cu = dung;

UPDATE payroll_run_items i SET updated_at = i.updated_at
FROM _173_lech l WHERE l.id = i.id AND NOT l.da_khoa;

DO $kiem$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tinh_luong_thuc_nhan'
                 AND tgrelid = 'payroll_run_items'::regclass) THEN
    RAISE EXCEPTION '173: thiếu trigger tính lương thực nhận' USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE '--- 173: kế toán làm được bảng lương; lương thực nhận do máy chủ tính ---';
END;
$kiem$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Bảng tóm tắt — thứ DUY NHẤT trình soạn SQL của Supabase hiện ra
-- ---------------------------------------------------------------------
SELECT 'Dòng lương kỳ CHƯA khoá vừa tính lại cho khớp các khoản' AS hang_muc,
       count(*) FILTER (WHERE NOT da_khoa)::text AS so_dong,
       coalesce(sum(dung - cu) FILTER (WHERE NOT da_khoa), 0)::text AS chenh_lech
FROM _173_lech
UNION ALL
SELECT 'Dòng lương kỳ ĐÃ KHOÁ lệch các khoản (KHÔNG sửa — cần người xem)',
       count(*) FILTER (WHERE da_khoa)::text,
       coalesce(sum(dung - cu) FILTER (WHERE da_khoa), 0)::text
FROM _173_lech;
