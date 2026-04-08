"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCurrency, formatDate, getAgingStatus } from "@/lib/utils"
import { CreditCard } from "lucide-react"
import Link from "next/link"
import type { Receivable } from "@/types"

export default function ReceivablesPage() {
  const { loading: authLoading } = useRoleGuard("receivables")
  const [receivables, setReceivables] = useState<Receivable[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("receivables")
        .select("*, customer:customers(store_name), sales_user:users!receivables_sales_user_id_fkey(full_name)")
        .order("due_date")
      setReceivables((data as Receivable[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) return <Skeleton className="h-96" />

  const totalOutstanding = receivables.reduce((sum, r) => sum + (r.amount - r.paid), 0)
  const agingVariant = (status: string): "success" | "warning" | "danger" | "default" => {
    switch (status) { case "current": return "success"; case "warning": return "warning"; case "overdue": return "danger"; case "critical": return "danger"; default: return "default" }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Cong no" description={`Tong cong no: ${formatCurrency(totalOutstanding)}`}>
        <div className="flex gap-2">
          <Button variant="outline" asChild><Link href="/receivables/aging">Aging Report</Link></Button>
          <Button variant="outline" asChild><Link href="/receivables/collect">Thu tien</Link></Button>
        </div>
      </PageHeader>

      {receivables.length === 0 ? (
        <EmptyState icon={<CreditCard className="h-8 w-8 text-muted-foreground" />} title="Chua co cong no" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Khach hang</TableHead>
              <TableHead className="hidden sm:table-cell">NV phu trach</TableHead>
              <TableHead className="text-right">Phai thu</TableHead>
              <TableHead className="text-right">Da thu</TableHead>
              <TableHead className="text-right">Con lai</TableHead>
              <TableHead>Han</TableHead>
              <TableHead>Trang thai</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {receivables.map((r) => {
              const remaining = r.amount - r.paid
              const aging = r.due_date ? getAgingStatus(r.due_date) : "current"
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.customer?.store_name || "-"}</TableCell>
                  <TableCell className="hidden sm:table-cell">{r.sales_user?.full_name || "-"}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.amount)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.paid)}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(remaining)}</TableCell>
                  <TableCell>{r.due_date ? formatDate(r.due_date) : "-"}</TableCell>
                  <TableCell><Badge variant={agingVariant(aging)}>{r.status}</Badge></TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
