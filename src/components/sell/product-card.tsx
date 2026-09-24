"use client"

import { memo } from "react"
import { Plus } from "lucide-react"
import { cn, formatCurrency, formatInt } from "@/lib/utils"
import { sellableUnits, stockInUnit, unitPriceFor, type PricedProduct } from "@/lib/sell/pricing"
import { stockDisplayFor } from "@/lib/sell/committed"

/**
 * Thẻ sản phẩm trên màn bán hàng — theo bản thiết kế "2a Thêm hàng" / "1a Chọn
 * hàng trả" (chủ nhà 24/09/2026, docs/design/sell-mobile-v2.html).
 *
 * ⚠ THÊM NGAY TRÊN THẺ, KHÔNG RỜI MÀN. Nút "+" thêm 1 đơn vị đang chọn; đã có
 *   thì hiện bộ − số + nền xanh. Trước đây chạm thẻ là nhảy sang giỏ (và có
 *   chế độ "chọn nhiều" riêng để gõ số cho nhiều món) — bộ tăng giảm trên thẻ
 *   làm cả hai việc ấy trong một cách, nên chế độ riêng không còn.
 * ⚠ THẺ KHÔNG PHẢI NÚT. Cả thẻ bấm được là mỗi lần chạm nhầm lúc cuộn thêm một
 *   món; nay chỉ nút thêm / bộ tăng giảm / pill đơn vị nhận chạm.
 * ⚠ THẺ ĐƯỢC `memo`, callback nhận sản phẩm làm tham số — màn truyền hàm ổn
 *   định, 60 thẻ không vẽ lại mỗi phím gõ ở ô tìm.
 */
export interface ProductCardProps {
  product: PricedProduct
  /** Tồn kho theo đơn vị CƠ SỞ. */
  baseOnHand: number
  /** Hàng đã hứa trong Phiếu tạm khác (đơn vị cơ sở); `null` = chưa đọc được. */
  baseCommitted?: number | null
  groupId: string | null | undefined
  unit: string
  onPickUnit: (productId: string, unit: string) => void
  /** +1 / −1 ở ĐÚNG đơn vị đang chọn; về 0 là bỏ dòng. */
  onStep: (product: PricedProduct, unit: string, delta: number) => void
  /** Số đang có trong giỏ / phiếu trả ở đơn vị này. */
  qty: number
  /** Màn HÀNG TRẢ tắt: "Hết hàng" ở đó là câu trả lời cho câu hỏi không ai hỏi. */
  showStock?: boolean
  /** Chữ trên nút thêm — màn hàng trả là "Trả"; rỗng = chỉ dấu +. */
  addLabel?: string
}

export const ProductCard = memo(function ProductCard({
  product,
  baseOnHand,
  baseCommitted = null,
  groupId,
  unit,
  onPickUnit,
  onStep,
  qty,
  showStock = true,
  addLabel = "",
}: ProductCardProps) {
  const units = sellableUnits(product)
  const price = unitPriceFor(product, unit, groupId)
  const stock = stockInUnit(product, unit, baseOnHand)
  /* ⚠ Quy đổi số đã đặt bằng ĐÚNG phép quy đổi của tồn. */
  const committedUnit = baseCommitted === null ? null : stockInUnit(product, unit, baseCommitted)
  const sd = stockDisplayFor(stock, committedUnit)
  const co = qty > 0
  const image = product.images?.[0]

  return (
    <div
      data-testid="the-san-pham"
      data-chon={co ? "" : undefined}
      className={cn(
        "flex flex-col gap-2.5 rounded-[14px] border-[1.5px] bg-surface-container-lowest p-3",
        /* ⚠ Thẻ ngoài màn hình không dựng bố cục — 60 thẻ ~7.000px. */
        "[content-visibility:auto] [contain-intrinsic-size:auto_112px]",
        co ? "border-primary" : "border-transparent"
      )}
    >
      <div className="flex items-start gap-3">
        {/* ⚠ Ảnh chỉ khi CÓ — danh mục gần như chưa có ảnh, ô giữ chỗ là phí bề ngang. */}
        {image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="h-12 w-12 shrink-0 rounded-[10px] object-cover" loading="lazy" decoding="async" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <p className="line-clamp-2 text-[14px] font-semibold leading-[1.35] text-on-surface">{product.name}</p>
          <p className="text-[12px] text-muted-foreground">
            {product.sku}
            {showStock && (
              <>
                {" · "}
                {/* ⚠ "ĐÃ ĐẶT HẾT" KHÁC "HẾT HÀNG"; chưa đọc được hàng đã đặt thì nói ra. */}
                <span
                  className={cn(
                    sd.out ? "font-semibold text-error" : sd.available < 20 ? "font-semibold text-[#8a5a00]" : ""
                  )}
                >
                  {sd.reservedOut
                    ? `Đã đặt hết (tồn ${formatInt(stock)} ${unit})`
                    : sd.out
                      ? "Hết hàng"
                      : `Còn ${formatInt(sd.committed === null ? stock : sd.available)} ${unit}`}
                </span>
                {/* Phần đã hứa trong Phiếu tạm khác — một cụm "Còn …" (2a), kèm số đã đặt khi có. */}
                {!sd.reservedOut && sd.committed !== null && sd.committed > 0 && (
                  <span className="text-[#8a5a00]"> (đã đặt {formatInt(sd.committed)})</span>
                )}
                {sd.committed === null && <span> · chưa rõ hàng đã đặt</span>}
              </>
            )}
          </p>
        </div>
        <div className="whitespace-nowrap text-right">
          {/* ⚠ Giá 0 là CHƯA CÓ GIÁ, không phải miễn phí. */}
          <p className="text-[15px] font-bold tabular-data text-on-surface">
            {price > 0 ? formatCurrency(price) : "chưa có giá"}
          </p>
          <p className="text-[11px] text-muted-foreground">/ {unit}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Pill đơn vị — co được và cuộn ngang khi mặt hàng có ba đơn vị. */}
        <div className="flex min-w-0 gap-0.5 overflow-x-auto rounded-[10px] bg-surface-container-low p-[3px]">
          {units.map((u) => {
            const active = u === unit
            return (
              <button
                key={u}
                type="button"
                aria-pressed={active}
                onClick={() => onPickUnit(product.id, u)}
                className={cn(
                  "h-[30px] shrink-0 rounded-lg px-3 text-[13px]",
                  active ? "bg-surface-container-lowest font-semibold text-primary shadow-[0_1px_2px_rgba(0,0,0,.1)]" : "font-medium text-on-surface-variant"
                )}
              >
                {u}
              </button>
            )
          })}
        </div>
        <div className="flex-1" />
        {co ? (
          <div className="flex h-9 shrink-0 items-center rounded-[10px] bg-primary text-primary-foreground [&>button]:active:bg-black/10">
            <button
              type="button"
              aria-label={`Bớt ${product.name}`}
              onClick={() => onStep(product, unit, -1)}
              className="h-9 w-9 text-[18px]"
            >
              −
            </button>
            <span aria-label={`Số lượng ${product.name}`} className="min-w-6 text-center text-[14px] font-bold tabular-data">
              {qty}
            </span>
            <button
              type="button"
              aria-label={`Thêm ${product.name}`}
              onClick={() => onStep(product, unit, 1)}
              className="h-9 w-9 text-[18px]"
            >
              +
            </button>
          </div>
        ) : (
          <button
            type="button"
            aria-label={`${addLabel || "Thêm"} ${product.name}`}
            onClick={() => onStep(product, unit, 1)}
            className={cn(
              "flex h-9 shrink-0 items-center justify-center gap-1 rounded-[10px] border-[1.5px] border-primary bg-surface-container-lowest text-[13px] font-semibold text-primary active:scale-95",
              addLabel ? "px-3.5" : "w-10"
            )}
          >
            <Plus className={addLabel ? "h-3.5 w-3.5" : "h-4 w-4"} strokeWidth={2.6} aria-hidden />
            {addLabel}
          </button>
        )}
      </div>
    </div>
  )
})
