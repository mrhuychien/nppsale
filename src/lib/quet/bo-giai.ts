/**
 * BỘ GIẢI MÃ của bộ quét mã vạch (chủ nhà 02/11/2026: "phần tạo sản phẩm mới trên điện thoại mã vạch chưa quét được").
 *
 * · Máy có bộ đọc mã SẴN (`BarcodeDetector` — Android Chrome) → dùng nó: nhanh, đọc được cả khi mã nghiêng.
 * · Không có (iPhone Safari, máy tính Windows / Linux) → ZXing đóng kèm html5-qrcode (không thêm thư viện), ĐÃ VÁ lỗi dò
 *   vạch mở đầu (`zxing-va.ts`) — chưa vá thì ảnh camera thật gần như không bao giờ đọc được.
 * Bộ đọc sẵn hỏng giữa chừng (máy Android thiếu dịch vụ Google) thì chuyển hẳn sang ZXing.
 */
import { vaZxing, type ZxingCanVa } from "@/lib/quet/zxing-va"

/** Dạng mã nhận (tên của `BarcodeDetector`): hàng bán lẻ (EAN / UPC), thùng (ITF-14), tem nội bộ (Code128 / 39), QR. */
export const DANG_MA_MAY = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"] as const
/** Cùng bộ dạng mã, tên của ZXing. */
export const DANG_MA_ZXING = ["EAN_13", "EAN_8", "UPC_A", "UPC_E", "CODE_128", "CODE_39", "ITF", "QR_CODE"] as const

export interface BoGiai {
  ten: "may" | "zxing"
  /** Mã đọc được trong ảnh, `null` nếu không thấy. Không ném. */
  giai(anh: HTMLCanvasElement): Promise<string | null>
}

export interface MaMayThay {
  rawValue: string
  boundingBox?: { width: number; height: number }
}

interface MayDocMa {
  detect(anh: HTMLCanvasElement): Promise<MaMayThay[]>
}
interface LopMayDocMa {
  new (tuyChon: { formats: string[] }): MayDocMa
  getSupportedFormats?(): Promise<string[]>
}

/** Nhiều mã trong ô ngắm → lấy mã TO nhất (gần camera nhất — mã người dùng đang chĩa vào). */
export function chonMaLonNhat(ds: MaMayThay[] | null | undefined): string | null {
  let tot: MaMayThay | null = null
  let dienTich = -1
  for (const m of ds ?? []) {
    if (!m?.rawValue) continue
    const s = (m.boundingBox?.width ?? 0) * (m.boundingBox?.height ?? 0)
    if (s > dienTich) {
      tot = m
      dienTich = s
    }
  }
  return tot ? tot.rawValue : null
}

/** Bộ đọc sẵn của máy, hoặc `null` nếu máy không có / không đọc được EAN-13. */
export async function boGiaiMay(lop: LopMayDocMa | undefined = (globalThis as { BarcodeDetector?: LopMayDocMa }).BarcodeDetector): Promise<BoGiai | null> {
  if (typeof lop !== "function") return null
  try {
    const coSan = (await lop.getSupportedFormats?.()) ?? []
    const dang = DANG_MA_MAY.filter((d) => coSan.includes(d))
    if (!dang.includes("ean_13")) return null
    const may = new lop({ formats: [...dang] })
    return { ten: "may", giai: async (anh) => chonMaLonNhat(await may.detect(anh)) }
  } catch {
    return null
  }
}

/** Phần ZXing bộ giải dùng (bản đóng kèm chỉ khai kiểu sơ sài). */
interface ZxingDayDu extends ZxingCanVa {
  DecodeHintType: { POSSIBLE_FORMATS: number }
  BarcodeFormat: Record<string, number>
  MultiFormatReader: new (verbose: boolean, hints: Map<number, unknown>) => { decodeWithState(anh: unknown): { getText(): string } }
  BinaryBitmap: new (binarizer: unknown) => unknown
  HybridBinarizer: new (nguon: unknown) => unknown
  HTMLCanvasElementLuminanceSource: new (anh: HTMLCanvasElement) => unknown
}

/** Mô-đun nạp động (CommonJS gói trong `import()`): lớp nằm thẳng trên mô-đun hoặc trong `default`. */
export function layZxing(m: unknown): ZxingDayDu {
  const thang = m as Partial<ZxingDayDu> & { default?: unknown }
  return (typeof thang.MultiFormatReader === "function" ? thang : thang.default) as ZxingDayDu
}

/** ZXing đã vá, dựng từ mô-đun đã nạp — tách riêng để kiểm thử chạy được trên Node. */
export function boGiaiTuZxing(zx: ZxingDayDu): BoGiai {
  vaZxing(zx)
  const hints = new Map<number, unknown>([[zx.DecodeHintType.POSSIBLE_FORMATS, DANG_MA_ZXING.map((d) => zx.BarcodeFormat[d])]])
  const doc = new zx.MultiFormatReader(false, hints)
  return {
    ten: "zxing",
    async giai(anh) {
      try {
        return doc.decodeWithState(new zx.BinaryBitmap(new zx.HybridBinarizer(new zx.HTMLCanvasElementLuminanceSource(anh)))).getText() || null
      } catch {
        return null // không thấy mã trong khung này
      }
    },
  }
}

let zxingP: Promise<BoGiai> | null = null

/** Nạp ZXing (một lần cho cả phiên; tải hỏng thì lần sau tải lại). */
export function boGiaiZxing(): Promise<BoGiai> {
  if (!zxingP) {
    const p = import("html5-qrcode/third_party/zxing-js.umd").then((m) => boGiaiTuZxing(layZxing(m)))
    p.catch(() => {
      if (zxingP === p) zxingP = null
    })
    zxingP = p
  }
  return zxingP
}

/** Bộ giải cho một lần mở camera: bộ đọc sẵn của máy nếu có, hỏng thì chuyển hẳn sang ZXing. */
export async function taoBoGiai(may: Promise<BoGiai | null> = boGiaiMay(), zxing: () => Promise<BoGiai> = boGiaiZxing): Promise<BoGiai> {
  const sanCo = await may
  if (!sanCo) return zxing()
  let dung: BoGiai = sanCo
  let daChuyen = false
  return {
    get ten() {
      return dung.ten
    },
    async giai(anh) {
      try {
        return await dung.giai(anh)
      } catch {
        if (daChuyen) return null
        daChuyen = true
        dung = await zxing()
        return dung.giai(anh)
      }
    },
  }
}
