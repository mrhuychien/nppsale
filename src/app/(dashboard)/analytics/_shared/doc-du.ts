/**
 * Mấy mảnh dùng chung cho các màn Phân tích — đọc ĐỦ, và đọc hỏng thì NÉM.
 *
 * ⚠ VÌ SAO CÓ TỆP NÀY. Các màn Phân tích từng đọc `customers`/`products`
 *   bằng một `.select()` trơn, rồi `if (error) console.error` và `data || []`.
 *   Hai cái bẫy chồng lên nhau:
 *     1. PostgREST cắt ở 1.000 dòng mà KHÔNG báo lỗi — "Tổng khách hàng"
 *        dừng ở 1.000, doanh thu của khách thứ 1.001 trở đi rơi vào nhãn
 *        "Chưa phân nhóm" / "Không xác định".
 *     2. Đọc hỏng thì ra mảng rỗng — màn hình vẽ một bảng số 0 trông như
 *        thật. Với báo cáo tiền, số sai im lặng tệ hơn không có số.
 *   Đọc qua `docDuHoacNem` (phân trang, ném khi lỗi) và gom lỗi về MỘT
 *   `try/catch` ở `load()` của từng màn.
 */

type DemRes = PromiseLike<{ count: number | null; error: { message: string } | null }>

/**
 * Đếm bằng `count: "exact", head: true` — con số KHÔNG bị `db.max_rows` cắt,
 * và không phải tải dòng nào về.
 *
 * ⚠ LỖI THÌ NÉM. `count ?? 0` khi có lỗi là đúng cái "0 trông như thật".
 */
export async function demHoacNem(q: DemRes, ten: string): Promise<number> {
  const { count, error } = await q
  if (error) throw new Error(`${ten}: ${error.message}`)
  return count ?? 0
}
