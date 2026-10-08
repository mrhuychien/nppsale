import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * MÃ CŨ CỦA PHIẾU TRẢ NCC (mig 240) — chủ nhà 08/10/2026: "Đổi đầu PTNCC", chọn "Đánh lại cả phiếu cũ".
 * Phiếu cũ mang mã theo giờ TH-YYMMDD-HHMMSS được đánh lại PTNCC-xxxx; mã cũ giữ ở `supplier_returns.return_code_cu`
 * để còn tra được số trên giấy đã đưa NCC.
 *
 * ⚠ ĐỌC RIÊNG, KHÔNG NHÉT VÀO CÂU LỚN. Mã nguồn hay lên trước migration: thêm `return_code_cu` vào câu `select` chính
 *   mà sổ chưa chạy 240 là CẢ màn trắng (42703). Đọc riêng thì thiếu cột chỉ mất mã cũ, màn vẫn chạy.
 */
export async function docMaCuTraNcc(
  supabase: SupabaseClient,
  ids: readonly string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ds = Array.from(new Set(ids.filter(Boolean)))
  for (let i = 0; i < ds.length; i += 200) {
    const { data, error } = await supabase.from("supplier_returns").select("id, return_code_cu").in("id", ds.slice(i, i + 200))
    if (error) return out
    for (const r of (data ?? []) as Array<{ id: string; return_code_cu: string | null }>) {
      if (r.return_code_cu) out.set(r.id, r.return_code_cu)
    }
  }
  return out
}
