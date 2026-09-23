import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { duocVaoTrang } from "../src/lib/nav/nav-permission"
import { duocQuaCongSettings } from "../src/lib/nav/settings-gate"
import type { Module } from "../src/lib/permissions"

/**
 * ĐỢT 5 QA — CỬA VÀO KHỚP QUYỀN GHI DƯỚI DATABASE (22/09/2026).
 *
 * ⚠ ĐÃ ĐO TRÊN POSTGRES 16: người vào được màn tạo mới mà RLS không cho
 *   chèn thì làm xong cả phiếu mới bị từ chối lúc lưu —
 *     /suppliers/new      : NVBH, kế toán  → 42501
 *     /promotions/new     : NVBH, kế toán  → 42501
 *     /commissions/policies/new : quản lý  → 42501
 *     /payables/new       : NVBH, quản lý  → 42501
 *     /invoices/new       : NVBH           → 42501
 *     /receivables/collect: quản lý → FORBIDDEN (create_cash_receipt đòi receivables.create)
 *
 * ⚠ LUẬT CHỐT: ai vào được màn TẠO thì RLS phải cho người ấy chèn —
 *   cửa vào là TẬP CON của vai trong chính sách. Chốt đọc chính sách mới
 *   nhất từ migration rồi so, không chép tay danh sách vai.
 */

const DIR = resolve(__dirname, "..", "supabase/migrations")
const TEP = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(resolve(DIR, f), "utf-8"))
const VAI = ["owner", "manager", "accountant", "sales", "warehouse"] as const

function vaiChinhSach(ten: string): string[] {
  const neo = `CREATE POLICY "${ten}"`
  const co = TEP.filter((s) => s.includes(neo))
  expect(co.length, ten).toBeGreaterThan(0)
  const s = co[co.length - 1]
  const p = s.slice(s.indexOf(neo), s.indexOf(";", s.indexOf(neo)))
  const m = p.match(/user_role\(\)\s+IN\s*\(([^)]*)\)/) ?? p.match(/user_role\(\)\s*=\s*'(\w+)'/)
  expect(m, p).toBeTruthy()
  return Array.from(m![1].matchAll(/'?([a-z]+)'?/g), (x) => x[1]).filter((v) => (VAI as readonly string[]).includes(v))
}

describe("vào được màn tạo ⇒ RLS cho chèn", () => {
  it.each([
    ["/suppliers/new", "inventory", "Owner/Manager can manage suppliers"],
    ["/promotions/new", "promotions", "Owner/Manager can manage promotions"],
    ["/payables/new", "receivables", "Manage payables"],
    ["/invoices/new", "invoices", "Owner/Accountant can manage invoices"],
  ] as const)("%s", (href, mod, chinhSach) => {
    const rls = vaiChinhSach(chinhSach)
    for (const v of VAI) {
      if (duocVaoTrang(v, href, mod as Module)) {
        expect(rls, `${v} vào được ${href} nhưng RLS "${chinhSach}" không cho chèn`).toContain(v)
      }
    }
  })

  it("/commissions/policies/new chỉ cho chủ (RLS commission_policies chỉ owner)", () => {
    for (const v of VAI) {
      expect(duocVaoTrang(v, "/commissions/policies/new", "commissions"), v).toBe(v === "owner")
    }
  })

  it("/receivables/collect: quản lý không vào (RPC đòi receivables.create)", () => {
    expect(duocVaoTrang("manager", "/receivables/collect", "receivables")).toBe(false)
    expect(duocVaoTrang("accountant", "/receivables/collect", "receivables")).toBe(true)
    expect(duocVaoTrang("sales", "/receivables/collect", "receivables")).toBe(true)
  })
})

describe("cổng /settings ở middleware lấy từ ma trận quyền", () => {
  it.each([
    ["owner", true], ["manager", true], ["accountant", true],
    ["sales", false], ["warehouse", false], ["driver", false], [null, false],
  ] as const)("%s → %s", (vai, can) => {
    expect(duocQuaCongSettings(vai)).toBe(can)
  })

  it("middleware không còn danh sách vai viết tay", () => {
    const s = readFileSync(resolve(__dirname, "..", "src/lib/supabase/middleware.ts"), "utf-8")
    expect(s).toContain("duocQuaCongSettings(profile.role)")
    const i = s.indexOf('startsWith("/settings")')
    expect(s.slice(i, i + 800)).not.toMatch(/\["owner", "manager"\]\.includes/)
  })
})

/**
 * ⚠ NÚT KHỚP ĐÚNG CHÍNH SÁCH CỦA BẢNG NÓ GHI (đợt QA 22/09/2026). Mỗi
 *   dòng dưới đây đã đo: vai được mời bấm → RLS lặng lẽ 0 dòng / 42501.
 */
describe("nút mảng tiền khớp RLS", () => {
  const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")

  it("xác nhận phiếu thu: chủ + kế toán (giao của cash_receipts và payments)", () => {
    expect(vaiChinhSach("Accountant can verify payments").sort()).toEqual(["accountant", "owner"])
    expect(doc("src/app/(dashboard)/finance/cash-receipts/[id]/page.tsx")).toContain(
      '["owner", "accountant"].includes(user.role) && receipt?.status === "pending"'
    )
  })

  it("sửa chính sách hoa hồng: chỉ chủ", () => {
    expect(doc("src/app/(dashboard)/commissions/policies/[id]/page.tsx")).toContain('const canEdit = user && user.role === "owner"')
  })

  it("xoá chi phí: chủ + quản lý (expenses_delete)", () => {
    const s = doc("src/app/(dashboard)/finance/expenses/page.tsx")
    expect(s).toContain('const canDelete = user && ["owner", "manager"].includes(user.role)')
    expect(s).toMatch(/\{canDelete && e\.source_type === null && \(/)
  })

  it("xoá bậc lương / thưởng: có bắt lỗi", () => {
    const s = doc("src/app/(dashboard)/settings/users/[id]/salary/page.tsx")
    for (const t of ["salary_kpi_tiers", "salary_order_count_bonus_configs", "monthly_activity_bonuses"]) {
      const i = s.indexOf(`from("${t}").delete()`)
      expect(s.slice(i, i + 400), t).toContain("} catch (e) {")
    }
  })

  it.each(["src/app/(dashboard)/receivables/[id]/page.tsx", "src/app/(dashboard)/payables/[id]/page.tsx"])(
    "%s: 'Đặt lại trạng thái mở' chỉ khi chưa thu / trả đồng nào",
    (p) => {
      const s = doc(p)
      const i = s.indexOf('label: "Đặt lại trạng thái mở"')
      expect(s.slice(i, i + 250)).toMatch(/\.paid \|\| 0\) === 0/)
    }
  )
})

describe("đọc một dòng từ cột không unique", () => {
  // Bỏ chú thích: lời giải thích nhắc `.maybeSingle()` thì phép cắt dừng nhầm chỗ.
  const doc = (p: string) =>
    readFileSync(resolve(__dirname, "..", p), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
  /**
   * ⚠ `.maybeSingle()` trên nhiều dòng là PGRST116 — không phải "không có".
   *   `invoices.sales_invoice_id` và phân công chính của khách đều có thể
   *   nhiều dòng; phải thu về đúng một dòng trước khi `.maybeSingle()`.
   */
  it.each([
    "src/app/(dashboard)/sales-invoices/[id]/page.tsx",
    "src/app/(dashboard)/sales-invoices/[id]/print/page.tsx",
    "src/components/pos/invoice-screen.tsx",
  ])("%s: hoá đơn điện tử lấy đúng một tờ", (p) => {
    const s = doc(p)
    const i = s.indexOf('.eq("sales_invoice_id"')
    const doan = s.slice(i, s.indexOf(".maybeSingle()", i))
    expect(doan).toContain(".limit(1)")
  })

  it("phân công chính khi check-in: chỉ dòng còn hiệu lực, một dòng", () => {
    const s = doc("src/components/customers/visit-checkin-dialog.tsx")
    const i = s.indexOf('.from("customer_assignments")')
    const doan = s.slice(i, s.indexOf(".maybeSingle()", i))
    expect(doan).toContain('.or("status.is.null,status.eq.active")')
    expect(doan).toContain(".limit(1)")
  })
})
