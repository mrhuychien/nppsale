/**
 * CHẾ ĐỘ CHỌN HÀNG ở /sell: chọn nhiều mã (mặc định) hay chọn TỪNG mã.
 *
 * ⚠ CHỦ NHÀ 25/09/2026: "thêm 1 nút icon option chọn từng mã … khi người dùng chọn
 *   thì người dùng phải tắt đi mới tắt chứ k tự tắt (lưu trạng thái)".
 *   Chọn từng mã: bấm thêm một mã MỚI là sang thẳng màn Đơn hàng.
 *   Chủ nhà 25/09/2026: "Thêm cả cho phần chọn hàng trả" — chọn hàng trả thì
 *   thêm một mã mới là về thẳng phiếu trả.
 *
 * ⚠ HAI CÔNG TẮC RIÊNG (bán / trả): chọn nhiều khi bán mà chọn từng mã khi nhận
 *   hàng trả là thói quen hợp lý — dùng chung là bật bên này tắt luôn bên kia.
 *
 * ⚠ LƯU TRÊN MÁY (localStorage) — là thói quen của người cầm máy, không phải dữ
 *   liệu sổ. Trình duyệt chặn bộ nhớ thì coi như chọn nhiều, không làm hỏng màn.
 */

export type LoaiChon = "ban" | "tra"
export const KHOA_CHON_TUNG_MA = "npp.sell.chon-tung-ma"
export const khoaChonTungMa = (loai: LoaiChon = "ban") => (loai === "tra" ? `${KHOA_CHON_TUNG_MA}.tra` : KHOA_CHON_TUNG_MA)

export function docChonTungMa(loai: LoaiChon = "ban", store: Pick<Storage, "getItem"> | null = khoLuu()): boolean {
  try {
    return store?.getItem(khoaChonTungMa(loai)) === "1"
  } catch {
    return false
  }
}

export function ghiChonTungMa(
  bat: boolean,
  loai: LoaiChon = "ban",
  store: Pick<Storage, "setItem" | "removeItem"> | null = khoLuu()
): void {
  try {
    if (bat) store?.setItem(khoaChonTungMa(loai), "1")
    else store?.removeItem(khoaChonTungMa(loai))
  } catch {
    /* bộ nhớ bị chặn — chế độ chỉ sống tới khi rời màn */
  }
}

/** Thêm dòng MỚI ở chế độ chọn từng mã thì rời màn (bán → Đơn hàng, trả → phiếu trả). */
export function roiManSauKhiThem(o: { chonTungMa: boolean; delta: number; dongMoi: boolean }): boolean {
  return o.chonTungMa && o.delta > 0 && o.dongMoi
}

function khoLuu(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}
