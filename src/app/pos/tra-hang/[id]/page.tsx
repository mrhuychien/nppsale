"use client"

/**
 * MÀN 3 — PHIẾU TRẢ HÀNG. `/pos/tra-hang/moi` là phiếu mới.
 *
 * ⚠ KHÔNG CÓ DẢI DELTA Ở ĐÂY. Phiếu chưa ghi nhận thì chưa có bút toán
 * nào để hoàn tác — không có gì để xem trước (spec §7.1 nói đúng ý ấy
 * cho màn lập đơn, và nó đúng y hệt ở đây).
 */

import { useParams } from "next/navigation"
import { ReturnScreen } from "@/components/pos/return-screen"

export default function PosReturnPage() {
  const { id } = useParams<{ id: string }>()
  const moi = id === "moi"
  return <ReturnScreen mode="lap" returnId={moi ? null : id} />
}
