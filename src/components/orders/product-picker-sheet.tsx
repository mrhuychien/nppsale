"use client"

import * as React from "react"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { Search, ScanBarcode, Plus, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/lib/utils"
import { viMatchAllWords } from "@/lib/search"
import type { Product, PriceList, ProductUnit } from "@/types"

type P = Product & { price_lists?: PriceList[]; units?: ProductUnit[] }

/** Trần số dòng render — danh mục vài nghìn SP thì cuộn mượt hơn tải hết. */
const RENDER_CAP = 60

/**
 * Bộ chọn sản phẩm — bottom sheet gần toàn màn.
 *
 * Dropdown cũ là `absolute` bên trong thẻ: bàn phím ảo đẩy trang lên là
 * kết quả tìm bị che mất, và người dùng gõ mù. Sheet chiếm 88vh nên kết
 * quả luôn nằm trên bàn phím.
 *
 * KHÔNG tự đóng sau mỗi lần chọn: NVBH thường gõ 3–8 mặt hàng một lượt,
 * đóng mở lại từng lần là nhân số chạm lên gấp ba. Chân sheet đếm số dòng
 * đã thêm và có nút "Xong".
 */
export function ProductPickerSheet({
  open,
  onOpenChange,
  products,
  stockByProduct,
  groupId,
  onPick,
  onScan,
  recentIds = [],
  addedIds,
  addedCount = 0,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  products: P[]
  stockByProduct: Record<string, number>
  groupId?: string | null
  /** KHÔNG đóng sheet — cho phép thêm liên tiếp. */
  onPick: (productId: string) => void
  onScan?: () => void
  /** SP khách này hay lấy, đưa lên đầu khi chưa gõ gì. */
  recentIds?: string[]
  /** SP đã có trong đơn — hiện dấu ✓ để khỏi thêm trùng mà không biết. */
  addedIds?: Set<string>
  addedCount?: number
}) {
  const [q, setQ] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!open) return
    const t = setTimeout(() => inputRef.current?.focus(), 80)
    return () => clearTimeout(t)
  }, [open])

  // Đóng sheet thì xoá ô tìm: mở lại mà còn từ khoá cũ là người dùng thấy
  // một danh sách đã lọc và tưởng danh mục chỉ có bấy nhiêu.
  React.useEffect(() => {
    if (!open) setQ("")
  }, [open])

  const list = React.useMemo(() => {
    const term = q.trim()
    if (term) {
      // Chữ ký là (rawQuery, ...values) — query đứng TRƯỚC.
      return products.filter((p) => viMatchAllWords(term, p.name, p.sku)).slice(0, RENDER_CAP)
    }
    if (recentIds.length) {
      const rank = new Map(recentIds.map((id, i) => [id, i]))
      // SP hay lấy lên đầu theo đúng thứ tự tần suất; phần còn lại giữ
      // nguyên thứ tự danh mục.
      return [...products]
        .sort((a, b) => (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999))
        .slice(0, RENDER_CAP)
    }
    return products.slice(0, RENDER_CAP)
  }, [q, products, recentIds])

  const priceOf = (p: P) =>
    p.price_lists?.find(
      (pl) => pl.unit_name === p.base_unit && (pl.group_id === groupId || !pl.group_id)
    )?.price

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex h-[88vh] flex-col p-0">
        <div className="flex items-center gap-2 border-b border-outline-variant p-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tên hoặc mã SKU…"
              inputMode="search"
              enterKeyHint="search"
              aria-label="Tìm sản phẩm"
              className="h-11 w-full rounded-xl border border-outline-variant bg-surface-container-lowest pl-9 pr-3 text-base"
            />
          </div>
          {onScan && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="tap shrink-0"
              onClick={onScan}
              aria-label="Quét mã vạch"
            >
              <ScanBarcode className="h-5 w-5" />
            </Button>
          )}
        </div>

        {!q && recentIds.length > 0 && (
          <p className="px-4 pt-3 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Khách này hay lấy
          </p>
        )}

        <div className="flex-1 overflow-y-auto overscroll-contain">
          {list.length === 0 ? (
            <p className="p-8 text-center text-sm text-on-surface-variant">
              Không tìm thấy sản phẩm
            </p>
          ) : (
            list.map((p) => {
              const price = priceOf(p)
              const stock = stockByProduct[p.id] ?? 0
              const added = addedIds?.has(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onPick(p.id)}
                  className="flex min-h-[60px] w-full items-center gap-3 border-b border-outline-variant/30 px-4 py-3 text-left active:bg-surface-container-low"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-on-surface">{p.name}</p>
                    <p className="text-[12px] text-on-surface-variant">
                      {p.sku} · Tồn{" "}
                      {/* Tồn ≤ 0 tô đỏ ngay ở đây: biết TRƯỚC khi thêm rẻ
                          hơn nhiều so với biết lúc bấm lưu đơn. */}
                      <span className={stock <= 0 ? "font-bold text-error" : ""}>{stock}</span>{" "}
                      {p.base_unit}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[15px] font-bold tabular-data text-primary">
                      {price != null ? formatCurrency(price) : "—"}
                    </p>
                  </div>
                  {added ? (
                    <Check className="h-5 w-5 shrink-0 text-tertiary" aria-label="Đã có trong đơn" />
                  ) : (
                    <Plus className="h-5 w-5 shrink-0 text-on-surface-variant" />
                  )}
                </button>
              )
            })
          )}
        </div>

        {/* Chân sheet: đếm số dòng đã thêm để người dùng biết mình đang ở
            đâu mà không phải đóng sheet ra xem. */}
        <div className="flex items-center gap-3 border-t border-outline-variant p-3 pb-safe">
          <p className="min-w-0 flex-1 text-sm text-on-surface-variant">
            Đơn đang có <span className="font-bold tabular-nums text-on-surface">{addedCount}</span> mặt hàng
          </p>
          <Button type="button" className="h-11 px-6" onClick={() => onOpenChange(false)}>
            Xong
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
