import { describe, it, expect } from "vitest"
import { createRequire } from "node:module"
import { veKhung, modulEan13, modulEan8, modulCode128B, soKiemEan } from "../e2e/camera-gia.mjs"
import { vaZxing, lopGiu, type ZxingCanVa } from "@/lib/quet/zxing-va"

/**
 * CHỦ NHÀ 02/11/2026: "phần tạo sản phẩm mới trên điện thoại mã vạch chưa quét được".
 * ZXing đóng kèm html5-qrcode dò vạch mở đầu sai (EAN/UPC + Code128) — hàng điểm ảnh có vùng tối bên trái mã là trượt.
 * Bài dưới vẽ mã trên nền bao bì tối như ảnh camera thật: bản đóng kèm phải TRƯỢT (chứng minh lỗi có thật), vá xong đọc đúng.
 */

const require = createRequire(import.meta.url)
const DUONG = require.resolve("html5-qrcode/third_party/zxing-js.umd.js")

type Zx = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const va = (zx: Zx) => vaZxing(zx as unknown as ZxingCanVa)

/** Mỗi lần một bản mô-đun MỚI (bản vá sửa lớp dùng chung — bài "chưa vá" không được thấy bản đã vá). */
function napMoi(): Zx {
  delete require.cache[DUONG]
  return require(DUONG) as Zx
}

function doc(zx: Zx, Y: Uint8Array, w: number, h: number, dang: string[]): string | null {
  const hints = new Map<number, unknown>([[zx.DecodeHintType.POSSIBLE_FORMATS, dang.map((d) => zx.BarcodeFormat[d])]])
  try {
    const anh = new zx.BinaryBitmap(new zx.HybridBinarizer(new zx.RGBLuminanceSource(new Uint8ClampedArray(Y), w, h)))
    return new zx.MultiFormatReader(false, hints).decodeWithState(anh).getText()
  } catch {
    return null
  }
}

const EAN13 = "8934567138161"
const EAN8 = "96385074"
const MOT_DONG = ["EAN_13", "EAN_8", "UPC_A", "UPC_E", "CODE_128", "CODE_39", "ITF", "QR_CODE"]


const KHUNG = { w: 640, h: 360, sigma: 0.6, nhieu: 4 }

describe("ZXing đóng kèm html5-qrcode: dò vạch mở đầu", () => {
  it("số kiểm của bộ vẽ mã đúng chuẩn EAN (mã dùng trong bài là mã thật)", () => {
    expect(soKiemEan("893456713816")).toBe("1")
    expect(soKiemEan("9638507")).toBe("4")
    expect(modulEan13(EAN13)).toHaveLength(95)
    expect(modulEan8(EAN8)).toHaveLength(67)
  })

  it("nền trắng (vạch đen đầu tiên của hàng là vạch mở đầu): bản đóng kèm vẫn đọc được — lỗi chỉ lộ khi có vùng tối", () => {
    const zx = napMoi()
    const Y = veKhung({ ...KHUNG, modul: modulEan13(EAN13), tiLe: 0.5, nen: 222 })
    expect(doc(zx, Y, KHUNG.w, KHUNG.h, MOT_DONG)).toBe(EAN13)
  })

  for (const [ten, modul, ma] of [
    ["EAN-13", modulEan13(EAN13), EAN13],
    ["EAN-8", modulEan8(EAN8), EAN8],
  ] as const) {
    it(`${ten} trên nền bao bì tối: bản đóng kèm TRƯỢT, vá xong đọc đúng`, () => {
      const Y = veKhung({ ...KHUNG, modul, tiLe: 0.45, goc: 1.5 })
      const cu = napMoi()
      expect(doc(cu, Y, KHUNG.w, KHUNG.h, MOT_DONG)).toBeNull()
      const moi = napMoi()
      expect(va(moi)).toBe(true)
      expect(doc(moi, Y, KHUNG.w, KHUNG.h, MOT_DONG)).toBe(ma)
    })
  }

  it("Code128 (tem nội bộ) trên nền tối: bản đóng kèm TRƯỢT, vá xong đọc đúng", () => {
    const mau = napMoi()
    const modul = modulCode128B("NPP-12345", mau.Code128Reader.CODE_PATTERNS)
    const Y = veKhung({ ...KHUNG, modul, tiLe: 0.6 })
    expect(doc(mau, Y, KHUNG.w, KHUNG.h, MOT_DONG)).toBeNull()
    const moi = napMoi()
    va(moi)
    expect(doc(moi, Y, KHUNG.w, KHUNG.h, MOT_DONG)).toBe("NPP-12345")
  })

  it("mã rất nhỏ giữa khung lớn (cầm xa ~12 cm, khung 1080 px): vá xong đọc được ở độ phân giải gốc", () => {
    const w = 1080
    const h = 600
    const Y = veKhung({ w, h, modul: modulEan13(EAN13), tiLe: 0.3, sigma: 1.2, nhieu: 6, goc: -1 })
    const moi = napMoi()
    va(moi)
    expect(doc(moi, Y, w, h, MOT_DONG)).toBe(EAN13)
  })

  it("vá đúng lớp GỐC giữ hàm (EAN-13 / EAN-8 / UPC dùng chung — bài EAN-8 ở trên đọc được nhờ đó), gọi lại không vá chồng", () => {
    const zx = napMoi()
    const goc = lopGiu(zx.EAN13Reader, "findGuardPattern")
    expect(goc).not.toBeNull()
    expect(goc).not.toBe(zx.EAN13Reader) // hàm nằm ở lớp cha, không phải EAN13Reader
    expect((goc as unknown as { name: string }).name).toBe("AbstractUPCEANReader")
    expect(va(zx)).toBe(true)
    const daVa = goc!.findGuardPattern
    const daVa128 = zx.Code128Reader.findStartPattern
    expect(va(zx)).toBe(true)
    expect(goc!.findGuardPattern).toBe(daVa)
    expect(zx.Code128Reader.findStartPattern).toBe(daVa128)
  })

  it("mô-đun không đúng hình dạng (bản thư viện khác) → không vá, trả false, không ném", () => {
    const gia = { OneDReader: { patternMatchVariance: () => 0 }, EAN13Reader: {}, Code128Reader: {}, NotFoundException: Error }
    expect(vaZxing(gia as unknown as ZxingCanVa)).toBe(false)
  })
})
