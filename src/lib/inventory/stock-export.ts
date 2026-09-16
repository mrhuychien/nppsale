/**
 * Xuất bảng "Tồn kho hiện tại" ra Excel.
 *
 * Hai hàm thuần ở đây dựng nội dung file; phần ghi ra đĩa nằm ở component
 * vì `xlsx` chỉ nạp được trong trình duyệt.
 */

export interface StockExportRow {
  sku: string
  name: string
  baseUnit: string
  saleQty: number
  saleValue: number
  dateQty: number
  dateValue: number
  totalQty: number
  totalValue: number
}

/**
 * Tiêu đề cột. Khớp đúng thứ tự và cách gọi trên màn hình — người ta xuất
 * ra để đối chiếu với cái đang nhìn, nên hai bên phải đọc như nhau.
 */
export const STOCK_EXPORT_HEADERS = [
  "Mã SP",
  "Tên SP",
  "ĐVT",
  "Kho bán — SL",
  "Kho bán — Giá trị",
  "Kho date — SL",
  "Kho date — Giá trị",
  "Tổng SL",
  "Tổng giá trị",
] as const

/** Tên file kèm ngày, để nhiều lần xuất không đè lên nhau trong Downloads. */
export function stockExportFileName(now: Date): string {
  // Ngày theo lịch Việt Nam: xuất lúc 8h tối 15/09 mà file tên 16/09 thì
  // người ta xếp nhầm thư mục.
  const vn = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  return `ton-kho-${vn.toISOString().slice(0, 10).replace(/-/g, "")}.xlsx`
}

/**
 * Dựng mảng hai chiều để ghi ra sheet.
 *
 * ⚠ Số ghi xuống là SỐ, không phải chuỗi đã định dạng. Ghi "434.555.942đ"
 * thì Excel coi là chữ: không cộng được, không lọc được, không vẽ được —
 * mà cộng lại chính là việc người ta mở Excel để làm.
 *
 * ⚠ Có dòng TỔNG CỘNG ở cuối. Người nhận file cần con số tổng khớp với
 * con số trên màn hình để tin là đã xuất đủ; không có nó thì phải tự cộng
 * và tự hỏi mình cộng đúng chưa.
 */
export function buildStockExportAoa(rows: StockExportRow[]): (string | number)[][] {
  const body = rows.map((r) => [
    r.sku,
    r.name,
    r.baseUnit,
    r.saleQty,
    r.saleValue,
    r.dateQty,
    r.dateValue,
    r.totalQty,
    r.totalValue,
  ])
  const sum = (pick: (r: StockExportRow) => number) => rows.reduce((s, r) => s + pick(r), 0)
  const total = [
    "",
    `TỔNG CỘNG (${rows.length} sản phẩm)`,
    "",
    sum((r) => r.saleQty),
    sum((r) => r.saleValue),
    sum((r) => r.dateQty),
    sum((r) => r.dateValue),
    sum((r) => r.totalQty),
    sum((r) => r.totalValue),
  ]
  return [[...STOCK_EXPORT_HEADERS], ...body, total]
}
