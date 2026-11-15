import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { BANG_DONG_LOC_SP, NHUNG_LOC_SP, apLocSp, kemLocSp, spDangLoc } from "@/lib/list/loc-san-pham"
import { cauTrongHangLoc, mucHangLoc, type HangNhe } from "@/hooks/use-hang-loc"

/**
 * Chủ nhà 15/11/2026: "Thêm cho tao bộ lọc sản phẩm trong Đơn hàng/Hóa đơn/Trả hàng/Nhập NCC/Trả NCC".
 * Luật: `@/lib/list/loc-san-pham` — bảng dòng nhúng `!inner` + điều kiện `loc_sp.product_id`, hai thứ đi đôi ở MỌI câu.
 */
const ROOT = resolve(__dirname, "..")
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8")
const dem = (s: string, chu: string) => s.split(chu).length - 1

describe("kemLocSp / apLocSp — luật lọc chứng từ theo mặt hàng", () => {
  it("không lọc (trống / null / \"all\") thì select và câu giữ nguyên", () => {
    for (const sp of [null, undefined, "", "all"]) {
      expect(spDangLoc(sp)).toBeNull()
      expect(kemLocSp("id, total", "sales_orders", sp)).toBe("id, total")
      const goi: unknown[] = []
      const q = { eq: (...a: unknown[]) => (goi.push(a), q) }
      expect(apLocSp(q, sp)).toBe(q)
      expect(goi).toEqual([])
    }
  })
  it("đang lọc: nhúng ĐÚNG bảng dòng của từng loại chứng từ, `!inner`, có cột (không nhúng rỗng — 400 khi đi cùng câu gộp)", () => {
    expect(kemLocSp("status, count()", "sales_orders", "p1")).toBe("status, count(), loc_sp:sales_order_lines!inner(product_id)")
    expect(kemLocSp("id", "sales_invoices", "p1")).toBe("id, loc_sp:sales_invoice_lines!inner(product_id)")
    expect(kemLocSp("con_lai.sum()", "v_hoa_don_con_lai", "p1")).toBe("con_lai.sum(), loc_sp:sales_invoice_lines!inner(product_id)")
    expect(kemLocSp("id", "returns", "p1")).toBe("id, loc_sp:return_lines!inner(product_id)")
    expect(kemLocSp("id", "purchase_invoices", "p1")).toBe("id, loc_sp:purchase_invoice_lines!inner(product_id)")
    expect(kemLocSp("id", "supplier_returns", "p1")).toBe("id, loc_sp:supplier_return_lines!inner(product_id)")
    for (const bang of Object.keys(BANG_DONG_LOC_SP) as Array<keyof typeof BANG_DONG_LOC_SP>) {
      expect(kemLocSp("id", bang, "p1")).not.toMatch(/!inner\(\s*\)/)
    }
  })
  it("đang lọc: điều kiện là `loc_sp.product_id = <mặt hàng>` — cùng tên nhúng với select", () => {
    const goi: unknown[] = []
    const q = { eq: (...a: unknown[]) => (goi.push(a), q) }
    expect(apLocSp(q, "p9")).toBe(q)
    expect(goi).toEqual([[`${NHUNG_LOC_SP}.product_id`, "p9"]])
    expect(kemLocSp("id", "returns", "p9")).toContain(`${NHUNG_LOC_SP}:`)
  })
})

describe("mucHangLoc — mục của ô lọc sản phẩm", () => {
  const ds: HangNhe[] = [
    { id: "3", sku: "SP3", name: "Ngừng cũ", barcode: null, status: "inactive" },
    { id: "1", sku: "MI1", name: "Mì tôm", barcode: "893000002", status: "active" },
    { id: "2", sku: "BIA", name: "Bia lon", barcode: null, status: null },
  ]
  it("hàng đang bán trước (xếp theo tên tiếng Việt), hàng ngừng bán xuống cuối kèm chữ \"ngừng bán\"", () => {
    const m = mucHangLoc(ds)
    expect(m.map((o) => o.id)).toEqual(["2", "1", "3"])
    expect(m[2].hint).toBe("SP3 · ngừng bán")
    expect(m[0].hint).toBe("BIA")
  })
  it("tìm được theo mã hàng + mã vạch (từ khoá ẩn)", () => {
    const mi = mucHangLoc(ds).find((o) => o.id === "1")!
    expect(mi.label).toBe("Mì tôm")
    expect(mi.keywords).toBe("MI1 893000002")
  })
  it("câu dưới ô nói rõ đang tải / tải hỏng / không khớp", () => {
    expect(cauTrongHangLoc({ dangTai: true, loi: null })).toMatch(/Đang tải/)
    expect(cauTrongHangLoc({ dangTai: false, loi: "x" })).toMatch(/Không tải được/)
    expect(cauTrongHangLoc({ dangTai: false, loi: null })).toMatch(/Không tìm thấy/)
  })
})

describe("năm danh sách dùng chung một luật", () => {
  const MAN: Array<{ tep: string; ham: string; ap: string }> = [
    { tep: "src/app/(dashboard)/orders/page.tsx", ham: "applyCommonFilters(", ap: "x = apLocSp(x, productFilter)" },
    { tep: "src/app/(dashboard)/sales-invoices/page.tsx", ham: "applyFilters(", ap: "x = apLocSp(x, productFilter)" },
    { tep: "src/app/(dashboard)/returns/page.tsx", ham: "apDungLoc(", ap: "x = apLocSp(x, spLoc)" },
  ]
  for (const m of MAN) {
    it(`${m.tep}: điều kiện nằm trong hàm lọc chung; MỖI câu đi qua hàm ấy có select qua kemSp (thiếu là 400 PGRST108)`, () => {
      const s = read(m.tep)
      expect(s).toContain(m.ap)
      expect(dem(s, "kemSp("), `số câu qua ${m.ham} khác số select qua kemSp — câu mới quên nhúng bảng dòng?`).toBe(dem(s, m.ham))
      expect(s).toContain("<LocSanPham")
    })
  }
  it("Nhập NCC / Trả NCC: lọc ngay ở câu tải đủ (nhúng + điều kiện cùng một mặt hàng)", () => {
    const pn = read("src/app/(dashboard)/purchasing/receipts/page.tsx")
    // Chuỗi select có `supplier:suppliers(…)` — đừng khớp bằng `[^)]*`.
    expect(pn).toMatch(/kemLocSp\("[^"]*", "purchase_invoices", spLoc\)/)
    expect(pn).toMatch(/\.eq\("org_id", user\.org_id\),\s*spLoc\s*\)/)
    const tn = read("src/app/(dashboard)/purchase-returns/page.tsx")
    expect(tn).toMatch(/kemLocSp\("[^"]*", "supplier_returns", productFilter\)/)
    expect(tn).toContain("q = apLocSp(q, productFilter)")
    for (const s of [pn, tn]) expect(s).toContain("<LocSanPham")
  })
  it("ô lọc bật sẵn ở các màn có bộ chọn ô lọc (người đã chỉnh cũng thấy — adoptNewKeys)", () => {
    expect(read("src/app/(dashboard)/orders/list-config.ts")).toMatch(/DEFAULT_ORDER_FILTERS[^=]*=\s*\[[^\]]*"product"/)
    expect(read("src/app/(dashboard)/sales-invoices/list-config.ts")).toMatch(/DEFAULT_INVOICE_FILTERS[^=]*=\s*\[[^\]]*"product"/)
    expect(read("src/app/(dashboard)/returns/list-config.ts")).toMatch(/DEFAULT_RETURN_FILTERS[^=]*=\s*\[[^\]]*"product"/)
    expect(read("src/app/(dashboard)/purchasing/receipts/list-config.ts")).toMatch(/DEFAULT_PURCHASE_RECEIPT_FILTERS[^=]*=\s*\[[^\]]*"product"/)
  })
  it("điện thoại: tấm lọc Đơn hàng / Hoá đơn, ô dưới ô tìm của Trả hàng, tấm lọc Nhập / Trả NCC", () => {
    expect(read("src/components/returns/mobile-returns-screen.tsx")).toContain("productFilter && <div data-testid=\"tra-loc-san-pham\">")
    for (const tep of ["src/app/(dashboard)/orders/page.tsx", "src/app/(dashboard)/sales-invoices/page.tsx", "src/app/(dashboard)/purchasing/receipts/page.tsx", "src/app/(dashboard)/purchase-returns/page.tsx"]) {
      expect(dem(read(tep), "<LocSanPham"), tep).toBe(2)
    }
  })
  it("sổ giả e2e: lọc `loc_sp.*` mà select không nhúng → 400 PGRST108, như PostgREST thật", () => {
    const f = read("e2e/fake-supabase.mjs")
    expect(f).toContain('if (k.startsWith("loc_sp.") && !nhung.has("loc_sp"))')
    expect(f).toContain('code: "PGRST108"')
  })
})
