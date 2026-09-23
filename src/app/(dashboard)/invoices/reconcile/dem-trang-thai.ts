/**
 * Đếm snapshot MISA theo từng trạng thái đối soát — số trên các thẻ lọc.
 *
 * ⚠ ĐẾM Ở DATABASE (`count: "exact", head: true`), KHÔNG KÉO DÒNG VỀ ĐỂ
 *   CỘNG. Bản cũ `.select("match_status").limit(5000)` — nhưng PostgREST có
 *   `db.max_rows = 1000`, nên `.limit(5000)` vẫn chỉ nhận 1.000 dòng, im
 *   lặng: các thẻ "Chỉ có trên MISA (N)", "Khớp (N)"… tổng lại không bao
 *   giờ vượt 1.000, và rổ quan trọng nhất có thể hiện 0 khi đang có hàng
 *   trăm hoá đơn ngoài sổ.
 * ⚠ LỖI THÌ NÉM — số đếm hỏng không được hiện thành 0.
 *
 * Tách khỏi `page.tsx` để chốt CHẠY được trên Supabase giả.
 */
export const TRANG_THAI_DOI_SOAT = [
  "matched",
  "amount_diff",
  "misa_only",
  "cancelled",
  "replaced",
  "needs_review",
] as const

type Client = {
  from: (t: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

export async function demTheoTrangThai(sb: Client): Promise<Record<string, number>> {
  const res = await Promise.all(
    TRANG_THAI_DOI_SOAT.map((st) =>
      sb
        .from("misa_invoice_snapshots")
        .select("id", { count: "exact", head: true })
        .eq("match_status", st) as PromiseLike<{ count: number | null; error: { message: string } | null }>
    )
  )
  const out: Record<string, number> = {}
  res.forEach((r, i) => {
    if (r.error) throw new Error(`Đếm trạng thái đối soát: ${r.error.message}`)
    out[TRANG_THAI_DOI_SOAT[i]] = r.count ?? 0
  })
  return out
}
