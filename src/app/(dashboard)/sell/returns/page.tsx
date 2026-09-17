"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft, Search } from "lucide-react"
import { useSellCart } from "@/hooks/use-sell-cart"
import { useSellData } from "@/hooks/use-sell-data"
import { Stepper } from "@/components/sell/line-edit-sheet"
import { ProductCard } from "@/components/sell/product-card"
import { RETURN_REASONS, returnReasonLabel } from "@/lib/sell/returns"
import { selectedUnitOf, unitPriceFor } from "@/lib/sell/pricing"
import { findReturnLine } from "@/lib/sell/returns"
import { compareByStockDesc } from "@/lib/orders/product-order"
import { viMatchAllWords } from "@/lib/search"
import { SEARCH_FIELD_PROPS, HIDE_NATIVE_CLEAR } from "@/lib/ui/search-field"
import { cn, formatCurrency } from "@/lib/utils"

const PICK_CAP = 20

export default function SellReturnsPage() {
  const router = useRouter()
  const cart = useSellCart()
  const { products, productById, customerById, stockByProduct } = useSellData()
  const [q, setQ] = useState("")
  const [unitSel, setUnitSel] = useState<Record<string, string>>({})

  const groupId = customerById(cart.customerId)?.group_id ?? null

  /**
   * Gợi ý hàng trả.
   *
   * ⚠ Ưu tiên hàng ĐANG CÓ TRONG ĐƠN. Khách trả hàng ngay lúc giao là ca
   * hay gặp nhất, và lúc đó món phải trả gần như chắc chắn nằm trong đơn
   * này — bắt gõ tìm lại từ 1.700 mặt hàng là thừa.
   *
   * ⚠ Đơn chưa có hàng thì KHÔNG để trống: khách vẫn trả được hàng mua từ
   * chuyến trước, nên rơi về cả danh mục.
   */
  const byStock = useMemo(() => compareByStockDesc(stockByProduct), [stockByProduct])

  const inOrder = useMemo(() => {
    const ids = Array.from(new Set(cart.cart.map((l) => l.productId)))
    return ids.map((id) => productById(id)).filter(Boolean) as typeof products
  }, [cart.cart, productById])

  const pickables = useMemo(() => {
    const term = q.trim()
    if (term) {
      return products
        .filter((p) => viMatchAllWords(term, p.name, p.sku, p.barcode ?? ""))
        .sort(byStock)
        .slice(0, PICK_CAP)
    }
    if (inOrder.length) return inOrder.slice(0, PICK_CAP)
    return [...products].sort(byStock).slice(0, PICK_CAP)
  }, [q, products, inOrder, byStock])

  const listLabel = q.trim()
    ? `Kết quả cho “${q.trim()}”`
    : inOrder.length
      ? "Hàng trong đơn này"
      : "Tất cả sản phẩm"

  const add = (p: (typeof products)[number]) => {
    const unit = selectedUnitOf(unitSel, p)
    cart.addReturnLine({
      productId: p.id,
      unit,
      qty: 1,
      price: unitPriceFor(p, unit, groupId),
      vatRate: Number(p.vat_rate ?? 0),
      // Mặc định là TRẢ TIỀN — đó là nghĩa thường của "hàng trả". Đổi hàng
      // là trường hợp riêng nên phải bấm chọn.
      isExchange: false,
      note: "",
    })
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface pb-28">
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1.5 pt-0.5">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Quay lại"
          className="tap grid h-11 w-11 place-items-center text-on-surface"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <h1 className="flex-1 text-[22px] font-extrabold">Hàng trả / đổi</h1>
      </div>

      <div className="grid content-start gap-2.5 px-3 pt-1">
        <section className="rounded-2xl bg-surface-container-lowest p-3.5 shadow-card">
          <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-on-surface-variant">
            Lý do
          </p>
          <div className="flex flex-wrap gap-1.5">
            {RETURN_REASONS.map((r) => {
              const active = cart.returnReason === r.value
              return (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => cart.setReturnReason(r.value)}
                  className={cn(
                    "h-10 whitespace-nowrap rounded-[10px] border-[1.5px] px-3.5 text-[13px] font-bold",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-outline-variant text-on-surface"
                  )}
                >
                  {r.label}
                </button>
              )
            })}
          </div>
        </section>

        <section className="rounded-2xl bg-surface-container-lowest p-3.5 shadow-card">
          <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-on-surface-variant">
            Chọn hàng trả
          </p>
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-on-surface-variant" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tên, mã hàng, mã vạch…"
              aria-label="Tìm sản phẩm trả"
              {...SEARCH_FIELD_PROPS}
              className={cn(
                "h-11 w-full rounded-xl border-0 bg-surface-container pl-[38px] pr-3 text-base font-semibold outline-none",
                HIDE_NATIVE_CLEAR
              )}
            />
          </div>
          <p className="mb-1.5 text-[11px] font-bold text-on-surface-variant">{listLabel}</p>
          <div className="grid gap-2">
            {pickables.length === 0 ? (
              <p className="py-3 text-center text-[13px] font-semibold text-on-surface-variant">
                {q.trim() ? `Không tìm thấy sản phẩm khớp “${q.trim()}”` : "Chưa có sản phẩm nào"}
              </p>
            ) : (
              pickables.map((p) => {
                const unit = selectedUnitOf(unitSel, p)
                const i = findReturnLine(cart.returnLines, p.id, unit)
                return (
                  <ProductCard
                    key={p.id}
                    product={p}
                    baseOnHand={stockByProduct[p.id] ?? 0}
                    groupId={groupId}
                    unit={unit}
                    onPickUnit={(u) => setUnitSel((m) => ({ ...m, [p.id]: u }))}
                    onAdd={() => add(p)}
                    inCartQty={i >= 0 ? cart.returnLines[i].qty : 0}
                    // ⚠ Không hiện tồn kho ở đây: khách đưa hàng LẠI cho
                    // mình, nên "Hết hàng" tô đỏ trông như đang chặn và
                    // nhân viên sẽ không dám bấm.
                    showStock={false}
                    badgeLabel="Đã trả"
                  />
                )
              })
            )}
          </div>
        </section>

        {cart.returnLines.length > 0 && (
          <section className="overflow-hidden rounded-2xl bg-surface-container-lowest shadow-card">
            {cart.returnLines.map((r, i) => {
              const p = productById(r.productId)
              return (
                <div
                  key={`${r.productId}|${r.unit}`}
                  className="flex flex-col gap-2.5 border-b border-outline-variant/30 p-3 last:border-0"
                >
                  <div className="flex items-start gap-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-bold leading-snug">
                        {p?.name ?? "—"}
                      </span>
                      <span className="mt-0.5 block text-xs font-semibold text-on-surface-variant">
                        {returnReasonLabel(cart.returnReason)} · {formatCurrency(r.price)}/{r.unit}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => cart.setReturnQty(i, 0)}
                      aria-label="Xoá dòng trả"
                      className="grid h-9 w-9 shrink-0 place-items-center text-xl text-error"
                    >
                      ×
                    </button>
                  </div>
                  {/* ⚠ Hai loại khác nhau ở CHỖ TIỀN: đổi hàng không trừ
                      đồng nào. Nhầm là sai tiền theo cả hai chiều.

                      ⚠ BỘ CHỌN NẰM RIÊNG MỘT HÀNG. Xếp cạnh bộ đếm số
                      lượng thì trên màn 375px hai khối cộng lại rộng hơn
                      thẻ (~162px + 164px + lề) — bộ đếm bị đẩy tràn ra
                      ngoài mép phải, bấm không tới nút +. */}
                  <div className="flex gap-1 rounded-[10px] bg-surface-container p-[3px]">
                    {[
                      { ex: false, label: "Trả tiền" },
                      { ex: true, label: "Đổi hàng" },
                    ].map((o) => (
                      <button
                        key={o.label}
                        type="button"
                        onClick={() => cart.patchReturnLine(i, { isExchange: o.ex })}
                        className={cn(
                          "h-10 flex-1 rounded-lg text-[13px] font-extrabold",
                          r.isExchange === o.ex
                            ? "bg-surface-container-lowest text-primary shadow-sm"
                            : "text-on-surface-variant"
                        )}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[15px] font-extrabold tabular-data">
                      {r.isExchange ? (
                        <span className="text-on-surface-variant">Đổi hàng · không trừ tiền</span>
                      ) : (
                        <>−{formatCurrency(Math.round(r.qty * r.price * (1 + (r.vatRate || 0))))}</>
                      )}
                    </span>
                    <div className="w-[164px] shrink-0">
                      <Stepper qty={r.qty} onChange={(v) => cart.setReturnQty(i, v)} />
                    </div>
                  </div>
                </div>
              )
            })}
            <div className="flex justify-between p-3 text-sm font-bold text-on-surface-variant">
              Trừ vào đơn
              <span className="text-[18px] font-extrabold tabular-data text-tertiary">
                −{formatCurrency(cart.returnCredit)}
              </span>
            </div>
          </section>
        )}

        <p className="px-1 text-xs font-semibold leading-relaxed text-on-surface-variant">
          Phiếu trả ở trạng thái <b>chờ duyệt</b>; kho nhập lại hàng và kế toán giảm công nợ sau khi
          quản lý duyệt. Dòng “Đổi hàng” không trừ tiền.
        </p>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-outline-variant/60 bg-surface-container-lowest/95 px-4 pb-[calc(var(--safe-b)+16px)] pt-2.5 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => router.back()}
          className="h-13 w-full rounded-2xl bg-primary py-3.5 text-base font-extrabold text-on-primary"
        >
          Xong · về đơn hàng
        </button>
      </div>
    </div>
  )
}
