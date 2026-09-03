-- ====================================================================
-- 096 — Doanh số tính lương = doanh số THUẦN (trừ hàng trả lại)
--
-- Thay cho cách làm ở 095. Cùng một quyết định của chủ NPP (trả lương
-- trên doanh số thuần), khác ở CHỖ ĐẶT logic: 095 suy ra "phiếu trả này
-- của ai / thuộc kỳ nào" MỖI LẦN ĐỌC bằng một subquery tương quan lồng
-- trong COALESCE. 096 chốt hai điều đó MỘT LẦN lúc ghi, thành hai cột
-- bình thường. Câu tính lương rút lại còn một phép SUM ai đọc cũng hiểu,
-- lịch sử không tự đổi sau lưng, và sai thì sửa tay được bằng UPDATE.
--
-- LỖ THỦNG CỦA CÁCH GOM THEO created_at (đã chạy thử trên Postgres 16)
--   order-form.tsx:816 tạo phiếu trả với status='pending'. Phiếu chỉ
--   thành 'completed' khi thủ kho bấm nhập lại hàng ở màn hình khác
--   (inventory/pending/page.tsx:373) — và bước đó KHÔNG ghi lại thời điểm.
--   Kịch bản có thật:
--     28/09  bán 30tr, khách trả 25tr -> phiếu 'pending'
--     01/10  chốt lương T9: phiếu còn 'pending' -> trừ 0
--     03/10  thủ kho nhập lại hàng   -> phiếu 'completed'
--     05/10  khoá kỳ T9
--     01/11  chốt lương T10
--   Gom theo created_at (28/09): T9 đã khoá, tính lại báo PAYROLL_RUN_LOCKED;
--   T10 không thấy vì created_at nằm ở tháng 9. 25.000.000 đ BIẾN MẤT,
--   không trừ vào đâu cả, không cảnh báo. Đã chạy thử ra đúng như vậy.
--
-- BỐN QUYẾT ĐỊNH
--
--  1. QUY VỀ AI  -> cột returns.sales_user_id, chốt lúc INSERT
--     Bảng returns không có cột này (001_schema.sql:328-341). Trigger điền:
--     có order_id thì lấy sales_orders.sales_user_id (chính xác tuyệt đối);
--     phiếu tạo tay ở /returns/new không có order_id (returns/new/page.tsx:50-59)
--     thì lấy NV của đơn gần nhất phục vụ khách đó TÍNH ĐẾN ngày tạo phiếu.
--     Suy đoán vẫn còn, nhưng chỉ chạy một lần và kết quả nhìn thấy được.
--     Khác 095: ở đó phép suy đoán nằm trong câu tính lương, chạy lại mỗi
--     lần bấm "Tính lại", nên đơn nhập bù hay đổi NV phụ trách khách là
--     bảng lương THÁNG CŨ đổi số. Ở đây cột đã chốt, không đổi nữa.
--
--  2. THUỘC KỲ NÀO -> cột returns.credited_at (ngày phiếu thành duyệt/xong)
--     Bảng không có approved_at (grep: chỉ sales_orders và purchase_orders
--     có). Nên phải ghi mới. Trigger set credited_at = now() đúng lần đầu
--     phiếu vào ('approved','completed'), sau đó không đụng nữa.
--     Quy tắc cho chủ NPP: "hàng trả trừ vào tháng DUYỆT phiếu."
--     Tháng đã khoá không bao giờ bị động tới, và khoản trên không rơi
--     mất — nó vào T10, đúng tháng tiền thật sự rời công ty.
--     Backfill dữ liệu cũ = created_at, khớp với con số báo cáo đang hiện.
--
--  3. TRỪ BAO NHIÊU -> credit_note_amount, kẹp không âm
--     Không tự cộng lại return_lines: trigger trg_sync_return_credit
--     (055:88, KHÔNG phải 035 — xem ghi chú cuối file) đã giữ
--     credit_note_amount = SUM(line_total) của dòng is_exchange = false.
--     Đổi hàng là giao hàng khác thay thế, khách không được hoàn tiền.
--     Chạy thử: 10 thùng trả (25tr) + 4 thùng đổi (10tr) -> 25tr.
--     line_total đã gồm VAT (069:6) và sales_orders.total cũng gồm VAT,
--     nên gộp và khoản trừ cùng một gốc, trừ thẳng được.
--     GREATEST(0, ...) từng dòng: ô nhập là <Input type="number"> không có
--     min (returns/new/page.tsx:99), gõ số âm được, mà số âm ở đây sẽ
--     LÀM TĂNG doanh số. Hàng trả không bao giờ được cộng vào lương.
--
--  4. ĐƠN ĐÃ HUỶ -> không trừ
--     Đơn 'cancelled' không nằm trong doanh số gộp (is_revenue_status,
--     094:70). Nếu vẫn trừ phiếu trả gắn với nó thì NV bị phạt cho một
--     doanh số chưa từng được cộng. 095 thiếu chốt này.
--
-- CHẶN SỐ ÂM (bắt buộc)
--     Nhánh dưới 60% trả `lương = doanh số × under_60_percent` (094:243),
--     nên doanh số thuần âm cho ra lương cơ bản âm, BHXH âm và thực lĩnh
--     âm — công ty ghi nhận nhân viên NỢ lương. Kẹp doanh số về 0; số
--     thật vẫn nằm trong breakdown để phiếu lương giải thích được.
--
-- CỐ Ý KHÔNG ĐỔI
--     Thưởng theo SỐ ĐƠN vẫn xét trên giá trị đơn gốc. min_order_value
--     hỏi "đơn này có đủ lớn không" — câu hỏi về đơn hàng, không phải về
--     doanh số kỳ. Trả một phần hàng không làm đơn đó chưa từng xảy ra.
--
-- GHI CHÚ CHO NGƯỜI SAU: trên return_lines hiện có HAI trigger cùng ghi
--     credit_note_amount. 055:87 chỉ DROP đúng tên của chính nó, nên
--     trg_return_lines_sync_credit (035:45) vẫn còn sống. Hai cái ra cùng
--     kết quả khi phiếu còn dòng, nên không ảnh hưởng tính lương; chỉ
--     khác khi xoá hết dòng. Không dọn ở đây để migration này chỉ làm một
--     việc — nhưng đừng tin chú thích "header-only keeps manual value" ở
--     055:49, nó không còn đúng.
-- ====================================================================


-- --------------------------------------------------------------------
-- 1. Hai sự thật bảng lương cần, LƯU LẠI thay vì suy ra mỗi lần đọc.
-- --------------------------------------------------------------------
ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS sales_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS credited_at   timestamptz;

COMMENT ON COLUMN returns.sales_user_id IS
  'NV bán hàng chịu khoản trả này khi tính lương. Chốt lúc tạo phiếu, '
  'không suy lại lúc đọc. Quy sai thì UPDATE tay cột này.';
COMMENT ON COLUMN returns.credited_at IS
  'Lần đầu phiếu vào approved/completed = thời điểm khoản trả có hiệu lực. '
  'Quyết định phiếu trừ vào KỲ LƯƠNG nào. Chỉ set một lần, không lùi.';


-- --------------------------------------------------------------------
-- 2. Trigger điền hai cột. BEFORE nên ghi thẳng vào NEW, không UPDATE lại
--    bảng -> không đệ quy, không đụng trigger credit_note_amount.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.returns_fill_payroll_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Đã có giá trị (kể cả do người sửa tay) thì tôn trọng, không tính lại.
  IF NEW.sales_user_id IS NULL AND NEW.order_id IS NOT NULL THEN
    SELECT o.sales_user_id INTO NEW.sales_user_id
    FROM sales_orders o WHERE o.id = NEW.order_id;
  END IF;

  IF NEW.sales_user_id IS NULL THEN
    SELECT o2.sales_user_id INTO NEW.sales_user_id
    FROM sales_orders o2
    WHERE o2.customer_id = NEW.customer_id
      AND o2.org_id = NEW.org_id
      AND o2.sales_user_id IS NOT NULL
      AND public.is_revenue_status(o2.status)
      AND o2.order_date <=
          ((COALESCE(NEW.created_at, now()) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
    ORDER BY o2.order_date DESC, o2.created_at DESC
    LIMIT 1;
  END IF;

  IF NEW.credited_at IS NULL
     AND COALESCE(NEW.status, '') IN ('approved', 'completed') THEN
    NEW.credited_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_returns_fill_payroll_fields ON returns;
CREATE TRIGGER trg_returns_fill_payroll_fields
  BEFORE INSERT OR UPDATE ON returns
  FOR EACH ROW EXECUTE FUNCTION public.returns_fill_payroll_fields();


-- --------------------------------------------------------------------
-- 3. Backfill một lần. credited_at lấy created_at vì đó là mốc duy nhất
--    còn lưu — khớp đúng con số báo cáo nhân viên đang hiện hôm nay.
-- --------------------------------------------------------------------
UPDATE returns r SET
  sales_user_id = COALESCE(
    r.sales_user_id,
    (SELECT o.sales_user_id FROM sales_orders o WHERE o.id = r.order_id),
    (SELECT o2.sales_user_id
       FROM sales_orders o2
      WHERE o2.customer_id = r.customer_id
        AND o2.org_id = r.org_id
        AND o2.sales_user_id IS NOT NULL
        AND public.is_revenue_status(o2.status)
        AND o2.order_date <= ((r.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
      ORDER BY o2.order_date DESC, o2.created_at DESC
      LIMIT 1)
  ),
  credited_at = COALESCE(
    r.credited_at,
    CASE WHEN r.status IN ('approved', 'completed') THEN r.created_at END
  )
WHERE r.sales_user_id IS NULL OR r.credited_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_returns_payroll
  ON returns (org_id, sales_user_id, credited_at)
  WHERE status IN ('approved', 'completed');


-- --------------------------------------------------------------------
-- 4. compute_payroll_run — bản 094 NGUYÊN VĂN, vá đúng 3 chỗ đánh dấu [N]:
--      [N1] khai báo thêm 3 biến
--      [N2] doanh số gộp -> thuần, kèm chặn số âm
--      [N3] breakdown ghi gộp / đã trừ / thuần thật / có bị kẹp không
--    Không gõ lại từ đầu — xem lý do ở đầu migration 094.
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
  v_gross    numeric;   -- [N1]
  v_returns  numeric;   -- [N1]
  v_net_raw  numeric;   -- [N1]
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

  SELECT role INTO v_role FROM users WHERE id = auth.uid();
  IF COALESCE(v_role, '') NOT IN ('owner', 'manager', 'accountant') THEN
    RAISE EXCEPTION 'FORBIDDEN_ROLE' USING ERRCODE = 'P0001';
  END IF;

  v_period_start := v_month;
  v_period_end := (v_month + interval '1 month - 1 day')::date;

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
      AND role = 'sales'
  LOOP
    SELECT
      COUNT(*) FILTER (WHERE status IN ('present','holiday'))::numeric
      + 0.5 * COUNT(*) FILTER (WHERE status = 'half_day')::numeric
    INTO v_act_days
    FROM hr_attendance
    WHERE user_id = u.id
      AND work_date BETWEEN v_period_start AND v_period_end;
    v_act_days := COALESCE(v_act_days, 0);

    -- [N2] Doanh số GỘP — y như 094, chỉ đổi biến đích sang v_gross.
    SELECT COALESCE(SUM(total), 0) INTO v_gross
    FROM sales_orders
    WHERE sales_user_id = u.id
      AND public.is_revenue_status(status)
      AND order_date BETWEEN v_period_start AND v_period_end;

    -- [N2] Hàng trả lại của NV này, tính vào kỳ theo NGÀY DUYỆT giờ VN.
    --      credited_at là timestamptz và DB chạy UTC: phiếu duyệt lúc 3h
    --      sáng 01/05 giờ VN mà ::date thẳng sẽ ra 30/04, rơi sang kỳ
    --      trước — kỳ có thể đã khoá. Phải AT TIME ZONE trước khi ::date.
    SELECT COALESCE(SUM(GREATEST(0, COALESCE(r.credit_note_amount, 0))), 0)
    INTO v_returns
    FROM returns r
    LEFT JOIN sales_orders o ON o.id = r.order_id
    WHERE r.org_id = v_org
      AND r.sales_user_id = u.id
      AND r.status IN ('approved', 'completed')
      AND ((r.credited_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
          BETWEEN v_period_start AND v_period_end
      AND (r.order_id IS NULL OR public.is_revenue_status(o.status));

    v_net_raw := v_gross - v_returns;
    v_revenue := GREATEST(0, v_net_raw);   -- [N2] chặn lương âm

    v_prorated := v_base_salary;
    v_emp_gas := v_gas;
    v_emp_phone := v_phone;
    v_emp_allowances := v_allowances;
    v_kpi := 0;
    v_kpi_per_user := false;
    v_kpi_pct := NULL;
    v_low_perf := 'normal';
    v_kpi_breakdown := '[]'::jsonb;

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

    ELSIF v_kpi_target > 0 THEN
      v_kpi_pct := v_revenue / v_kpi_target * 100;

      IF v_kpi_pct < 60 THEN
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
        -- [N3] Bốn dòng dưới để phiếu lương trả lời được "sao tháng này ít
        --      hơn?" mà không phải mở SQL ra dò.
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
