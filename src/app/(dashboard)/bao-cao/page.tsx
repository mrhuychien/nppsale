"use client"

import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { ManTongQuan } from "@/components/bao-cao/man-tong-quan"

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <ManTongQuan />
    </Suspense>
  )
}
