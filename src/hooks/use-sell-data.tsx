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
  docPhienDanhMuc,
} from "@/lib/sell/ref-data"
import {
  isSellRefDataFresh,
  loadSellRefDataShared,
  peekSellRefData,
  isSellCatalogFresh,
  addSellCustomer,
  addSellProduct,
  lamCuDanhMucBan,
  isCachedCatalogFresh,
  seedSellRefData,
  refreshSellStockShared,
  kiemPhienDanhMucShared,
  sellCatalogAt,
} from "@/lib/sell/ref-store"
import { locXepHang, taoMucTim, viQueryWords } from "@/lib/search"
import { gopVuaTao } from "@/lib/tao-nhanh/vua-tao"
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
  /** Đang tải lại danh mục theo nút "Làm mới sản phẩm". */
  refreshing: boolean
  /** Lúc danh mục đang hiện được đọc từ máy chủ (ms) — `null` = chưa biết. */
  catalogAt: number | null
  productById: (id: string) => SellProduct | undefined
  customerById: (id: string | null) => Customer | undefined
  /** Thêm khách đọc riêng từ máy chủ (không có trong danh mục đã tải) — xem `loadOneSellCustomer`. */
  addCustomer: (c: Customer) => void
  /**
   * Thêm sản phẩm vừa TẠO NHANH ở /sell (chủ nhà 03/10/2026, Update 3.10) — dạng danh mục bán (kèm bảng giá +
   * đơn vị, xem `sanPhamBanTuMoiTao`), để thẻ / giỏ / tìm kiếm thấy ngay, không tải lại 1.700 dòng.
   */
  themVaoDanhMucBan: (p: SellProduct) => void
  /**
   * Lọc theo CHỈ MỤC đã chuẩn hoá sẵn — xem `viSearchKey`. Trả mảng con
   * của `products` ĐÃ XẾP HẠNG theo độ khớp (chữ rỗng: thứ tự gốc).
   */
  filterProducts: (term: string, soPhu?: (a: SellProduct, b: SellProduct) => number) => SellProduct[]
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
  /* ⚠ BẤM "LÀM MỚI" = BẮT BUỘC tải đủ; quay lại app = chỉ KIỂM (tồn + số phiên), đổi mới tải. */
  const batBuoc = useRef(false)
  const [refreshing, setRefreshing] = useState(false)
  const [catalogAt, setCatalogAt] = useState<number | null>(null)
  const reload = useCallback(() => {
    batBuoc.current = true
    setRefreshing(true)
    setTick((t) => t + 1)
  }, [])

  /**
   * ⚠ QUAY LẠI APP THÌ KIỂM LẠI (chủ nhà 28/09/2026: sản phẩm / giá đổi mà NVBH ở yên trong /sell
   *   thì trước đây không bao giờ thấy). Chỉ khi quá `FRESH_MS` — mở / tắt màn hình liên tục không
   *   gửi gì thêm.
   */
  useEffect(() => {
    const khiHien = () => {
      if (document.visibilityState === "visible" && !isSellRefDataFresh()) setTick((t) => t + 1)
    }
    document.addEventListener("visibilitychange", khiHien)
    return () => document.removeEventListener("visibilitychange", khiHien)
  }, [])

  useEffect(() => {
    let cancelled = false
    /** Đã có gì trên màn chưa — quyết định có được thay bằng bản kém hơn không. */
    let shown = false
    const force = batBuoc.current
    batBuoc.current = false
    const xong = () => {
      if (cancelled) return
      setCatalogAt(sellCatalogAt())
      setRefreshing(false)
    }

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
        if (isSellRefDataFresh() && !force) return xong()
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
      if (!force && isSellCatalogFresh()) {
        /* Số phiên (mig 209) hỏi CÙNG LÚC với tồn — sản phẩm / giá đổi thì tải lại đủ ngay, khỏi
           đợi hết 30 phút. Không biết (sổ chưa có 209) → như cũ. */
        const sb = createClient()
        const [stock, daDoi] = await Promise.all([
          refreshSellStockShared(() => loadSellStock(sb)),
          kiemPhienDanhMucShared(() => docPhienDanhMuc(sb)),
        ])
        if (cancelled) return
        if (stock && daDoi !== true) {
          setStockByProduct(stock)
          return xong()
        }
        // Đọc tồn hỏng, hoặc danh mục đã đổi → tải đủ như cũ (có sẵn nhánh báo lỗi / bản lưu).
      }

      const data = await loadSellRefDataShared(() => loadSellRefData(createClient()))
      if (cancelled) return
      // ⚠ Đang hiện một bản tốt thì KHÔNG thay bằng bản rỗng hay bản cache
      // — chỉ gắn lời cảnh báo (mất mạng, hết phiên…) lên trên. Thay là
      // xoá sạch danh sách người ta đang gõ dở.
      if (data.source === "server" || !shown) apply(data, true)
      else setWarnings(data.warnings)
      xong()
    })()

    return () => {
      cancelled = true
    }
  }, [tick])

  const addCustomer = useCallback((c: Customer) => {
    addSellCustomer(c)
    setCustomers((ds) => gopVuaTao(ds, [c]))
  }, [])

  const themVaoDanhMucBan = useCallback((p: SellProduct) => {
    addSellProduct(p)
    /* ⚠ Một lượt tải lại đang bay (bắt đầu TRƯỚC khi tạo) về sau sẽ thay danh sách bằng bản chưa có hàng này —
       đánh dấu danh mục cũ để lần kiểm sau tải lại đủ (có hàng mới), không để giỏ trỏ vào mã vắng mặt mãi. */
    lamCuDanhMucBan()
    setProducts((ds) => gopVuaTao(ds, [p]))
  }, [])

  const productIndex = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const customerIndex = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])

  /**
   * ⚠ CHỈ MỤC TÌM KIẾM — chuẩn hoá MỘT LẦN khi danh mục về, không phải ở
   * mỗi phím gõ. Xem `viSearchKey`. 1.700 sản phẩm × 3 trường mất ~10 ms
   * một lần; sau đó mỗi phím gõ chỉ còn 1.700 phép `includes`.
   */
  const productKeys = useMemo(
    () => products.map((p) => taoMucTim(p.sku, p.barcode ?? "", p.name)),
    [products]
  )
  const customerKeys = useMemo(
    () =>
      customers.map((c) =>
        taoMucTim(c.phone ?? "", c.store_name, c.owner_name ?? "", c.address ?? "")
      ),
    [customers]
  )

  /**
   * ⚠ LỌC + XẾP HẠNG (chủ nhà 27/09/2026 — tìm "chính xác, linh hoạt"): mã /
   *   mã vạch / SĐT trùng khớp lên đầu, rồi đầu mã, đầu từ, rồi chứa; không có
   *   kết quả nào thì gợi ý gần đúng (gõ sai một chữ). `soPhu` xếp các dòng
   *   CÙNG điểm (vd theo tồn kho) — đừng `.sort()` lại sau, là mất thứ hạng.
   */
  const filterProducts = useCallback(
    (term: string, soPhu?: (a: SellProduct, b: SellProduct) => number) => {
      if (!viQueryWords(term).length) return products
      return locXepHang(products, productKeys, term, {
        soPhu: soPhu ? (a, b) => soPhu(products[a], products[b]) : undefined,
      }).ketQua
    },
    [products, productKeys]
  )
  const filterCustomers = useCallback(
    (term: string) => {
      if (!viQueryWords(term).length) return customers
      return locXepHang(customers, customerKeys, term).ketQua
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
      refreshing,
      catalogAt,
      productById: (id) => productIndex.get(id),
      customerById: (id) => (id ? customerIndex.get(id) : undefined),
      addCustomer,
      themVaoDanhMucBan,
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
      refreshing,
      catalogAt,
      productIndex,
      customerIndex,
      addCustomer,
      themVaoDanhMucBan,
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
