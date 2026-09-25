import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { ORDER_STATUS_MAP } from "@/lib/constants"
import { anDonHuy } from "@/lib/orders/an-don-huy"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "gộp trạng thái Xuất một phần vào Hoàn thành (coi như Hoàn thành)
 *   bỏ trạng thái Xuất một phần. * Trạng thái Đã huỷ -> Ẩn với nhân viên bán hàng."
 */
const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
const ORDERS = doc("src/app/(dashboard)/orders/page.tsx")

describe("gộp Xuất một phần vào Hoàn thành", () => {
  it("nhãn chung: xuất một phần hiện Hoàn thành", () => {
    expect(ORDER_STATUS_MAP.partially_invoiced).toEqual(ORDER_STATUS_MAP.completed)
  })
  it("không còn chữ 'Xuất một phần' trên màn nào", () => {
    for (const f of [
      "src/app/(dashboard)/orders/page.tsx",
      "src/components/pos/pending-orders-modal.tsx",
      "src/lib/constants.ts",
    ]) {
      expect(doc(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), f).not.toContain("Xuất một phần")
    }
  })
})

describe("NVBH không thấy đơn đã huỷ", () => {
  it("anDonHuy bỏ đơn huỷ chỉ với NVBH", () => {
    const rows = [{ status: "completed" }, { status: "cancelled" }]
    expect(anDonHuy(rows, true)).toEqual([{ status: "completed" }])
    expect(anDonHuy(rows, false)).toEqual(rows)
  })
  it("danh sách đơn: bỏ tab Đã huỷ và lọc status ≠ cancelled cho NVBH", () => {
    expect(ORDERS).toContain('isSales ? ORDER_TABS.filter((k) => k !== "cancelled") : ORDER_TABS')
    expect(ORDERS).toContain('if (isSales) x = x.neq("status", "cancelled")')
  })
  it("chi tiết khách: đơn đi qua anDonHuy", () => {
    expect(doc("src/app/(dashboard)/customers/[id]/page.tsx")).toContain("anDonHuy(allOrdersRes.rows, laNvbh)")
  })
})
