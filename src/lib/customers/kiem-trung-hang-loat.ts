/**
 * NHẬP KHÁCH TỪ EXCEL — BƯỚC LỌC TRÙNG SĐT.
 *
 * ⚠ CHỦ NHÀ 03/11/2026: "em rà soát luôn tất cả các chỗ tạo khách hàng đều phải qua bước lọc trùng nhé". Bản cũ của màn
 *   nhập đối chiếu với `customers.phone` đọc thẳng: dưới RLS, NVBH chỉ thấy khách CỦA MÌNH — số của khách NV khác lọt qua
 *   (cả lô 200 dòng hỏng vì UNIQUE, hoặc tệ hơn: "0911.111.111" / "+84 911…" thành khách thứ hai cùng số, vì ràng buộc
 *   UNIQUE(org_id, phone) so NGUYÊN VĂN mà bản cũ chỉ bỏ khoảng trắng). Nay mỗi số ĐỦ hỏi `search_customer_dupes` (mig 245 —
 *   SECURITY DEFINER thấy cả khách NV khác, so bằng chữ số), CÙNG luật màn "Tìm khách hàng đã có"; số lưu chuẩn hoá như
 *   khi tạo tay (`chuanHoaSdt`).
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { chuanHoaSdt, sdtTimChinhXac, type KhachTrung } from "@/lib/customers/tao-khach"

/** Số lệnh hỏi cùng lúc — đủ nhanh cho file vài trăm dòng mà không dồn máy chủ. */
export const DONG_THOI_KIEM_TRUNG = 8

/**
 * Hỏi sổ từng số (đã chuẩn hoá, bỏ trùng, bỏ số chưa đủ) → `Map<số chuẩn, khách đã có>`. Một lượt hỏi hỏng là NÉM —
 * kiểm thiếu một phần thì nhập tiếp sẽ tạo trùng, sai theo hướng nguy hiểm.
 */
export async function kiemTrungSdtHangLoat(
  sb: SupabaseClient,
  sdts: readonly string[],
  opt: { dongThoi?: number; onTienDo?: (xong: number, tong: number) => void } = {}
): Promise<Map<string, KhachTrung>> {
  const so = Array.from(new Set(sdts.map((s) => sdtTimChinhXac(s)).filter(Boolean)))
  const kq = new Map<string, KhachTrung>()
  const dongThoi = Math.max(1, opt.dongThoi ?? DONG_THOI_KIEM_TRUNG)
  let ke = 0
  let xong = 0
  /** Một lượt hỏng → các luồng còn lại thôi hỏi (kết quả đằng nào cũng bỏ). */
  let hong = false
  opt.onTienDo?.(0, so.length)
  const chay = async () => {
    while (ke < so.length && !hong) {
      const d = so[ke++]
      // Hàm chỉ đọc (STABLE) → GET: hết giờ được thử lại một lần (luật `fetchCoHetGio`).
      const { data, error } = await sb.rpc("search_customer_dupes", { p_q: d }, { get: true })
      if (error) {
        hong = true
        throw new Error(`kiểm trùng số ${d}: ${error.message}`)
      }
      const k = ((data as KhachTrung[] | null) ?? []).find((r) => chuanHoaSdt(r.phone ?? "") === d)
      if (k) kq.set(d, k)
      xong += 1
      opt.onTienDo?.(xong, so.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(dongThoi, so.length) }, chay))
  return kq
}

/**
 * Số để GHI của một dòng nhập: một số điện thoại thật ("0911.111.111", "+84 911 111 111") → chữ số chuẩn như khi tạo tay
 * (`chuanHoaSdt`) — để UNIQUE(org_id, phone) bắt được trùng; ô ghi thứ khác (hai số, chữ) thì giữ nguyên văn.
 */
export function sdtDeLuu(raw: string | null | undefined): string {
  const t = String(raw ?? "").trim()
  const d = chuanHoaSdt(t)
  return /^[\d\s.+()-]+$/.test(t) && /^0\d{8,10}$/.test(d) ? d : t
}

/** Khách đã có trùng số của một dòng (số chưa đủ / không có số → `null`: không lọc được theo số). */
export function trungCuaDong(phone: string | null | undefined, trung: ReadonlyMap<string, KhachTrung>): KhachTrung | null {
  const d = sdtTimChinhXac(phone ?? "")
  return d ? trung.get(d) ?? null : null
}
