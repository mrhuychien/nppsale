import { columnsFor, type Kind } from "./schema"
import type { Entity, ExistingOpening } from "./parse"

/**
 * Dựng nội dung file xuất ra.
 *
 * Xuất ra ĐÚNG bộ cột mà bên nhập đọc vào (cùng lấy từ `columnsFor`), và
 * điền sẵn công nợ đầu kỳ ĐANG CÓ. Nhờ vậy vòng tròn khép kín: xuất →
 * sửa vài ô → nhập lại, những dòng không đụng tới sẽ ra "không đổi" chứ
 * không bị coi là xoá.
 *
 * Số tiền ghi dạng SỐ THẬT, không phải chuỗi có dấu chấm: để Excel canh
 * phải và cộng được, và để lúc nhập lại không phải đoán dấu phân cách.
 */
export function buildExportRows(
  kind: Kind,
  entities: Entity[],
  existing: ExistingOpening[]
): (string | number)[][] {
  const openingBy = new Map(existing.map((e) => [e.entityId, e]))
  const header = columnsFor(kind).map((c) => c.header)
  const body = entities.map((e) => {
    const cur = openingBy.get(e.id)
    return [
      e.id,
      e.label,
      e.altKey,
      // Chưa có công nợ đầu kỳ thì để TRỐNG, không ghi số 0: số 0 mang
      // nghĩa "xoá" ở bên nhập, xuất ra 0 hàng loạt rồi nhập lại là ra
      // một kế hoạch xoá sạch.
      cur ? cur.amount : "",
      cur?.dueDate ? formatVnDate(cur.dueDate) : "",
      cur?.note ?? "",
    ]
  })
  return [header, ...body]
}

/** YYYY-MM-DD → dd/mm/yyyy, đúng quy ước bên nhập đang đọc. */
export function formatVnDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return `${m[3]}/${m[2]}/${m[1]}`
}
