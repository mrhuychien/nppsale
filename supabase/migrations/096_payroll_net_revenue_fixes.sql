-- ====================================================================
-- 096 — Ba chỗ hở còn lại của doanh số thuần (mig 095)
--
-- 095 chuyển lương sang doanh số thuần. Rà lại bằng nhiều góc nhìn độc
-- lập thì lộ ra ba chỗ hở, một trong đó là lỗi tiền thật do chính 095
-- tạo ra. Ghi rõ ở đây vì người sau sẽ hỏi "sao vừa viết xong đã sửa".
--
--  1. TRỪ HAI LẦN CHO MỘT GIAO DỊCH KHÔNG TỒN TẠI  ← lỗi thật của 095
--     payroll_returns_for không xét trạng thái ĐƠN GỐC của phiếu trả.
--     Doanh số gộp đã loại đơn 'draft'/'cancelled' bằng is_revenue_status,
--     nhưng phiếu trả gắn vào chính những đơn đó vẫn bị trừ.
--     Chạy thử trên Postgres 16:
--         đơn A 100tr đã giao + đơn B 50tr ĐÃ HUỶ, phiếu trả 10tr của đơn B
--         095 → gộp 100tr, trừ 10tr, thuần 90tr   ← sai
--         096 → gộp 100tr, trừ  0đ,  thuần 100tr  ← đúng
--     Nhân viên mất 10tr doanh số cho một đơn chưa từng được tính cho họ.
--     Phiếu KHÔNG gắn đơn (tạo tay ở /returns/new) không có đơn gốc để
--     xét nên vẫn tính như cũ.
--
--  2. PHẦN HÀNG TRẢ VƯỢT BỊ NUỐT IM LẶNG
--     095 kẹp doanh số thuần về 0 để không ra lương âm — vẫn đúng. Nhưng
--     phần vượt thì biến mất khỏi mọi báo cáo: bán 10tr, trả 40tr thì 30tr
--     không còn dấu vết ở đâu. Ghi 'returns_excess' vào breakdown.
--     KHÔNG tự động chuyển phần vượt sang kỳ sau — đó là chính sách, phải
--     do chủ NPP quyết, không phải việc migration tự nghĩ ra.
--
--  3. THIẾU LỌC org_id TRONG HÀM BỎ QUA RLS
--     compute_payroll_run là SECURITY DEFINER nên RLS không áp dụng. Câu
--     tính doanh số gộp chỉ lọc sales_user_id — hiện an toàn nhờ ăn may
--     (nhân viên luôn cùng org với đơn của mình). Trong một hàm đã bỏ qua
--     RLS thì không nên dựa vào bất biến ngầm. Thêm org_id = v_org.
--
-- GHI NHẬN THÊM, KHÔNG SỬA Ở ĐÂY
--   • return_lines đang có HAI trigger cùng đồng bộ credit_note_amount:
--     trg_return_lines_sync_credit (035:45) và trg_sync_return_credit
--     (055:88). Cả hai cùng loại dòng is_exchange nên ra cùng một số,
--     chỉ thừa chứ chưa sai. Gỡ bớt là việc dọn dẹp riêng, không gộp vào
--     một migration đang đổi tiền lương.
-- ====================================================================


-- --------------------------------------------------------------------
-- 1. payroll_returns_for — thêm điều kiện trạng thái đơn gốc.
--    Bản 095 nguyên văn, chỉ chèn đúng một mệnh đề AND.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_returns_for(
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
    -- [096] Phiếu trả gắn vào đơn NHÁP hoặc ĐÃ HUỶ thì không trừ. Đơn đó
    --       chưa từng được cộng vào doanh số gộp (is_revenue_status), nên
    --       trừ credit của nó là phạt nhân viên hai lần cho một giao dịch
    --       không tồn tại. Phiếu KHÔNG gắn đơn (tạo tay ở /returns/new)
    --       không có đơn gốc để xét nên vẫn tính.
    AND (r.order_id IS NULL OR public.is_revenue_status(o.status))
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

GRANT EXECUTE ON FUNCTION public.payroll_returns_for(uuid, uuid, date, date) TO authenticated;


-- --------------------------------------------------------------------
-- 2+3. compute_payroll_run — bản 095 nguyên văn, vá đúng hai chỗ:
--      lọc org_id cho câu doanh số gộp, và ghi returns_excess.
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

    -- [096] Thêm lọc org_id. Hàm là SECURITY DEFINER nên RLS KHÔNG áp
    --       dụng; trước đây câu này chỉ lọc sales_user_id và an toàn nhờ
    --       ăn may (NV luôn cùng org với đơn của mình). Trong một hàm bỏ
    --       qua RLS thì không nên dựa vào bất biến ngầm như vậy.
    SELECT COALESCE(SUM(total), 0) INTO v_gross
    FROM sales_orders
    WHERE sales_user_id = u.id
      AND org_id = v_org
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
        -- [096] Phần hàng trả KHÔNG trừ được vì doanh số đã về 0. Kẹp im
        --       lặng là giấu tiền: trả 40tr trên nền bán 10tr thì 30tr
        --       biến mất khỏi mọi báo cáo. Ghi ra để còn nhìn thấy.
        'returns_excess', GREATEST(0, -v_net_raw),
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
