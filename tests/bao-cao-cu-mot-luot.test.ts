import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { SupabaseClient } from "@supabase/supabase-js"
import { docSoBanKy, docSoBanMotLuot, tuMotLuot } from "@/lib/bao-cao/nap-ban-hang"
import { nhanVienPhieuTra } from "@/lib/analytics/hang-ban-nhan-vien"

/**
 * ⚠ CHỦ NHÀ 03/11/2026: "chuyển nốt các báo cáo cũ đi em" — các báo cáo cũ (/reports/sales, customers, products, finance;
 *   /analytics/business/overview, cost-profit; /analytics/products/overview, categories) đọc số bán MỘT LƯỢT qua
 *   `bao_cao_so_ban` (`docSoBanKy`), cùng đợt với danh mục. Số phải Y HỆT đường đọc từng bảng — bấm thật so hai đường:
 *   e2e/bao-cao-cu-mot-luot.spec.ts. Đo trước (bản build, sổ giả một tháng, CPU ×4): Bán hàng 92 câu / 4,4–4,6 s, Tài chính
 *   83 câu / 4,3–4,4 s, Phân tích › Tổng quan 91 câu / 4,3–4,4 s…
 */
const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
const thanLoad = (s: string) => {
  const i = s.indexOf("const load = useCallback(async () => {")
  return s.slice(i, s.indexOf("\n  }, [", i))
}

const hd = (id: string, ngay: string, nv: string | null) => ({
  id, invoice_code: id.toUpperCase(), invoice_date: ngay, order_id: null, status: "posted", total: "100", subtotal: "100", vat: "0",
  customer_id: "k1", sales_user_id: nv, posted_by: "u", payment_terms: "COD",
})
const tra = (id: string) => ({
  id, status: "completed", customer_id: "k1", invoice_id: null, credit_note_amount: "10", created_at: "2026-09-29T04:00:00Z",
  revenue_date: "2026-09-29", sales_user_id: null, reason: null, credit_with_invoice: false, ma: null,
})
const MOT = {
  // Hàm máy chủ KHÔNG xếp: B (cùng ngày) đứng trước A, ngày cũ chen giữa.
  hd: [hd("hd-b", "2026-09-29", "nvB"), hd("hd-cu", "2026-09-01", "nvC"), hd("hd-a", "2026-09-29", "nvA")],
  dong_hd: [
    { id: "l1", invoice_id: "hd-a", product_id: "p1", unit_name: "thùng", conversion_factor: 24, quantity: 2, unit_price: 470000, line_total: 940000, is_exchange: false, line_discount: 0, order_line_id: null },
    { id: "l2", invoice_id: "hd-a", product_id: "p1", unit_name: "hộp", conversion_factor: 1, quantity: 3, unit_price: 0, line_total: 0, is_exchange: true, line_discount: 0, order_line_id: null },
  ],
  tra: [tra("tr-2"), tra("tr-1")],
  dong_tra: [],
  gv: [{ product_id: "p1", sl: 58, tien: 870000 }, { product_id: "p2", sl: 10, tien: 150000 }],
  gv_tra: [{ return_id: "tr-1", product_id: "p1", tien: 30000 }],
}
const sbVoi = (kq: { data: unknown; error: unknown }) => {
  const rpc = vi.fn(async () => kq)
  return { sb: { rpc } as unknown as SupabaseClient, rpc }
}

describe("tuMotLuot — cùng THỨ TỰ với cách đọc từng bảng", () => {
  it("hoá đơn: ngày giảm dần rồi id (như fetchRevenueInvoicesDu); phiếu trả theo id (như fetchReturnsRowsDu)", () => {
    const x = tuMotLuot(MOT as never)
    expect(x.hd.map((h) => h.id)).toEqual(["hd-a", "hd-b", "hd-cu"])
    expect(x.tra.map((t) => t.id)).toEqual(["tr-1", "tr-2"])
  })
  it("phiếu trả cũ (không NV, không gắn HĐ) đoán theo HĐ gần nhất: hai HĐ cùng ngày → HĐ đứng trước theo cách cũ (hd-a)", () => {
    const x = tuMotLuot(MOT as never)
    expect(nhanVienPhieuTra(x.tra, x.hd).get("tr-1")).toBe("nvA")
    // Thứ tự thô của hàm máy chủ ra NV B — đúng lỗi bản chưa xếp.
    const tho = MOT.hd.map((h) => ({ ...h, sales_user_id: h.sales_user_id ?? "" }))
    expect(nhanVienPhieuTra(x.tra, tho).get("tr-1")).toBe("nvB")
  })
  it("giá vốn xuất cả kỳ = Σ tiền (= fetchCogsForRange.cogs); theo mặt hàng = Σ tiền của mặt hàng", () => {
    const x = tuMotLuot(MOT as never)
    expect(x.giaVonXuat).toBe(1020000)
    expect(Array.from(x.giaVonTheoSp)).toEqual([["p1", 870000], ["p2", 150000]])
    expect(x.giaVonCoSo.get("p1")).toBe(15000)
  })
})

describe("docSoBanKy — tập dòng của các báo cáo cũ", () => {
  it("gọi bao_cao_so_ban bằng GET đúng kỳ; BỎ dòng hàng đổi (như fetchInvoiceLines `is_exchange = false`)", async () => {
    const { sb, rpc } = sbVoi({ data: MOT, error: null })
    const x = await docSoBanKy(sb, { from: "2026-09-01", to: "2026-09-30" })
    expect(rpc).toHaveBeenCalledWith("bao_cao_so_ban", { p_tu: "2026-09-01", p_den: "2026-09-30" }, { get: true })
    expect(x!.dongHd.map((l) => l.id)).toEqual(["l1"])
    // docSoBanMotLuot (Báo cáo tổng hợp / Báo cáo › Nhân viên) vẫn nhận đủ — nơi gọi tự bỏ hàng đổi theo luật của nó.
    expect((await docSoBanMotLuot(sbVoi({ data: MOT, error: null }).sb, "a", "b"))!.dongHd).toHaveLength(2)
  })
  it("sổ chưa có hàm → null (màn đọc từng bảng); lỗi khác thì NÉM", async () => {
    expect(await docSoBanKy(sbVoi({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }).sb, { from: "a", to: "b" })).toBeNull()
    await expect(docSoBanKy(sbVoi({ data: null, error: { code: "57014", message: "canceling statement" } }).sb, { from: "a", to: "b" })).rejects.toThrow(/đọc số bán: canceling statement/)
  })
})

const R = "src/app/(dashboard)/reports"
const A = "src/app/(dashboard)/analytics"
/** [tệp, mảng đầu của đợt đầu, khoá đo nạp, số lượt hàm một lượt (1 = kỳ này; 2 = kỳ này + kỳ trước)]. */
const MAN: Array<[string, string, string, 1 | 2]> = [
  [`${R}/sales/page.tsx`, "const [mot, customersRes, usersRes, suppliersRes, productsRes] = await Promise.all([", "bc-ban-hang", 1],
  [`${R}/customers/page.tsx`, "const [mot, customersRes, productsRes, receivablesRes] = await Promise.all([", "bc-khach-hang", 1],
  [`${R}/products/page.tsx`, "const [mot, productsRes, customersRes, suppliersRes] = await Promise.all([", "bc-hang-hoa", 1],
  [`${R}/finance/page.tsx`, "const [mot, expensesRes, recvRes, payRes, batchesRes, cashRes] =", "bc-tai-chinh", 1],
  [`${A}/business/overview/page.tsx`, "const [mot, motTruoc, customersRes, productsRes, usersRes] = await Promise.all([", "pt-tong-quan", 2],
  [`${A}/business/cost-profit/page.tsx`, "const [mot, motTruoc, exp, prevExp] = await Promise.all([", "pt-chi-phi-loi-nhuan", 2],
  [`${A}/products/overview/page.tsx`, "const [mot, motTruoc, productsRes] = await Promise.all([", "pt-hang-tong-quan", 2],
  [`${A}/products/categories/page.tsx`, "const [mot, motTruoc, productsRes, suppliersRes] = await Promise.all([", "pt-hang-nhom", 2],
]

describe("8 báo cáo cũ: một lượt CÙNG ĐỢT với danh mục; sổ chưa có hàm thì đọc từng bảng như cũ", () => {
  it.each(MAN)("%s", (tep, dauDot, khoa, soLuot) => {
    const s = boChuThich(doc(tep))
    const than = thanLoad(s)
    const i = than.indexOf(dauDot)
    expect(i, "đợt đầu").toBeGreaterThan(-1)
    // Đợt đầu: hàm một lượt (kỳ này [+ kỳ trước]) — không chờ đợt nào trước nó.
    const dot = than.slice(i, than.indexOf("])", i))
    // Tài chính đọc theo kỳ hiệu lực (`r` = tháng / cả năm).
    expect(dot).toMatch(/docSoBanKy\(supabase, (range|r)\)/)
    if (soLuot === 2) expect(dot).toContain("docSoBanKy(supabase, prev)")
    expect(than.slice(0, i)).not.toContain("await ")
    // Đợt đầu không còn câu đọc từng bảng của số bán.
    for (const f of ["fetchRevenueInvoicesDu(", "fetchReturnsRowsDu(", "fetchReturnsValueDu(", "fetchCogsForRange(", "fetchInvoiceLines("]) {
      expect(dot, f).not.toContain(f)
    }
    // Đường lùi còn nguyên (đọc từng bảng) — sau nhánh một lượt.
    expect(than.slice(i)).toContain("fetchRevenueInvoicesDu(")
    // Đo thời gian nạp thực tế (`[bao-cao-nap]`).
    expect(than).toContain(`baoNapSauKhiVe("${khoa}", batDau, { loi: loiNap, dong: soHd })`)
  })

  it("khoá đo nạp của 8 màn có trong ManBaoCao; /api/do-nap ghi '[bao-cao-nap]' cho bc-… và pt-…", () => {
    const bao = doc("src/lib/pos/bao-nap.ts")
    for (const [, , khoa] of MAN) expect(bao).toContain(`"${khoa}"`)
    expect(doc("src/app/api/do-nap/route.ts")).toContain('/^(bc|pt)-/.test(man) ? "[bao-cao-nap]" : "[pos-nap]"')
  })
})

describe("chỉ tính / chỉ đọc phần đang xem", () => {
  it("Bán hàng: 5 bảng chỉ tính khi đang xem; giá vốn THEO NGÀY (tab Lợi nhuận, không lọc) đọc khi mở tab, kết quả kỳ cũ bị bỏ", () => {
    const s = boChuThich(doc(`${R}/sales/page.tsx`))
    for (const v of ["time", "profit", "discount", "returns", "employee"]) expect(s).toContain(`if (variant !== "${v}") return []`)
    expect(s).toMatch(/const canGiaVonNgay =\s*!loading && !loadError && stockLines === null && variant === "profit" &&/)
    expect(s).toContain("fetchCogsForRange(supabase, user.org_id, range)")
    expect(s).toMatch(/let bo = false[\s\S]*?if \(bo\) return\s*setStockLines\(cogsRes\.lines\)[\s\S]*?return \(\) => \{\s*bo = true/)
    expect(s).toContain(') : loading || (variant === "profit" && !dangLoc && stockLines === null) ? (')
    // Nhánh một lượt để trống dòng phiếu xuất (đọc khi cần), không đọc thêm bảng nào.
    const than = thanLoad(s)
    const nhanh = than.slice(than.indexOf("if (mot) {"), than.indexOf("return\n", than.indexOf("if (mot) {")))
    expect(nhanh).toContain("setStockLines(null)")
    expect(nhanh).toContain("setGiaVonMotLuot(mot.giaVonCoSo)")
    expect(nhanh).not.toMatch(/fetch\w+\(/)
  })

  it("Khách hàng: 4 bảng chỉ tính khi đang xem; giá vốn bình quân lấy bản máy chủ gộp sẵn", () => {
    const s = boChuThich(doc(`${R}/customers/page.tsx`))
    for (const v of ["sales", "profit", "receivables", "products"]) expect(s).toContain(`if (variant !== "${v}") return []`)
    expect(s).toContain("const avgCost = giaVonMotLuot ?? giaVonBinhQuanCoSo(stockLines)")
  })

  it("Hàng hoá: phần KHO (lô tồn · phiếu kho + biến động) đọc khi mở tab kho; giá vốn theo mặt hàng của hàm máy chủ", () => {
    const s = boChuThich(doc(`${R}/products/page.tsx`))
    for (const v of ["sales", "profit", "stock_value"]) expect(s).toContain(`if (variant !== "${v}") return []`)
    expect(s).toContain("const canLo = !loading && !loadError && !loDaNap && xemKho")
    expect(s).toContain("const canXnt = !loading && !loadError && !xntDaNap && xemXnt")
    expect(s).toContain(") : loading || (xemKho && !loDaNap) || (xemXnt && !xntDaNap) ? (")
    expect(s).toContain("if (giaVonTheoSpMotLuot) return giaVonTheoSpMotLuot")
    const than = thanLoad(s)
    const nhanh = than.slice(than.indexOf("if (mot) {"), than.indexOf("return\n", than.indexOf("if (mot) {")))
    expect(nhanh).toContain("setGiaVonTheoSpMotLuot(mot.giaVonTheoSp)")
    expect(nhanh).toContain("setLoDaNap(false)")
    expect(nhanh).toContain("setXntDaNap(false)")
    expect(nhanh).not.toMatch(/fetch\w+\(|docLoTon\(|napBienDong\(/)
  })
})
