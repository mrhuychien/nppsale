"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { nhoNen, coLoi } from "@/lib/cache/nho-nen"
import type { SearchSelectOption } from "@/components/ui/search-select"

export interface HangNhe {
  id: string
  sku: string | null
  name: string | null
  barcode: string | null
  status: string | null
}

const dangBan = (p: HangNhe) => !p.status || p.status === "active"

/**
 * Mục của ô lọc sản phẩm: tên hàng, dòng phụ mã hàng (+ "ngừng bán"), tìm được theo mã / mã vạch. Hàng đang bán xếp
 * trước theo tên, hàng ngừng bán xuống cuối — chứng từ cũ vẫn lọc được theo hàng đã ngừng.
 */
export function mucHangLoc(ds: readonly HangNhe[]): SearchSelectOption[] {
  const theoTen = (a: HangNhe, b: HangNhe) => (a.name ?? "").localeCompare(b.name ?? "", "vi")
  const xep = [...ds.filter(dangBan).sort(theoTen), ...ds.filter((p) => !dangBan(p)).sort(theoTen)]
  return xep.map((p) => ({
    id: p.id,
    label: p.name || p.sku || "—",
    hint: [p.sku, dangBan(p) ? null : "ngừng bán"].filter(Boolean).join(" · ") || null,
    keywords: [p.sku, p.barcode].filter(Boolean).join(" ") || null,
  }))
}

/** Câu dưới ô khi không có mục nào để hiện — đang tải / tải hỏng / không khớp là ba chuyện khác nhau. */
export function cauTrongHangLoc(s: { dangTai: boolean; loi: string | null }): string {
  if (s.dangTai) return "Đang tải danh mục hàng…"
  if (s.loi) return "Không tải được danh mục hàng — bấm ra ngoài rồi chạm lại ô để thử lại."
  return "Không tìm thấy mặt hàng nào khớp."
}

/**
 * DANH MỤC HÀNG CHO Ô LỌC "SẢN PHẨM" của các danh sách chứng từ — CHỈ TẢI KHI CẦN (`can`: người dùng chạm vào ô, hoặc
 * đang lọc theo một mặt hàng). Như `useKhachLoc`: mở danh sách không kéo cả danh mục hàng về cho một ô chưa ai bấm
 * (chủ nhà 23/10/2026 "load trang chậm lắm"); nhớ 5 phút trong phiên (`nhoNen`), đổi người là xoá (`xoaNhoTheoNguoi`).
 * ⚠ KÉO ĐỦ THEO TRANG, phân trang theo `id` — `.select()` trơn cắt ở 1.000 dòng: mặt hàng thứ 1.001 không lọc được mà
 *   ô im lặng như thể không có. NVBH chỉ thấy hàng công ty mình làm (RLS mig 081) — đúng phạm vi chứng từ họ xem được.
 * ⚠ Tải hỏng thì NÓI RA (`loi`) và không nhớ — `thuLai` (ô gọi khi được chạm lại) đọc lại.
 */
export function useHangLoc(can: boolean): {
  options: SearchSelectOption[]
  dangTai: boolean
  loi: string | null
  thuLai: () => void
} {
  const [ds, setDs] = useState<HangNhe[] | null>(null)
  const [dangTai, setDangTai] = useState(false)
  const [loi, setLoi] = useState<string | null>(null)
  /** Lần thử — tăng là đọc lại sau một lần hỏng. */
  const [lan, setLan] = useState(0)

  useEffect(() => {
    if (!can || ds) return
    let huy = false
    setDangTai(true)
    ;(async () => {
      const res = await nhoNen(
        "nen:hang-nhe",
        () =>
          fetchAllForAggregate<HangNhe>((from, to) =>
            createClient().from("products").select("id, sku, name, barcode, status", { count: "exact" }).order("id").range(from, to)
          ),
        coLoi
      )
      if (huy) return
      setDangTai(false)
      if (res.error) {
        console.error("[hang-loc] tải danh mục hàng lỗi:", res.error)
        setLoi(res.error)
        return
      }
      setLoi(null)
      setDs(res.rows)
    })()
    return () => {
      huy = true
    }
  }, [can, ds, lan])

  const options = useMemo(() => mucHangLoc(ds ?? []), [ds])
  const thuLai = useCallback(() => setLan((n) => n + 1), [])
  return { options, dangTai, loi, thuLai }
}
