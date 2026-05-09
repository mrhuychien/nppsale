// T-09 / T-04: spec routes /warehouse and /operations both land here.
// In this codebase the warehouse functionality lives under /inventory
// (T-09 mounted "Tồn kho hiện tại" tab there). Permanent redirect so
// any external links / muscle memory match spec.

import { redirect, permanentRedirect } from "next/navigation"

export default function WarehouseRoot() {
  // permanentRedirect emits HTTP 308 (RFC 7538) which keeps method+body
  // intact — closest available equivalent to the spec's "301".
  if (typeof permanentRedirect === "function") {
    permanentRedirect("/inventory")
  }
  redirect("/inventory")
}
