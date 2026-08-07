"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { selectResilient } from "@/lib/supabase/resilient"
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
import { useToast } from "@/hooks/use-toast"
import { formatDate, getExpiryStatus } from "@/lib/utils"
import { BoxesIcon, Plus, Eye, AlertTriangle, Clock, ArrowRightLeft, RefreshCw } from "lucide-react"
import type { Batch, Product } from "@/types"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { ColumnPicker } from "@/components/ui/list-view-toolbar"
import {
  BATCH_COLUMNS,
  DEFAULT_BATCH_COLUMNS,
  type BatchColumnKey,
} from "./list-config"

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

export default function BatchesPage() {
  const { user, loading: authLoading } = useRoleGuard("inventory")
  const { toast } = useToast()
  const [batches, setBatches] = useState<(Batch & { product?: Product })[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab] = useState("all")
  const [movingId, setMovingId] = useState<string | null>(null)
  const supabase = createClient()
  const router = useRouter()
  const {
    columns: visibleColumns,
    setColumns,
    resetColumns,
  } = useListViewPrefs(
    "inventory-batches",
    DEFAULT_BATCH_COLUMNS,
    []
  )
  const show = (k: BatchColumnKey) => visibleColumns.includes(k)

  // selectResilient: DB thiếu cột thì tự thử lại với '*' thay vì rỗng im lặng.
  async function loadBatches() {
    const build = (select: string) =>
      supabase.from("batches").select(select).order("expires_at")
    const res = await selectResilient<Batch & { product?: Product }>(
      build,
      "id, org_id, product_id, batch_code, manufactured_at, expires_at, location, qty_initial, qty_on_hand, unit_cost, status, warehouse_zone, zone_moved_at, zone_moved_by, created_at, product:products(*)",
      // eslint-disable-next-line no-restricted-syntax
      "*, product:products(*)"
    )
    setBatches(res.data)
    setLoadError(res.error)
  }

  useEffect(() => {
    async function fetch() {
      await loadBatches()
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const expiring = useMemo(
    () => batches.filter((b) => daysUntil(b.expires_at) < 30 && daysUntil(b.expires_at) >= 0),
    [batches]
  )

  const saleBatches = useMemo(
    () => batches.filter((b) => b.warehouse_zone !== "date"),
    [batches]
  )
  const dateBatches = useMemo(
    () => batches.filter((b) => b.warehouse_zone === "date"),
    [batches]
  )

  const fefoBatches = useMemo(
    () => [...batches].sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime()),
    [batches]
  )

  const moveZone = async (batch: Batch, target: "sale" | "date") => {
    if (!user) return
    setMovingId(batch.id)
    try {
      const { error } = await supabase
        .from("batches")
        .update({
          warehouse_zone: target,
          zone_moved_at: new Date().toISOString(),
          zone_moved_by: user.id,
        })
        .eq("id", batch.id)
      if (error) throw error
      setBatches((prev) =>
        prev.map((b) => (b.id === batch.id ? { ...b, warehouse_zone: target } : b))
      )
      toast({
        title: target === "date" ? "Đã chuyển sang Kho hàng date" : "Đã chuyển sang Kho hàng bán",
      })
    } catch (err) {
      toast({
        title: "Lỗi",
        description: err instanceof Error ? err.message : "Không thể chuyển kho",
        variant: "destructive",
      })
    } finally {
      setMovingId(null)
    }
  }

  const refreshZones = async () => {
    if (!user?.org_id) return
    setRefreshing(true)
    try {
      const { data, error } = await supabase.rpc("refresh_warehouse_zones", {
        p_org_id: user.org_id,
      })
      if (error) throw error
      const moved = Number(data ?? 0)
      toast({ title: `Đã rà soát kho`, description: `${moved} lô chuyển sang kho date` })
      await loadBatches()
    } catch (err) {
      toast({
        title: "Lỗi",
        description: err instanceof Error ? err.message : "Không thể rà soát",
        variant: "destructive",
      })
    } finally {
      setRefreshing(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />

  const canCreate =
    user && ["warehouse", "owner"].includes(user.role) && hasPermission(user.role, "inventory", "create")

  const renderTable = (rows: (Batch & { product?: Product })[], showCountdown = false) => (
    <>
      {/* Desktop table */}
      <div className="hidden lg:block rounded-2xl border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sản phẩm</TableHead>
              {show("batchCode") && <TableHead>Mã lô</TableHead>}
              {show("zone") && <TableHead>Kho</TableHead>}
              {show("location") && <TableHead>Vị trí</TableHead>}
              {show("qtyInitial") && <TableHead className="text-right">Ban đầu</TableHead>}
              {show("qtyOnHand") && <TableHead className="text-right">Tồn</TableHead>}
              {show("manufacturedAt") && <TableHead>NSX</TableHead>}
              {show("expiresAt") && <TableHead>HSD</TableHead>}
              {showCountdown && <TableHead>Còn lại</TableHead>}
              <TableHead className="w-32 text-right">Thao tác</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((b) => {
              const status = getExpiryStatus(b.expires_at, b.product?.shelf_life_days ?? undefined)
              const days = daysUntil(b.expires_at)
              const isCritical = days < 30
              const isDateZone = b.warehouse_zone === "date"
              const target = isDateZone ? "sale" : "date"
              return (
                <TableRow
                  key={b.id}
                  className={`cursor-pointer ${isCritical && showCountdown ? "bg-error-container/50 hover:bg-error-container" : ""}`}
                  onClick={() => router.push(`/inventory/batches/${b.id}`)}
                >
                  <TableCell className="font-medium">{b.product?.name}</TableCell>
                  {show("batchCode") && <TableCell className="font-mono text-sm">{b.batch_code}</TableCell>}
                  {show("zone") && (
                    <TableCell>
                      <Badge
                        variant={isDateZone ? "warning" : "success"}
                        className="font-semibold"
                      >
                        {isDateZone ? "Date" : "Bán"}
                      </Badge>
                    </TableCell>
                  )}
                  {show("location") && <TableCell>{b.location || "-"}</TableCell>}
                  {show("qtyInitial") && <TableCell className="text-right tabular-nums">{b.qty_initial}</TableCell>}
                  {show("qtyOnHand") && <TableCell className="text-right tabular-nums font-medium">{b.qty_on_hand}</TableCell>}
                  {show("manufacturedAt") && <TableCell>{b.manufactured_at ? formatDate(b.manufactured_at) : "-"}</TableCell>}
                  {show("expiresAt") && (
                    <TableCell>
                      <Badge
                        variant={
                          status === "danger" ? "danger" : status === "warning" ? "warning" : "success"
                        }
                      >
                        {formatDate(b.expires_at)}
                      </Badge>
                    </TableCell>
                  )}
                  {showCountdown && (
                    <TableCell>
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-semibold ${
                          days < 0
                            ? "text-error"
                            : days < 30
                            ? "text-error"
                            : days < 90
                            ? "text-[#b54708]"
                            : "text-muted-foreground"
                        }`}
                      >
                        <Clock className="h-3 w-3" />
                        {days < 0 ? `Đã hết hạn ${Math.abs(days)}d` : `${days} ngày`}
                      </span>
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <div className="flex justify-end items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        disabled={movingId === b.id}
                        onClick={() => moveZone(b, target)}
                      >
                        <ArrowRightLeft className="h-3 w-3 mr-1" />
                        {target === "date" ? "→ Date" : "→ Bán"}
                      </Button>
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile card list */}
      <div className="lg:hidden space-y-3">
        {rows.map((b) => {
          const status = getExpiryStatus(b.expires_at, b.product?.shelf_life_days ?? undefined)
          const days = daysUntil(b.expires_at)
          const isCritical = days < 30
          const isDateZone = b.warehouse_zone === "date"
          const target = isDateZone ? "sale" : "date"
          return (
            <div
              key={b.id}
              className={`relative rounded-xl border border-outline-variant/60 bg-surface-container-lowest shadow-card overflow-hidden cursor-pointer active:scale-[0.99] transition-transform ${
                isCritical && showCountdown ? "border-error/40 bg-error-container/30" : ""
              }`}
              onClick={() => router.push(`/inventory/batches/${b.id}`)}
            >
              <div className="p-4">
                <div className="flex justify-between items-start gap-3 mb-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-extrabold text-base leading-tight truncate">
                      {b.product?.name}
                    </h3>
                    <p className="font-mono text-xs text-primary mt-0.5">
                      Lô: {b.batch_code}
                    </p>
                    {b.location && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Vị trí: {b.location}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <Badge variant={isDateZone ? "warning" : "success"} className="font-semibold">
                      {isDateZone ? "Kho date" : "Kho bán"}
                    </Badge>
                    <Badge
                      variant={
                        status === "danger" ? "danger" : status === "warning" ? "warning" : "success"
                      }
                    >
                      HSD: {formatDate(b.expires_at)}
                    </Badge>
                    {showCountdown && (
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-semibold ${
                          days < 0
                            ? "text-error"
                            : days < 30
                            ? "text-error"
                            : days < 90
                            ? "text-[#b54708]"
                            : "text-muted-foreground"
                        }`}
                      >
                        <Clock className="h-3 w-3" />
                        {days < 0 ? `Hết hạn ${Math.abs(days)}d` : `${days} ngày`}
                      </span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-2 mt-2 border-t text-xs">
                  <div>
                    <p className="text-muted-foreground">Ban đầu</p>
                    <p className="font-medium">{b.qty_initial}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Tồn</p>
                    <p className="font-bold">{b.qty_on_hand}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">NSX</p>
                    <p className="font-medium">
                      {b.manufactured_at ? formatDate(b.manufactured_at) : "-"}
                    </p>
                  </div>
                </div>
                <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    disabled={movingId === b.id}
                    onClick={() => moveZone(b, target)}
                  >
                    <ArrowRightLeft className="h-3.5 w-3.5 mr-2" />
                    Chuyển sang {target === "date" ? "Kho hàng date" : "Kho hàng bán"}
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )

  return (
    <div className="space-y-4">
      <PageHeader title="Quản lý lô hàng" description={`${batches.length} lô hàng`} backHref="/inventory">
        <div className="flex items-center gap-2">
          <ColumnPicker
            available={BATCH_COLUMNS}
            value={visibleColumns}
            onChange={setColumns}
            onReset={resetColumns}
          />
          {canCreate && (
            <Button variant="outline" size="sm" onClick={refreshZones} disabled={refreshing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Rà soát kho date
            </Button>
          )}
          {canCreate && (
            <Button asChild>
              <Link href="/inventory/batches/new">
                <Plus className="mr-2 h-4 w-4" /> Tạo lô mới
              </Link>
            </Button>
          )}
        </div>
      </PageHeader>

      {/* Lỗi tải dữ liệu — hiện rõ thay vì im lặng ra danh sách rỗng. */}
      {loadError && (
        <div className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container">
          <p className="font-semibold">Không tải được danh sách lô hàng</p>
          <p className="mt-0.5 break-words">{loadError}</p>
        </div>
      )}

      {expiring.length > 0 && (
        <Card
          className="rounded-2xl border-error/40 bg-gradient-to-r from-error-container to-error-container/40 shadow-card cursor-pointer"
          onClick={() => setTab("expiring")}
        >
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="rounded-xl bg-error-container p-3 text-error">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="font-semibold text-error">
                {expiring.length} lô sắp hết hạn (&lt; 30 ngày)
              </div>
              <div className="text-xs text-error">
                Nhấn để xem danh sách và ưu tiên xuất trước
              </div>
            </div>
            <Button size="sm" variant="outline" className="border-error/40 text-error">
              Xem ngay
            </Button>
          </CardContent>
        </Card>
      )}

      {batches.length === 0 ? (
        <EmptyState
          icon={<BoxesIcon className="h-8 w-8 text-muted-foreground" />}
          title={loadError ? "Không tải được dữ liệu" : "Chưa có lô hàng"}
          description={
            loadError
              ? "Xem thông báo lỗi phía trên."
              : "Lô hàng sẽ được tạo khi nhập kho hoặc bằng nút 'Tạo lô mới'"
          }
        />
      ) : (
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList>
            <TabsTrigger value="all">Tất cả ({batches.length})</TabsTrigger>
            <TabsTrigger value="sale">Kho hàng bán ({saleBatches.length})</TabsTrigger>
            <TabsTrigger value="date">Kho hàng date ({dateBatches.length})</TabsTrigger>
            <TabsTrigger value="fefo">FEFO (ưu tiên xuất)</TabsTrigger>
            <TabsTrigger value="expiring">
              Sắp hết hạn ({expiring.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="all" className="mt-4">
            {renderTable(batches)}
          </TabsContent>
          <TabsContent value="sale" className="mt-4">
            <p className="text-xs text-muted-foreground mb-2">
              Hàng còn xa hạn — bán theo giá list bình thường.
            </p>
            {saleBatches.length === 0 ? (
              <EmptyState
                icon={<BoxesIcon className="h-8 w-8 text-muted-foreground" />}
                title="Kho hàng bán trống"
                description="Tất cả lô hiện tại đều thuộc kho date"
              />
            ) : (
              renderTable(saleBatches)
            )}
          </TabsContent>
          <TabsContent value="date" className="mt-4">
            <p className="text-xs text-muted-foreground mb-2">
              Hàng gần hạn — gom lại bán xả với giá ưu đãi. Tự động chuyển khi
              ≤ ngưỡng cấu hình ở Cài đặt giá.
            </p>
            {dateBatches.length === 0 ? (
              <EmptyState
                icon={<Clock className="h-8 w-8 text-muted-foreground" />}
                title="Chưa có hàng date"
                description="Chưa có lô nào gần hạn — tất cả đang ở kho hàng bán"
              />
            ) : (
              renderTable(dateBatches, true)
            )}
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
