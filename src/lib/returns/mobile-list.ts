/**
 * DANH SÁCH TRẢ HÀNG TRÊN ĐIỆN THOẠI — phần tính toán thuần của màn theo mẫu chủ nhà 27/09/2026
 * ("Viết lại giao diện danh sách trả hàng trên mobile của nhân viên bán hàng theo mẫu").
 */
import { groupDocsByDay, vnDateKey, type DayGroup } from "@/lib/orders/status-tone"
import type { ReturnZone } from "@/lib/returns/complete-return"

/** Tab của màn điện thoại — chọn MỘT; "Chờ xử lý" đứng đầu vì đó là việc phải làm. */
export const TAB_TRA_MOBILE = [
  { key: "submitted", label: "Chờ xử lý" },
  { key: "draft", label: "Nháp" },
  { key: "completed", label: "Đã nhập kho" },
  { key: "cancelled", label: "Đã huỷ" },
  { key: "all", label: "Tất cả" },
] as const

/** Màu + nhãn trạng thái phiếu trả trên thẻ / ngăn (mẫu: vàng · xám · xanh · đỏ). */
export function toneTra(status: string): { label: string; cls: string } {
  switch (status) {
    case "submitted":
      return { label: "Chờ xử lý", cls: "bg-amber-50 text-amber-700" }
    case "draft":
      return { label: "Nháp", cls: "bg-muted text-muted-foreground" }
    case "completed":
      return { label: "Đã nhập kho", cls: "bg-emerald-50 text-emerald-700" }
    case "cancelled":
      return { label: "Đã huỷ", cls: "bg-red-50 text-destructive" }
    default:
      return { label: status, cls: "bg-muted text-muted-foreground" }
  }
}

const ddMM = (key: string) => (/^\d{4}-\d{2}-\d{2}$/.test(key) ? `${key.slice(8, 10)}/${key.slice(5, 7)}` : key)

/** Nhãn nhóm ngày theo mẫu: "Hôm nay · 26/09", "Hôm qua · 25/09", còn lại "24/09". */
export function nhanNgayTra(key: string, now: Date = new Date()): string {
  const homNay = vnDateKey(now)
  const homQua = vnDateKey(new Date(now.getTime() - 86_400_000))
  if (key === homNay) return `Hôm nay · ${ddMM(key)}`
  if (key === homQua) return `Hôm qua · ${ddMM(key)}`
  return ddMM(key)
}

/**
 * Ngày của phiếu để nhóm: NGÀY CHỨNG TỪ (`return_date`, DATE) — không có thì ngày tạo đổi sang
 * giờ VN (mốc ISO/UTC lúc 0–7h sáng VN là ngày hôm trước).
 */
export function ngayNhomTra(r: { return_date?: string | null; created_at: string }): string {
  if (r.return_date) return r.return_date.slice(0, 10)
  const d = new Date(r.created_at)
  return Number.isNaN(d.getTime()) ? (r.created_at || "").slice(0, 10) : vnDateKey(d)
}

export function nhomTraTheoNgay<T extends { return_date?: string | null; created_at: string; credit_note_amount: number | null }>(
  rows: T[],
  now: Date = new Date()
): DayGroup<T>[] {
  return groupDocsByDay(rows, ngayNhomTra, (r) => Number(r.credit_note_amount) || 0, now).map((g) => ({
    ...g,
    label: nhanNgayTra(g.key, now),
  }))
}

/**
 * Kho nhận GỢI Ý theo lý do (mẫu: hư hỏng / hết hạn → kho hàng lỗi). Chỉ là chỗ chọn sẵn — người
 * bấm vẫn thấy cả hai ô và tên kho nằm ngay trên nút Hoàn thành.
 */
export function khoGoiY(reason: string | null | undefined): ReturnZone {
  return reason === "damaged" || reason === "near_expiry" || reason === "expired" ? "date" : "sale"
}

/** "PT" từ "Phạm Thị Vĩnh" — chữ đầu của từ đầu và từ cuối. */
export function viTatTen(ten: string | null | undefined): string {
  const t = (ten ?? "").trim().split(/\s+/).filter(Boolean)
  if (t.length === 0) return "?"
  const a = t[0][0] ?? ""
  const b = t.length > 1 ? t[t.length - 1][0] ?? "" : ""
  return (a + b).toUpperCase()
}
