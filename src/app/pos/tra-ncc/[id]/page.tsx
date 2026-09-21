"use client"

/** MÀN 11 — PHIẾU TRẢ NCC. */

import { useParams } from "next/navigation"
import { SupplierReturnScreen } from "@/components/pos/supplier-return-screen"

export default function PosSupplierReturnPage() {
  const { id } = useParams<{ id: string }>()
  const moi = id === "moi"
  return <SupplierReturnScreen mode="lap" returnId={moi ? null : id} />
}
