// T-17: legacy /hr/overview → /hr/attendance (spec acceptance).

import { redirect, permanentRedirect } from "next/navigation"

export default function HrOverviewRedirect() {
  if (typeof permanentRedirect === "function") {
    permanentRedirect("/hr/attendance")
  }
  redirect("/hr/attendance")
}
