import type { ReactNode } from "react"

/**
 * TRANG IN RIÊNG CỦA POS — chủ nhà 24/09/2026: "Ấn vào IN trên Đơn hàng hoặc
 * Hoá đơn -> bật ra cửa sổ máy in luôn … thiết lập luôn phiếu in riêng cho màn pos".
 *
 * Cùng MẪU PHIẾU với trang in của phần quản lý (một mẫu, hai lối vào) nhưng
 * KHÔNG kèm khung dashboard (menu, thanh trên, truy vấn vai trò): POS nạp trang
 * này vào khung ẩn (`inTaiCho`) nên càng nhẹ càng bật hộp thoại in nhanh.
 *
 * ⚠ `print:min-h-0` LÀ BẮT BUỘC (chủ nhà 25/09/2026: "Mẫu in hóa đơn trên pos luôn
 *   in ra 1 trang trắng phía sau dù đơn ngắn"). Khi in, `100vh` là cả chiều cao
 *   khổ giấy, lớn hơn vùng in (đã trừ lề `@page`) — `min-h-screen` đẩy khung tràn
 *   sang tờ thứ hai, trắng. Trang in ở phần quản lý không có lớp này nên chỉ 1 tờ.
 */
export default function InLayout({ children }: { children: ReactNode }) {
  return <main className="min-h-screen bg-white p-4 print:min-h-0 print:p-0">{children}</main>
}
