"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { useSellCart } from "@/hooks/use-sell-cart"
import { useSellData } from "@/hooks/use-sell-data"
import { viMatchAllWords } from "@/lib/search"
import { SEARCH_FIELD_PROPS, HIDE_NATIVE_CLEAR } from "@/lib/ui/search-field"
import { cn, formatCurrency } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

const RENDER_CAP = 60

export default function SellCustomerPage() {
  const router = useRouter()
  const cart = useSellCart()
  const { customers, loading } = useSellData()
  const [q, setQ] = useState("")
  const [debtByCustomer, setDebtByCustomer] = useState<Record<string, number> | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // ⚠ PHẢI phân trang. Nhà phân phối có hơn 1.000 công nợ chưa tất
      // toán là chuyện thường, mà server cắt ở 1.000 dòng và KHÔNG báo —
      // khách nằm sau dòng đó sẽ hiện "nợ 0" trong khi đang nợ thật.
      const res = await fetchAllForAggregate<{ customer_id: string; amount: number; paid: number }>(
        (from, to) =>
          createClient()
            .from("receivables")
            .select("customer_id, amount, paid", { count: "exact" })
            .neq("status", "paid")
            .range(from, to)
      )
      if (cancelled) return
      if (res.error || res.truncated) {
        // Không biết thì để TRỐNG, đừng hiện 0 — 0 ở đây nghĩa là "không
        // nợ gì", và đó là câu trả lời sai cho một câu hỏi chưa đọc được.
        setDebtByCustomer(null)
        return
      }
      const m: Record<string, number> = {}
      for (const r of res.rows) {
        m[r.customer_id] = (m[r.customer_id] || 0) + (Number(r.amount) - Number(r.paid))
      }
      setDebtByCustomer(m)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const list = useMemo(() => {
    const term = q.trim()
    const base = term
      ? customers.filter((c) =>
          viMatchAllWords(term, c.store_name, c.owner_name ?? "", c.phone ?? "", c.address ?? "")
        )
      : customers
    return base.slice(0, RENDER_CAP)
  }, [q, customers])

  return (
    <div className="flex min-h-screen flex-col bg-surface pb-nav">
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1.5 pt-0.5">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Quay lại"
          className="tap grid h-11 w-11 place-items-center text-on-surface"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <h1 className="flex-1 text-[22px] font-extrabold">Chọn khách hàng</h1>
      </div>

      <div className="px-4 pb-2.5">
        <div className="relative">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tên cửa hàng, SĐT, chủ quán…"
            aria-label="Tìm khách hàng"
            {...SEARCH_FIELD_PROPS}
            className={cn(
              "h-11 w-full rounded-xl border-0 bg-surface-container px-3.5 text-base font-semibold outline-none",
              HIDE_NATIVE_CLEAR
            )}
          />
        </div>
      </div>

      <div className="grid content-start gap-2 px-3 pb-6">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)
        ) : list.length === 0 ? (
          <p className="py-10 text-center text-sm text-on-surface-variant">
            {q.trim() ? `Không tìm thấy khách khớp “${q.trim()}”` : "Chưa có khách hàng nào"}
          </p>
        ) : (
          list.map((c) => {
            const picked = c.id === cart.customerId
            const debt = debtByCustomer?.[c.id]
            const limit = Number(c.credit_limit || 0)
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  cart.setCustomerId(c.id)
                  // Điều khoản mặc định lấy theo khách — nhân viên không
                  // phải chọn lại thứ đã thoả thuận từ trước.
                  if (!cart.paymentTerms && c.payment_terms) cart.setPaymentTerms(c.payment_terms)
                  router.back()
                }}
                className={cn(
                  "flex items-center gap-3 rounded-2xl border-[1.5px] bg-surface-container-lowest p-3 text-left shadow-sm",
                  picked ? "border-primary" : "border-transparent"
                )}
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-[15px] font-extrabold text-primary">
                  {c.store_name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-extrabold">{c.store_name}</span>
                  <span className="mt-0.5 block truncate text-xs font-semibold text-on-surface-variant">
                    {[c.owner_name, c.phone].filter(Boolean).join(" · ") || "—"}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  {/* ⚠ Chưa đọc được công nợ thì hiện "—", không hiện 0. */}
                  <span
                    className={cn(
                      "block text-[13px] font-extrabold tabular-data",
                      debt === undefined
                        ? "text-on-surface-variant"
                        : limit > 0 && debt >= limit
                          ? "text-error"
                          : "text-on-surface"
                    )}
                  >
                    {debt === undefined ? "—" : formatCurrency(debt)}
                  </span>
                  <span className="block text-[11px] font-semibold text-on-surface-variant">
                    {limit > 0 ? `HM ${formatCurrency(limit)}` : "không hạn mức"}
                  </span>
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
