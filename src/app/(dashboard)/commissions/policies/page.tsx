"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatDate } from "@/lib/utils"
import { COMMISSION_TYPES } from "@/lib/constants"
import { Settings2 } from "lucide-react"
import type { CommissionPolicy } from "@/types"

export default function CommissionPoliciesPage() {
  const { loading: authLoading } = useRoleGuard("commissions")
  const [policies, setPolicies] = useState<CommissionPolicy[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase.from("commission_policies").select("*").order("created_at", { ascending: false })
      setPolicies((data as CommissionPolicy[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) return <Skeleton className="h-96" />

  const getTypeLabel = (type: string) => COMMISSION_TYPES.find((t) => t.value === type)?.label || type

  return (
    <div className="space-y-4">
      <PageHeader title="Chinh sach hoa hong" description={`${policies.length} chinh sach`} />

      {policies.length === 0 ? (
        <EmptyState icon={<Settings2 className="h-8 w-8 text-muted-foreground" />} title="Chua co chinh sach hoa hong" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ten chinh sach</TableHead>
              <TableHead>Loai</TableHead>
              <TableHead>Ap dung cho</TableHead>
              <TableHead>Hieu luc</TableHead>
              <TableHead>Trang thai</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {policies.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>{getTypeLabel(p.type)}</TableCell>
                <TableCell>{p.applies_to === "all" ? "Tat ca" : p.applies_to}</TableCell>
                <TableCell className="text-sm">{p.effective_from ? formatDate(p.effective_from) : "-"} - {p.effective_to ? formatDate(p.effective_to) : "∞"}</TableCell>
                <TableCell>
                  <Badge variant={p.is_active ? "success" : "secondary"}>
                    {p.is_active ? "Dang ap dung" : "Ngung"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
