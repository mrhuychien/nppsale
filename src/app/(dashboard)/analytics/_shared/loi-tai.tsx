"use client"

/**
 * Hai hộp thông báo dùng chung cho các màn Phân tích.
 *
 * ⚠ ĐỌC HỎNG THÌ KHÔNG VẼ SỐ. Màn gọi `LoiTaiBaoCao` phải dừng ở đó, không
 *   vẽ tiếp các thẻ KPI — một thẻ "Doanh thu 0đ" cạnh một dòng báo lỗi nhỏ
 *   vẫn là một con số sai được đưa ra như thật.
 *
 * ⚠ ĐỌC THIẾU THÌ NÓI RA. Chạm trần `AGGREGATE_ROW_CAP` là chuyện có thật
 *   với khoảng "Năm nay"; số vẫn vẽ, nhưng kèm câu cảnh báo chung.
 */

import { AlertTriangle } from "lucide-react"
import { truncationWarning } from "@/lib/supabase/aggregate"

export function LoiTaiBaoCao({ loi, onRetry }: { loi: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container"
    >
      <p className="font-semibold">Không tải được số liệu báo cáo</p>
      <p className="mt-0.5 break-words">{loi}</p>
      <p className="mt-1 text-xs">Các con số KHÔNG được hiển thị để tránh đọc nhầm số thiếu thành số thật.</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 text-sm font-semibold underline">
          Thử lại
        </button>
      )}
    </div>
  )
}

export function CanhBaoThieuDong() {
  return (
    <p className="flex items-start gap-1.5 rounded-lg border border-[#fdb022]/50 bg-[#fffaeb] px-3 py-2 text-xs text-[#b54708]">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{truncationWarning()}</span>
    </p>
  )
}
