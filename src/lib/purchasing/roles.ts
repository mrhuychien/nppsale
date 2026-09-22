import type { Role } from "@/lib/permissions"

/**
 * Vai được ghi phiếu nhập mua / phiếu trả NCC.
 *
 * ⚠ CHÉP ĐÚNG RLS CỦA `purchase_invoices` / `supplier_returns` ("Manage
 *   purchase invoices", "Manage supplier returns") — và từ mig 166 cũng
 *   là cổng vai trong các RPC hoàn thành / huỷ. Màn chi tiết là đường
 *   dẫn động nên `useRoleGuard` chỉ kiểm mô-đun, mà mô-đun kho thì NVBH
 *   cũng đọc được: không gác nút ở đây là NVBH thấy nút "Huỷ phiếu" rồi
 *   bấm vào lỗi.
 */
export const VAI_GHI_MUA_HANG: readonly Role[] = ["owner", "manager", "accountant", "warehouse"]

export function duocGhiMuaHang(role: Role | null | undefined): boolean {
  return !!role && VAI_GHI_MUA_HANG.includes(role)
}
