/**
 * NHỚ DANH MỤC NỀN TRONG PHIÊN (chủ nhà 27/09/2026 — log Supabase vượt gói miễn phí).
 *
 * Các danh sách (đơn hàng, hoá đơn, khách…) mỗi lần mở lại đọc lại cùng những danh mục nền cho ô
 * lọc: khách (tên / SĐT), nhân viên bán, tuyến. Mỗi lượt là một dòng log API ở Supabase. Nhớ
 * `NHO_NEN_MS`; hai màn hỏi cùng lúc thì chung một lượt. Đọc hỏng thì KHÔNG nhớ (lần sau đọc lại).
 */
export const NHO_NEN_MS = 5 * 60_000

const bo = new Map<string, { luc: number; p: Promise<unknown> }>()

/** `loi(kq)` trả true khi kết quả là lỗi — lỗi thì bỏ khỏi bộ nhớ. */
export function nhoNen<T>(khoa: string, doc: () => PromiseLike<T>, loi: (kq: T) => boolean = () => false, now = Date.now()): Promise<T> {
  const c = bo.get(khoa)
  if (c && now - c.luc < NHO_NEN_MS) return c.p as Promise<T>
  const p = Promise.resolve(doc()).then((kq) => {
    if (loi(kq) && bo.get(khoa)?.p === p) bo.delete(khoa)
    return kq
  })
  p.catch(() => bo.get(khoa)?.p === p && bo.delete(khoa))
  bo.set(khoa, { luc: now, p })
  return p
}

/** Xoá nhớ (vd sau khi thêm khách / nhân viên / tuyến). Không truyền khoá = xoá hết. */
export function xoaNhoNen(tienTo?: string): void {
  if (!tienTo) return bo.clear()
  for (const k of Array.from(bo.keys())) if (k.startsWith(tienTo)) bo.delete(k)
}

/** Kết quả supabase `{ error }` hoặc `{ error }` của fetchAllForAggregate. */
export const coLoi = (kq: { error?: unknown }) => !!kq?.error
