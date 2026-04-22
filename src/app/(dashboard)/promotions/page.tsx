"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatDate } from "@/lib/utils"
import { PROMOTION_TYPES } from "@/lib/constants"
import { Tag, Plus, TrendingUp, Trophy } from "lucide-react"
import type { Promotion } from "@/types"

export default function PromotionsPage() {
  const { user, loading: authLoading } = useRoleGuard("promotions")
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("promotions")
        .select("*")
        .order("priority", { ascending: false })
      setPromotions((data as Promotion[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) return <Skeleton className="h-96" />

  const getTypeLabel = (type: string) => PROMOTION_TYPES.find((t) => t.value === type)?.label || type

  const topPromos = [...promotions]
    .filter((p) => p.is_active)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3)

  const medalColors = ["bg-amber-100 text-amber-700", "bg-slate-100 text-slate-700", "bg-orange-100 text-orange-700"]

  return (
    <div className="space-y-4">
      <PageHeader title="Khuyến mãi" description={`${promotions.length} chương trình`}>
        {user && hasPermission(user.role, "promotions", "create") && (
          <Button onClick={() => router.push("/promotions/new")}>
            <Plus className="mr-2 h-4 w-4" /> Tạo KM
          </Button>
        )}
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div>
          {promotions.length === 0 ? (
            <EmptyState
              icon={<Tag className="h-8 w-8 text-muted-foreground" />}
              title="Chưa có chương trình khuyến mãi"
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden lg:block rounded-2xl border bg-card shadow-sm overflow-hidden">
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
                      <TableRow
                        key={p.id}
                        className="cursor-pointer"
                        onClick={() => router.push(`/promotions/${p.id}`)}
                      >
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{getTypeLabel(p.type)}</Badge>
                        </TableCell>
                        <TableCell>{p.priority}</TableCell>
                        <TableCell className="text-sm">
                          {p.starts_at ? formatDate(p.starts_at) : "?"} -{" "}
                          {p.ends_at ? formatDate(p.ends_at) : "∞"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={p.is_active ? "success" : "secondary"}>
                            {p.is_active ? "Đang chạy" : "Ngừng"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile card list */}
              <div className="lg:hidden space-y-3">
                {promotions.map((p) => (
                  <div
                    key={p.id}
                    className="relative rounded-2xl border bg-card shadow-ambient overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
                    onClick={() => router.push(`/promotions/${p.id}`)}
                  >
                    <div className="p-4">
                      <div className="flex justify-between items-start gap-3 mb-2">
                        <div className="min-w-0 flex-1">
                          <h3 className="font-extrabold text-base leading-tight">
                            {p.name}
                          </h3>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            <Badge variant="outline" className="text-xs">{getTypeLabel(p.type)}</Badge>
                            <Badge variant="outline" className="text-xs">Ưu tiên: P{p.priority}</Badge>
                          </div>
                        </div>
                        <div className="shrink-0">
                          <Badge variant={p.is_active ? "success" : "secondary"}>
                            {p.is_active ? "Đang chạy" : "Ngừng"}
                          </Badge>
                        </div>
                      </div>
                      <div className="pt-2 mt-2 border-t text-xs text-muted-foreground">
                        {p.starts_at ? formatDate(p.starts_at) : "?"} - {p.ends_at ? formatDate(p.ends_at) : "∞"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* ROI sidebar */}
        <Card className="rounded-2xl shadow-ambient h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-primary" />
              So sánh ROI
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Top 3 chương trình theo độ ưu tiên
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {topPromos.length === 0 ? (
              <div className="text-sm text-muted-foreground italic">
                Chưa có chương trình hoạt động
              </div>
            ) : (
              topPromos.map((p, i) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-xl border p-3 hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => router.push(`/promotions/${p.id}`)}
                >
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${medalColors[i]}`}
                  >
                    <Trophy className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {getTypeLabel(p.type)}
                    </div>
                  </div>
                  <Badge variant="outline" className="shrink-0">
                    P{p.priority}
                  </Badge>
                </div>
              ))
            )}
            <div className="pt-2 text-xs text-muted-foreground border-t">
              Dữ liệu lượt áp dụng sắp cập nhật
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
