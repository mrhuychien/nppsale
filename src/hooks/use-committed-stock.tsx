"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { committedMapFrom, type CommittedMap } from "@/lib/sell/committed"
import { useSellCart } from "@/hooks/use-sell-cart"
import { errorMessage } from "@/lib/errors"

/**
 * Số hàng đã hứa trong các Phiếu tạm khác, chưa rời kho.
 *
 * ⚠ TẠI SAO LÀ MỘT PROVIDER RIÊNG, NẰM TRONG `SellCartProvider`.
 * Con số này phụ thuộc vào ĐƠN ĐANG SỬA: mở một Phiếu tạm ra sửa mà
 * không loại chính nó ra thì đơn tự chặn chính mình — 100 thùng của nó
 * bị trừ khỏi tồn rồi 100 thùng trong giỏ so với phần còn lại, luôn
 * vượt, không ai sửa nổi đơn của mình. `SellDataProvider` nằm NGOÀI giỏ
 * nên không đọc được `editing`, vì thế phép đọc này ở riêng đây.
 *
 * ⚠ ĐỌC HỎNG KHÔNG ĐƯỢC BIẾN THÀNH "0 ĐÃ ĐẶT". `committed = null` nghĩa
 * là chưa biết, và mọi nơi dùng phải nói ra điều đó thay vì lặng lẽ cho
 * qua như thể kho còn nguyên.
 */

interface CommittedValue {
  /** `null` = chưa đọc được. KHÔNG phải "không có hàng nào đã đặt". */
  committedByProduct: CommittedMap
  /** Câu phải nói với người dùng khi `committedByProduct === null`. */
  warning: string | null
  loading: boolean
  reload: () => void
}

const Ctx = createContext<CommittedValue | null>(null)

/**
 * ⚠ MIGRATION 136 CHƯA CHẠY THÌ PHẢI NÓI ĐÚNG TÊN VIỆC CẦN LÀM.
 * PostgREST trả `PGRST202` cho một RPC không tồn tại; câu mặc định của
 * nó ("Could not find the function…") không nói cho chủ nhà biết là phải
 * chạy bản vá nào.
 */
const MISSING_RPC = "PGRST202"

export function CommittedStockProvider({ children }: { children: React.ReactNode }) {
  const cart = useSellCart()
  const excludeOrderId = cart.editing?.orderId ?? null
  const [committedByProduct, setCommitted] = useState<CommittedMap>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const supabase = createClient()
      const res = await fetchAllForAggregate<{ product_id: string; committed_base: number }>(
        (from, to) =>
          supabase
            .rpc("committed_stock_by_product", { p_exclude_order: excludeOrderId }, {
              count: "exact",
            })
            .select("product_id, committed_base")
            .range(from, to)
      )
      if (cancelled) return
      if (res.error) {
        setCommitted(null)
        setWarning(
          res.error.includes(MISSING_RPC)
            ? "Chưa đọc được hàng đã đặt trong các Phiếu tạm khác — máy chủ chưa có bản vá 136. Số tồn trên màn này CHƯA trừ phần người khác đã đặt."
            : `Chưa đọc được hàng đã đặt trong các Phiếu tạm khác (${res.error}). Số tồn trên màn này CHƯA trừ phần người khác đã đặt.`
        )
      } else if (res.truncated) {
        // ⚠ Cắt bớt ở đây là TRỪ THIẾU, tức là cho bán quá tay. Thà nói
        //   không biết còn hơn đưa ra một con số khả dụng cao hơn sự thật.
        setCommitted(null)
        setWarning(
          "Số đơn đang giữ hàng vượt trần tải về nên phần đã đặt đang THIẾU. Số tồn trên màn này chưa trừ đủ."
        )
      } else {
        setCommitted(committedMapFrom(res.rows))
        setWarning(null)
      }
      setLoading(false)
    })().catch((err) => {
      if (cancelled) return
      setCommitted(null)
      setWarning(`Chưa đọc được hàng đã đặt: ${errorMessage(err)}`)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [excludeOrderId, tick])

  const value = useMemo<CommittedValue>(
    () => ({ committedByProduct, warning, loading, reload }),
    [committedByProduct, warning, loading, reload]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCommittedStock(): CommittedValue {
  const v = useContext(Ctx)
  if (!v) throw new Error("useCommittedStock phải nằm trong <CommittedStockProvider>")
  return v
}
