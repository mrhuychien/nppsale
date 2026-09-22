"use client"

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Search, ScanBarcode, FileText, History, ChevronRight, User, Tag, RotateCcw } from "lucide-react"
import { useSellCart } from "@/hooks/use-sell-cart"
import { useSellData } from "@/hooks/use-sell-data"
import { useCommittedStock } from "@/hooks/use-committed-stock"
import { addOverstockWarning, availableMapFrom } from "@/lib/sell/committed"
import { ProductCard } from "@/components/sell/product-card"
import { SellCustomerDeepLink } from "@/components/sell/customer-deeplink"
import { conversionFor, selectedUnitOf, unitPriceFor, type PricedProduct } from "@/lib/sell/pricing"
import { findLine } from "@/lib/sell/cart"
import { findReturnLine } from "@/lib/sell/returns"
import { backToReturnSlip } from "@/lib/nav/sell-nav"
import { fetchFrequentProducts } from "@/lib/orders/frequent-products"
import { compareByStockDesc } from "@/lib/orders/product-order"
import { SEARCH_FIELD_PROPS, HIDE_NATIVE_CLEAR } from "@/lib/ui/search-field"
import { cn, formatCurrency } from "@/lib/utils"
import { toast } from "@/hooks/use-toast"
import { Skeleton } from "@/components/ui/skeleton"
import { PosDesktopRedirect } from "@/components/sell/pos-desktop-redirect"
import { posNewOrderHref } from "@/lib/nav/pos-preview"

/** Trần số thẻ vẽ một lúc — 1.700 thẻ thì điện thoại đứng hình. */
const RENDER_CAP = 60

export default function SellPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const cart = useSellCart()
  /**
   * Màn này làm HAI việc: chọn hàng BÁN, và chọn hàng TRẢ.
   *
   * ⚠ DÙNG CHUNG MỘT MÀN TÌM HÀNG, KHÔNG DỰNG BẢN THỨ HAI. Màn hàng trả
   * trước đây có ô tìm + lưới thẻ riêng của nó — cùng một việc "tìm một
   * mặt hàng trong 1.700 mặt hàng" mà hai bản, và bản ở màn hàng trả thiếu
   * sạch những thứ bản này có: tab "khách hay lấy", nút quét mã, trần số
   * thẻ vẽ một lúc.
   */
  const returning = searchParams.get("mode") === "return"
  // ⚠ Cảnh báo tải danh mục phải NÓI RA. Danh mục thiếu một khúc mà im
  // lặng là để nhân viên gõ đúng mã có thật rồi kết luận "tìm kiếm hỏng".
  const {
    stockByProduct,
    loading,
    warnings: loadWarnings,
    reload,
    customerById,
    filterProducts,
    listMemory,
  } = useSellData()
  /**
   * ⚠ TỒN KHÔNG PHẢI SỐ ĐƯỢC PHÉP BÁN. Kho chỉ bị trừ lúc Xuất hàng, nên
   * phần đã hứa trong các Phiếu tạm khác vẫn nằm trong `stockByProduct`.
   * Số đem ra so là `availableByProduct` — xem `@/lib/sell/committed`.
   */
  const { committedByProduct, warning: committedWarning } = useCommittedStock()
  const availableByProduct = useMemo(
    () => availableMapFrom(stockByProduct, committedByProduct),
    [stockByProduct, committedByProduct]
  )

  /**
   * ⚠ TAB VÀ VỊ TRÍ CUỘN NHỚ LẠI CHỖ NGƯỜI DÙNG VỪA ĐỨNG; Ô TÌM THÌ KHÔNG.
   *
   * Chạm thẻ là sang giỏ; từ giỏ chạm "tìm" là về đây. Bản đầu về với ô
   * tìm TRỐNG và cuộn ở ĐỈNH, nên tôi cho nó nhớ cả ô tìm với lý do
   * "nhân viên gõ coca cho thùng thứ nhất khỏi phải gõ lại cho thùng thứ
   * hai". Lý do đó SAI trong thực tế: thùng thứ hai là cùng một dòng, sửa
   * số lượng chứ không thêm lần nữa. Mỗi lần quay lại đây là để tìm một
   * MẶT HÀNG KHÁC — và khi đó chữ cũ nằm trong ô là một bộ lọc không ai
   * yêu cầu, che mất đúng thứ người ta sắp gõ.
   *
   * Nên: thêm hàng vào giỏ thì XOÁ ô tìm (xem `clearSearchMemory`). Tab
   * và vị trí cuộn vẫn nhớ — chúng nói về chỗ đứng, không phải về thứ
   * đang tìm.
   */
  const [q, setQ] = useState(() => listMemory.current.q)
  const [tab, setTab] = useState<"freq" | "all">(() => listMemory.current.tab)
  const [unitSel, setUnitSel] = useState<Record<string, string>>({})
  const [frequentIds, setFrequentIds] = useState<string[]>([])
  useEffect(() => {
    listMemory.current.q = q
    listMemory.current.tab = tab
  }, [q, tab, listMemory])

  /**
   * ⚠ Ô TÌM KHÔNG ĐƯỢC "NUỐT" CHỮ. Chữ gõ vào ô là việc KHẨN — phải hiện
   * ngay ở phím kế tiếp; lọc lại 1.700 dòng và vẽ 60 thẻ là việc CÓ THỂ
   * CHẬM MỘT NHỊP. `useDeferredValue` tách hai việc đó: React vẽ ô tìm
   * trước, danh sách theo sau, và nếu người dùng gõ tiếp thì lượt lọc dở
   * bị bỏ chứ không xếp hàng.
   */
  const deferredQ = useDeferredValue(q)

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
        // Về từ giỏ thì giữ tab người dùng đã chọn; chỉ lần đầu mới tự
        // chọn giúp.
        setTab((t) => (ids.length ? t : "all"))
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
  const unitOf = useCallback((p: PricedProduct) => selectedUnitOf(unitSel, p), [unitSel])

  const byStock = useMemo(() => compareByStockDesc(stockByProduct), [stockByProduct])

  const list = useMemo(() => {
    const term = deferredQ.trim()
    if (term) {
      // ⚠ Lọc qua CHỈ MỤC đã chuẩn hoá sẵn ở provider, không chuẩn hoá lại
      // 1.700 × 3 trường ở mỗi phím gõ. Xem `viSearchKey`.
      return filterProducts(term).sort(byStock).slice(0, RENDER_CAP)
    }
    const all = filterProducts("")
    if (tab === "freq" && frequentIds.length) {
      const rank = new Map(frequentIds.map((id, i) => [id, i]))
      return all
        .filter((p) => rank.has(p.id))
        .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
        .slice(0, RENDER_CAP)
    }
    return [...all].sort(byStock).slice(0, RENDER_CAP)
  }, [deferredQ, filterProducts, tab, frequentIds, byStock])

  /**
   * ⚠ KHÔI PHỤC VỊ TRÍ CUỘN — một lần, sau khi danh sách đã vẽ. Ghi liên
   * tục bằng listener `scroll` (thụ động, chỉ gán một con số) vì lúc
   * component gỡ ra thì trang có thể đã bị cuộn về đỉnh rồi.
   */
  const restoredRef = useRef(false)
  useEffect(() => {
    const onScroll = () => {
      listMemory.current.scrollY = window.scrollY
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [listMemory])
  useEffect(() => {
    if (restoredRef.current || loading || list.length === 0) return
    restoredRef.current = true
    const y = listMemory.current.scrollY
    if (y > 0) window.scrollTo(0, y)
  }, [loading, list.length, listMemory])

  /**
   * Xoá ô tìm TRƯỚC KHI rời màn.
   *
   * ⚠ PHẢI XOÁ CẢ TRÍ NHỚ Ở PROVIDER, không chỉ gọi `setQ("")`. Hiệu ứng
   * đồng bộ `listMemory.current.q = q` chạy SAU khi vẽ lại, mà ở đây
   * `router.push` gỡ màn ngay — nên rất có thể nó không kịp chạy, và lần
   * sau vào lại vẫn thấy chữ cũ. Ghi thẳng vào ref là chắc chắn.
   *
   * ⚠ ĐẶT VỊ TRÍ CUỘN VỀ ĐỈNH LUÔN. Chỗ đang cuộn là chỗ trong danh sách
   * ĐÃ LỌC; bỏ bộ lọc mà giữ nguyên số đó là thả người dùng xuống giữa
   * một danh sách khác hẳn.
   */
  const clearSearchMemory = () => {
    setQ("")
    listMemory.current.q = ""
    listMemory.current.scrollY = 0
  }

  const addToCart = (p: PricedProduct) => {
    const unit = unitOf(p)
    const price = unitPriceFor(p, unit, groupId)

    if (returning) {
      // ⚠ KHÔNG chặn theo tồn kho khi chọn hàng TRẢ. Khách đưa hàng LẠI cho
      // mình; trả một mặt hàng đang hết tồn là chuyện hoàn toàn bình thường.
      cart.addReturnLine({
        productId: p.id,
        unit,
        qty: 1,
        price,
        vatRate: Number(p.vat_rate ?? 0),
        // Mặc định là TRẢ TIỀN — nghĩa thường của "hàng trả". Đổi hàng là
        // trường hợp riêng nên phải bấm chọn ở màn hàng trả.
        isExchange: false,
        note: "",
      })
      clearSearchMemory()
      backToReturnSlip(router)
      return
    }

    /**
     * ⚠ CẢNH BÁO RỒI VẪN THÊM (chủ nhà chốt 20/09/2026: "mở khoá cả cho
     * đặt với sản phẩm hết hàng").
     *
     * Bản cũ ném toast đỏ rồi `return` — KHÔNG thêm. Nhưng giỏ hàng thì
     * đã cho vượt tồn từ lâu và nói thẳng "vẫn gửi đơn được để nhà phân
     * phối biết nhu cầu thật". Hai cách cư xử cho cùng một việc: gõ số
     * lượng lên 50 khi kho còn 2 thì được, mà thêm một mặt hàng kho còn
     * 0 thì không.
     *
     * Cái giá của việc chặn không phải là sự bất tiện — mà là SỐ LIỆU.
     * Đơn không đặt được thì nhu cầu đó không tồn tại ở đâu cả, và nhà
     * phân phối nhập hàng theo một bức tranh thiếu đúng phần đang thiếu
     * hàng nhất.
     *
     * ⚠ KHÔNG CÒN LÀ `destructive`. Đỏ dành cho lỗi; đây là việc được
     * phép làm, chỉ cần biết trước hệ quả. Chốt chặn thật vẫn nguyên ở
     * `post_stock_export`, và cảnh báo đi tiếp tới tận màn Xuất hàng.
     */
    const onHand = stockByProduct[p.id] ?? 0
    const available = availableByProduct[p.id] ?? 0
    const warn = addOverstockWarning(p.name, onHand, available, p.base_unit)
    if (warn) toast(warn)
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
    clearSearchMemory()
    // Chạm xong đi thẳng vào giỏ: người dùng cần thấy dòng vừa thêm và số
    // lượng của nó, không phải đoán xem cú chạm có ăn không.
    router.push("/sell/cart")
  }

  /**
   * ⚠ HAI CALLBACK ỔN ĐỊNH CHO 60 THẺ `memo`. `addToCart` đổi theo giỏ,
   * khách, tồn kho… nên không đưa thẳng vào thẻ được — đưa qua một ref:
   * thẻ giữ một hàm không bao giờ đổi, hàm đó gọi bản `addToCart` mới nhất.
   */
  const addRef = useRef(addToCart)
  addRef.current = addToCart
  const onAdd = useCallback((p: PricedProduct) => addRef.current(p), [])
  const onPickUnit = useCallback(
    (productId: string, u: string) => setUnitSel((s) => ({ ...s, [productId]: u })),
    []
  )

  const cartCount = cart.cart.length
  const showTabs = frequentIds.length > 0 && !q.trim()

  return (
    <div className="flex min-h-screen flex-col bg-surface pb-nav">
      {/*
        ⚠ MÁY TÍNH THÌ ĐI THẲNG SANG MÀN `/pos` — chủ nhà chốt
          22/09/2026 cho nhánh `newdesign`. Điện thoại giữ nguyên màn
          này. Xem `@/lib/nav/pos-preview` về việc vì sao chặn ở đây
          chứ không sửa sáu cái nút "Tạo đơn".

        ⚠ CHỈ CHẶN KHI ĐANG LẬP ĐƠN BÁN. `/sell?mode=return` là bước
          chọn hàng TRẢ của màn phiếu trả trên điện thoại; đẩy nó sang
          màn lập đơn là cắt ngang một việc khác hẳn.
      */}
      {!returning && (
        <PosDesktopRedirect to={posNewOrderHref(searchParams.get("customerId"))} />
      )}
      <div className="shrink-0 px-4 pb-2.5 pt-1.5">
        <div className="flex h-10 items-center justify-between">
          <h1 className="text-2xl font-extrabold tracking-tight text-on-surface">
            {returning
              ? "Chọn hàng trả"
              : cart.editing
                ? "Thêm hàng vào đơn"
                : cartCount
                  ? "Thêm hàng"
                  : "Đặt hàng"}
          </h1>
          {/* Đang chọn hàng trả thì hai nút của luồng ĐẶT hàng không có việc
              gì ở đây — nhường chỗ cho đường quay lại phiếu trả. */}
          {returning ? (
            <button
              type="button"
              onClick={() => backToReturnSlip(router)}
              className="tap flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-extrabold text-primary"
            >
              <RotateCcw className="h-[18px] w-[18px]" />
              Xong
            </button>
          ) : (
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
          )}
        </div>

        <SellCustomerDeepLink />

        {/* ⚠ ĐANG SỬA ĐƠN THÌ PHẢI NÓI RA Ở ĐÂY. Vào thẳng màn này từ trang
            chủ mà giỏ còn mang mã một đơn cũ thì mọi thứ thêm vào sẽ GHI ĐÈ
            lên đơn đó — người dùng tưởng mình đang soạn đơn mới. */}
        {cart.editing && (
          <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2 text-[13px] font-extrabold text-primary">
            <span className="min-w-0 flex-1 truncate">Đang sửa đơn {cart.editing.orderCode}</span>
            <button
              type="button"
              onClick={() => {
                cart.clear()
                toast({ title: "Đã thoát khỏi phần sửa đơn", description: "Đơn cũ vẫn nguyên." })
              }}
              className="h-8 shrink-0 rounded-lg px-2 font-extrabold text-error"
            >
              Thoát
            </button>
          </div>
        )}

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

      {/* ⚠ CHƯA ĐỌC ĐƯỢC HÀNG ĐÃ ĐẶT THÌ NÓI NGAY ĐẦU MÀN. Im lặng ở đây
          là để người bán tin con số tồn đã trừ phần các Phiếu tạm khác
          đang giữ — và quy tắc chủ nhà vừa chốt thành ra không chạy mà
          không ai biết. */}
      {committedWarning && (
        <p className="mx-3 mb-2 rounded-xl bg-[#fff7e6] px-3 py-2.5 text-[13px] font-semibold leading-snug text-[#7a4b00]">
          {committedWarning}
        </p>
      )}

      {loadWarnings.length > 0 && (
        <div className="mx-3 mb-2 grid gap-2 rounded-xl bg-[#fff7e6] px-3 py-2.5 text-[13px] font-semibold leading-snug text-[#7a4b00]">
          {loadWarnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          {/* ⚠ Nói ra vấn đề rồi bỏ đó là mới xong một nửa. Người đứng ở
              quầy khách cần một cú chạm để thử lại, không phải phải nghĩ
              ra là mình phải tắt app mở lại. */}
          <button
            type="button"
            onClick={reload}
            className="h-10 w-fit rounded-lg border-[1.5px] border-[#7a4b00]/30 px-4 text-[13px] font-extrabold"
          >
            Tải lại danh mục
          </button>
        </div>
      )}

      <div className="grid flex-1 content-start gap-2 px-3 pb-32">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[116px] rounded-2xl" />)
        ) : list.length === 0 ? (
          <p className="py-10 text-center text-sm text-on-surface-variant">
            {q.trim()
              ? `Không tìm thấy sản phẩm khớp “${q.trim()}”`
              : /* ⚠ "Chưa có sản phẩm nào" là một KẾT LUẬN, và màn hình
                   không có cơ sở nào để kết luận như vậy: 0 dòng cũng là
                   thứ ta nhận được khi phiên hết hạn hoặc RLS chặn. Có
                   cảnh báo thì cảnh báo mới là câu trả lời — ô vàng ở
                   trên đang nói rõ vì sao. */
                loadWarnings.length > 0
                ? "Không lấy được danh mục — xem lý do ở khung vàng phía trên."
                : "Chưa có sản phẩm nào"}
          </p>
        ) : (
          list.map((p) => {
            const unit = unitOf(p)
            const i = returning
              ? findReturnLine(cart.returnLines, p.id, unit)
              : findLine(cart.cart, p.id, unit)
            return (
              <ProductCard
                key={p.id}
                product={p}
                baseOnHand={stockByProduct[p.id] ?? 0}
                baseCommitted={committedByProduct ? committedByProduct[p.id] || 0 : null}
                groupId={groupId}
                unit={unit}
                onPickUnit={onPickUnit}
                onAdd={onAdd}
                inCartQty={
                  i >= 0 ? (returning ? cart.returnLines[i].qty : cart.cart[i].qty) : 0
                }
                /* ⚠ KHÔNG hiện tồn kho khi chọn hàng TRẢ. Khách đưa hàng LẠI
                   cho mình, nên "Hết hàng" tô đỏ ở đó là câu trả lời cho một
                   câu hỏi không ai hỏi — tệ hơn, nó trông như đang chặn và
                   nhân viên sẽ không dám bấm. */
                showStock={!returning}
                badgeLabel={returning ? "Đã trả" : "Trong giỏ"}
              />
            )
          })
        )}
      </div>

      {/* Đang chọn hàng trả thì nút nổi đưa về phiếu trả, kèm số dòng đã
          chọn — không phải về giỏ hàng bán. */}
      {returning && cart.returnLines.length > 0 && (
        <div className="fixed inset-x-4 bottom-[calc(var(--bottom-nav-h)+var(--safe-b)+12px)] z-30 lg:left-[calc(15rem+1rem)]">
          <button
            type="button"
            onClick={() => backToReturnSlip(router)}
            className="flex h-14 w-full items-center gap-3 rounded-2xl bg-primary pl-4 pr-2 text-on-primary shadow-[0_12px_28px_-8px_rgba(37,99,235,.55)]"
          >
            <span className="grid h-7 min-w-7 place-items-center rounded-lg bg-white/20 px-1.5 text-sm font-extrabold">
              {cart.returnLines.length}
            </span>
            <span className="flex-1 text-left text-base font-extrabold">dòng hàng trả</span>
            <span className="flex h-10 items-center gap-1.5 rounded-xl bg-white px-4 text-sm font-extrabold text-primary">
              Xong <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </button>
        </div>
      )}

      {!returning && cartCount > 0 && (
        <div className="fixed inset-x-4 bottom-[calc(var(--bottom-nav-h)+var(--safe-b)+12px)] z-30 lg:left-[calc(15rem+1rem)]">
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
