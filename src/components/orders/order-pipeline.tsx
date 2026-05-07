"use client"

import { ChevronRight } from "lucide-react"
import type { SalesOrder } from "@/types"

// 7-step pipeline (Update #2 v2 — §8). Each order falls in exactly one
// step at a time; cancelled orders are excluded from counts. The last
// two steps are payment-derived: "Đã thu đủ" = receivable.paid ≥ amount,
// "Hoàn tất" = paid full + invoice finalized (or no invoice required).
export type PipelineStepKey =
  | "draft"
  | "confirmed"
  | "picking"
  | "delivering"
  | "delivered"
  | "paid_full"
  | "completed"

export interface OrderPipelineProps {
  orders: SalesOrder[]
  receivables: Record<string, { amount: number; paid: number; status: string }>
  invoices?: Record<string, { misa_status?: string | null }>
  active: PipelineStepKey | null
  onChange: (next: PipelineStepKey | null) => void
}

interface StepDef {
  key: PipelineStepKey
  label: string
  activeBg: string
  activeText: string
  activeRing: string
}

const STEPS: StepDef[] = [
  {
    key: "draft",
    label: "Mới tạo",
    activeBg: "bg-slate-100",
    activeText: "text-slate-800",
    activeRing: "ring-slate-400",
  },
  {
    key: "confirmed",
    label: "Đã duyệt",
    activeBg: "bg-blue-100",
    activeText: "text-blue-800",
    activeRing: "ring-blue-400",
  },
  {
    key: "picking",
    label: "Đang xuất kho",
    activeBg: "bg-indigo-100",
    activeText: "text-indigo-800",
    activeRing: "ring-indigo-400",
  },
  {
    key: "delivering",
    label: "Đang giao",
    activeBg: "bg-purple-100",
    activeText: "text-purple-800",
    activeRing: "ring-purple-400",
  },
  {
    key: "delivered",
    label: "Đã giao",
    activeBg: "bg-emerald-100",
    activeText: "text-emerald-800",
    activeRing: "ring-emerald-400",
  },
  {
    key: "paid_full",
    label: "Đã thu đủ",
    activeBg: "bg-teal-100",
    activeText: "text-teal-800",
    activeRing: "ring-teal-500",
  },
  {
    key: "completed",
    label: "Hoàn tất",
    activeBg: "bg-green-100",
    activeText: "text-green-900",
    activeRing: "ring-green-500",
  },
]

export function classifyOrder(
  order: Pick<SalesOrder, "status">,
  recv: { amount: number; paid: number; status: string } | undefined,
  invoice: { misa_status?: string | null } | undefined
): PipelineStepKey | null {
  if (order.status === "cancelled") return null
  if (order.status === "draft") return "draft"
  if (order.status === "confirmed") return "confirmed"
  if (order.status === "picking") return "picking"
  if (order.status === "delivering") return "delivering"
  if (order.status !== "delivered") return null

  const paidFull = !!recv && recv.amount > 0 && recv.paid + 0.5 >= recv.amount
  if (!paidFull) return "delivered"

  // Hoàn tất khi đã thu đủ + (không có hóa đơn HOẶC hóa đơn đã ký MISA).
  const needsInvoice = !!invoice && invoice.misa_status !== "signed"
  return needsInvoice ? "paid_full" : "completed"
}

export function OrderPipeline({
  orders,
  receivables,
  invoices = {},
  active,
  onChange,
}: OrderPipelineProps) {
  const counts: Record<PipelineStepKey, number> = {
    draft: 0,
    confirmed: 0,
    picking: 0,
    delivering: 0,
    delivered: 0,
    paid_full: 0,
    completed: 0,
  }
  for (const o of orders) {
    const step = classifyOrder(o, receivables[o.id], invoices[o.id])
    if (step) counts[step] += 1
  }

  return (
    <div className="sticky top-14 z-20 -mx-4 lg:mx-0 px-4 lg:px-3 py-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b lg:border lg:rounded-2xl lg:bg-card lg:shadow-sm">
      <div className="flex items-center gap-0 overflow-x-auto pb-1 -mb-1 [scrollbar-width:thin]">
        {STEPS.map((step, idx) => {
          const isActive = active === step.key
          const count = counts[step.key]
          const isLast = idx === STEPS.length - 1
          return (
            <div key={step.key} className="flex items-center shrink-0">
              <button
                type="button"
                onClick={() => onChange(isActive ? null : step.key)}
                aria-pressed={isActive}
                className={`flex flex-col items-start px-3 py-1.5 rounded-xl transition-all min-w-[96px] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  isActive
                    ? `${step.activeBg} ${step.activeText} ring-2 ${step.activeRing} font-bold shadow-sm`
                    : "text-muted-foreground hover:bg-muted/60"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                      isActive ? "bg-white/80" : "bg-muted"
                    }`}
                  >
                    {idx + 1}
                  </span>
                  <span className="text-xs font-semibold whitespace-nowrap">{step.label}</span>
                </div>
                <span
                  className={`mt-0.5 text-[11px] tabular-nums ${
                    isActive ? step.activeText : "text-muted-foreground"
                  }`}
                >
                  {count} đơn
                </span>
              </button>
              {!isLast && (
                <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
