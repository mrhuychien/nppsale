"use client"

import { memo } from "react"
import { cn, formatCurrency, formatInt } from "@/lib/utils"
import { sellableUnits, stockInUnit, unitPriceFor, type PricedProduct } from "@/lib/sell/pricing"
import { stockDisplayFor } from "@/lib/sell/committed"

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
 *
 * ⚠ THẺ ĐƯỢC `memo`, VÀ HAI CALLBACK NHẬN SẢN PHẨM LÀM THAM SỐ. Bản đầu
 * nhận `onAdd={() => addToCart(p)}` — closure MỚI ở mỗi lần vẽ, nên mỗi
 * phím gõ ở ô tìm là 60 thẻ vẽ lại toàn bộ dù chẳng thẻ nào đổi. Nay màn
 * truyền một hàm ổn định, thẻ tự đưa `product` vào, và `memo` chỉ vẽ lại
 * thẻ có prop đổi thật.
 */
export interface ProductCardProps {
  product: PricedProduct
  /** Tồn kho theo đơn vị CƠ SỞ. */
  baseOnHand: number
  /**
   * Hàng đã hứa trong các Phiếu tạm khác, theo đơn vị CƠ SỞ.
   *
   * ⚠ `null` = CHƯA ĐỌC ĐƯỢC, không phải "không ai đặt". Hai thứ này
   * dẫn tới hai câu khác nhau trên thẻ, và gộp lại là nói với người bán
   * rằng kho còn nguyên trong khi ta không biết.
   */
  baseCommitted?: number | null
  groupId: string | null | undefined
  unit: string
  onPickUnit: (productId: string, unit: string) => void
  onAdd: (product: PricedProduct) => void
  /** Số lượng đang có trong giỏ ở ĐÚNG đơn vị này. */
  inCartQty: number
  /**
   * Hiện dòng tồn kho không.
   *
   * ⚠ Màn HÀNG TRẢ phải tắt. Khách đưa hàng lại cho mình, nên "Hết hàng"
   * tô đỏ ở đó là câu trả lời cho một câu hỏi không ai hỏi — tệ hơn, nó
   * trông như đang chặn, và nhân viên sẽ không dám bấm.
   */
  showStock?: boolean
  /** Nhãn của huy hiệu đếm. Màn hàng trả gọi là "Đã trả". */
  badgeLabel?: string
  /**
   * CHẾ ĐỘ CHỌN NHIỀU (chủ nhà yêu cầu 23/09/2026). Có giá trị thì thẻ hiện
   * ô số lượng — số TUYỆT ĐỐI sẽ vào giỏ ở đơn vị đang chọn. `undefined` =
   * chế độ thường, thẻ không đổi gì.
   */
  pickQty?: number
  onPickQty?: (productId: string, unit: string, qty: number) => void
}

export const ProductCard = memo(function ProductCard({
  product,
  baseOnHand,
  baseCommitted = null,
  groupId,
  unit,
  onPickUnit,
  onAdd,
  inCartQty,
  showStock = true,
  badgeLabel = "Trong giỏ",
  pickQty,
  onPickQty,
}: ProductCardProps) {
  const units = sellableUnits(product)
  const price = unitPriceFor(product, unit, groupId)
  const stock = stockInUnit(product, unit, baseOnHand)
  /**
   * ⚠ QUY ĐỔI SỐ ĐÃ ĐẶT BẰNG ĐÚNG PHÉP QUY ĐỔI CỦA TỒN. Lấy tồn theo
   * "thùng" rồi trừ số đã đặt theo "gói" là trừ nhầm mười hai lần.
   */
  const committedUnit =
    baseCommitted === null ? null : stockInUnit(product, unit, baseCommitted)
  const sd = stockDisplayFor(stock, committedUnit)
  const outOfStock = sd.out
  const image = product.images?.[0]

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onAdd(product)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onAdd(product)
        }
      }}
      className={cn(
        "cursor-pointer select-none rounded-2xl border-[1.5px] bg-surface-container-lowest p-3 shadow-card",
        // Phản hồi lúc CHẠM — ngón tay đặt xuống là thẻ tối đi ngay, không
        // đợi đến lúc nhả. Thiếu nó thì chạm trên điện thoại cảm giác
        // "không ăn" dù đã ăn.
        "transition-[background-color,transform] duration-100 active:scale-[0.985] active:bg-surface-container",
        // ⚠ Thẻ ngoài màn hình KHÔNG dựng bố cục, không vẽ. 60 thẻ là
        // ~7.000 px chiều cao; không có dòng này thì cuộn là trình duyệt
        // tính lại cả 60 dù chỉ 5 thẻ đang hiện. Kích thước ước lượng
        // giữ thanh cuộn không nhảy.
        "[content-visibility:auto] [contain-intrinsic-size:auto_116px]",
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
          decoding="async"
        />
      )}

      <div className="flex min-w-0 flex-col gap-2.5">
        <div>
          <p className="text-[15px] font-bold leading-snug text-on-surface">{product.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] font-semibold text-on-surface-variant">
            <span>{product.sku}</span>
            {/* ⚠ Hết hàng tô ĐỎ, sắp hết tô hổ phách. Biết trước khi thêm
                rẻ hơn nhiều so với biết lúc bấm lưu đơn. */}
            {showStock && (
              <>
                {/* ⚠ "ĐÃ CÓ NGƯỜI ĐẶT HẾT" KHÁC "HẾT HÀNG". Hết hàng thì
                    người bán đi gọi nhập; đã có người đặt hết thì họ đi
                    hỏi đơn nào đang giữ. Gộp hai câu là để họ làm sai
                    việc — kho vẫn đầy mà bảo nhau đi nhập thêm. */}
                <span
                  className={cn(
                    outOfStock
                      ? "font-extrabold text-error"
                      : sd.available < 20
                        ? "font-extrabold text-[#8a5a00]"
                        : ""
                  )}
                >
                  {sd.reservedOut
                    ? `Đã đặt hết (tồn ${formatInt(stock)} ${unit})`
                    : outOfStock
                      ? "Hết hàng"
                      : `Tồn ${formatInt(stock)} ${unit}`}
                </span>
                {/* Phần đã hứa trong Phiếu tạm khác — chỉ hiện khi có. */}
                {!sd.reservedOut && sd.committed !== null && sd.committed > 0 && (
                  <span className="font-extrabold text-[#8a5a00]">
                    đã đặt {formatInt(sd.committed)} · còn {formatInt(sd.available)}
                  </span>
                )}
                {/* ⚠ CHƯA ĐỌC ĐƯỢC THÌ NÓI RA. Im lặng ở đây là để người
                    bán tin con số tồn đã trừ phần người khác đặt. */}
                {sd.committed === null && (
                  <span className="text-on-surface-variant">chưa rõ hàng đã đặt</span>
                )}
              </>
            )}
            {inCartQty > 0 && (
              <span className="rounded-md bg-primary/10 px-1.5 py-px font-extrabold text-primary">
                {badgeLabel}: {inCartQty} {unit}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          {/* ⚠ Nhóm nút đơn vị phải CO ĐƯỢC và cuộn ngang khi chật. Mặt
              hàng khai ba đơn vị (chai · lốc · thùng) thì ba nút cộng lại
              rộng hơn phần còn lại của thẻ, và nếu nhóm này không co thì
              nó đẩy GIÁ ra ngoài mép phải — đúng kiểu tràn vừa phải sửa ở
              màn hàng trả. */}
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-xl bg-surface-container p-[3px]">
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
                    onPickUnit(product.id, u)
                  }}
                  className={cn(
                    "h-10 min-w-[64px] shrink-0 rounded-[9px] px-3.5 text-sm font-extrabold transition-colors",
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
          <span className="shrink-0 whitespace-nowrap text-[18px] font-extrabold tabular-data text-primary">
            {price > 0 ? formatCurrency(price) : "chưa có giá"}
          </span>
        </div>

        {pickQty !== undefined && onPickQty && (
          <PickQty
            qty={pickQty}
            unit={unit}
            label={`Số lượng ${product.name}`}
            onChange={(q) => onPickQty(product.id, unit, q)}
          />
        )}
      </div>
    </div>
  )
})

/**
 * Ô số lượng của chế độ chọn nhiều.
 *
 * ⚠ CHẶN SỰ KIỆN NỔI LÊN THẺ — cùng lý do với nút đơn vị: chạm vào ô mà
 *   thẻ cũng nhận là mỗi lần gõ số lại cộng thêm một.
 * ⚠ CHO PHÉP 0 / TRỐNG. 0 nghĩa là "không lấy" (bỏ khỏi giỏ nếu đang có) —
 *   khác `Stepper` của giỏ hàng, nơi 0 không có nghĩa.
 */
function PickQty({
  qty,
  unit,
  label,
  onChange,
}: {
  qty: number
  unit: string
  label: string
  onChange: (qty: number) => void
}) {
  const chan = (e: { stopPropagation: () => void }) => e.stopPropagation()
  return (
    <div
      className="flex items-center gap-2"
      onClick={chan}
      onKeyDown={chan}
    >
      <button
        type="button"
        aria-label={`Bớt ${label}`}
        disabled={qty <= 0}
        onClick={() => onChange(Math.max(0, qty - 1))}
        className="tap grid h-10 w-10 place-items-center rounded-xl bg-surface-container text-xl font-extrabold text-on-surface disabled:opacity-40"
      >
        −
      </button>
      <input
        aria-label={label}
        inputMode="numeric"
        enterKeyHint="done"
        value={qty > 0 ? String(qty) : ""}
        placeholder="0"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "")) || 0)}
        className={cn(
          "h-10 w-20 rounded-xl border-[1.5px] bg-surface-container-lowest text-center text-lg font-extrabold tabular-data outline-none focus:border-primary",
          qty > 0 ? "border-primary/50 text-primary" : "border-outline-variant text-on-surface"
        )}
      />
      <button
        type="button"
        aria-label={`Thêm ${label}`}
        onClick={() => onChange(qty + 1)}
        className="tap grid h-10 w-10 place-items-center rounded-xl bg-surface-container text-xl font-extrabold text-on-surface"
      >
        +
      </button>
      <span className="text-sm font-bold text-on-surface-variant">{unit}</span>
    </div>
  )
}
