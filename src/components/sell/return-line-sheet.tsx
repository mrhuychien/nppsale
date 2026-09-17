"use client"

import { useEffect, useState } from "react"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { cn, formatCurrency } from "@/lib/utils"
import {
  returnCeilingFor,
  returnPriceViolation,
  type ReturnCartLine,
  type ReturnPriceRules,
} from "@/lib/sell/returns"
import { sellableUnits, unitPriceFor, type PricedProduct } from "@/lib/sell/pricing"
import { useViewportInsets, bottomSheetBox } from "@/hooks/use-viewport-insets"
import { Stepper } from "@/components/sell/line-edit-sheet"

/**
 * Sửa một dòng hàng trả / đổi: đơn vị, số lượng, ĐƠN GIÁ, ghi chú.
 *
 * ⚠ VÌ SAO PHẢI SỬA ĐƯỢC GIÁ. Giá của dòng trả lấy theo BẢNG GIÁ HÔM NAY,
 * nhưng hàng khách đưa lại được mua hôm khác, thường là có chiết khấu, và
 * hay là hàng hư hỏng / cận date chỉ bù được một phần. Không sửa được giá
 * thì số tiền trừ vào đơn sai — sai thẳng vào số khách phải trả, và không
 * có đường nào chữa ngoài việc bỏ dòng đó ra.
 *
 * ⚠ LUẬT GIÁ NGƯỢC VỚI DÒNG BÁN. Dòng bán chặn giá THẤP (bán rẻ là mất
 * tiền); dòng trả chặn giá CAO, vì tiền đi RA khỏi công ty. Xem
 * `returnPriceViolation`.
 */
export function ReturnLineSheet({
  line,
  product,
  groupId,
  canEditPrice,
  priceRules,
  onPatch,
  onRemove,
  onClose,
}: {
  line: ReturnCartLine | null
  product: PricedProduct | undefined
  groupId: string | null | undefined
  /**
   * ⚠ DÙNG CHUNG quyền với dòng bán. Ai không được sửa giá bán thì cũng
   * không được sửa giá trả — hai đằng cùng là thẩm quyền về TIỀN, và chặn
   * một bên rồi mở bên kia thì "trả hàng" thành đường vòng.
   */
  canEditPrice: boolean
  /** Biên độ nâng giá — CÙNG con số với giá bán. */
  priceRules: ReturnPriceRules
  onPatch: (patch: Partial<ReturnCartLine>) => void
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
  const bad = returnPriceViolation(line, listPrice, priceRules)
  const ceiling = returnCeilingFor(listPrice, priceRules)

  const hint = !canEditPrice
    ? `Bạn không có quyền sửa giá (giá bảng ${formatCurrency(listPrice)})`
    : bad === "above_ceiling"
      ? `Tối đa ${formatCurrency(ceiling)} (giá bảng ${formatCurrency(listPrice)}${priceRules.maxIncreasePct > 0 ? ` +${priceRules.maxIncreasePct}%` : ""})`
      : bad === "negative"
        ? "Đơn giá không được âm"
        : listPrice <= 0
          ? "Mặt hàng này chưa có giá bảng để đối chiếu"
          : Number.isFinite(ceiling)
            ? `Tối đa ${formatCurrency(ceiling)} · hạ xuống bao nhiêu cũng được`
            : "Hạ hay nâng bao nhiêu cũng được"

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
            {product.sku} · {line.isExchange ? "Đổi hàng" : "Trả tiền"}
          </p>

          <Label>Đơn vị</Label>
          <div className="flex min-w-0 gap-1 overflow-x-auto rounded-[10px] bg-surface-container p-[3px]">
            {units.map((u) => {
              const active = u === line.unit
              return (
                <button
                  key={u}
                  type="button"
                  onClick={() => {
                    // ⚠ Đổi đơn vị là đổi GIÁ. Giữ giá chai cho một thùng
                    // là trả lại khách một phần mười số tiền — con số vẫn
                    // trông hợp lệ nên không ai nghi tới lúc đối soát.
                    onPatch({ unit: u, price: unitPriceFor(product, u, groupId) })
                  }}
                  className={cn(
                    "h-10 min-w-[64px] shrink-0 rounded-lg px-3 text-sm font-bold",
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
              <Stepper qty={line.qty} onChange={(q) => onPatch({ qty: Math.max(1, q) })} />
            </div>
            <div className="min-w-0">
              <Label>Đơn giá trả</Label>
              <input
                value={priceText}
                disabled={!canEditPrice}
                inputMode="numeric"
                aria-label="Đơn giá trả"
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
            className={cn("mt-1.5 text-xs font-bold", bad ? "text-error" : "text-on-surface-variant")}
          >
            {hint}
          </p>

          <Label>Lý do / ghi chú dòng</Label>
          <input
            value={line.note}
            onChange={(e) => onPatch({ note: e.target.value })}
            placeholder="VD: móp thùng, còn 2 tháng date…"
            className="h-11 w-full rounded-xl border-0 bg-surface-container px-3 text-sm font-semibold outline-none"
          />

          <div className="mt-3.5 flex items-center justify-between text-sm font-bold text-on-surface-variant">
            {line.isExchange ? "Đổi hàng · không trừ tiền" : "Trừ vào đơn"}
            <span className="text-xl font-extrabold tabular-data text-on-surface">
              {line.isExchange
                ? "—"
                : `−${formatCurrency(Math.round(line.qty * line.price * (1 + (line.vatRate || 0))))}`}
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
