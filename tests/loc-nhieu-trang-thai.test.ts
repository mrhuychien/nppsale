import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { bamTrangThai, dangChon, tachTrangThai, trangThaiCuaChon } from "../src/lib/list/status-multi"

const read = (p: string) => readFileSync(p, "utf8")

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "phần lọc trạng thái ở các danh sách cho phép chọn nhiều
 *   trạng thái để lọc. VD hiện tất cả các trạng thái trừ Hủy".
 */
describe("status-multi", () => {
  const THU_TU = ["all", "submitted", "partially_invoiced", "completed", "cancelled"]
  it("bấm bật / tắt từng trạng thái; Tất cả bỏ hết; tắt cái cuối về Tất cả", () => {
    let v = "all"
    v = bamTrangThai(v, "completed", THU_TU)
    expect(v).toBe("completed")
    v = bamTrangThai(v, "submitted", THU_TU)
    expect(v).toBe("submitted,completed") // theo thứ tự dải chip, không theo thứ tự bấm
    v = bamTrangThai(v, "partially_invoiced", THU_TU)
    expect(v).toBe("submitted,partially_invoiced,completed") // = tất cả trừ Huỷ
    v = bamTrangThai(v, "completed", THU_TU)
    expect(v).toBe("submitted,partially_invoiced")
    expect(bamTrangThai(v, "all", THU_TU)).toBe("all")
    expect(bamTrangThai("completed", "completed", THU_TU)).toBe("all")
  })
  it("đường dẫn sâu một trạng thái cũ vẫn chạy (?status=draft)", () => {
    expect(tachTrangThai("draft")).toEqual(["draft"])
    expect(bamTrangThai("draft", "completed", THU_TU)).toBe("completed,draft")
  })
  it("nhóm của chip được bung ra trạng thái thật, không trùng", () => {
    const NHOM = { completed: ["completed", "closed"], submitted: ["submitted"] }
    expect(trangThaiCuaChon("all", NHOM)).toBeNull()
    expect(trangThaiCuaChon("", NHOM)).toBeNull()
    expect(trangThaiCuaChon("submitted,completed", NHOM)).toEqual(["submitted", "completed", "closed"])
    expect(trangThaiCuaChon("draft", NHOM)).toEqual(["draft"])
  })
  it("chip nào sáng", () => {
    expect(dangChon("all", "all")).toBe(true)
    expect(dangChon("a,b", "all")).toBe(false)
    expect(dangChon("a,b", "b")).toBe(true)
    expect(dangChon("a,b", "c")).toBe(false)
  })
})

describe("các danh sách dùng chọn nhiều", () => {
  it("Đơn hàng: chip chọn nhiều, lọc theo hợp các nhóm", () => {
    const S = read("src/app/(dashboard)/orders/page.tsx")
    expect(S).toMatch(/<StatusChips\s+multi/)
    expect(S).toContain("const ds = trangThaiCuaChon(status, TAB_STATUSES)")
    expect(S).toContain('x.in("status", ds)')
  })
  it("Hóa đơn: chip chọn nhiều, cả danh sách lẫn tổng tiền", () => {
    const S = read("src/app/(dashboard)/sales-invoices/page.tsx")
    expect(S).toMatch(/<StatusChips\s+multi/)
    expect(S.match(/locTrangThai\(q, status\)/g)?.length).toBe(2)
    expect(S).not.toContain('if (status !== "all") q = q.eq("status", status)')
  })
  it("Trả hàng khách: bấm là bật / tắt, lọc .in", () => {
    const S = read("src/app/(dashboard)/returns/page.tsx")
    expect(S).toContain("setStatusFilter(bamTrangThai(statusFilter, t.value, RETURN_TABS.map((x) => x.value)))")
    expect(S).toContain('x.in("status", ttChon)')
    expect(S).not.toContain('x = x.eq("status", statusFilter)')
  })
  it("Phiếu nhập + Trả hàng NCC cũng chọn nhiều", () => {
    const R = read("src/app/(dashboard)/purchasing/receipts/page.tsx")
    expect(R).toMatch(/<StatusChips[\s\S]{0,400}multi\s+active=\{tab \|\| "all"\}/)
    expect(R).toContain("if (chon && !chon.includes(r.status)) return false")
    const N = read("src/app/(dashboard)/purchase-returns/page.tsx")
    expect(N).toContain("onClick={() => setFilter(bamTrangThai(filter, f, TRANG_THAI_NCC))}")
    expect(N).toContain('q.in("status", chon)')
  })
  it("StatusChips multi: nút bật/tắt (aria-pressed), gửi lên giá trị mới của cả dải", () => {
    const C = read("src/components/ui/status-chips.tsx")
    expect(C).toContain("onClick={() => onPick(multi ? bamTrangThai(active, c.key, thuTu) : c.key)}")
    expect(C).toContain("aria-pressed={multi ? on : undefined}")
  })
})
