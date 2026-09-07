/**
 * Định nghĩa cột cho file công nợ đầu kỳ.
 *
 * MỘT nguồn sự thật cho CẢ xuất lẫn nhập. Tách ra hai chỗ thì chỉ cần
 * đổi một tiêu đề ở bên xuất là bên nhập không đọc được nữa, mà lỗi đó
 * chỉ lộ ra khi người dùng đã điền xong 500 dòng.
 */

export type Kind = "customer" | "supplier"

export type ColumnDef = {
  /** Tiêu đề in ra file Excel. */
  header: string
  /** Khoá nội bộ. */
  key: string
  /** Mô tả ngắn để hiện trong hướng dẫn trên màn hình. */
  hint: string
}

/**
 * Cột `id` đứng đầu và là khoá khớp CHÍNH.
 *
 * Vì sao không dùng số điện thoại / mã NCC làm khoá chính: người ta sửa
 * số điện thoại khách, và mã NCC thì được phép để trống. `id` là uuid do
 * hệ thống sinh, không ai gõ tay, không đổi. Số điện thoại / mã vẫn giữ
 * làm khoá DỰ PHÒNG cho dòng người dùng tự thêm tay.
 */
export const CUSTOMER_COLUMNS: ColumnDef[] = [
  { key: "id", header: "ID (không sửa)", hint: "Khoá khớp. Xoá đi thì hệ thống dò theo số điện thoại." },
  { key: "name", header: "Tên cửa hàng", hint: "Chỉ để đối chiếu bằng mắt — sửa ở đây không đổi tên khách." },
  { key: "altKey", header: "Điện thoại", hint: "Khoá dự phòng khi thiếu ID." },
  { key: "amount", header: "Công nợ đầu kỳ", hint: "ĐIỀN VÀO ĐÂY. Bỏ trống = không đụng tới. Số 0 = xoá công nợ đầu kỳ." },
  { key: "dueDate", header: "Hạn thanh toán", hint: "Tuỳ chọn. dd/mm/yyyy." },
  { key: "note", header: "Ghi chú", hint: "Tuỳ chọn. VD: chốt sổ 31/12/2025." },
]

export const SUPPLIER_COLUMNS: ColumnDef[] = [
  { key: "id", header: "ID (không sửa)", hint: "Khoá khớp. Xoá đi thì hệ thống dò theo mã NCC." },
  { key: "name", header: "Tên nhà cung cấp", hint: "Chỉ để đối chiếu bằng mắt." },
  { key: "altKey", header: "Mã NCC", hint: "Khoá dự phòng khi thiếu ID." },
  { key: "amount", header: "Công nợ đầu kỳ", hint: "ĐIỀN VÀO ĐÂY. Bỏ trống = không đụng tới. Số 0 = xoá công nợ đầu kỳ." },
  { key: "dueDate", header: "Hạn thanh toán", hint: "Tuỳ chọn. dd/mm/yyyy." },
  { key: "note", header: "Ghi chú", hint: "Tuỳ chọn." },
]

export function columnsFor(kind: Kind): ColumnDef[] {
  return kind === "customer" ? CUSTOMER_COLUMNS : SUPPLIER_COLUMNS
}

/**
 * Chuẩn hoá tiêu đề để dò cột.
 *
 * Người dùng mở Excel rồi đổi thứ tự cột, thêm dấu cách, gõ thiếu dấu —
 * dò theo TÊN đã chuẩn hoá thay vì theo vị trí thì file vẫn nhập được.
 * Bỏ dấu tiếng Việt để "Công nợ đầu kỳ" và "Cong no dau ky" là một.
 */
export function normalizeHeader(h: string): string {
  return h
    // NFD tách "ồ" thành "o" + dấu, để bộ lọc cuối vứt dấu mà GIỮ chữ.
    // Bỏ NFD đi thì "ồ" là một ký tự liền và bị vứt cả — "Công" thành
    // "cng". Không cần dòng xoá dải U+0300-036F riêng: bộ lọc
    // [^a-z0-9] đã làm đúng việc đó (đã đo).
    .normalize("NFD")
    // "đ" thì phải thay tay: nó KHÔNG tách ra dấu khi NFD, nên bộ lọc
    // sẽ vứt nguyên chữ và "đầu kỳ" thành "auky".
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]/g, "")
}

/**
 * Dò chỉ số cột từ hàng tiêu đề. Trả về map khoá → chỉ số, thiếu thì
 * không có khoá đó (nơi gọi tự quyết định cột nào bắt buộc).
 */
export function mapHeaderRow(headerRow: unknown[], kind: Kind): Record<string, number> {
  const cols = columnsFor(kind)
  const out: Record<string, number> = {}
  headerRow.forEach((cell, idx) => {
    const norm = normalizeHeader(String(cell ?? ""))
    if (!norm) return
    const hit = cols.find((c) => normalizeHeader(c.header) === norm)
    // Chỉ nhận cột ĐẦU TIÊN khớp: file có hai cột cùng tên thì lấy cột
    // sau sẽ âm thầm bỏ qua dữ liệu người ta điền ở cột trước.
    if (hit && !(hit.key in out)) out[hit.key] = idx
  })
  return out
}
