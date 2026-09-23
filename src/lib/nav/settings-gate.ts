import { DEFAULT_PERMISSION_MAP, type Role } from "@/lib/permissions"

/**
 * Cổng THÔ ở máy chủ (middleware) cho mọi đường `/settings*`.
 *
 * ⚠ LẤY TỪ MA TRẬN QUYỀN MẶC ĐỊNH, KHÔNG VIẾT TAY. Bản cũ cứng
 *   `["owner", "manager"]`, trong khi ma trận cho kế toán `settings.read`,
 *   `NAV_PERMISSION` cho kế toán vào `/settings/einvoice`, API
 *   `/api/einvoice/config` và chính màn ấy chỉ cho owner + accountant.
 *   Kết quả: kế toán thấy mục menu Hoá đơn điện tử, bấm vào thì bị đẩy về
 *   `/dashboard` — đúng người màn ấy làm ra cho lại là người không vào được.
 *
 * ⚠ CHỈ LÀ CỔNG THÔ. Từng màn vẫn tự gác bằng `useRoleGuard` /
 *   `NAV_PERMISSION` (theo tính năng), và dữ liệu vẫn do RLS canh.
 */
export function duocQuaCongSettings(role: string | null | undefined): boolean {
  if (!role) return false
  return (DEFAULT_PERMISSION_MAP[role as Role]?.settings ?? []).includes("read")
}
