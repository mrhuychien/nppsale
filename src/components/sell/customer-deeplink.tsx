"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useSellCart } from "@/hooks/use-sell-cart"
import { useSellData } from "@/hooks/use-sell-data"
import { createClient } from "@/lib/supabase/client"
import { loadOneSellCustomer } from "@/lib/sell/ref-data"
import { CUSTOMER_STATUS_MAP } from "@/lib/constants"
import type { Customer } from "@/types"

/** Kết quả hỏi riêng máy chủ về khách không có trong danh mục đã tải. */
type Tra = { id: string; kq: "dang" | "khong" | "loi" } | { id: string; kq: "ngung"; kh: Customer }

/**
 * Mở màn bán hàng kèm sẵn khách: `/sell?customerId=…`
 *
 * VÌ SAO CẦN
 *   Danh sách khách, hồ sơ khách và tuyến thăm đều có nút "Tạo đơn" cho
 *   ĐÚNG một khách. Trước đây chúng trỏ sang `/orders/new?customerId=…`.
 *   Chuyển các nút đó sang luồng bán hàng mà bỏ mất tham số thì nhân viên
 *   đang đứng trước cửa hàng lại phải đi tìm tên khách trong danh sách —
 *   một bước thừa đúng lúc bận nhất.
 *
 * ⚠ KHÔNG ĐƯỢC LẶNG LẼ ĐỔI KHÁCH CỦA GIỎ ĐANG CÓ HÀNG. Đổi khách là đổi
 * BẢNG GIÁ: mọi dòng trong giỏ lập tức tính theo giá của cửa hàng khác.
 * Nhân viên bấm nhầm một nút trên danh sách khách rồi quay lại giỏ thì
 * thấy đúng số hàng cũ nhưng sai số tiền, mà không có gì nói vì sao.
 */
function Body() {
  const params = useSearchParams()
  const wanted = params.get("customerId")
  const cart = useSellCart()
  const { customerById, addCustomer, loading } = useSellData()
  const [dismissed, setDismissed] = useState(false)
  const [tra, setTra] = useState<Tra | null>(null)

  const known = wanted ? customerById(wanted) : undefined
  const ready = cart.ready && !loading

  /* ⚠ KHÔNG CÓ TRONG DANH MỤC ≠ KHÔNG CÓ KHÁCH (chủ nhà 27/09/2026). Danh mục trên máy giữ tới
     30 phút và chỉ có khách đang hoạt động: khách vừa tạo, hay khách Tạm ngưng / Khoá, đều vắng.
     Hỏi riêng máy chủ: đang hoạt động → thêm vào danh mục rồi nhận như thường; ngưng → nói rõ. */
  useEffect(() => {
    if (!wanted || !ready || known || tra?.id === wanted) return
    setTra({ id: wanted, kq: "dang" })
    loadOneSellCustomer(createClient(), wanted)
      .then((c) => {
        if (!c) return setTra({ id: wanted, kq: "khong" })
        if (c.status && c.status !== "active") return setTra({ id: wanted, kq: "ngung", kh: c })
        addCustomer(c)
        setTra(null)
      })
      .catch(() => setTra({ id: wanted, kq: "loi" }))
  }, [wanted, ready, known, tra, addCustomer])

  // Giỏ còn rỗng thì nhận luôn, không hỏi — không có gì để mất.
  useEffect(() => {
    if (!wanted || !ready || !known) return
    if (cart.customerId === wanted) return
    if (cart.cart.length === 0 && !cart.editing) cart.setCustomerId(wanted)
  }, [wanted, ready, known, cart])

  if (!wanted || !ready) return null

  // ⚠ Mã khách không còn trong danh mục thì NÓI RA. Im lặng bỏ qua là để
  // nhân viên tưởng đã chọn khách rồi, tới lúc bấm Đặt hàng mới biết chưa.
  if (!known) {
    if (!tra || tra.id !== wanted || tra.kq === "dang") return null
    if (tra.kq === "ngung") {
      return (
        <div className="mt-1.5 rounded-xl bg-[#fff7e6] px-3 py-2 text-[13px] font-semibold leading-snug text-[#7a4b00]" data-testid="sell-khach-ngung">
          Khách <b>{tra.kh.store_name}</b> đang ở trạng thái “{CUSTOMER_STATUS_MAP[tra.kh.status]?.label || tra.kh.status}” nên không tạo đơn được.
          Mở lại khách ở Khách hàng (chuyển về Hoạt động) rồi tạo đơn.
        </div>
      )
    }
    if (tra.kq === "loi") {
      return (
        <div className="mt-1.5 rounded-xl bg-[#fff7e6] px-3 py-2 text-[13px] font-semibold leading-snug text-[#7a4b00]">
          Không kiểm tra được khách của đường dẫn này (mạng chập?). Tải lại trang hoặc chọn khách ở ô bên dưới.
        </div>
      )
    }
    return (
      <div className="mt-1.5 rounded-xl bg-[#fff7e6] px-3 py-2 text-[13px] font-semibold leading-snug text-[#7a4b00]">
        Không tìm thấy khách hàng của đường dẫn này. Chọn khách ở ô bên dưới.
      </div>
    )
  }

  if (cart.customerId === wanted || dismissed) return null

  const current = customerById(cart.customerId)
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-xl bg-[#fff7e6] px-3 py-2 text-[13px] font-semibold leading-snug text-[#7a4b00]">
      <span className="min-w-0 flex-1">
        Giỏ đang có {cart.cart.length} mặt hàng
        {current ? ` của ${current.store_name}` : ""}. Đổi sang{" "}
        <b>{known.store_name}</b> sẽ tính lại theo bảng giá của khách này.
      </span>
      <button
        type="button"
        onClick={() => cart.setCustomerId(wanted)}
        className="h-9 shrink-0 rounded-lg bg-primary px-3 font-extrabold text-on-primary"
      >
        Đổi khách
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="h-9 shrink-0 rounded-lg px-2 font-extrabold"
      >
        Giữ nguyên
      </button>
    </div>
  )
}

export function SellCustomerDeepLink() {
  // `useSearchParams` cần Suspense ở App Router, nếu không cả trang bị ép
  // render động và build cảnh báo.
  return (
    <Suspense fallback={null}>
      <Body />
    </Suspense>
  )
}
