"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft, Plus, X } from "lucide-react"
import { useSellCart } from "@/hooks/use-sell-cart"
import { useAuth } from "@/hooks/use-auth"
import { SellBottomBar } from "@/components/sell/bottom-bar"
import { useSellData } from "@/hooks/use-sell-data"
import { useCommittedStock } from "@/hooks/use-committed-stock"
import { availableMapFrom } from "@/lib/sell/committed"
import { CompactSelect } from "@/components/ui/compact-select"
import { ReturnLineSheet } from "@/components/sell/return-line-sheet"
import { ReturnPriceInput } from "@/components/sell/return-price-input"
import { Stepper } from "@/components/sell/line-edit-sheet"
import {
  RETURN_REASONS,
  returnCeilingFor,
  returnPriceViolation,
  type ReturnPriceRules,
} from "@/lib/sell/returns"
import { unitPriceFor } from "@/lib/sell/pricing"
import { backToOrder } from "@/lib/nav/sell-nav"
import { userPriceRulesFrom } from "@/lib/pricing"
import { toStockLines, toStockReturnLines } from "@/lib/sell/stock"
import { isReturnLineOverstock } from "@/lib/orders/stock-check"
import { cn, formatCurrency } from "@/lib/utils"

export default function SellReturnsPage() {
  const router = useRouter()
  const cart = useSellCart()
  const { user } = useAuth()
  const { products, productById, customerById, stockByProduct } = useSellData()
  /**
   * ⚠ DÒNG ĐỔI ĂN TỒN NHƯ MỘT DÒNG BÁN, nên nó cũng phải so với phần
   * CÒN ĐẶT ĐƯỢC. Dòng trả tiền thì ngược lại (nhập lại kho) nên phép
   * kiểm không đụng tới.
   */
  const { committedByProduct } = useCommittedStock()
  const availableByProduct = availableMapFrom(stockByProduct, committedByProduct)

  // Nhu cầu xuất kho gồm cả dòng bán lẫn dòng đổi — xem `@/lib/sell/stock`.
  const stockLines = useMemo(() => toStockLines(cart.cart), [cart.cart])
  const stockReturns = useMemo(() => toStockReturnLines(cart.returnLines), [cart.returnLines])
  const [editIdx, setEditIdx] = useState<number | null>(null)

  const groupId = customerById(cart.customerId)?.group_id ?? null

  /**
   * Quyền sửa giá — DÙNG CHUNG với dòng bán.
   *
   * ⚠ Ai không được sửa giá bán thì cũng không được sửa giá trả. Hai đằng
   * cùng là thẩm quyền về TIỀN: chặn ở đơn bán rồi mở ở phiếu trả thì
   * "trả hàng" thành đường vòng để ra đúng con số mình muốn.
   */
  const rules = userPriceRulesFrom(user)
  const canEditPrice = user?.role !== "sales" || !!rules.allow_price_edit
  /**
   * ⚠ TRẦN GIÁ TRẢ = TRẦN GIÁ BÁN CỦA CHÍNH NGƯỜI ĐÓ. Ai được nâng giá bán
   * trong biên độ 5% thì cũng được trả trong biên độ 5% — cùng một thẩm
   * quyền về tiền, cùng một con số.
   */
  const priceRules: ReturnPriceRules = {
    maxIncreasePct: Number(rules.price_edit_max_increase_pct ?? 0),
    free: rules.free,
  }

  /** Giá bảng của đúng đơn vị đang chọn trên dòng trả. */
  const listPriceOf = (r: { productId: string; unit: string }) => {
    const p = productById(r.productId)
    return p ? unitPriceFor(p, r.unit, groupId) : 0
  }
  /** Dòng này đã bị sửa giá so với bảng giá chưa — để gắn nhãn "Giá sửa". */
  const priceEdited = (r: { productId: string; unit: string; price: number }) => {
    const list = listPriceOf(r)
    return list > 0 && r.price !== list
  }
  /** ⚠ Trả CAO hơn trần là một đường rút tiền — tô đỏ ngay trên dòng. */
  const priceBadOf = (r: { productId: string; unit: string; price: number }) =>
    returnPriceViolation(r, listPriceOf(r), priceRules) !== null
  /**
   * Câu báo lỗi phải nói con số DỪNG Ở ĐÂU. "Cao hơn giá bảng" là sai kể
   * từ khi có biên độ — người được nâng 5% đọc câu đó rồi hạ về đúng giá
   * bảng, tức là bỏ mất phần mình được phép.
   */
  const priceBadText = (r: { productId: string; unit: string; price: number }) => {
    const ceiling = returnCeilingFor(listPriceOf(r), priceRules)
    return Number.isFinite(ceiling)
      ? `Giá trả vượt trần — tối đa ${formatCurrency(ceiling)}`
      : "Đơn giá không được âm"
  }


  const soTra = cart.returnLines.filter((r) => !r.isExchange).length
  const soDoi = cart.returnLines.length - soTra
  const tomTat = [soTra ? `${soTra} trả tiền` : "", soDoi ? `${soDoi} đổi hàng` : ""].filter(Boolean).join(" · ") || "Chưa có hàng"

  return (
    <div className="flex min-h-screen flex-col bg-surface-container-low pb-[200px]">
      {/* ---------- ĐẦU MÀN (1b): bỏ ô tìm trùng lặp → nút "Thêm hàng" về 1a ---------- */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-container-lowest px-4 pb-3 pt-3.5">
        <button
          type="button"
          onClick={() => backToOrder(router)}
          aria-label="Quay lại"
          className="-ml-2 grid h-9 w-9 place-items-center text-on-surface"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="min-w-0 flex-1 text-[19px] font-bold">Hàng trả / đổi</h1>
        {/* ⚠ MỘT MÀN TÌM HÀNG DUY NHẤT CHO CẢ APP — chế độ chọn hàng trả của /sell. */}
        <button
          type="button"
          onClick={() => router.push("/sell?mode=return")}
          className="flex h-9 items-center gap-1 rounded-[10px] bg-primary/10 px-3 text-[13px] font-semibold text-primary"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.6} />
          Thêm hàng
        </button>
      </div>

      <div className="flex flex-col gap-3 p-3">
        {/* Lý do chung ở trên, mỗi dòng đổi riêng được (1b). */}
        <div className="flex flex-col gap-2">
          <p className="px-1 text-[12px] font-semibold text-muted-foreground">Lý do trả (áp dụng cho tất cả)</p>
          <div className="flex flex-wrap gap-1.5">
            {RETURN_REASONS.map((r) => {
              const active = cart.returnReason === r.value
              return (
                <button
                  key={r.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    cart.setReturnReason(r.value)
                    /* Chọn lý do chung là áp cho TẤT CẢ — bỏ lý do riêng đã đặt trên dòng. */
                    cart.returnLines.forEach((l, i) => { if (l.reason) cart.patchReturnLine(i, { reason: undefined }) })
                  }}
                  className={cn(
                    "h-[34px] rounded-[17px] px-3 text-[13px]",
                    active
                      ? "border-[1.5px] border-primary bg-primary/10 font-semibold text-primary"
                      : "border border-border bg-surface-container-lowest font-medium text-on-surface-variant"
                  )}
                >
                  {r.label}
                </button>
              )
            })}
          </div>
        </div>

        {cart.returnLines.length === 0 && (
          <div className="rounded-[14px] bg-surface-container-lowest px-4 py-8 text-center text-[14px] text-muted-foreground">
            Chưa có hàng trả. Bấm “Thêm hàng” để chọn.
          </div>
        )}

        {cart.returnLines.map((r, i) => {
          const p = productById(r.productId)
          // ⚠ Dòng ĐỔI ăn tồn như một dòng bán — so với phần còn đặt được.
          const over = isReturnLineOverstock(i, stockReturns, stockLines, products, availableByProduct)
          const tien = Math.round(r.qty * r.price * (1 + (r.vatRate || 0)))
          return (
            <div key={`${r.productId}|${r.unit}`} data-testid="dong-tra-sell" className="flex flex-col gap-3 rounded-[14px] bg-surface-container-lowest p-3">
              <div className="flex items-start gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  {/* Chạm tên là mở sheet sửa dòng trả (ghi chú, đơn vị…). */}
                  <button type="button" onClick={() => setEditIdx(i)} className="text-left text-[14px] font-semibold leading-[1.35]">
                    {p?.name ?? "—"}
                  </button>
                  <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
                    <span>{p?.sku ?? ""}</span>
                    <span>·</span>
                    <span>{r.unit}</span>
                    {!r.isExchange && (
                      <>
                        <span>·</span>
                        <CompactSelect
                          ariaLabel={`Lý do trả dòng ${i + 1}`}
                          className="h-6 w-auto rounded-md border-0 bg-surface-container-low px-1.5 text-[12px] text-on-surface-variant"
                          value={r.reason || cart.returnReason}
                          options={RETURN_REASONS.map((x) => ({ value: x.value, label: x.label }))}
                          onChange={(v) => cart.patchReturnLine(i, { reason: v === cart.returnReason ? undefined : v })}
                        />
                      </>
                    )}
                    {priceEdited(r) && <span className="rounded-[5px] bg-primary/10 px-1.5 py-px font-semibold text-primary">Giá sửa</span>}
                  </div>
                  {over && <span className="text-[12px] font-semibold text-error">Vượt phần còn đặt được — kho không đủ hàng để đổi</span>}
                  {priceBadOf(r) && <span className="text-[12px] font-semibold text-error">{priceBadText(r)}</span>}
                  {r.note && <span className="text-[12px] italic text-muted-foreground">“{r.note}”</span>}
                </div>
                <button
                  type="button"
                  onClick={() => cart.setReturnQty(i, 0)}
                  aria-label="Xoá dòng trả"
                  className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center text-muted-foreground"
                >
                  <X className="h-4 w-4" strokeWidth={2.2} />
                </button>
              </div>
              {/* ⚠ Hai loại khác nhau ở CHỖ TIỀN: đổi hàng không trừ đồng nào. */}
              <div className="flex rounded-[10px] bg-surface-container-low p-[3px]">
                {[
                  { ex: false, label: "Trả tiền" },
                  { ex: true, label: "Đổi hàng" },
                ].map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    aria-pressed={r.isExchange === o.ex}
                    onClick={() => cart.patchReturnLine(i, { isExchange: o.ex })}
                    className={cn(
                      "h-8 flex-1 rounded-lg text-[13px]",
                      r.isExchange === o.ex
                        ? "bg-surface-container-lowest font-semibold text-primary shadow-[0_1px_2px_rgba(0,0,0,.1)]"
                        : "font-medium text-on-surface-variant"
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {/* ⚠ ĐƠN GIÁ NẰM THẲNG Ở ĐÂY, ngang hàng số lượng — giấu sau một cú chạm là
                  người dùng báo "không sửa được giá". */}
              <div className="flex items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">Đơn giá</span>
                  <ReturnPriceInput
                    price={r.price}
                    disabled={!canEditPrice}
                    bad={priceBadOf(r)}
                    suffix={`đ/${r.unit}`}
                    dim={r.isExchange}
                    onChange={(price) => cart.patchReturnLine(i, { price })}
                  />
                </label>
                <div className="flex shrink-0 flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">Số lượng</span>
                  <Stepper size="md" qty={r.qty} onChange={(q) => cart.setReturnQty(i, q)} />
                </div>
              </div>
              {!canEditPrice && (
                <p className="text-[12px] text-muted-foreground">Bạn không có quyền sửa giá — báo quản lý nếu cần đổi.</p>
              )}
              <div className="flex items-center justify-between border-t border-dashed border-border pt-2.5">
                <span className="text-[13px] text-muted-foreground">{r.isExchange ? "Đổi 1:1, không trừ tiền" : "Thành tiền"}</span>
                <span className={cn("text-[15px] font-bold tabular-data", r.isExchange ? "text-muted-foreground" : "text-error")}>
                  {r.isExchange ? "0đ" : `−${formatCurrency(tien)}`}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Tổng dính đáy — bỏ dòng "Trừ vào đơn" lặp trên từng thẻ (1b). */}
      <SellBottomBar className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-semibold">Trừ vào đơn</span>
            <span className="text-[12px] text-muted-foreground">{tomTat}</span>
          </div>
          <span className="text-[20px] font-bold tabular-data text-error">−{formatCurrency(cart.returnCredit)}</span>
        </div>
        {/* ⚠ v2 không có bước duyệt — người hoàn thành phiếu trả là nhà phân phối. */}
        <p className="rounded-lg bg-surface-container-low px-2.5 py-2 text-[11.5px] leading-[1.45] text-muted-foreground">
          Phiếu trả đi kèm đơn. Kho và công nợ chỉ cập nhật khi NPP hoàn thành phiếu trả. Dòng “Đổi hàng” không trừ tiền.
        </p>
        <button
          type="button"
          onClick={() => backToOrder(router)}
          className={cn(
            "h-[50px] rounded-[12px] text-[15px] font-semibold text-primary-foreground",
            cart.returnLines.length ? "bg-primary" : "bg-muted-foreground/60"
          )}
        >
          Xong · về đơn hàng
        </button>
      </SellBottomBar>

      <ReturnLineSheet
        line={editIdx != null ? (cart.returnLines[editIdx] ?? null) : null}
        product={
          editIdx != null ? productById(cart.returnLines[editIdx]?.productId ?? "") : undefined
        }
        groupId={groupId}
        canEditPrice={canEditPrice}
        priceRules={priceRules}
        onPatch={(patch) => editIdx != null && cart.patchReturnLine(editIdx, patch)}
        onRemove={() => {
          if (editIdx != null) cart.setReturnQty(editIdx, 0)
          setEditIdx(null)
        }}
        onClose={() => setEditIdx(null)}
      />
    </div>
  )
}
