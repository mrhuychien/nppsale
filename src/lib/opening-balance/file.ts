import { columnsFor, mapHeaderRow, type Kind } from "./schema"
import type { SourceRow } from "./parse"

/**
 * Đọc file Excel / CSV thành các dòng thô.
 *
 * Nạp `xlsx` bằng import động — thư viện này đã có sẵn trong dự án (các
 * màn báo cáo dùng để xuất file) và nặng, không đáng nhét vào gói khởi
 * động của người chẳng bao giờ nhập file.
 */
export type ReadResult = {
  rows: SourceRow[]
  /** Cột nào không dò thấy trong file. */
  missing: string[]
  /** Tổng số dòng dữ liệu đọc được (kể cả dòng rỗng đã loại). */
  total: number
}

export async function readWorkbook(file: File, kind: Kind): Promise<ReadResult> {
  const XLSX = await import("xlsx")
  const buf = await file.arrayBuffer()
  // cellDates: ô ngày trả về Date thay vì số sê-ri của Excel. Không bật
  // thì hạn thanh toán về dạng 45658 và không cách nào đọc đúng.
  const wb = XLSX.read(buf, { type: "array", cellDates: true })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return { rows: [], missing: ["không có sheet nào"], total: 0 }

  // header: 1 → mảng-của-mảng, giữ nguyên vị trí ô trống thay vì bỏ qua.
  // defval: null → ô trống thành null chứ không biến mất, nhờ đó chỉ số
  // cột không bị lệch khi giữa bảng có ô rỗng.
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, blankrows: false })
  if (!aoa.length) return { rows: [], missing: ["file rỗng"], total: 0 }

  const idx = mapHeaderRow(aoa[0] as unknown[], kind)
  const cols = columnsFor(kind)
  const missing = cols.filter((c) => !(c.key in idx)).map((c) => c.header)

  const at = (row: unknown[], key: string) =>
    key in idx ? row[idx[key]] : undefined

  const rows: SourceRow[] = []
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] as unknown[]
    if (!row || row.every((c) => c === null || String(c ?? "").trim() === "")) continue
    rows.push({
      // +1 vì mảng đếm từ 0, và dòng 1 của Excel là tiêu đề.
      rowNo: i + 1,
      id: at(row, "id"),
      name: at(row, "name"),
      altKey: at(row, "altKey"),
      amount: at(row, "amount"),
      dueDate: at(row, "dueDate"),
      note: at(row, "note"),
    })
  }
  return { rows, missing, total: rows.length }
}
