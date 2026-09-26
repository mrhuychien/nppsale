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
  /**
   * ⚠ CHỦ NHÀ 25/09/2026: "Khi ấn vào tất cả thì chọn hết các trạng thái luôn" — "Tất cả"
   *   là MỌI chip cùng sáng; đang Tất cả bấm một chip là TẮT chip đó.
   */
  it("Tất cả = mọi chip sáng; bấm một chip từ Tất cả là tắt chip đó", () => {
    let v = "all"
    v = bamTrangThai(v, "cancelled", THU_TU)
    expect(v).toBe("submitted,partially_invoiced,completed") // = tất cả trừ Huỷ, một cú bấm
    v = bamTrangThai(v, "completed", THU_TU)
    expect(v).toBe("submitted,partially_invoiced")
    v = bamTrangThai(v, "completed", THU_TU)
    expect(v).toBe("submitted,partially_invoiced,completed")
    // Bật lại đủ mọi chip → về Tất cả.
    expect(bamTrangThai(v, "cancelled", THU_TU)).toBe("all")
    expect(bamTrangThai(v, "all", THU_TU)).toBe("all")
    /* ⚠ LẬT 26/09/2026 — chủ nhà: "ấn thêm 1 lần vào tất cả thì bỏ chọn tất cả các trạng
       thái". Tắt chip cuối cùng cũng là bỏ chọn hết (không còn tự về Tất cả). */
    expect(bamTrangThai("completed", "completed", THU_TU)).toBe("none")
    expect(bamTrangThai("completed", "submitted", THU_TU)).toBe("submitted,completed")
  })
  it("bấm Tất cả lần 1 chọn hết, lần 2 bỏ chọn hết; từ bỏ-hết bấm chip là chọn mình chip đó", () => {
    expect(bamTrangThai("submitted", "all", THU_TU)).toBe("all")
    expect(bamTrangThai("all", "all", THU_TU)).toBe("none")
    expect(bamTrangThai("none", "all", THU_TU)).toBe("all")
    expect(bamTrangThai("none", "completed", THU_TU)).toBe("completed")
    for (const k of ["all", ...THU_TU]) expect(dangChon("none", k), k).toBe(false)
    expect(dangChon("all", "all")).toBe(true)
    // Bỏ chọn hết = danh sách rỗng (lọc theo trạng thái không tồn tại), không phải "không lọc".
    const ds = trangThaiCuaChon("none", { completed: ["completed", "closed"] })
    expect(ds).not.toBeNull()
    expect(ds!.some((x) => THU_TU.includes(x))).toBe(false)
    expect(tachTrangThai("none")).toEqual([])
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
    // "Tất cả" → mọi chip cùng sáng.
    expect(dangChon("all", "completed")).toBe(true)
    expect(dangChon("", "cancelled")).toBe(true)
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

describe("lọc trạng thái được nhớ qua lần tải lại", () => {
  /** ⚠ CHỦ NHÀ 25/09/2026: "Các danh sách khi chọn lọc trạng thái ko lưu ? Load lại là ra như ban đầu." */
  it.each([
    ["orders", "src/app/(dashboard)/orders/page.tsx", 'useLuuTrangThai("orders", "")'],
    ["sales-invoices", "src/app/(dashboard)/sales-invoices/page.tsx", 'useLuuTrangThai("sales-invoices", "posted")'],
    ["returns", "src/app/(dashboard)/returns/page.tsx", 'useLuuTrangThai("returns", MAC_DINH_TRANG_THAI)'],
    ["purchase-returns", "src/app/(dashboard)/purchase-returns/page.tsx", 'useLuuTrangThai("purchase-returns", "all")'],
    ["purchase-receipts", "src/app/(dashboard)/purchasing/receipts/page.tsx", 'useLuuTrangThai("purchase-receipts", "")'],
  ])("%s dùng useLuuTrangThai", (_k, f, dong) => {
    expect(read(f)).toContain(dong)
  })
  it("hook đọc sau khi gắn (không lỗi hydrate), đường dẫn ?status= thắng, bọc try/catch", () => {
    const H = read("src/hooks/use-luu-trang-thai.ts")
    expect(H).toContain('if (new URLSearchParams(window.location.search).has("status")) return')
    expect(H).toContain("window.localStorage.setItem(TIEN_TO + khoa, x)")
    expect(H.match(/try \{/g)?.length).toBe(2)
  })
})
