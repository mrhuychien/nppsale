/**
 * Ô SỐ LƯỢNG GÕ ĐƯỢC — chủ nhà 09/11/2026 (phiếu trả hàng trên điện thoại): "phần số lượng dùng bàn phím numpad và gõ được,
 * ngoài việc +/-". Luật thuần của `OSoLuong` (`src/components/ui/o-so-luong.tsx`).
 *
 * ⚠ CHỮ ĐANG GÕ ≠ SỐ ĐÃ CHỐT. Bản cũ buộc ô hiện `String(qty)` và bỏ qua mọi chữ không ra số > 0: xoá "3" để gõ "12" là ô tự
 *   hiện lại "3" — không gõ được. Nay ô giữ chữ đang gõ (kể cả trống, "0", "1."); số chỉ đẩy lên khi dùng được (> 0).
 */

/** Chữ vừa gõ → chữ giữ trên ô + số đẩy lên (`null` = chưa thành số dùng được: trống, 0, chỉ dấu chấm). */
export function docSoLuongGo(raw: string, thapPhan = true): { chu: string; so: number | null } {
  let chu = raw.replace(/,/g, ".").replace(thapPhan ? /[^\d.]/g : /\D/g, "")
  if (thapPhan) {
    const cham = chu.indexOf(".")
    if (cham >= 0) chu = chu.slice(0, cham + 1) + chu.slice(cham + 1).replace(/\./g, "")
  }
  if (chu === "" || chu === ".") return { chu, so: null }
  const so = Number(chu)
  return { chu, so: Number.isFinite(so) && so > 0 ? so : null }
}
