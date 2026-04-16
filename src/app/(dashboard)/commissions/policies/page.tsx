"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatDate } from "@/lib/utils"
import { COMMISSION_TYPES } from "@/lib/constants"
import { Settings2, Plus } from "lucide-react"
import type { CommissionPolicy } from "@/types"

export default function CommissionPoliciesPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("commissions")
  const [policies, setPolicies] = useState<CommissionPolicy[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()
  const router = useRouter()

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
      <PageHeader title="Chính sách hoa hồng" description={`${policies.length} chính sách`}>
        {user && hasPermission(user.role, "commissions", "create") && (
          <Button onClick={() => router.push("/commissions/policies/new")}><Plus className="mr-2 h-4 w-4" /> Tạo chính sách</Button>
        )}
      </PageHeader>

      {policies.length === 0 ? (
        <EmptyState icon={<Settings2 className="h-8 w-8 text-muted-foreground" />} title="Chưa có chính sách hoa hồng" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tên chính sách</TableHead>
              <TableHead>Loại</TableHead>
              <TableHead>Áp dụng cho</TableHead>
              <TableHead>Hiệu lực</TableHead>
              <TableHead>Trạng thái</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {policies.map((p) => (
              <TableRow key={p.id} className="cursor-pointer" onClick={() => router.push(`/commissions/policies/${p.id}`)}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>{getTypeLabel(p.type)}</TableCell>
                <TableCell>{p.applies_to === "all" ? "Tất cả" : p.applies_to}</TableCell>
                <TableCell className="text-sm">{p.effective_from ? formatDate(p.effective_from) : "-"} - {p.effective_to ? formatDate(p.effective_to) : "∞"}</TableCell>
                <TableCell>
                  <Badge variant={p.is_active ? "success" : "secondary"}>
                    {p.is_active ? "Đang áp dụng" : "Ngừng"}
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
