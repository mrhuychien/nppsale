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
import { loadSuppliers, loadSellers, type PosSupplier, type PosSeller } from "@/lib/pos/load"
import { useAuth } from "@/hooks/use-auth"
import type { Customer } from "@/types"

interface Value {
  products: SellProduct[]
  customers: Customer[]
  /**
   * ⚠ NCC VÀ NVBH NẠP RIÊNG, KHÔNG NHÉT VÀO `loadSellRefData`. Hàm ấy
   * phục vụ `/sell` trên điện thoại — NVBH ngoài quầy không cần danh
   * mục nhà cung cấp, và mỗi cột thêm vào đó là thêm dữ liệu tải về
   * đúng những máy có đường truyền kém nhất.
   */
  suppliers: PosSupplier[]
  sellers: PosSeller[]
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
  supplierById: (id: string | null | undefined) => PosSupplier | undefined
}

const Ctx = createContext<Value | null>(null)

export function PosRefDataProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<SellProduct[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [stockByProduct, setStock] = useState<Record<string, number>>({})
  const [suppliers, setSuppliers] = useState<PosSupplier[]>([])
  const [sellers, setSellers] = useState<PosSeller[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const { user } = useAuth()

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

  /**
   * ⚠ ĐỌC HỎNG THÌ IM, KHÔNG CHẶN. Thiếu danh mục NCC làm màn mua hàng
   * không chọn được đối tác — và màn ấy đã nói ra điều đó ngay trong ô
   * tìm. Ném lỗi ở đây là cả `/pos` trắng vì một danh mục phụ.
   */
  useEffect(() => {
    if (!user?.org_id) return
    let huy = false
    ;(async () => {
      const sb = createClient()
      const [ncc, nv] = await Promise.all([
        loadSuppliers(sb).catch(() => [] as PosSupplier[]),
        loadSellers(sb, user.org_id).catch(() => [] as PosSeller[]),
      ])
      if (huy) return
      setSuppliers(ncc)
      setSellers(nv)
    })()
    return () => { huy = true }
  }, [user?.org_id])

  const pIndex = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const cIndex = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])
  const sIndex = useMemo(() => new Map(suppliers.map((x) => [x.id, x])), [suppliers])

  const value = useMemo<Value>(
    () => ({
      products,
      customers,
      suppliers,
      sellers,
      stockByProduct,
      loading,
      warnings,
      productById: (id) => pIndex.get(id),
      customerById: (id) => (id ? cIndex.get(id) : undefined),
      supplierById: (id) => (id ? sIndex.get(id) : undefined),
    }),
    [products, customers, suppliers, sellers, stockByProduct, loading, warnings, pIndex, cIndex, sIndex]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePosRefData(): Value {
  const v = useContext(Ctx)
  if (!v) throw new Error("usePosRefData phải nằm trong <PosRefDataProvider>")
  return v
}
