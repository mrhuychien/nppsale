"use client"

import { kepGiamGia, nhanTranGiamGia, type UserDiscountRules } from "@/lib/pricing"
import { useEffect, useState } from "react"
import { Lock } from "lucide-react"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { cn, formatCurrency, formatInt } from "@/lib/utils"
import {
  ceilingFor, lineDiscountAmountOf, lineGross, netPriceOf, priceViolation, switchUnit, unitLabel,
  type CartLine, type DiscountInput,
} from "@/lib/sell/cart"
import {
  conversionFor,
  sellableUnits,
  stockInUnit,
  unitPriceFor,
  type PricedProduct,
} from "@/lib/sell/pricing"
import { useViewportInsets, bottomSheetBox } from "@/hooks/use-viewport-insets"

/**
 * Sửa một dòng trong giỏ: đơn vị, số lượng, đơn giá, giảm giá dòng, ghi chú.
 *
 * ⚠ KHÔNG CÒN Ô THUẾ TỪNG DÒNG — chủ nhà 24/09/2026: "sell mobile -> Bỏ VAT
 *   từng dòng". Thuế đặt một lần cho cả đơn ở giỏ hàng, như POS.
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
  lockUnit = null,
  canRemove = true,
  freePrice = false,
  lineDiscount = false,
  discountRules,
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
  /**
   * Khoá ô ĐƠN VỊ, kèm lý do hiện cho người dùng đọc.
   *
   * ⚠ MÀN HÓA ĐƠN PHẢI KHOÁ, VÀ ĐÂY LÀ LÝ DO THẬT chứ không phải cẩn
   * thận thừa. `sales_order_lines.invoiced_qty` được trigger
   * `trg_sync_invoiced_qty` (mig 124) tính bằng `sum(sil.quantity)` —
   * CỘNG THẲNG, KHÔNG QUY ĐỔI — và chú thích cột viết rõ "cùng đơn vị
   * với quantity". Đổi đơn vị của một dòng đang gắn `order_line_id` là
   * ghi vào `invoiced_qty` một con số ở đơn vị khác: đơn đặt 10 thùng,
   * xuất 10 hộp, đơn đọc thành "đã xuất đủ" trong khi kho mới ra chưa
   * tới một thùng. Sai trong im lặng, và chỉ lộ ra ở lần đối soát.
   *
   * Dòng THÊM TAY (`order_line_id` rỗng) không có ràng buộc ấy — đổi
   * đơn vị thoải mái.
   */
  lockUnit?: string | null
  /** Cho bỏ dòng không. Hàng đổi của phiếu trả thì không. */
  canRemove?: boolean
  /**
   * Không áp trần giá của nhân viên bán hàng.
   *
   * ⚠ MÀN HÓA ĐƠN LÀ CỦA NPP, và luật đã ghi từ đầu: "NPP TOÀN QUYỀN
   * SỬA SỐ LƯỢNG VÀ GIÁ. Không có chốt chặn nào ở đây, chỉ cảnh báo
   * vàng". Để nguyên trần của `/sell` là ô giá đỏ lên và câu nhắc nói
   * "Không được thấp hơn giá bảng" — một câu SAI ở màn này.
   */
  freePrice?: boolean
  /**
   * Hiện ô giảm giá dòng (% hoặc đồng). Chỉ giỏ `/sell` bật: màn hóa đơn
   * mang dòng của đơn, khoản giảm đã nằm sẵn trong đơn giá.
   */
  lineDiscount?: boolean
  /** Quyền giảm giá của người dùng (mig 185) — kẹp ô giảm theo trần. Vắng = không giới hạn. */
  discountRules?: UserDiscountRules
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
  /* Ô % giữ chuỗi riêng để gõ được "2." trước khi gõ "5". */
  const [pctText, setPctText] = useState("")
  const pctValue = line?.discount?.unit === "pct" ? line.discount.value : null
  useEffect(() => {
    if (pctValue != null) setPctText((t) => (Number(t) === pctValue ? t : String(pctValue)))
  }, [pctValue])

  if (!line || !product) return null

  const units = sellableUnits(product)
  const listPrice = unitPriceFor(product, line.unit, groupId)
  const ceiling = ceilingFor(listPrice, maxIncreasePct)
  const bad = freePrice ? null : priceViolation(line, { canEditPrice, maxIncreasePct })
  const stock = stockInUnit(product, line.unit, baseOnHand)

  const hint = freePrice
    ? `Giá bảng ${formatCurrency(listPrice)} — sửa được, không có trần.`
    : !canEditPrice
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
          {lockUnit ? (
            /* ⚠ KHOÁ THÌ NÓI RA LÝ DO, ĐỪNG CHỈ LÀM MỜ ĐI. Một ô xám
               không bấm được mà không giải thích là người dùng bấm mãi
               rồi kết luận màn hình hỏng. Màu hổ phách + ổ khoá là quy
               ước sẵn có của kho mã này cho "khoá có lý do". */
            <div className="rounded-[10px] border-[1.5px] border-amber-300 bg-amber-50/60 px-3 py-2">
              <p className="flex items-center gap-1.5 text-sm font-bold text-amber-700">
                <Lock className="h-3.5 w-3.5 shrink-0" />
                {line.unit}
              </p>
              <p className="mt-0.5 text-xs font-semibold text-amber-700/90">{lockUnit}</p>
            </div>
          ) : (
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
          )}

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
              {/* Chuỗi state chỉ giữ CHỮ SỐ (để xoá trắng được); khi vẽ thì nhóm
                    hàng nghìn bằng dấu chấm (9.000.000). onChange lọc \D nên
                    dấu chấm hiển thị không bao giờ lọt vào giá. */}
              <input
                value={priceText === "" ? "" : formatInt(parseInt(priceText, 10))}
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

          {lineDiscount && (
            <DiscountField
              line={line}
              tran={discountRules ? nhanTranGiamGia(discountRules) : ""}
              pctText={pctText}
              setPctText={setPctText}
              onChange={(d) => onPatch({ discount: discountRules ? kepGiamGia(d, lineGross(line.qty, line.price), discountRules) : d })}
            />
          )}

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
              {/* ⚠ Giá SAU giảm dòng — đúng số đi xuống sổ. */}
              {formatCurrency(line.qty * netPriceOf(line))}
            </span>
          </div>
        </div>

        <div className="mt-auto flex gap-2.5">
          {/* ⚠ Ô TRỐNG LÀ CÂU TRẢ LỜI ĐÚNG khi dòng không được bỏ (hàng
              đổi của phiếu trả) — xem `canRemove` ở nơi gọi. */}
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="h-12 rounded-2xl border-[1.5px] border-error/30 px-4 text-sm font-extrabold text-error"
            >
              Xoá dòng
            </button>
          )}
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

/**
 * Ô GIẢM GIÁ DÒNG — chủ nhà 24/09/2026: "thêm giảm giá từng dòng theo %, giá
 * trị". Cùng quy tắc số với POS (`@/lib/pos/discount`): lật ₫ ↔ % giữ nguyên
 * số tiền, kẹp trong [0, tiền hàng].
 *
 * ⚠ QUYỀN GIẢM GIÁ RIÊNG (mig 185): không có quyền thì ô này KHÔNG HIỆN (nơi
 *   gọi tắt `lineDiscount`); có trần thì nơi gọi kẹp giá trị và ô nói ra trần.
 */
function DiscountField({
  line,
  tran,
  pctText,
  setPctText,
  onChange,
}: {
  line: CartLine
  /** "Tối đa 5%" — rỗng khi không giới hạn. */
  tran: string
  pctText: string
  setPctText: (t: string) => void
  onChange: (d: DiscountInput) => void
}) {
  const d: DiscountInput = line.discount ?? { value: 0, unit: "vnd" }
  const pct = d.unit === "pct"
  const tien = lineDiscountAmountOf(line)
  return (
    <>
      <Label>Giảm giá dòng</Label>
      <div className="flex gap-2">
        <input
          aria-label="Giảm giá dòng"
          inputMode={pct ? "decimal" : "numeric"}
          value={pct ? pctText : d.value === 0 ? "" : formatInt(d.value)}
          placeholder="0"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            if (pct) {
              const t = e.target.value.replace(",", ".").replace(/[^\d.]/g, "")
              setPctText(t)
              onChange({ value: Math.min(100, Number(t) || 0), unit: "pct" })
            } else {
              const digits = e.target.value.replace(/\D/g, "")
              onChange({ value: digits === "" ? 0 : parseInt(digits, 10), unit: "vnd" })
            }
          }}
          className={cn(
            "h-12 w-0 flex-1 rounded-xl border-[1.5px] px-3 text-right text-lg font-extrabold tabular-data outline-none",
            tien > 0 ? "border-primary" : "border-outline-variant",
            "bg-surface-container-lowest"
          )}
        />
        <button
          type="button"
          aria-label={pct ? "Đơn vị giảm — đang là phần trăm, bấm để đổi sang đồng" : "Đơn vị giảm — đang là đồng, bấm để đổi sang phần trăm"}
          onClick={() => {
            const moi = switchUnit(d, lineGross(line.qty, line.price))
            if (moi.unit === "pct") setPctText(moi.value === 0 ? "" : String(moi.value))
            onChange(moi)
          }}
          className={cn(
            "h-12 w-14 shrink-0 rounded-xl border-[1.5px] text-lg font-extrabold",
            pct ? "border-primary bg-primary/10 text-primary" : "border-outline-variant text-on-surface-variant"
          )}
        >
          {unitLabel(d.unit)}
        </button>
      </div>
      <p className="mt-1.5 text-xs font-bold text-on-surface-variant">
        {[
          tien > 0 ? `Giảm ${formatCurrency(tien)} · còn ${formatCurrency(netPriceOf(line))}/${line.unit}` : "Bấm ₫ / % để đổi cách nhập.",
          tran,
        ].filter(Boolean).join(" · ")}
      </p>
    </>
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
  min = 1,
}: {
  qty: number
  onChange: (q: number) => void
  /**
   * Sàn của nút −.
   *
   * ⚠ GIỎ HÀNG SÀN 1, HÓA ĐƠN SÀN 0 — hai nghĩa khác nhau chứ không
   * phải một tuỳ chọn cho vui. Ở giỏ, 0 nghĩa là bỏ dòng nên nút − phải
   * dừng ở 1 (xem chú thích trên). Ở màn hóa đơn, 0 nghĩa là "đợt này
   * KHÔNG xuất dòng này" — một trạng thái có thật, khác hẳn bỏ dòng:
   * phần còn lại vẫn nằm trên đơn và dòng vẫn hiện ra để người ta thấy.
   * Ép sàn 1 ở đó là bắt người dùng bỏ hẳn dòng để nói "chưa xuất".
   */
  min?: number
}) {
  /**
   * ⚠ NÚT − KHÔNG BAO GIỜ XOÁ DÒNG.
   *
   * Bản trước biến nút − thành thùng rác khi số lượng bằng 1. Nghĩa là
   * cùng một chỗ trên màn hình làm hai việc khác hẳn nhau tuỳ con số đang
   * hiện: bấm − từ 2 xuống 1 rồi bấm tiếp theo quán tính là mất dòng. Và
   * muốn xoá một dòng đang để 8 thùng thì phải bấm − bảy lần mới thấy nút
   * xoá xuất hiện.
   *
   * Nay xoá là một nút RIÊNG, luôn có mặt trên mỗi dòng. Nút − chỉ giảm,
   * và dừng ở 1.
   */
  const atMin = qty <= min
  return (
    <div className="flex h-12 items-center overflow-hidden rounded-xl border-[1.5px] border-outline-variant">
      <button
        type="button"
        aria-label="Giảm"
        disabled={atMin}
        onClick={() => onChange(qty - 1)}
        className={cn(
          "h-12 w-12 shrink-0 text-xl",
          atMin ? "text-on-surface-variant/40" : "text-primary"
        )}
      >
        −
      </button>
      <input
        value={qty}
        inputMode="numeric"
        aria-label="Số lượng"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "")
          if (digits === "") return
          onChange(Math.max(min, parseInt(digits, 10)))
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
