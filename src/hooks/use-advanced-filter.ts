"use client"

import { useEffect, useMemo, useState } from "react"
import { menhDeLoc, soDieuKienDangAp, type DieuKienLoc, type TruongLoc } from "@/lib/search/advanced-filter"

/**
 * Điều kiện lọc nâng cao ĐÃ ÁP của một danh sách — nhớ theo từng màn trên máy
 * người dùng (localStorage, như `useListViewPrefs`). Chỉ là tiện ích cá nhân:
 * đọc hỏng thì về rỗng, danh sách vẫn chạy.
 *
 * `key` đổi mỗi khi tập điều kiện đổi — gắn vào deps của lượt tải để tải lại.
 */
export function useAdvancedFilter(viewKey: string, truong: readonly TruongLoc[]) {
  const khoa = `npp.loc-nang-cao.${viewKey}`
  const [dieuKien, setDieuKien] = useState<DieuKienLoc[]>([])
  const [ready, setReady] = useState(false)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(khoa)
      const ds = raw ? (JSON.parse(raw) as DieuKienLoc[]) : []
      /* Trường đã bị gỡ khỏi màn thì bỏ điều kiện ấy, đừng áp một cột lạ. */
      if (Array.isArray(ds)) setDieuKien(ds.filter((d) => truong.some((t) => t.key === d.truong)))
    } catch {
      /* bỏ qua */
    }
    setReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [khoa])
  const apDung = (ds: DieuKienLoc[]) => {
    setDieuKien(ds)
    try {
      localStorage.setItem(khoa, JSON.stringify(ds))
    } catch {
      /* bỏ qua */
    }
  }
  const menhDe = useMemo(() => menhDeLoc(truong, dieuKien), [truong, dieuKien])
  return {
    dieuKien,
    apDung,
    xoa: () => apDung([]),
    /** Mệnh đề `or=` — `for (f of menhDe) q = q.or(f)`. */
    menhDe,
    soDangAp: soDieuKienDangAp(truong, dieuKien),
    ready,
    key: menhDe.join("|"),
  }
}
