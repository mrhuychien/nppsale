"use client"

import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { ManBanHang } from "@/components/bao-cao/man-ban-hang"

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <ManBanHang />
    </Suspense>
  )
}
