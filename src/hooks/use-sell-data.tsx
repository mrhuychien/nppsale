"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react"
import { createClient } from "@/lib/supabase/client"
import {
  loadSellRefData,
  peekCachedSellRefData,
  type SellProduct,
  type SellRefData,
  loadSellStock,
} from "@/lib/sell/ref-data"
import {
  isSellRefDataFresh,
  loadSellRefDataShared,
  peekSellRefData,
  isSellCatalogFresh,
  isCachedCatalogFresh,
  seedSellRefData,
  refreshSellStockShared,
} from "@/lib/sell/ref-store"
import { viMatchKey, viQueryWords, viSearchKey } from "@/lib/search"
import type { Customer } from "@/types"

/**
 * Danh mục dùng chung cho cả luồng bán hàng.
 *
 * ⚠ TẢI MỘT LẦN CHO CẢ LUỒNG. Mỗi màn tự tải lấy thì đi từ danh sách hàng
 * sang giỏ rồi quay lại là ba lần kéo về 1.700 sản phẩm — trên 3G ở quầy
 * khách, mỗi lần chuyển màn là một lần chờ.
 *
 * ⚠ VÀ GIỮ QUA VIỆC RỜI LUỒNG. Provider này đóng khi người dùng sang
 * /orders và mở lại khi họ quay về; bản đầu tải lại từ đầu ở mỗi lần mở.
 * Nay bản đã có (RAM, hoặc IndexedDB) HIỆN NGAY và bản mới tải ngầm —
 * xem `@/lib/sell/ref-store`.
 */

/**
 * Trí nhớ của màn danh sách hàng.
 *
 * ⚠ VÌ SAO. Chạm một thẻ là sang giỏ; từ giỏ chạm "tìm" là về danh sách —
 * và danh sách MỞ LẠI TỪ ĐẦU: ô tìm trống, cuộn về đỉnh. Nhân viên vừa gõ
 * "coca" để lấy thùng thứ nhất phải gõ lại "coca" cho thùng thứ hai. App
 * gốc không quên chỗ người ta vừa đứng. Đây là ref, không phải state: đổi
 * nó không được vẽ lại gì cả.
 */
export interface ListMemory {
  q: string
  scrollY: number
  tab: "freq" | "all"
}

interface SellDataValue {
  products: SellProduct[]
  customers: Customer[]
  stockByProduct: Record<string, number>
  loading: boolean
  /** Chuyện phải nói với người dùng. Rỗng nghĩa là mọi thứ bình thường. */
  warnings: string[]
  /** Đang dùng bản lưu ngoại tuyến vì KHÔNG có mạng. */
  offline: boolean
  /** Tải lại danh mục. Màn hình rỗng phải có đường đi tiếp, không phải ngõ cụt. */
  reload: () => void
  productById: (id: string) => SellProduct | undefined
  customerById: (id: string | null) => Customer | undefined
  /**
   * Lọc theo CHỈ MỤC đã chuẩn hoá sẵn — xem `viSearchKey`. Trả mảng con
   * của `products`, giữ thứ tự gốc, chưa sắp xếp.
   */
  filterProducts: (term: string) => SellProduct[]
  filterCustomers: (term: string) => Customer[]
  listMemory: MutableRefObject<ListMemory>
}

const Ctx = createContext<SellDataValue | null>(null)

export function SellDataProvider({ children }: { children: React.ReactNode }) {
  const [products, setProducts] = useState<SellProduct[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [stockByProduct, setStockByProduct] = useState<Record<string, number>>({})
  const [warnings, setWarnings] = useState<string[]>([])
  const [offline, setOffline] = useState(false)
  const [loading, setLoading] = useState(true)
  const listMemory = useRef<ListMemory>({ q: "", scrollY: 0, tab: "freq" })
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
    /** Đã có gì trên màn chưa — quyết định có được thay bằng bản kém hơn không. */
    let shown = false

    const apply = (d: SellRefData, fromNetwork: boolean) => {
      setProducts(d.products)
      setCustomers(d.customers)
      setStockByProduct(d.stockByProduct)
      setWarnings(d.warnings)
      // Bản lưu hiện TRƯỚC trong lúc tải không phải "ngoại tuyến" — bản
      // mới đang về. Chỉ máy chủ mới quyết được cờ này.
      if (fromNetwork) setOffline(d.source === "cache")
      setLoading(false)
      shown = true
    }

    ;(async () => {
      const mem = peekSellRefData()
      if (mem) {
        apply(mem, false)
        // Còn tươi và không phải người dùng bấm "Tải lại" → xong, không
        // gửi gì cả. Đây là đường đi của "quay lại /sell từ /orders".
        if (isSellRefDataFresh() && tick === 0) return
      } else {
        const cached = await peekCachedSellRefData()
        if (cancelled) return
        if (cached) {
          apply(cached, false)
          /* Bản trên máy chưa quá 30 phút → lấy nó làm gốc, chỉ làm mới TỒN. */
          if (isCachedCatalogFresh(cached.cachedAt)) seedSellRefData(cached, Date.parse(String(cached.cachedAt)))
        }
      }

      /**
       * ⚠ DANH MỤC CÒN MỚI → CHỈ LÀM MỚI TỒN KHO (~1/8 dữ liệu). Tồn phải mới vì
       *   chốt vượt-tồn xét trên nó; sản phẩm / giá / khách thì 30 phút một lần là
       *   đủ. Bấm "Tải lại danh mục" (`tick > 0`) vẫn tải đủ.
       */
      if (tick === 0 && isSellCatalogFresh()) {
        const stock = await refreshSellStockShared(() => loadSellStock(createClient()))
        if (cancelled) return
        if (stock) {
          setStockByProduct(stock)
          return
        }
        // Đọc tồn hỏng → rơi xuống tải đủ như cũ (có sẵn nhánh báo lỗi / bản lưu).
      }

      const data = await loadSellRefDataShared(() => loadSellRefData(createClient()))
      if (cancelled) return
      // ⚠ Đang hiện một bản tốt thì KHÔNG thay bằng bản rỗng hay bản cache
      // — chỉ gắn lời cảnh báo (mất mạng, hết phiên…) lên trên. Thay là
      // xoá sạch danh sách người ta đang gõ dở.
      if (data.source === "server" || !shown) apply(data, true)
      else setWarnings(data.warnings)
    })()

    return () => {
      cancelled = true
    }
  }, [tick])

  const productIndex = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const customerIndex = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])

  /**
   * ⚠ CHỈ MỤC TÌM KIẾM — chuẩn hoá MỘT LẦN khi danh mục về, không phải ở
   * mỗi phím gõ. Xem `viSearchKey`. 1.700 sản phẩm × 3 trường mất ~10 ms
   * một lần; sau đó mỗi phím gõ chỉ còn 1.700 phép `includes`.
   */
  const productKeys = useMemo(
    () => products.map((p) => viSearchKey(p.name, p.sku, p.barcode ?? "")),
    [products]
  )
  const customerKeys = useMemo(
    () =>
      customers.map((c) =>
        viSearchKey(c.store_name, c.owner_name ?? "", c.phone ?? "", c.address ?? "")
      ),
    [customers]
  )

  const filterProducts = useCallback(
    (term: string) => {
      const words = viQueryWords(term)
      if (!words.length) return products
      const out: SellProduct[] = []
      for (let i = 0; i < products.length; i++) {
        if (viMatchKey(productKeys[i], words)) out.push(products[i])
      }
      return out
    },
    [products, productKeys]
  )
  const filterCustomers = useCallback(
    (term: string) => {
      const words = viQueryWords(term)
      if (!words.length) return customers
      const out: Customer[] = []
      for (let i = 0; i < customers.length; i++) {
        if (viMatchKey(customerKeys[i], words)) out.push(customers[i])
      }
      return out
    },
    [customers, customerKeys]
  )

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
      filterProducts,
      filterCustomers,
      listMemory,
    }),
    [
      products,
      customers,
      stockByProduct,
      loading,
      warnings,
      offline,
      reload,
      productIndex,
      customerIndex,
      filterProducts,
      filterCustomers,
    ]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSellData(): SellDataValue {
  const v = useContext(Ctx)
  if (!v) throw new Error("useSellData phải nằm trong <SellDataProvider>")
  return v
}
