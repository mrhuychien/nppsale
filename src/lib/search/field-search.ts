/**
 * TÌM THEO TỪNG TRƯỜNG trong danh sách chứng từ — ô tìm theo mẫu chủ nhà
 * gửi 23/09/2026: một ô tìm, bấm nút lọc bên phải thì xổ ra các ô "Theo mã
 * chứng từ", "Theo mã, tên hàng", "Theo mã, tên, SĐT khách hàng"…
 *
 * ⚠ CÁC TRƯỜNG ĐƯỢC GHÉP BẰNG "VÀ". Gõ "sữa" ở ô hàng và "Minh" ở ô khách
 *   là đơn CÓ sữa CỦA khách Minh — không phải đơn có sữa HOẶC của Minh.
 *   Mỗi trường là MỘT `.or(...)` riêng; PostgREST ghép các `or=` bằng AND.
 *
 * ⚠ TRA THEO CHUỖI BẢNG. "Theo mã, tên hàng" không có cột trên đầu phiếu:
 *   tra `products` ra mã hàng → tra bảng dòng (`sales_order_lines`…) ra mã
 *   phiếu → `id.in.(…)`. Mỗi bước giữ trần `MATCH_CAP` như ô tìm cũ, và vượt
 *   trần thì `truncated` để màn nói "kết quả đang thiếu", không im lặng.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { idsMatching, ilikeDk, MATCH_CAP, NO_MATCH, type IdMatch } from "@/lib/search/list-search"

/** Một bước tra: bước đầu tìm chữ trong `cotTim`; các bước sau lọc `theoCot` trong mã của bước trước. */
export interface BuocTra {
  bang: string
  /** Chỉ bước ĐẦU: các cột tìm chữ (ilike). */
  cotTim?: string[]
  /** Các bước SAU: cột lọc theo mã của bước trước. */
  theoCot?: string
  /** Cột lấy ra làm mã cho bước sau. */
  layCot: string
  /** Bước đầu có lọc `org_id` không (bảng dòng không có cột này — RLS lo). */
  coOrg?: boolean
}

export interface TruongTim {
  key: string
  /** "Theo mã, tên hàng" */
  nhan: string
  /** Chữ mờ trong ô. */
  goiY?: string
  /** Cột CỦA CHÍNH bảng danh sách để tìm chữ (vd `order_code`). */
  cotRieng?: string[]
  /** Chuỗi tra ra mã, rồi so với `cotDich` của bảng danh sách. */
  chuoi?: { buoc: BuocTra[]; cotDich: string }[]
}

/** Không khớp gì — một điều kiện không dòng nào thoả. */
export const KHONG_DONG_NAO = "id.eq.00000000-0000-0000-0000-000000000000"

const TRAN_DONG = 1000

/** Tra một chuỗi bảng ra danh sách mã ở bước cuối. */
export async function maTheoChuoi(
  sb: SupabaseClient,
  buoc: BuocTra[],
  term: string,
  orgId: string | null | undefined
): Promise<IdMatch> {
  const t = term.trim()
  if (!t || buoc.length === 0) return NO_MATCH
  const [dau, ...sau] = buoc
  let m = await idsMatching(sb, dau.bang, dau.cotTim ?? [], t, dau.coOrg ? orgId : null, dau.layCot)
  let thieu = m.truncated
  for (const b of sau) {
    if (m.ids.length === 0) return { ids: [], truncated: thieu }
    const { data, error } = await sb
      .from(b.bang)
      .select(b.layCot)
      .in(b.theoCot as string, m.ids)
      .order(b.layCot)
      .limit(TRAN_DONG)
    if (error) {
      console.error(`[field-search] tra ${b.bang} lỗi:`, error.message)
      return { ids: [], truncated: true }
    }
    const rows = ((data as unknown) as Array<Record<string, string | null>>) ?? []
    const ids = Array.from(new Set(rows.map((r) => r[b.layCot]).filter(Boolean) as string[]))
    if (rows.length >= TRAN_DONG || ids.length > MATCH_CAP) thieu = true
    m = { ids: ids.slice(0, MATCH_CAP), truncated: thieu }
  }
  return m
}

/**
 * Điều kiện `or` của MỘT trường. Trả `KHONG_DONG_NAO` khi trường có chữ mà
 * không khớp gì — bỏ qua điều kiện là trả về CẢ danh sách cho một câu tìm
 * không ra gì, đúng kiểu nói dối "không lọc được thì thôi".
 */
export function dieuKienTruong(truong: TruongTim, term: string, khop: IdMatch[]): string | null {
  const t = term.trim()
  if (!t) return null
  const phan = (truong.cotRieng ?? []).map((c) => ilikeDk(c, t))
  ;(truong.chuoi ?? []).forEach((c, i) => {
    const m = khop[i] ?? NO_MATCH
    if (m.ids.length > 0) phan.push(`${c.cotDich}.in.(${m.ids.join(",")})`)
  })
  return phan.length > 0 ? phan.join(",") : KHONG_DONG_NAO
}

/** Số trường đang có chữ — để nút lọc hiện huy hiệu. */
export function soTruongDangTim(values: Record<string, string>): number {
  return Object.values(values).filter((v) => v.trim()).length
}

/**
 * ⚠ NGÂN SÁCH MÃ CHUNG CHO MỌI TRƯỜNG. Mỗi trường được tới `MATCH_CAP`
 *   mã thì hai trường cùng chạm trần là 300+ uuid (~11 KB) trong MỖI câu
 *   danh sách / đếm / cộng tiền — đường dẫn quá dài, cổng API trả lỗi và
 *   danh sách rỗng (xem chú thích `ID_MOI_LO`). Chia chung một ngân sách;
 *   bị cắt thì `truncated` để màn nói "kết quả đang thiếu".
 */
export function chiaNganSach(
  khop: Record<string, IdMatch[]>,
  thuTu: readonly string[],
  tong: number = MATCH_CAP
): Record<string, IdMatch[]> {
  let con = tong
  const out: Record<string, IdMatch[]> = {}
  for (const k of thuTu) {
    const ms = khop[k]
    if (!ms) continue
    out[k] = ms.map((m) => {
      const lay = m.ids.slice(0, Math.max(0, con))
      con -= lay.length
      return { ids: lay, truncated: m.truncated || lay.length < m.ids.length }
    })
  }
  return out
}
