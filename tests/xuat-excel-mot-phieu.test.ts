/**
 * Chủ nhà 05/10/2026: "xuất excel cho chi tiết 8 loại phiếu", rồi "xuất excel như kiểu mẫu in hoá đơn ấy". Trang
 * chi tiết xuất MỘT tờ như tờ in: đầu công ty, tiêu đề, khách, bảng kẻ ô, dòng tổng trong bảng, bằng chữ, ô ký.
 * Bấm thật: e2e/xuat-excel-phieu.spec.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import * as XLSX from "xlsx"
import type { SupabaseClient } from "@supabase/supabase-js"
import { tenTepMotPhieu } from "@/lib/xuat-excel/phieu"
import { CHON_MOT_PHIEU, xepDong, xuatMotPhieu, type LoaiPhieuXuat } from "@/lib/xuat-excel/mot-phieu"
import { chiaNhom, dungMauIn, mauBanHang, soDongChu } from "@/lib/xuat-excel/mau-in"
import { cacTepXlsx, nenXlsx, tenO, type SheetDinhDang } from "@/lib/xuat-excel/xlsx-dinh-dang"

type Dong = Record<string, unknown>

/** Sổ giả: from().select().eq/neq/in().order().limit().range()/maybeSingle() — đủ cho `xuatMotPhieu`. */
function soGia(bang: Record<string, Dong[]>, loi: Record<string, string> = {}) {
  const goi: Array<{ bang: string; loc: Array<[string, unknown]> }> = []
  const from = (ten: string) => {
    const loc: Array<(r: Dong) => boolean> = []
    const ghi = { bang: ten, loc: [] as Array<[string, unknown]> }
    goi.push(ghi)
    let tu = 0, den = Infinity
    const ketQua = () => {
      if (loi[ten]) return { data: null, error: { message: loi[ten] }, count: null }
      const rows = (bang[ten] ?? []).filter((r) => loc.every((f) => f(r)))
      return { data: rows.slice(tu, den + 1), error: null, count: rows.length }
    }
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => { ghi.loc.push([c, v]); loc.push((r) => r[c] === v); return q },
      neq: (c: string, v: unknown) => { loc.push((r) => r[c] !== v); return q },
      in: (c: string, v: unknown[]) => { ghi.loc.push([c, v]); loc.push((r) => v.includes(r[c])); return q },
      order: () => q,
      limit: () => q,
      range: (a: number, b: number) => { tu = a; den = b; return q },
      maybeSingle: async () => { const k = ketQua(); return { data: k.data?.[0] ?? null, error: k.error } },
      then: (ok: (v: unknown) => unknown, sai?: (e: unknown) => unknown) => Promise.resolve(ketQua()).then(ok, sai),
    }
    return q
  }
  return { sb: { from } as unknown as SupabaseClient, goi }
}

const ORG = { id: "o1", name: "NPP Minh Huy", settings: { address: "12 Lê Lợi", phone: "0909" } }
const SUA = { sku: "SUA1", name: "Sữa hộp", base_unit: "hộp", units: [{ unit_name: "thùng", conversion: 24 }] }

/** Sheet → lưới chữ / số (đọc lại tệp đã nén, như Excel mở). */
function luoi(sh: SheetDinhDang): Array<Array<string | number>> {
  const wb = XLSX.read(nenXlsx(XLSX, [sh]))
  return XLSX.utils.sheet_to_json<Array<string | number>>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" })
}
const dongCo = (g: Array<Array<string | number>>, chu: string) => g.find((r) => r.some((x) => x === chu)) ?? []
const coChu = (g: Array<Array<string | number>>, re: RegExp) => g.some((r) => r.some((x) => typeof x === "string" && re.test(x)))

describe("tên tệp một phiếu", () => {
  const d = new Date("2026-10-05T13:00:00Z")
  it("tiền tố + mã + ngày VN", () => {
    expect(tenTepMotPhieu("tra-hang-ncc", "TN-0001", d)).toBe("tra-hang-ncc_TN-0001_2026-10-05.xlsx")
  })
  it("ký tự lạ / dấu tiếng Việt trong mã bị thay; không có mã thì như tên tệp danh sách", () => {
    expect(tenTepMotPhieu("chi-phi", "CP 01/Điện", d)).toBe("chi-phi_CP-01-Dien_2026-10-05.xlsx")
    expect(tenTepMotPhieu("tra-hang", "", d)).toBe("tra-hang_2026-10-05.xlsx")
  })
})

describe("ghi .xlsx có định dạng (thư viện bản cộng đồng không ghi kiểu ô)", () => {
  const sh: SheetDinhDang = {
    ten: "HD/1",
    rong: [5, 30, 12],
    gop: [[0, 0, 0, 2]],
    dong: [
      { o: [{ v: "HÓA ĐƠN BÁN HÀNG", k: { dam: true, co: 16, canh: "giua" } }] },
      { o: [{ v: "STT", k: { vien: true } }, { v: null, doan: [{ t: "Khách: " }, { t: "Cô <Ba> & con", dam: true }], k: { vien: true } }, { v: -1234567, k: { vien: true, so: true } }] },
    ],
  }
  it("Excel đọc lại được: chữ, số (âm vẫn là số), vùng gộp, tên sheet hợp lệ", () => {
    const wb = XLSX.read(nenXlsx(XLSX, [sh]))
    expect(wb.SheetNames).toEqual(["HD-1"])
    const ws = wb.Sheets["HD-1"]
    expect(ws.A1.v).toBe("HÓA ĐƠN BÁN HÀNG")
    expect(ws.B2.v).toBe("Khách: Cô <Ba> & con")
    expect(ws.C2).toMatchObject({ t: "n", v: -1234567 })
    expect(ws["!merges"]).toEqual([{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }])
  })
  it("kiểu ô thật: chữ đậm, cỡ 16, kẻ ô, định dạng #,##0, khổ A5 vừa một trang ngang, ẩn lưới", () => {
    const tep = cacTepXlsx([sh])
    const st = tep["xl/styles.xml"]
    expect(st).toMatch(/<font><b\/><sz val="16"\/><name val="Times New Roman"\/>/)
    expect(st).toMatch(/<left style="thin">/)
    expect(st).toMatch(/numFmtId="3"[^>]*borderId="1"/)
    const ws = tep["xl/worksheets/sheet1.xml"]
    expect(ws).toMatch(/paperSize="11"/)
    expect(ws).toMatch(/fitToWidth="1"/)
    expect(ws).toMatch(/showGridLines="0"/)
    // Chữ nhiều kiểu trong một ô — đoạn đậm.
    expect(ws).toMatch(/<r><rPr><b\/>[^]*?Cô &lt;Ba&gt; &amp; con/)
  })
  it("ô bị gộp lấy kiểu viền của ô đầu — viền không hở", () => {
    const ws = cacTepXlsx([{ ten: "x", rong: [5, 5], gop: [[0, 0, 0, 1]], dong: [{ o: [{ v: "Tổng", k: { vien: true } }] }] }])["xl/worksheets/sheet1.xml"]
    const s = Array.from(ws.matchAll(/<c r="([AB]1)" s="(\d+)"/g)).map((m) => [m[1], m[2]])
    expect(s).toHaveLength(2)
    expect(s[0][1]).toBe(s[1][1])
  })
  it("tên ô", () => {
    expect([tenO(0, 0), tenO(9, 25), tenO(0, 26)]).toEqual(["A1", "Z10", "AA1"])
  })
})

describe("khuôn tờ in", () => {
  it("chia ô ký: phần dư dồn vào giữa", () => {
    expect(chiaNhom(7, 3)).toEqual([2, 3, 2])
    expect(chiaNhom(6, 3)).toEqual([2, 2, 2])
    expect(chiaNhom(5, 3)).toEqual([2, 1, 2])
  })
  it("ước số dòng chữ để đặt chiều cao dòng (Excel không tự giãn ô gộp)", () => {
    expect(soDongChu("ngắn", 30)).toBe(1)
    expect(soDongChu("a\nb", 30)).toBe(2)
    expect(soDongChu("x".repeat(100), 30)).toBe(3)
  })
  it("hóa đơn: y như tờ in — ba dòng tổng, trừ hàng trả, còn phải thu, bằng chữ đọc số phải thu, ba ô ký", () => {
    const sh = dungMauIn(mauBanHang({
      ten: "HD-1", org: { name: "NPP Minh Huy", address: "12 Lê Lợi", phone: "0909" }, tieuDe: "HÓA ĐƠN BÁN HÀNG",
      nhanSo: "Số HĐ", so: "HD-1", ngay: new Date("2026-10-05T12:00:00+07:00"), coGio: false, khach: "Cô Ba",
      lines: [{ id: "1", name: "Sữa", spec: "SUA1", unitName: "thùng", quantity: 2, unitPrice: 450000, discount: 0, lineTotal: 900000 }],
      total: 900000, traHang: 200000,
      dongTra: [{ id: "r", name: "Sữa", unitName: "hộp", quantity: 5, unitPrice: 40000, credit: 200000, isExchange: false }],
    }))
    const g = luoi(sh)
    expect(g[0][0]).toBe("NPP MINH HUY")
    expect(coChu(g, /^HÓA ĐƠN BÁN HÀNG$/)).toBe(true)
    expect(coChu(g, /^Ngày 05\/10\/2026$/)).toBe(true)
    expect(dongCo(g, "STT")).toEqual(["STT", "Tên hàng và quy cách", "ĐVT", "SL", "Đ.giá", "CK", "Thành tiền"])
    expect(dongCo(g, "Sữa (SUA1)")).toEqual([1, "Sữa (SUA1)", "thùng", 2, 450000, 0, 900000])
    expect(dongCo(g, "(Hàng trả) Sữa").slice(-1)).toEqual([-200000])
    expect(dongCo(g, "Tổng tiền hàng").slice(-1)).toEqual([900000])
    expect(dongCo(g, "Tổng cộng").slice(-1)).toEqual([900000])
    expect(dongCo(g, "Trừ hàng trả").slice(-1)).toEqual([-200000])
    expect(dongCo(g, "Còn phải thu").slice(-1)).toEqual([700000])
    expect(coChu(g, /^Bằng chữ: Bảy trăm nghìn đồng$/)).toBe(true)
    expect(dongCo(g, "Người nhận hàng").filter(Boolean)).toEqual(["Người nhận hàng", "Kế toán", "Người bán"])
    // Bảng kẻ ô.
    expect(sh.dong.find((d) => d.o[0]?.v === "STT")?.o.every((o) => o?.k?.vien)).toBe(true)
  })
})

describe("xuatMotPhieu — đọc đúng một phiếu, ra tờ như mẫu in", () => {
  it("Hóa đơn: bỏ dòng hàng đổi xuất đi, trừ phiếu tự sinh (kể cả Chờ xử lý), không trừ phiếu tự lập nháp", async () => {
    const { sb } = soGia({
      organizations: [ORG],
      sales_invoices: [{
        id: "hd", org_id: "o1", invoice_code: "HD-1", invoice_date: "2026-10-02", status: "posted", subtotal: 900000, total: 900000,
        customer: { store_name: "Cô Ba", ward: "P. Cẩm Thủy", address: "47 Cẩm Bình", phone: "0912" }, sales_user: { full_name: "NV A", phone: "0988" },
        order: { order_code: "DH-9" },
      }],
      sales_invoice_lines: [
        { id: "x2", invoice_id: "hd", sort_order: 1, unit_name: "hộp", quantity: 1, unit_price: 0, line_total: 0, is_exchange: true, product: SUA },
        { id: "x1", invoice_id: "hd", sort_order: 0, unit_name: "thùng", quantity: 2, unit_price: 450000, line_total: 900000, product: SUA },
      ],
      returns: [
        { id: "t1", invoice_id: "hd", status: "submitted", credit_with_invoice: true, credit_note_amount: 200000, lines: [{ id: "rl", unit_name: "hộp", quantity: 5, unit_price: 40000, line_total: 200000, product: { name: "Sữa hộp" } }] },
        { id: "t2", invoice_id: "hd", status: "draft", credit_with_invoice: false, credit_note_amount: 999, lines: [] },
      ],
    })
    const kq = await xuatMotPhieu(sb, "hoa-don", "hd")
    expect(kq.ma).toBe("HD-1")
    expect(kq.sheets).toHaveLength(1)
    const g = luoi(kq.sheets[0])
    expect(g[0][0]).toBe("NPP MINH HUY")
    expect(coChu(g, /^Địa chỉ: 12 Lê Lợi$/)).toBe(true)
    expect(coChu(g, /^Địa chỉ: 47 Cẩm Bình, P\. Cẩm Thủy$/)).toBe(true)
    expect(coChu(g, /^Nhân Viên Bán Hàng: NV A - 0988$/)).toBe(true)
    expect(g.filter((r) => r[1] === "Sữa hộp (SUA1)")).toHaveLength(1)
    expect(dongCo(g, "Còn phải thu").slice(-1)).toEqual([700000])
    expect(coChu(g, /^Theo đơn DH-9$/)).toBe(true)
  })

  it("Hóa đơn đã phát hành điện tử: tờ không đổi số — không in trừ hàng trả", async () => {
    const { sb } = soGia({
      sales_invoices: [{ id: "hd", invoice_code: "HD-2", invoice_date: "2026-10-02", status: "posted", total: 900000 }],
      sales_invoice_lines: [{ id: "x1", invoice_id: "hd", unit_name: "thùng", quantity: 2, unit_price: 450000, line_total: 900000, product: SUA }],
      returns: [{ id: "t1", invoice_id: "hd", status: "completed", credit_with_invoice: true, credit_note_amount: 200000, lines: [] }],
      invoices: [{ sales_invoice_id: "hd", misa_inv_no: "0000123" }],
    })
    const g = luoi((await xuatMotPhieu(sb, "hoa-don", "hd")).sheets[0])
    expect(dongCo(g, "Còn phải thu")).toEqual([])
    expect(coChu(g, /^Bằng chữ: Chín trăm nghìn đồng$/)).toBe(true)
  })

  it("Hóa đơn huỷ: chân tờ ghi rõ không có giá trị thanh toán", async () => {
    const { sb } = soGia({ sales_invoices: [{ id: "hd", invoice_code: "HD-3", status: "cancelled", total: 1 }] })
    expect(coChu(luoi((await xuatMotPhieu(sb, "hoa-don", "hd")).sheets[0]), /HÓA ĐƠN ĐÃ HUỶ/)).toBe(true)
  })

  it("Đơn hàng: tiền hàng = subtotal + vat (không lấy total đã kẹp), trừ phiếu trả chưa huỷ", async () => {
    const { sb } = soGia({
      sales_orders: [{ id: "d", order_code: "DH-1", order_date: "2026-10-01", status: "confirmed", subtotal: 300000, vat: 0, total: 0 }],
      sales_order_lines: [{ id: "l", order_id: "d", unit_name: "hộp", quantity: 10, unit_price: 30000, line_total: 300000, product: SUA }],
      returns: [
        { id: "r1", order_id: "d", status: "draft", lines: [{ id: "a", unit_name: "hộp", quantity: 2, unit_price: 30000, line_total: 60000, product: { name: "Sữa hộp" } }] },
        { id: "r2", order_id: "d", status: "cancelled", lines: [{ id: "b", unit_name: "hộp", quantity: 9, unit_price: 30000, line_total: 270000 }] },
      ],
    })
    const kq = await xuatMotPhieu(sb, "don", "d")
    const g = luoi(kq.sheets[0])
    expect(coChu(g, /^ĐƠN ĐẶT HÀNG$/)).toBe(true)
    expect(coChu(g, /^Số ĐH: DH-1$/)).toBe(true)
    expect(dongCo(g, "Tổng cộng").slice(-1)).toEqual([300000])
    expect(dongCo(g, "Còn phải thu").slice(-1)).toEqual([240000])
    expect(coChu(g, /chưa phải chứng từ thanh toán/)).toBe(true)
  })

  it("Trả hàng khách: tiền trả ghi ÂM, hàng đổi \"không trừ\", bằng chữ đọc \"Âm …\"; mã TH- đọc riêng", async () => {
    const { sb } = soGia({
      returns: [{ id: "r1", return_code: "TH-0007", created_at: "2026-10-01T02:00:00Z", return_date: "2026-10-01", status: "completed", credit_note_amount: 50000, reason: "damaged", customer: { store_name: "Cô Ba" }, invoice: { invoice_code: "HD-1" } }],
      return_lines: [
        { id: "rl1", return_id: "r1", unit_name: "hộp", quantity: 2, unit_price: 25000, line_total: 50000, product: SUA },
        { id: "rl2", return_id: "r1", unit_name: "hộp", quantity: 1, unit_price: 25000, line_total: 25000, is_exchange: true, product: SUA },
      ],
    })
    const kq = await xuatMotPhieu(sb, "tra-khach", "r1")
    expect(kq.ma).toBe("TH-0007")
    const g = luoi(kq.sheets[0])
    expect(coChu(g, /^PHIẾU TRẢ HÀNG$/)).toBe(true)
    expect(coChu(g, /^Theo HĐ HD-1$/)).toBe(true)
    expect(dongCo(g, "Tổng trừ công nợ").slice(-1)).toEqual([-50000])
    expect(g.find((r) => r[5] === "không trừ")).toBeTruthy()
    expect(coChu(g, /^Bằng chữ: Âm năm mươi nghìn đồng$/)).toBe(true)
  })

  it("Phiếu nhập: dòng theo thứ tự trên phiếu, VAT gõ tay thắng VAT máy, người lập đọc riêng", async () => {
    const { sb } = soGia({
      purchase_invoices: [{ id: "pn", receipt_code: "PN-1", invoice_number: "HD9", invoice_date: "2026-10-03", status: "completed", warehouse_zone: "sale", subtotal: 1000000, vat: 100000, vat_override: 99000, discount: 0, total: 1099000, created_by: "u1", supplier: { name: "Vinamilk", code: "NCC1" } }],
      purchase_invoice_lines: [
        { id: "b", invoice_id: "pn", sort_order: 1, unit_name: "hộp", quantity: 10, unit_price: 10000, line_discount: 0, line_total: 100000, product: SUA },
        { id: "a", invoice_id: "pn", sort_order: 0, unit_name: "thùng", quantity: 2, unit_price: 450000, line_discount: 0, line_total: 900000, product: SUA },
      ],
      users: [{ id: "u1", full_name: "Chủ NPP" }],
    })
    const g = luoi((await xuatMotPhieu(sb, "nhap", "pn")).sheets[0])
    expect(coChu(g, /^PHIẾU NHẬP HÀNG$/)).toBe(true)
    expect(coChu(g, /^Nhà cung cấp: Vinamilk \(NCC1\)$/)).toBe(true)
    expect(g.filter((r) => r[1] === "Sữa hộp (SUA1)").map((r) => r[2])).toEqual(["thùng", "hộp"])
    expect(dongCo(g, "Thuế VAT").slice(-1)).toEqual([99000])
    expect(dongCo(g, "Cần trả nhà cung cấp").slice(-1)).toEqual([1099000])
    expect(coChu(g, /^Người lập: Chủ NPP$/)).toBe(true)
  })

  it("Phiếu kho: giá vốn chỉ khi được xem; không xem thì không cộng SL khác đơn vị", async () => {
    const so = {
      stock_entries: [{ id: "k", entry_code: "PK-1", type: "import", status: "posted", created_at: "2026-10-01T02:00:00Z" }],
      stock_entry_lines: [{ id: "kl", entry_id: "k", unit_name: "thùng", quantity: 1, qty_in_base_uom: 24, unit_cost: 1000, product: SUA }],
    }
    const co = luoi((await xuatMotPhieu(soGia(so).sb, "kho", "k", { giaVon: true })).sheets[0])
    expect(coChu(co, /^PHIẾU NHẬP KHO$/)).toBe(true)
    expect(dongCo(co, "Tổng giá trị").slice(-1)).toEqual([24000])
    const khong = luoi((await xuatMotPhieu(soGia(so).sb, "kho", "k")).sheets[0])
    expect(dongCo(khong, "STT")).not.toContain("Thành tiền")
    expect(coChu(khong, /^Tổng: 1 dòng hàng$/)).toBe(true)
  })

  it("Phiếu thu: dòng theo hóa đơn, tổng = số tiền phiếu, nộp lệch thì có dòng Đã nộp", async () => {
    const { sb } = soGia({
      cash_receipts: [{ id: "t", receipt_code: "PT-1", receipt_date: "2026-10-04", status: "received", expected_amount: 500000, submitted_amount: 480000 }],
      cash_receipt_lines: [{ id: "c", receipt_id: "t", amount: 500000, invoice: { id: "hd", invoice_code: "HD-1", invoice_date: "2026-10-02", customer: { store_name: "Cô Ba" } } }],
    })
    const g = luoi((await xuatMotPhieu(sb, "thu", "t")).sheets[0])
    expect(coChu(g, /^PHIẾU THU$/)).toBe(true)
    expect(dongCo(g, "Hóa đơn HD-1")).toEqual([1, "Hóa đơn HD-1", "02/10/2026", "Cô Ba", 500000])
    expect(dongCo(g, "Đã nộp").slice(-1)).toEqual([480000])
    expect(dongCo(g, "Người nộp tiền").filter(Boolean)).toEqual(["Người nộp tiền", "Người thu tiền", "Kế toán"])
  })

  it("Chi phí: phiếu chi một dòng", async () => {
    const { sb } = soGia({ expenses: [{ id: "e", expense_date: "2026-10-03", amount: 300000, description: "Đổ xăng", reference_code: "CP-9", is_paid: true, payment_method: "cash", category: { name: "Xăng", bucket: "operating" } }] })
    const kq = await xuatMotPhieu(sb, "chi", "e")
    expect(kq.ma).toBe("CP-9")
    const g = luoi(kq.sheets[0])
    expect(coChu(g, /^PHIẾU CHI$/)).toBe(true)
    expect(dongCo(g, "Đổ xăng")).toEqual([1, "Đổ xăng", "Xăng", "Tiền mặt", 300000])
    expect(coChu(g, /^Bằng chữ: Ba trăm nghìn đồng$/)).toBe(true)
  })

  it("Trả hàng NCC: lý do theo nhãn, tổng giảm công nợ NCC", async () => {
    const { sb, goi } = soGia({
      supplier_returns: [
        { id: "a", return_code: "TN-1", return_date: "2026-10-01", status: "completed", subtotal: 100000, vat: 10000, discount: 0, total: 110000, reason: "near_expiry", warehouse_zone: "date", supplier: { name: "Vinamilk" } },
        { id: "b", return_code: "TN-2", status: "draft", total: 5 },
      ],
      supplier_return_lines: [
        { id: "l1", return_id: "a", sort_order: 0, unit_name: "thùng", quantity: 2, unit_price: 50000, line_total: 100000, product: SUA },
        { id: "l2", return_id: "b", sort_order: 0, unit_name: "hộp", quantity: 1, unit_price: 5, line_total: 5, product: SUA },
      ],
    })
    const kq = await xuatMotPhieu(sb, "tra-ncc", "a")
    expect(kq.ma).toBe("TN-1")
    const g = luoi(kq.sheets[0])
    expect(coChu(g, /^Lý do trả: Hàng gần hạn$/)).toBe(true)
    expect(g.filter((r) => r[1] === "Sữa hộp (SUA1)")).toHaveLength(1)
    expect(dongCo(g, "Tổng tiền (giảm công nợ NCC)").slice(-1)).toEqual([110000])
    expect(goi[0]).toEqual({ bang: "supplier_returns", loc: [["id", "a"]] })
  })

  it.each<LoaiPhieuXuat>(["tra-ncc", "nhap", "tra-khach", "thu", "chi", "kho", "don", "hoa-don"])("%s: câu chọn có org_id (đầu công ty)", (loai) => {
    expect(CHON_MOT_PHIEU[loai].chon).toMatch(/\borg_id\b/)
  })

  it("thứ tự dòng: sort_order, rồi giờ tạo", () => {
    expect(xepDong([{ id: "b", sort_order: 1 }, { id: "a", sort_order: 0 }]).map((r) => r.id)).toEqual(["a", "b"])
    expect(xepDong([{ id: "1", created_at: "2026-10-02" }, { id: "2", created_at: "2026-10-01" }]).map((r) => r.id)).toEqual(["2", "1"])
  })

  it("không thấy phiếu / đọc lỗi → NÉM (nút báo đỏ, không ra tờ rỗng)", async () => {
    await expect(xuatMotPhieu(soGia({}).sb, "don", "khong-co")).rejects.toThrow("Không tìm thấy đơn hàng")
    await expect(xuatMotPhieu(soGia({}, { sales_orders: "hết giờ" }).sb, "don", "x")).rejects.toThrow(/hết giờ/)
    const dh = { sales_orders: [{ id: "x", order_code: "DH", status: "draft" }] }
    await expect(xuatMotPhieu(soGia(dh, { sales_order_lines: "mạng" }).sb, "don", "x")).rejects.toThrow()
    await expect(xuatMotPhieu(soGia(dh, { returns: "mạng" }).sb, "don", "x")).rejects.toThrow(/phiếu trả/)
  })
})

describe("8 trang chi tiết có nút Xuất Excel của chính phiếu", () => {
  it.each([
    ["src/app/(dashboard)/purchase-returns/[id]/page.tsx", "tra-ncc"],
    ["src/app/(dashboard)/purchasing/receipts/[id]/page.tsx", "nhap"],
    ["src/app/(dashboard)/returns/[id]/page.tsx", "tra-khach"],
    ["src/app/(dashboard)/finance/cash-receipts/[id]/page.tsx", "thu"],
    /* Chi phí không có trang riêng — xem nhanh là chi tiết. */
    ["src/app/(dashboard)/finance/expenses/page.tsx", "chi"],
    ["src/app/(dashboard)/inventory/entries/[id]/page.tsx", "kho"],
    ["src/app/(dashboard)/orders/[id]/page.tsx", "don"],
    ["src/app/(dashboard)/sales-invoices/[id]/page.tsx", "hoa-don"],
  ])("%s", (tep, loai) => {
    expect(readFileSync(tep, "utf8")).toMatch(new RegExp(`<XuatExcelPhieu loai="${loai}" id=\\{`))
  })
  it("nút chi tiết ghi tệp CÓ ĐỊNH DẠNG (như tờ in), không phải bảng dữ liệu", () => {
    expect(readFileSync("src/components/ui/xuat-excel-phieu.tsx", "utf8")).toMatch(/dinhDang: kq\.sheets/)
  })
})
