import { redirect } from "next/navigation"

// Legacy /hr/payroll surface retired — the canonical payroll flow is the
// payroll_runs / compute_payroll_run page at /hr/payroll/runs.
export default function PayrollIndexPage() {
  redirect("/hr/payroll/runs")
}
