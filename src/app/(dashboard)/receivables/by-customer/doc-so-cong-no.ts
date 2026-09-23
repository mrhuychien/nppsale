import { docDuHoacNem, docTheoLoId } from "@/lib/supabase/aggregate"

/**
 * Các phép đọc dùng chung của nhóm màn Công nợ (theo khách, theo NV, sổ
 * chi tiết). Tách ra khỏi `page.tsx` để chốt CHẠY được chúng trên một
 * Supabase giả — `page.tsx` của Next.js không được export thêm hàm.
 *
 * ⚠ HAI CÁI BẪY IM LẶNG MÀ CÁC HÀM Ở ĐÂY CHẶN (đợt QA 23/09/2026):
 *   · `db.max_rows = 1000` — đọc trơn (kể cả gọi RPC trả bảng) chỉ nhận
 *     1.000 dòng, 200 OK, không lỗi. Tổng công nợ cộng trên 1.000 khách
 *     đầu trông hoàn toàn bình thường, chỉ là THIẾU.
 *   · `.in("receivable_id", recIds)` với cả nghìn id → URL quá dài → lỗi;
 *     bản cũ `console.error` rồi dùng `[]` → cột "Có" trống, số dư đội lên.
 *
 * ⚠ LỖI THÌ NÉM (theo `docDuHoacNem` / `docTheoLoId`). Nơi gọi bắt lỗi và
 *   HIỆN RA, không được biến nó thành một bảng trống trông như "không nợ".
 */

type Client = {
  from: (t: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args?: object, opts?: { count?: "exact" }) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

/**
 * Mọi dòng của RPC `receivables_by_customer` (mỗi khách đang nợ một dòng).
 *
 * ⚠ RPC TRẢ BẢNG CŨNG BỊ `max_rows` CẮT. Phân trang bằng `count: "exact"`
 *   + `.range()`; thứ tự `remaining` giảm dần GIỮ NGUYÊN như hàm SQL, thêm
 *   `customer_id` (duy nhất trong kết quả vì hàm GROUP BY theo nó) làm khoá
 *   phụ — hai khách cùng số nợ thì các trang song song không lặp / sót.
 */
export async function docCongNoTheoKhach<T>(supabase: Client) {
  return docDuHoacNem<T>(
    (from, to) =>
      supabase
        .rpc("receivables_by_customer", {}, { count: "exact" })
        .order("remaining", { ascending: false })
        .order("customer_id")
        .range(from, to),
    "Công nợ theo khách"
  )
}

/**
 * Mọi lần thu tiền của một danh sách phiếu công nợ.
 *
 * ⚠ CHIA LÔ 150 ID (`docTheoLoId`), mỗi lô phân trang, thứ tự
 *   `collected_at` + `id` duy nhất. Thứ tự hiển thị để nơi gọi tự sắp.
 */
export async function docThanhToanCuaPhieu<T>(supabase: Client, recIds: readonly string[], cols: string) {
  if (recIds.length === 0) return [] as T[]
  return docTheoLoId<T>(
    recIds,
    (lo, from, to) =>
      supabase
        .from("payments")
        .select(cols, { count: "exact" })
        .in("receivable_id", lo)
        .order("collected_at", { ascending: false })
        .order("id")
        .range(from, to),
    "Lần thu tiền"
  )
}
