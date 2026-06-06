/**
 * Danh sách phường/xã (theo đơn vị hành chính 2025) sử dụng ở Hải Phòng.
 * Dùng cho dropdown phường khi nhập địa chỉ khách hàng.
 *
 * Khi mở rộng sang tỉnh thành khác: tạo thêm file/list tương tự rồi
 * merge ở UI (vd theo selected province).
 */

export const WARDS_HAI_PHONG = [
  "Hồng Bàng",
  "Hồng An",
  "Ngô Quyền",
  "Gia Viên",
  "Lê Chân",
  "An Biên",
  "Hải An",
  "Đông Hải",
  "Kiến An",
  "Phù Liễn",
  "Hưng Đạo",
  "Dương Kinh",
  "Đồ Sơn",
  "Nam Đồ Sơn",
  "An Dương",
  "An Hải",
  "An Phong",
  "Thủy Nguyên",
  "Thiên Hương",
  "Hòa Bình",
  "Nam Triệu",
  "Bạch Đằng",
  "Lưu Kiếm",
  "Lê Ích Mộc",
  "Việt Khê",
  "Kiến Thụy",
  "Kiến Minh",
  "Kiến Hải",
  "Kiến Hưng",
  "Nghi Dương",
  "An Hưng",
  "An Khánh",
  "An Quang",
  "An Trường",
  "An Lão",
  "Vĩnh Bảo",
  "Nguyễn Bỉnh Khiêm",
  "Vĩnh Am",
  "Vĩnh Hải",
  "Vĩnh Hòa",
  "Vĩnh Thịnh",
  "Vĩnh Thuận",
  "Quyết Thắng",
  "Tiên Lãng",
  "Tân Minh",
  "Tiên Minh",
  "Chấn Hưng",
  "Hùng Thắng",
  "Cát Hải",
  "Cát Bà",
] as const

export type WardHaiPhong = (typeof WARDS_HAI_PHONG)[number]
