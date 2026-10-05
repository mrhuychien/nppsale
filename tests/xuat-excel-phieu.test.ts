/**
 * Chủ nhà 05/10/2026: "Thêm phần xuất excel cho phiếu trả hàng ncc và các phiếu khác tương tự". Tệp = sheet "Phiếu"
 * + sheet "Chi tiết dòng". Bấm thật: e2e/xuat-excel-phieu.spec.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
  dungBang, ghepDong, ngayVN, tenTepXuat, tien, soLg, phanTramVat, slCoSo, donGiaTruocGiam, cotHang,
} from "@/lib/xuat-excel/phieu"
import {
  xuatTraHangNcc, xuatPhieuNhap, xuatTraHangKhach, xuatPhieuThu, xuatChiPhi, xuatPhieuKho, xuatDonHang, xuatHoaDon,
  type DongTraNcc, type PhieuTraNcc,
} from "@/lib/xuat-excel/cac-man"

/** Sheet → mảng đối tượng theo tiêu đề (như `sheet_to_json`). */
function doc(rows: (string | number)[][]): Array<Record<string, string | number>> {
  const [dau, ...than] = rows
  return than.map((r) => Object.fromEntries(dau.map((t, i) => [String(t), r[i]])))
}

const SUA = { sku: "SUA1", name: "Sữa hộp", base_unit: "hộp", units: [{ unit_name: "thùng", conversion: 24 }] }

describe("khung chung", () => {
  it("ngày theo lịch VN: cột date giữ nguyên ngày, mốc giờ đổi sang giờ VN", () => {
    expect(ngayVN("2026-10-05")).toBe("05/10/2026")
    // 18h UTC ngày 15 = 01h sáng 16/09 giờ VN.
    expect(ngayVN("2026-09-15T18:00:00Z")).toBe("16/09/2026")
    expect(ngayVN("2026-09-15T13:00:00Z")).toBe("15/09/2026")
    expect(ngayVN(null)).toBe("")
    expect(ngayVN("rác")).toBe("")
  })

  it("tên tệp theo ngày VN — 20h tối 05/10 giờ VN (13h UTC) vẫn là 05/10; 01h sáng 06/10 là 06/10", () => {
    expect(tenTepXuat("tra-hang-ncc", new Date("2026-10-05T13:00:00Z"))).toBe("tra-hang-ncc_2026-10-05.xlsx")
    expect(tenTepXuat("tra-hang-ncc", new Date("2026-10-05T18:00:00Z"))).toBe("tra-hang-ncc_2026-10-06.xlsx")
  })

  it("số là SỐ: tiền làm tròn đồng, SL giữ phần lẻ, VAT tỉ lệ → %", () => {
    expect(tien("1234.6")).toBe(1235)
    expect(tien(null)).toBe(0)
    expect(soLg("0.5")).toBe(0.5)
    expect(soLg(0.1 + 0.2)).toBe(0.3)
    expect(phanTramVat(0.08)).toBe(8)
    expect(phanTramVat("0.1")).toBe(10)
  })

  it("dungBang: tiêu đề + dòng; null/undefined thành ô trống", () => {
    expect(dungBang([{ ten: "A", lay: (r: { a?: string }) => r.a }, { ten: "B", lay: () => 2 }], [{ a: "x" }, {}])).toEqual([
      ["A", "B"], ["x", 2], ["", 2],
    ])
  })

  it("ghepDong giữ thứ tự PHIẾU của danh sách, trong phiếu theo sort_order; dòng lạc phiếu bị bỏ", () => {
    const phieu = [{ id: "p2" }, { id: "p1" }]
    const dong = [
      { id: "a", pid: "p1", sort_order: 1 }, { id: "b", pid: "p2", sort_order: 2 }, { id: "c", pid: "p2", sort_order: 0 },
      { id: "z", pid: "khac", sort_order: 0 },
    ]
    expect(ghepDong(phieu, dong, (l) => l.pid).map((x) => x.l.id)).toEqual(["c", "b", "a"])
  })

  it("SL quy đổi: ưu tiên hệ số chụp trên dòng, không có thì tra danh mục", () => {
    expect(slCoSo({ unit_name: "thùng", quantity: 2, conversion_factor: 20, product: SUA })).toBe(40)
    expect(slCoSo({ unit_name: "thùng", quantity: 2, product: SUA })).toBe(48)
    expect(slCoSo({ unit_name: "hộp", quantity: 3, product: SUA })).toBe(3)
  })

  it("đơn giá trước giảm của dòng bán: giá sau giảm + giảm / SL", () => {
    expect(donGiaTruocGiam({ quantity: 2, unit_price: 440000, line_discount: 20000 })).toBe(450000)
    expect(donGiaTruocGiam({ quantity: 2, unit_price: 450000, line_discount: 0 })).toBe(450000)
    const cot = cotHang<{ l: object }>((r) => r.l as never, { giaSauGiam: true, vat: false }).map((c) => c.ten)
    expect(cot).not.toContain("VAT %")
  })
})

describe("Trả hàng NCC", () => {
  const phieu: PhieuTraNcc[] = [{
    id: "r1", return_code: "TRN-1", return_date: "2026-10-03", warehouse_zone: "sale", status: "completed",
    subtotal: 900000, vat: 90000, discount: 10000, total: 980000, reason: "Hàng lỗi", notes: "gấp",
    created_by: "u1", supplier: { name: "Vinamilk", code: "NCC1" },
  }, {
    id: "r2", return_code: null, return_date: "2026-10-04", warehouse_zone: "date", status: "draft",
    total: 0, supplier: { name: "Vinamilk", code: "NCC1" },
  }]
  const dong: DongTraNcc[] = [
    { id: "l2", return_id: "r1", sort_order: 1, unit_name: "hộp", quantity: 12, unit_price: 20000, line_discount: 0, vat_rate: 0.1, line_total: 264000, product: SUA },
    { id: "l1", return_id: "r1", sort_order: 0, unit_name: "thùng", quantity: 2, unit_price: 300000, line_discount: 30000, vat_rate: 0.1, conversion_factor: 24, line_total: 627000, notes: "móp", product: SUA },
  ]
  const [ph, ct] = xuatTraHangNcc(phieu, dong, new Map([["u1", "Kế toán Lan"]]))

  it("sheet Phiếu: một dòng một phiếu, số là số, ngày VN, nhãn trạng thái / kho", () => {
    expect(ph.ten).toBe("Phiếu")
    const r = doc(ph.rows)
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({
      "Mã phiếu": "TRN-1", Ngày: "03/10/2026", "Mã NCC": "NCC1", "Nhà cung cấp": "Vinamilk", "Kho xuất": "Kho hàng bán",
      "Trạng thái": "Đã gửi", "Tiền hàng (chưa VAT)": 900000, VAT: 90000, "Giảm giá": 10000, "Tổng tiền": 980000,
      "Lý do": "Hàng lỗi", "Ghi chú": "gấp", "Người lập": "Kế toán Lan",
    })
    expect(r[1]).toMatchObject({ "Mã phiếu": "chưa sinh mã", "Trạng thái": "Nháp", "Kho xuất": "Kho hàng date", "Người lập": "" })
  })

  it("sheet Chi tiết dòng: theo thứ tự dòng trên phiếu, SL quy đổi về đơn vị cơ sở, VAT %", () => {
    expect(ct.ten).toBe("Chi tiết dòng")
    const r = doc(ct.rows)
    expect(r.map((x) => x.ĐVT)).toEqual(["thùng", "hộp"])
    expect(r[0]).toMatchObject({
      "Mã phiếu": "TRN-1", "Nhà cung cấp": "Vinamilk", "Mã hàng": "SUA1", "Tên hàng": "Sữa hộp", SL: 2, "SL quy đổi": 48,
      "ĐV cơ sở": "hộp", "Đơn giá": 300000, "Giảm giá dòng": 30000, "VAT %": 10, "Thành tiền": 627000, "Ghi chú dòng": "móp",
    })
  })
})

it("Phiếu nhập: VAT gõ tay thắng VAT máy cộng; dòng nhập có số HĐ NCC", () => {
  const [ph, ct] = xuatPhieuNhap(
    [{ id: "p1", receipt_code: "PN-1", invoice_number: "HD9", invoice_date: "2026-09-20", status: "completed", warehouse_zone: "sale", subtotal: 100, vat: 10, vat_override: 8, discount: 0, total: 108, supplier: { name: "Vinamilk" } }],
    [{ invoice_id: "p1", unit_name: "hộp", quantity: 5, unit_price: 20, line_total: 108, product: SUA }],
    new Map()
  )
  expect(doc(ph.rows)[0]).toMatchObject({ "Mã phiếu": "PN-1", "Số HĐ NCC": "HD9", VAT: 8, "Cần trả NCC": 108, "Trạng thái": "Hoàn thành" })
  expect(doc(ct.rows)[0]).toMatchObject({ "Mã phiếu": "PN-1", "Số HĐ NCC": "HD9", SL: 5 })
})

it("Trả hàng khách: tiền phiếu = credit_note_amount; dòng HÀNG ĐỔI không tính tiền", () => {
  const [ph, ct] = xuatTraHangKhach(
    [{ id: "t1", created_at: "2026-09-01T03:00:00Z", return_date: "2026-09-02", reason: "damaged", status: "submitted", credit_note_amount: 40000, credit_with_invoice: true, customer: { store_name: "Cô Ba" }, invoice: { invoice_code: "HD-1" } }],
    [
      { return_id: "t1", unit_name: "hộp", quantity: 2, unit_price: 20000, line_total: 40000, is_exchange: false, product: SUA },
      { return_id: "t1", unit_name: "hộp", quantity: 1, unit_price: 20000, line_total: 20000, is_exchange: true, product: SUA },
    ],
    new Map([["t1", "TH-0007"]])
  )
  expect(doc(ph.rows)[0]).toMatchObject({
    "Số phiếu": "TH-0007", Ngày: "02/09/2026", "Loại phiếu": "Theo hóa đơn (tự sinh)", "Lý do": "Hàng hư hỏng",
    "Trạng thái": "Chờ xử lý", "Tiền trả (trừ nợ)": 40000, "Hóa đơn gốc": "HD-1",
  })
  const r = doc(ct.rows)
  expect(r.map((x) => [x["Loại dòng"], x["Tiền tính nợ"]])).toEqual([["Hàng trả", 40000], ["Hàng đổi", 0]])
  expect(r.reduce((s, x) => s + Number(x["Tiền tính nợ"]), 0)).toBe(40000)
})

it("Phiếu thu: mỗi dòng nói thu cho hóa đơn / nợ đầu kỳ nào; sheet phiếu gộp khách + hóa đơn", () => {
  const [ph, ct] = xuatPhieuThu(
    [{ id: "c1", receipt_code: "PT-1", receipt_date: "2026-09-30", status: "received", source_type: "standalone", expected_amount: 500000, submitted_amount: 450000, notes: null, collector: { full_name: "NV A" } }],
    [
      { receipt_id: "c1", amount: 300000, invoice: { id: "h1", invoice_code: "HD-1", invoice_date: "2026-09-20", customer: { store_name: "Cô Ba" } }, receivable: { customer: { store_name: "Cô Ba" } } },
      { receipt_id: "c1", amount: 200000, receivable: { opening_balance: true, customer: { store_name: "Cô Ba" } } },
    ]
  )
  expect(doc(ph.rows)[0]).toMatchObject({
    "Số phiếu": "PT-1", "Trạng thái": "Đã nhận", "Khách hàng": "Cô Ba", "Hóa đơn": "HD-1", "Số tiền": 500000,
    "Đã nộp": 450000, "Chênh lệch nộp": -50000, Nguồn: "Phiếu độc lập", "Người thu": "NV A",
  })
  expect(doc(ct.rows).map((x) => [x["Khoản thu"], x["Hóa đơn"], x["Ngày hóa đơn"], x["Số tiền"]])).toEqual([
    ["Hóa đơn", "HD-1", "20/09/2026", 300000], ["Nợ đầu kỳ", "", "", 200000],
  ])
})

it("Chi phí: MỘT sheet, không có sheet dòng", () => {
  const s = xuatChiPhi(
    [{ id: "e1", expense_date: "2026-09-05", amount: 150000, description: "Xăng", reference_code: "CP-1", source_type: null, is_paid: false, payment_method: "cash", created_by: "u1", category: { name: "Xăng xe", bucket: "operating" } }],
    new Map([["u1", "Chủ NPP"]])
  )
  expect(s.map((x) => x.ten)).toEqual(["Phiếu"])
  expect(doc(s[0].rows)[0]).toMatchObject({ Ngày: "05/09/2026", "Danh mục": "Xăng xe", Nhóm: "Vận hành", "Số tiền": 150000, "Trạng thái": "Chưa trả", "Hình thức": "Tiền mặt", "Người lập": "Chủ NPP" })
})

describe("Phiếu kho", () => {
  const phieu = [{ id: "s1", entry_code: "PK-1", type: "import", status: "posted", notes: null, created_at: "2026-09-29T20:00:00Z", warehouse_zone: "sale" }]
  const dong = [
    { entry_id: "s1", unit_name: "thùng", quantity: 2, qty_in_base_uom: 48, unit_cost: 15000, product: SUA, batch: { batch_code: "L1", expires_at: "2027-12-31" } },
    /* Phiếu cũ chưa có `qty_in_base_uom` → quy đổi bằng hệ số chụp. */
    { entry_id: "s1", unit_name: "thùng", quantity: 1, conversion_factor_snapshot: 24, unit_cost: 15000, product: SUA },
  ]
  it("SL quy đổi lấy số kho ghi sổ; giá trị = SL cơ sở × giá vốn mỗi đơn vị cơ sở", () => {
    const [ph, ct] = xuatPhieuKho(phieu, dong, true)
    expect(doc(ph.rows)[0]).toMatchObject({ "Mã phiếu": "PK-1", "Ngày tạo": "30/09/2026", Loại: "Nhập kho", "Trạng thái": "Đã duyệt" })
    expect(doc(ct.rows).map((x) => [x["SL quy đổi"], x["Giá trị"], x["Số lô"], x["Hạn dùng"]])).toEqual([
      [48, 720000, "L1", "31/12/2027"], [24, 360000, "", ""],
    ])
  })
  it("không xem được giá vốn → không có cột giá vốn", () => {
    const [, ct] = xuatPhieuKho(phieu, dong, false)
    expect(ct.rows[0]).not.toContain("Giá vốn / ĐV cơ sở")
    expect(ct.rows[0]).not.toContain("Giá trị")
  })
})

it("Đơn hàng: dòng in đơn giá TRƯỚC giảm để Đơn giá × SL − Giảm = Thành tiền", () => {
  const [ph, ct] = xuatDonHang(
    [{ id: "o1", order_code: "DH-1", order_date: "2026-09-30", status: "partially_invoiced", total: 880000, customer: { store_name: "Cô Ba" } }],
    [{ order_id: "o1", unit_name: "thùng", quantity: 2, unit_price: 440000, line_discount: 20000, line_total: 880000, conversion_factor: 24, product: SUA }]
  )
  expect(doc(ph.rows)[0]).toMatchObject({ "Mã đơn": "DH-1", "Trạng thái": "Hoàn thành", "Tổng tiền": 880000 })
  const d = doc(ct.rows)[0]
  expect(d).toMatchObject({ "Đơn giá": 450000, "Giảm giá dòng": 20000, "Thành tiền": 880000, "SL quy đổi": 48 })
  expect(Number(d["Đơn giá"]) * Number(d.SL) - Number(d["Giảm giá dòng"])).toBe(d["Thành tiền"])
})

it("Hóa đơn bán: TIỀN LÀ SỐ CÒN LẠI sau hàng trả (CLAUDE.md, mig 192); giảm giá cả đơn suy từ dòng", () => {
  const [ph, ct] = xuatHoaDon(
    [
      { id: "h1", invoice_code: "HD-1", invoice_date: "2026-09-23", status: "posted", subtotal: 880000, vat: 0, total: 880000, customer: { store_name: "Cô Ba" }, order: { order_code: "DH-2" } },
      { id: "h2", invoice_code: "HD-2", invoice_date: "2026-09-22", status: "posted", subtotal: 300000, vat: 0, total: 300000, replaced_from: "hx" },
    ],
    [
      { invoice_id: "h1", unit_name: "thùng", quantity: 2, unit_price: 450000, line_discount: 0, line_total: 900000, conversion_factor: 24, product: SUA },
      { invoice_id: "h1", unit_name: "hộp", quantity: 1, unit_price: 0, line_total: 0, is_exchange: true, product: SUA },
    ],
    new Map([["h1", 230000]])
  )
  const r = doc(ph.rows)
  expect(r[0]).toMatchObject({ "Mã hóa đơn": "HD-1", "Mã đơn": "DH-2", "Giảm giá": 20000, "Tổng hóa đơn": 880000, "Hàng trả": 230000, "Tổng tiền (còn lại)": 650000 })
  expect(r[1]).toMatchObject({ "Trạng thái": "Lập lại", "Hàng trả": 0, "Tổng tiền (còn lại)": 300000 })
  expect(doc(ct.rows).map((x) => x["Loại dòng"])).toEqual(["Bán", "Hàng đổi"])
})

/** Mọi màn danh sách chứng từ có nút; màn lọc ở máy chủ xuất bằng ĐÚNG bộ lọc của danh sách. */
describe("mọi danh sách chứng từ có nút Xuất Excel", () => {
  const MAN: Array<[string, string, RegExp | null]> = [
    ["src/app/(dashboard)/purchase-returns/page.tsx", "tra-hang-ncc", null],
    ["src/app/(dashboard)/purchasing/receipts/page.tsx", "phieu-nhap-hang", null],
    ["src/app/(dashboard)/returns/page.tsx", "tra-hang", /apDungLoc\(/],
    ["src/app/(dashboard)/finance/cash-receipts/page.tsx", "phieu-thu", /applyFilters\(q as never\)[\s\S]*locTrangThai|locTrangThai\(q, status\)[\s\S]*applyFilters/],
    ["src/app/(dashboard)/finance/expenses/page.tsx", "chi-phi", null],
    ["src/app/(dashboard)/inventory/entries/page.tsx", "phieu-kho", null],
    ["src/app/(dashboard)/orders/page.tsx", "don-hang", /applyStatusFilter\(\s*applyCommonFilters\(/],
    ["src/app/(dashboard)/sales-invoices/page.tsx", "hoa-don-ban", /locTrangThai\(q, status\)[\s\S]*applyFilters\(q as never\)/],
  ]
  for (const [tep, tien, loc] of MAN) {
    it(tep, () => {
      const src = readFileSync(tep, "utf8")
      expect(src).toMatch(new RegExp(`<XuatExcelButton[^>]*tenTep="${tien}"[^>]*chuanBi=\\{xuatExcel\\}`))
      const than = src.slice(src.indexOf("const xuatExcel = async"))
      const ham = than.slice(0, than.indexOf("\n  }\n"))
      expect(ham.length).toBeGreaterThan(0)
      // Màn tải hết rồi lọc tại chỗ: xuất đúng danh sách đã lọc + xếp (`daXep`), không phải `trang`.
      if (!loc) expect(ham).toMatch(/daXep/)
      else {
        expect(ham).toMatch(loc)
        expect(ham).toMatch(/fetchAllForAggregate/)
      }
      expect(ham).not.toMatch(/\btrang\b/)
    })
  }
})
