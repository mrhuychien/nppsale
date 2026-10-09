import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { phanTienQuaLoc, coDongQuaLoc } from "@/lib/analytics/hang-ban-nhan-vien"
import { dungDongBan } from "@/lib/bao-cao/nap-ban-hang"
import { danhMucRong } from "@/lib/bao-cao/cong"
import type { InvoiceLineRow, RevenueInvoiceRow } from "@/lib/analytics/sales"

/**
 * BÁO CÁO NHÂN VIÊN — LỌC THEO NCC (chủ nhà 09/10/2026: "check báo cáo /reports/employees hàng bán theo nhân viên, bộ
 * lọc thương hiệu thay bằng NCC").
 *
 * Rà ra: đang lọc hàng (Hàng hoá / Thương hiệu) thì các tab Bán hàng / Lợi nhuận / Theo khách / Theo sản phẩm vẫn cộng
 * NGUYÊN tiền hoá đơn (Lợi nhuận còn trừ giá vốn CHỈ của hàng đã lọc → lãi phồng), và cột "Giảm giá đơn" của tab Hàng
 * bán theo nhân viên cộng giảm giá của MỌI hoá đơn. Nay: tiền cấp nhân viên = phần phân bổ của chứng từ cho các dòng
 * qua lọc — CÙNG LUẬT với Báo cáo tổng hợp (`dungDongBan`).
 */
const A = "sp-a"
const B = "sp-b"
const quaA = (pid: string) => pid === A

describe("phanTienQuaLoc — phần tiền chứng từ của các dòng qua lọc", () => {
  it("chia theo tỉ lệ line_total; dòng cuối nhận phần dư (Σ đúng bằng tiền chứng từ)", () => {
    const ls = [
      { product_id: A, line_total: 800_000 },
      { product_id: B, line_total: 300_000 },
    ]
    expect(phanTienQuaLoc(1_100_000, ls, quaA)).toBe(800_000)
    expect(phanTienQuaLoc(1_100_000, ls, (p) => p === B)).toBe(300_000)
    // Giảm giá cả đơn 100.000 chia theo cùng tỉ lệ: 72.727 + 27.273.
    expect(phanTienQuaLoc(100_000, ls, quaA)).toBe(72_727)
    expect(phanTienQuaLoc(100_000, ls, (p) => p === B)).toBe(27_273)
    expect(phanTienQuaLoc(100_000, ls, () => true)).toBe(100_000)
  })

  it("dòng hàng đổi không nhận phần; không dòng nào qua lọc → 0", () => {
    const ls = [
      { product_id: A, line_total: 500_000 },
      { product_id: B, line_total: 500_000, is_exchange: true },
    ]
    expect(phanTienQuaLoc(550_000, ls, quaA)).toBe(550_000)
    expect(phanTienQuaLoc(550_000, ls, (p) => p === B)).toBe(0)
    expect(coDongQuaLoc(ls, (p) => p === B)).toBe(false)
    expect(coDongQuaLoc(ls, quaA)).toBe(true)
  })

  it("không có dòng / Σ dòng ≤ 0: cả tiền về dòng đầu (như Báo cáo tổng hợp)", () => {
    expect(phanTienQuaLoc(300_000, [], () => true)).toBe(0)
    expect(phanTienQuaLoc(300_000, [{ product_id: A, line_total: 0 }, { product_id: B, line_total: 0 }], quaA)).toBe(300_000)
    expect(phanTienQuaLoc(300_000, [{ product_id: A, line_total: 0 }, { product_id: B, line_total: 0 }], (p) => p === B)).toBe(0)
  })

  it("KHỚP từng đồng với phân bổ của Báo cáo tổng hợp (`dungDongBan`)", () => {
    const hd = {
      id: "hd1", invoice_code: "HD1", invoice_date: "2026-10-05", order_id: "o1", status: "posted",
      total: 1_234_567, subtotal: 1_100_000, vat: 134_567, customer_id: "kh1", sales_user_id: "nv1", posted_by: "nv1",
    } as unknown as RevenueInvoiceRow
    const dong = [
      { id: "l1", invoice_id: "hd1", product_id: A, unit_name: "hộp", conversion_factor: 1, quantity: 3, unit_price: 111_111, line_total: 333_333 },
      { id: "l2", invoice_id: "hd1", product_id: B, unit_name: "hộp", conversion_factor: 1, quantity: 7, unit_price: 99_999, line_total: 699_993 },
      { id: "l3", invoice_id: "hd1", product_id: A, unit_name: "hộp", conversion_factor: 1, quantity: 1, unit_price: 166_674, line_total: 166_674 },
    ] as InvoiceLineRow[]
    const { dong: tong } = dungDongBan({
      hoaDon: [hd], dongHd: dong, tra: [], dongTra: [], giaVonCoSo: new Map(), giaVonTra: new Map(), nvTra: new Map(),
      dm: danhMucRong(),
    })
    const tienA = tong.filter((d) => d.sp === A).reduce((s, d) => s + d.tien, 0)
    const tienB = tong.filter((d) => d.sp === B).reduce((s, d) => s + d.tien, 0)
    expect(phanTienQuaLoc(1_234_567, dong, quaA)).toBe(tienA)
    expect(phanTienQuaLoc(1_234_567, dong, (p) => p === B)).toBe(tienB)
    expect(tienA + tienB).toBe(1_234_567)
  })
})

describe("màn /reports/employees — bộ lọc NCC và tiền theo hàng được lọc", () => {
  const s = readFileSync(resolve(__dirname, "../src/app/(dashboard)/reports/employees/page.tsx"), "utf-8")
  /** Thân một useMemo theo tên biến (tới dòng `}, [` đóng nó). */
  const memo = (ten: string) => {
    const i = s.indexOf(`const ${ten}`)
    expect(i, `không thấy ${ten}`).toBeGreaterThan(0)
    return s.slice(i, s.indexOf("\n  }, [", i))
  }

  it("lọc NCC chính của mặt hàng, không còn lọc Thương hiệu", () => {
    /* Soi CODE (bỏ chú thích) — chú thích được phép nhắc lịch sử "thay cho Thương hiệu". */
    const code = s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
    expect(code).toContain('<FilterField label="Nhà cung cấp (chọn nhiều)">')
    expect(code).toContain("options={catalogs.suppliers}")
    expect(code).toContain('supplierFilter.includes(p.primary_supplier_id || "")')
    expect(code).toContain("sell_price, primary_supplier_id, ${COT_SP_QUY_DOI}")
    expect(code).not.toMatch(/brandFilter|Thương hiệu|catalogs\.brands|\bbrand\b/)
  })

  it("đang lọc hàng: chỉ chứng từ có dòng qua lọc, tiền = phần phân bổ", () => {
    expect(s).toContain("const coLocHang = productFilter.length > 0 || supplierFilter.length > 0")
    expect(memo("hoaDonTheoLoc")).toContain("total: phanTienQuaLoc(Number(o.total || 0), ls, productPasses)")
    expect(memo("phieuTraTheoLoc")).toContain("credit_note_amount: phanTienQuaLoc(Number(r.credit_note_amount || 0), ls, productPasses)")
    for (const m of ["hoaDonTheoLoc", "phieuTraTheoLoc"]) expect(memo(m)).toContain("coDongQuaLoc(ls, productPasses)")
  })

  it("MỌI tab cộng tiền qua hoaDonTheoLoc / returnsTheoNv — không tab nào còn đọc thẳng hoá đơn thô", () => {
    for (const m of ["salesRows", "profitRows", "employeeProductRows", "employeeCustomerRows", "employeeSummaryRows"]) {
      expect(memo(m), m).not.toMatch(/\bof invoices\b|\binvoices\.filter\b/)
      expect(memo(m), m).toMatch(/hoaDonTheoLoc/)
    }
    expect(memo("returnsTheoNv")).toContain("for (const r of phieuTraTheoLoc)")
  })

  it("Hàng bán theo nhân viên: giảm giá đơn là phần của hàng được lọc; tiền chứng từ chốt cả khi lọc", () => {
    const f = memo("employeeSummaryRows")
    expect(f).toContain("tien: coLocHang ? phanTienQuaLoc(giam, dongHd, productPasses) : giam")
    expect(f).toContain("chotTienChungTu(congHangBanNhanVien({ ban, tra, sanPham: productMap, giamDon }), tienHd, tienTra)")
  })
})
