"use client"

import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { ManCongNo } from "@/components/bao-cao/man-cong-no"

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <ManCongNo />
    </Suspense>
  )
}
