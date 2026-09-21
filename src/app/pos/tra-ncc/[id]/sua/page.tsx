"use client"

/**
 * MÀN 12 — SỬA PHIẾU TRẢ NCC.
 *
 * ⚠ RENDER ĐÚNG COMPONENT CỦA MÀN 11, cùng lý do §7.1.
 *
 * ⚠ HAI KHOÁ CỦA `cancel_supplier_return` (`DA_CAN_TRU`, `LO_DA_DONG`)
 * chưa đọc được từ đây — xem `docs/pos-todo.md`. Mặc định KHÔNG khoá,
 * cùng lý do với màn 10.
 */

import { useParams } from "next/navigation"
import { SupplierReturnScreen } from "@/components/pos/supplier-return-screen"

export default function PosSupplierReturnEditPage() {
  const { id } = useParams<{ id: string }>()
  return <SupplierReturnScreen mode="sua" slipCode={id} />
}
