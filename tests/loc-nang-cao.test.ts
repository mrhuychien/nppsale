import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import {
  dieuKienDu, khopLoc, menhDeLoc, menhDeMot, TOAN_TU_THEO_KIEU, type DieuKienLoc, type TruongLoc,
} from "../src/lib/search/advanced-filter"
import * as F from "../src/lib/search/list-filter-fields"

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "… thêm phần bộ lọc nâng cao (cho chọn trường bất kỳ để lọc giá trị)".
 */
const T: TruongLoc[] = [
  { key: "ma", nhan: "Mã", cot: "order_code", kieu: "text" },
  { key: "tong", nhan: "Tổng", cot: "total", kieu: "number" },
  { key: "ngay", nhan: "Ngày", cot: "order_date", kieu: "date" },
  { key: "tao", nhan: "Tạo", cot: "created_at", kieu: "date", coGio: true },
  { key: "tt", nhan: "TT", cot: "status", kieu: "enum", luaChon: [{ value: "draft", label: "Nháp" }] },
  { key: "hd", nhan: "HĐ", cot: "is_active", kieu: "bool" },
]
const dk = (p: Partial<DieuKienLoc>): DieuKienLoc => ({ id: "x", truong: "ma", toanTu: "chua", giaTri: "", ...p })

describe("mệnh đề PostgREST", () => {
  it("mỗi phép ra đúng một mệnh đề or=", () => {
    const t = (p: Partial<DieuKienLoc>) => menhDeLoc(T, [dk(p)])[0]
    expect(t({ giaTri: "DH,01" })).toBe('order_code.ilike."%DH,01%"')
    expect(t({ toanTu: "khong_chua", giaTri: "x" })).toBe('order_code.not.ilike."%x%"')
    expect(t({ truong: "tong", toanTu: "tu", giaTri: "2.000.000" })).toBe('total.gte."2000000"')
    expect(t({ truong: "tong", toanTu: "khoang", giaTri: "1", giaTri2: "5" })).toBe('and(total.gte."1",total.lte."5")')
    expect(t({ truong: "ngay", toanTu: "den", giaTri: "2026-09-24" })).toBe('order_date.lte."2026-09-24"')
    /* Cột có giờ: "đến ngày D" là hết ngày D; "bằng ngày D" là cả ngày. */
    expect(t({ truong: "tao", toanTu: "den", giaTri: "2026-09-24" })).toBe('created_at.lte."2026-09-24T23:59:59.999"')
    expect(t({ truong: "tao", toanTu: "bang", giaTri: "2026-09-24" })).toBe('and(created_at.gte."2026-09-24",created_at.lte."2026-09-24T23:59:59.999")')
    expect(t({ truong: "tt", toanTu: "khac", giaTri: "draft" })).toBe('status.neq."draft"')
    expect(t({ truong: "hd", toanTu: "bang", giaTri: "false" })).toBe("is_active.is.false")
    expect(t({ toanTu: "rong" })).toBe("order_code.is.null")
    expect(t({ toanTu: "co_gia_tri" })).toBe("order_code.not.is.null")
    expect(t({ toanTu: "bang", giaTri: 'a"b_%' })).toBe('order_code.ilike."a\\"b\\\\_\\\\%"')
  })
  it("điều kiện chưa đủ thì BỎ QUA, không lọc ra rỗng", () => {
    expect(menhDeLoc(T, [dk({ giaTri: "  " })])).toEqual([])
    expect(menhDeLoc(T, [dk({ truong: "tong", toanTu: "tu", giaTri: "abc" })])).toEqual([])
    expect(menhDeLoc(T, [dk({ truong: "tong", toanTu: "khoang", giaTri: "1" })])).toEqual([])
    expect(menhDeLoc(T, [dk({ truong: "khong-co" , giaTri: "x" })])).toEqual([])
    /* Phép không hợp với kiểu (chứa trên cột số) cũng bỏ. */
    expect(dieuKienDu(dk({ truong: "tong", toanTu: "chua", giaTri: "1" }), T[1])).toBe(false)
  })
})

describe("lọc ở trình duyệt cùng nghĩa với máy chủ", () => {
  const rows = [
    { order_code: "DH-0001", total: 1_000_000, order_date: "2026-09-01", created_at: "2026-09-24T10:00:00Z", status: "draft", is_active: true },
    { order_code: "DH-0002", total: 2_000_000, order_date: "2026-09-20", created_at: "2026-09-25T01:00:00Z", status: "done", is_active: false },
    { order_code: null, total: 5_000_000, order_date: "2025-06-15", created_at: "2025-06-15T01:00:00Z", status: "done", is_active: true },
  ]
  const loc = (ds: Partial<DieuKienLoc>[]) =>
    rows.filter((r) => khopLoc(r, T, ds.map((p) => dk(p)))).map((r) => r.total)
  it("các phép", () => {
    expect(loc([{ giaTri: "0002" }])).toEqual([2_000_000])
    expect(loc([{ toanTu: "khong_chua", giaTri: "0002" }])).toEqual([1_000_000, 5_000_000])
    expect(loc([{ truong: "tong", toanTu: "tu", giaTri: "2000000" }])).toEqual([2_000_000, 5_000_000])
    expect(loc([{ truong: "tong", toanTu: "khoang", giaTri: "900000", giaTri2: "2000000" }])).toEqual([1_000_000, 2_000_000])
    expect(loc([{ truong: "ngay", toanTu: "tu", giaTri: "2026-09-10" }])).toEqual([2_000_000])
    expect(loc([{ truong: "tao", toanTu: "bang", giaTri: "2026-09-24" }])).toEqual([1_000_000])
    expect(loc([{ truong: "tt", toanTu: "bang", giaTri: "done" }])).toEqual([2_000_000, 5_000_000])
    expect(loc([{ truong: "hd", toanTu: "bang", giaTri: "false" }])).toEqual([2_000_000])
    expect(loc([{ toanTu: "rong" }])).toEqual([5_000_000])
    // Ghép VÀ.
    expect(loc([{ truong: "tong", toanTu: "tu", giaTri: "2000000" }, { truong: "tt", toanTu: "bang", giaTri: "done" }, { giaTri: "DH" }])).toEqual([2_000_000])
  })
})

describe("trường của các danh sách", () => {
  /* Cột có thật — đối chiếu migration. Gõ sai một cột là CẢ danh sách 42703. */
  const SQL = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n")
  const BANG: Record<string, string> = {
    LOC_DON_HANG: "sales_orders", LOC_HOA_DON: "sales_invoices", LOC_TRA_HANG: "returns",
    LOC_KHACH_HANG: "customers", LOC_SAN_PHAM: "products", LOC_NHA_CUNG_CAP: "suppliers",
    // Đợt 2 (V4b, 24/09/2026)
    LOC_CONG_NO_PHAI_THU: "receivables", LOC_CONG_NO_PHAI_TRA: "payables", LOC_CHUYEN_GIAO: "deliveries",
    LOC_HOA_DON_DIEN_TU: "invoices", LOC_PHIEU_NHAP_MUA: "stock_entries", LOC_HOA_DON_MUA: "purchase_invoices",
    LOC_TRA_HANG_NCC: "supplier_returns", LOC_PHIEU_THU: "cash_receipts", LOC_CHI_PHI: "expenses",
    LOC_PHIEU_KHO: "stock_entries", LOC_LO_HANG: "batches", LOC_KHUYEN_MAI: "promotions",
    LOC_VI_HOA_HONG: "commission_wallets",
  }
  it("mọi bộ trường đều được soi cột", () => {
    const xuat = Object.keys(F).filter((k) => k.startsWith("LOC_"))
    expect(xuat.filter((k) => !(k in BANG)), "bộ trường chưa khai bảng để soi cột").toEqual([])
  })
  it.each(Object.entries(BANG))("%s: mọi cột có trong migration của bảng %s", (ten, bang) => {
    const ds = (F as Record<string, readonly TruongLoc[]>)[ten]
    expect(ds.length).toBeGreaterThan(3)
    for (const t of ds) {
      expect(TOAN_TU_THEO_KIEU[t.kieu].length).toBeGreaterThan(0)
      const coCot = new RegExp(`(CREATE TABLE (IF NOT EXISTS )?(public\\.)?${bang}\\s*\\([\\s\\S]*?\\n\\s*${t.cot}\\s)|(${bang}[\\s\\S]{0,400}ADD COLUMN (IF NOT EXISTS )?${t.cot}\\b)`)
      expect(coCot.test(SQL), `${bang}.${t.cot} không thấy trong migration`).toBe(true)
    }
    expect(new Set(ds.map((t) => t.key)).size, "trùng key").toBe(ds.length)
  })
  it("menhDeMot không nổ với mọi trường × mọi phép", () => {
    for (const ds of Object.values(F) as ReadonlyArray<readonly TruongLoc[]>) for (const t of ds)
      for (const op of TOAN_TU_THEO_KIEU[t.kieu]) menhDeMot(dk({ truong: t.key, toanTu: op, giaTri: t.kieu === "date" ? "2026-01-01" : "1", giaTri2: "2" }), t)
  })
})

describe("các danh sách gắn lọc nâng cao vào CÙNG đường truy vấn", () => {
  /* [thư mục trang, khoá lưu, bộ trường, lọc ở máy chủ | ở trình duyệt]. Trang
     nạp CẢ danh sách về máy thì lọc bằng `khopLoc` — cùng luật với máy chủ. */
  const TRANG: Array<[string, string, string, "may_chu" | "trinh_duyet"]> = [
    ["orders", "orders", "LOC_DON_HANG", "may_chu"], ["sales-invoices", "sales-invoices", "LOC_HOA_DON", "may_chu"],
    ["returns", "returns", "LOC_TRA_HANG", "may_chu"], ["customers", "customers", "LOC_KHACH_HANG", "may_chu"],
    ["products", "products", "LOC_SAN_PHAM", "may_chu"], ["suppliers", "suppliers", "LOC_NHA_CUNG_CAP", "may_chu"],
    ["receivables", "receivables", "LOC_CONG_NO_PHAI_THU", "may_chu"],
    ["payables", "payables", "LOC_CONG_NO_PHAI_TRA", "may_chu"],
    ["deliveries", "deliveries", "LOC_CHUYEN_GIAO", "may_chu"],
    ["invoices", "invoices", "LOC_HOA_DON_DIEN_TU", "may_chu"],
    ["purchasing/invoices", "purchasing-invoices", "LOC_PHIEU_NHAP_MUA", "may_chu"],
    ["purchasing/receipts", "purchasing-receipts", "LOC_HOA_DON_MUA", "trinh_duyet"],
    ["purchase-returns", "purchase-returns", "LOC_TRA_HANG_NCC", "may_chu"],
    ["finance/cash-receipts", "cash-receipts", "LOC_PHIEU_THU", "may_chu"],
    ["finance/expenses", "expenses", "LOC_CHI_PHI", "may_chu"],
    ["inventory/entries", "inventory-entries", "LOC_PHIEU_KHO", "trinh_duyet"],
    ["inventory/batches", "inventory-batches", "LOC_LO_HANG", "trinh_duyet"],
    ["promotions", "promotions", "LOC_KHUYEN_MAI", "trinh_duyet"],
    ["commissions", "commissions", "LOC_VI_HOA_HONG", "may_chu"],
  ]
  it.each(TRANG)("/%s", (duong, khoa, hang, cach) => {
    const S = readFileSync(`src/app/(dashboard)/${duong}/page.tsx`, "utf8")
    expect(S).toContain(`useAdvancedFilter("${khoa}", ${hang})`)
    if (cach === "may_chu") expect(S).toMatch(/for \(const f of locNC\.menhDe\) \w+ = \w+\.or\(f\)/)
    else expect(S).toMatch(new RegExp(`khopLoc\\([^)]*${hang}, locNC\\.dieuKien\\)`))
    expect(S).toContain(`<AdvancedFilter truong={${hang}} value={locNC.dieuKien} onApply={locNC.apDung}`)
    // Mảng phụ thuộc (hiệu ứng tải / memo lọc) phải có điều kiện lọc.
    expect(S, "đổi điều kiện mà không tải lại").toMatch(/\[[^\]\n]*locNC\.(key|dieuKien)[^\]\n]*\]/)
  })
  it("khoá lưu không trùng giữa hai danh sách", () => {
    expect(new Set(TRANG.map((t) => t[1])).size).toBe(TRANG.length)
  })
})
