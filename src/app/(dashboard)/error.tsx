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
    <div className="flex h-screen items-center justify-center bg-background p-4">
      <div className="bg-card rounded-2xl border border-border/40 p-8 max-w-md w-full text-center space-y-4">
        <div className="w-12 h-12 mx-auto bg-destructive/10 rounded-2xl flex items-center justify-center text-destructive text-2xl font-black">
          !
        </div>
        <div>
          <h2 className="text-lg font-semibold mb-1">Không thể kết nối</h2>
          <p className="text-sm text-muted-foreground">
            {error.message || "Lỗi không xác định. Thử lại hoặc đăng nhập lại."}
          </p>
        </div>
        <div className="flex gap-2 justify-center">
          <button
            onClick={() => reset()}
            className="bg-primary text-white px-4 py-2 rounded-[10px] text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Thử lại
          </button>
          <button
            onClick={() => router.push("/login")}
            className="bg-muted text-foreground px-4 py-2 rounded-[10px] text-sm font-semibold hover:bg-muted/80 transition-colors"
          >
            Đăng nhập lại
          </button>
        </div>
      </div>
    </div>
  )
}
