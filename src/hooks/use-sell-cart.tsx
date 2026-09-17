"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import {
  addLine as addLineTo,
  cartTotals,
  patchLine as patchLineIn,
  setQty as setQtyIn,
  type CartLine,
  type CartTotals,
} from "@/lib/sell/cart"

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
}

interface SellCartValue extends SellCartState {
  totals: CartTotals
  /** Đã đọc xong bản lưu chưa — chưa đọc thì đừng vẽ "giỏ trống". */
  ready: boolean
  addLine: (line: CartLine) => void
  setQty: (index: number, qty: number) => void
  patchLine: (index: number, patch: Partial<CartLine>) => void
  setCustomerId: (id: string | null) => void
  setNotes: (v: string) => void
  setPaymentTerms: (v: string) => void
  setExpectedDelivery: (v: string) => void
  /** Xoá sạch giỏ — dùng sau khi tạo đơn xong hoặc khi người dùng huỷ. */
  clear: () => void
  returnCredit: number
  setReturnCredit: (v: number) => void
}

const EMPTY: SellCartState = {
  cart: [],
  customerId: null,
  notes: "",
  paymentTerms: "",
  expectedDelivery: "",
}

const STORAGE_KEY = "npp.sell.cart.v1"

const Ctx = createContext<SellCartValue | null>(null)

export function SellCartProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SellCartState>(EMPTY)
  const [returnCredit, setReturnCredit] = useState(0)
  const [ready, setReady] = useState(false)

  // Đọc bản lưu MỘT lần, sau khi đã gắn vào DOM. Đọc trong lúc render thì
  // HTML dựng ở máy chủ và ở máy khách khác nhau — React báo lỗi hydrate
  // trên mọi lần mở trang.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SellCartState>
        setState({
          cart: Array.isArray(saved.cart) ? saved.cart : [],
          customerId: saved.customerId ?? null,
          notes: saved.notes ?? "",
          paymentTerms: saved.paymentTerms ?? "",
          expectedDelivery: saved.expectedDelivery ?? "",
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
  const setQty = useCallback((index: number, qty: number) => {
    setState((s) => ({ ...s, cart: setQtyIn(s.cart, index, qty) }))
  }, [])
  const patchLine = useCallback((index: number, patch: Partial<CartLine>) => {
    setState((s) => ({ ...s, cart: patchLineIn(s.cart, index, patch) }))
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
  const clear = useCallback(() => {
    setState(EMPTY)
    setReturnCredit(0)
  }, [])

  const totals = useMemo(() => cartTotals(state.cart, returnCredit), [state.cart, returnCredit])

  const value = useMemo<SellCartValue>(
    () => ({
      ...state,
      totals,
      ready,
      addLine,
      setQty,
      patchLine,
      setCustomerId,
      setNotes,
      setPaymentTerms,
      setExpectedDelivery,
      clear,
      returnCredit,
      setReturnCredit,
    }),
    [
      state,
      totals,
      ready,
      addLine,
      setQty,
      patchLine,
      setCustomerId,
      setNotes,
      setPaymentTerms,
      setExpectedDelivery,
      clear,
      returnCredit,
    ]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSellCart(): SellCartValue {
  const v = useContext(Ctx)
  if (!v) throw new Error("useSellCart phải nằm trong <SellCartProvider>")
  return v
}
