"use client"

import { useEffect } from "react"
import { baoLoiVeMayChu, laLoiTaiMa, taiLaiNeuLoiTaiMa } from "@/lib/client-error"

/**
 * Màn lỗi dùng chung của các vùng bắt lỗi (`app/error.tsx`, `app/global-error.tsx`,
 * `(dashboard)/error.tsx`). Thay màn trắng "Application error" của Next: nói đúng câu lỗi,
 * tự tải lại một lần khi là lỗi tải mã (bản cũ còn mở sau khi phát hành), và báo về máy chủ.
 */
export function ErrorScreen({
  error,
  reset,
  noi,
}: {
  error: Error & { digest?: string }
  reset?: () => void
  noi: string
}) {
  useEffect(() => {
    console.error(`[${noi}]`, error)
    if (taiLaiNeuLoiTaiMa(error)) return
    baoLoiVeMayChu(error, noi)
  }, [error, noi])

  const loiTaiMa = laLoiTaiMa(error)
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4" data-testid="man-loi">
      <div className="w-full max-w-md space-y-4 rounded-xl border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-2xl font-black text-destructive">
          !
        </div>
        <div>
          <h2 className="mb-1 text-lg font-semibold">
            {loiTaiMa ? "Ứng dụng vừa được cập nhật" : "Màn hình gặp lỗi"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {loiTaiMa
              ? "Bấm Tải lại trang để dùng bản mới."
              : "Lỗi đã được gửi về để kiểm tra. Bấm Tải lại trang để thử lại."}
          </p>
          {!loiTaiMa && (
            <p className="mt-2 break-words rounded-lg bg-muted/60 px-3 py-2 text-left font-mono text-xs text-muted-foreground">
              {error.message || "Lỗi không xác định"}
              {error.digest ? ` · ${error.digest}` : ""}
            </p>
          )}
        </div>
        <div className="flex justify-center gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Tải lại trang
          </button>
          {reset && !loiTaiMa && (
            <button type="button" onClick={() => reset()} className="rounded-lg border bg-card px-4 py-2 text-sm font-semibold">
              Thử lại
            </button>
          )}
          <a href="/home" className="rounded-lg border bg-card px-4 py-2 text-sm font-semibold">
            Trang chủ
          </a>
        </div>
      </div>
    </div>
  )
}
