import QRCode from "qrcode"

/**
 * MÃ QR VẼ BẰNG SVG ĐỒNG BỘ cho tờ in (mã VietQR chuyển khoản của hoá đơn — chủ nhà 10/11/2026).
 *
 * ⚠ KHÔNG dùng `QrCode` (`components/ui/qr-code.tsx`, dựng bất đồng bộ trong effect): tờ in tự động (`?auto=1`, khung in ẩn
 *   của POS) gọi in ngay khi dữ liệu về — mã dựng sau lượt vẽ đầu là tờ giấy ra không có mã. `QRCode.create` chạy đồng bộ.
 * ⚠ SVG (không PNG): in nét ở mọi khổ / tỷ lệ; kích thước theo `em` ở nơi gọi nên giãn theo cỡ chữ của khổ giấy.
 */

export interface MaTranQr {
  n: number
  den: (hang: number, cot: number) => boolean
}

/** Ma trận mô-đun. Mức sửa lỗi M (~15%): giấy nhàu / mực nhạt vẫn quét được. Chuỗi quá dài / hỏng → null. */
export function maTranQr(text: string): MaTranQr | null {
  if (!text) return null
  try {
    const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" })
    const n = modules.size
    const d = modules.data
    return { n, den: (h, c) => !!d[h * n + c] }
  } catch {
    return null
  }
}

/** Đường vẽ: các mô-đun đen liền nhau trên một hàng gộp thành MỘT hình chữ nhật; lề `le` mô-đun. */
export function duongQr(m: MaTranQr, le: number): string {
  const p: string[] = []
  for (let h = 0; h < m.n; h++) {
    let c = 0
    while (c < m.n) {
      if (!m.den(h, c)) {
        c++
        continue
      }
      const dau = c
      while (c < m.n && m.den(h, c)) c++
      p.push(`M${dau + le} ${h + le}h${c - dau}v1h-${c - dau}z`)
    }
  }
  return p.join("")
}

/** Lề trắng quanh mã, tính theo mô-đun (chung quanh trên tờ in còn khoảng trắng của bố cục). */
export const LE_QR = 2

export function QrSvg({ value, className, nhan }: { value: string; className?: string; nhan?: string }) {
  const m = maTranQr(value)
  if (!m) return null
  const w = m.n + 2 * LE_QR
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${w} ${w}`}
      className={className}
      shapeRendering="crispEdges"
      role="img"
      aria-label={nhan}
    >
      <rect width={w} height={w} fill="#fff" />
      <path d={duongQr(m, LE_QR)} fill="#000" />
    </svg>
  )
}
