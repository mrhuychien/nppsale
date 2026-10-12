import { docDuHoacNem } from "@/lib/supabase/aggregate"

/**
 * Các phép đọc của "điểm bán còn thiếu ảnh / vị trí" — dùng chung cho màn
 * danh sách (phiên người dùng, RLS lọc) và cron nhắc nhở (admin client,
 * BỎ QUA RLS nên phải truyền `orgId`). Tách khỏi `page.tsx` để chốt CHẠY
 * được chúng trên một Supabase giả.
 *
 * ⚠ `.limit(CAP)` CŨ KHÔNG CÓ TÁC DỤNG. PostgREST có `db.max_rows = 1000`:
 *   `.limit(2000)`, `.limit(5000)`, `.limit(10000)` đều chỉ nhận 1.000
 *   dòng, 200 OK, không lỗi. Với bảng ảnh thì hậu quả ngược đời nhất: khách
 *   ĐÃ có ảnh bị đếm 0 ảnh → hiện trong danh sách "chưa có ảnh", và cron
 *   gửi lời nhắc sai cho NVBH mỗi thứ Hai.
 * ⚠ LỖI THÌ NÉM (`docDuHoacNem`); nơi gọi phải hiện / báo ra.
 */
type Client = {
  from: (t: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Khách đang hoạt động. `orgId = null` khi đã có RLS lọc hộ. */
export async function docKhachDangBan<T>(sb: Client, cols: string, orgId: string | null) {
  return docDuHoacNem<T>((from, to) => {
    let q = sb.from("customers").select(cols, { count: "exact" }).eq("status", "active")
    if (orgId) q = q.eq("org_id", orgId)
    // Khoá phụ `id`: trùng tên cửa hàng là chuyện thường (trang song song).
    return q.order("store_name").order("id").range(from, to)
  }, "Khách hàng")
}

/**
 * Số ảnh của từng khách.
 *
 * ⚠ `truncated` = bảng ảnh vượt trần → có khách ĐÃ có ảnh mà bị đếm 0.
 *   Nơi gọi KHÔNG được coi "0 ảnh" là thật khi cờ này bật.
 */
export async function demAnhTheoKhach(sb: Client, orgId: string | null, cap?: number) {
  const res = await docDuHoacNem<{ customer_id: string }>(
    (from, to) => {
      let q = sb.from("customer_photos").select("id, customer_id", { count: "exact" })
      if (orgId) q = q.eq("org_id", orgId)
      return q.order("id").range(from, to)
    },
    "Ảnh điểm bán",
    cap
  )
  const counts = new Map<string, number>()
  for (const p of res.rows) counts.set(p.customer_id, (counts.get(p.customer_id) ?? 0) + 1)
  return { counts, truncated: res.truncated }
}

/**
 * Người phụ trách CHÍNH của từng khách thuộc `orgId`.
 *
 * ⚠ `customer_assignments` KHÔNG CÓ `org_id`. Bản cũ trong cron đọc bảng
 *   này bằng admin client KHÔNG lọc gì — tức là phân công của MỌI nhà
 *   phân phối, cắt ở 1.000 dòng tuỳ ý. Lọc qua khách (`customers!inner`)
 *   để chỉ lấy đúng NPP đang chạy.
 */
export async function docPhuTrachChinh(sb: Client, orgId: string) {
  const res = await docDuHoacNem<{ customer_id: string; user_id: string }>(
    (from, to) =>
      sb
        .from("customer_assignments")
        .select("id, customer_id, user_id, customer:customers!inner(org_id)", { count: "exact" })
        .eq("customer.org_id", orgId)
        .eq("role", "primary")
        .eq("status", "active")
        .order("id")
        .range(from, to),
    "Phân công phụ trách"
  )
  const repOf = new Map<string, string>()
  for (const a of res.rows) if (!repOf.has(a.customer_id)) repOf.set(a.customer_id, a.user_id)
  return { repOf, truncated: res.truncated }
}

/**
 * Duyệt ảnh + vị trí (mig 244): điểm bán đang hoạt động ĐÃ duyệt, và số yêu cầu đổi đang chờ của từng điểm bán.
 *
 * ⚠ Máy chủ chưa chạy mig 244 (thiếu cột `photo_approved_at` / bảng `customer_photo_requests`) thì NÉM — nơi gọi
 *   nhận ra bằng `chuaCoDuyetAnh` và ẩn tab "Chờ duyệt", không làm hỏng cả màn.
 */
export async function docDuyetAnh(sb: Client, orgId: string | null) {
  const [kh, yc] = await Promise.all([
    docDuHoacNem<{ id: string }>((from, to) => {
      let q = sb.from("customers").select("id", { count: "exact" }).eq("status", "active").not("photo_approved_at", "is", null)
      if (orgId) q = q.eq("org_id", orgId)
      return q.order("id").range(from, to)
    }, "Điểm bán đã duyệt ảnh"),
    docDuHoacNem<{ customer_id: string }>((from, to) => {
      let q = sb.from("customer_photo_requests").select("id, customer_id", { count: "exact" }).eq("status", "pending")
      if (orgId) q = q.eq("org_id", orgId)
      return q.order("id").range(from, to)
    }, "Yêu cầu đổi ảnh điểm bán"),
  ])
  const approved = new Set(kh.rows.map((r) => r.id))
  const pending = new Map<string, number>()
  for (const r of yc.rows) pending.set(r.customer_id, (pending.get(r.customer_id) ?? 0) + 1)
  return { approved, pending, truncated: kh.truncated || yc.truncated }
}

/**
 * Điểm bán CHỜ DUYỆT: có yêu cầu đổi đang chờ, hoặc chưa duyệt mà đã có ảnh / vị trí để duyệt (chưa có gì thì
 * thuộc "Còn thiếu", không phải "Chờ duyệt").
 */
export function canDuyet<R extends { id: string; photoCount: number; gps_lat: number | null; gps_lng: number | null }>(
  rows: R[],
  duyet: { approved: Set<string>; pending: Map<string, number> }
): R[] {
  return rows.filter(
    (r) =>
      (duyet.pending.get(r.id) ?? 0) > 0 ||
      (!duyet.approved.has(r.id) && (r.photoCount > 0 || (r.gps_lat != null && r.gps_lng != null)))
  )
}
