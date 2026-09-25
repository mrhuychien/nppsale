import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * SỐ PHIẾU TRẢ TH-xxxx (mig 193) — chủ nhà 25/09/2026: "Phiếu trả có đánh số TH-".
 *
 * ⚠ ĐỌC RIÊNG, KHÔNG NHÉT VÀO CÂU LỚN. Mã nguồn hay lên trước migration: thêm cột
 *   `return_code` vào câu `select` chính là sổ chưa chạy 193 thì CẢ màn trắng. Đọc
 *   riêng thì thiếu cột chỉ mất số, màn vẫn chạy (hiện "Phiếu trả").
 */
export async function docMaPhieuTra(
  supabase: SupabaseClient,
  ids: readonly string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ds = Array.from(new Set(ids.filter(Boolean)))
  for (let i = 0; i < ds.length; i += 200) {
    const { data, error } = await supabase.from("returns").select("id, return_code").in("id", ds.slice(i, i + 200))
    if (error) return out
    for (const r of (data ?? []) as Array<{ id: string; return_code: string | null }>) {
      if (r.return_code) out.set(r.id, r.return_code)
    }
  }
  return out
}

/** Nhãn một phiếu trả: số TH- nếu có, không thì "Phiếu trả". */
export const tenPhieuTra = (code: string | null | undefined): string => code || "Phiếu trả"
