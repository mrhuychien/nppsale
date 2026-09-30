/**
 * Chủ nhà 30/09/2026: "Làm màn nhập hàng, trả hàng NCC (vẫn giữ 2 màn riêng nhé) trên di động giống
 * màn làm đơn hàng trên di động".
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
  buocSoLuong, datSoLuong, dongChuaCoGia, doiDonViDong, donViNhap, giaGoiY, heSoDonVi, soLuongTrenPhieu, tongSoLuong,
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
    expect(l[0]).toMatchObject({ unit_name: "thùng", conversion_factor: "24", quantity: "1", unit_price: "360000", vat_percent: "8" })
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

  it("tiền phiếu tính bằng đúng phép của phiếu nhập (receiptTotals)", () => {
    const l = buocSoLuong(buocSoLuong([], SUA, "thùng", 2, 1), MI, "gói", 1, 2)
    const t = receiptTotals(validReceiptLines(l), "", "")
    expect(t.subtotal).toBe(720000)
    expect(t.vat).toBeCloseTo(57600)
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
