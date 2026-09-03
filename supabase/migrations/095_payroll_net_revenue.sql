-- ====================================================================
-- 095 — Doanh số tính lương chuyển sang DOANH SỐ THUẦN (trừ hàng trả lại)
--
-- Chủ NPP đã chốt: lương trả trên doanh số thuần, không phải doanh số gộp.
-- Trước migration này, bảng lương cộng thẳng sales_orders.total còn báo cáo
-- nhân viên thì có trừ hàng trả — hai màn hình cùng ghi "doanh số của NV X"
-- ra hai con số khác nhau.
--
-- BỐN QUYẾT ĐỊNH, ĐỀU ĐÃ CHẠY THỬ TRÊN POSTGRES 16
--
--  1. TRỪ BAO NHIÊU → returns.credit_note_amount
--     Không tự cộng lại return_lines. Trigger trg_return_lines_sync_credit
--     (mig 035:44) đã giữ credit_note_amount = SUM(line_total) WHERE
--     is_exchange = false, tức ĐÃ tự loại dòng đổi hàng. Đổi hàng là giao
--     hàng khác thay thế, khách không được hoàn tiền, nên không phải khoản
--     giảm doanh số.
--     Chạy thử: phiếu trả 10 hộp đổi (100.000) + 3 hộp trả (30.000)
--     → trừ 30.000, không trừ 130.000.
--     Phiếu trả tạo tay ở /returns/new không có dòng nào; trigger không
--     chạy, credit_note_amount là số kế toán gõ (có thể NULL → COALESCE 0).
--
--  2. PHIẾU NÀO TÍNH → status IN ('approved','completed')
--     Đúng bằng bộ lọc công nợ đang dùng (src/lib/returns.ts:220) và báo
--     cáo nhân viên (src/lib/analytics/sales.ts:162). Phiếu 'pending' mới
--     là đề nghị, 'rejected' đã bị từ chối — trừ vào lương là trừ oan.
--
--  3. QUY VỀ NHÂN VIÊN NÀO → theo đơn gốc, thiếu thì theo đơn gần nhất
--     Bảng returns KHÔNG có cột sales_user_id (001_schema.sql:328). Có
--     order_id thì lấy sales_orders.sales_user_id — chính xác tuyệt đối.
--     Phiếu tạo tay ở /returns/new không gắn order_id
--     (returns/new/page.tsx:50-59) nên phải suy ra: lấy NV của đơn GẦN
--     NHẤT phục vụ khách đó TÍNH ĐẾN NGÀY TẠO PHIẾU.
--     Khác báo cáo nhân viên một điểm CÓ CHỦ ĐÍCH: báo cáo lấy đơn mới
--     nhất bất kể thời gian (reports/employees/page.tsx:321-322), nên một
--     phiếu trả tháng 4 có thể bị quy cho NV mới nhận khách vào tháng 6 —
--     trừ tiền người chưa từng bán đơn đó. Ở đây chặn bằng
--     `order_date <= ngày tạo phiếu`.
--
--  4. TÍNH VÀO KỲ NÀO → theo ngày tạo phiếu, GIỜ VIỆT NAM
--     Phiếu trả tháng 5 cho đơn tháng 4 trừ vào kỳ THÁNG 5. Nếu trừ ngược
--     vào tháng 4 thì kỳ lương đã chốt/đã khoá phải tính lại — không làm
--     được, và cũng không đúng: tiền tháng 4 đã trả rồi.
--
--     CÁI BẪY MÚI GIỜ: returns.created_at là timestamptz còn database chạy
--     UTC. `created_at::date` cho phiếu tạo lúc 3h sáng ngày 1/5 giờ Việt
--     Nam ra ngày 30/4 — rơi nhầm sang kỳ trước, kỳ có thể đã khoá.
--     Đã chạy thử: cùng bộ dữ liệu, dùng ::date theo UTC trừ nhầm
--     34.000.000 vào tháng 4 thay vì 25.000.000.
--     Phải AT TIME ZONE 'Asia/Ho_Chi_Minh' trước khi ::date.
--
--  CHẶN SỐ ÂM (bắt buộc, không phải tuỳ chọn)
--     Doanh số thuần có thể âm khi khách trả hàng của tháng trước. Công
--     thức nhánh dưới 60% là `lương = doanh số × under_60_percent`, nên
--     doanh số -40tr cho ra lương cơ bản -400.000, BHXH -42.000 và thực
--     lĩnh -358.000 đ — công ty ghi nhận nhân viên NỢ lương. Đã chạy thử
--     ra đúng con số đó. Kẹp doanh số về 0; số thật vẫn ghi trong
--     breakdown (revenue_net_raw, revenue_clamped) để phiếu lương giải
--     thích được vì sao.
--
--  CỐ Ý KHÔNG ĐỔI
--     Thưởng theo SỐ ĐƠN vẫn xét trên giá trị đơn gốc. Ngưỡng
--     min_order_value hỏi "đơn này có đủ lớn không" — là câu hỏi về đơn
--     hàng, không phải về doanh số kỳ. Trả một phần hàng không làm đơn
--     đó chưa từng xảy ra. Nếu chủ NPP muốn khác thì nói, sửa một dòng.
-- ====================================================================


-- --------------------------------------------------------------------
-- Tiền hàng trả lại quy về một nhân viên trong một kỳ.
--
-- Tách hàm riêng để test được và để báo cáo dùng lại cùng một định nghĩa,
-- thay vì mỗi màn hình tự cộng một kiểu như hiện nay.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.payroll_returns_for(uuid, uuid, date, date);
CREATE FUNCTION public.payroll_returns_for(
  p_user  uuid,
  p_org   uuid,
  p_start date,
  p_end   date
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(COALESCE(r.credit_note_amount, 0)), 0)
  FROM returns r
  LEFT JOIN sales_orders o ON o.id = r.order_id
  WHERE r.org_id = p_org
    AND r.status IN ('approved', 'completed')
    -- Giờ Việt Nam, không phải UTC. Xem mục 4 ở đầu file.
    AND ((r.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
        BETWEEN p_start AND p_end
    AND COALESCE(
          o.sales_user_id,
          (SELECT o2.sales_user_id
             FROM sales_orders o2
            WHERE o2.customer_id = r.customer_id
              AND o2.org_id = r.org_id
              AND public.is_revenue_status(o2.status)
              AND o2.order_date <= ((r.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
            ORDER BY o2.order_date DESC, o2.created_at DESC
            LIMIT 1)
        ) = p_user;
$$;

COMMENT ON FUNCTION public.payroll_returns_for(uuid, uuid, date, date) IS
  'Tiền hàng trả lại (credit note) quy về một NV trong một kỳ, dùng để tính '
  'doanh số thuần trả lương. Chỉ tính phiếu approved/completed. Gom theo '
  'ngày tạo phiếu GIỜ VIỆT NAM. Phiếu không gắn đơn thì quy về NV của đơn '
  'gần nhất phục vụ khách đó tính đến ngày tạo phiếu.';

GRANT EXECUTE ON FUNCTION public.payroll_returns_for(uuid, uuid, date, date) TO authenticated;


-- --------------------------------------------------------------------
-- compute_payroll_run — bản 094 NGUYÊN VĂN, vá đúng 3 chỗ:
--   • doanh số gộp  → doanh số thuần (kèm chặn số âm)
--   • khai báo thêm 3 biến
--   • breakdown ghi thêm gộp / đã trừ / thuần thật / có bị kẹp không
-- Vẫn không chép tay: xem ghi chú cùng chủ đề ở đầu migration 094.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION compute_payroll_run(p_run_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org      uuid;
  v_month    date;
  v_status   text;
  v_period_start date;
  v_period_end   date;
  u          record;
  v_revenue  numeric;
  v_base_salary numeric;
  v_gas      numeric;
  v_phone    numeric;
  v_allowances numeric;
  v_emp_gas   numeric;
  v_emp_phone numeric;
  v_emp_allowances numeric;
  v_std_days numeric;
  v_act_days numeric;
  v_prorated numeric;
  v_kpi      numeric;
  v_kpi_partial numeric;
  v_kpi_tier record;
  v_kpi_per_user bool;
  v_kpi_target numeric;
  v_kpi_tiers  jsonb;
  v_kpi_pct    numeric;
  v_kpi_breakdown jsonb;
  v_over_pct   numeric;
  v_under_60_pct numeric;
  v_low_perf   text;
  v_oc_cfg   record;
  v_oc_count int;
  v_oc_bonus numeric;
  v_activity numeric;
  v_si       numeric;
  v_net      numeric;
  v_count    int := 0;
  v_role     text;
  v_oc_paid  int;
  v_touched  uuid[] := ARRAY[]::uuid[];
  v_gross    numeric;
  v_returns  numeric;
  v_net_raw  numeric;
BEGIN
  SELECT org_id, month, status INTO v_org, v_month, v_status
  FROM payroll_runs WHERE id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYROLL_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'locked' THEN
    RAISE EXCEPTION 'PAYROLL_RUN_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- [4] Hàm là SECURITY DEFINER + GRANT cho `authenticated`, mà trước đây
  --     chỉ kiểm org và trạng thái khoá. Không chặn ở đây thì một tài
  --     khoản bán hàng hoặc lái xe gọi thẳng RPC là tính lại được bảng
  --     lương của cả công ty.
  SELECT role INTO v_role FROM users WHERE id = auth.uid();
  IF COALESCE(v_role, '') NOT IN ('owner', 'manager', 'accountant') THEN
    RAISE EXCEPTION 'FORBIDDEN_ROLE' USING ERRCODE = 'P0001';
  END IF;

  v_period_start := v_month;
  v_period_end := (v_month + interval '1 month - 1 day')::date;

  -- [3] KHÔNG xoá dòng lương ở đây nữa. Bước DELETE + INSERT cũ thổi
  --     bay cả manual_adjustment, deductions và notes do kế toán nhập
  --     tay. Thay bằng UPSERT ở cuối vòng lặp, rồi dọn dòng thừa sau.

  SELECT
    COALESCE(MAX(base_salary), 0)::numeric,
    COALESCE(MAX(gas_allowance), 0)::numeric,
    COALESCE(MAX(phone_allowance), 0)::numeric,
    COALESCE(MAX(working_days_per_month), 26)::numeric,
    COALESCE(MAX(kpi_target_revenue), 0)::numeric,
    (SELECT target_tiers FROM hr_salary_config
       WHERE org_id = v_org AND COALESCE(is_active, true) = true
       ORDER BY created_at DESC LIMIT 1),
    COALESCE(MAX(over_target_percent), 0)::numeric,
    COALESCE(MAX(under_60_percent), 0)::numeric
  INTO v_base_salary, v_gas, v_phone, v_std_days, v_kpi_target, v_kpi_tiers, v_over_pct, v_under_60_pct
  FROM hr_salary_config
  WHERE org_id = v_org
    AND COALESCE(is_active, true) = true;
  v_kpi_tiers := COALESCE(v_kpi_tiers, '[]'::jsonb);
  v_allowances := v_gas + v_phone;

  FOR u IN
    SELECT id, full_name, role
    FROM users
    WHERE org_id = v_org
      AND COALESCE(is_active, true) = true
      AND role = 'sales'   -- tạm thời chỉ tính lương NV bán hàng
  LOOP
    SELECT
      COUNT(*) FILTER (WHERE status IN ('present','holiday'))::numeric
      + 0.5 * COUNT(*) FILTER (WHERE status = 'half_day')::numeric
    INTO v_act_days
    FROM hr_attendance
    WHERE user_id = u.id
      AND work_date BETWEEN v_period_start AND v_period_end;
    v_act_days := COALESCE(v_act_days, 0);

    SELECT COALESCE(SUM(total), 0) INTO v_gross
    FROM sales_orders
    WHERE sales_user_id = u.id
      AND public.is_revenue_status(status)
      AND order_date BETWEEN v_period_start AND v_period_end;

    v_returns := public.payroll_returns_for(u.id, v_org, v_period_start, v_period_end);
    v_net_raw := v_gross - v_returns;

    -- [G] CHẶN SỐ ÂM. Trả nhiều hơn bán (khách trả hàng tồn của tháng trước,
    --     hoặc NV nghỉ giữa tháng) thì doanh số thuần âm. Không chặn ở đây
    --     thì nhánh dưới 60% cho ra lương ÂM: đã chạy thử, doanh số -40tr
    --     → lương cơ bản -400.000 và BHXH -42.000 → thực lĩnh -358.000 đ,
    --     tức công ty ghi nhận nhân viên NỢ lương. Kẹp về 0 và ghi lại số
    --     thật trong breakdown để phiếu lương vẫn giải thích được.
    v_revenue := GREATEST(0, v_net_raw);

    v_prorated := v_base_salary;   -- lương CB (mig 060: không prorate chấm công)
    v_emp_gas := v_gas;
    v_emp_phone := v_phone;
    v_emp_allowances := v_allowances;
    v_kpi := 0;
    v_kpi_per_user := false;
    v_kpi_pct := NULL;
    v_low_perf := 'normal';
    v_kpi_breakdown := '[]'::jsonb;

    -- 1) Per-user override (model cũ).
    SELECT min_revenue, bonus_type, bonus_value
      INTO v_kpi_tier
    FROM salary_kpi_tiers
    WHERE user_id = u.id AND month = v_month
      AND min_revenue <= v_revenue
    ORDER BY min_revenue DESC
    LIMIT 1;
    IF FOUND THEN
      v_kpi_per_user := true;
      IF v_kpi_tier.bonus_type = 'percent' THEN
        v_kpi := round(v_revenue * v_kpi_tier.bonus_value / 100, 0);
      ELSE
        v_kpi := v_kpi_tier.bonus_value;
      END IF;

    -- 2) Org config theo mức doanh số chung A + cộng dồn.
    ELSIF v_kpi_target > 0 THEN
      v_kpi_pct := v_revenue / v_kpi_target * 100;

      IF v_kpi_pct < 60 THEN
        -- Dưới 60% A: không hưởng lương cứng → lương = doanh số ×
        -- under_60%; KHÔNG có phụ cấp; không thưởng KPI.
        v_low_perf := 'under_60';
        v_prorated := round(v_revenue * v_under_60_pct / 100, 0);
        v_emp_gas := 0;
        v_emp_phone := 0;
        v_emp_allowances := 0;
        v_kpi := 0;
      ELSIF v_kpi_pct < 70 THEN
        v_low_perf := 'under_70';
        v_kpi := 0;
      ELSE
        SELECT
          COALESCE(SUM(CASE WHEN COALESCE((elem->>'min_percent')::numeric, 0) <= v_kpi_pct
                            THEN COALESCE((elem->>'bonus')::numeric, 0) ELSE 0 END), 0),
          COALESCE(jsonb_agg(jsonb_build_object(
            'min_percent', COALESCE((elem->>'min_percent')::numeric, 0),
            'bonus', COALESCE((elem->>'bonus')::numeric, 0),
            'label', elem->>'label',
            'passed', COALESCE((elem->>'min_percent')::numeric, 0) <= v_kpi_pct
          ) ORDER BY COALESCE((elem->>'min_percent')::numeric, 0)), '[]'::jsonb)
        INTO v_kpi_partial, v_kpi_breakdown
        FROM jsonb_array_elements(v_kpi_tiers) AS arr(elem);
        v_kpi := COALESCE(v_kpi_partial, 0);

        IF v_kpi_pct > 100 AND v_over_pct > 0 THEN
          v_low_perf := 'over_100';
          v_kpi := v_kpi + round((v_revenue - v_kpi_target) * v_over_pct / 100, 0);
        END IF;
      END IF;
    END IF;

    -- Order-count bonus.
    v_oc_bonus := 0;
    v_oc_count := 0;
    SELECT min_order_count, min_order_value, bonus_per_order, period
      INTO v_oc_cfg
    FROM salary_order_count_bonus_configs
    WHERE user_id = u.id
      AND effective_from <= v_period_end
      AND (effective_to IS NULL OR effective_to >= v_period_start)
    ORDER BY effective_from DESC
    LIMIT 1;
    v_oc_paid := 0;
    IF FOUND THEN
      IF v_oc_cfg.period = 'week' THEN
        -- [2] Cấu hình "Tuần" (043:47 CHECK IN ('week','month'), giao diện
        --     settings/users/[id]/salary/page.tsx:477 cho chọn): gom đơn
        --     theo tuần, MỖI TUẦN xét ngưỡng riêng, chỉ tuần nào đạt mới
        --     được thưởng. Trước đây nhánh này không tồn tại — cột period
        --     được SELECT rồi vứt đi — nên ngưỡng tuần bị đem so với số
        --     đơn CẢ THÁNG rồi thưởng cho toàn bộ đơn trong tháng.
        SELECT
          COALESCE(SUM(wk.cnt), 0),
          COALESCE(SUM(wk.cnt) FILTER (WHERE wk.cnt >= v_oc_cfg.min_order_count), 0)
        INTO v_oc_count, v_oc_paid
        FROM (
          SELECT date_trunc('week', order_date) AS w, count(*) AS cnt
          FROM sales_orders
          WHERE sales_user_id = u.id
            AND public.is_revenue_status(status)
            AND order_date BETWEEN v_period_start AND v_period_end
            AND total >= v_oc_cfg.min_order_value
          GROUP BY 1
        ) wk;
      ELSE
        SELECT count(*) INTO v_oc_count
        FROM sales_orders
        WHERE sales_user_id = u.id
          AND public.is_revenue_status(status)
          AND order_date BETWEEN v_period_start AND v_period_end
          AND total >= v_oc_cfg.min_order_value;
        IF v_oc_count >= v_oc_cfg.min_order_count THEN
          v_oc_paid := v_oc_count;
        END IF;
      END IF;
      v_oc_bonus := v_oc_paid * v_oc_cfg.bonus_per_order;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_activity
    FROM monthly_activity_bonuses
    WHERE user_id = u.id AND month = v_month;

    -- BHXH 10.5% trên phần lương CB hiệu lực (không trên phụ cấp).
    v_si := round(v_prorated * 0.105, 0);

    v_net := v_prorated + v_emp_allowances + v_kpi + v_oc_bonus + v_activity - v_si;

    INSERT INTO payroll_run_items (
      payroll_run_id, user_id,
      base_salary, standard_workdays, actual_workdays, prorated_base,
      allowances, kpi_bonus, order_count_bonus, activity_bonus,
      overtime, deductions, social_insurance,
      manual_adjustment, net_salary,
      computed_breakdown
    ) VALUES (
      p_run_id, u.id,
      v_base_salary, v_std_days, v_act_days, v_prorated,
      v_emp_allowances, v_kpi, v_oc_bonus, v_activity,
      0, 0, v_si,
      0, v_net,
      jsonb_build_object(
        'period_start', v_period_start,
        'period_end', v_period_end,
        'revenue', v_revenue,
        'revenue_gross', v_gross,
        'returns_deducted', v_returns,
        'revenue_net_raw', v_net_raw,
        'revenue_clamped', (v_net_raw < 0),
        'gas_allowance', v_emp_gas,
        'phone_allowance', v_emp_phone,
        'allowance_dropped', (v_emp_allowances = 0 AND v_allowances > 0),
        'kpi_target_revenue', v_kpi_target,
        'kpi_pct', CASE WHEN v_kpi_target > 0 THEN round(v_revenue / v_kpi_target * 100, 1) ELSE NULL END,
        'kpi_model', CASE WHEN v_kpi_per_user THEN 'per_user_tier' ELSE 'org_cumulative' END,
        'kpi_tier_breakdown', v_kpi_breakdown,
        'low_perf', v_low_perf,
        'over_target_percent', v_over_pct,
        'under_60_percent', v_under_60_pct,
        'oc_count', COALESCE(v_oc_count, 0),
        'oc_paid_count', COALESCE(v_oc_paid, 0),
        'oc_period', COALESCE(v_oc_cfg.period, 'month'),
        'oc_min_count', COALESCE(v_oc_cfg.min_order_count, 0),
        'oc_min_value', COALESCE(v_oc_cfg.min_order_value, 0),
        'oc_bonus_per_order', COALESCE(v_oc_cfg.bonus_per_order, 0),
        'attendance_skipped', true
      )
    )
    -- [3] Các cột do NGƯỜI nhập (overtime, deductions, manual_adjustment,
    --     notes) cố ý KHÔNG nằm trong danh sách SET, nên "Tính lại" không
    --     còn xoá được chúng. Công thức net dưới đây khớp với
    --     src/lib/payroll/run.ts:126-134 để hai đường ghi không cho ra hai
    --     con số khác nhau trên cùng một dòng lương.
    ON CONFLICT (payroll_run_id, user_id) DO UPDATE SET
      base_salary        = EXCLUDED.base_salary,
      standard_workdays  = EXCLUDED.standard_workdays,
      actual_workdays    = EXCLUDED.actual_workdays,
      prorated_base      = EXCLUDED.prorated_base,
      allowances         = EXCLUDED.allowances,
      kpi_bonus          = EXCLUDED.kpi_bonus,
      order_count_bonus  = EXCLUDED.order_count_bonus,
      activity_bonus     = EXCLUDED.activity_bonus,
      social_insurance   = EXCLUDED.social_insurance,
      computed_breakdown = EXCLUDED.computed_breakdown,
      updated_at         = now(),
      net_salary         = EXCLUDED.prorated_base
                         + EXCLUDED.allowances
                         + EXCLUDED.kpi_bonus
                         + EXCLUDED.order_count_bonus
                         + EXCLUDED.activity_bonus
                         + payroll_run_items.overtime
                         + payroll_run_items.manual_adjustment
                         - payroll_run_items.deductions
                         - EXCLUDED.social_insurance;

    v_touched := v_touched || u.id;
    v_count := v_count + 1;
  END LOOP;

  -- Nhân sự đã nghỉ hoặc đổi vai trò thì bỏ dòng lương đi. Trước đây bước
  -- DELETE ở đầu hàm lo việc này; giờ UPSERT không xoá nên phải dọn ở đây.
  DELETE FROM payroll_run_items
  WHERE payroll_run_id = p_run_id
    AND NOT (user_id = ANY (v_touched));

  UPDATE payroll_runs
  SET computed_at = now()
  WHERE id = p_run_id;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_payroll_run(uuid) TO authenticated;
