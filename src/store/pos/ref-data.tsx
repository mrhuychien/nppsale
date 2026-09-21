"use client"

/**
 * DANH MỤC THAM CHIẾU CỦA `/pos` — khách, hàng, tồn kho.
 *
 * ⚠ DÙNG CHUNG **API**, TÁCH RIÊNG **STORE** (spec §1, §12). Hàm
 * `loadSellRefData` nằm ở `src/lib/sell/` là một hàm đọc dữ liệu — nó
 * đã gánh sẵn mọi cái bẫy đã sửa một lần: cắt 1.000 dòng im lặng,
 * thiếu cột thì thử lại bằng `*`, tồn kho chỉ cộng kho BÁN, mất mạng
 * thì rơi về bản lưu. Viết lại một bản riêng cho POS là gặp lại đúng
 * từng cái bẫy ấy.
 *
 * Cái KHÔNG được dùng chung là GIỎ: `/sell` có MỘT giỏ cho một NVBH
 * đứng ở quầy, `/pos` có NHIỀU tab chứng từ mở cùng lúc. Ép chung là
 * một trong hai bên phải chịu hình dạng của bên kia.
 */

import {
  createContext, useContext, useEffect, useMemo, useState, type ReactNode,
} from "react"
import { createClient } from "@/lib/supabase/client"
import { loadSellRefData, type SellProduct } from "@/lib/sell/ref-data"
import type { Customer } from "@/types"

interface Value {
  products: SellProduct[]
  customers: Customer[]
  stockByProduct: Record<string, number>
  loading: boolean
  /**
   * Chuyện cần nói với người dùng — RỖNG nghĩa là mọi thứ bình thường.
   *
   * ⚠ ĐỪNG NUỐT MẢNG NÀY. Nó chứa đúng những câu kiểu "danh mục quá
   * lớn, màn hình còn THIẾU một phần" — im lặng ở đây là để người dùng
   * gõ một mã có thật mà không ra kết quả rồi tự kết luận danh mục
   * thiếu mã.
   */
  warnings: string[]
  productById: (id: string) => SellProduct | undefined
  customerById: (id: string | null | undefined) => Customer | undefined
}

const Ctx = createContext<Value | null>(null)

export function PosRefDataProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<SellProduct[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [stockByProduct, setStock] = useState<Record<string, number>>({})
  const [warnings, setWarnings] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let huy = false
    ;(async () => {
      const d = await loadSellRefData(createClient())
      if (huy) return
      setProducts(d.products)
      setCustomers(d.customers)
      setStock(d.stockByProduct)
      setWarnings(d.warnings)
      setLoading(false)
    })()
    return () => { huy = true }
  }, [])

  const pIndex = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const cIndex = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])

  const value = useMemo<Value>(
    () => ({
      products,
      customers,
      stockByProduct,
      loading,
      warnings,
      productById: (id) => pIndex.get(id),
      customerById: (id) => (id ? cIndex.get(id) : undefined),
    }),
    [products, customers, stockByProduct, loading, warnings, pIndex, cIndex]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePosRefData(): Value {
  const v = useContext(Ctx)
  if (!v) throw new Error("usePosRefData phải nằm trong <PosRefDataProvider>")
  return v
}
