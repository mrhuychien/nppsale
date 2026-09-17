"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { loadSellRefData, type SellProduct } from "@/lib/sell/ref-data"
import type { Customer } from "@/types"

/**
 * Danh mục dùng chung cho cả luồng bán hàng.
 *
 * ⚠ TẢI MỘT LẦN CHO CẢ LUỒNG. Mỗi màn tự tải lấy thì đi từ danh sách hàng
 * sang giỏ rồi quay lại là ba lần kéo về 1.700 sản phẩm — trên 3G ở quầy
 * khách, mỗi lần chuyển màn là một lần chờ.
 */
interface SellDataValue {
  products: SellProduct[]
  customers: Customer[]
  stockByProduct: Record<string, number>
  loading: boolean
  /** Chuyện phải nói với người dùng. Rỗng nghĩa là mọi thứ bình thường. */
  warnings: string[]
  /** Đang dùng bản lưu ngoại tuyến. */
  offline: boolean
  /** Tải lại danh mục. Màn hình rỗng phải có đường đi tiếp, không phải ngõ cụt. */
  reload: () => void
  productById: (id: string) => SellProduct | undefined
  customerById: (id: string | null) => Customer | undefined
}

const Ctx = createContext<SellDataValue | null>(null)

export function SellDataProvider({ children }: { children: React.ReactNode }) {
  const [products, setProducts] = useState<SellProduct[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [stockByProduct, setStockByProduct] = useState<Record<string, number>>({})
  const [warnings, setWarnings] = useState<string[]>([])
  const [offline, setOffline] = useState(false)
  const [loading, setLoading] = useState(true)
  /**
   * ⚠ Bản đầu nạp ĐÚNG MỘT LẦN với `[]` và không có đường tải lại. Danh
   * mục rỗng vì phiên hết hạn, vì mạng chập, vì bất cứ gì — màn hình ở
   * nguyên trạng thái rỗng đó cho tới khi người dùng tự nghĩ ra là phải
   * tắt app mở lại. Đó là ngõ cụt, và ngõ cụt thì người dùng đọc thành
   * "phần mềm hỏng".
   */
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const data = await loadSellRefData(createClient())
      if (cancelled) return
      setProducts(data.products)
      setCustomers(data.customers)
      setStockByProduct(data.stockByProduct)
      setWarnings(data.warnings)
      setOffline(data.source === "cache")
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [tick])

  const productIndex = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const customerIndex = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])

  const value = useMemo<SellDataValue>(
    () => ({
      products,
      customers,
      stockByProduct,
      loading,
      warnings,
      offline,
      reload,
      productById: (id) => productIndex.get(id),
      customerById: (id) => (id ? customerIndex.get(id) : undefined),
    }),
    [products, customers, stockByProduct, loading, warnings, offline, reload, productIndex, customerIndex]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSellData(): SellDataValue {
  const v = useContext(Ctx)
  if (!v) throw new Error("useSellData phải nằm trong <SellDataProvider>")
  return v
}
