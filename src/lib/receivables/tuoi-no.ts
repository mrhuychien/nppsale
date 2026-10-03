/**
 * LỌC TUỔI NỢ TRÊN MÁY CHỦ — chip "Trong hạn / Cảnh báo / Quá hạn / Khẩn cấp" ở màn Công nợ (điện thoại).
 *
 * ⚠ VÌ SAO (rà soát 03/10/2026): bản cũ tải 20 khoản / trang rồi mới lọc theo tuổi nợ TRONG 20 khoản ấy
 *   (`receivables.filter(getAgingStatus…)`) — chọn "Khẩn cấp" mà trang đầu toàn khoản trong hạn thì danh sách
 *   trống, dù sổ có hàng chục khoản khẩn cấp; tổng số và "Tải thêm" cũng sai theo. Nay đổi nhóm tuổi nợ ra
 *   KHOẢNG `due_date` rồi lọc ngay trong truy vấn.
 *
 * ⚠ NGƯỠNG PHẢI KHỚP `getAgingStatus` (src/lib/utils.ts) VÀ SQL `receivables_summary` (mig 195):
 *   số ngày quá hạn = hôm nay (giờ VN) − hạn;  ≤0 (hoặc không có hạn) → current; 1–30 → warning;
 *   31–60 → overdue; >60 → critical. Nhóm tuổi nợ chỉ tính khoản CHƯA THU XONG (`status <> 'paid'`) —
 *   cùng tập với ô đếm của `receivables_summary`.
 */
export type NhomTuoiNo = "current" | "warning" | "overdue" | "critical"

export const NHOM_TUOI_NO: readonly NhomTuoiNo[] = ["current", "warning", "overdue", "critical"]

/** Cộng / trừ ngày trên khoá ngày `YYYY-MM-DD` (theo lịch, không theo múi giờ máy). */
export function congNgay(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export interface KhoangHan {
  /** due_date >= tu */
  tu?: string
  /** due_date <= den */
  den?: string
  /** Khoản không đặt hạn cũng thuộc nhóm (chỉ "Trong hạn"). */
  kemKhongHan?: boolean
}

/** Nhóm tuổi nợ → khoảng `due_date`. `homNay` = ngày giờ VN (`vnDateKey(new Date())`). */
export function khoangHanTuoiNo(nhom: NhomTuoiNo, homNay: string): KhoangHan {
  switch (nhom) {
    case "current": return { tu: homNay, kemKhongHan: true }
    case "warning": return { tu: congNgay(homNay, -30), den: congNgay(homNay, -1) }
    case "overdue": return { tu: congNgay(homNay, -60), den: congNgay(homNay, -31) }
    case "critical": return { den: congNgay(homNay, -61) }
  }
}

/** Dạng tối thiểu của truy vấn Supabase mà bộ lọc cần (để kiểm được bằng đối tượng giả). */
interface CoLoc<Q> {
  neq(cot: string, v: string): Q
  gte(cot: string, v: string): Q
  lte(cot: string, v: string): Q
  or(f: string): Q
}

/** Gắn bộ lọc tuổi nợ vào truy vấn `receivables`. `nhom` null = không lọc. */
export function locTuoiNo<Q extends CoLoc<Q>>(q: Q, nhom: NhomTuoiNo | null, homNay: string): Q {
  if (!nhom) return q
  const k = khoangHanTuoiNo(nhom, homNay)
  let r = q.neq("status", "paid")
  if (k.kemKhongHan) r = r.or(`due_date.is.null,due_date.gte.${k.tu}`)
  else {
    if (k.tu) r = r.gte("due_date", k.tu)
    if (k.den) r = r.lte("due_date", k.den)
  }
  return r
}

export function laNhomTuoiNo(v: string | null | undefined): v is NhomTuoiNo {
  return !!v && (NHOM_TUOI_NO as readonly string[]).includes(v)
}
