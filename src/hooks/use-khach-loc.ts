"use client"

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { nhoNen, coLoi } from "@/lib/cache/nho-nen"
import type { SearchSelectOption } from "@/components/ui/search-select"
import type { Customer } from "@/types"

type KhachNhe = Pick<Customer, "id" | "store_name" | "owner_name" | "phone">

/** Mục của ô lọc khách: tên cửa hàng, dòng phụ chủ quán · SĐT, tìm được cả theo chủ quán / SĐT. */
export function mucKhachLoc(ds: readonly KhachNhe[]): SearchSelectOption[] {
  return ds.map((c) => ({
    id: c.id,
    label: c.store_name,
    hint: [c.owner_name, c.phone].filter(Boolean).join(" · ") || null,
    keywords: [c.owner_name, c.phone].filter(Boolean).join(" "),
  }))
}

/** Câu dưới ô khi không có mục nào để hiện — đang tải / tải hỏng / không khớp là ba chuyện khác nhau. */
export function cauTrongKhachLoc(s: { dangTai: boolean; loi: string | null }): string {
  if (s.dangTai) return "Đang tải danh sách khách…"
  if (s.loi) return "Không tải được danh sách khách — đóng rồi mở lại khung lọc để thử lại."
  return "Không tìm thấy khách nào khớp."
}

/**
 * DANH SÁCH KHÁCH CHO Ô LỌC "KHÁCH HÀNG" của danh sách đơn / hoá đơn — CHỈ TẢI KHI Ô ẤY HIỆN (`can`).
 *
 * ⚠ CHỦ NHÀ 23/10/2026 "load trang chậm lắm" → "Làm nốt". Bản cũ kéo cả sổ khách (theo trang, hàng nghìn dòng) ở MỌI
 *   lần mở danh sách trên máy tính, cho một ô chỉ nằm trong khung "Lọc nhanh" (phải bấm mới mở). Nay: mở khung / tấm
 *   lọc mới tải, nhớ 5 phút trong phiên (`nhoNen`) như cũ — mở lại là có ngay.
 * ⚠ KÉO ĐỦ THEO TRANG, phân trang theo `id` (mốc duy nhất) — `.select()` trơn cắt ở 1.000 dòng: khách thứ 1.001 trở đi
 *   không lọc được mà ô im lặng như thể họ không có đơn nào.
 * ⚠ Tải hỏng thì NÓI RA (`loi`) và không nhớ — đóng mở lại là thử lại; đừng để ô báo "không tìm thấy khách nào".
 */
export function useKhachLoc(can: boolean): { options: SearchSelectOption[]; dangTai: boolean; loi: string | null } {
  const [ds, setDs] = useState<KhachNhe[] | null>(null)
  const [dangTai, setDangTai] = useState(false)
  const [loi, setLoi] = useState<string | null>(null)

  useEffect(() => {
    if (!can || ds) return
    let huy = false
    setDangTai(true)
    ;(async () => {
      const res = await nhoNen(
        "nen:khach-nhe",
        () =>
          fetchAllForAggregate<KhachNhe>((from, to) =>
            createClient().from("customers").select("id, store_name, owner_name, phone", { count: "exact" }).order("id").range(from, to)
          ),
        coLoi
      )
      if (huy) return
      setDangTai(false)
      if (res.error) {
        console.error("[khach-loc] tải danh sách khách lỗi:", res.error)
        setLoi(res.error)
        return
      }
      setLoi(null)
      setDs(res.rows.slice().sort((a, b) => (a.store_name ?? "").localeCompare(b.store_name ?? "")))
    })()
    return () => {
      huy = true
    }
  }, [can, ds])

  const options = useMemo(() => mucKhachLoc(ds ?? []), [ds])
  return { options, dangTai, loi }
}
