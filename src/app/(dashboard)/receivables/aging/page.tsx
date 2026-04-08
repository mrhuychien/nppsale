"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency, getAgingStatus } from "@/lib/utils"
import type { Receivable } from "@/types"

export default function AgingReportPage() {
  const { loading: authLoading } = useRoleGuard("receivables")
  const [receivables, setReceivables] = useState<Receivable[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("receivables")
        .select("*, customer:customers(store_name)")
        .neq("status", "paid")
        .order("due_date")
      setReceivables((data as Receivable[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) return <Skeleton className="h-96" />

  const buckets = { current: 0, warning: 0, overdue: 0, critical: 0 }
  receivables.forEach((r) => {
    const aging = r.due_date ? getAgingStatus(r.due_date) : "current"
    buckets[aging] += (r.amount - r.paid)
  })

  const colorMap = { current: "bg-green-100 text-green-800", warning: "bg-amber-100 text-amber-800", overdue: "bg-orange-100 text-orange-800", critical: "bg-red-100 text-red-800" }
  const labelMap = { current: "Chua den han", warning: "Qua han 1-30 ngay", overdue: "Qua han 31-60 ngay", critical: "Qua han > 60 ngay" }

  return (
    <div className="space-y-4">
      <PageHeader title="Aging Report" description="Phan tich tuoi cong no" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.keys(buckets) as Array<keyof typeof buckets>).map((key) => (
          <Card key={key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{labelMap[key]}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-xl font-bold px-2 py-1 rounded ${colorMap[key]}`}>
                {formatCurrency(buckets[key])}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>Chi tiet</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Khach hang</TableHead>
                <TableHead className="text-right">Con no</TableHead>
                <TableHead>Tinh trang</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {receivables.map((r) => {
                const aging = r.due_date ? getAgingStatus(r.due_date) : "current"
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.customer?.store_name}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.amount - r.paid)}</TableCell>
                    <TableCell><span className={`px-2 py-0.5 rounded text-xs font-medium ${colorMap[aging]}`}>{labelMap[aging]}</span></TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
