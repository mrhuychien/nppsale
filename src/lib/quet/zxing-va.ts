/**
 * VÁ ZXING ĐÓNG KÈM html5-qrcode — chủ nhà 02/11/2026: "phần tạo sản phẩm mới trên điện thoại mã vạch chưa quét được".
 *
 * `html5-qrcode/third_party/zxing-js.umd.js` (bản chép ZXing-js cũ; html5-qrcode 2.3.8 là bản cuối, không ai sửa nữa) dò
 * vạch MỞ ĐẦU sai ở hai chỗ — cùng một lỗi chép từ Java:
 *  · `findGuardPattern` (lớp gốc của EAN-13 / EAN-8 / UPC-A / UPC-E): khung 3 vạch không khớp thì dời khung bằng
 *    `counters.slice(2, counters.length - 1)` — với mẫu 3 vạch là mảng RỖNG, ô đếm đầu thành 0, từ đó không khung nào khớp.
 *  · `Code128Reader.findStartPattern`: `counters = counters.slice(2, counters.length - 1)` thu mảng 6 ô còn 3 — hỏng như trên.
 * Hệ quả: hàng điểm ảnh nào có vùng TỐI bên trái mã (bao bì, mép hộp, chữ — gần như mọi ảnh camera thật) là không đọc
 * được; chỉ đọc khi vạch đen đầu tiên của hàng chính là vạch mở đầu. Đo 02/11/2026 trên khung giả 1080×1920, mã rộng 30%
 * khung: chưa vá 0/3 khung đọc được (kể cả khung nét), vá xong 3/3.
 *
 * Bản Java gốc dời khung bằng `System.arraycopy(counters, 2, counters, 0, counterPosition - 1)` — vá lại đúng như thế
 * (`copyWithin`), mọi phần khác giữ y nguyên bản đóng kèm. Vá lúc nạp bộ đọc, một lần (`vaZxing` gọi lại không vá chồng).
 */

/** Hàng điểm ảnh đã nhị phân hoá (`BitArray` của ZXing) — đúng các hàm hai bản vá dùng. */
export interface HangBit {
  getSize(): number
  get(i: number): boolean
  getNextSet(from: number): number
  getNextUnset(from: number): number
  isRange(start: number, end: number, value: boolean): boolean
}

type DoLech = (counters: Int32Array, pattern: ArrayLike<number>, maxIndividualVariance: number) => number
type DoMoDau = (row: HangBit, rowOffset: number, whiteFirst: boolean, pattern: ArrayLike<number>, counters: Int32Array) => Int32Array

interface LopCode128 {
  MAX_AVG_VARIANCE: number
  MAX_INDIVIDUAL_VARIANCE: number
  CODE_PATTERNS: ArrayLike<ArrayLike<number>>
  CODE_START_A: number
  CODE_START_C: number
  findStartPattern: (row: HangBit) => Int32Array
}

/** Phần của mô-đun ZXing đóng kèm mà bản vá chạm tới. */
export interface ZxingCanVa {
  OneDReader: { patternMatchVariance: DoLech }
  EAN13Reader: object
  Code128Reader: object
  NotFoundException: new (message?: string) => Error
}

const DAU_DA_VA = "__nppDaVaDoMoDau"

/** Lớp (trên chuỗi kế thừa của `lop`) thật sự giữ hàm tĩnh `ten` — vá đúng chỗ ấy thì mọi lớp con đều theo. */
export function lopGiu(lop: object, ten: string): Record<string, unknown> | null {
  let c: object | null = lop
  while (c && !Object.prototype.hasOwnProperty.call(c, ten)) c = Object.getPrototypeOf(c) as object | null
  return (c as Record<string, unknown> | null) ?? null
}

/** Vá hai hàm dò vạch mở đầu. Trả `true` nếu mô-đun đã ở trạng thái vá (vừa vá hoặc vá từ trước). */
export function vaZxing(zx: ZxingCanVa): boolean {
  const upc = lopGiu(zx.EAN13Reader, "findGuardPattern")
  const c128 = zx.Code128Reader as unknown as LopCode128 & Record<string, unknown>
  if (!upc || typeof upc.findGuardPattern !== "function" || typeof c128.findStartPattern !== "function") return false
  if (upc[DAU_DA_VA] && c128[DAU_DA_VA]) return true
  const lech = zx.OneDReader.patternMatchVariance
  const KhongThay = zx.NotFoundException

  const timMoDau: DoMoDau = (row, rowOffset, whiteFirst, pattern, counters) => {
    const width = row.getSize()
    rowOffset = whiteFirst ? row.getNextUnset(rowOffset) : row.getNextSet(rowOffset)
    let counterPosition = 0
    let patternStart = rowOffset
    const patternLength = pattern.length
    let isWhite = whiteFirst
    for (let x = rowOffset; x < width; x++) {
      if (row.get(x) !== isWhite) {
        counters[counterPosition]++
      } else {
        if (counterPosition === patternLength - 1) {
          if (lech(counters, pattern, upc.MAX_INDIVIDUAL_VARIANCE as number) < (upc.MAX_AVG_VARIANCE as number)) {
            return Int32Array.from([patternStart, x])
          }
          patternStart += counters[0] + counters[1]
          counters.copyWithin(0, 2, 2 + counterPosition - 1) // ← bản đóng kèm: counters.slice(2, counters.length - 1)
          counters[counterPosition - 1] = 0
          counters[counterPosition] = 0
          counterPosition--
        } else {
          counterPosition++
        }
        counters[counterPosition] = 1
        isWhite = !isWhite
      }
    }
    throw new KhongThay()
  }

  const timMoDau128 = (row: HangBit): Int32Array => {
    const width = row.getSize()
    const rowOffset = row.getNextSet(0)
    let counterPosition = 0
    const counters = new Int32Array(6)
    let patternStart = rowOffset
    let isWhite = false
    const patternLength = 6
    for (let i = rowOffset; i < width; i++) {
      if (row.get(i) !== isWhite) {
        counters[counterPosition]++
      } else {
        if (counterPosition === patternLength - 1) {
          let bestVariance = c128.MAX_AVG_VARIANCE
          let bestMatch = -1
          for (let startCode = c128.CODE_START_A; startCode <= c128.CODE_START_C; startCode++) {
            const variance = lech(counters, c128.CODE_PATTERNS[startCode], c128.MAX_INDIVIDUAL_VARIANCE)
            if (variance < bestVariance) {
              bestVariance = variance
              bestMatch = startCode
            }
          }
          // Vùng trắng trước mẫu mở đầu ≥ 50% bề rộng mẫu
          if (bestMatch >= 0 && row.isRange(Math.max(0, patternStart - (i - patternStart) / 2), patternStart, false)) {
            return Int32Array.from([patternStart, i, bestMatch])
          }
          patternStart += counters[0] + counters[1]
          counters.copyWithin(0, 2, 2 + counterPosition - 1) // ← bản đóng kèm: counters = counters.slice(2, counters.length - 1)
          counters[counterPosition - 1] = 0
          counters[counterPosition] = 0
          counterPosition--
        } else {
          counterPosition++
        }
        counters[counterPosition] = 1
        isWhite = !isWhite
      }
    }
    throw new KhongThay()
  }

  upc.findGuardPattern = timMoDau
  upc[DAU_DA_VA] = true
  c128.findStartPattern = timMoDau128
  c128[DAU_DA_VA] = true
  return true
}
