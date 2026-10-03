/**
 * DÒNG "+ TẠO MỚI" CUỐI DANH SÁCH XỔ — luật chung của `SearchSelect` và `ProductPicker`.
 *
 * Chủ nhà 03/10/2026 (Update 3.10, mục 1): "list search nào cũng đáp ứng: tìm, danh sách, không có trong danh
 * sách có nút tạo mới ở cuối. Khi bấm tạo -> sang tạo mới có trường đang search đó luôn".
 *
 * Để ở đây (không trong component) để chốt CHẠY được luật bàn phím thay vì đọc mã.
 */

/** Cấu hình dòng tạo mới mà nơi gọi truyền vào ô tìm. `onTao` nhận chữ đang gõ (đã trim). */
export interface TaoMoiCauHinh {
  /** VD "Tạo khách hàng mới". */
  nhan: string
  onTao: (chu: string) => void
}

/** Chữ của dòng: `Tạo khách hàng mới “Cô Ba”` — có chữ đang gõ thì kèm trong ngoặc kép. */
export function nhanTaoMoi(nhan: string, chu: string): string {
  const t = chu.trim()
  return t ? `${nhan} “${t}”` : nhan
}

/** Con trỏ bàn phím đi được tới đâu: dòng tạo mới đứng ngay sau kết quả cuối (vị trí `soKetQua`). */
export function conTroToiDa(soKetQua: number, coTaoMoi: boolean): number {
  return coTaoMoi ? soKetQua : Math.max(0, soKetQua - 1)
}

/**
 * Dòng tạo mới có đang được chọn (Enter = tạo) không.
 *
 * ⚠ Ô CHO GÕ TỰ DO (NCC ở phiếu nhập kho) mà không có kết quả nào: Enter vẫn là "dùng chữ gõ tay" như trước —
 *   con trỏ chỉ sang dòng tạo mới khi người dùng BẤM MŨI TÊN XUỐNG (`daBamXuong`). Không có điều kiện này thì
 *   thêm `taoMoi` vào ô ấy là đổi lặng lẽ hành vi Enter mà người nhập kho đã quen.
 */
export function dongTaoDangChon(o: {
  coTaoMoi: boolean
  active: number
  soKetQua: number
  choGoTay: boolean
  chu: string
  daBamXuong: boolean
}): boolean {
  if (!o.coTaoMoi || o.active !== o.soKetQua) return false
  if (o.soKetQua === 0 && o.choGoTay && o.chu.trim() && !o.daBamXuong) return false
  return true
}
