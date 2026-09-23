"use client"

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronLeft, Plus } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { useSellCart } from "@/hooks/use-sell-cart"
import { useSellData } from "@/hooks/use-sell-data"
import { SEARCH_FIELD_PROPS, HIDE_NATIVE_CLEAR } from "@/lib/ui/search-field"
import { cn, formatCurrency } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

const RENDER_CAP = 60

/**
 * Công nợ theo khách — MỘT bản cho cả phiên, làm mới sau `DEBT_TTL_MS`.
 *
 * ⚠ VÌ SAO. Màn này mở ở MỖI lần chọn khách, và bản đầu kéo về TOÀN BỘ
 * công nợ chưa tất toán của cả đơn vị ở mỗi lần mở — hàng nghìn dòng, phân
 * trang nhiều request, cho một con số đã có cách đây 30 giây. Công nợ đổi
 * theo ngày, không theo cú chạm.
 *
 * `null` = chưa đọc được → hiện "—", không hiện 0.
 */
const DEBT_TTL_MS = 2 * 60_000
let debtMemo: { map: Record<string, number> | null; at: number } | null = null
let debtInflight: Promise<Record<string, number> | null> | null = null

async function loadDebtByCustomer(): Promise<Record<string, number> | null> {
  if (debtMemo && Date.now() - debtMemo.at < DEBT_TTL_MS) return debtMemo.map
  if (debtInflight) return debtInflight
  debtInflight = (async () => {
    // ⚠ PHẢI phân trang. Nhà phân phối có hơn 1.000 công nợ chưa tất
    // toán là chuyện thường, mà server cắt ở 1.000 dòng và KHÔNG báo —
    // khách nằm sau dòng đó sẽ hiện "nợ 0" trong khi đang nợ thật.
    const res = await fetchAllForAggregate<{ customer_id: string; amount: number; paid: number }>(
      (from, to) =>
        createClient()
          .from("receivables")
          .select("customer_id, amount, paid", { count: "exact" })
          .neq("status", "paid")
          // ⚠ THỨ TỰ DUY NHẤT. Các trang chạy SONG SONG; không `.order`
          //   thì Postgres trả mỗi trang một kiểu — một phiếu nợ bị cộng
          //   hai lần, phiếu khác rơi mất, nợ của khách lệch mà không báo.
          .order("id")
          .range(from, to)
    )
    if (res.error || res.truncated) {
      // Không biết thì để TRỐNG, đừng hiện 0 — 0 ở đây nghĩa là "không
      // nợ gì", và đó là câu trả lời sai cho một câu hỏi chưa đọc được.
      // ⚠ Và KHÔNG ghi nhớ lần đọc hỏng: lần mở sau phải thử lại.
      return null
    }
    const m: Record<string, number> = {}
    for (const r of res.rows) {
      m[r.customer_id] = (m[r.customer_id] || 0) + (Number(r.amount) - Number(r.paid))
    }
    debtMemo = { map: m, at: Date.now() }
    return m
  })().finally(() => {
    debtInflight = null
  })
  return debtInflight
}

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
        {/*
          ⚠ TẠO KHÁCH NGAY TỪ ĐÂY. Cửa hàng chưa có trong danh mục là
            chuyện xảy ra giữa lúc bán; bắt NVBH thoát ra, vào Khách hàng,
            tạo, rồi tự tìm đường về giỏ là đủ lâu để họ bỏ luôn đơn.
          ⚠ `?next=` để tạo xong quay lại ĐÂY và chọn sẵn khách vừa tạo.
        */}
        <button
          type="button"
          onClick={() => router.push("/customers/new?next=/sell/customer")}
          aria-label="Tạo khách hàng mới"
          className="tap flex h-11 items-center gap-1.5 rounded-xl px-3 font-extrabold text-primary"
        >
          <Plus className="h-6 w-6" />
          {/* Điện thoại chỉ còn dấu + — hàng tiêu đề không đủ chỗ cho chữ. */}
          <span className="hidden text-[15px] sm:inline">Tạo khách mới</span>
        </button>
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
        {pickWait ? (
          <p className="py-10 text-center text-sm font-semibold text-on-surface-variant">
            Đang nạp khách vừa tạo…
          </p>
        ) : loading ? (
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
                  {/* ⚠ CÒN ĐƯỢC NỢ mới là con số quyết định đơn sắp ghi có
                      phải chờ duyệt hay không. Hạn mức và dư nợ đứng cạnh
                      nhau bắt nhân viên trừ nhẩm ngay lúc khách đang đứng
                      đợi — và trừ nhẩm sai thì biết vào lúc bấm gửi. */}
                  {limit > 0 && debt !== undefined && (
                    <span
                      className={cn(
                        "block text-[11px] font-extrabold tabular-data",
                        limit - debt <= 0 ? "text-error" : "text-on-surface-variant"
                      )}
                    >
                      Còn được nợ {formatCurrency(Math.max(0, limit - debt))}
                    </span>
                  )}
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
