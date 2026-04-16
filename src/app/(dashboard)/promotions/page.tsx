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
import { formatDate } from "@/lib/utils"
import { PROMOTION_TYPES } from "@/lib/constants"
import { Tag, Plus } from "lucide-react"
import type { Promotion } from "@/types"

export default function PromotionsPage() {
  const { user, loading: authLoading } = useRoleGuard("promotions")
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase.from("promotions").select("*").order("priority", { ascending: false })
      setPromotions((data as Promotion[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) return <Skeleton className="h-96" />

  const getTypeLabel = (type: string) => PROMOTION_TYPES.find((t) => t.value === type)?.label || type

  return (
    <div className="space-y-4">
      <PageHeader title="Khuyến mãi" description={`${promotions.length} chương trình`}>
        {user && hasPermission(user.role, "promotions", "create") && (
          <Button onClick={() => router.push("/promotions/new")}><Plus className="mr-2 h-4 w-4" /> Tạo KM</Button>
        )}
      </PageHeader>

      {promotions.length === 0 ? (
        <EmptyState icon={<Tag className="h-8 w-8 text-muted-foreground" />} title="Chưa có chương trình khuyến mãi" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tên chương trình</TableHead>
              <TableHead>Loại</TableHead>
              <TableHead>Ưu tiên</TableHead>
              <TableHead>Thời gian</TableHead>
              <TableHead>Trạng thái</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {promotions.map((p) => (
              <TableRow key={p.id} className="cursor-pointer" onClick={() => router.push(`/promotions/${p.id}`)}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell><Badge variant="outline">{getTypeLabel(p.type)}</Badge></TableCell>
                <TableCell>{p.priority}</TableCell>
                <TableCell className="text-sm">{p.starts_at ? formatDate(p.starts_at) : "?"} - {p.ends_at ? formatDate(p.ends_at) : "∞"}</TableCell>
                <TableCell>
                  <Badge variant={p.is_active ? "success" : "secondary"}>
                    {p.is_active ? "Đang chạy" : "Ngừng"}
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
