import type { MisaRelation, MisaStatus } from "@/types"

/**
 * Nhãn hiển thị cho hai trục trạng thái MISA.
 *
 * Một chỗ duy nhất, vì trước đây ba màn hình (danh sách hoá đơn, chi tiết
 * hoá đơn, chi tiết đơn hàng) mỗi chỗ tự viết một chuỗi ternary riêng và
 * cùng kết thúc bằng "Đang xử lý". Thêm trạng thái mới ở mig 099 mà không
 * gom lại thì hoá đơn ĐÃ BỊ HUỶ trên MISA sẽ hiện "Đang xử lý" — hoặc tệ
 * hơn, không hiện nhãn nào (map cũ trả undefined và chỗ gọi chỉ render khi
 * tìm thấy).
 */
export type BadgeVariant = "default" | "success" | "warning" | "danger" | "secondary"

export const MISA_STATUS_BADGE: Record<MisaStatus, { label: string; variant: BadgeVariant }> = {
  pending: { label: "Chờ gửi", variant: "warning" },
  sent: { label: "Đã gửi MISA", variant: "default" },
  waiting_code: { label: "Chờ cấp mã", variant: "warning" },
  signed: { label: "Đã phát hành", variant: "success" },
  // Hết hiệu lực — phải nhìn thấy ngay, không phải màu trung tính.
  replaced: { label: "Đã bị thay thế", variant: "danger" },
  cancelled: { label: "Đã huỷ trên MISA", variant: "danger" },
  amount_mismatch: { label: "Lệch với MISA", variant: "warning" },
  error: { label: "Lỗi", variant: "danger" },
}

export function misaStatusBadge(
  status: string | null | undefined
): { label: string; variant: BadgeVariant } | null {
  if (!status) return null
  // Trạng thái lạ (dữ liệu cũ, hoặc ai đó thêm giá trị mà quên map) vẫn
  // phải hiện gì đó — im lặng ở đây là giấu mất một hoá đơn có vấn đề.
  return (
    MISA_STATUS_BADGE[status as MisaStatus] ?? {
      label: `Không rõ (${status})`,
      variant: "secondary" as BadgeVariant,
    }
  )
}

export const MISA_RELATION_LABEL: Record<MisaRelation, string> = {
  new: "Hoá đơn mới",
  replacement: "Hoá đơn thay thế",
  adjustment: "Hoá đơn điều chỉnh",
  replaced: "Bị thay thế",
  adjusted: "Bị điều chỉnh",
  unknown: "Quan hệ chưa xác định",
}

export function misaRelationLabel(relation: string | null | undefined): string | null {
  if (!relation) return null
  return MISA_RELATION_LABEL[relation as MisaRelation] ?? `Không rõ (${relation})`
}

/**
 * Hoá đơn còn HIỆU LỰC để kê khai hay không.
 *
 * 'adjusted' (BỊ điều chỉnh) VẪN còn hiệu lực: hoá đơn điều chỉnh chỉ cộng
 * phần chênh, bản gốc vẫn phải kê khai. Chỉ 'replaced' và 'cancelled' là
 * hết.
 */
export function isMisaVoided(status: string | null | undefined): boolean {
  return status === "replaced" || status === "cancelled"
}
