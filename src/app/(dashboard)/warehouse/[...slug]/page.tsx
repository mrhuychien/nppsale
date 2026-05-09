// T-09 catch-all: any /warehouse/<x> path redirects to /inventory/<x>.
// Spec uses /warehouse as the canonical namespace; repo evolved with
// /inventory. This shim keeps spec-style links working.

import { redirect, permanentRedirect } from "next/navigation"

interface Params {
  slug?: string[]
}

export default function WarehouseCatchAll({ params }: { params: Params }) {
  const tail = (params.slug || []).join("/")
  const target = tail ? `/inventory/${tail}` : "/inventory"
  if (typeof permanentRedirect === "function") {
    permanentRedirect(target)
  }
  redirect(target)
}
