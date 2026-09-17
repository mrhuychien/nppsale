"use client"

import { cn, formatCurrency } from "@/lib/utils"
import { sellableUnits, stockInUnit, unitPriceFor, type PricedProduct } from "@/lib/sell/pricing"

/**
 * Thẻ sản phẩm trên màn bán hàng.
 *
 * MỘT CHẠM = THÊM MỘT. Chạm vào thẻ là thêm 1 đơn vị ĐANG CHỌN vào giỏ —
 * không mở hộp thoại, không hỏi số lượng. NVBH đứng ở quầy khách đọc
 * "hai thùng mì" thì chạm hai lần, nhanh hơn mở hộp thoại rồi gõ số 2.
 *
 * ⚠ Nút đổi đơn vị phải CHẶN sự kiện nổi lên thẻ. Thiếu vế đó thì bấm
 * "thùng" vừa đổi đơn vị vừa thêm luôn một dòng — mỗi lần đổi đơn vị là
 * một dòng rác trong giỏ.
 */
export interface ProductCardProps {
  product: PricedProduct
  /** Tồn kho theo đơn vị CƠ SỞ. */
  baseOnHand: number
  groupId: string | null | undefined
  unit: string
  onPickUnit: (unit: string) => void
  onAdd: () => void
  /** Số lượng đang có trong giỏ ở ĐÚNG đơn vị này. */
  inCartQty: number
}

export function ProductCard({
  product,
  baseOnHand,
  groupId,
  unit,
  onPickUnit,
  onAdd,
  inCartQty,
}: ProductCardProps) {
  const units = sellableUnits(product)
  const price = unitPriceFor(product, unit, groupId)
  const stock = stockInUnit(product, unit, baseOnHand)
  const outOfStock = baseOnHand <= 0
  const image = product.images?.[0]

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onAdd}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onAdd()
        }
      }}
      className={cn(
        "cursor-pointer rounded-2xl border-[1.5px] bg-surface-container-lowest p-3 shadow-card",
        // ⚠ CHƯA CÓ ẢNH THÌ KHÔNG CHỪA CHỖ CHO ẢNH.
        //
        // Bản đầu để một ô xám 56px ghi "ảnh SP" cho mọi mặt hàng chưa có
        // ảnh. Danh mục hiện gần như chưa mặt hàng nào có ảnh, nên cả màn
        // hình thành một cột ô xám giống hệt nhau: chiếm 68px bề ngang của
        // mỗi thẻ, đẩy tên hàng dài xuống thêm một dòng, mà không nói được
        // điều gì. Thẻ không ảnh nay dùng trọn bề ngang.
        image ? "grid grid-cols-[56px_minmax(0,1fr)] gap-3" : "block",
        inCartQty > 0 ? "border-primary/35" : "border-transparent"
      )}
    >
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          className="h-14 w-14 shrink-0 rounded-xl object-cover"
          loading="lazy"
        />
      )}

      <div className="flex min-w-0 flex-col gap-2.5">
        <div>
          <p className="text-[15px] font-bold leading-snug text-on-surface">{product.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] font-semibold text-on-surface-variant">
            <span>{product.sku}</span>
            {/* ⚠ Hết hàng tô ĐỎ, sắp hết tô hổ phách. Biết trước khi thêm
                rẻ hơn nhiều so với biết lúc bấm lưu đơn. */}
            <span
              className={cn(
                outOfStock ? "font-extrabold text-error" : stock < 20 ? "font-extrabold text-[#8a5a00]" : ""
              )}
            >
              {outOfStock ? "Hết hàng" : `Tồn ${stock.toLocaleString("vi-VN")} ${unit}`}
            </span>
            {inCartQty > 0 && (
              <span className="rounded-md bg-primary/10 px-1.5 py-px font-extrabold text-primary">
                Trong giỏ: {inCartQty} {unit}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1 rounded-xl bg-surface-container p-[3px]">
            {units.map((u) => {
              const active = u === unit
              return (
                <button
                  key={u}
                  type="button"
                  onClick={(e) => {
                    // ⚠ Xem chú thích đầu file — thiếu dòng này là mỗi lần
                    // đổi đơn vị lại thêm một dòng rác vào giỏ.
                    e.stopPropagation()
                    onPickUnit(u)
                  }}
                  className={cn(
                    "h-10 min-w-[72px] rounded-[9px] px-3.5 text-sm font-extrabold transition-colors",
                    active
                      ? "bg-surface-container-lowest text-primary shadow-sm"
                      : "text-on-surface-variant"
                  )}
                >
                  {u}
                </button>
              )
            })}
          </div>
          {/* ⚠ Giá 0 nghĩa là CHƯA CÓ GIÁ, không phải miễn phí. In "0đ" ở
              đây là mời nhân viên bán không công. */}
          <span className="whitespace-nowrap text-[18px] font-extrabold tabular-data text-primary">
            {price > 0 ? formatCurrency(price) : "chưa có giá"}
          </span>
        </div>
      </div>
    </div>
  )
}
