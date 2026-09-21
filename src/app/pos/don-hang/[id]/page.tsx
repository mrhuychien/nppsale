"use client"

/**
 * MÀN 1 — ĐƠN ĐẶT HÀNG. `/pos/don-hang/moi` là đơn mới, `/…/[id]` là
 * đơn đã lưu mở ra xem/sửa tiếp.
 */

import { useParams } from "next/navigation"
import { OrderScreen } from "@/components/pos/order-screen"

export default function PosOrderPage() {
  const { id } = useParams<{ id: string }>()
  const moi = id === "moi"
  return <OrderScreen mode="lap" orderId={moi ? null : id} />
}
