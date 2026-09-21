"use client"

/**
 * MÀN 7 — SỬA HÓA ĐƠN ĐÃ GHI SỔ.
 *
 * ⚠ KHÁC HẲN MÀN 1b VÀ MÀN 8. Sửa đơn hàng là sửa tại chỗ; sửa phiếu
 * trả là hoàn tác rồi ghi lại và GIỮ số phiếu. Còn sửa hóa đơn là HUỶ
 * tờ cũ và lập một tờ MỚI mang số `-1` — vì một tờ hóa đơn đã phát
 * hành thì không sửa được, chỉ thay được.
 */

import { useParams } from "next/navigation"
import { InvoiceEditScreen } from "@/components/pos/invoice-edit-screen"

export default function PosInvoiceEditPage() {
  const { id } = useParams<{ id: string }>()
  return <InvoiceEditScreen invoiceId={id} />
}
