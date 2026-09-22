import type { Role } from "@/lib/permissions"

/**
 * Ai được SỬA / XOÁ một phiếu trả hàng — chép đúng RLS của `returns`.
 *
 *   UPDATE: "Owner/Manager can approve returns"  — chủ, quản lý: mọi phiếu
 *           "Sales can update own draft returns" — NVBH: phiếu NHÁP của mình (mig 165)
 *   DELETE: "Owner/Manager can delete draft returns" — chủ, quản lý: phiếu NHÁP (mig 166)
 *           "Sales can delete own draft returns"     — NVBH: phiếu NHÁP của mình (mig 165)
 *
 * ⚠ BẢN CŨ GÀI BẰNG MA TRẬN QUYỀN, không bằng RLS: thủ kho có
 *   `returns.update` nên thấy nút Sửa, bấm lưu là 0 dòng (đã đo); còn nút
 *   Xoá chỉ cho chủ, mà trước mig 166 không có chính sách DELETE nào cho
 *   chủ — nút luôn hỏng.
 */
export interface PhieuTraCanXet {
  status: string
  sales_user_id?: string | null
}

export function duocSuaPhieuTra(role: Role | null | undefined, userId: string | null | undefined, r: PhieuTraCanXet): boolean {
  if (role === "owner" || role === "manager") return true
  return role === "sales" && !!userId && r.status === "draft" && r.sales_user_id === userId
}

export function duocXoaPhieuTra(role: Role | null | undefined, userId: string | null | undefined, r: PhieuTraCanXet): boolean {
  if (r.status !== "draft") return false
  if (role === "owner" || role === "manager") return true
  return role === "sales" && !!userId && r.sales_user_id === userId
}
