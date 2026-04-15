"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCurrency, formatDate } from "@/lib/utils"
import { FileText, Plus } from "lucide-react"
import type { Invoice } from "@/types"

export default function InvoicesPage() {
  const { user, loading: authLoading } = useRoleGuard("invoices")
  const router = useRouter()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase.from("invoices").select("*").order("created_at", { ascending: false })
      setInvoices((data as Invoice[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) return <Skeleton className="h-96" />

  const statusVariant = (s: string): "default" | "success" | "danger" | "secondary" => {
    switch (s) { case "issued": return "success"; case "cancelled": return "danger"; default: return "secondary" }
  }
  const statusLabel = (s: string) => { switch (s) { case "issued": return "Đã phát hành"; case "cancelled": return "Đã hủy"; default: return "Nháp" } }

  return (
    <div className="space-y-4">
      <PageHeader title="Hóa đơn điện tử" description={`${invoices.length} hóa đơn`}>
        {user && hasPermission(user.role, "invoices", "create") && (
          <Button onClick={() => router.push("/invoices/new")}><Plus className="mr-2 h-4 w-4" /> Tạo hóa đơn</Button>
        )}
      </PageHeader>

      {invoices.length === 0 ? (
        <EmptyState icon={<FileText className="h-8 w-8 text-muted-foreground" />} title="Chưa có hóa đơn" description="Hóa đơn được tạo từ đơn hàng đã giao" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Số hóa đơn</TableHead>
              <TableHead>Khách hàng</TableHead>
              <TableHead className="text-right">Tổng tiền</TableHead>
              <TableHead>Ngày phát hành</TableHead>
              <TableHead>Trạng thái</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell className="font-mono text-sm">{inv.invoice_number || "-"}</TableCell>
                <TableCell className="font-medium">{inv.customer_name}</TableCell>
                <TableCell className="text-right">{formatCurrency(inv.total)}</TableCell>
                <TableCell>{inv.issued_at ? formatDate(inv.issued_at) : "-"}</TableCell>
                <TableCell><Badge variant={statusVariant(inv.status)}>{statusLabel(inv.status)}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
