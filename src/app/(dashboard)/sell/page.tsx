"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Search, ScanBarcode, FileText, History, ChevronRight, User, Tag } from "lucide-react"
import { useSellCart } from "@/hooks/use-sell-cart"
import { useSellData } from "@/hooks/use-sell-data"
import { ProductCard } from "@/components/sell/product-card"
import type { SellProduct } from "@/lib/sell/ref-data"
import { conversionFor, selectedUnitOf, unitPriceFor } from "@/lib/sell/pricing"
import { findLine } from "@/lib/sell/cart"
import { fetchFrequentProducts } from "@/lib/orders/frequent-products"
import { viMatchAllWords } from "@/lib/search"
import { compareByStockDesc } from "@/lib/orders/product-order"
import { SEARCH_FIELD_PROPS, HIDE_NATIVE_CLEAR } from "@/lib/ui/search-field"
import { cn, formatCurrency } from "@/lib/utils"
import { toast } from "@/hooks/use-toast"
import { Skeleton } from "@/components/ui/skeleton"

/** Trần số thẻ vẽ một lúc — 1.700 thẻ thì điện thoại đứng hình. */
const RENDER_CAP = 60

export default function SellPage() {
  const router = useRouter()
  const cart = useSellCart()
  // ⚠ Cảnh báo tải danh mục phải NÓI RA. Danh mục thiếu một khúc mà im
  // lặng là để nhân viên gõ đúng mã có thật rồi kết luận "tìm kiếm hỏng".
  const { products, stockByProduct, loading, warnings: loadWarnings, customerById } = useSellData()

  const [q, setQ] = useState("")
  const [unitSel, setUnitSel] = useState<Record<string, string>>({})
  const [tab, setTab] = useState<"freq" | "all">("freq")
  const [frequentIds, setFrequentIds] = useState<string[]>([])

  const customer = customerById(cart.customerId) ?? null
  const groupId = customer?.group_id ?? null

  useEffect(() => {
    if (!cart.customerId) {
      setFrequentIds([])
      setTab("all")
      return
    }
    let cancelled = false
    fetchFrequentProducts(cart.customerId)
      .then((ids) => {
        if (cancelled) return
        setFrequentIds(ids)
        setTab(ids.length ? "freq" : "all")
      })
      // Đây là tiện ích SẮP XẾP. Hỏng nó không được chặn việc bán hàng.
      .catch(() => {
        if (!cancelled) setFrequentIds([])
      })
    return () => {
      cancelled = true
    }
  }, [cart.customerId])

  // Phép chọn đơn vị nằm ở lib dùng chung — màn hàng trả cũng dùng đúng
  // phép đó, để hai màn không mặc định hai đơn vị khác nhau.
  const unitOf = useCallback((p: SellProduct) => selectedUnitOf(unitSel, p), [unitSel])

  const byStock = useMemo(() => compareByStockDesc(stockByProduct), [stockByProduct])

  const list = useMemo(() => {
    const term = q.trim()
    if (term) {
      return products
        .filter((p) => viMatchAllWords(term, p.name, p.sku, p.barcode ?? ""))
        .sort(byStock)
        .slice(0, RENDER_CAP)
    }
    if (tab === "freq" && frequentIds.length) {
      const rank = new Map(frequentIds.map((id, i) => [id, i]))
      return products
        .filter((p) => rank.has(p.id))
        .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
        .slice(0, RENDER_CAP)
    }
    return [...products].sort(byStock).slice(0, RENDER_CAP)
  }, [q, products, tab, frequentIds, byStock])

  const addToCart = (p: SellProduct) => {
    const onHand = stockByProduct[p.id] ?? 0
    if (onHand <= 0) {
      toast({ title: `Hết hàng: ${p.name}`, variant: "destructive" })
      return
    }
    const unit = unitOf(p)
    const price = unitPriceFor(p, unit, groupId)
    cart.addLine({
      productId: p.id,
      unit,
      qty: 1,
      price,
      listPrice: price,
      note: "",
      conversion: conversionFor(p, unit),
      vatRate: Number(p.vat_rate ?? 0),
    })
    // Chạm xong đi thẳng vào giỏ: người dùng cần thấy dòng vừa thêm và số
    // lượng của nó, không phải đoán xem cú chạm có ăn không.
    router.push("/sell/cart")
  }

  const cartCount = cart.cart.length
  const showTabs = frequentIds.length > 0 && !q.trim()

  return (
    <div className="flex min-h-screen flex-col bg-surface pb-nav">
      <div className="shrink-0 px-4 pb-2.5 pt-1.5">
        <div className="flex h-10 items-center justify-between">
          <h1 className="text-2xl font-extrabold tracking-tight text-on-surface">
            {cartCount ? "Thêm hàng" : "Đặt hàng"}
          </h1>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => router.push("/sell/drafts")}
              aria-label="Đơn tạm"
              className="tap grid h-11 w-11 place-items-center rounded-xl text-on-surface"
            >
              <FileText className="h-[22px] w-[22px]" />
            </button>
            <button
              type="button"
              onClick={() => router.push("/orders")}
              aria-label="Lịch sử đơn"
              className="tap grid h-11 w-11 place-items-center rounded-xl text-on-surface"
            >
              <History className="h-[22px] w-[22px]" />
            </button>
          </div>
        </div>

        <div className="mt-1.5 flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-on-surface-variant" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tên, mã hàng, mã vạch…"
              aria-label="Tìm sản phẩm"
              {...SEARCH_FIELD_PROPS}
              className={cn(
                "h-11 w-full rounded-xl border-0 bg-surface-container pl-[38px] pr-10 text-base font-semibold text-on-surface outline-none",
                HIDE_NATIVE_CLEAR
              )}
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Xoá tìm kiếm"
                className="absolute right-1 top-1 grid h-9 w-9 place-items-center text-lg text-on-surface-variant"
              >
                ×
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => router.push("/sell/scan")}
            aria-label="Quét mã"
            className="tap grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface-container text-on-surface"
          >
            <ScanBarcode className="h-[22px] w-[22px]" />
          </button>
        </div>

        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.push("/sell/customer")}
            className={cn(
              "flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[10px] px-3 text-left text-sm font-bold",
              customer ? "bg-primary/10 text-primary" : "bg-surface-container text-on-surface"
            )}
          >
            <User className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate">{customer?.store_name ?? "Chọn khách hàng"}</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          </button>
          {/* Bảng giá đang áp dụng — nhân viên phải biết mình đang báo giá
              theo bảng nào trước khi đọc số cho khách. */}
          <div className="flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[10px] bg-surface-container px-3 text-[13px] font-bold text-on-surface-variant">
            <Tag className="h-3.5 w-3.5" />
            {customer?.group?.name ?? "Bảng giá chung"}
          </div>
        </div>

        {showTabs && (
          <div className="mt-2.5 flex gap-1 rounded-[10px] bg-surface-container p-[3px]">
            {(["freq", "all"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  "h-8 flex-1 rounded-lg text-[13px] font-bold",
                  tab === t
                    ? "bg-surface-container-lowest text-primary shadow-sm"
                    : "text-on-surface-variant"
                )}
              >
                {t === "freq" ? "Khách hay lấy" : "Tất cả sản phẩm"}
              </button>
            ))}
          </div>
        )}
      </div>

      {loadWarnings.length > 0 && (
        <div className="mx-3 mb-2 rounded-xl bg-[#fff7e6] px-3 py-2.5 text-[13px] font-semibold leading-snug text-[#7a4b00]">
          {loadWarnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}

      <div className="grid flex-1 content-start gap-2 px-3 pb-32">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[116px] rounded-2xl" />)
        ) : list.length === 0 ? (
          <p className="py-10 text-center text-sm text-on-surface-variant">
            {q.trim() ? `Không tìm thấy sản phẩm khớp “${q.trim()}”` : "Chưa có sản phẩm nào"}
          </p>
        ) : (
          list.map((p) => {
            const unit = unitOf(p)
            const i = findLine(cart.cart, p.id, unit)
            return (
              <ProductCard
                key={p.id}
                product={p}
                baseOnHand={stockByProduct[p.id] ?? 0}
                groupId={groupId}
                unit={unit}
                onPickUnit={(u) => setUnitSel((s) => ({ ...s, [p.id]: u }))}
                onAdd={() => addToCart(p)}
                inCartQty={i >= 0 ? cart.cart[i].qty : 0}
              />
            )
          })
        )}
      </div>

      {cartCount > 0 && (
        <div className="fixed inset-x-4 bottom-[calc(var(--bottom-nav-h)+var(--safe-b)+12px)] z-30">
          <button
            type="button"
            onClick={() => router.push("/sell/cart")}
            className="flex h-14 w-full items-center gap-3 rounded-2xl bg-primary pl-4 pr-2 text-on-primary shadow-[0_12px_28px_-8px_rgba(37,99,235,.55)]"
          >
            <span className="grid h-7 min-w-7 place-items-center rounded-lg bg-white/20 px-1.5 text-sm font-extrabold">
              {cartCount}
            </span>
            <span className="flex-1 text-left text-base font-extrabold tabular-data">
              {formatCurrency(cart.totals.grandTotal)}
            </span>
            <span className="flex h-10 items-center gap-1.5 rounded-xl bg-white px-4 text-sm font-extrabold text-primary">
              Xem đơn <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
