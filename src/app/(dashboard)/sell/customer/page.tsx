"use client"

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Check, ChevronLeft, Plus, Search } from "lucide-react"
import { DEBT_TTL_MS, debtMemo, loadDebtByCustomer } from "@/lib/sell/debt"
import { viNormalize } from "@/lib/search"
import { useSellCart } from "@/hooks/use-sell-cart"
import { useSellData } from "@/hooks/use-sell-data"
import { SEARCH_FIELD_PROPS, HIDE_NATIVE_CLEAR } from "@/lib/ui/search-field"
import { cn, formatCurrency } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

const RENDER_CAP = 60

export default function SellCustomerPage() {
  const router = useRouter()
  const params = useSearchParams()
  const cart = useSellCart()
  const { loading, filterCustomers, customerById, reload } = useSellData()
  const [q, setQ] = useState("")
  const [debtByCustomer, setDebtByCustomer] = useState<Record<string, number> | null>(
    () => (debtMemo && Date.now() - debtMemo.at < DEBT_TTL_MS ? debtMemo.map : null)
  )

  useEffect(() => {
    let cancelled = false
    loadDebtByCustomer().then((m) => {
      if (!cancelled) setDebtByCustomer(m)
    })
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * VỪA TẠO KHÁCH XONG THÌ CHỌN LUÔN KHÁCH ẤY.
   *
   * NVBH đứng ở cửa hàng mới: bấm +, nhập điểm bán, rồi bán ngay. Trả họ
   * về màn này với một danh sách y như cũ là bắt gõ lại tên vừa nhập để
   * tự tìm — và giỏ hàng đang dở thì vẫn nằm đó, chỉ là không ai nói.
   *
   * ⚠ DANH MỤC TRONG MÁY CHƯA CÓ KHÁCH VỪA TẠO. `useSellData` giữ một bản
   *   nạp sẵn; không gọi `reload()` thì khách mới không nằm trong đó, và
   *   màn /sell hiện lại chữ "Chọn khách hàng" như chưa chọn gì — trong
   *   khi giỏ đã gắn đúng mã. Nên: gắn mã ngay (giỏ đúng từ giây đầu),
   *   gọi `reload()`, và CHỜ tên hiện ra rồi mới đi tiếp.
   *
   * ⚠ CÓ ĐƯỜNG THOÁT. Đọc lại hỏng thì không kẹt ở đây mãi — sau 8 giây
   *   vẫn đi tiếp, vì mã khách đã đúng và chỉ thiếu cái tên.
   */
  const picked = params.get("picked")
  const [pickWait, setPickWait] = useState(false)
  const pickDone = useRef(false)

  useEffect(() => {
    if (!picked || pickDone.current) return
    pickDone.current = true
    cart.setCustomerId(picked)
    setPickWait(true)
    reload()
    const bail = setTimeout(() => router.replace("/sell"), 8000)
    return () => clearTimeout(bail)
  }, [picked]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pickWait || !picked) return
    const c = customerById(picked)
    if (!c) return
    // Điều khoản mặc định theo khách, y như khi chọn từ danh sách.
    if (!cart.paymentTerms && c.payment_terms) cart.setPaymentTerms(c.payment_terms)
    router.replace("/sell")
  }, [pickWait, picked, customerById]) // eslint-disable-line react-hooks/exhaustive-deps

  // Chữ gõ vào ô là việc khẩn; lọc lại danh sách theo sau — xem màn /sell.
  const deferredQ = useDeferredValue(q)
  const list = useMemo(
    () => filterCustomers(deferredQ.trim()).slice(0, RENDER_CAP),
    [deferredQ, filterCustomers]
  )

  /* Nhóm theo chữ cái đầu (2c) — bỏ dấu để "Ánh" nằm cùng "Anh". */
  const nhom = useMemo(() => {
    const m = new Map<string, typeof list>()
    for (const c of list) {
      const L = (viNormalize(c.store_name.trim()).charAt(0) || "#").toUpperCase()
      const k = /[A-Z]/.test(L) ? L : "#"
      m.set(k, [...(m.get(k) ?? []), c])
    }
    return Array.from(m.entries())
  }, [list])

  return (
    <div className="flex min-h-screen flex-col bg-surface-container-low pb-6">
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-border bg-surface-container-lowest px-4 pb-3 pt-3.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Quay lại"
            className="-ml-2 grid h-9 w-9 place-items-center text-on-surface"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="min-w-0 flex-1 text-[19px] font-bold">Chọn khách hàng</h1>
          {/*
            ⚠ TẠO KHÁCH NGAY TỪ ĐÂY (cửa hàng mới giữa lúc bán); `?next=` để tạo
              xong quay lại ĐÂY và chọn sẵn khách vừa tạo.
          */}
          <button
            type="button"
            onClick={() => router.push("/customers/new?next=/sell/customer")}
            aria-label="Tạo khách hàng mới"
            className="flex h-9 items-center gap-1 rounded-[10px] bg-primary/10 px-3 text-[13px] font-semibold text-primary"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.6} />
            Khách mới
          </button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tên cửa hàng, SĐT, địa chỉ…"
            aria-label="Tìm khách hàng"
            {...SEARCH_FIELD_PROPS}
            className={cn(
              "h-11 w-full rounded-xl border-0 bg-surface-container-low pl-[38px] pr-3 text-[14px] outline-none",
              HIDE_NATIVE_CLEAR
            )}
          />
        </div>
      </div>

      <div className="flex flex-col px-3 pt-1">
        {pickWait ? (
          <p className="py-10 text-center text-sm font-semibold text-muted-foreground">Đang nạp khách vừa tạo…</p>
        ) : loading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="mt-2 h-16 rounded-[14px]" />)
        ) : list.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {q.trim() ? `Không tìm thấy khách khớp “${q.trim()}”` : "Chưa có khách hàng nào"}
          </p>
        ) : (
          nhom.map(([chu, ds]) => (
            <div key={chu} className="flex flex-col">
              <p className="px-1 pb-1.5 pt-3 text-[12px] font-bold text-muted-foreground">{chu}</p>
              <div className="flex flex-col overflow-hidden rounded-[14px] bg-surface-container-lowest">
                {ds.map((c) => {
                  const dangChon = c.id === cart.customerId
                  const debt = debtByCustomer?.[c.id]
                  const limit = Number(c.credit_limit || 0)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={dangChon}
                      onClick={() => {
                        cart.setCustomerId(c.id)
                        // Điều khoản mặc định lấy theo khách.
                        if (!cart.paymentTerms && c.payment_terms) cart.setPaymentTerms(c.payment_terms)
                        router.back()
                      }}
                      className={cn(
                        "flex items-center gap-3 border-b border-border/60 p-3 text-left last:border-0",
                        dangChon ? "bg-primary/[0.05]" : ""
                      )}
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-primary/10 text-[14px] font-bold text-primary">
                        {c.store_name.trim().charAt(0).toUpperCase()}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-[14px] font-semibold text-on-surface">{c.store_name}</span>
                        <span className="truncate text-[12px] text-muted-foreground">
                          {c.address || [c.owner_name, c.phone].filter(Boolean).join(" · ") || "—"}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-0.5">
                        <span className="text-[11px] text-muted-foreground">Công nợ</span>
                        {/* ⚠ Chưa đọc được công nợ thì "—", không hiện 0. */}
                        <span
                          className={cn(
                            "text-[14px] font-semibold tabular-data",
                            debt !== undefined && limit > 0 && debt >= limit ? "text-error" : "text-on-surface"
                          )}
                        >
                          {debt === undefined || debt === 0 ? "—" : formatCurrency(debt)}
                        </span>
                        {/* ⚠ CÒN ĐƯỢC NỢ quyết định đơn có phải chờ duyệt — chỉ khi có hạn mức. */}
                        {limit > 0 && debt !== undefined && (
                          <span className={cn("text-[11px] font-semibold tabular-data", limit - debt <= 0 ? "text-error" : "text-muted-foreground")}>
                            Còn được nợ {formatCurrency(Math.max(0, limit - debt))}
                          </span>
                        )}
                      </span>
                      {dangChon && <Check aria-label="Đang chọn" className="h-[18px] w-[18px] shrink-0 text-primary" strokeWidth={2.6} />}
                    </button>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
