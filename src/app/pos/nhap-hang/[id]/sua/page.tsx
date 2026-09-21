"use client"

/**
 * MÀN 10 — SỬA PHIẾU NHẬP.
 *
 * ⚠ RENDER ĐÚNG COMPONENT CỦA MÀN 9, cùng lý do §7.1.
 *
 * ⚠ HAI KHOÁ CỦA `cancel_purchase_invoice` (`DA_TRA_TIEN`,
 * `HANG_DA_XUAT`) chưa đọc được từ đây — xem `docs/pos-todo.md`. Để
 * mặc định là KHÔNG khoá: đoán sai theo hướng này chỉ làm mất một lời
 * nhắc sớm, và máy chủ vẫn chặn thật. Đoán ngược lại thì màn hình khoá
 * một phiếu sửa được và không ai gỡ nổi.
 */

import { useParams } from "next/navigation"
import { PurchaseScreen } from "@/components/pos/purchase-screen"

export default function PosPurchaseEditPage() {
  const { id } = useParams<{ id: string }>()
  return <PurchaseScreen mode="sua" slipCode={id} />
}
