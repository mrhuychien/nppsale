import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { mucCanDung } from "@/lib/ui/muc-chon"
import { cauTrongKhachLoc, mucKhachLoc } from "@/hooks/use-khach-loc"

/**
 * ⚠ CHỦ NHÀ 23/10/2026: "tốc độ load trang chậm lắm" — đợt 2–3: bớt việc vẽ thừa ở màn Khách hàng trên điện thoại và
 *   bớt JS mọi trang phải tải (phần chỉ dùng khi bấm thì tải lúc bấm).
 */
const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8")

describe("mucCanDung — ô chọn dài đóng thì chỉ dựng mục đang chọn", () => {
  const ds = [{ id: "a" }, { id: "b" }, { id: "c" }]
  const khoa = (x: { id: string }) => x.id

  it("đóng: chỉ mục đang chọn — ô vẫn hiện đúng chữ của nó", () => {
    expect(mucCanDung(ds, "b", false, khoa)).toEqual([{ id: "b" }])
  })

  it("đóng, đang chọn mục chung ngoài danh sách (Tất cả / Chưa có…): không dựng mục nào", () => {
    expect(mucCanDung(ds, "all", false, khoa)).toEqual([])
  })

  it("mở: đủ mục, đúng thứ tự", () => {
    expect(mucCanDung(ds, "b", true, khoa)).toBe(ds)
  })
})

describe("màn Khách hàng: ô Tuyến / Phường / Phụ trách dùng mucCanDung (điện thoại + thanh lọc máy tính)", () => {
  it("điện thoại", () => {
    const s = doc("src/components/customers/mobile-customers-screen.tsx")
    expect(s).toContain("mucCanDung(routes, channelFilter, moTuyen,")
    expect(s).toContain("mucCanDung(wards, wardFilter, moPhuong,")
    expect(s).toContain("mucCanDung(salesUsers, salesFilter, moNv,")
    for (const mo of ["setMoTuyen", "setMoPhuong", "setMoNv"]) expect(s).toContain(`onOpenChange={${mo}}`)
  })

  it("máy tính", () => {
    const s = doc("src/app/(dashboard)/customers/page.tsx")
    expect(s).toContain("mucCanDung(routes, channelFilter, moTuyen,")
    expect(s).toContain("mucCanDung(dsPhuong, wardFilter, moPhuong,")
    expect(s).toContain("mucCanDung(salesUsers, salesUserFilter, moNv,")
    for (const mo of ["setMoTuyen", "setMoPhuong", "setMoNv"]) expect(s).toContain(`onOpenChange={${mo}}`)
  })
})

describe("điện thoại không dựng phần chỉ máy tính mới hiện", () => {
  it("useKhoMay: useSyncExternalStore — null chỉ ở lượt vẽ khớp HTML máy chủ", () => {
    const s = doc("src/hooks/use-is-desktop.ts")
    expect(s).toContain("return useSyncExternalStore(ngheKho, khoHienTai, khoMayChu)")
    expect(s).toContain("const khoMayChu = () => null")
  })

  it("thẻ danh sách máy tính (khuôn chung, Đơn hàng, Hoá đơn bán) và menu trái chờ khổ khác điện thoại", () => {
    expect(doc("src/components/ui/doc-list-layout.tsx")).toMatch(/\{khoMay !== false && \(\s*<div\s+data-doc-list="desktop"/)
    for (const p of ["src/app/(dashboard)/orders/page.tsx", "src/app/(dashboard)/sales-invoices/page.tsx"]) {
      expect(doc(p), p).toMatch(/\{laMay !== false && \(\s*<div data-doc-list="desktop"/)
    }
    const shell = doc("src/components/layout/dashboard-shell.tsx")
    expect(shell).toContain("const coMenuTrai = useKhoMay() !== false")
    expect(shell.match(/\{coMenuTrai && <Sidebar role=\{role\} \/>\}/g)?.length).toBe(2)
  })
})

describe("ô lọc khách của Đơn hàng / Hoá đơn bán: chỉ tải danh sách khách khi ô ấy hiện (chủ nhà 23/10/2026)", () => {
  it("mở màn không đọc cả sổ khách — chỉ useKhachLoc, theo đúng lúc khung lọc mở hoặc đang lọc một khách", () => {
    for (const f of ["orders", "sales-invoices"]) {
      const s = doc(`src/app/(dashboard)/${f}/page.tsx`)
      expect(s, f).not.toContain('from("customers")\n                .select("id, store_name, owner_name, phone"')
      expect(s, f).not.toContain('nhoNen("nen:khach-nhe"')
      expect(s, f).toContain('useKhachLoc(((showAdvanced || filterSheet) && filterActive("customer")) || customerFilter !== "all")')
      expect(s, f).toContain("options={khachLoc.options}")
      expect(s, f).toContain("emptyHint={cauTrongKhachLoc(khachLoc)}")
    }
  })

  it("mục: tên cửa hàng; dòng phụ chủ quán · SĐT; tìm được theo chủ quán / SĐT", () => {
    expect(mucKhachLoc([{ id: "k1", store_name: "Tạp hoá Cô Ba", owner_name: "Cô Ba", phone: "0911" }])).toEqual([
      { id: "k1", label: "Tạp hoá Cô Ba", hint: "Cô Ba · 0911", keywords: "Cô Ba 0911" },
    ])
    expect(mucKhachLoc([{ id: "k2", store_name: "Đại lý Minh", owner_name: "", phone: "" }])[0].hint).toBeNull()
  })

  it("ô trống nói đúng chuyện: đang tải / tải hỏng / không khớp", () => {
    expect(cauTrongKhachLoc({ dangTai: true, loi: null })).toContain("Đang tải")
    expect(cauTrongKhachLoc({ dangTai: false, loi: "x" })).toContain("Không tải được")
    expect(cauTrongKhachLoc({ dangTai: false, loi: null })).toBe("Không tìm thấy khách nào khớp.")
  })
})

describe("phần chỉ dùng khi bấm tải lúc bấm (không nằm trong JS khung của mọi trang)", () => {
  /** Có câu `import … from mod` chạy thật (không phải `import type`) không. */
  const nhapThat = (s: string, mod: string) =>
    Array.from(s.matchAll(/^import\s+([^"']*?)\s*from\s+["']([^"']+)["']/gm)).some((m) => m[2] === mod && !/^type\b/.test(m[1]))

  it("chuông thông báo: hộp danh sách (Popover) ở notification-panel, tải lười", () => {
    const s = doc("src/components/layout/notification-bell.tsx")
    expect(nhapThat(s, "@/components/ui/popover")).toBe(false)
    expect(s).toContain('lazy(() => import("./notification-panel")')
  })

  it("menu người dùng: menu thả (DropdownMenu) ở user-menu-day, tải lười", () => {
    const s = doc("src/components/layout/user-menu.tsx")
    expect(nhapThat(s, "@/components/ui/dropdown-menu")).toBe(false)
    expect(s).toContain('lazy(() => import("./user-menu-day")')
  })

  it("nút Xuất Excel: phần ghi tệp tải lúc bấm", () => {
    const s = doc("src/components/ui/xuat-excel-button.tsx")
    for (const mod of ["@/lib/xuat-excel/phieu", "@/components/analytics/report-frame", "@/lib/xuat-excel/xlsx-dinh-dang"]) {
      expect(nhapThat(s, mod), mod).toBe(false)
      expect(s).toContain(`import("${mod}")`)
    }
  })
})
