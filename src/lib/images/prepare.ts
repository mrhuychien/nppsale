/**
 * Chuẩn bị ảnh trước khi tải lên: nén, và đóng dấu thời gian / toạ độ.
 *
 * Dùng chung cho ảnh POD và ảnh điểm bán. Trước đây hàm nén nằm riêng
 * trong pod-capture-sheet; hai bản sao là hai lần phải nhớ sửa khi đổi
 * kích thước, và bản bị quên sẽ âm thầm tải lên ảnh 6MB.
 */

/** Cạnh dài tối đa sau khi nén, px. */
export const MAX_EDGE = 1280
/** Chất lượng JPEG. */
export const JPEG_QUALITY = 0.7

export type Stamp = {
  takenAt: Date
  lat?: number | null
  lng?: number | null
  accuracy?: number | null
  /** Dòng trên cùng — thường là tên điểm bán. */
  title?: string
}

function two(n: number): string {
  return String(n).padStart(2, "0")
}

/** Dòng chữ đóng lên ảnh. Xuất riêng để test được mà không cần canvas. */
export function stampLines(s: Stamp): string[] {
  const d = s.takenAt
  const time = `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`
  const lines: string[] = []
  if (s.title) lines.push(s.title)
  lines.push(time)
  if (s.lat != null && s.lng != null) {
    const acc = s.accuracy != null ? ` (±${Math.round(s.accuracy)}m)` : ""
    lines.push(`${s.lat.toFixed(6)}, ${s.lng.toFixed(6)}${acc}`)
  } else {
    // NÓI RA là không có vị trí, đừng để trống. Tấm ảnh không dấu vị trí
    // trông y hệt tấm có — người duyệt sau này không phân biệt được.
    lines.push("Không có vị trí")
  }
  return lines
}

/**
 * Nén ảnh và (tuỳ chọn) đóng dấu thời gian + toạ độ lên góc dưới.
 *
 * Dấu đóng lên ảnh là để NGƯỜI xem nhanh; dữ liệu THẬT vẫn nằm ở các cột
 * taken_at / gps_lat / gps_lng trong DB. Không đảo vai trò hai thứ đó:
 * chữ trên ảnh không truy vấn được và ai cũng chỉnh được bằng app khác.
 *
 * Hỏng ở bất kỳ bước nào thì trả về FILE GỐC, không ném — thà tải lên
 * ảnh to hoặc ảnh không dấu, còn hơn mất tấm ảnh người ta vừa chụp ở
 * ngoài đường.
 */
export async function prepareImage(file: File, stamp?: Stamp): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)

    if (stamp) {
      const lines = stampLines(stamp)
      // Cỡ chữ theo chiều rộng ảnh: cố định 14px thì trên ảnh 1280 là
      // không đọc nổi, còn trên ảnh 400 lại che mất cửa hàng.
      const fontPx = Math.max(12, Math.round(w / 36))
      const pad = Math.round(fontPx * 0.5)
      const lineH = Math.round(fontPx * 1.35)
      const boxH = lines.length * lineH + pad * 2
      ctx.font = `bold ${fontPx}px sans-serif`
      ctx.textBaseline = "top"
      // Nền mờ phía sau chữ: chữ trắng trên nền trời trắng là vô hình.
      ctx.fillStyle = "rgba(0,0,0,0.55)"
      ctx.fillRect(0, h - boxH, w, boxH)
      ctx.fillStyle = "#ffffff"
      lines.forEach((ln, i) => {
        ctx.fillText(ln, pad, h - boxH + pad + i * lineH)
      })
    }

    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/jpeg", JPEG_QUALITY)
    )
    return blob || file
  } catch {
    return file
  }
}
