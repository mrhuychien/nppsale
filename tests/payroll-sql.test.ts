import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Khoá lại 5 lỗi tiền lương đã sửa ở migration 094.
 *
 * VÌ SAO TEST NÀY TỒN TẠI
 * Toàn bộ phép tính lương nằm trong SQL, không có một dòng TypeScript nào
 * chạy nó, nên `npm test` không bao giờ chạm tới. Cả 5 lỗi dưới đây đều đã
 * sống sót qua 8 migration liên tiếp (050 → 067) mà không ai thấy — vì
 * không có gì nhìn vào đó cả.
 *
 * Test này không chạy được SQL (CI không có Postgres). Nó đọc file
 * migration và ghim các bất biến lại. Mỗi phép kiểm ở đây tương ứng với
 * một kịch bản ĐÃ ĐƯỢC CHẠY THẬT trên Postgres 16 lúc sửa, số liệu ghi
 * ngay trong mô tả để người sau đối chiếu.
 */

const M094 = readFileSync(
  resolve(__dirname, "../supabase/migrations/094_payroll_revenue_and_manual_edits.sql"),
  "utf-8"
)

/** Bỏ dòng chú thích: chính file SQL nhắc lại nguyên văn các đoạn mã sai. */
const SQL = M094.split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n")

describe("094 — doanh thu", () => {
  /**
   * Chạy thật: 5 đơn 'delivered' + 5 đơn 'picking'/'delivering', mỗi đơn
   * 10tr, mức doanh số A = 100tr.
   *   067 → doanh số 50tr → 50% → nhánh under_60 → thực lĩnh    447.500 đ
   *   094 → doanh số 100tr → 100% → nhánh normal  → thực lĩnh 9.650.000 đ
   * Cùng một tháng, cùng một nhân viên, khác nhau 21 lần chỉ vì kho đã
   * bấm "giao xong" hay chưa.
   */
  it("không còn lọc status IN ('delivered','confirmed') ở bất kỳ đâu", () => {
    expect(SQL).not.toContain("status IN ('delivered','confirmed')")
  })

  it("dùng is_revenue_status() cho mọi phép đếm doanh thu", () => {
    // 2 chỗ trong compute_payroll_run (doanh số + đếm đơn thưởng, nhánh
    // tuần và nhánh tháng) + 3 hàm dashboard.
    const n = (SQL.match(/is_revenue_status\(/g) || []).length
    expect(n).toBeGreaterThanOrEqual(6)
  })

  it("is_revenue_status loại đúng 'draft' và 'cancelled' — không loại gì khác", () => {
    const m = SQL.match(/NOT IN \(([^)]*)\)\s*;/)
    expect(m, "không tìm thấy định nghĩa is_revenue_status").toBeTruthy()
    const list = m![1].split(",").map((s) => s.trim().replace(/'/g, "")).sort()
    expect(list).toEqual(["cancelled", "draft"])
  })

  it("picking và delivering KHÔNG bị loại — đây chính là lỗi cũ", () => {
    // Vòng đời đơn (001_schema.sql:167) có 6 trạng thái. Nếu ai đó thêm
    // 'picking'/'delivering' vào danh sách loại trừ là lỗi cũ quay lại.
    const m = SQL.match(/NOT IN \(([^)]*)\)\s*;/)
    expect(m![1]).not.toContain("picking")
    expect(m![1]).not.toContain("delivering")
  })
})

describe("094 — thưởng theo số đơn", () => {
  /**
   * Chạy thật: 12 đơn rải đều 4 tuần (3 đơn/tuần), cấu hình period='week',
   * ngưỡng 5 đơn/tuần, 100k/đơn. Không tuần nào đạt 5 đơn.
   *   067 → 1.200.000 đ  (đem ngưỡng tuần so với 12 đơn CẢ THÁNG)
   *   094 →         0 đ
   */
  it("có nhánh xử lý period = 'week'", () => {
    expect(SQL).toContain("v_oc_cfg.period = 'week'")
  })

  it("nhánh tuần gom theo date_trunc('week', ...)", () => {
    expect(SQL).toContain("date_trunc('week', order_date)")
  })

  it("chỉ trả thưởng cho tuần ĐẠT ngưỡng, không phải mọi đơn trong kỳ", () => {
    expect(SQL).toContain("FILTER (WHERE wk.cnt >= v_oc_cfg.min_order_count)")
  })

  it("tiền thưởng tính trên số đơn ĐƯỢC thưởng, không phải tổng số đơn", () => {
    expect(SQL).toContain("v_oc_bonus := v_oc_paid * v_oc_cfg.bonus_per_order")
    // Công thức cũ nhân với tổng số đơn — không được quay lại.
    expect(SQL).not.toContain("v_oc_bonus := v_oc_count * v_oc_cfg.bonus_per_order")
  })

  it("ghi chu kỳ vào breakdown để phiếu lương giải thích được con số", () => {
    expect(SQL).toContain("'oc_period'")
    expect(SQL).toContain("'oc_paid_count'")
  })
})

describe("094 — số kế toán sửa tay phải sống sót qua 'Tính lại'", () => {
  /**
   * Chạy thật: kế toán đặt manual_adjustment = -2.000.000 và
   * deductions = 500.000 rồi bấm "Tính lại".
   *   067 → cả hai về 0, ghi chú mất, thực lĩnh 10.850.000 đ (thừa 2,5tr)
   *   094 → giữ nguyên,              thực lĩnh  7.150.000 đ
   */
  it("không còn DELETE toàn bộ dòng lương ở đầu hàm", () => {
    expect(SQL).not.toContain("DELETE FROM payroll_run_items WHERE payroll_run_id = p_run_id;")
  })

  it("dùng UPSERT theo khoá (payroll_run_id, user_id)", () => {
    expect(SQL).toContain("ON CONFLICT (payroll_run_id, user_id) DO UPDATE SET")
  })

  it("KHÔNG ghi đè các cột do người nhập", () => {
    const upsert = SQL.slice(
      SQL.indexOf("ON CONFLICT (payroll_run_id, user_id) DO UPDATE SET"),
      SQL.indexOf("v_touched := v_touched || u.id")
    )
    expect(upsert.length).toBeGreaterThan(0)
    for (const col of ["manual_adjustment", "deductions", "overtime", "notes"]) {
      // Cột chỉ được ĐỌC (payroll_run_items.<col>) để tính net, không được
      // nằm bên trái dấu = trong danh sách SET.
      expect(upsert, `cột "${col}" bị ghi đè trong UPSERT`).not.toMatch(
        new RegExp(`^\\s*${col}\\s*=`, "m")
      )
    }
  })

  it("net_salary khớp công thức trong src/lib/payroll/run.ts", () => {
    const ts = readFileSync(
      resolve(__dirname, "../src/lib/payroll/run.ts"),
      "utf-8"
    )
    // Cả hai đường ghi phải cộng/trừ đúng cùng một bộ khoản mục, nếu không
    // dòng lương đổi số tuỳ theo nút bấm cuối cùng là "Tính lại" hay "Lưu".
    const cong = ["prorated_base", "allowances", "kpi_bonus", "order_count_bonus",
                  "activity_bonus", "overtime", "manual_adjustment"]
    const tru = ["deductions", "social_insurance"]
    const upsert = SQL.slice(SQL.indexOf("net_salary         = EXCLUDED.prorated_base"))
      .slice(0, 700)
    for (const k of cong) {
      expect(upsert, `SQL thiếu khoản cộng "${k}"`).toContain(k)
      expect(ts, `TS thiếu khoản cộng "${k}"`).toContain(k)
    }
    for (const k of tru) {
      expect(upsert, `SQL thiếu khoản trừ "${k}"`).toMatch(
        new RegExp(`-\\s*(payroll_run_items\\.|EXCLUDED\\.)${k}`)
      )
    }
  })

  it("dọn dòng thừa của nhân sự đã nghỉ (UPSERT không tự xoá)", () => {
    expect(SQL).toContain("NOT (user_id = ANY (v_touched))")
  })
})

describe("094 — chặn vai trò trên hàm SECURITY DEFINER", () => {
  /**
   * Chạy thật: tài khoản role='sales' gọi thẳng RPC.
   *   067/050 → chạy được, xoá trắng bảng lương cả công ty
   *   094     → ERROR: FORBIDDEN_ROLE
   */
  const ALLOWED = ["owner", "manager", "accountant"]

  it("cả compute_payroll_run và lock_payroll_run đều kiểm vai trò", () => {
    const n = (SQL.match(/FORBIDDEN_ROLE/g) || []).length
    expect(n, "thiếu chặn vai trò ở một trong hai hàm").toBe(2)
  })

  it("chỉ owner/manager/accountant được phép", () => {
    const checks = SQL.match(/NOT IN \('owner', 'manager', 'accountant'\)/g) || []
    expect(checks.length).toBe(2)
    // 'sales', 'warehouse', 'driver' (001_schema.sql:18) không nằm trong đó.
    for (const r of ["sales", "warehouse", "driver"]) {
      expect(ALLOWED).not.toContain(r)
    }
  })

  it("kiểm vai trò nằm TRƯỚC mọi thao tác ghi", () => {
    const iRole = SQL.indexOf("FORBIDDEN_ROLE")
    const iWrite = SQL.indexOf("INSERT INTO payroll_run_items")
    expect(iRole).toBeGreaterThan(0)
    expect(iRole).toBeLessThan(iWrite)
  })

  it("lock_payroll_run giữ nguyên locked_by và điều kiện status = 'draft'", () => {
    // Bản chép tay đầu tiên của tôi đánh rơi cả hai. Ghim lại.
    expect(SQL).toContain("locked_by = auth.uid()")
    expect(SQL).toContain("AND status = 'draft'")
  })
})

describe("094 — trang tổng quan dùng cùng định nghĩa doanh thu", () => {
  /**
   * Chạy thật: 12 đơn thật 120tr + 1 đơn nháp 99tr + 1 đơn đã huỷ 99tr.
   *   093 → 318.000.000 / 14 đơn
   *   094 → 120.000.000 / 12 đơn
   */
  for (const fn of ["dashboard_summary", "dashboard_top_customers", "dashboard_channel_revenue"]) {
    it(`${fn} lọc theo is_revenue_status`, () => {
      const i = SQL.indexOf(`CREATE FUNCTION public.${fn}`)
      expect(i, `không tìm thấy ${fn}`).toBeGreaterThan(0)
      const body = SQL.slice(i, SQL.indexOf("$$;", i))
      expect(body).toContain("is_revenue_status")
    })
  }
})

describe("094 — quy ước migration", () => {
  it("mọi hàm đều DROP trước khi CREATE, hoặc dùng CREATE OR REPLACE", () => {
    const creates = SQL.match(/CREATE (OR REPLACE )?FUNCTION\s+(public\.)?(\w+)/g) || []
    expect(creates.length).toBeGreaterThan(0)
    for (const c of creates) {
      if (c.includes("OR REPLACE")) continue
      const name = c.split(/\s+/).pop()!.replace("public.", "")
      expect(SQL, `hàm ${name} thiếu DROP trước CREATE`).toMatch(
        new RegExp(`DROP FUNCTION IF EXISTS public\\.${name}\\(`)
      )
    }
  })

  it("không cấp quyền cho anon", () => {
    expect(SQL).not.toMatch(/GRANT[^;]*TO\s+anon/)
  })

  it("hàm SECURITY DEFINER vẫn phải kiểm org", () => {
    const n = (SQL.match(/ORG_MISMATCH/g) || []).length
    expect(n).toBe(2)
  })
})
