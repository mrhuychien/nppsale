/**
 * CHẾ ĐỘ CHỌN HÀNG ở /sell: chọn TỪNG mã (mặc định) hay chọn nhiều mã (tuỳ chọn).
 *
 * ⚠ CHỦ NHÀ 25/09/2026, theo thứ tự:
 *   · "thêm 1 nút icon option chọn từng mã … người dùng phải tắt đi mới tắt chứ
 *     k tự tắt (lưu trạng thái)"; "Thêm cả cho phần chọn hàng trả".
 *   · "Đảo ngược: chế độ chọn từng sản phẩm một là mặc định, chế độ chọn nhiều
 *     sản phẩm là option".
 *   Chọn từng mã: thêm một mã MỚI là rời màn (bán → Đơn hàng, trả → phiếu trả).
 *   Chọn nhiều: ở lại màn, thêm tiếp.
 *
 * ⚠ HAI CÔNG TẮC RIÊNG (bán / trả) — bật bên này không bật bên kia.
 * ⚠ KHOÁ MỚI `npp.sell.chon-nhieu` (không dùng lại `…chon-tung-ma`): khoá cũ lưu
 *   "đã bật chọn từng mã", nghĩa ngược với công tắc bây giờ — đọc lại là máy nào
 *   đã bật chọn từng mã sẽ bị lật sang chọn nhiều.
 * ⚠ LƯU TRÊN MÁY (localStorage). Bộ nhớ bị chặn thì về mặc định: chọn từng mã.
 */

export type LoaiChon = "ban" | "tra"
export const KHOA_CHON_NHIEU = "npp.sell.chon-nhieu"
export const khoaChonNhieu = (loai: LoaiChon = "ban") => (loai === "tra" ? `${KHOA_CHON_NHIEU}.tra` : KHOA_CHON_NHIEU)

export function docChonNhieu(loai: LoaiChon = "ban", store: Pick<Storage, "getItem"> | null = khoLuu()): boolean {
  try {
    return store?.getItem(khoaChonNhieu(loai)) === "1"
  } catch {
    return false
  }
}

export function ghiChonNhieu(
  bat: boolean,
  loai: LoaiChon = "ban",
  store: Pick<Storage, "setItem" | "removeItem"> | null = khoLuu()
): void {
  try {
    if (bat) store?.setItem(khoaChonNhieu(loai), "1")
    else store?.removeItem(khoaChonNhieu(loai))
  } catch {
    /* bộ nhớ bị chặn — chế độ chỉ sống tới khi rời màn */
  }
}

/** Thêm dòng MỚI khi đang chọn TỪNG mã thì rời màn (bán → Đơn hàng, trả → phiếu trả). */
export function roiManSauKhiThem(o: { chonNhieu: boolean; delta: number; dongMoi: boolean }): boolean {
  return !o.chonNhieu && o.delta > 0 && o.dongMoi
}

function khoLuu(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}
