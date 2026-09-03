import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { vnDayRange } from "@/lib/analytics/sales"

/**
 * Khoá lại migration 095 — doanh số tính lương chuyển sang doanh số THUẦN.
 *
 * Mỗi phép kiểm ở đây tương ứng với một kịch bản ĐÃ CHẠY THẬT trên
 * Postgres 16 lúc làm, số liệu ghi trong mô tả để người sau đối chiếu chứ
 * không phải để trang trí.
 */

const M095 = readFileSync(
  resolve(__dirname, "../supabase/migrations/095_payroll_net_revenue.sql"),
  "utf-8"
)

const SQL = M095.split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n")

/** Chỉ phần thân hàm payroll_returns_for. */
const RETURNS_FN = SQL.slice(
  SQL.indexOf("CREATE FUNCTION public.payroll_returns_for"),
  SQL.indexOf("COMMENT ON FUNCTION public.payroll_returns_for")
)

describe("095 — trừ đúng khoản, đúng phiếu", () => {
  /**
   * Chạy thật: phiếu trả gồm 10 hộp ĐỔI (100.000) + 3 hộp TRẢ (30.000).
   * Trigger trg_return_lines_sync_credit (mig 035:44) đặt
   * credit_note_amount = 30.000 → trừ 30.000, không trừ 130.000.
   */
  it("dùng credit_note_amount, KHÔNG tự cộng lại return_lines", () => {
    expect(RETURNS_FN).toContain("credit_note_amount")
    // Cộng tay line_total là bỏ qua trigger và sẽ tính cả dòng đổi hàng.
    expect(RETURNS_FN).not.toContain("line_total")
  })

  it("credit_note_amount NULL không làm hỏng tổng", () => {
    expect(RETURNS_FN).toContain("COALESCE(r.credit_note_amount, 0)")
  })

  /**
   * Chạy thật: 4 phiếu trong tháng 4 — approved 20tr, pending 30tr,
   * rejected 40tr, completed-tạo-tay 5tr → tổng trừ = 25tr.
   */
  it("chỉ tính phiếu approved/completed — giống công nợ và báo cáo", () => {
    expect(RETURNS_FN).toContain("r.status IN ('approved', 'completed')")
  })
})

describe("095 — quy phiếu trả về đúng nhân viên", () => {
  it("ưu tiên đơn gốc qua order_id", () => {
    expect(RETURNS_FN).toContain("LEFT JOIN sales_orders o ON o.id = r.order_id")
    expect(RETURNS_FN).toContain("o.sales_user_id")
  })

  /**
   * /returns/new tạo phiếu KHÔNG có order_id (returns/new/page.tsx:50-59),
   * nên phải có đường suy ra. Chạy thật: phiếu tạo tay 5tr được quy đúng
   * về NV của đơn gần nhất.
   */
  it("phiếu không gắn đơn thì suy từ đơn gần nhất của khách", () => {
    expect(RETURNS_FN).toContain("COALESCE(")
    expect(RETURNS_FN).toContain("o2.customer_id = r.customer_id")
    expect(RETURNS_FN).toContain("ORDER BY o2.order_date DESC")
  })

  it("KHÔNG quy về đơn phát sinh SAU ngày tạo phiếu trả", () => {
    // Báo cáo nhân viên lấy đơn mới nhất bất kể thời gian, nên phiếu trả
    // tháng 4 có thể bị quy cho NV mới nhận khách tháng 6 — trừ tiền người
    // chưa từng bán đơn đó. Ở đây phải có chặn thời gian.
    expect(RETURNS_FN).toMatch(/o2\.order_date <= /)

    // Chỉ kiểm "có mặt chuỗi đó" là quá lỏng: thêm `AND true OR ...` vào
    // trước nó thì điều kiện mất tác dụng mà test vẫn xanh (đã thử đột biến
    // đúng như vậy và test không bắt được). Truy vấn con này phải là một
    // chuỗi AND thuần — có OR nghĩa là điều kiện chặn đã bị nới.
    const sub = RETURNS_FN.slice(
      RETURNS_FN.indexOf("(SELECT o2.sales_user_id"),
      RETURNS_FN.indexOf("LIMIT 1)")
    )
    expect(sub.length).toBeGreaterThan(0)
    expect(sub).not.toMatch(/\bOR\b/)
    // …và mốc so sánh phải là ngày tạo phiếu đã đổi về giờ VN, không phải
    // một hằng số hay ngày khác.
    expect(sub).toMatch(
      /o2\.order_date <= \(\(r\.created_at AT TIME ZONE 'Asia\/Ho_Chi_Minh'\)::date\)/
    )
  })

  it("chỉ suy từ đơn thật, không suy từ đơn nháp/đã huỷ", () => {
    expect(RETURNS_FN).toContain("public.is_revenue_status(o2.status)")
  })

  it("không rò dữ liệu sang tổ chức khác", () => {
    expect(RETURNS_FN).toContain("r.org_id = p_org")
    expect(RETURNS_FN).toContain("o2.org_id = r.org_id")
  })
})

describe("095 — kỳ tính theo giờ Việt Nam, không phải UTC", () => {
  /**
   * Chạy thật: phiếu trả 9tr tạo lúc 03:00 ngày 1/5 giờ Việt Nam.
   *   dùng created_at::date (UTC) → rơi vào 30/4, tháng 4 bị trừ nhầm
   *     34.000.000 thay vì 25.000.000
   *   dùng AT TIME ZONE 'Asia/Ho_Chi_Minh' → đúng tháng 5
   */
  it("SQL đổi múi giờ trước khi lấy ngày", () => {
    expect(RETURNS_FN).toContain("AT TIME ZONE 'Asia/Ho_Chi_Minh'")
    // ::date trần trên timestamptz là đúng cái bẫy này.
    expect(RETURNS_FN).not.toMatch(/r\.created_at::date/)
  })

  it("phía TypeScript dùng cùng một mốc +07:00", () => {
    const r = vnDayRange({ from: "2026-05-01", to: "2026-05-31" })
    expect(r.fromIso).toBe("2026-05-01T00:00:00+07:00")
    expect(r.toIso).toBe("2026-05-31T23:59:59.999+07:00")
  })

  it("mốc đầu kỳ theo giờ VN sớm hơn mốc cũ theo UTC đúng 7 tiếng", () => {
    const moi = new Date(vnDayRange({ from: "2026-05-01", to: "2026-05-31" }).fromIso)
    const cu = new Date("2026-05-01T00:00:00Z")
    expect((cu.getTime() - moi.getTime()) / 3_600_000).toBe(7)
  })

  it("phiếu tạo 3h sáng 1/5 giờ VN nằm TRONG kỳ tháng 5", () => {
    // Chính là bản ghi đã dựng trên Postgres.
    const t = new Date("2026-05-01T03:00:00+07:00")
    const { fromIso, toIso } = vnDayRange({ from: "2026-05-01", to: "2026-05-31" })
    expect(t >= new Date(fromIso)).toBe(true)
    expect(t <= new Date(toIso)).toBe(true)
    // ...và NGOÀI kỳ tháng 4, dù mốc cũ theo UTC thì lại nằm trong.
    const thang4 = vnDayRange({ from: "2026-04-01", to: "2026-04-30" })
    expect(t > new Date(thang4.toIso)).toBe(true)
    expect(t < new Date("2026-04-30T23:59:59Z")).toBe(true)
  })

  it("không còn chỗ nào ghép mốc UTC cho cột timestamptz", () => {
    const src = readFileSync(resolve(__dirname, "../src/lib/analytics/sales.ts"), "utf-8")
    const code = src.split("\n").filter((l) => !l.trimStart().startsWith("*")).join("\n")
    expect(code).not.toContain("T00:00:00Z")
    expect(code).not.toContain("T23:59:59Z")
  })
})

describe("095 — chặn số âm", () => {
  /**
   * Chạy thật: bán 100tr, khách trả 140tr (hàng tồn tháng trước).
   *   không kẹp: doanh số -40tr → lương CB -400.000, BHXH -42.000,
   *              thực lĩnh -358.000 đ — công ty ghi nhận NV nợ lương
   *   có kẹp:    doanh số 0 → lương CB 0, BHXH 0, thực lĩnh 0
   */
  it("doanh số dùng để tính lương không bao giờ âm", () => {
    expect(SQL).toContain("v_revenue := GREATEST(0, v_net_raw)")
  })

  it("vẫn ghi lại số thật để phiếu lương giải thích được", () => {
    for (const k of ["revenue_gross", "returns_deducted", "revenue_net_raw", "revenue_clamped"]) {
      expect(SQL, `breakdown thiếu "${k}"`).toContain(`'${k}'`)
    }
  })

  it("phiếu lương hiển thị được phép trừ, không chỉ số cuối", () => {
    const ps = readFileSync(
      resolve(__dirname, "../src/components/printing/payslip.tsx"),
      "utf-8"
    )
    // NV bán 100tr mà thấy "Doanh số kỳ 55.000.000" không kèm giải thích
    // thì sẽ báo phần mềm sai.
    expect(ps).toContain("revenueGross")
    expect(ps).toContain("returnsDeducted")
    expect(ps).toContain("hàng trả lại")
  })

  it("trang bảng lương truyền đủ 4 trường mới xuống phiếu", () => {
    const page = readFileSync(
      resolve(__dirname, "../src/app/(dashboard)/hr/payroll/runs/page.tsx"),
      "utf-8"
    )
    for (const k of ["revenue_gross", "returns_deducted", "revenue_net_raw", "revenue_clamped"]) {
      expect(page, `trang bảng lương chưa đọc "${k}"`).toContain(k)
    }
  })
})

describe("095 — giữ nguyên phần đã sửa ở 094", () => {
  /** 095 vá lên thân hàm 094 nên mọi chốt của 094 phải còn nguyên. */
  it("vẫn chặn vai trò", () => {
    expect(SQL).toContain("FORBIDDEN_ROLE")
  })

  it("vẫn UPSERT, không xoá số kế toán sửa tay", () => {
    expect(SQL).toContain("ON CONFLICT (payroll_run_id, user_id) DO UPDATE SET")
    expect(SQL).not.toContain("DELETE FROM payroll_run_items WHERE payroll_run_id = p_run_id;")
  })

  it("vẫn tôn trọng cấu hình thưởng theo tuần", () => {
    expect(SQL).toContain("v_oc_cfg.period = 'week'")
  })

  it("doanh số gộp vẫn loại đơn nháp và đơn đã huỷ", () => {
    expect(SQL).toContain("public.is_revenue_status(status)")
  })

  /**
   * Thưởng theo SỐ ĐƠN cố ý vẫn xét trên giá trị đơn GỐC: ngưỡng
   * min_order_value hỏi "đơn này có đủ lớn không", là câu hỏi về đơn hàng
   * chứ không phải về doanh số kỳ. Ghim lại để không ai đổi nhầm mà tưởng
   * là bỏ sót.
   */
  it("thưởng số đơn vẫn dùng total của đơn, không trừ hàng trả", () => {
    expect(SQL).toContain("AND total >= v_oc_cfg.min_order_value")
  })
})
