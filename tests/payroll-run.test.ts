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
 * Tầng này chỉ bọc RPC, TRỪ một chỗ: `setManualAdjustment` tự tính lại
 * `net_salary` bằng JavaScript. Đó là chỗ duy nhất ở đây chạm thẳng vào số
 * tiền nhân viên nhận, nên là trọng tâm của file test này.
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
        eq: () =>
          Promise.resolve({ data: null, error: o.writeError ?? null }),
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

/** Cùng công thức với v_net trong SQL 067 — viết độc lập để đối chiếu. */
const expectedNet = (r: typeof FULL_ROW, adj: number, si = r.social_insurance) =>
  r.prorated_base +
  r.allowances +
  r.kpi_bonus +
  r.order_count_bonus +
  r.activity_bonus +
  r.overtime +
  adj -
  r.deductions -
  si

describe("setManualAdjustment — tính lại lương thực nhận", () => {
  it("cộng đủ mọi khoản cộng và trừ đủ mọi khoản trừ", async () => {
    const f = fakeClient({ row: FULL_ROW })
    const r = await setManualAdjustment(f.client, "item-1", { manual_adjustment: 250_000 })
    expect(r.error).toBeNull()
    expect(f.updates[0].net_salary).toBe(expectedNet(FULL_ROW, 250_000))
  })

  it("KHÔNG bỏ sót khoản nào — thử đổi từng khoản một", async () => {
    // Nếu ai đó lỡ xoá một dòng khỏi biểu thức net, test này chỉ ra đúng khoản đó.
    const keys = Object.keys(FULL_ROW) as Array<keyof typeof FULL_ROW>
    for (const k of keys) {
      const base = fakeClient({ row: FULL_ROW })
      await setManualAdjustment(base.client, "i", { manual_adjustment: 0 })
      const netBase = Number(base.updates[0].net_salary)

      const bumped = { ...FULL_ROW, [k]: FULL_ROW[k] + 1_000_000 }
      const f = fakeClient({ row: bumped })
      await setManualAdjustment(f.client, "i", { manual_adjustment: 0 })
      const netBumped = Number(f.updates[0].net_salary)

      const delta = netBumped - netBase
      const isDeduction = k === "deductions" || k === "social_insurance"
      expect(delta, `khoản "${k}" không ảnh hưởng tới net_salary`).toBe(
        isDeduction ? -1_000_000 : 1_000_000
      )
    }
  })

  it("điều chỉnh tay ÂM làm giảm lương đúng bằng số đó", async () => {
    const f = fakeClient({ row: FULL_ROW })
    await setManualAdjustment(f.client, "i", { manual_adjustment: -500_000 })
    expect(f.updates[0].net_salary).toBe(expectedNet(FULL_ROW, -500_000))
  })

  it("ghi đè BHXH khi được truyền vào", async () => {
    const f = fakeClient({ row: FULL_ROW })
    await setManualAdjustment(f.client, "i", { manual_adjustment: 0, social_insurance: 0 })
    expect(f.updates[0].social_insurance).toBe(0)
    expect(f.updates[0].net_salary).toBe(expectedNet(FULL_ROW, 0, 0))
  })

  it("KHÔNG truyền BHXH thì giữ nguyên giá trị cũ, không về 0", async () => {
    // Về 0 nhầm là mỗi lần sửa ghi chú lại làm lương tăng thêm 1 triệu.
    const f = fakeClient({ row: FULL_ROW })
    await setManualAdjustment(f.client, "i", { manual_adjustment: 0 })
    expect(f.updates[0].social_insurance).toBe(FULL_ROW.social_insurance)
  })

  it("truyền BHXH = 0 phân biệt được với KHÔNG truyền", async () => {
    // `patch.social_insurance !== undefined` chứ không phải `|| r.social_insurance`.
    const a = fakeClient({ row: FULL_ROW })
    await setManualAdjustment(a.client, "i", { manual_adjustment: 0, social_insurance: 0 })
    const b = fakeClient({ row: FULL_ROW })
    await setManualAdjustment(b.client, "i", { manual_adjustment: 0 })
    expect(a.updates[0].social_insurance).toBe(0)
    expect(b.updates[0].social_insurance).toBe(FULL_ROW.social_insurance)
  })

  it("cột allowances thiếu (DB chưa chạy migration 064) được coi là 0, không thành NaN", async () => {
    const noAllowance = { ...FULL_ROW, allowances: null }
    const f = fakeClient({ row: noAllowance })
    await setManualAdjustment(f.client, "i", { manual_adjustment: 0 })
    const net = Number(f.updates[0].net_salary)
    expect(Number.isNaN(net)).toBe(false)
    expect(net).toBe(expectedNet({ ...FULL_ROW, allowances: 0 }, 0))
  })

  it("mọi khoản null đều quy về 0, lương ra 0 chứ không NaN", async () => {
    const allNull = Object.fromEntries(
      Object.keys(FULL_ROW).map((k) => [k, null])
    ) as unknown as typeof FULL_ROW
    const f = fakeClient({ row: allNull })
    await setManualAdjustment(f.client, "i", { manual_adjustment: 0 })
    expect(f.updates[0].net_salary).toBe(0)
  })

  it("ghi chú trống được lưu thành null chứ không phải chuỗi rỗng", async () => {
    const f = fakeClient({ row: FULL_ROW })
    await setManualAdjustment(f.client, "i", { manual_adjustment: 0 })
    expect(f.updates[0].notes).toBeNull()
  })

  it("ghi chú có nội dung thì được lưu nguyên văn", async () => {
    const f = fakeClient({ row: FULL_ROW })
    await setManualAdjustment(f.client, "i", {
      manual_adjustment: 0,
      notes: "Thưởng thêm theo quyết định giám đốc",
    })
    expect(f.updates[0].notes).toBe("Thưởng thêm theo quyết định giám đốc")
  })

  it("đọc dòng lỗi thì KHÔNG ghi gì cả", async () => {
    // Ghi khi chưa đọc được là ghi đè lương bằng số tính từ dữ liệu rỗng.
    const f = fakeClient({ row: null, readError: { message: "permission denied" } })
    const r = await setManualAdjustment(f.client, "i", { manual_adjustment: 100 })
    expect(r.error).toBe("permission denied")
    expect(f.updates).toHaveLength(0)
  })

  it("không tìm thấy dòng thì báo lỗi và không ghi", async () => {
    const f = fakeClient({ row: null })
    const r = await setManualAdjustment(f.client, "i", { manual_adjustment: 100 })
    expect(r.error).toBeTruthy()
    expect(f.updates).toHaveLength(0)
  })

  it("ghi lỗi thì trả lỗi ra ngoài, không nuốt", async () => {
    const f = fakeClient({ row: FULL_ROW, writeError: { message: "row is locked" } })
    const r = await setManualAdjustment(f.client, "i", { manual_adjustment: 100 })
    expect(r.error).toBe("row is locked")
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

  it("kỳ lương đã khoá: lỗi từ database được trả nguyên văn ra giao diện", async () => {
    // SQL raise PAYROLL_RUN_LOCKED. Nuốt lỗi ở đây là người dùng bấm Tính lại
    // rồi tưởng đã tính, trong khi bảng lương giữ nguyên số cũ.
    const f = fakeClient({ rpcError: { message: "PAYROLL_RUN_LOCKED" } })
    const r = await computePayrollRun(f.client, "run-1")
    expect(r.error).toBe("PAYROLL_RUN_LOCKED")
    expect(r.count).toBe(0)
  })

  it("sai tổ chức: lỗi ORG_MISMATCH cũng phải nổi lên", async () => {
    const f = fakeClient({ rpcError: { message: "ORG_MISMATCH" } })
    expect((await computePayrollRun(f.client, "run-1")).error).toBe("ORG_MISMATCH")
  })

  it("lockPayrollRun gọi đúng RPC và trả null khi thành công", async () => {
    const f = fakeClient({})
    const r = await lockPayrollRun(f.client, "run-1")
    expect(r.error).toBeNull()
    expect(f.rpc).toHaveBeenCalledWith("lock_payroll_run", { p_run_id: "run-1" })
  })

  it("khoá kỳ lương lỗi thì báo ra, không im lặng", async () => {
    const f = fakeClient({ rpcError: { message: "PAYROLL_RUN_NOT_FOUND" } })
    expect((await lockPayrollRun(f.client, "run-1")).error).toBe("PAYROLL_RUN_NOT_FOUND")
  })
})
