"use client"

import { useEffect, useState } from "react"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { cn, formatCurrency } from "@/lib/utils"
import { ceilingFor, priceViolation, type CartLine } from "@/lib/sell/cart"
import {
  conversionFor,
  sellableUnits,
  stockInUnit,
  unitPriceFor,
  type PricedProduct,
} from "@/lib/sell/pricing"
import { useViewportInsets, bottomSheetBox } from "@/hooks/use-viewport-insets"

/**
 * Sửa một dòng trong giỏ: đơn vị, số lượng, đơn giá, ghi chú.
 *
 * ⚠ Đổi ĐƠN VỊ là đổi luôn GIÁ. Giữ giá cũ khi chuyển từ chai sang thùng
 * là bán một thùng bằng giá một chai — và con số đó trông vẫn hợp lệ nên
 * không ai nghi ngờ cho tới lúc đối soát.
 */
export function LineEditSheet({
  line,
  product,
  groupId,
  canEditPrice,
  maxIncreasePct,
  baseOnHand,
  onPatch,
  onRemove,
  onClose,
}: {
  line: CartLine | null
  product: PricedProduct | undefined
  groupId: string | null | undefined
  canEditPrice: boolean
  maxIncreasePct: number
  baseOnHand: number
  onPatch: (patch: Partial<CartLine>) => void
  onRemove: () => void
  onClose: () => void
}) {
  const open = !!line && !!product
  const vp = useViewportInsets(open)
  const box = vp ? bottomSheetBox(vp, 0.92) : null

  // Ô giá gõ tay giữ chuỗi riêng: ép về số sau mỗi phím thì xoá hết chữ
  // số là ô tự nhảy về 0 và không gõ lại được.
  const [priceText, setPriceText] = useState("")
  useEffect(() => {
    if (line) setPriceText(String(line.price))
  }, [line])

  if (!line || !product) return null

  const units = sellableUnits(product)
  const listPrice = unitPriceFor(product, line.unit, groupId)
  const ceiling = ceilingFor(listPrice, maxIncreasePct)
  const bad = priceViolation(line, { canEditPrice, maxIncreasePct })
  const stock = stockInUnit(product, line.unit, baseOnHand)

  const hint = !canEditPrice
    ? `Bạn không có quyền sửa giá (giá bảng ${formatCurrency(listPrice)})`
    : bad === "below_list"
      ? `Không được thấp hơn giá bảng ${formatCurrency(listPrice)}`
      : bad === "above_ceiling"
        ? `Tối đa +${maxIncreasePct}% = ${formatCurrency(ceiling)}`
        : `Giá bảng ${formatCurrency(listPrice)} · tối đa ${formatCurrency(ceiling)}`

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="flex flex-col gap-3.5 p-4 pb-6"
        style={box ? { height: box.height, bottom: box.bottom } : undefined}
      >
        <div className="overflow-y-auto">
          <p className="text-base font-extrabold leading-snug">{product.name}</p>
          <p className="mt-0.5 text-xs font-semibold text-on-surface-variant">
            {product.sku} · tồn {stock.toLocaleString("vi-VN")} {line.unit}
          </p>

          <Label>Đơn vị</Label>
          <div className="flex gap-1 rounded-[10px] bg-surface-container p-[3px]">
            {units.map((u) => {
              const active = u === line.unit
              return (
                <button
                  key={u}
                  type="button"
                  onClick={() => {
                    // Xem chú thích đầu file — đổi đơn vị phải đổi cả giá,
                    // cả hệ số quy đổi.
                    const p = unitPriceFor(product, u, groupId)
                    onPatch({ unit: u, price: p, listPrice: p, conversion: conversionFor(product, u) })
                  }}
                  className={cn(
                    "h-10 flex-1 rounded-lg text-sm font-bold",
                    active
                      ? "bg-surface-container-lowest text-primary shadow-sm"
                      : "text-on-surface-variant"
                  )}
                >
                  {u}{" "}
                  <span className="font-semibold opacity-75">
                    · {formatCurrency(unitPriceFor(product, u, groupId))}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="min-w-0">
              <Label>Số lượng</Label>
              <Stepper
                qty={line.qty}
                onChange={(q) => onPatch({ qty: Math.max(1, q) })}
              />
            </div>
            <div className="min-w-0">
              <Label>Đơn giá</Label>
              <input
                value={priceText}
                disabled={!canEditPrice}
                inputMode="numeric"
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "")
                  setPriceText(digits)
                  onPatch({ price: digits === "" ? 0 : parseInt(digits, 10) })
                }}
                className={cn(
                  "h-12 w-full rounded-xl border-[1.5px] px-3 text-right text-lg font-extrabold tabular-data outline-none",
                  bad ? "border-error" : "border-outline-variant",
                  canEditPrice ? "bg-surface-container-lowest" : "bg-surface-container"
                )}
              />
            </div>
          </div>
          <p
            className={cn(
              "mt-1.5 text-xs font-bold",
              bad ? "text-error" : "text-on-surface-variant"
            )}
          >
            {hint}
          </p>

          <Label>Ghi chú dòng</Label>
          <input
            value={line.note}
            onChange={(e) => onPatch({ note: e.target.value })}
            placeholder="VD: lấy date mới, đổi vị cam…"
            className="h-11 w-full rounded-xl border-0 bg-surface-container px-3 text-sm font-semibold outline-none"
          />

          <div className="mt-3.5 flex items-center justify-between text-sm font-bold text-on-surface-variant">
            Thành tiền
            <span className="text-xl font-extrabold tabular-data text-on-surface">
              {formatCurrency(line.qty * line.price)}
            </span>
          </div>
        </div>

        <div className="mt-auto flex gap-2.5">
          <button
            type="button"
            onClick={onRemove}
            className="h-12 rounded-2xl border-[1.5px] border-error/30 px-4 text-sm font-extrabold text-error"
          >
            Xoá dòng
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-12 flex-1 rounded-2xl bg-primary text-[15px] font-extrabold text-on-primary"
          >
            Xong
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 mt-3.5 text-[11px] font-extrabold uppercase tracking-[0.06em] text-on-surface-variant">
      {children}
    </p>
  )
}

/** Bộ − / số / + dùng chung cho giỏ và cho sheet này. */
export function Stepper({
  qty,
  onChange,
  onRemove,
}: {
  qty: number
  onChange: (q: number) => void
  /** Có thì nút − ở số 1 thành nút XOÁ. */
  onRemove?: () => void
}) {
  const atOne = qty <= 1
  return (
    <div className="flex h-12 items-center overflow-hidden rounded-xl border-[1.5px] border-outline-variant">
      <button
        type="button"
        aria-label={atOne && onRemove ? "Xoá dòng" : "Giảm"}
        onClick={() => (atOne && onRemove ? onRemove() : onChange(qty - 1))}
        className={cn(
          "h-12 w-12 shrink-0 text-xl",
          atOne && onRemove ? "text-error" : "text-primary"
        )}
      >
        {atOne && onRemove ? "🗑" : "−"}
      </button>
      <input
        value={qty}
        inputMode="numeric"
        aria-label="Số lượng"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "")
          if (digits === "") return
          onChange(parseInt(digits, 10))
        }}
        className="h-12 w-full min-w-0 flex-1 border-x-[1.5px] border-surface-container bg-surface-container-lowest text-center text-lg font-extrabold outline-none"
      />
      <button
        type="button"
        aria-label="Tăng"
        onClick={() => onChange(qty + 1)}
        className="h-12 w-12 shrink-0 text-xl text-primary"
      >
        +
      </button>
    </div>
  )
}
