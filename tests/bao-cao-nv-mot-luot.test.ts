import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { SupabaseClient } from "@supabase/supabase-js"
import { docSoBanMotLuot } from "@/lib/bao-cao/nap-ban-hang"

/**
 * ⚠ CHỦ NHÀ 03/11/2026: "Kiểm tra lại tại sao phần báo cáo lại load lâu thế" (vừa mở Báo cáo › Nhân viên và Báo cáo tổng
 *   hợp › Nhân viên). Đo bản build + sổ giả một tháng (3.000 HĐ × 6 dòng, CPU ×4, trễ 60 ms, nén như production):
 *   Báo cáo › Nhân viên 91 câu / 6,4–6,7 s — hai đợt nối đuôi (21 lô dòng HĐ + 22 lô dòng kho + 20 lô soát phiếu xuất), giá vốn
 *   đọc cả khi không xem "Lợi nhuận", và cả 5 bảng mối quan tâm tính cùng lúc (~0,8 s JS ở CPU ×4). Nay: một lượt
 *   `bao_cao_so_ban` (như Báo cáo tổng hợp) cùng đợt với danh mục → 15 câu / 4,3–4,5 s; chỉ tính bảng đang xem.
 *   Bấm thật: e2e/bao-cao-nv-tong-chenh.spec.ts (một lượt), e2e/bao-cao-nv-25p02.spec.ts (đường lùi khi chưa có hàm).
 */
const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
const NV = doc("src/app/(dashboard)/reports/employees/page.tsx")
const thanLoad = () => {
  const i = NV.indexOf("const load = useCallback")
  return NV.slice(i, NV.indexOf("}, [", i))
}

/** Kết quả hàm máy chủ tối thiểu (đúng các khoá mig 256 trả). */
const MOT = {
  hd: [{ id: "h1", invoice_code: "HD1", invoice_date: "2026-09-20", order_id: null, status: "posted", total: "1080", subtotal: "1000", vat: "80", customer_id: "k1", sales_user_id: null, posted_by: "u", payment_terms: "COD" }],
  dong_hd: [{ id: "l1", invoice_id: "h1", product_id: "p1", unit_name: "hộp", conversion_factor: 1, quantity: 10, unit_price: 100, line_total: 1000, is_exchange: false, line_discount: 0, order_line_id: null }],
  tra: [{ id: "r1", status: "completed", customer_id: "k1", invoice_id: "h1", credit_note_amount: "216", created_at: "2026-09-21T04:00:00Z", revenue_date: "2026-09-21", sales_user_id: "nv1", reason: "damaged", credit_with_invoice: false, ma: "TH-1" }],
  dong_tra: [{ return_id: "r1", product_id: "p1", unit_name: "hộp", quantity: 2, line_total: 216, unit_price: 100 }],
  gv: [{ product_id: "p1", sl: 40, tien: 2800 }],
  gv_tra: [{ return_id: "r1", product_id: "p1", tien: 140 }],
}
const sbVoi = (kq: { data: unknown; error: unknown }) => {
  const rpc = vi.fn(async () => kq)
  return { sb: { rpc } as unknown as SupabaseClient, rpc }
}

describe("docSoBanMotLuot — một lượt qua bao_cao_so_ban, đúng dạng dòng của cách đọc từng bảng", () => {
  it("gọi bằng GET đúng kỳ; chuẩn hoá như cách cũ (tiền ra số, NV rỗng → '', ngày phiếu trả = ngày trừ doanh số)", async () => {
    const { sb, rpc } = sbVoi({ data: MOT, error: null })
    const so = await docSoBanMotLuot(sb, "2026-09-01", "2026-09-30")
    expect(rpc).toHaveBeenCalledWith("bao_cao_so_ban", { p_tu: "2026-09-01", p_den: "2026-09-30" }, { get: true })
    expect(so!.hd[0]).toMatchObject({ id: "h1", total: 1080, subtotal: 1000, vat: 80, sales_user_id: "" })
    expect(so!.tra[0]).toEqual({ id: "r1", status: "completed", customer_id: "k1", credit_note_amount: 216, created_at: "2026-09-21", sales_user_id: "nv1", invoice_id: "h1" })
    // Dòng trả giữ đơn giá TRƯỚC thuế (chênh trả không lấy line_total gồm VAT).
    expect(so!.dongTra[0]).toMatchObject({ unit_price: 100, line_total: 216 })
    // Giá vốn bình quân mỗi đơn vị cơ sở = Σ tiền / Σ SL; giá vốn hàng trả theo phiếu.
    expect(so!.giaVonCoSo.get("p1")).toBe(70)
    expect(so!.giaVonTra.get("r1")).toEqual({ total: 140, byProduct: new Map([["p1", 140]]) })
    expect(so!.thieu).toBe(false)
  })
  it("sổ chưa có hàm (PGRST202) → null để nơi gọi đọc từng bảng; lỗi khác thì NÉM", async () => {
    expect(await docSoBanMotLuot(sbVoi({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }).sb, "a", "b")).toBeNull()
    await expect(docSoBanMotLuot(sbVoi({ data: null, error: { code: "57014", message: "canceling statement" } }).sb, "a", "b")).rejects.toThrow(/đọc số bán: canceling statement/)
  })
})

describe("Báo cáo › Nhân viên (cả /bao-cao/nhan-vien) đọc một lượt", () => {
  it("hàm một lượt đi CÙNG ĐỢT với danh mục (nhân viên, khách, mặt hàng) — không chờ nhau", () => {
    const s = thanLoad()
    const i = s.indexOf("const [mot, usersRes, customersRes, productsRes] = await Promise.all([")
    expect(i).toBeGreaterThan(-1)
    const dot = s.slice(i, s.indexOf("])", i))
    expect(dot).toContain("docSoBanMotLuot(supabase, range.from, range.to)")
    for (const b of ['"users"', '"customers"', '"products"']) expect(dot).toContain(b)
  })
  it("có kết quả một lượt thì KHÔNG đọc bảng nào nữa (return trước đường đọc từng bảng); giá vốn lấy bản máy chủ đã gộp", () => {
    const s = thanLoad()
    const nhanh = s.slice(s.indexOf("if (mot) {"), s.indexOf("return\n", s.indexOf("if (mot) {")))
    expect(nhanh).toContain("setInvoices(mot.hd)")
    expect(nhanh).toContain("setLines(mot.dongHd)")
    expect(nhanh).toContain("setReturns(mot.tra)")
    expect(nhanh).toContain("setReturnLines(mot.dongTra)")
    expect(nhanh).toContain("setGiaVonMotLuot(mot.giaVonCoSo)")
    expect(nhanh).toContain("setReturnCosts(mot.giaVonTra)")
    expect(nhanh).not.toMatch(/fetch\w+\(/)
    // Đường lùi (sổ chưa có hàm) ở SAU nhánh ấy, còn nguyên cách đọc từng bảng.
    const lui = s.slice(s.indexOf("return\n", s.indexOf("if (mot) {")))
    for (const f of ["fetchRevenueInvoicesDu(", "fetchReturnsRowsDu(", "fetchInvoiceLines(", "fetchStockEntryLines(", "fetchReturnLines(", "fetchReturnCosts("]) expect(lui, f).toContain(f)
    expect(lui).toContain("setGiaVonMotLuot(null)")
    expect(NV).toContain("const avgCostMap = useMemo(() => giaVonMotLuot ?? giaVonBinhQuanCoSo(stockLines), [giaVonMotLuot, stockLines])")
  })
  it("dòng hàng đổi hàm trả về vẫn bị bỏ (như cách cũ lọc ở câu hỏi)", () => {
    const i = NV.indexOf("const linesByInvoice = useMemo(")
    expect(NV.slice(i, NV.indexOf("}, [lines])", i))).toContain("if (l.is_exchange) continue")
  })
  it("báo thời gian nạp về nhật ký ([bao-cao-nap]) — cả khi hỏng; màn riêng / màn chung tách tên", () => {
    const s = thanLoad()
    expect(s).toContain('baoNapSauKhiVe(chiHangBan ? "bc-hang-ban-nv" : "bc-nhan-vien", batDau, { loi: loiNap, dong: soHd })')
    expect(s.indexOf("loiNap = errorMessage(err)")).toBeGreaterThan(s.indexOf("} catch (err) {"))
    expect(s.indexOf("baoNapSauKhiVe(")).toBeGreaterThan(s.indexOf("} finally {"))
  })
})

describe("chỉ tính bảng của mối quan tâm đang xem", () => {
  const BANG: Array<[string, string]> = [
    ["const salesRows: SalesRow[] = useMemo(() => {", "sales"],
    ["const profitRows: ProfitRow[] = useMemo(() => {", "profit"],
    ["const employeeProductRows: EmployeeProductRow[] = useMemo(() => {", "products"],
    ["const employeeCustomerRows: EmployeeCustomerRow[] = useMemo(() => {", "by_customer"],
    ["const employeeSummaryRows: SummaryRow[] = useMemo(() => {", "summary"],
  ]
  it.each(BANG)("%s → chỉ khi variant = %s, và tính lại khi đổi mối quan tâm", (dau, v) => {
    const i = NV.indexOf(dau)
    expect(i).toBeGreaterThan(-1)
    const than = NV.slice(i, NV.indexOf("\n  ])", i) > -1 && NV.indexOf("\n  ])", i) < NV.indexOf("\n  }, [", i) + 400 ? NV.indexOf("\n  ])", i) + 5 : NV.indexOf("\n", NV.indexOf("\n  }, [", i) + 1))
    expect(than.slice(0, 400)).toContain(`if (variant !== "${v}") return []`)
    // Mảng phụ thuộc có `variant` (không thì đổi mối quan tâm vẫn thấy bảng rỗng).
    const deps = than.slice(than.lastIndexOf("}, ["))
    expect(deps).toMatch(/\[\s*variant,/)
  })
})
