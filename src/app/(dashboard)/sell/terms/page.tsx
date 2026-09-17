"use client"

import { useRouter } from "next/navigation"
import { ChevronLeft, Check } from "lucide-react"
import { useSellCart } from "@/hooks/use-sell-cart"
import { useSellData } from "@/hooks/use-sell-data"
import { PAYMENT_TERMS } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { vnToday, VN_OFFSET } from "@/lib/inventory/opening-stock"

/**
 * Chip ngày giao nhanh.
 *
 * ⚠ Tính theo lịch VIỆT NAM, không theo giờ máy chủ. Vercel chạy UTC nên
 * từ 17h chiều trở đi "hôm nay" của máy chủ đã là hôm qua của người dùng —
 * và nhân viên chọn "Hôm nay" lại ra ngày hôm trước.
 */
function quickDates(now: Date): Array<{ label: string; value: string }> {
  const today = vnToday(now)
  const plus = (days: number) => {
    const d = new Date(`${today}T12:00:00${VN_OFFSET}`)
    d.setDate(d.getDate() + days)
    return vnToday(d)
  }
  return [
    { label: "Hôm nay", value: today },
    { label: "Ngày mai", value: plus(1) },
    { label: "3 ngày nữa", value: plus(3) },
  ]
}

export default function SellTermsPage() {
  const router = useRouter()
  const cart = useSellCart()
  const { customerById } = useSellData()
  const customer = customerById(cart.customerId)
  const effectiveTerms = cart.paymentTerms || customer?.payment_terms || ""
  const dates = quickDates(new Date())

  return (
    <div className="flex min-h-screen flex-col bg-surface pb-24">
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1.5 pt-0.5">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Quay lại"
          className="tap grid h-11 w-11 place-items-center text-on-surface"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <h1 className="flex-1 text-[22px] font-extrabold">Điều khoản &amp; giao hàng</h1>
      </div>

      <div className="grid content-start gap-2.5 px-3 pt-1">
        <section className="rounded-2xl bg-surface-container-lowest p-3.5 shadow-card">
          <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-on-surface-variant">
            Thanh toán
          </p>
          <div className="grid gap-1.5">
            {PAYMENT_TERMS.map((t) => {
              const active = effectiveTerms === t.value
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => cart.setPaymentTerms(t.value)}
                  className={cn(
                    "flex min-h-12 items-center justify-between rounded-xl border-[1.5px] px-3.5 text-left text-sm font-bold",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-outline-variant text-on-surface"
                  )}
                >
                  <span>{t.label}</span>
                  {active && <Check className="h-4 w-4" />}
                </button>
              )
            })}
          </div>
          <p className="mt-2.5 text-xs font-semibold text-on-surface-variant">
            {customer?.payment_terms
              ? `Mặc định của ${customer.store_name}: ${
                  PAYMENT_TERMS.find((t) => t.value === customer.payment_terms)?.label ??
                  customer.payment_terms
                }`
              : "Khách này chưa đặt điều khoản mặc định."}
          </p>
        </section>

        <section className="rounded-2xl bg-surface-container-lowest p-3.5 shadow-card">
          <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-on-surface-variant">
            Ngày giao dự kiến
          </p>
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {dates.map((d) => {
              const active = cart.expectedDelivery === d.value
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => cart.setExpectedDelivery(active ? "" : d.value)}
                  className={cn(
                    "h-10 whitespace-nowrap rounded-[10px] border-[1.5px] px-3.5 text-[13px] font-bold",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-outline-variant text-on-surface"
                  )}
                >
                  {d.label}
                </button>
              )
            })}
          </div>
          <input
            type="date"
            value={cart.expectedDelivery}
            onChange={(e) => cart.setExpectedDelivery(e.target.value)}
            aria-label="Ngày giao dự kiến"
            className="h-12 w-full rounded-xl border-0 bg-surface-container px-3.5 text-base font-semibold outline-none"
          />
        </section>
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
