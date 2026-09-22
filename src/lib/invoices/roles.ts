import type { Role } from "@/lib/permissions"

/**
 * Vai được ghi (khoá / huỷ / sửa) hoá đơn điện tử nội bộ (`invoices`).
 *
 * ⚠ CHÉP ĐÚNG RLS "Owner/Accountant can manage invoices". Quản lý chỉ có
 *   quyền XEM; mở nút cho quản lý là để database lặng lẽ từ chối (0 dòng,
 *   không lỗi) — đã đo.
 */
export const VAI_GHI_HOA_DON: Role[] = ["owner", "accountant"]
