import type { ReactNode } from "react"

/**
 * TRANG IN RIÊNG CỦA POS — chủ nhà 24/09/2026: "Ấn vào IN trên Đơn hàng hoặc
 * Hoá đơn -> bật ra cửa sổ máy in luôn … thiết lập luôn phiếu in riêng cho màn pos".
 *
 * Cùng MẪU PHIẾU với trang in của phần quản lý (một mẫu, hai lối vào) nhưng
 * KHÔNG kèm khung dashboard (menu, thanh trên, truy vấn vai trò): POS nạp trang
 * này vào khung ẩn (`inTaiCho`) nên càng nhẹ càng bật hộp thoại in nhanh.
 */
export default function InLayout({ children }: { children: ReactNode }) {
  return <main className="min-h-screen bg-white p-4 print:p-0">{children}</main>
}
