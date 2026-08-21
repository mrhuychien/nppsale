/**
 * Tải ĐỦ dữ liệu để tính tổng, kể cả khi Supabase giới hạn số dòng mỗi lần.
 *
 * VẤN ĐỀ
 * Vài trang tổng hợp (Công nợ, Công nợ theo NV/khách/NCC, Mua hàng, Tổng
 * quan, Báo cáo) tính tổng bằng cách tải dữ liệu về trình duyệt rồi cộng
 * bằng JavaScript. Supabase có cấu hình `db.max_rows` — dự án này đang để
 * **1.000** — đặt trần số dòng cho MỖI request. Khi vượt trần, API trả
 * **200 kèm đúng 1.000 dòng, KHÔNG có lỗi nào**. Trang vẫn hiện một con số
 * trông hoàn toàn bình thường, chỉ là nó thiếu. Với công nợ, đó là sai tiền
 * mà không có gì để lần ra.
 *
 * VÌ SAO CÁCH "XIN DƯ 1 DÒNG" KHÔNG DÙNG ĐƯỢC
 * Ý tưởng đầu tiên là xin `trần + 1` dòng rồi xem có nhận dư không. Cách đó
 * chỉ đúng khi trần của ta THẤP HƠN trần của server. Ở đây ngược lại: xin
 * 20.001 dòng thì server vẫn chỉ trả 1.000, không bao giờ vượt, nên cờ cảnh
 * báo không bao giờ bật. Cảnh báo im lặng còn tệ hơn không có cảnh báo.
 *
 * CÁCH LÀM HIỆN TẠI
 * Dùng `count: "exact"`. Header `Content-Range` của PostgREST trả về TỔNG SỐ
 * DÒNG KHỚP ĐIỀU KIỆN — con số này KHÔNG bị `db.max_rows` cắt. Nhờ vậy:
 *
 *   1. Gọi lần đầu → biết `count` thật và biết server cho tối đa bao nhiêu
 *      dòng một lần (chính là số dòng nhận được).
 *   2. Còn thiếu bao nhiêu thì chia trang, gọi SONG SONG phần còn lại.
 *   3. Ghép lại → tổng cộng ra ĐÚNG, không phụ thuộc `db.max_rows`.
 *
 * Vẫn giữ trần `AGGREGATE_ROW_CAP` để một trang không thể tự bắn 500 request
 * khi bảng phình to; chạm trần thì `truncated = true` và giao diện phải báo.
 *
 * ĐÂY VẪN CHƯA PHẢI CÁCH ĐÚNG NHẤT. Cộng ở phía database (view hoặc RPC trả
 * sẵn tổng) vừa chính xác tuyệt đối vừa chỉ tốn một request. Xem BAN_GIAO.md
 * mục 5.1c. Lớp này lo phần "số phải đúng ngay bây giờ".
 */

/**
 * Trần tổng số dòng cho một lần tải-để-cộng.
 *
 * Với `db.max_rows = 1000`, đây là tối đa 20 request song song — chấp nhận
 * được. Nếu bảng vượt mức này thì đã đến lúc chuyển sang cộng ở database
 * chứ không phải nâng con số này lên.
 */
export const AGGREGATE_ROW_CAP = 20000

export interface AggregateResult<T> {
  rows: T[]
  /** true = chạm trần AGGREGATE_ROW_CAP, con số cộng ra THIẾU. Phải báo. */
  truncated: boolean
  error: string | null
  /** Tổng số dòng khớp điều kiện theo database (không bị `max_rows` cắt). */
  total: number
}

/**
 * Kiểu trả về của một trang.
 *
 * `data` để `unknown` chứ không phải `T[]`: Supabase suy kiểu rất chặt cho
 * `select("a, b")` (chỉ đúng các cột đã chọn) và cho join lồng (suy thành
 * mảng), nên ràng `T[]` ở đây sẽ bắt mọi nơi gọi phải ép kiểu trong lời gọi
 * — rối và dễ sai. Ép một lần ở đây, giống cách phần còn lại của dự án đang
 * làm với kết quả Supabase.
 */
interface PageResponse {
  data: unknown
  error: { message: string } | null
  count?: number | null
}

/**
 * `build(from, to)` phải trả về query đã gắn `.select(..., { count: "exact" })`
 * và `.range(from, to)`. Ví dụ:
 *
 *   fetchAllForAggregate<Row>((from, to) =>
 *     supabase
 *       .from("receivables")
 *       .select("amount, paid", { count: "exact" })
 *       .neq("status", "paid")
 *       .range(from, to)
 *   )
 *
 * Bắt buộc phải có `count: "exact"` — không có nó thì không biết còn thiếu
 * bao nhiêu dòng, và hàm này quay về đúng cái bẫy đang cần tránh.
 */
export async function fetchAllForAggregate<T>(
  build: (from: number, to: number) => PromiseLike<PageResponse>,
  cap: number = AGGREGATE_ROW_CAP
): Promise<AggregateResult<T>> {
  const first = await build(0, cap - 1)
  if (first.error) {
    return { rows: [], truncated: false, error: first.error.message, total: 0 }
  }

  const firstRows = (first.data as T[] | null) || []
  const total = first.count ?? firstRows.length

  // Đã đủ ngay lần đầu (bảng nhỏ, hoặc server không đặt trần).
  if (firstRows.length >= total) {
    return { rows: firstRows, truncated: false, error: null, total }
  }

  // Số dòng nhận được ở lần đầu CHÍNH LÀ trần mỗi trang của server.
  const pageSize = firstRows.length
  if (pageSize <= 0) {
    // Không có dòng nào nhưng count > 0: bất thường (RLS chặn, hoặc cấu hình
    // lạ). Dừng lại thay vì lặp vô hạn, và nói rõ là số đang thiếu.
    return { rows: [], truncated: true, error: null, total }
  }

  const wanted = Math.min(total, cap)
  const ranges: Array<[number, number]> = []
  for (let from = pageSize; from < wanted; from += pageSize) {
    ranges.push([from, Math.min(from + pageSize, wanted) - 1])
  }

  const pages = await Promise.all(ranges.map(([from, to]) => build(from, to)))
  const failed = pages.find((p) => p.error)
  if (failed?.error) {
    return { rows: [], truncated: false, error: failed.error.message, total }
  }

  const rows = firstRows.concat(...pages.map((p) => (p.data as T[] | null) || []))
  return {
    rows: rows.slice(0, cap),
    // Chỉ THIẾU khi database có nhiều hơn mức ta cho phép tải về.
    truncated: total > cap,
    error: null,
    total,
  }
}

/** Câu cảnh báo dùng chung, để mọi trang nói cùng một giọng. */
export function truncationWarning(cap: number = AGGREGATE_ROW_CAP): string {
  return `Dữ liệu vượt ${cap.toLocaleString("vi-VN")} dòng nên số tổng đang THIẾU. Hãy lọc hẹp lại (theo thời gian hoặc trạng thái) để có số đúng.`
}
