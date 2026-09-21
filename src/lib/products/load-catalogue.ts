/**
 * NẠP CẢ DANH MỤC HÀNG CHO Ô TÌM — không chỉ 1.000 mã đầu.
 *
 * ⚠ CHỦ NHÀ BÁO 21/09/2026: "Sao đề xuất đặt hàng lại ra toàn Sản phẩm
 * đã xóa là sao?". Nguyên nhân: màn ấy đọc `products` bằng một
 * `.select()` trơn. PostgREST CẮT Ở 1.000 DÒNG, nên với danh mục 1.700
 * mã thì 700 mã cuối không có trong bộ nhớ — và mọi dòng đơn trỏ tới
 * chúng bị gán nhãn "Sản phẩm đã xoá".
 *
 * ⚠ VÀ CÙNG CÂU `.select()` TRƠN ẤY NẰM Ở SÁU MÀN PHIẾU KHÁC. Ở đó nó
 * không hiện ra thành một nhãn sai — nó hiện ra thành KHÔNG HIỆN GÌ
 * CẢ: người nhập gõ đúng tên một mặt hàng có thật, ô tìm im lặng trả về
 * rỗng, và họ kết luận danh mục thiếu mã rồi đi tạo một mã trùng. Cùng
 * một lỗi, nhưng ở dạng khó thấy hơn.
 *
 * ⚠ VÌ SAO KHÔNG CHỈ THÊM `.limit(5000)`. Giới hạn cứng chỉ đẩy cái
 * ngưỡng đi xa hơn rồi im lặng cắt ở chỗ mới. `fetchAllForAggregate`
 * kéo hết theo trang VÀ trả về cờ `truncated` để màn hình nói được là
 * dữ liệu chưa đủ.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"

export interface CatalogueResult<T> {
  rows: T[]
  /** Đọc chưa hết — màn hình phải nói ra, đừng im. */
  truncated: boolean
}

/**
 * @param select Danh sách cột, đúng như từng màn cần.
 *
 * ⚠ PHÂN TRANG THEO `id`, SẮP XẾP THEO TÊN SAU. Mốc chia trang phải
 * DUY NHẤT — `.order("name")` là hai mặt hàng trùng tên làm các trang
 * lặp/sót nhau. Người dùng vẫn thấy danh sách theo tên vì ta sắp lại
 * trong bộ nhớ sau khi đã kéo đủ.
 */
export async function loadCatalogue<T extends { name?: string | null }>(
  supabase: SupabaseClient,
  select: string,
  /**
   * ⚠ HAI MÀN LỌC HAI KIỂU, CỐ Ý. Màn mua hàng lọc theo `org_id`; màn
   * nhập kho lọc `status = 'active'` và để RLS lo phần đơn vị. Ép
   * chung một kiểu là đổi phạm vi dữ liệu của một màn mà không ai yêu
   * cầu.
   */
  opts: { orgId?: string | null; activeOnly?: boolean } = {}
): Promise<CatalogueResult<T>> {
  const res = await fetchAllForAggregate<T>((from, to) => {
    let q = supabase
      .from("products")
      .select(select, { count: "exact" })
      .order("id")
      .range(from, to)
    if (opts.orgId) q = q.eq("org_id", opts.orgId)
    if (opts.activeOnly) q = q.eq("status", "active")
    return q
  })
  const rows = res.rows.slice().sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
  /**
   * ⚠ ĐỌC HỎNG CŨNG LÀ ĐỌC THIẾU. `fetchAllForAggregate` trả
   * `truncated: false` khi câu truy vấn LỖI — nó đặt `error` và trả
   * mảng rỗng. Bản đầu của hàm này bỏ qua `error` và chỉ chuyển tiếp
   * `truncated`, nên một lần đọc hỏng ra đúng hình dạng của "danh mục
   * trống": không dòng nào, không cờ nào, không một câu nào. Đó CHÍNH
   * LÀ cái mặt mà lỗi 21/09/2026 hiện ra với người dùng — gõ đúng tên
   * hàng, ô tìm im lặng trả về rỗng.
   *
   * ⚠ VÀ NHỚ RẰNG RLS TỪ CHỐI KHÔNG PHẢI LÀ LỖI: 0 dòng, HTTP 200,
   * `error` null. Ca ấy KHÔNG gắn cờ ở đây được — nó là "bạn không
   * được xem gì", và màn hình phải tự nói bằng trạng thái rỗng của nó.
   */
  return { rows, truncated: res.truncated || res.error !== null }
}
