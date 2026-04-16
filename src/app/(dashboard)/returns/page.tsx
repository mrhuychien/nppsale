"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusBadge } from "@/components/ui/status-badge"
import { formatCurrency, formatDate } from "@/lib/utils"
import { RETURN_REASONS } from "@/lib/constants"
import { RotateCcw, Plus } from "lucide-react"
import type { Return } from "@/types"

export default function ReturnsPage() {
  const { user, loading: authLoading } = useRoleGuard("returns")
  const [returns, setReturns] = useState<Return[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("returns")
        .select("*, customer:customers(store_name), requester:users!returns_requested_by_fkey(full_name)")
        .order("created_at", { ascending: false })
      setReturns((data as Return[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) return <Skeleton className="h-96" />

  const getReasonLabel = (reason: string | null) => RETURN_REASONS.find((r) => r.value === reason)?.label || reason || "-"

  return (
    <div className="space-y-4">
      <PageHeader title="Trả hàng" description={`${returns.length} yêu cầu`}>
        {user && hasPermission(user.role, "returns", "create") && (
          <Button onClick={() => router.push("/returns/new")}><Plus className="mr-2 h-4 w-4" /> Tạo yêu cầu</Button>
        )}
      </PageHeader>

      {returns.length === 0 ? (
        <EmptyState icon={<RotateCcw className="h-8 w-8 text-muted-foreground" />} title="Chưa có yêu cầu trả hàng" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Khách hàng</TableHead>
              <TableHead>Lý do</TableHead>
              <TableHead>Người yêu cầu</TableHead>
              <TableHead className="text-right">Credit Note</TableHead>
              <TableHead>Ngày</TableHead>
              <TableHead>Trạng thái</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {returns.map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => router.push(`/returns/${r.id}`)}>
                <TableCell className="font-medium">{r.customer?.store_name || "-"}</TableCell>
                <TableCell>{getReasonLabel(r.reason)}</TableCell>
                <TableCell>{r.requester?.full_name || "-"}</TableCell>
                <TableCell className="text-right">{r.credit_note_amount ? formatCurrency(r.credit_note_amount) : "-"}</TableCell>
                <TableCell>{formatDate(r.created_at)}</TableCell>
                <TableCell><StatusBadge status={r.status} type="return" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
