"use client"

/** MÀN 9 — PHIẾU NHẬP HÀNG. */

import { useParams } from "next/navigation"
import { PurchaseScreen } from "@/components/pos/purchase-screen"

export default function PosPurchasePage() {
  const { id } = useParams<{ id: string }>()
  const moi = id === "moi"
  return <PurchaseScreen mode="lap" receiptId={moi ? null : id} />
}
