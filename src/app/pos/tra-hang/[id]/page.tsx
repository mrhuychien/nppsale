"use client"

/**
 * MÀN 3 — PHIẾU TRẢ HÀNG. `/pos/tra-hang/moi` là phiếu mới;
 * `/pos/tra-hang/moi?invoice=<id>` là phiếu mới nạp sẵn hóa đơn gốc
 * (nút "Trả hàng" trên màn hóa đơn dẫn tới đây).
 *
 * ⚠ KHÔNG CÓ DẢI DELTA Ở ĐÂY. Phiếu chưa ghi nhận thì chưa có bút toán
 * nào để hoàn tác — không có gì để xem trước (spec §7.1 nói đúng ý ấy
 * cho màn lập đơn, và nó đúng y hệt ở đây).
 *
 * ⚠ `useSearchParams` bọc trong `<Suspense>` — Next 14 đòi thế cho
 * trang client, nếu không `next build` dừng.
 */

import { Suspense } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { ReturnScreen } from "@/components/pos/return-screen"

function Trang() {
  const { id } = useParams<{ id: string }>()
  const q = useSearchParams()
  const moi = id === "moi"
  return (
    <ReturnScreen
      mode="lap"
      returnId={moi ? null : id}
      sourceInvoiceId={moi ? q.get("invoice") : null}
      sourceCustomerId={moi ? q.get("customerId") : null}
    />
  )
}

export default function PosReturnPage() {
  return (
    <Suspense fallback={null}>
      <Trang />
    </Suspense>
  )
}
