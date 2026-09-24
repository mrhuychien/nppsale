"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import {
  addLine as addLineTo,
  setLinesQty,
  cartTotals,
  patchLine as patchLineIn,
  setVatAll as setVatAllIn,
  setQty as setQtyIn,
  type CartLine,
  type CartTotals,
  type DiscountInput,
} from "@/lib/sell/cart"
import {
  addReturnLine as addReturnLineTo,
  patchReturnLine as patchReturnLineIn,
  returnCreditOf,
  setReturnQty as setReturnQtyIn,
  setReturnLinesQty,
  type ReturnCartLine,
} from "@/lib/sell/returns"
import { SELL_CART_STORAGE_KEY } from "@/lib/sell/cart-storage"

/**
 * Giỏ hàng dùng chung cho cả luồng bán hàng trên điện thoại.
 *
 * VÌ SAO LÀ CONTEXT CHỨ KHÔNG PHẢI STATE TRONG MỘT MÀN
 *   Luồng này là NHIỀU TRANG thật (tìm hàng → giỏ → chọn khách → điều
 *   khoản), không phải một trang đổi state. Làm một trang thì nút Back
 *   của điện thoại thoát thẳng ra khỏi cả luồng — trên Android đó là thao
 *   tác quay lại mặc định, và người dùng mất sạch giỏ.
 *
 * ⚠ GIỎ PHẢI SỐNG QUA VIỆC ĐÓNG TRÌNH DUYỆT. NVBH đứng ở quầy, tắt màn
 * hình nghe điện thoại, mở lại — mất giỏ là mất cả buổi ghi đơn. Nên state
 * ghi xuống `localStorage` sau mỗi thay đổi.
 */
export interface SellCartState {
  cart: CartLine[]
  customerId: string | null
  notes: string
  paymentTerms: string
  expectedDelivery: string
  returnReason: string
  returnLines: ReturnCartLine[]
  /**
   * NVBH mà đơn này đứng tên. Rỗng = chính người đang lập đơn.
   *
   * ⚠ Ở TRONG GIỎ CHỨ KHÔNG Ở TRONG MÀN GIỎ, và đây là một lỗi chủ nhà
   *   đã báo: "chọn nhân viên xong, khi chọn thêm hàng hoặc chọn khách
   *   hàng xong quay lại thì mất tên nhân viên đã chọn". Luồng này là
   *   NHIỀU TRANG thật; `/sell`, `/sell/customer`, `/sell/returns`,
   *   `/sell/terms` đều tháo màn giỏ ra khỏi DOM. Mọi thứ người dùng gõ
   *   vào đơn phải sống ở đây — chỗ duy nhất đi qua được các trang ấy.
   */
  sellerId: string
  /** Giảm giá cả đơn (% / đồng) — xem `cartTotals`. Vắng = không giảm. */
  docDiscount?: DiscountInput
  /** Khoản giảm đơn ĐÃ CÓ khi mở sửa đơn (đồng) — xem `kiemQuyenGiamGia`. */
  docDiscountGoc?: number
  /** Đang sửa đơn đã lưu hay đang soạn đơn mới. */
  editing: EditingOrder | null
}

/**
 * Đơn đang được nạp ngược vào giỏ để sửa.
 *
 * VÌ SAO GIỎ PHẢI BIẾT MÌNH ĐANG SỬA
 *   NVBH sửa đơn bằng CHÍNH màn bán hàng, không phải một màn sửa riêng.
 *   Nếu giỏ không mang theo mã đơn thì bấm Lưu là TẠO THÊM một đơn nữa —
 *   khách có hai đơn, kho xuất hai lần.
 */
export interface EditingOrder {
  orderId: string
  orderCode: string
  /** Trạng thái LÚC MỞ RA SỬA — quyết định nhãn nút và lời nhắc. */
  status: "draft" | "submitted"
  /** NVBH phụ trách — để biết nháp này có phải "của mình" mà xoá được không. */
  salesUserId?: string | null
  /**
   * Phiếu trả kèm đơn mà lần sửa này được phép ghi đè.
   *
   * ⚠ BA GIÁ TRỊ, KHÔNG PHẢI HAI. `string` = ghi đè đúng phiếu ấy;
   * `null` = đơn không có phiếu trả nháp nào, nhập vào thì tạo mới;
   * `undefined` = KHÔNG BIẾT (đọc hỏng, hoặc đơn có nhiều phiếu nháp) —
   * lúc lưu phải đứng yên. Gộp `undefined` vào `null` là lần lưu sau đẻ
   * thêm một phiếu trả cho cùng số hàng.
   */
  heldReturnId?: string | null
}

interface SellCartValue extends SellCartState {
  totals: CartTotals
  /** Đã đọc xong bản lưu chưa — chưa đọc thì đừng vẽ "giỏ trống". */
  ready: boolean
  addLine: (line: CartLine) => void
  /** Đặt số lượng TUYỆT ĐỐI cho nhiều mặt hàng một lần — xem `setLinesQty`. */
  setManyQty: (picks: CartLine[]) => void
  setQty: (index: number, qty: number) => void
  patchLine: (index: number, patch: Partial<CartLine>) => void
  /** Thuế cả đơn — đặt cho MỌI dòng (không còn ô thuế từng dòng). */
  setVatAll: (rate: number) => void
  setDocDiscount: (d: DiscountInput) => void
  setCustomerId: (id: string | null) => void
  setNotes: (v: string) => void
  setPaymentTerms: (v: string) => void
  setExpectedDelivery: (v: string) => void
  /** Chọn NVBH đứng tên đơn. Rỗng = chính người đang lập. */
  setSellerId: (v: string) => void
  /** Xoá sạch giỏ — dùng sau khi tạo đơn xong hoặc khi người dùng huỷ. */
  clear: () => void
  /** Nạp một đơn đã lưu vào giỏ để sửa. Thay TOÀN BỘ giỏ hiện tại. */
  loadForEdit: (next: SellCartState) => void
  /** Tiền hàng trả trừ vào đơn — chỉ dòng TRẢ TIỀN, không tính dòng đổi. */
  returnCredit: number
  setReturnReason: (v: string) => void
  addReturnLine: (line: ReturnCartLine) => void
  setReturnQty: (index: number, qty: number) => void
  /** Chọn nhiều ở màn hàng trả — xem `setReturnLinesQty`. */
  setManyReturnQty: (picks: ReturnCartLine[]) => void
  patchReturnLine: (index: number, patch: Partial<ReturnCartLine>) => void
}

const EMPTY: SellCartState = {
  cart: [],
  customerId: null,
  notes: "",
  paymentTerms: "",
  expectedDelivery: "",
  returnReason: "damaged",
  returnLines: [],
  sellerId: "",
  editing: null,
}

const STORAGE_KEY = SELL_CART_STORAGE_KEY

const Ctx = createContext<SellCartValue | null>(null)

function validEditing(v: unknown): EditingOrder | null {
  if (!v || typeof v !== "object") return null
  const e = v as Partial<EditingOrder>
  if (typeof e.orderId !== "string" || !e.orderId) return null
  if (e.status !== "draft" && e.status !== "submitted") return null
  return {
    orderId: e.orderId,
    orderCode: e.orderCode ?? "",
    status: e.status,
    salesUserId: typeof e.salesUserId === "string" ? e.salesUserId : null,
    // ⚠ GIỮ NGUYÊN BA TRẠNG THÁI qua một lần tải lại trang. JSON bỏ hẳn
    //   khoá mang `undefined`, nên "không biết" tự nó quay về `undefined`;
    //   chỉ cần đừng ép nó thành `null` ở đây.
    heldReturnId:
      typeof e.heldReturnId === "string"
        ? e.heldReturnId
        : e.heldReturnId === null
          ? null
          : undefined,
  }
}

export function SellCartProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SellCartState>(EMPTY)
  const [ready, setReady] = useState(false)

  // Đọc bản lưu MỘT lần, sau khi đã gắn vào DOM. Đọc trong lúc render thì
  // HTML dựng ở máy chủ và ở máy khách khác nhau — React báo lỗi hydrate
  // trên mọi lần mở trang.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SellCartState>
        const editing = validEditing(saved.editing)
        setState({
          cart: Array.isArray(saved.cart) ? saved.cart : [],
          customerId: saved.customerId ?? null,
          notes: saved.notes ?? "",
          paymentTerms: saved.paymentTerms ?? "",
          expectedDelivery: saved.expectedDelivery ?? "",
          returnReason: saved.returnReason ?? "damaged",
          returnLines: Array.isArray(saved.returnLines) ? saved.returnLines : [],
          /**
           * ⚠ BẢN LƯU CŨ KHÔNG CÓ KHOÁ NÀY — và lấy rỗng là SAI, không
           *   phải là "chưa chọn". Giỏ lưu từ trước lần sửa này có thể
           *   đang mở một đơn của nhân viên A; rỗng nghĩa là "đơn đứng
           *   tên bạn", nên chỉ cần bấm Lưu một cái là đơn nhảy sang tên
           *   NPP — doanh số và hoa hồng đi theo, mà người bấm không hề
           *   chọn gì. Thiếu khoá thì lấy lại tên đang đứng đơn.
           */
          sellerId:
            typeof saved.sellerId === "string" ? saved.sellerId : (editing?.salesUserId ?? ""),
          // ⚠ Đọc lại có kiểm: bản lưu cũ (trước khi có tính năng sửa đơn)
          // không có khoá này, và một `editing` méo mó thì mọi lần Lưu sau
          // đó ghi đè lên một đơn không ai biết là đơn nào.
          editing,
        })
      }
    } catch {
      // Cửa sổ ẩn danh, bộ nhớ bị chặn, JSON hỏng — giỏ rỗng vẫn dùng
      // được, còn ném lỗi ở đây là trắng màn hình.
    }
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Hết dung lượng hoặc bị chặn: vẫn bán hàng được trong phiên này.
    }
  }, [state, ready])

  const addLine = useCallback((line: CartLine) => {
    setState((s) => ({ ...s, cart: addLineTo(s.cart, line) }))
  }, [])
  const setManyQty = useCallback((picks: CartLine[]) => {
    setState((s) => ({ ...s, cart: setLinesQty(s.cart, picks) }))
  }, [])
  const setQty = useCallback((index: number, qty: number) => {
    setState((s) => ({ ...s, cart: setQtyIn(s.cart, index, qty) }))
  }, [])
  const patchLine = useCallback((index: number, patch: Partial<CartLine>) => {
    setState((s) => ({ ...s, cart: patchLineIn(s.cart, index, patch) }))
  }, [])
  const setDocDiscount = useCallback((d: DiscountInput) => {
    setState((s) => ({ ...s, docDiscount: d }))
  }, [])
  const setVatAll = useCallback((rate: number) => {
    setState((s) => ({ ...s, cart: setVatAllIn(s.cart, rate) }))
  }, [])
  const setCustomerId = useCallback((id: string | null) => {
    // ⚠ ĐỔI KHÁCH KHÔNG XOÁ GIỎ. NVBH hay chọn nhầm khách rồi sửa lại;
    // xoá giỏ lúc đó là bắt họ nhập lại từ đầu. Giá theo nhóm khách được
    // tính lại ở màn giỏ hàng và có nhãn cho dòng nào lệch.
    setState((s) => ({ ...s, customerId: id }))
  }, [])
  const setNotes = useCallback((v: string) => setState((s) => ({ ...s, notes: v })), [])
  const setPaymentTerms = useCallback(
    (v: string) => setState((s) => ({ ...s, paymentTerms: v })),
    []
  )
  const setExpectedDelivery = useCallback(
    (v: string) => setState((s) => ({ ...s, expectedDelivery: v })),
    []
  )
  const setSellerId = useCallback((v: string) => setState((s) => ({ ...s, sellerId: v })), [])
  // ⚠ `clear` phải trả cả `editing` về rỗng. Còn sót mã đơn thì đơn TIẾP
  // THEO người ta soạn sẽ ghi đè lên đơn vừa sửa xong.
  const clear = useCallback(() => setState(EMPTY), [])
  const loadForEdit = useCallback((next: SellCartState) => setState(next), [])
  const setReturnReason = useCallback(
    (v: string) => setState((s) => ({ ...s, returnReason: v })),
    []
  )
  const addReturnLine = useCallback((line: ReturnCartLine) => {
    setState((s) => ({ ...s, returnLines: addReturnLineTo(s.returnLines, line) }))
  }, [])
  const setManyReturnQty = useCallback((picks: ReturnCartLine[]) => {
    setState((s) => ({ ...s, returnLines: setReturnLinesQty(s.returnLines, picks) }))
  }, [])
  const setReturnQty = useCallback((index: number, qty: number) => {
    setState((s) => ({ ...s, returnLines: setReturnQtyIn(s.returnLines, index, qty) }))
  }, [])
  const patchReturnLine = useCallback((index: number, patch: Partial<ReturnCartLine>) => {
    setState((s) => ({ ...s, returnLines: patchReturnLineIn(s.returnLines, index, patch) }))
  }, [])

  const returnCredit = useMemo(() => returnCreditOf(state.returnLines), [state.returnLines])
  const totals = useMemo(
    () => cartTotals(state.cart, returnCredit, state.docDiscount),
    [state.cart, returnCredit, state.docDiscount]
  )

  const value = useMemo<SellCartValue>(
    () => ({
      ...state,
      totals,
      ready,
      addLine,
      setManyQty,
      setQty,
      patchLine,
      setVatAll,
      setDocDiscount,
      setCustomerId,
      setNotes,
      setPaymentTerms,
      setExpectedDelivery,
      setSellerId,
      clear,
      loadForEdit,
      returnCredit,
      setReturnReason,
      addReturnLine,
      setReturnQty,
      setManyReturnQty,
      patchReturnLine,
    }),
    [
      state,
      totals,
      ready,
      addLine,
      setManyQty,
      setQty,
      patchLine,
      setVatAll,
      setDocDiscount,
      setCustomerId,
      setNotes,
      setPaymentTerms,
      setExpectedDelivery,
      setSellerId,
      clear,
      loadForEdit,
      returnCredit,
      setReturnReason,
      addReturnLine,
      setReturnQty,
      setManyReturnQty,
      patchReturnLine,
    ]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSellCart(): SellCartValue {
  const v = useContext(Ctx)
  if (!v) throw new Error("useSellCart phải nằm trong <SellCartProvider>")
  return v
}
