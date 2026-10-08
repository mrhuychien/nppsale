"use client"

/**
 * Hộp báo ĐỌC HỎNG (cùng khung với màn Đơn hàng): tiêu đề, câu lỗi, nút Thử lại.
 * ⚠ Màn gọi hộp này KHÔNG vẽ dữ liệu / form bên dưới — bảng rỗng hay form trống cạnh một dòng báo lỗi vẫn bị đọc
 *   (và bị LƯU) như thật.
 */
export function HopLoiTai({ tieuDe, loi, onRetry }: { tieuDe: string; loi: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      data-testid="hop-loi-tai"
      className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container"
    >
      <p className="font-semibold">{tieuDe}</p>
      <p className="mt-0.5 break-words">{loi}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 text-sm font-semibold underline">
          Thử lại
        </button>
      )}
    </div>
  )
}
