/**
 * Chủ nhà 10/11/2026: "em thêm cho a mã QR thanh toán số tiền trên hóa đơn, nội dung Thanh toán đến tài khoản. mã để cạnh
 * khu vực ký (song song)".
 * - Chuỗi VietQR (NAPAS / EMVCo) dựng tại chỗ: đáp án tính ĐỘC LẬP bằng Python (`binascii.crc_hqx`, cùng bố cục trường như gói
 *   `vietnam-qr-pay`) — không chép lại từ chính hàm đang thử.
 * - Mã QR vẽ ra (ma trận → SVG) giải ngược bằng ZXing (đóng kèm html5-qrcode, như bộ quét của app) phải ra ĐÚNG chuỗi ấy.
 * - Tờ in hoá đơn: mã đúng số CÒN PHẢI THU, song song ba ô ký; không có mã khi không có tài khoản / không còn phải thu.
 * Bấm thật: e2e/qr-thanh-toan-hoa-don.spec.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import {
  chuanSoTaiKhoan, chuoiVietQr, crc16Ccitt, loiTaiKhoanNhan, NGAN_HANG_VIETQR, nganHangTheoBin, NOI_DUNG_QR_HOA_DON,
  noiDungChuyenKhoan, taiKhoanNhanTu,
} from "@/lib/thanh-toan/vietqr"
import { duongQr, LE_QR, maTranQr } from "@/components/printing/qr-svg"
import { SalesInvoice, type SalesInvoiceProps } from "@/components/printing/sales-invoice"
import { orgHeaderFrom } from "@/lib/org/header"
import { cauLuuYMacDinh, luuYTrenTo } from "@/lib/printing/luu-y-in"

/* Đáp án tính bằng Python (xem khối đầu tệp). */
const TCB_900K =
  "00020101021238530010A0000007270123000697040701096668886960208QRIBFTTA530370454069000005802VN62280824Thanh toan den tai khoan63047A23"
const TCB_700K =
  "00020101021238530010A0000007270123000697040701096668886960208QRIBFTTA530370454067000005802VN62280824Thanh toan den tai khoan630403C8"
const TCB_TINH = "00020101021138530010A0000007270123000697040701096668886960208QRIBFTTA53037045802VN63047963"
const VCB_1250K =
  "00020101021238540010A00000072701240006970436011001234567890208QRIBFTTA5303704540712500005802VN62280824Thanh toan den tai khoan6304ED43"
const TCB = { bin: "970407", soTaiKhoan: "666888696" }

/** Tách chuỗi EMVCo thành [mã trường, giá trị]. */
function tachTruong(s: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (let i = 0; i < s.length; ) {
    const id = s.slice(i, i + 2)
    const n = Number(s.slice(i + 2, i + 4))
    out.push([id, s.slice(i + 4, i + 4 + n)])
    i += 4 + n
  }
  return out
}

describe("chuỗi VietQR", () => {
  it("CRC-16/CCITT-FALSE: giá trị kiểm chuẩn", () => {
    expect(crc16Ccitt("123456789")).toBe("29B1")
  })
  it("đúng từng ký tự với đáp án độc lập (có số tiền / không số tiền / ngân hàng khác)", () => {
    expect(chuoiVietQr({ ...TCB, soTien: 900000, noiDung: NOI_DUNG_QR_HOA_DON })).toBe(TCB_900K)
    expect(chuoiVietQr({ ...TCB, soTien: 699999.6, noiDung: "Thanh toán đến tài khoản" })).toBe(TCB_700K)
    expect(chuoiVietQr(TCB)).toBe(TCB_TINH)
    expect(chuoiVietQr({ bin: "970436", soTaiKhoan: "0123 456 789", soTien: 1_250_000, noiDung: NOI_DUNG_QR_HOA_DON })).toBe(VCB_1250K)
  })
  it("bố cục trường: NAPAS A000000727 · BIN · số TK · QRIBFTTA · VND · số tiền · VN · nội dung · CRC cuối", () => {
    const t = tachTruong(TCB_900K)
    expect(t.map(([id]) => id)).toEqual(["00", "01", "38", "53", "54", "58", "62", "63"])
    expect(Object.fromEntries(t)).toMatchObject({ "00": "01", "01": "12", "53": "704", "54": "900000", "58": "VN" })
    expect(tachTruong(t[2][1])).toEqual([["00", "A000000727"], ["01", "0006970407" + "0109666888696"], ["02", "QRIBFTTA"]])
    expect(tachTruong(t[6][1])).toEqual([["08", "Thanh toan den tai khoan"]])
    expect(NOI_DUNG_QR_HOA_DON).toBe("Thanh toan den tai khoan")
  })
  it("tài khoản / số tiền sai → không dựng mã (không in mã sai)", () => {
    for (const bad of [
      { bin: "97040", soTaiKhoan: "666888696" },
      { bin: "97040A", soTaiKhoan: "666888696" },
      { bin: "970407", soTaiKhoan: "" },
      { bin: "970407", soTaiKhoan: "66688869É" },
      { bin: "970407", soTaiKhoan: "1".repeat(20) },
    ]) expect(chuoiVietQr(bad), JSON.stringify(bad)).toBeNull()
    for (const soTien of [0, -5, Number.NaN, 1e14]) expect(chuoiVietQr({ ...TCB, soTien }), String(soTien)).toBeNull()
  })
  it("nội dung bỏ dấu, chỉ chữ / số / khoảng trắng / gạch nối, tối đa 25 ký tự", () => {
    expect(noiDungChuyenKhoan("Thanh toán đến tài khoản")).toBe("Thanh toan den tai khoan")
    expect(noiDungChuyenKhoan("  Đơn  HĐ-001!! ")).toBe("Don HD-001")
    expect(noiDungChuyenKhoan("x".repeat(40))).toHaveLength(25)
    expect(noiDungChuyenKhoan(null)).toBe("")
  })
  it("số tài khoản: bỏ khoảng trắng / chấm / gạch người dùng gõ; tài khoản nhận tiền cần đủ BIN 6 số + số TK", () => {
    expect(chuanSoTaiKhoan(" 0123.456-789 ")).toBe("0123456789")
    expect(chuanSoTaiKhoan("")).toBeNull()
    expect(taiKhoanNhanTu("970407", "666 888 696")).toEqual(TCB)
    expect(taiKhoanNhanTu("", "666888696")).toBeNull()
    expect(taiKhoanNhanTu("970407", null)).toBeNull()
  })
  it("lưu cài đặt: đủ cả hai hoặc trống cả hai", () => {
    expect(loiTaiKhoanNhan("", "")).toBeNull()
    expect(loiTaiKhoanNhan("970407", "666888696")).toBeNull()
    expect(loiTaiKhoanNhan("", "666888696")).toMatch(/Chọn ngân hàng/)
    expect(loiTaiKhoanNhan("970407", " ")).toMatch(/Nhập số tài khoản/)
    expect(loiTaiKhoanNhan("970407", "12-ab$")).toMatch(/chữ số/)
  })
})

describe("danh sách ngân hàng (BIN của NAPAS)", () => {
  it("BIN 6 số, không trùng; các ngân hàng lớn đúng BIN (đối chiếu danh sách của gói vietnam-qr-pay)", () => {
    const bins = NGAN_HANG_VIETQR.map((b) => b.bin)
    expect(bins.every((b) => /^\d{6}$/.test(b))).toBe(true)
    expect(new Set(bins).size).toBe(bins.length)
    for (const [ten, bin] of [
      ["Techcombank", "970407"], ["Vietcombank", "970436"], ["BIDV", "970418"], ["VietinBank", "970415"],
      ["Agribank", "970405"], ["MB Bank", "970422"], ["ACB", "970416"], ["VPBank", "970432"], ["Sacombank", "970403"],
      ["TPBank", "970423"], ["VIB", "970441"], ["SHB", "970443"], ["HDBank", "970437"], ["Eximbank", "970431"],
    ]) expect(nganHangTheoBin(bin)?.ten, ten).toBe(ten)
  })
})

/* ------------------------------------------------------------------ Giải ngược mã QR bằng ZXing */

const require = createRequire(import.meta.url)
type Zx = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const zx = require(require.resolve("html5-qrcode/third_party/zxing-js.umd.js")) as Zx

/** Ảnh xám từ một hàm "ô (hàng, cột) đen?" — `k` điểm ảnh mỗi mô-đun, thêm lề trắng 4 mô-đun (chuẩn QR). */
function anhTu(n: number, den: (h: number, c: number) => boolean, k = 4): { Y: Uint8ClampedArray; w: number } {
  const le = 4
  const w = (n + 2 * le) * k
  const Y = new Uint8ClampedArray(w * w).fill(255)
  for (let h = 0; h < n; h++) for (let c = 0; c < n; c++) {
    if (!den(h, c)) continue
    for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) Y[((h + le) * k + y) * w + (c + le) * k + x] = 0
  }
  return { Y, w }
}
function giaiQr(n: number, den: (h: number, c: number) => boolean): string | null {
  const { Y, w } = anhTu(n, den)
  const hints = new Map<number, unknown>([[zx.DecodeHintType.POSSIBLE_FORMATS, [zx.BarcodeFormat.QR_CODE]]])
  try {
    const anh = new zx.BinaryBitmap(new zx.HybridBinarizer(new zx.RGBLuminanceSource(Y, w, w)))
    return new zx.MultiFormatReader(false, hints).decodeWithState(anh).getText()
  } catch {
    return null
  }
}
/** Đường vẽ SVG → lại thành lưới ô đen (kiểm chính chữ `d` mà trình duyệt sẽ vẽ). */
function luoiTuDuong(d: string, rong: number): (h: number, c: number) => boolean {
  const o = new Set<string>()
  for (const m of Array.from(d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g))) {
    const [x, y, dai] = [Number(m[1]), Number(m[2]), Number(m[3])]
    for (let i = 0; i < dai; i++) o.add(`${y},${x + i}`)
  }
  return (h, c) => h >= 0 && c >= 0 && h < rong && c < rong && o.has(`${h},${c}`)
}

describe("mã QR vẽ ra quét được và ra đúng chuỗi", () => {
  it("ma trận (QRCode.create, mức sửa lỗi M) giải ngược bằng ZXing ra đúng chuỗi VietQR", () => {
    for (const s of [TCB_900K, TCB_TINH, VCB_1250K]) {
      const m = maTranQr(s)!
      expect(giaiQr(m.n, m.den), s).toBe(s)
    }
  })
  it("đường vẽ SVG (gộp ô liền nhau) vẽ lại đúng từng mô-đun — giải ngược vẫn ra đúng chuỗi", () => {
    const m = maTranQr(TCB_900K)!
    const rong = m.n + 2 * LE_QR
    const o = luoiTuDuong(duongQr(m, LE_QR), rong)
    for (let h = 0; h < m.n; h++) for (let c = 0; c < m.n; c++) expect(o(h + LE_QR, c + LE_QR)).toBe(m.den(h, c))
    expect(giaiQr(rong, o)).toBe(TCB_900K)
  })
  /* `qrcode` tự chia đoạn số / chữ / byte: chuỗi 132 ký tự ở mức M là phiên bản 6 (41 × 41); mức L phiên bản 5 (37 × 37) —
     mô-đun to hơn nhưng chỉ chịu ~7% hỏng (giấy nhàu, mực nhạt) thay vì ~15%. */
  it("mức sửa lỗi M (phiên bản 6, 41 × 41 mô-đun cho chuỗi của hoá đơn)", () => {
    expect(TCB_900K).toHaveLength(132)
    expect(maTranQr(TCB_900K)!.n).toBe(41)
  })
  it("chuỗi rỗng → không có mã", () => {
    expect(maTranQr("")).toBeNull()
  })
})

/* ------------------------------------------------------------------ Tờ in hoá đơn */

const LINE = { id: "1", name: "Sữa", spec: "SUA1", unitName: "thùng", quantity: 2, unitPrice: 450000, discount: 0, lineTotal: 900000 }
const veTo = (p: Partial<SalesInvoiceProps>) =>
  renderToStaticMarkup(createElement(SalesInvoice, {
    org: { name: "NPP Thử" }, invoiceNumber: "HD-1", issuedAt: new Date("2026-11-10T12:00:00+07:00"), issuedHasTime: false,
    customerName: "Cô Ba", lines: [LINE], total: 900000, ...p,
  }))
const vietqrTrong = (html: string) => /data-vietqr="([^"]*)"/.exec(html)?.[1] ?? null

describe("tờ in hoá đơn: mã QR song song ba ô ký", () => {
  it("có tài khoản → mã đúng số CÒN PHẢI THU, đứng cột đầu của hàng ô ký; SVG trong trang giải ra đúng chuỗi", () => {
    const html = veTo({ paymentQr: TCB, returnCredit: 200000 })
    expect(vietqrTrong(html)).toBe(TCB_700K)
    const qr = html.indexOf('data-testid="qr-thanh-toan"')
    const hang = html.lastIndexOf("grid-cols-[auto_1fr_1fr_1fr]", qr)
    expect(hang, "mã nằm trong hàng ô ký").toBeGreaterThan(html.indexOf("</table>"))
    expect(qr).toBeLessThan(html.indexOf("Người nhận hàng"))
    expect(html.slice(qr, html.indexOf("Người nhận hàng"))).toContain("Quét mã thanh toán")
    const d = /<path d="([^"]+)"/.exec(html.slice(qr))![1]
    const n = Number(/viewBox="0 0 (\d+) \1"/.exec(html.slice(qr))![1])
    expect(giaiQr(n, luoiTuDuong(d, n))).toBe(TCB_700K)
  })
  it("không tài khoản / không còn phải thu → không có mã, ba ô ký như cũ", () => {
    for (const p of [{}, { paymentQr: null }, { paymentQr: TCB, returnCredit: 900000 }, { paymentQr: TCB, returnCredit: 1_200_000 }]) {
      const html = veTo(p)
      expect(html, JSON.stringify(p)).not.toContain("qr-thanh-toan")
      expect(html).toContain("grid-cols-3")
    }
  })
  /* Chủ nhà 11/11/2026: "Thu nhỏ mã qr" — 7em (A5 ≈ 26 mm) → 5,5em (≈ 20 mm; ~0,45 mm / mô-đun, ≥ 3 điểm ở 203 dpi). */
  it("cạnh mã 5,5em (giãn theo cỡ chữ khổ giấy: A5 ≈ 20 mm)", () => {
    expect(veTo({ paymentQr: TCB })).toMatch(/<svg[^>]*class="h-\[5\.5em\] w-\[5\.5em\]"/)
  })
  it("lề trắng ĐỀU bốn phía (LE_QR mô-đun) — thiếu lề phải / dưới là mã dính sát chữ bên cạnh, khó quét", () => {
    const html = veTo({ paymentQr: TCB })
    const w = Number(/viewBox="0 0 (\d+) (\d+)"/.exec(html)![1])
    const d = /<path d="([^"]+)"/.exec(html)![1]
    const o = Array.from(d.matchAll(/M(\d+) (\d+)h(\d+)/g), (m) => ({ x: Number(m[1]), y: Number(m[2]), dai: Number(m[3]) }))
    expect(Math.min(...o.map((r) => r.x))).toBe(LE_QR)
    expect(Math.min(...o.map((r) => r.y))).toBe(LE_QR)
    expect(w - Math.max(...o.map((r) => r.x + r.dai))).toBe(LE_QR)
    expect(w - 1 - Math.max(...o.map((r) => r.y))).toBe(LE_QR)
  })
})

describe("nối dây", () => {
  it("tài khoản đọc từ cài đặt của NPP (bank_bin + bank_account_no); thiếu một trong hai → không có", () => {
    expect(orgHeaderFrom({ name: "NPP", settings: { bank_bin: "970407", bank_account_no: "666888696" } }).bank).toEqual(TCB)
    expect(orgHeaderFrom({ name: "NPP", settings: { bank_bin: "970407" } }).bank).toBeNull()
    expect(orgHeaderFrom({ name: "NPP", settings: {} }).bank).toBeNull()
  })
  it("màn in hoá đơn: chỉ hoá đơn ĐÃ GHI SỔ có mã; đơn đặt hàng không có mã", () => {
    const HD = readFileSync("src/app/(dashboard)/sales-invoices/[id]/print/page.tsx", "utf8")
    const DON = readFileSync("src/app/(dashboard)/orders/[id]/print/page.tsx", "utf8")
    expect(HD).toContain('paymentQr={inv.status === "posted" ? org.bank : null}')
    expect(DON).not.toContain("paymentQr")
  })
  it("Cấu hình tổ chức: chọn ngân hàng + số TK, kiểm trước khi lưu, ghi gộp vào settings", () => {
    const s = readFileSync("src/app/(dashboard)/settings/org/page.tsx", "utf8")
    expect(s).toContain("const loiTk = loiTaiKhoanNhan(bankBin, bankAccount)")
    expect(s).toMatch(/settings: \{\s*\.\.\.existing,[\s\S]*bank_bin: nhanTien\?\.bin \?\? null,\s*bank_account_no: nhanTien\?\.soTaiKhoan \?\? null,/)
    expect(s).toContain("mucCanDung(NGAN_HANG_VIETQR, bankBin, moNganHang, (b) => b.bin)")
  })
})

/* ------------------------------------------------------------------ Có mã QR thì luôn có dòng Lưu ý */

/** Câu chủ nhà gửi 10/11/2026 — nguyên văn. */
const CAU_CHU_NHA =
  "Lưu ý: Khách hàng thanh toán bằng tiền mặt và chỉ chuyển khoản vào số tài khoản của NPP: Ngân hàng Techcombank - " +
  "666888696 - CONG TY TNHH THUONG MAI GIA HIEU."

describe("có mã QR thì luôn có dòng Lưu ý (chủ nhà 11/11/2026: \"vẫn thêm dòng Lưu ý khi có mã qr\")", () => {
  it("câu mặc định điền từ tài khoản của mã TRÙNG TỪNG CHỮ câu chủ nhà gửi", () => {
    expect(cauLuuYMacDinh({ ...TCB, tenChuTk: "CONG TY TNHH THUONG MAI GIA HIEU" })).toBe(CAU_CHU_NHA)
    // Tên gõ thừa khoảng trắng / dấu chấm cuối → vẫn một câu sạch.
    expect(cauLuuYMacDinh(taiKhoanNhanTu("970407", "666 888 696", "  CONG TY TNHH  THUONG MAI GIA HIEU. ")!)).toBe(CAU_CHU_NHA)
    // Chưa điền tên chủ tài khoản → câu dừng ở số tài khoản.
    expect(cauLuuYMacDinh(TCB)).toBe(
      "Lưu ý: Khách hàng thanh toán bằng tiền mặt và chỉ chuyển khoản vào số tài khoản của NPP: Ngân hàng Techcombank - 666888696."
    )
  })
  it("câu NPP tự viết luôn thắng; trống mà có tài khoản → câu mặc định; không có gì → không in", () => {
    expect(luuYTrenTo({ printNote: "Lưu ý: chỉ nhận tiền mặt", bank: TCB })).toBe("Lưu ý: chỉ nhận tiền mặt")
    expect(luuYTrenTo({ printNote: "  ", bank: { ...TCB, tenChuTk: "CONG TY TNHH THUONG MAI GIA HIEU" } })).toBe(CAU_CHU_NHA)
    expect(luuYTrenTo({ printNote: null, bank: null })).toBeNull()
    expect(luuYTrenTo({})).toBeNull()
  })
  it("tên chủ tài khoản đọc từ cài đặt (bank_account_name), không vào chuỗi mã QR", () => {
    const h = orgHeaderFrom({
      name: "NPP",
      settings: { bank_bin: "970407", bank_account_no: "666888696", bank_account_name: "CONG TY TNHH THUONG MAI GIA HIEU" },
    })
    expect(h.bank).toEqual({ ...TCB, tenChuTk: "CONG TY TNHH THUONG MAI GIA HIEU" })
    expect(luuYTrenTo(h)).toBe(CAU_CHU_NHA)
    expect(chuoiVietQr({ ...h.bank!, soTien: 900000, noiDung: NOI_DUNG_QR_HOA_DON })).toBe(TCB_900K)
  })
  it("tờ in hoá đơn có mã QR + câu Lưu ý cùng lúc (câu ngay dưới bảng, mã ở hàng ô ký)", () => {
    const bank = { ...TCB, tenChuTk: "CONG TY TNHH THUONG MAI GIA HIEU" }
    const html = veTo({ org: { name: "NPP Thử", printNote: luuYTrenTo({ bank }) }, paymentQr: bank })
    const ly = html.indexOf('data-testid="luu-y-in"')
    expect(ly).toBeGreaterThan(html.indexOf("</table>"))
    expect(ly).toBeLessThan(html.indexOf('data-testid="qr-thanh-toan"'))
    expect(html).toContain(`<span class="font-bold">Lưu ý: </span>${CAU_CHU_NHA.slice("Lưu ý: ".length)}`)
  })
  it("ba màn in + Excel lấy câu qua MỘT luật (luuYTrenTo); màn cài đặt lưu tên chủ tài khoản", () => {
    for (const p of [
      "src/app/(dashboard)/sales-invoices/[id]/print/page.tsx",
      "src/app/(dashboard)/orders/[id]/print/page.tsx",
      "src/app/(dashboard)/invoices/[id]/print/page.tsx",
    ]) expect(readFileSync(p, "utf8"), p).toContain("printNote: luuYTrenTo(org)")
    expect(readFileSync("src/lib/xuat-excel/mot-phieu.ts", "utf8")).toContain("luuY: CO_LUU_Y_IN.has(loai) ? luuYTrenTo(org) : null,")
    const s = readFileSync("src/app/(dashboard)/settings/org/page.tsx", "utf8")
    expect(s).toContain("const nhanTien = taiKhoanNhanTu(bankBin, bankAccount, bankName)")
    expect(s).toContain("bank_account_name: nhanTien?.tenChuTk ?? null,")
    expect(s).toContain("const luuYTuDong = luuYTrenTo({ printNote, bank: taiKhoanNhanTu(bankBin, bankAccount, bankName) })")
  })
})
