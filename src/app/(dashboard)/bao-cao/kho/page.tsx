"use client"

import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { ManKho } from "@/components/bao-cao/man-kho"

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <ManKho />
    </Suspense>
  )
}
