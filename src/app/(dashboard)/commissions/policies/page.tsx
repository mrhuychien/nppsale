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
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { ColumnPicker } from "@/components/ui/list-view-toolbar"
import {
  COMMISSION_POLICY_COLUMNS,
  DEFAULT_COMMISSION_POLICY_COLUMNS,
  type CommissionPolicyColumnKey,
} from "./list-config"

export default function CommissionPoliciesPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("commissions")
  const [policies, setPolicies] = useState<CommissionPolicy[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()
  const router = useRouter()
  const {
    columns: visibleColumns,
    setColumns,
    resetColumns,
  } = useListViewPrefs(
    "commission-policies",
    DEFAULT_COMMISSION_POLICY_COLUMNS,
    []
  )
  const show = (k: CommissionPolicyColumnKey) => visibleColumns.includes(k)

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
      <PageHeader title="Chính sách hoa hồng" description={`${policies.length} chính sách`} backHref="/commissions">
        <div className="flex items-center gap-2">
          <ColumnPicker
            available={COMMISSION_POLICY_COLUMNS}
            value={visibleColumns}
            onChange={setColumns}
            onReset={resetColumns}
          />
          {user && hasPermission(user.role, "commissions", "create") && (
            <Button onClick={() => router.push("/commissions/policies/new")}><Plus className="mr-2 h-4 w-4" /> Tạo chính sách</Button>
          )}
        </div>
      </PageHeader>

      {policies.length === 0 ? (
        <EmptyState icon={<Settings2 className="h-8 w-8 text-muted-foreground" />} title="Chưa có chính sách hoa hồng" />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tên chính sách</TableHead>
                  {show("type") && <TableHead>Loại</TableHead>}
                  {show("appliesTo") && <TableHead>Áp dụng cho</TableHead>}
                  {show("effective") && <TableHead>Hiệu lực</TableHead>}
                  {show("status") && <TableHead>Trạng thái</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => router.push(`/commissions/policies/${p.id}`)}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    {show("type") && <TableCell>{getTypeLabel(p.type)}</TableCell>}
                    {show("appliesTo") && <TableCell>{p.applies_to === "all" ? "Tất cả" : p.applies_to}</TableCell>}
                    {show("effective") && <TableCell className="text-sm">{p.effective_from ? formatDate(p.effective_from) : "-"} - {p.effective_to ? formatDate(p.effective_to) : "∞"}</TableCell>}
                    {show("status") && (
                      <TableCell>
                        <Badge variant={p.is_active ? "success" : "secondary"}>
                          {p.is_active ? "Đang áp dụng" : "Ngừng"}
                        </Badge>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile card list */}
          <div className="lg:hidden space-y-3">
            {policies.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest shadow-card overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
                onClick={() => router.push(`/commissions/policies/${p.id}`)}
              >
                <div className="p-4">
                  <div className="flex justify-between items-start gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-extrabold text-base leading-tight">{p.name}</h3>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <Badge variant="outline" className="text-xs">{getTypeLabel(p.type)}</Badge>
                        <Badge variant="outline" className="text-xs">
                          {p.applies_to === "all" ? "Tất cả" : p.applies_to}
                        </Badge>
                      </div>
                    </div>
                    <div className="shrink-0">
                      <Badge variant={p.is_active ? "success" : "secondary"}>
                        {p.is_active ? "Đang áp dụng" : "Ngừng"}
                      </Badge>
                    </div>
                  </div>
                  <div className="pt-2 mt-2 border-t text-xs text-muted-foreground">
                    Hiệu lực: {p.effective_from ? formatDate(p.effective_from) : "-"} - {p.effective_to ? formatDate(p.effective_to) : "∞"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
