"use client"

import { useEffect, useMemo, useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { canTraTron, coTimKd, type IdMatch } from "@/lib/search/list-search"
import { chiaNganSach, dieuKienTruong, maTheoChuoi, type TruongTim } from "@/lib/search/field-search"

export interface FieldSearch {
  /** Mỗi phần tử là MỘT `.or(...)` — nơi gọi áp lần lượt, PostgREST ghép bằng AND. */
  filters: string[]
  /** Đã tra xong cho đúng bộ chữ đang gõ chưa — chưa thì ĐỪNG đọc danh sách. */
  ready: boolean
  /** Một bước tra chạm trần — kết quả có thể thiếu, phải nói ra. */
  truncated: boolean
  /** Khoá ổn định để đặt vào mảng phụ thuộc của effect. */
  key: string
}

/**
 * Tìm theo từng trường — xem `@/lib/search/field-search`.
 *
 * ⚠ `truong` PHẢI ỔN ĐỊNH (hằng ở đầu tệp), không dựng lại mỗi lần vẽ.
 */
export function useFieldSearch(
  sb: SupabaseClient,
  orgId: string | null | undefined,
  truong: readonly TruongTim[],
  values: Record<string, string>
): FieldSearch {
  const key = JSON.stringify(truong.map((t) => [t.key, (values[t.key] ?? "").trim()]))
  const [kq, setKq] = useState<{ key: string; khop: Record<string, IdMatch[]>; timKd: Record<string, boolean> }>({
    key: "", khop: {}, timKd: {},
  })

  useEffect(() => {
    let huy = false
    ;(async () => {
      const khop: Record<string, IdMatch[]> = {}
      const timKd: Record<string, boolean> = {}
      await Promise.all(
        truong.map(async (t) => {
          const v = (values[t.key] ?? "").trim()
          if (!v) return
          timKd[t.key] = t.bang ? await coTimKd(sb, t.bang) : false
          if (!t.chuoi?.length) return
          khop[t.key] = await Promise.all(t.chuoi.map((c) => maTheoChuoi(sb, c.buoc, v, orgId)))
          /* Tra TRỘN — "minh 0123": từ chữ ở bảng tra, từ số ở cột riêng. */
          const chu = canTraTron(v, (t.cotRieng?.length ?? 0) > 0 || timKd[t.key], t.chuoi.length)
          if (chu) khop[`${t.key}#tron`] = await Promise.all(t.chuoi.map((c) => maTheoChuoi(sb, c.buoc, chu, orgId)))
        })
      )
      /* ⚠ KẾT QUẢ Y HỆT THÌ GIỮ NGUYÊN ĐỐI TƯỢNG (log e2e 27/09/2026): `orgId` nạp xong làm hiệu ứng
         chạy lại với cùng ô trống; ghi đối tượng mới là mọi danh sách dùng hook này thấy bộ lọc
         "đổi" và đọc lại cả danh sách + tổng + đếm một lần thừa. */
      if (!huy) setKq((cu) => (cu.key === key && JSON.stringify([cu.khop, cu.timKd]) === JSON.stringify([khop, timKd]) ? cu : { key, khop, timKd }))
    })()
    return () => { huy = true }
  }, [key, orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  const ready = kq.key === key
  return useMemo(() => {
    const khop = chiaNganSach(kq.khop, truong.flatMap((t) => [t.key, `${t.key}#tron`]))
    const filters = truong
      .map((t) => dieuKienTruong(t, values[t.key] ?? "", khop[t.key] ?? [], {
        timKd: kq.timKd[t.key], tron: khop[`${t.key}#tron`],
      }))
      .filter((f): f is string => !!f)
    const truncated = Object.values(khop).some((ms) => ms.some((m) => m.truncated))
    return { filters, ready, truncated, key: ready ? filters.join("|") : "…" }
  }, [kq, ready, key]) // eslint-disable-line react-hooks/exhaustive-deps
}
