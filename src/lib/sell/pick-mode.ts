/**
 * CHẾ ĐỘ CHỌN HÀNG ở /sell: chọn nhiều mã (mặc định) hay chọn TỪNG mã.
 *
 * ⚠ CHỦ NHÀ 25/09/2026: "thêm 1 nút icon option chọn từng mã … khi người dùng chọn
 *   thì người dùng phải tắt đi mới tắt chứ k tự tắt (lưu trạng thái)".
 *   Chọn từng mã: bấm thêm một mã MỚI là sang thẳng màn Đơn hàng.
 *
 * ⚠ LƯU TRÊN MÁY (localStorage) — là thói quen của người cầm máy, không phải dữ
 *   liệu sổ. Trình duyệt chặn bộ nhớ thì coi như chọn nhiều, không làm hỏng màn.
 */

export const KHOA_CHON_TUNG_MA = "npp.sell.chon-tung-ma"

export function docChonTungMa(store: Pick<Storage, "getItem"> | null = khoLuu()): boolean {
  try {
    return store?.getItem(KHOA_CHON_TUNG_MA) === "1"
  } catch {
    return false
  }
}

export function ghiChonTungMa(bat: boolean, store: Pick<Storage, "setItem" | "removeItem"> | null = khoLuu()): void {
  try {
    if (bat) store?.setItem(KHOA_CHON_TUNG_MA, "1")
    else store?.removeItem(KHOA_CHON_TUNG_MA)
  } catch {
    /* bộ nhớ bị chặn — chế độ chỉ sống tới khi rời màn */
  }
}

/** Thêm dòng MỚI ở chế độ chọn từng mã thì sang màn Đơn hàng. */
export function sangDonSauKhiThem(o: { chonTungMa: boolean; delta: number; dongMoi: boolean; traHang: boolean }): boolean {
  return o.chonTungMa && !o.traHang && o.delta > 0 && o.dongMoi
}

function khoLuu(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}
