"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/ui/status-badge"
import { PurchaseInvoiceForm } from "@/components/purchasing/purchase-invoice-form"
import { formatDate } from "@/lib/utils"

export default function PurchaseInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { loading: authLoading } = useRoleGuard("inventory")
  const supabase = createClient()
  const [meta, setMeta] = useState<{
    invoice_number: string | null
    invoice_date: string
    status: string
    supplier?: { name: string } | null
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from("purchase_invoices")
        .select("invoice_number, invoice_date, status, supplier:suppliers(name)")
        .eq("id", id)
        .single()
      if (!cancelled) {
        setMeta(data as unknown as typeof meta)
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!meta) {
    return (
      <div className="space-y-3">
        <PageHeader title="Không tìm thấy hoá đơn" backHref="/purchasing/invoices" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Hoá đơn nhập ${meta.invoice_number || "(chưa có số)"}`}
        description={`${meta.supplier?.name || "—"} • ${formatDate(meta.invoice_date)}`}
        backHref="/purchasing/invoices"
      >
        <StatusBadge status={meta.status} type="purchase_invoice" />
      </PageHeader>
      <PurchaseInvoiceForm invoiceId={id} />
    </div>
  )
}
