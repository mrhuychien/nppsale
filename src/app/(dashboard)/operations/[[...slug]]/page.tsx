// T-04: spec D12 — Vận hành module xoá hoàn toàn, /operations/* → 301
// to /warehouse/* (which we then redirect to /inventory/*). This shim
// makes external links to the legacy URL still resolve.

import { redirect, permanentRedirect } from "next/navigation"

interface Params {
  slug?: string[]
}

export default function OperationsLegacyRedirect({
  params,
}: {
  params: Params
}) {
  const tail = (params.slug || []).join("/")
  const target = tail ? `/warehouse/${tail}` : "/warehouse"
  if (typeof permanentRedirect === "function") {
    permanentRedirect(target)
  }
  redirect(target)
}
