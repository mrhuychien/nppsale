"use client"

import { useState } from "react"
import { SearchSelect } from "@/components/ui/search-select"
import { cauTrongHangLoc, useHangLoc } from "@/hooks/use-hang-loc"
import { spDangLoc } from "@/lib/list/loc-san-pham"
import { cn } from "@/lib/utils"

/**
 * Ô LỌC "SẢN PHẨM" của các danh sách chứng từ (chủ nhà 15/11/2026) — gõ tên / mã / mã vạch để chọn MỘT mặt hàng; ✕ là
 * về "tất cả". Luật lọc ở `@/lib/list/loc-san-pham`. Danh mục hàng chỉ tải khi ô được chạm (hoặc đang lọc sẵn một mặt
 * hàng) — `useHangLoc`.
 */
export function LocSanPham({
  value,
  onChange,
  id,
  className,
}: {
  /** Mã mặt hàng đang lọc; "" / "all" = không lọc. */
  value: string
  onChange: (productId: string | null) => void
  id?: string
  className?: string
}) {
  const [cham, setCham] = useState(false)
  const sp = spDangLoc(value)
  const hang = useHangLoc(cham || !!sp)
  const chamO = () => {
    if (!cham) setCham(true)
    else if (hang.loi) hang.thuLai()
  }
  return (
    <div className={cn("min-w-0", className)} data-loc-san-pham onPointerDownCapture={chamO} onFocusCapture={chamO}>
      <SearchSelect
        id={id}
        options={hang.options}
        valueId={sp ?? ""}
        onPick={(o) => onChange(o?.id ?? null)}
        placeholder="Tất cả sản phẩm — gõ để lọc…"
        emptyHint={cauTrongHangLoc(hang)}
      />
    </div>
  )
}
