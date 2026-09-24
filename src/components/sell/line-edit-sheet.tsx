"use client"

import { kepGiamGia, nhanTranGiamGia, type UserDiscountRules } from "@/lib/pricing"
import { useEffect, useState } from "react"
import { Lock, Trash2, X } from "lucide-react"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { cn, formatCurrency, formatInt } from "@/lib/utils"
import {
  ceilingFor, lineDiscountAmountOf, lineGross, netPriceOf, priceViolation, switchUnit,
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

  const gross = lineGross(line.qty, line.price)
  const giam = lineDiscountAmountOf(line)
  const thanhTien = line.qty * netPriceOf(line)
  const doiDonVi = (u: string) => {
    // Đổi ĐƠN VỊ là đổi luôn GIÁ và hệ số — xem đầu tệp.
    const p = unitPriceFor(product, u, groupId)
    onPatch({ unit: u, price: p, listPrice: p, conversion: conversionFor(product, u) })
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        /* ⚠ CAO THEO NỘI DUNG (3a) — bỏ khoảng trống lớn ở giữa; chỉ chặn trần
           khi bàn phím chiếm chỗ. */
        className="flex flex-col gap-0 rounded-t-[20px] p-0"
        style={box ? { maxHeight: box.height, bottom: box.bottom } : undefined}
      >
        <div className="flex items-start gap-3 border-b border-border/60 px-4 pb-3.5 pt-2">
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <p className="text-[16px] font-bold leading-[1.35]">{product.name}</p>
            <p className="text-[12px] text-muted-foreground">
              {product.sku} · Còn {stock.toLocaleString("vi-VN")} {line.unit}
            </p>
          </div>
          <button
            type="button"
            aria-label="Đóng"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-container-low"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.4} />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto px-4 py-3.5">
          {lockUnit ? (
            /* ⚠ KHOÁ THÌ NÓI RA LÝ DO — màu hổ phách + ổ khoá là quy ước "khoá có lý do". */
            <div className="rounded-[12px] border-[1.5px] border-amber-300 bg-amber-50/60 px-3 py-2">
              <p className="flex items-center gap-1.5 text-sm font-bold text-amber-700">
                <Lock className="h-3.5 w-3.5 shrink-0" />
                {line.unit}
              </p>
              <p className="mt-0.5 text-xs font-semibold text-amber-700/90">{lockUnit}</p>
            </div>
          ) : (
            /* Đơn vị hai dòng tên / giá (3a). */
            <div role="group" aria-label="Đơn vị" className="flex rounded-[12px] bg-surface-container-low p-[3px]">
              {units.map((u) => {
                const active = u === line.unit
                return (
                  <button
                    key={u}
                    type="button"
                    aria-pressed={active}
                    onClick={() => doiDonVi(u)}
                    className={cn(
                      "flex h-11 flex-1 flex-col items-center justify-center gap-px rounded-[10px]",
                      active ? "bg-surface-container-lowest shadow-[0_1px_2px_rgba(0,0,0,.1)]" : ""
                    )}
                  >
                    <span className={cn("text-[14px]", active ? "font-semibold text-primary" : "font-medium text-on-surface-variant")}>{u}</span>
                    <span className="text-[11px] text-muted-foreground">{formatCurrency(unitPriceFor(product, u, groupId))}</span>
                  </button>
                )
              })}
            </div>
          )}

          <div className="flex gap-2.5">
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold text-on-surface-variant">Số lượng</span>
              <Stepper size="lg" qty={line.qty} onChange={(qty) => onPatch({ qty })} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-[12px] font-semibold text-on-surface-variant">Đơn giá / {line.unit}</span>
              {/* Chuỗi state chỉ giữ CHỮ SỐ; vẽ ra thì nhóm nghìn (9.000.000). */}
              <div
                className={cn(
                  "flex h-12 items-center gap-1 rounded-[12px] px-3",
                  bad ? "border-[1.5px] border-error" : "border border-border",
                  canEditPrice ? "" : "bg-surface-container-low"
                )}
              >
                <input
                  aria-label="Đơn giá"
                  value={priceText === "" ? "" : formatInt(parseInt(priceText, 10))}
                  disabled={!canEditPrice}
                  inputMode="numeric"
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "")
                    setPriceText(digits)
                    onPatch({ price: digits === "" ? 0 : parseInt(digits, 10) })
                  }}
                  className="min-w-0 flex-1 border-0 bg-transparent text-right text-[17px] font-bold tabular-data outline-none"
                />
                <span className="text-[13px] text-muted-foreground">đ</span>
              </div>
            </div>
          </div>
          {/* Giá vượt → viền đỏ + câu nói đúng mức; có "Về giá bảng" (3a). */}
          <div className="-mt-2 flex items-center gap-2 text-[12px]">
            <span className={cn("flex-1", bad ? "text-error" : "text-muted-foreground")}>{hint}</span>
            {canEditPrice && line.price !== listPrice && (
              <button
                type="button"
                onClick={() => {
                  setPriceText(String(listPrice))
                  onPatch({ price: listPrice, listPrice })
                }}
                className="shrink-0 font-semibold text-primary"
              >
                Về giá bảng
              </button>
            )}
          </div>

          {lineDiscount && (
            <DiscountField
              line={line}
              tran={discountRules ? nhanTranGiamGia(discountRules) : ""}
              pctText={pctText}
              setPctText={setPctText}
              onChange={(d) => onPatch({ discount: discountRules ? kepGiamGia(d, lineGross(line.qty, line.price), discountRules) : d })}
            />
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-on-surface-variant">Ghi chú dòng</span>
            <input
              aria-label="Ghi chú dòng"
              value={line.note}
              onChange={(e) => onPatch({ note: e.target.value })}
              placeholder="VD: lấy date mới, đổi vị cam"
              className="h-11 rounded-[12px] border border-border px-3 text-[14px] outline-none"
            />
          </div>

          {/* Diễn giải tiền: SL × giá − giảm = thành tiền (3a). */}
          <div className="flex flex-col gap-1.5 rounded-[12px] bg-surface-container-low p-3 text-[13px] text-muted-foreground">
            <div className="flex justify-between">
              <span>{line.qty} {line.unit} × {formatCurrency(line.price)}</span>
              <span className="tabular-data text-on-surface">{formatCurrency(gross)}</span>
            </div>
            {giam > 0 && (
              <div className="flex justify-between">
                <span>Giảm giá</span>
                <span className="tabular-data text-[#067647]">−{formatCurrency(giam)}</span>
              </div>
            )}
            <div className="flex items-baseline justify-between border-t border-border pt-1.5">
              <span className="font-semibold text-on-surface">Thành tiền</span>
              <span className="text-[20px] font-bold tabular-data text-on-surface">{formatCurrency(thanhTien)}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-2 px-4 pb-5 pt-1">
          {/* ⚠ Ô trống khi dòng không được bỏ (hàng đổi của phiếu trả) — xem `canRemove`. */}
          {canRemove && (
            <button
              type="button"
              aria-label="Xoá dòng"
              onClick={onRemove}
              className="grid h-[50px] w-[50px] shrink-0 place-items-center rounded-[12px] border border-error/30 text-error"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-[50px] flex-1 rounded-[12px] bg-primary text-[15px] font-semibold text-primary-foreground"
          >
            Cập nhật · {formatCurrency(thanhTien)}
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
  /* đ / % là toggle rõ ràng (3a); đổi cách nhập GIỮ số tiền (`switchUnit`). */
  const doi = (u: "vnd" | "pct") => {
    if (u === d.unit) return
    const moi = switchUnit(d, lineGross(line.qty, line.price))
    if (moi.unit === "pct") setPctText(moi.value === 0 ? "" : String(moi.value))
    onChange(moi)
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-semibold text-on-surface-variant">Giảm giá dòng</span>
      <div className="flex gap-2">
        <div className={cn("flex h-12 flex-1 items-center rounded-[12px] px-3", tien > 0 ? "border-[1.5px] border-primary" : "border border-border")}>
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
            className="min-w-0 flex-1 border-0 bg-transparent text-right text-[17px] font-bold tabular-data outline-none"
          />
        </div>
        <div role="group" aria-label="Cách giảm giá dòng" className="flex rounded-[12px] bg-surface-container-low p-[3px]">
          {(["vnd", "pct"] as const).map((u) => (
            <button
              key={u}
              type="button"
              aria-pressed={d.unit === u}
              aria-label={u === "pct" ? "Giảm dòng theo %" : "Giảm dòng theo đồng"}
              onClick={() => doi(u)}
              className={cn(
                "h-[42px] w-11 rounded-[10px] text-[15px]",
                d.unit === u ? "bg-surface-container-lowest font-semibold text-primary shadow-[0_1px_2px_rgba(0,0,0,.1)]" : "font-medium text-on-surface-variant"
              )}
            >
              {u === "pct" ? "%" : "đ"}
            </button>
          ))}
        </div>
      </div>
      {(tien > 0 || tran) && (
        <p className="text-[12px] text-muted-foreground">
          {[tien > 0 ? `Giảm ${formatCurrency(tien)} · còn ${formatCurrency(netPriceOf(line))}/${line.unit}` : "", tran].filter(Boolean).join(" · ")}
        </p>
      )}
    </div>
  )
}

/** Bộ − / số / + dùng chung cho giỏ và cho sheet này. */
export function Stepper({
  qty,
  onChange,
  min = 1,
  size = "xl",
  unit,
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
  /** Cỡ theo thiết kế 24/09/2026: sm = dòng giỏ (2b), md = dòng trả (1b), lg = sheet (3a), xl = hóa đơn. */
  size?: "sm" | "md" | "lg" | "xl"
  /** Đơn vị hiện cạnh số — dòng giỏ 2b ghi "2 thùng". */
  unit?: string
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
  const z = STEPPER_SIZES[size]
  return (
    <div className={cn("flex items-center overflow-hidden", z.box)}>
      <button
        type="button"
        aria-label="Giảm"
        disabled={atMin}
        onClick={() => onChange(qty - 1)}
        className={cn(z.btn, "shrink-0", atMin ? "text-on-surface-variant/40" : "text-primary")}
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
        style={unit ? { width: `${Math.max(1, String(qty).length) + 1}ch` } : undefined}
        className={cn("min-w-0 bg-transparent text-center font-bold tabular-data outline-none", z.input)}
      />
      {unit && <span className="pr-0.5 text-[12px] text-muted-foreground">{unit}</span>}
      <button
        type="button"
        aria-label="Tăng"
        onClick={() => onChange(qty + 1)}
        className={cn(z.btn, "shrink-0 text-primary")}
      >
        +
      </button>
    </div>
  )
}

const STEPPER_SIZES = {
  sm: { box: "h-9 rounded-[10px] border border-border", btn: "h-[34px] w-9 text-[18px]", input: "text-[14px]" },
  md: { box: "h-10 rounded-[10px] border border-border", btn: "h-[38px] w-[38px] text-[18px]", input: "w-8 text-[15px]" },
  lg: { box: "h-12 rounded-[12px] border border-border", btn: "h-[46px] w-11 text-[20px]", input: "w-11 text-[17px]" },
  xl: {
    box: "h-12 rounded-xl border-[1.5px] border-outline-variant",
    btn: "h-12 w-12 text-xl",
    input: "h-12 w-full flex-1 border-x-[1.5px] border-surface-container bg-surface-container-lowest text-lg font-extrabold",
  },
} as const
