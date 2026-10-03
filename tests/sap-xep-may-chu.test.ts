import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import {
  apSapXep,
  doiSapXep,
  sapXepTaiCho,
  xepDuoc,
  SAP_XEP_CONG_NO,
  SAP_XEP_CONG_NO_NCC,
  SAP_XEP_PHIEU_THU,
  SAP_XEP_HD_MUA,
  SAP_XEP_HD_DIEN_TU,
  SAP_XEP_NCC,
  type DocSort,
} from "../src/lib/list/sap-xep-may-chu"
import { DocTable, sapXepDong, cotXepDuoc, type DocColumn } from "../src/components/ui/doc-table"
import { ORDER_SORT_COLUMNS } from "../src/components/orders/desktop-order-table"
import { INVOICE_SORT_COLUMNS } from "../src/components/sales-invoices/desktop-invoice-table"

/**
 * ⚠ LỖI: bảng danh sách xếp TRONG BỘ NHỚ trên đúng những dòng nó nhận — mà màn phân trang chỉ
 *   đưa một trang (20 dòng). Bấm "Còn lại ↓" ở Công nợ ra khoản lớn nhất của 20 dòng, không phải
 *   của cả sổ. Sửa: màn phân trang gửi `.order(cột)` xuống máy chủ; bảng chỉ vẽ mũi tên.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

/** Bộ dựng truy vấn giả — ghi lại các lần `.order(...)` theo đúng thứ tự gọi. */
function fakeQ() {
  const calls: Array<[string, { ascending?: boolean; nullsFirst?: boolean } | undefined]> = []
  const q = {
    calls,
    order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
      calls.push([column, options])
      return q
    },
  }
  return q
}
const macDinh = <Q extends { order: (c: string, o?: { ascending?: boolean }) => Q }>(x: Q) =>
  x.order("due_date", { ascending: true }).order("id")

describe("doiSapXep — bấm tiêu đề", () => {
  it("cột mới xếp tăng; bấm lại đổi chiều; cột khác về tăng", () => {
    const a = doiSapXep(null, "amount")
    expect(a).toEqual({ key: "amount", dir: "asc" })
    const b = doiSapXep(a, "amount")
    expect(b).toEqual({ key: "amount", dir: "desc" })
    expect(doiSapXep(b, "amount")).toEqual({ key: "amount", dir: "asc" })
    expect(doiSapXep(b, "dueDate")).toEqual({ key: "dueDate", dir: "asc" })
  })
})

describe("apSapXep — gửi thứ tự xuống máy chủ", () => {
  it("cột bấm đứng TRƯỚC thứ tự mặc định, ô trống xuống cuối, mốc `id` ở cuối", () => {
    const q = fakeQ()
    apSapXep(q, { key: "amount", dir: "desc" }, SAP_XEP_CONG_NO, macDinh)
    expect(q.calls).toEqual([
      ["amount", { ascending: false, nullsFirst: false }],
      ["due_date", { ascending: true }],
      ["id", undefined],
    ])
  })

  it("cột bảng nhúng một-một dùng cú pháp PostgREST `bí_danh(cột)`", () => {
    const q = fakeQ()
    apSapXep(q, { key: "customer", dir: "asc" }, SAP_XEP_CONG_NO, macDinh)
    expect(q.calls[0]).toEqual(["customer(store_name)", { ascending: true, nullsFirst: false }])
  })

  it("chưa chọn / cột không có trong bản đồ → chỉ thứ tự mặc định", () => {
    for (const s of [null, undefined, { key: "remaining", dir: "desc" } as DocSort]) {
      const q = fakeQ()
      apSapXep(q, s, SAP_XEP_CONG_NO, macDinh)
      expect(q.calls.map((c) => c[0])).toEqual(["due_date", "id"])
    }
  })
})

describe("bản đồ cột — chỉ cột CÓ THẬT trên máy chủ", () => {
  /**
   * ⚠ CỘT TÍNH RA KHÔNG XẾP ĐƯỢC. "Còn lại" = amount − paid (không có cột / view), tổng tiền hoá
   *   đơn trên dòng là số SAU hàng trả (mig 192), khách của phiếu thu suy từ dòng phiếu, còn nợ
   *   của phiếu nhập nằm ở `payables`. Cho chúng bấm được là lại xếp trên một trang.
   */
  it("không có cột tính ra", () => {
    expect(xepDuoc(SAP_XEP_CONG_NO, "remaining")).toBe(false)
    expect(xepDuoc(SAP_XEP_CONG_NO_NCC, "remaining")).toBe(false)
    expect(xepDuoc(SAP_XEP_PHIEU_THU, "customer")).toBe(false)
    expect(xepDuoc(SAP_XEP_HD_MUA, "remaining")).toBe(false)
    expect(Object.keys(INVOICE_SORT_COLUMNS)).not.toContain("total")
  })

  it("các cột còn lại trỏ đúng cột trong bảng", () => {
    expect(SAP_XEP_CONG_NO).toEqual({ customer: "customer(store_name)", amount: "amount", dueDate: "due_date" })
    expect(SAP_XEP_CONG_NO_NCC).toEqual({ supplier: "supplier(name)", amount: "amount", dueDate: "due_date" })
    expect(SAP_XEP_PHIEU_THU).toEqual({ date: "receipt_date", submitted: "submitted_amount", total: "expected_amount" })
    expect(SAP_XEP_HD_MUA).toEqual({ supplier: "supplier(name)", date: "posted_at" })
    expect(SAP_XEP_HD_DIEN_TU).toEqual({ customer: "customer_name", amount: "total" })
    expect(SAP_XEP_NCC).toEqual({ name: "name" })
    expect(ORDER_SORT_COLUMNS).toEqual({ customer: "customer(store_name)", date: "created_at", total: "total" })
    expect(INVOICE_SORT_COLUMNS).toEqual({ customer: "customer(store_name)", date: "invoice_date" })
  })
})

type R = { id: string; amount: number }
const ROWS: R[] = [
  { id: "a", amount: 10 },
  { id: "b", amount: 30 },
  { id: "c", amount: 20 },
]
const COLS: DocColumn<R>[] = [
  { key: "id", label: "Mã", width: "1fr", render: (r) => r.id },
  { key: "amount", label: "Tiền", width: "1fr", sort: (x, y) => x.amount - y.amount, sortable: true, render: (r) => String(r.amount) },
  { key: "note", label: "Ghi chú", width: "1fr", sort: (x, y) => x.id.localeCompare(y.id), render: () => "" },
]

describe("DocTable — hai chế độ", () => {
  it("xếp ở máy chủ: GIỮ NGUYÊN thứ tự máy chủ trả, kể cả khi có `sort`", () => {
    expect(sapXepDong(ROWS, COLS, { key: "amount", dir: "desc" }, true).map((r) => r.id)).toEqual(["a", "b", "c"])
  })

  it("màn nạp đủ: xếp trong bộ nhớ bằng `sort` của cột", () => {
    expect(sapXepDong(ROWS, COLS, { key: "amount", dir: "desc" }, false).map((r) => r.id)).toEqual(["b", "c", "a"])
    expect(sapXepDong(ROWS, COLS, null, false)).toBe(ROWS)
  })

  it("nút xếp: máy chủ theo `sortable`, tại chỗ theo `sort`", () => {
    expect(COLS.map((c) => cotXepDuoc(c, true))).toEqual([false, true, false])
    expect(COLS.map((c) => cotXepDuoc(c, false))).toEqual([false, true, true])
  })

  it("vẽ: có `onSortChange` thì dòng theo thứ tự nhận, mũi tên theo `sort`, chỉ cột `sortable` bấm được", () => {
    const html = renderToStaticMarkup(
      createElement(DocTable<R>, {
        rows: ROWS,
        columns: COLS,
        sort: { key: "amount", dir: "desc" },
        onSortChange: () => {},
      })
    )
    const thuTu = ["a", "b", "c"].map((id) => html.indexOf(`>${id}<`))
    expect(thuTu).toEqual([...thuTu].sort((x, y) => x - y))
    expect(html).toContain('data-sort-key="amount"')
    expect(html).toContain('data-sort-dir="desc"')
    expect(html).not.toContain('data-sort-key="note"')
  })
})

describe("sapXepTaiCho — màn nạp đủ xếp CẢ danh sách rồi mới chia trang", () => {
  it("dòng lớn nhất ở trang 2 vẫn lên đầu", () => {
    const all = Array.from({ length: 25 }, (_, i) => ({ id: String(i), amount: i === 22 ? 999 : i }))
    const soSanh = { amount: (x: { amount: number }, y: { amount: number }) => x.amount - y.amount }
    const xep = sapXepTaiCho(all, { key: "amount", dir: "desc" }, soSanh)
    expect(xep.slice(0, 20)[0].id).toBe("22")
    expect(sapXepTaiCho(all, { key: "khac", dir: "desc" }, soSanh)).toBe(all)
  })
})

/** Rà mã nguồn: màn phân trang không còn đưa so sánh trong bộ nhớ cho bảng. */
describe("rà soát: mọi màn phân trang xếp ở máy chủ", () => {
  const MAY_CHU = [
    "src/app/(dashboard)/receivables/page.tsx",
    "src/app/(dashboard)/payables/page.tsx",
    "src/app/(dashboard)/finance/cash-receipts/page.tsx",
    "src/app/(dashboard)/purchasing/invoices/page.tsx",
    "src/app/(dashboard)/invoices/page.tsx",
    "src/app/(dashboard)/suppliers/page.tsx",
  ]
  it.each(MAY_CHU)("%s: bảng chạy chế độ máy chủ, truy vấn đi qua apSapXep, thứ tự trong deps", (rel) => {
    const S = code(read(rel))
    expect(S).toMatch(/<DocTable[^\n]*sort=\{sort\} onSortChange=\{setSort\}/)
    expect(S).not.toMatch(/\bsort: \(a, b\) =>/)
    expect(S).toContain("apSapXep(")
    // Đổi thứ tự là về trang 1.
    expect(S).toMatch(/pg\.(reset|setPage)\((1)?\)\s*\}, \[[^\]]*\bsort\]\)/)
  })

  it("Hóa đơn bán: truy vấn đi qua apSapXep với INVOICE_SORT_COLUMNS, thứ tự trong deps", () => {
    const S = code(read("src/app/(dashboard)/sales-invoices/page.tsx"))
    expect(S).toMatch(/apSapXep\(\s*supabase\s*\.from\("sales_invoices"\)[\s\S]*?sort,\s*INVOICE_SORT_COLUMNS/)
    expect(S).toMatch(/\}, \[status, applyFilters, searchReady, pg\.from, pg\.to, sort\]\)/)
    expect(S).toMatch(/pg\.setPage\(1\)\s*\}, \[[^\]]*\bsort\]\)/)
    const T = code(read("src/components/sales-invoices/desktop-invoice-table.tsx"))
    expect(T).toContain("const rows = invoices")
  })

  it("Sản phẩm: lưới nối vào thứ tự máy chủ, Giá bán không xếp", () => {
    const P = code(read("src/app/(dashboard)/products/page.tsx"))
    expect(P).toContain("onSortChange={(s) => setSapXep(")
    const T = code(read("src/components/products/product-table.tsx"))
    expect(T).not.toMatch(/\bsort: \(a, b\) =>/)
    expect(T).toContain("onSortChange={onSortChange}")
  })

  const TAI_CHO = [
    "src/app/(dashboard)/finance/expenses/page.tsx",
    "src/app/(dashboard)/inventory/entries/page.tsx",
    "src/app/(dashboard)/inventory/batches/page.tsx",
    "src/app/(dashboard)/purchase-returns/page.tsx",
    "src/app/(dashboard)/purchasing/receipts/page.tsx",
    "src/app/(dashboard)/settings/users/page.tsx",
    "src/app/(dashboard)/commissions/policies/page.tsx",
    "src/app/(dashboard)/promotions/page.tsx",
  ]
  it.each(TAI_CHO)("%s: xếp cả danh sách TRƯỚC khi chia trang", (rel) => {
    const S = code(read(rel))
    expect(S).toMatch(/usePhanTrangTaiCho\(daXep, JSON\.stringify\(\[[^\]]*, sort\]\)\)/)
    expect(S).toMatch(/<DocTable rows=\{trang\}[^\n]*sort=\{sort\} onSortChange=\{setSort\}/)
    expect(S).not.toMatch(/\bsort: \(a, b\) =>/)
  })

  /** Mọi nơi dùng DocTable phải nằm ở một trong hai nhóm trên (hoặc qua ProductTable). */
  it("không bỏ sót nơi dùng DocTable", () => {
    const { execSync } = require("node:child_process") as typeof import("node:child_process")
    const files = execSync(`grep -rl "<DocTable" src`, { cwd: ROOT }).toString().trim().split("\n")
    const daXet = new Set([...MAY_CHU, ...TAI_CHO, "src/components/products/product-table.tsx", "src/components/ui/doc-table.tsx", "src/components/ui/doc-list-layout.tsx"])
    expect(files.filter((f) => !daXet.has(f))).toEqual([])
  })

  /** Trang 200 dòng dồn vào một `.in()` là chạm trần độ dài URL — đọc theo lô, lỗi thì nói ra. */
  it("phiếu thu / hoá đơn mua đọc bảng phụ theo lô id và hiện lỗi", () => {
    const PT = code(read("src/app/(dashboard)/finance/cash-receipts/page.tsx"))
    expect(PT).not.toContain('.in("receipt_id", ids)')
    expect(PT).toMatch(/docTheoLoId<DongPhieuThuTom>\(\s*ids,/)
    expect(PT).toContain("setLoiDong(errorMessage(e,")
    expect(PT).not.toContain("console.warn(\"[finance/cash-receipts] không đọc được dòng phiếu")
    const HM = code(read("src/app/(dashboard)/purchasing/invoices/page.tsx"))
    expect(HM).not.toContain('.in("stock_entry_id", ids)')
    expect(HM).toMatch(/docTheoLoId<[^>]+>\(\s*ids,/)
    expect(HM).toContain("setLoadError(loi)")
  })
})
