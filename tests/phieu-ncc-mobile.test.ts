/**
 * Chủ nhà 30/09/2026: "Làm màn nhập hàng, trả hàng NCC (vẫn giữ 2 màn riêng nhé) trên di động giống
 * màn làm đơn hàng trên di động".
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
  buocSoLuong, datSoLuong, dongChuaCoGia, doiDonViDong, donViNhap, giaGoiY, heSoDonVi, MUC_VAT, soLuongTrenPhieu, tongPhieuNcc,
  tongSoLuong, vatMacDinh,
} from "@/lib/purchasing/phieu-mobile"
import { receiptTotals, validReceiptLines, type ReceiptProduct } from "@/lib/purchasing/receipt-form"
import { hidesMobileAppBar, showsBottomNav } from "@/lib/nav/mobile-chrome"
import { khoaChonNhieu } from "@/lib/sell/pick-mode"

const SUA = {
  id: "sua", name: "Sữa hộp", sku: "SUA1", base_unit: "hộp", cost_price: 15000, vat_rate: 0.08,
  units: [{ id: "u1", product_id: "sua", unit_name: "thùng", conversion: 24 }],
} as unknown as ReceiptProduct
const MI = { id: "mi", name: "Mì", sku: "MI1", base_unit: "gói", cost_price: 0, vat_rate: 0, units: [] } as unknown as ReceiptProduct

describe("giỏ phiếu NCC — như thẻ hàng của /sell", () => {
  it("đơn vị: cơ sở trước, hệ số và giá gợi ý theo ĐÚNG đơn vị", () => {
    expect(donViNhap(SUA)).toEqual(["hộp", "thùng"])
    expect(heSoDonVi(SUA, "thùng")).toBe(24)
    expect(giaGoiY(SUA, "hộp")).toBe(15000)
    expect(giaGoiY(SUA, "thùng")).toBe(360000)
    expect(giaGoiY(MI, "gói"), "chưa có giá vốn").toBe(0)
  })

  it("chạm thẻ = +1; lần nữa cộng dồn cùng dòng; khác đơn vị là dòng khác; về 0 là bỏ", () => {
    let l = buocSoLuong([], SUA, "thùng", 1, 1)
    expect(l).toHaveLength(1)
    expect(l[0]).toMatchObject({ unit_name: "thùng", conversion_factor: "24", quantity: "1", unit_price: "360000", vat_percent: "0" })
    l = buocSoLuong(l, SUA, "thùng", 1, 2)
    expect(l).toHaveLength(1)
    expect(soLuongTrenPhieu(l, "sua", "thùng")).toBe(2)
    l = buocSoLuong(l, SUA, "hộp", 1, 3)
    expect(l).toHaveLength(2)
    expect(tongSoLuong(l)).toBe(3)
    l = buocSoLuong(l, SUA, "hộp", -1, 4)
    expect(l).toHaveLength(1)
    expect(buocSoLuong([], SUA, "hộp", -1, 5), "bớt khi chưa có").toEqual([])
    expect(datSoLuong(l, 0, 0), "đặt 0 là bỏ").toEqual([])
    expect(datSoLuong(l, 0, 7)[0].quantity).toBe("7")
  })

  it("tiền phiếu: dòng không mang VAT (VAT ở cả phiếu)", () => {
    const l = buocSoLuong(buocSoLuong([], SUA, "thùng", 2, 1), MI, "gói", 1, 2)
    const t = receiptTotals(validReceiptLines(l), "", "")
    expect(t.subtotal).toBe(720000)
    expect(t.vat, "bỏ VAT từng dòng").toBe(0)
    expect(dongChuaCoGia(l), "dòng Mì chưa có giá").toBe(1)
  })

  it("đổi đơn vị: giá gợi ý đổi theo, giá gõ tay giữ nguyên; trùng dòng thì gộp", () => {
    let l = buocSoLuong([], SUA, "hộp", 3, 1)
    l = doiDonViDong(l, 0, SUA, "thùng")
    expect(l[0]).toMatchObject({ unit_name: "thùng", conversion_factor: "24", unit_price: "360000", quantity: "3" })
    l = [{ ...l[0], unit_price: "350000" }]
    l = doiDonViDong(l, 0, SUA, "hộp")
    expect(l[0].unit_price, "giá theo HĐ NCC không bị đổi âm thầm").toBe("350000")
    const hai = buocSoLuong(buocSoLuong([], SUA, "hộp", 2, 1), SUA, "thùng", 1, 2)
    const gop = doiDonViDong(hai, 0, SUA, "thùng")
    expect(gop).toHaveLength(1)
    expect(gop[0]).toMatchObject({ unit_name: "thùng", quantity: "3" })
  })
})

describe("hai màn riêng, cùng khung di động", () => {
  const NHAP = readFileSync("src/app/(dashboard)/purchasing/receipts/new/page.tsx", "utf8")
  const TRA = readFileSync("src/app/(dashboard)/purchase-returns/new/page.tsx", "utf8")
  it("mỗi màn dùng khung với đúng loại phiếu, vẫn ghi phiếu của nó", () => {
    expect(NHAP).toContain('kind="nhap"')
    expect(NHAP).toContain('supabase.rpc("complete_purchase_invoice"')
    expect(TRA).toContain('kind="tra"')
    expect(TRA).toContain('supabase.rpc("complete_supplier_return"')
    for (const s of [NHAP, TRA]) expect(s).toContain("<PhieuNccMobile")
  })
  it("không có thanh tiêu đề chung / nav dưới chồng lên thanh đáy riêng", () => {
    for (const r of ["/purchasing/receipts/new", "/purchase-returns/new"]) {
      expect(hidesMobileAppBar(r), r).toBe(true)
      expect(showsBottomNav(r), r).toBe(false)
    }
  })
})

describe("chọn từng mã mặc định, chọn nhiều là tuỳ chọn (chủ nhà 30/09/2026)", () => {
  const KHUNG = readFileSync("src/components/purchasing/phieu-ncc-mobile.tsx", "utf8")
  it("nhớ riêng cho nhập / trả NCC, không lẫn với bán / trả khách", () => {
    const k = new Set((["ban", "tra", "nhap", "tra-ncc"] as const).map((l) => khoaChonNhieu(l)))
    expect(k.size).toBe(4)
    expect(khoaChonNhieu("tra")).toBe("npp.sell.chon-nhieu.tra")
  })
  it("mặc định tắt, chỉ đổi khi bấm; thêm mã mới ở chế độ từng mã thì sang phiếu", () => {
    expect(KHUNG).toContain("const [chonNhieu, setChonNhieu] = useState(false)")
    expect(KHUNG).toContain("if (roiManSauKhiThem({ chonNhieu, delta: d, dongMoi })) moPhieu()")
    expect(KHUNG.match(/setChonNhieu\(/g), "chỉ đọc bộ nhớ lúc mở + nút bấm").toHaveLength(2)
  })
})

describe("giảm giá phiếu TRƯỚC thuế, VAT một mức cho cả phiếu (chủ nhà 30/09/2026)", () => {
  const l = buocSoLuong([], SUA, "thùng", 1, 1) // 360.000
  it("giảm theo đ: thuế tính trên phần còn lại", () => {
    expect(tongPhieuNcc(l, { value: "60000", mode: "amount" }, 10)).toEqual({ subtotal: 360000, discount: 60000, base: 300000, vat: 30000, total: 330000 })
  })
  it("giảm theo %: % của tiền hàng, rồi mới tính thuế", () => {
    expect(tongPhieuNcc(l, { value: "10", mode: "percent" }, 8)).toEqual({ subtotal: 360000, discount: 36000, base: 324000, vat: 25920, total: 349920 })
  })
  it("kẹp: giảm quá tiền hàng / quá 100% / âm / rác", () => {
    expect(tongPhieuNcc(l, { value: "999999", mode: "amount" }, 10).total).toBe(0)
    expect(tongPhieuNcc(l, { value: "150", mode: "percent" }, 10).discount).toBe(360000)
    expect(tongPhieuNcc(l, { value: "-5", mode: "amount" }, 0).discount).toBe(0)
    expect(tongPhieuNcc(l, { value: "abc", mode: "percent" }, 0).total).toBe(360000)
  })
  it("máy chủ cộng subtotal + vat_override − discount ra ĐÚNG tổng này", () => {
    const t = tongPhieuNcc(l, { value: "10", mode: "percent" }, 10)
    const may = receiptTotals(validReceiptLines(l), String(t.discount), String(t.vat))
    expect(may.total).toBe(t.total)
  })
  it("mức VAT 0/5/8/10; mặc định theo thuế suất mặt hàng đầu tiên", () => {
    expect([...MUC_VAT]).toEqual([0, 5, 8, 10])
    const byId = new Map([["sua", SUA], ["mi", MI]])
    expect(vatMacDinh(l, byId)).toBe(8)
    expect(vatMacDinh([], byId)).toBe(0)
  })
  it("sheet sửa dòng không còn ô VAT; phiếu có nhóm nút VAT + giảm giá đ/%", () => {
    const K = readFileSync("src/components/purchasing/phieu-ncc-mobile.tsx", "utf8")
    expect(K).not.toContain("sua-dong-vat")
    expect(K).not.toContain("phieu-ncc-vat")
    expect(K).toContain('aria-label="VAT cả phiếu"')
    expect(K).toContain('aria-label="Giảm giá phiếu theo"')
  })
})

import { chamTheHang } from "@/lib/sell/pick-mode"

describe("chạm thẻ hàng — chủ nhà 30/09/2026: đổi quy cách bấm 1 cái phải vào đơn", () => {
  it("chọn từng mã: chạm thẻ / quy cách là sang phiếu; chưa có thì thêm 1, có rồi không cộng", () => {
    expect(chamTheHang({ chonNhieu: false, daCo: false })).toEqual({ them: true, sangPhieu: true })
    expect(chamTheHang({ chonNhieu: false, daCo: false, laQuyCach: true })).toEqual({ them: true, sangPhieu: true })
    expect(chamTheHang({ chonNhieu: false, daCo: true })).toEqual({ them: false, sangPhieu: true })
  })
  it("chọn nhiều: chạm thẻ +1 ở lại; chạm quy cách chỉ đổi quy cách", () => {
    expect(chamTheHang({ chonNhieu: true, daCo: true })).toEqual({ them: true, sangPhieu: false })
    expect(chamTheHang({ chonNhieu: true, daCo: false, laQuyCach: true })).toEqual({ them: false, sangPhieu: false })
  })
  it("thẻ: −/+ chỉ khi chọn nhiều", () => {
    const S = readFileSync("src/components/purchasing/phieu-ncc-mobile.tsx", "utf8")
    expect(S).toContain("{co && chonNhieu && (")
    expect(S).toContain("cham(p, u, true)")
  })
})
