"use client"

import { ErrorScreen } from "@/components/error-screen"

/** Bắt lỗi ở KHUNG APP (header, chuông, menu…) — nằm ngoài `(dashboard)/error.tsx`. */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen error={error} reset={reset} noi="app/error" />
}
