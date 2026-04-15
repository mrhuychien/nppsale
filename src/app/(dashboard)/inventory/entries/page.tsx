"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatDate } from "@/lib/utils"
import { STOCK_ENTRY_TYPES } from "@/lib/constants"
import { ClipboardList, Plus } from "lucide-react"
import Link from "next/link"
import type { StockEntry } from "@/types"

export default function StockEntriesPage() {
  const { user, loading: authLoading } = useRoleGuard("inventory")
  const [entries, setEntries] = useState<StockEntry[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("stock_entries")
        .select("*, creator:users!stock_entries_created_by_fkey(*)")
        .order("created_at", { ascending: false })
      setEntries((data as StockEntry[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) return <Skeleton className="h-96" />

  const getTypeLabel = (type: string) => STOCK_ENTRY_TYPES.find((t) => t.value === type)?.label || type
  const getTypeVariant = (type: string): "default" | "success" | "warning" | "secondary" => {
    switch (type) {
      case "import": return "success"
      case "export": return "warning"
      case "transfer": return "default"
      default: return "secondary"
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Phiếu kho" description={`${entries.length} phiếu`}>
        {user && hasPermission(user.role, "inventory", "create") && (
          <Button asChild><Link href="/inventory/stocktake"><Plus className="mr-2 h-4 w-4" /> Tạo phiếu</Link></Button>
        )}
      </PageHeader>

      {entries.length === 0 ? (
        <EmptyState icon={<ClipboardList className="h-8 w-8 text-muted-foreground" />} title="Chưa có phiếu kho" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mã phiếu</TableHead>
              <TableHead>Loại</TableHead>
              <TableHead>Người tạo</TableHead>
              <TableHead>Ghi chú</TableHead>
              <TableHead>Ngày</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-mono text-sm">{e.entry_code}</TableCell>
                <TableCell><Badge variant={getTypeVariant(e.type)}>{getTypeLabel(e.type)}</Badge></TableCell>
                <TableCell>{e.creator?.full_name || "-"}</TableCell>
                <TableCell className="text-muted-foreground">{e.notes || "-"}</TableCell>
                <TableCell>{formatDate(e.created_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
