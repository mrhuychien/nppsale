"use client"

/**
 * Ô TÌM HÀNG DÙNG CHUNG CỦA `/pos` — MỘT CÁI, NẰM Ở CỘT PHẢI.
 *
 * ⚠ CHỦ NHÀ CHỐT (đợt 9): *"Bỏ bớt 1 cái thêm hàng. đang có 2 cái. Bỏ
 * cái dưới. giữ cái trên header, khi ấn vào tìm hàng, danh sách xổ ngay
 * đó"*. Trước đó màn đơn có HAI chỗ thêm hàng: ô tìm trên header (một
 * cái nút, bấm vào thì kích `F3` của màn) và một thẻ `ProductPicker`
 * đặt trên bảng hàng. Hai chỗ làm cùng một việc là người dùng phải
 * chọn, và cái nút trên header thì không tự tìm được gì.
 *
 * ⚠ VÌ SAO PHẢI CÓ SỔ ĐĂNG KÝ. Ô tìm vẽ ở một component DÙNG CHUNG
 * (`components/pos/product-search-box`), nhưng
 * danh sách hàng và việc "thêm vào chứng từ" thuộc về MÀN đang mở.
 * Khung không biết gì về màn, nên màn phải đưa hai thứ ấy lên. Đây
 * đúng mô hình `usePosKeys` đang dùng cho phím tắt — khác một chỗ:
 * phím tắt chỉ cần ĐỌC lúc bấm nên giữ được ở biến mô-đun, còn ô tìm
 * phải VẼ LẠI khi danh sách đổi, nên phải là state của React.
 *
 * ⚠ TỪ KHOÁ ĐANG GÕ THUỘC VỀ SỔ NÀY, KHÔNG THUỘC VỀ MÀN. Để màn giữ
 * từ khoá là mỗi lần đổi tab lại mất chữ đang gõ dở theo một đường vòng
 * không ai đoán được.
 */

import {
  createContext, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from "react"

/** ⚠ `F3`, nút "Thêm sản phẩm" và nút của bảng rỗng tìm ô này bằng `id`. */
export const POS_PICKER_ID = "pos-tim-hang"

export interface PosPickerItem {
  id: string
  /** Dòng chính — tên hàng. */
  title: string
  /** Dòng phụ — mã SKU, đơn vị… */
  subtitle?: string | null
}

export interface PosProductSearchReg<T extends PosPickerItem = PosPickerItem> {
  /** Danh sách ĐÃ lọc theo `term` — màn tự lọc vì mỗi màn một luật. */
  items: T[]
  onPick: (item: T) => void
  disabled?: boolean
  placeholder?: string
  /** Cột phải của mỗi dòng gợi ý — giá, tồn… */
  renderMeta?: (item: T) => ReactNode
}

interface Value {
  term: string
  setTerm: (t: string) => void
  reg: PosProductSearchReg | null
  setReg: (r: PosProductSearchReg | null) => void
}

const Ctx = createContext<Value | null>(null)

export function PosProductSearchProvider({ children }: { children: ReactNode }) {
  const [term, setTerm] = useState("")
  const [reg, setReg] = useState<PosProductSearchReg | null>(null)
  const value = useMemo<Value>(() => ({ term, setTerm, reg, setReg }), [term, reg])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function useCtx(): Value {
  const v = useContext(Ctx)
  if (!v) throw new Error("Ô tìm hàng của /pos phải nằm trong <PosProductSearchProvider>")
  return v
}

/** Component vẽ ô tìm đọc cái này. */
export function usePosProductSearchHost(): Value {
  return useCtx()
}

/** Từ khoá đang gõ — màn đọc để tự lọc danh sách của mình. */
export function usePosSearchTerm(): string {
  return useCtx().term
}

/**
 * Màn đăng ký danh sách hàng + việc cần làm khi chọn.
 *
 * ⚠ `items` VÀ `onPick` PHẢI ỔN ĐỊNH (`useMemo` / `useCallback`). Dựng
 * lại chúng ở mỗi lần vẽ là effect này chạy lại mỗi lần vẽ, và mỗi lần
 * chạy lại `setReg` một lần nữa — vòng lặp vô tận.
 *
 * ⚠ RỜI MÀN THÌ GỠ ĐĂNG KÝ. Giữ lại là ô tìm còn hiện danh
 * mục của màn vừa đóng, và bấm chọn là thêm hàng vào một chứng từ
 * không còn trên màn.
 */
export function useRegisterPosProductSearch<T extends PosPickerItem>(
  cfg: PosProductSearchReg<T>
): void {
  const { setReg, setTerm } = useCtx()
  const { items, onPick, disabled, placeholder, renderMeta } = cfg
  useEffect(() => {
    setReg({
      items,
      onPick: onPick as (item: PosPickerItem) => void,
      disabled,
      placeholder,
      renderMeta: renderMeta as ((item: PosPickerItem) => ReactNode) | undefined,
    })
    return () => setReg(null)
  }, [items, onPick, disabled, placeholder, renderMeta, setReg])

  /* ⚠ Vào màn thì ô tìm sạch chữ. Giữ lại từ khoá của màn trước là
     danh sách xổ ra đã lọc sẵn theo một chữ người dùng không nhớ đã gõ. */
  useEffect(() => {
    setTerm("")
    return () => setTerm("")
  }, [setTerm])
}

/**
 * Đưa tiêu điểm về ô tìm ở cột phải.
 *
 * ⚠ BA CHỖ GỌI CHUNG HÀM NÀY: phím `F3`, nút "Thêm sản phẩm" ở đỉnh cột
 * trái, và nút của bảng rỗng. Ba chỗ ấy phải dẫn về CÙNG một ô — đó là
 * toàn bộ lý do ô tìm chỉ có một.
 */
export function focusPosPicker(): void {
  document.getElementById(POS_PICKER_ID)?.focus()
}
