"use client"

/**
 * MÀN 8 — SỬA PHIẾU TRẢ ĐÃ GHI NHẬN.
 *
 * ⚠ RENDER ĐÚNG COMPONENT CỦA MÀN 3, đúng lý do của §7.1: hai bản sao
 * là hai chỗ phải sửa khi đổi quy tắc tiền, và bản "sửa" — bản ít
 * người mở hơn — là bản sẽ bị quên.
 *
 * ⚠ BADGE `ĐÃ NHẬP KHO` (spec §7.2), không phải `ĐANG SỬA`. Hai chữ ấy
 * nói hai việc khác nhau: phiếu này đã ĐỘNG VÀO KHO rồi, nên bấm lưu
 * là hoàn tác bút toán cũ chứ không phải ghi đè một bản nháp.
 */

import { useParams } from "next/navigation"
import { ReturnScreen } from "@/components/pos/return-screen"

export default function PosReturnEditPage() {
  const { id } = useParams<{ id: string }>()
  return (
    <ReturnScreen
      mode="sua"
      returnId={id}
      badge={{ label: "ĐÃ NHẬP KHO", tone: "da-kho" }}
    />
  )
}
