import { describe, it, expect, vi } from "vitest"
import {
  ensurePayrollRun,
  computePayrollRun,
  lockPayrollRun,
  setManualAdjustment,
} from "@/lib/payroll/run"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Bảng lương — tầng TypeScript.
 *
 * Phép tính lương THẬT nằm trong SQL (`compute_payroll_run`, migration 067).
 * Tầng này chỉ bọc RPC. Từ mig 173 `setManualAdjustment` KHÔNG còn tự
 * tính `net_salary` — trigger dưới database làm việc ấy (xem chốt cuối).
 *
 * Công thức phải khớp với v_net trong SQL 067:
 *     net = lương CB hiệu lực + phụ cấp + KPI + thưởng số đơn
 *           + thưởng hoạt động + tăng ca + điều chỉnh tay
 *           − khấu trừ − BHXH
 * Lệch một khoản là trả sai lương, và không ai phát hiện cho tới khi nhân
 * viên khiếu nại.
 */

// ------------------------------------------------------------------
// Client giả: đủ để chạy các chuỗi mà run.ts dùng.
// ------------------------------------------------------------------

interface FakeOpts {
  /** Dòng payroll_run_items mà select().single() trả về. */
  row?: Record<string, unknown> | null
  readError?: { message: string } | null
  writeError?: { message: string } | null
  /** Dòng payroll_runs mà maybeSingle() trả về (ensurePayrollRun). */
  existingRun?: Record<string, unknown> | null
  findError?: { message: string } | null
  insertedRun?: Record<string, unknown> | null
  insertError?: { message: string } | null
  rpcData?: unknown
  rpcError?: { message: string } | null
  /** RLS từ chối lệnh sửa: 0 dòng, không lỗi. */
  zeroRows?: boolean
}

function fakeClient(o: FakeOpts = {}) {
  const updates: Array<Record<string, unknown>> = []
  const inserts: Array<Record<string, unknown>> = []
  const rpc = vi.fn().mockResolvedValue({
    data: o.rpcData ?? null,
    error: o.rpcError ?? null,
  })

  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    select: () => chain,
    eq: () => chain,
    insert: (row: Record<string, unknown>) => {
      inserts.push(row)
      return chain
    },
    update: (patch: Record<string, unknown>) => {
      updates.push(patch)
      // `.update(...).eq(...)` được await trực tiếp → phải là thenable.
      return {
        eq: () => ({
          select: () =>
            Promise.resolve({
              data: o.writeError ? null : o.zeroRows ? [] : [{ id: "x" }],
              error: o.writeError ?? null,
            }),
        }),
      }
    },
    maybeSingle: () =>
      Promise.resolve({
        data: o.existingRun ?? null,
        error: o.findError ?? null,
      }),
    single: () =>
      Promise.resolve(
        inserts.length > 0
          ? { data: o.insertedRun ?? null, error: o.insertError ?? null }
          : { data: o.row ?? null, error: o.readError ?? null }
      ),
  })

  return {
    client: { from: () => chain, rpc } as unknown as SupabaseClient,
    updates,
    inserts,
    rpc,
  }
}

/** Dòng lương đầy đủ, mọi khoản khác 0 để phát hiện khoản bị bỏ sót. */
const FULL_ROW = {
  prorated_base: 10_000_000,
  allowances: 1_000_000,
  kpi_bonus: 2_000_000,
  order_count_bonus: 500_000,
  activity_bonus: 300_000,
  overtime: 400_000,
  deductions: 200_000,
  social_insurance: 1_050_000,
}

/**
 * ⚠ TỪ MIG 173 LƯƠNG THỰC NHẬN DO MÁY CHỦ TÍNH (trigger
 *   `trg_tinh_luong_thuc_nhan`). Bản cũ cộng trừ ở đây rồi ghi thẳng
 *   `net_salary` — ai sửa được dòng lương là ghi được một con số bất kỳ.
 *   Đã đo: gửi net = 999.999.999, máy chủ ghi 10.600.000 đúng các khoản.
 */
describe("setManualAdjustment — không tự tính lương thực nhận", () => {
  it("KHÔNG gửi net_salary — máy chủ tính", async () => {
    const f = fakeClient({ row: FULL_ROW })
    const r = await setManualAdjustment(f.client, "item-1", { manual_adjustment: 250_000 })
    expect(r.error).toBeNull()
    expect(f.updates[0]).not.toHaveProperty("net_salary")
    expect(f.updates[0].manual_adjustment).toBe(250_000)
  })

  it("truyền BHXH = 0 phân biệt được với KHÔNG truyền", async () => {
    const a = fakeClient({ row: FULL_ROW })
    await setManualAdjustment(a.client, "i", { manual_adjustment: 0, social_insurance: 0 })
    const b = fakeClient({ row: FULL_ROW })
    await setManualAdjustment(b.client, "i", { manual_adjustment: 0 })
    expect(a.updates[0].social_insurance).toBe(0)
    // Không truyền thì KHÔNG đụng cột — về 0 nhầm là lương tăng thêm cả khoản BHXH.
    expect(b.updates[0]).not.toHaveProperty("social_insurance")
  })

  it("RLS từ chối (0 dòng) thì báo lỗi, không báo đã lưu", async () => {
    const f = fakeClient({ row: FULL_ROW, zeroRows: true })
    const r = await setManualAdjustment(f.client, "i", { manual_adjustment: 1 })
    expect(r.error).toMatch(/không có quyền|đã khoá/)
  })

  it("lỗi ghi thì trả lỗi", async () => {
    const f = fakeClient({ row: FULL_ROW, writeError: { message: "PAYROLL_RUN_LOCKED" } })
    const r = await setManualAdjustment(f.client, "i", { manual_adjustment: 1 })
    expect(r.error).toBeTruthy()
  })
})

/**
 * ⚠ CÔNG THỨC CỦA TRIGGER PHẢI KHỚP `compute_payroll_run` TỪNG KHOẢN. Lệch
 *   một khoản là mỗi lần kế toán sửa một ô, lương thực nhận nhảy khác với
 *   lúc bấm "Tính lương". Chốt đọc cả hai công thức từ migration và so
 *   tập (khoản, dấu).
 */
describe("công thức lương thực nhận: trigger = compute_payroll_run", async () => {
  const { readFileSync, readdirSync } = await import("node:fs")
  const { resolve } = await import("node:path")
  const dir = resolve(__dirname, "..", "supabase/migrations")
  const tep = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
  const doc = (f: string) => readFileSync(resolve(dir, f), "utf-8")

  const khoan = (bieuThuc: string, tienTo: RegExp) =>
    Array.from(bieuThuc.matchAll(tienTo), (m) => `${m[1]}${m[2]}`).sort()

  it("cùng tập khoản, cùng dấu", () => {
    const m173 = doc(tep.find((f) => f.startsWith("173_"))!)
    const trg = m173.slice(m173.indexOf("NEW.net_salary :="), m173.indexOf(";", m173.indexOf("NEW.net_salary :=")))
    const tuTrigger = khoan("+" + trg.slice(trg.indexOf(":=") + 2), /([+-])\s*COALESCE\(NEW\.(\w+)/g)

    const coCompute = tep.map(doc).filter((s) => s.includes("FUNCTION public.compute_payroll_run") || s.includes("FUNCTION compute_payroll_run"))
    const src = coCompute[coCompute.length - 1]
    const i = src.lastIndexOf("net_salary         = EXCLUDED.prorated_base")
    expect(i, "không tìm thấy công thức trong compute_payroll_run").toBeGreaterThan(0)
    const bt = src.slice(i + "net_salary         =".length, src.indexOf(";", i))
    const tuCompute = khoan("+" + bt, /([+-])\s*(?:EXCLUDED|payroll_run_items)\.(\w+)/g)

    expect(tuTrigger).toEqual(tuCompute)
    expect(tuTrigger).toHaveLength(9)
  })
})

describe("ensurePayrollRun — mỗi (tổ chức, tháng) một kỳ lương", () => {
  const RUN = { id: "run-1", org_id: "org-1", month: "2026-08-01", status: "draft" }

  it("đã có kỳ lương thì trả về kỳ cũ, KHÔNG tạo mới", async () => {
    // Tạo trùng là hai bảng lương cùng tháng, trả lương hai lần.
    const f = fakeClient({ existingRun: RUN })
    const r = await ensurePayrollRun(f.client, {
      orgId: "org-1", month: "2026-08-01", userId: "u1",
    })
    expect(r.run?.id).toBe("run-1")
    expect(f.inserts).toHaveLength(0)
  })

  it("chưa có thì tạo mới ở trạng thái nháp", async () => {
    const f = fakeClient({ existingRun: null, insertedRun: RUN })
    const r = await ensurePayrollRun(f.client, {
      orgId: "org-1", month: "2026-08-01", userId: "u1",
    })
    expect(r.error).toBeNull()
    expect(f.inserts[0]).toMatchObject({
      org_id: "org-1",
      month: "2026-08-01",
      status: "draft",
      created_by: "u1",
    })
  })

  it("truy vấn tìm kiếm lỗi thì KHÔNG tạo mới", async () => {
    // Tạo mới khi chưa biết đã có hay chưa là nguồn gốc của kỳ lương trùng.
    const f = fakeClient({ findError: { message: "timeout" } })
    const r = await ensurePayrollRun(f.client, {
      orgId: "org-1", month: "2026-08-01", userId: "u1",
    })
    expect(r.error).toBe("timeout")
    expect(r.run).toBeNull()
    expect(f.inserts).toHaveLength(0)
  })

  it("tạo mới lỗi thì trả lỗi, không trả kỳ lương rỗng", async () => {
    const f = fakeClient({
      existingRun: null,
      insertError: { message: "duplicate key value violates unique constraint" },
    })
    const r = await ensurePayrollRun(f.client, {
      orgId: "org-1", month: "2026-08-01", userId: "u1",
    })
    expect(r.run).toBeNull()
    expect(r.error).toContain("duplicate key")
  })
})

describe("computePayrollRun / lockPayrollRun — bọc RPC", () => {
  it("computePayrollRun trả về số dòng lương đã tính", async () => {
    const f = fakeClient({ rpcData: 12 })
    const r = await computePayrollRun(f.client, "run-1")
    expect(r.count).toBe(12)
    expect(r.error).toBeNull()
    expect(f.rpc).toHaveBeenCalledWith("compute_payroll_run", { p_run_id: "run-1" })
  })

  it("RPC trả null thì count = 0, không NaN", async () => {
    const f = fakeClient({ rpcData: null })
    expect((await computePayrollRun(f.client, "run-1")).count).toBe(0)
  })

  it("kỳ lương đã khoá: lỗi nổi lên giao diện, dịch sang tiếng Việt", async () => {
    // SQL raise PAYROLL_RUN_LOCKED. Nuốt lỗi ở đây là người dùng bấm Tính lại
    // rồi tưởng đã tính, trong khi bảng lương giữ nguyên số cũ. Nhưng đưa
    // thẳng mã kỹ thuật lên toast thì kế toán đọc "PAYROLL_RUN_LOCKED" và
    // cũng không biết phải làm gì — nên bọc lại thành câu đọc được.
    const f = fakeClient({ rpcError: { message: "PAYROLL_RUN_LOCKED" } })
    const r = await computePayrollRun(f.client, "run-1")
    expect(r.error).toContain("đã khoá")
    expect(r.error).not.toContain("PAYROLL_RUN_LOCKED")
    expect(r.count).toBe(0)
  })

  it("sai tổ chức: lỗi ORG_MISMATCH cũng phải nổi lên", async () => {
    const f = fakeClient({ rpcError: { message: "ORG_MISMATCH" } })
    expect((await computePayrollRun(f.client, "run-1")).error).toContain(
      "không thuộc đơn vị"
    )
  })

  it("sai vai trò: nói rõ ai mới được tính lương (mig 094)", async () => {
    // 094 thêm chốt chặn vai trò trong chính hàm SQL vì hàm là
    // SECURITY DEFINER và GRANT cho mọi tài khoản đã đăng nhập.
    const f = fakeClient({ rpcError: { message: "FORBIDDEN_ROLE" } })
    const r = await computePayrollRun(f.client, "run-1")
    expect(r.error).toContain("kế toán")
    expect(r.error).not.toContain("FORBIDDEN_ROLE")
  })

  it("lỗi lạ không nằm trong bảng dịch thì giữ nguyên văn, không nuốt", async () => {
    const f = fakeClient({ rpcError: { message: "deadlock detected" } })
    expect((await computePayrollRun(f.client, "run-1")).error).toBe("deadlock detected")
  })

  it("lockPayrollRun gọi đúng RPC và trả null khi thành công", async () => {
    const f = fakeClient({})
    const r = await lockPayrollRun(f.client, "run-1")
    expect(r.error).toBeNull()
    expect(f.rpc).toHaveBeenCalledWith("lock_payroll_run", { p_run_id: "run-1" })
  })

  it("khoá kỳ lương lỗi thì báo ra, không im lặng", async () => {
    const f = fakeClient({ rpcError: { message: "PAYROLL_RUN_NOT_FOUND" } })
    expect((await lockPayrollRun(f.client, "run-1")).error).toContain(
      "Không tìm thấy kỳ lương"
    )
  })
})

/**
 * ⚠ KẾ TOÁN LÀM ĐƯỢC BẢNG LƯƠNG Ở MỌI LỚP (mig 173). Hai RPC và middleware
 *   `/hr` cho owner / manager / accountant; RLS cũ chỉ owner / manager —
 *   kế toán bấm Tính lương được mà không đọc lại được kỳ lương.
 */
describe("vai làm bảng lương khớp giữa RLS và RPC", async () => {
  const { readFileSync, readdirSync } = await import("node:fs")
  const { resolve } = await import("node:path")
  const dir = resolve(__dirname, "..", "supabase/migrations")
  const tat = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(resolve(dir, f), "utf-8"))
  const cuoi = (neo: string) => {
    const s = tat.filter((x) => x.includes(neo)).pop()!
    return s.slice(s.lastIndexOf(neo), s.indexOf(";", s.lastIndexOf(neo)))
  }
  const vai = (sql: string) =>
    Array.from((sql.match(/user_role\(\)\s+IN\s*\(([^)]*)\)/) ?? ["", ""])[1].matchAll(/'(\w+)'/g), (m) => m[1]).sort()

  it.each(["CREATE POLICY org_iso_pr ON", "CREATE POLICY org_iso_pri ON"])("%s", (neo) => {
    expect(vai(cuoi(neo))).toEqual(["accountant", "manager", "owner"])
  })
})
