"use client"

import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { ManTaiChinh } from "@/components/bao-cao/man-tai-chinh"

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <ManTaiChinh />
    </Suspense>
  )
}
