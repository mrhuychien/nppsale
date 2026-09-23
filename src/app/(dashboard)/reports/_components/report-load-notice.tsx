"use client"

import { truncationWarning } from "@/lib/supabase/aggregate"

/**
 * Dải báo cho màn báo cáo: đọc HỎNG hoặc đọc CHẠM TRẦN.
 *
 * ⚠ ĐỌC HỎNG THÌ KHÔNG HIỆN SỐ. Nơi gọi phải đặt dải này THAY CHỖ bảng
 *   số, không phải bên trên nó: một bảng toàn số 0 dưới một dòng chữ đỏ
 *   vẫn bị chụp màn hình gửi đi như số thật.
 * ⚠ CHẠM TRẦN THÌ VẪN HIỆN SỐ, NHƯNG NÓI RÕ LÀ THIẾU — xem
 *   `truncationWarning`.
 */
export function ReportLoadNotice({
  error,
  truncated = false,
}: {
  error?: string | null
  truncated?: boolean
}) {
  if (error) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-error"
      >
        <p className="font-semibold">Chưa dựng được báo cáo — số liệu không hiển thị để tránh đọc nhầm</p>
        <p className="mt-0.5 break-words">{error}</p>
      </div>
    )
  }
  if (truncated) {
    return (
      <div className="rounded-xl border border-warning/40 bg-warning-container px-4 py-3 text-sm text-on-warning-container">
        <p className="font-semibold">Số liệu chưa đầy đủ</p>
        <p className="mt-0.5 break-words">{truncationWarning()}</p>
      </div>
    )
  }
  return null
}
