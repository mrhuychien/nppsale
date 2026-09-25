/**
 * ⚠ CHỦ NHÀ 25/09/2026: "Trạng thái Đã huỷ -> Ẩn với nhân viên bán hàng".
 * NVBH không thấy đơn đã huỷ ở danh sách nào (đơn hàng, chi tiết khách…).
 */
export const anDonHuy = <T extends { status: string }>(rows: T[], laNvbh: boolean): T[] =>
  laNvbh ? rows.filter((r) => r.status !== "cancelled") : rows
