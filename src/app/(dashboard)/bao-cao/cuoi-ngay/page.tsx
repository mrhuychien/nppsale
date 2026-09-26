"use client"

import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { ManCuoiNgay } from "@/components/bao-cao/man-cuoi-ngay"

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <ManCuoiNgay />
    </Suspense>
  )
}
