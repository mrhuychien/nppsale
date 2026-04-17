"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
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
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatDate, getExpiryStatus } from "@/lib/utils"
import { BoxesIcon, Plus, Eye, AlertTriangle, Clock } from "lucide-react"
import type { Batch, Product } from "@/types"

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

export default function BatchesPage() {
  const { user, loading: authLoading } = useRoleGuard("inventory")
  const [batches, setBatches] = useState<(Batch & { product?: Product })[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState("all")
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("batches")
        .select("*, product:products(*)")
        .order("expires_at")
      setBatches((data as (Batch & { product?: Product })[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const expiring = useMemo(
    () => batches.filter((b) => daysUntil(b.expires_at) < 30 && daysUntil(b.expires_at) >= 0),
    [batches]
  )

  const fefoBatches = useMemo(
    () => [...batches].sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime()),
    [batches]
  )

  if (authLoading || loading) return <Skeleton className="h-96" />

  const canCreate =
    user && ["warehouse", "owner"].includes(user.role) && hasPermission(user.role, "inventory", "create")

  const renderTable = (rows: (Batch & { product?: Product })[], showCountdown = false) => (
    <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Sản phẩm</TableHead>
            <TableHead>Mã lô</TableHead>
            <TableHead>Vị trí</TableHead>
            <TableHead className="text-right">Ban đầu</TableHead>
            <TableHead className="text-right">Tồn</TableHead>
            <TableHead>NSX</TableHead>
            <TableHead>HSD</TableHead>
            {showCountdown && <TableHead>Còn lại</TableHead>}
            <TableHead className="w-12"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((b) => {
            const status = getExpiryStatus(b.expires_at, b.product?.shelf_life_days ?? undefined)
            const days = daysUntil(b.expires_at)
            const isCritical = days < 30
            return (
              <TableRow
                key={b.id}
                className={`cursor-pointer ${isCritical && showCountdown ? "bg-red-50/50 hover:bg-red-50" : ""}`}
                onClick={() => router.push(`/inventory/batches/${b.id}`)}
              >
                <TableCell className="font-medium">{b.product?.name}</TableCell>
                <TableCell className="font-mono text-sm">{b.batch_code}</TableCell>
                <TableCell>{b.location || "-"}</TableCell>
                <TableCell className="text-right">{b.qty_initial}</TableCell>
                <TableCell className="text-right font-medium">{b.qty_on_hand}</TableCell>
                <TableCell>{b.manufactured_at ? formatDate(b.manufactured_at) : "-"}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      status === "danger" ? "danger" : status === "warning" ? "warning" : "success"
                    }
                  >
                    {formatDate(b.expires_at)}
                  </Badge>
                </TableCell>
                {showCountdown && (
                  <TableCell>
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-semibold ${
                        days < 0
                          ? "text-red-600"
                          : days < 30
                          ? "text-red-600"
                          : days < 90
                          ? "text-amber-600"
                          : "text-muted-foreground"
                      }`}
                    >
                      <Clock className="h-3 w-3" />
                      {days < 0 ? `Đã hết hạn ${Math.abs(days)}d` : `${days} ngày`}
                    </span>
                  </TableCell>
                )}
                <TableCell>
                  <Eye className="h-4 w-4 text-muted-foreground" />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )

  return (
    <div className="space-y-4">
      <PageHeader title="Quản lý lô hàng" description={`${batches.length} lô hàng`}>
        {canCreate && (
          <Button asChild>
            <Link href="/inventory/batches/new">
              <Plus className="mr-2 h-4 w-4" /> Tạo lô mới
            </Link>
          </Button>
        )}
      </PageHeader>

      {expiring.length > 0 && (
        <Card
          className="rounded-2xl border-red-300 bg-gradient-to-r from-red-50 to-red-50/40 shadow-ambient cursor-pointer"
          onClick={() => setTab("expiring")}
        >
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="rounded-xl bg-red-100 p-3 text-red-700">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="font-semibold text-red-900">
                {expiring.length} lô sắp hết hạn (&lt; 30 ngày)
              </div>
              <div className="text-xs text-red-700">
                Nhấn để xem danh sách và ưu tiên xuất trước
              </div>
            </div>
            <Button size="sm" variant="outline" className="border-red-300 text-red-700">
              Xem ngay
            </Button>
          </CardContent>
        </Card>
      )}

      {batches.length === 0 ? (
        <EmptyState
          icon={<BoxesIcon className="h-8 w-8 text-muted-foreground" />}
          title="Chưa có lô hàng"
          description="Lô hàng sẽ được tạo khi nhập kho hoặc bằng nút 'Tạo lô mới'"
        />
      ) : (
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList>
            <TabsTrigger value="all">Tất cả ({batches.length})</TabsTrigger>
            <TabsTrigger value="fefo">FEFO (ưu tiên xuất)</TabsTrigger>
            <TabsTrigger value="expiring">
              Sắp hết hạn ({expiring.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="all" className="mt-4">
            {renderTable(batches)}
          </TabsContent>
          <TabsContent value="fefo" className="mt-4">
            <p className="text-xs text-muted-foreground mb-2">
              Lô xếp theo hạn sử dụng tăng dần - ưu tiên xuất trước (First Expiry First Out)
            </p>
            {renderTable(fefoBatches, true)}
          </TabsContent>
          <TabsContent value="expiring" className="mt-4">
            {expiring.length === 0 ? (
              <EmptyState
                icon={<AlertTriangle className="h-8 w-8 text-muted-foreground" />}
                title="Không có lô sắp hết hạn"
                description="Tất cả lô hàng còn hạn trên 30 ngày"
              />
            ) : (
              renderTable(expiring, true)
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
