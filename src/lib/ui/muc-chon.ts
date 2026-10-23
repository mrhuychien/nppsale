/**
 * Mục của một ô chọn DÀI (Radix Select: phường/xã, tuyến, nhân viên…) — đóng thì chỉ dựng mục ĐANG CHỌN.
 *
 * ⚠ CHỦ NHÀ 23/10/2026 "load trang chậm lắm". Radix Select dựng sẵn MỌI mục vào một mảnh DOM ẩn ngay cả khi ô đang
 *   đóng (để lấy chữ của mục đang chọn cho ô hiện), và dựng lại theo mỗi lần trang vẽ lại. Màn Khách hàng trên điện thoại
 *   có hai ô Phường/xã (~125 mục mỗi ô) cộng tuyến, nhân viên — đo CPU x4 tốn hàng chục mili giây mỗi lượt vẽ cho thứ
 *   không ai nhìn. Đóng: chỉ mục đang chọn (ô vẫn hiện đúng chữ); mở: đủ mục, cùng lượt vẽ với khung chọn.
 */
export function mucCanDung<T>(ds: readonly T[], dangChon: string, mo: boolean, khoa: (x: T) => string): readonly T[] {
  return mo ? ds : ds.filter((x) => khoa(x) === dangChon)
}
