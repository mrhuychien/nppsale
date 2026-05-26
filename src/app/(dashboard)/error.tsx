"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  useEffect(() => {
    console.error("[dashboard/error]", error)
  }, [error])

  return (
    <div className="flex h-screen items-center justify-center bg-surface p-4">
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/60 shadow-card p-8 max-w-md w-full text-center space-y-4">
        <div className="w-12 h-12 mx-auto bg-error-container rounded-xl flex items-center justify-center text-error text-2xl font-black">
          !
        </div>
        <div>
          <h2 className="text-headline-md font-semibold text-on-surface mb-1">Không thể kết nối</h2>
          <p className="text-sm text-on-surface-variant">
            {error.message || "Lỗi không xác định. Thử lại hoặc đăng nhập lại."}
          </p>
        </div>
        <div className="flex gap-2 justify-center">
          <button
            onClick={() => reset()}
            className="bg-primary text-on-primary px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary-container transition-colors"
          >
            Thử lại
          </button>
          <button
            onClick={() => router.push("/login")}
            className="bg-surface-container-low text-on-surface px-4 py-2 rounded-lg text-sm font-semibold hover:bg-surface-container transition-colors"
          >
            Đăng nhập lại
          </button>
        </div>
      </div>
    </div>
  )
}
