"use client"

import { ErrorScreen } from "@/components/error-screen"

/** Lỗi ở chính layout gốc — phải tự dựng <html>/<body>. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="vi">
      <body>
        <ErrorScreen error={error} reset={reset} noi="app/global-error" />
      </body>
    </html>
  )
}
