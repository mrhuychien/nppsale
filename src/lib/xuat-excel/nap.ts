/**
 * ĐỌC DỮ LIỆU CHO NÚT "XUẤT EXCEL" CỦA DANH SÁCH CHỨNG TỪ (chủ nhà 05/10/2026). Xem `./phieu.ts`.
 *
 * ⚠ ĐỌC ĐỦ HOẶC NÉM. Dòng đọc theo lô id (`docTheoLoId` — `.in()` dài là chạm trần URL của cổng API), lỗi thì
 *   ném để nút báo "không xuất được", KHÔNG ra một tệp thiếu dòng trông y như tệp đủ.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { docTheoLoId } from "@/lib/supabase/aggregate"
import type { NguonDong } from "./cac-man"

/** Mọi dòng của các phiếu `ids` — bảng / cột khoá ngoài / câu chọn khai ở `cac-man.ts` (`DONG_*`). */
export function napDong<T>(supabase: SupabaseClient, nguon: NguonDong, ids: readonly string[]): Promise<T[]> {
  if (ids.length === 0) return Promise.resolve([])
  return docTheoLoId<T>(
    ids,
    (lo, from, to) =>
      supabase
        .from(nguon.bang)
        .select(nguon.chon, { count: "exact" })
        .in(nguon.cot, lo)
        /* ⚠ Khoá duy nhất — các trang đọc song song không được lặp / sót dòng. */
        .order("id")
        .range(from, to),
    nguon.ten
  )
}

/** Tên người theo id (người lập phiếu) — bảng chưa nhúng được `users` thì đọc riêng một lượt. */
export async function napTenNguoi(supabase: SupabaseClient, ids: ReadonlyArray<string | null | undefined>): Promise<Map<string, string>> {
  const can = Array.from(new Set(ids.filter((x): x is string => !!x)))
  const out = new Map<string, string>()
  if (can.length === 0) return out
  const rows = await docTheoLoId<{ id: string; full_name: string | null }>(
    can,
    (lo, from, to) => supabase.from("users").select("id, full_name", { count: "exact" }).in("id", lo).order("id").range(from, to),
    "Người lập"
  )
  for (const r of rows) if (r.full_name) out.set(r.id, r.full_name)
  return out
}
