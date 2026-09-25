"use client"

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Search, ScanBarcode, ChevronLeft, ChevronRight, User, ListChecks } from "lucide-react"
import { docChonNhieu, ghiChonNhieu, roiManSauKhiThem } from "@/lib/sell/pick-mode"
import { useSellCart } from "@/hooks/use-sell-cart"
import { useSellData } from "@/hooks/use-sell-data"
import { useCommittedStock } from "@/hooks/use-committed-stock"
import { addOverstockWarning, availableMapFrom } from "@/lib/sell/committed"
import { ProductCard } from "@/components/sell/product-card"
import { SellCustomerDeepLink } from "@/components/sell/customer-deeplink"
import { conversionFor, selectedUnitOf, unitPriceFor, type PricedProduct } from "@/lib/sell/pricing"
import { baseQtyOf, findLine } from "@/lib/sell/cart"
import { findReturnLine } from "@/lib/sell/returns"
import { backToReturnSlip } from "@/lib/nav/sell-nav"
import { fetchFrequentProducts } from "@/lib/orders/frequent-products"
import { compareByStockDesc } from "@/lib/orders/product-order"
import { SEARCH_FIELD_PROPS, HIDE_NATIVE_CLEAR } from "@/lib/ui/search-field"
import { cn, formatCurrency, formatInt } from "@/lib/utils"
import { SellBottomBar } from "@/components/sell/bottom-bar"
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
   * Nên: rời màn (Xem đơn / Tiếp tục) thì XOÁ ô tìm (xem `clearSearchMemory`). Tab
   * và vị trí cuộn vẫn nhớ — chúng nói về chỗ đứng, không phải về thứ
   * đang tìm.
   */
  const [q, setQ] = useState(() => listMemory.current.q)
  const [tab, setTab] = useState<"freq" | "all">(() => listMemory.current.tab)
  const [unitSel, setUnitSel] = useState<Record<string, string>>({})
  const [frequentIds, setFrequentIds] = useState<string[]>([])
  /**
   * CHỌN NHIỀU MÃ — TUỲ CHỌN; mặc định chọn TỪNG mã (chủ nhà 25/09/2026: "Đảo
   * ngược"). Xem `pick-mode.ts`. Bán và trả là HAI công tắc riêng.
   * ⚠ Đọc bộ nhớ SAU khi gắn màn: server không có localStorage.
   */
  const [chonNhieu, setChonNhieu] = useState(false)
  const loaiChon = returning ? "tra" : "ban"
  useEffect(() => { setChonNhieu(docChonNhieu(loaiChon)) }, [loaiChon])
  const doiCheDoChon = () => {
    setChonNhieu((v) => {
      ghiChonNhieu(!v, loaiChon)
      return !v
    })
  }
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

  /**
   * +1 / −1 NGAY TRÊN THẺ (bản thiết kế 2a / 1a, chủ nhà 24/09/2026) — ở lại
   * màn này, thanh đáy cho biết đơn đang có gì. Về 0 là bỏ dòng.
   */
  const step = (p: PricedProduct, unit: string, delta: number) => {
    const price = unitPriceFor(p, unit, groupId)
    if (returning) {
      // ⚠ KHÔNG chặn theo tồn kho khi chọn hàng TRẢ — khách đưa hàng LẠI cho mình.
      const j = findReturnLine(cart.returnLines, p.id, unit)
      if (j >= 0) cart.setReturnQty(j, cart.returnLines[j].qty + delta)
      else if (delta > 0)
        cart.addReturnLine({
          productId: p.id,
          unit,
          qty: delta,
          price,
          vatRate: Number(p.vat_rate ?? 0),
          // Mặc định TRẢ TIỀN — đổi hàng chọn ở màn phiếu trả.
          isExchange: false,
          note: "",
        })
      /* Chọn từng mã (25/09/2026): vừa thêm một mã MỚI thì về phiếu trả. */
      if (roiManSauKhiThem({ chonNhieu, delta, dongMoi: j < 0 })) {
        clearSearchMemory()
        backToReturnSlip(router)
      }
      return
    }
    const i = findLine(cart.cart, p.id, unit)
    /**
     * ⚠ CẢNH BÁO RỒI VẪN THÊM (chủ nhà chốt 20/09/2026: "mở khoá cả cho đặt với
     * sản phẩm hết hàng"). So SỐ LƯỢNG cần (cộng mọi đơn vị, quy về cơ sở) với
     * số còn bán được — báo đúng lúc vượt qua ngưỡng, không báo mỗi lần bấm.
     */
    if (delta > 0) {
      const conv = conversionFor(p, unit)
      const truoc = baseQtyOf(cart.cart, p.id)
      const sau = truoc + delta * conv
      const available = availableByProduct[p.id] ?? 0
      if (i < 0 && truoc === 0) {
        const warn = addOverstockWarning(p.name, stockByProduct[p.id] ?? 0, available, p.base_unit)
        if (warn) toast(warn)
      } else if (truoc <= available && sau > available) {
        toast({
          title: `${p.name} vượt số còn bán được`,
          description: "Vẫn thêm vào đơn; kho sẽ báo lại lúc xuất hàng.",
        })
      }
    }
    if (i >= 0) cart.setQty(i, cart.cart[i].qty + delta)
    else if (delta > 0)
      cart.addLine({
        productId: p.id,
        unit,
        qty: delta,
        price,
        listPrice: price,
        note: "",
        conversion: conversionFor(p, unit),
        vatRate: Number(p.vat_rate ?? 0),
      })
    /* Chọn từng mã (mặc định): vừa thêm một mã MỚI thì sang màn Đơn hàng. */
    if (roiManSauKhiThem({ chonNhieu, delta, dongMoi: i < 0 })) {
      clearSearchMemory()
      router.push("/sell/cart")
    }
  }

  /**
   * ⚠ CALLBACK ỔN ĐỊNH CHO 60 THẺ `memo` — `step` đổi theo giỏ, khách, tồn kho
   * nên đi qua một ref: thẻ giữ một hàm không đổi, hàm đó gọi bản mới nhất.
   */
  const stepRef = useRef(step)
  stepRef.current = step
  const onStep = useCallback((p: PricedProduct, unit: string, delta: number) => stepRef.current(p, unit, delta), [])
  const onPickUnit = useCallback((productId: string, u: string) => setUnitSel((s) => ({ ...s, [productId]: u })), [])

  const cartCount = cart.cart.length
  const soDonViTra = cart.returnLines.reduce((t, l) => t + l.qty, 0)
  const showTabs = frequentIds.length > 0 && !q.trim()
  const tenKhach = customer?.store_name ?? ""
  const bangGia = customer?.group?.name ?? "Bảng giá chung"
  /* Một nút cho cả hai màn: bán (cạnh bảng giá trên đầu) và trả (hàng khách + bảng giá). */
  const noiDen = returning ? "về phiếu trả" : "sang đơn"
  const nutChonNhieu = (
    <button
      type="button"
      aria-pressed={chonNhieu}
      aria-label={chonNhieu ? "Đang chọn nhiều mã — bấm để chọn từng mã" : "Chọn nhiều mã"}
      title={chonNhieu ? "Đang chọn nhiều mã: thêm xong vẫn ở lại màn. Bấm để tắt." : `Chọn nhiều mã (đang chọn từng mã: thêm một mã là ${noiDen})`}
      onClick={doiCheDoChon}
      data-testid="chon-nhieu"
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border transition-colors",
        chonNhieu ? "border-primary bg-primary text-primary-foreground" : "border-border text-on-surface-variant"
      )}
    >
      <ListChecks className="h-[18px] w-[18px]" />
    </button>
  )

  return (
    <div className="flex min-h-screen flex-col bg-surface-container-low pb-32">
      {/*
        ⚠ MÁY TÍNH THÌ ĐI THẲNG SANG `/pos` (chủ nhà chốt 22/09/2026) — CHỈ khi
          đang lập đơn bán; `/sell?mode=return` là bước chọn hàng trả của phiếu trả.
      */}
      {!returning && (
        <PosDesktopRedirect to={posNewOrderHref(searchParams.get("customerId"))} />
      )}

      {/* ---------- ĐẦU MÀN (bản thiết kế 2a / 1a) ---------- */}
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-border bg-surface-container-lowest px-4 pb-2.5 pt-3.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Quay lại"
            onClick={() => (returning ? backToReturnSlip(router) : router.back())}
            className="-ml-2 grid h-9 w-9 place-items-center text-on-surface"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="min-w-0 flex-1 text-[19px] font-bold text-on-surface">
            {returning ? "Chọn hàng trả" : cart.editing ? "Thêm hàng vào đơn" : "Thêm hàng"}
          </h1>
          {/* Bảng giá đang áp dụng — biết trước khi đọc số cho khách. */}
          {!returning && (
            <span className="flex h-8 items-center rounded-[10px] border border-border px-2.5 text-[12px] font-medium text-on-surface-variant">
              {bangGia}
            </span>
          )}
          {/* ⚠ CHỌN NHIỀU MÃ (tuỳ chọn) — bật tới khi người dùng tự tắt (lưu trên máy). */}
          {!returning && nutChonNhieu}
        </div>

        <SellCustomerDeepLink />

        {/* ⚠ ĐANG SỬA ĐƠN THÌ NÓI RA — thêm gì ở đây là ghi đè lên đơn đó. */}
        {cart.editing && (
          <div className="flex items-center gap-2 rounded-[10px] bg-primary/10 px-3 py-2 text-[13px] font-semibold text-primary">
            <span className="min-w-0 flex-1 truncate">Đang sửa đơn {cart.editing.orderCode}</span>
            <button
              type="button"
              onClick={() => {
                cart.clear()
                toast({ title: "Đã thoát khỏi phần sửa đơn", description: "Đơn cũ vẫn nguyên." })
              }}
              className="h-7 shrink-0 rounded-lg px-2 font-semibold text-error"
            >
              Thoát
            </button>
          </div>
        )}

        {/* ⚠ KHÁCH HÀNG LÊN ĐẦU (2a): sai khách là sai giá, nên phải thấy trước. */}
        {!returning && (
          <button
            type="button"
            onClick={() => router.push("/sell/customer")}
            className="flex h-10 items-center gap-2 rounded-[10px] bg-primary/10 px-3 text-left"
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary text-[12px] font-bold text-primary-foreground">
              {tenKhach ? tenKhach.trim()[0]?.toUpperCase() : <User className="h-3.5 w-3.5" />}
            </span>
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-primary">
              {tenKhach || "Chọn khách hàng"}
            </span>
            <span className="shrink-0 whitespace-nowrap text-[12px] font-medium text-primary">
              {tenKhach ? "Đổi khách" : "Chọn"}
            </span>
          </button>
        )}

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tên, mã hàng, mã vạch…"
              aria-label="Tìm sản phẩm"
              {...SEARCH_FIELD_PROPS}
              className={cn(
                "h-11 w-full rounded-xl border-0 bg-surface-container-low pl-[38px] pr-10 text-[14px] text-on-surface outline-none",
                HIDE_NATIVE_CLEAR
              )}
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Xoá tìm kiếm"
                className="absolute right-1 top-1 grid h-9 w-9 place-items-center text-lg text-muted-foreground"
              >
                ×
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => router.push("/sell/scan")}
            aria-label="Quét mã"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"
          >
            <ScanBarcode className="h-5 w-5" />
          </button>
        </div>

        {/* 1a: khách + bảng giá của phiếu trả, một hàng. */}
        {returning && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => router.push("/sell/customer")}
              className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-[10px] border border-border px-2.5 text-[13px] font-medium"
            >
              <span className="text-muted-foreground">Khách:</span>
              <span className="min-w-0 flex-1 truncate text-left font-semibold text-on-surface">{tenKhach || "Chưa chọn"}</span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <span className="flex h-9 items-center rounded-[10px] border border-border px-2.5 text-[13px] font-medium text-on-surface-variant">
              {bangGia}
            </span>
            {nutChonNhieu}
          </div>
        )}

        {/* Tab gạch chân nhẹ (2a) thay cho cặp nút đặc. */}
        {showTabs && (
          <div className="flex gap-5 px-1">
            {(["freq", "all"] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "h-8 border-b-2 text-[14px]",
                  tab === t ? "border-primary font-semibold text-on-surface" : "border-transparent font-medium text-muted-foreground"
                )}
              >
                {t === "freq" ? "Khách hay lấy" : "Tất cả sản phẩm"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ⚠ CHƯA ĐỌC ĐƯỢC HÀNG ĐÃ ĐẶT / DANH MỤC THIẾU THÌ NÓI NGAY ĐẦU MÀN. */}
      {committedWarning && (
        <p className="mx-3 mt-3 rounded-xl bg-[#fff7e6] px-3 py-2.5 text-[13px] font-semibold leading-snug text-[#7a4b00]">
          {committedWarning}
        </p>
      )}
      {loadWarnings.length > 0 && (
        <div className="mx-3 mt-3 grid gap-2 rounded-xl bg-[#fff7e6] px-3 py-2.5 text-[13px] font-semibold leading-snug text-[#7a4b00]">
          {loadWarnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          <button
            type="button"
            onClick={reload}
            className="h-10 w-fit rounded-lg border-[1.5px] border-[#7a4b00]/30 px-4 text-[13px] font-extrabold"
          >
            Tải lại danh mục
          </button>
        </div>
      )}

      <div className="grid flex-1 content-start gap-2 p-3">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[112px] rounded-[14px]" />)
        ) : list.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {q.trim()
              ? `Không tìm thấy sản phẩm khớp “${q.trim()}”`
              : /* ⚠ 0 dòng cũng là thứ ta nhận khi phiên hết hạn / RLS chặn —
                   có cảnh báo thì cảnh báo mới là câu trả lời. */
                loadWarnings.length > 0
                ? "Không lấy được danh mục — xem lý do ở khung vàng phía trên."
                : "Chưa có sản phẩm nào"}
          </p>
        ) : (
          list.map((p) => {
            const unit = unitOf(p)
            const i = returning ? findReturnLine(cart.returnLines, p.id, unit) : findLine(cart.cart, p.id, unit)
            return (
              <ProductCard
                key={p.id}
                product={p}
                baseOnHand={stockByProduct[p.id] ?? 0}
                baseCommitted={committedByProduct ? committedByProduct[p.id] || 0 : null}
                groupId={groupId}
                unit={unit}
                onPickUnit={onPickUnit}
                onStep={onStep}
                qty={i >= 0 ? (returning ? cart.returnLines[i].qty : cart.cart[i].qty) : 0}
                /* ⚠ KHÔNG hiện tồn khi chọn hàng TRẢ — xem `ProductCard`. */
                showStock={!returning}
                addLabel={returning ? "Trả" : ""}
              />
            )
          })
        )}
      </div>

      {/* ---------- THANH ĐÁY (không đè lên thẻ; không còn thanh nav) ---------- */}
      {returning ? (
        <SellBottomBar className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[12px] text-muted-foreground">
              {cart.returnLines.length} mặt hàng · {formatInt(soDonViTra)} đơn vị
            </span>
            <span className="text-[16px] font-bold tabular-data text-error">−{formatCurrency(cart.returnCredit)}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              clearSearchMemory()
              backToReturnSlip(router)
            }}
            className={cn(
              "h-12 shrink-0 rounded-xl px-[22px] text-[15px] font-semibold text-primary-foreground",
              cart.returnLines.length ? "bg-primary" : "bg-muted-foreground/60"
            )}
          >
            Tiếp tục
          </button>
        </SellBottomBar>
      ) : (
        <SellBottomBar className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[12px] text-muted-foreground">{cartCount} mặt hàng trong đơn</span>
            <span className="text-[16px] font-bold tabular-data text-on-surface">{formatCurrency(cart.totals.subtotal)}</span>
          </div>
          <button
            type="button"
            disabled={cartCount === 0}
            onClick={() => {
              /* Rời màn thì xoá ô tìm — lần sau quay lại là để tìm mặt hàng KHÁC. */
              clearSearchMemory()
              router.push("/sell/cart")
            }}
            className="h-12 shrink-0 rounded-xl bg-primary px-[22px] text-[15px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            Xem đơn
          </button>
        </SellBottomBar>
      )}
    </div>
  )
}
