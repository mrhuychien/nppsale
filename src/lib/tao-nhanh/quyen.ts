/**
 * TẠO NHANH TẠI CHỖ — ai được thấy dòng "+ Tạo … mới" ở ô tìm (chủ nhà 03/10/2026, Update 3.10).
 *
 * Cùng luật với nút "Thêm" ở màn danh sách tương ứng: khách → `customers.create`; NCC → `inventory.create`
 * (màn NCC gác theo Kho); sản phẩm → `products.create`; tuyến → chủ NPP / quản lý (như màn Tuyến).
 * Không có quyền thì nơi gọi KHÔNG truyền `taoMoi` — dòng ấy không hiện, chứ không hiện rồi báo lỗi.
 */
import { hasPermission, type Role } from "@/lib/permissions"

export type LoaiTaoNhanh = "khach" | "ncc" | "san-pham" | "tuyen"

export const NHAN_TAO_NHANH: Record<LoaiTaoNhanh, string> = {
  khach: "Tạo khách hàng mới",
  ncc: "Tạo nhà cung cấp mới",
  "san-pham": "Tạo sản phẩm mới",
  tuyen: "Tạo tuyến mới",
}

export function duocTaoNhanh(role: Role | null | undefined, loai: LoaiTaoNhanh): boolean {
  if (!role) return false
  switch (loai) {
    case "khach":
      return hasPermission(role, "customers", "create")
    case "ncc":
      return hasPermission(role, "inventory", "create")
    case "san-pham":
      return hasPermission(role, "products", "create")
    case "tuyen":
      return role === "owner" || role === "manager"
  }
}
