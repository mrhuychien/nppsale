"use client"

/**
 * BÁO CÁO TỔNG HỢP › NHÂN VIÊN — chủ nhà 03/11/2026: "Lôi cho tao riêng báo cáo này ra ngoài menu BÁO CÁO TỔNG HỢP > Nhân
 * viên (Lưu ý khi bấm vào từng nhân viên xem được chi tiết như bên báo cáo)".
 *
 * CHÍNH trang Báo cáo › Nhân viên: ở đường dẫn này nó chỉ dựng "Hàng bán theo nhân viên" (`laManHangBanNv`) — một mã, một
 * luật số, bấm từng nhân viên mở chi tiết y hệt. Đừng chép bảng sang đây: hai bản là hai con số lệch nhau.
 */
import BaoCaoNhanVien from "../../reports/employees/page"

export default function Page() {
  return <BaoCaoNhanVien />
}
