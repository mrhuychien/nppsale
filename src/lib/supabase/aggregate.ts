/**
 * Tải dữ liệu để TÍNH TỔNG phía trình duyệt — có trần và biết khi bị cắt.
 *
 * VẤN ĐỀ ĐANG GIẢI QUYẾT
 * Vài trang tổng hợp (Công nợ, Công nợ theo NV/khách, Công nợ phải trả,
 * Mua hàng, Báo cáo) tải NGUYÊN bảng về rồi cộng bằng JavaScript. Hai rủi
 * ro, và rủi ro thứ hai mới là rủi ro nghiêm trọng:
 *
 *  1. Chậm dần: bảng lớn lên thì trang tải lâu hơn, tốn băng thông.
 *  2. SỐ SAI MÀ KHÔNG BÁO GÌ: PostgREST/Supabase có thể đặt trần số dòng
 *     trả về cho mỗi request (`db.max_rows`, mặc định ở nhiều dự án là
 *     1000). Khi vượt trần, API trả 200 kèm đúng số dòng tối đa — KHÔNG
 *     có lỗi. Trang vẫn hiện một con số trông rất bình thường, chỉ có
 *     điều nó thiếu. Với công nợ, đó là sai tiền.
 *
 * Hàm này ép ta phải đối diện với điều đó: luôn xin đúng `CAP + 1` dòng.
 * Nhận về nhiều hơn CAP nghĩa là dữ liệu ĐÃ bị cắt → trả `truncated: true`
 * để giao diện cảnh báo, thay vì im lặng hiển thị số thiếu.
 *
 * KHÔNG phải giải pháp cuối cùng. Cách đúng về lâu dài là cộng ở phía
 * database (view hoặc RPC trả sẵn tổng) — xem BAN_GIAO.md, mục lộ trình.
 * Hàm này là lớp chặn để số liệu không âm thầm sai trong lúc chờ.
 */

/** Trần số dòng cho một lần tải-để-cộng. Đủ lớn cho vài năm dữ liệu. */
export const AGGREGATE_ROW_CAP = 20000

export interface AggregateResult<T> {
  rows: T[]
  /** true = đã chạm trần, con số cộng ra THIẾU. Phải báo cho người dùng. */
  truncated: boolean
  error: string | null
}

type Queryable<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

/**
 * `build(cap)` phải trả về query đã gắn `.range(0, cap)`.
 * Ví dụ:
 *   fetchForAggregate((cap) =>
 *     supabase.from("receivables").select("amount, paid").neq("status", "paid").range(0, cap)
 *   )
 */
export async function fetchForAggregate<T>(
  build: (cap: number) => Queryable<T>,
  cap: number = AGGREGATE_ROW_CAP
): Promise<AggregateResult<T>> {
  // Xin dư 1 dòng: đó là cách duy nhất phân biệt "vừa đúng CAP dòng" với
  // "còn nữa nhưng bị cắt".
  const { data, error } = await build(cap)
  if (error) return { rows: [], truncated: false, error: error.message }

  const rows = data || []
  if (rows.length > cap) {
    return { rows: rows.slice(0, cap), truncated: true, error: null }
  }
  return { rows, truncated: false, error: null }
}

/**
 * Dạng rời cho các truy vấn nằm trong `Promise.all([...])`, nơi không tiện
 * bọc từng cái bằng `fetchForAggregate`.
 *
 * Dùng cặp với `.range(0, AGGREGATE_ROW_CAP)` trong chính truy vấn đó:
 *   const r = capRows<Order>(ordersRes.data)
 *   if (r.truncated) setTruncated(true)
 */
export function capRows<T>(
  data: unknown,
  cap: number = AGGREGATE_ROW_CAP
): { rows: T[]; truncated: boolean } {
  const rows = (data as T[]) || []
  return rows.length > cap
    ? { rows: rows.slice(0, cap), truncated: true }
    : { rows, truncated: false }
}

/** Câu cảnh báo dùng chung, để mọi trang nói cùng một giọng. */
export function truncationWarning(cap: number = AGGREGATE_ROW_CAP): string {
  return `Chỉ tính trên ${cap.toLocaleString("vi-VN")} dòng đầu — số tổng đang THIẾU. Hãy lọc hẹp lại (theo thời gian hoặc trạng thái) để có số đúng.`
}
