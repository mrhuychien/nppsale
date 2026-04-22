"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatDate } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import {
  ArrowDownToLine, ArrowUpFromLine, ClipboardList, Eye, Package,
  CircleCheck, AlertCircle,
} from "lucide-react"
import type { StockEntry, StockEntryLine, Product } from "@/types"

type PendingEntry = StockEntry & {
  lines?: Array<StockEntryLine & { product?: Product }>
}

const TYPE_META: Record<string, { icon: typeof Package; label: string; color: string }> = {
  import: { icon: ArrowDownToLine, label: "Nhập kho", color: "text-emerald-600 bg-emerald-100" },
  export: { icon: ArrowUpFromLine, label: "Xuất kho", color: "text-amber-600 bg-amber-100" },
  transfer: { icon: Package, label: "Chuyển kho", color: "text-blue-600 bg-blue-100" },
  stocktake: { icon: ClipboardList, label: "Kiểm kê", color: "text-primary bg-primary/10" },
}

export default function PendingStockPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const [entries, setEntries] = useState<PendingEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [posting, setPosting] = useState<string | null>(null)

  const fetchPending = async () => {
    setLoading(true)
    const { data } = await supabase
      .from("stock_entries")
      .select("*, lines:stock_entry_lines(*, product:products(id, name, sku, base_unit))")
      .eq("status", "draft")
      .order("created_at", { ascending: false })
    setEntries((data as PendingEntry[]) || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchPending()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const imports = useMemo(() => entries.filter((e) => e.type === "import"), [entries])
  const exports = useMemo(() => entries.filter((e) => e.type === "export"), [entries])
  const transfers = useMemo(() => entries.filter((e) => e.type === "transfer"), [entries])

  const totalQty = (entry: PendingEntry) =>
    (entry.lines || []).reduce((s, l) => s + (Number(l.quantity) || 0), 0)

  const handlePost = async (entry: PendingEntry) => {
    setPosting(entry.id)
    try {
      const { error } = await supabase
        .from("stock_entries")
        .update({ status: "posted", posted_at: new Date().toISOString() })
        .eq("id", entry.id)
      if (error) throw error
      toast({ title: `Đã đăng phiếu ${entry.entry_code}` })
      fetchPending()
    } catch (err) {
      const message = err instanceof Error ? err.message : "Lỗi"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setPosting(null)
    }
  }

  const handleCancel = async (entry: PendingEntry) => {
    setPosting(entry.id)
    try {
      const { error } = await supabase
        .from("stock_entries")
        .update({ status: "cancelled" })
        .eq("id", entry.id)
      if (error) throw error
      toast({ title: `Đã hủy phiếu ${entry.entry_code}` })
      fetchPending()
    } catch (err) {
      const message = err instanceof Error ? err.message : "Lỗi"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setPosting(null)
    }
  }

  const renderList = (list: PendingEntry[]) => {
    if (list.length === 0) {
      return (
        <EmptyState
          icon={<ClipboardList className="h-8 w-8 text-muted-foreground" />}
          title="Không có phiếu chờ"
          description="Phiếu sẽ hiển thị ở đây khi có tài liệu nháp (status = draft)"
        />
      )
    }
    return (
      <div className="space-y-3">
        {list.map((e) => {
          const meta = TYPE_META[e.type] || TYPE_META.import
          const Icon = meta.icon
          const qty = totalQty(e)
          return (
            <Card key={e.id}>
              <CardContent className="p-4">
                <div className="flex justify-between items-start gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${meta.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/inventory/entries/${e.id}`}
                          className="font-mono text-sm font-bold text-primary hover:underline"
                        >
                          {e.entry_code}
                        </Link>
                        <Badge variant="warning">Nháp</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {meta.label} • {formatDate(e.created_at)} • {e.lines?.length || 0} SP • SL: <span className="font-bold">{qty}</span>
                      </p>
                      {e.notes && (
                        <p className="text-xs text-muted-foreground mt-1 italic line-clamp-1">
                          &ldquo;{e.notes}&rdquo;
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 flex flex-wrap gap-2 justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => router.push(`/inventory/entries/${e.id}`)}
                    >
                      <Eye className="h-3.5 w-3.5 mr-1" /> Xem
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handlePost(e)}
                      disabled={posting === e.id}
                    >
                      <CircleCheck className="h-3.5 w-3.5 mr-1" />
                      {posting === e.id ? "Đang đăng..." : "Đăng"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => handleCancel(e)}
                      disabled={posting === e.id}
                    >
                      Hủy
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    )
  }

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader
        title="Phiếu kho chờ xử lý"
        description={`${entries.length} phiếu đang ở trạng thái nháp, chưa ảnh hưởng tồn`}
        backHref="/inventory"
      />

      {entries.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <p className="font-semibold">Các phiếu nháp không ảnh hưởng tồn kho</p>
            <p className="text-xs mt-0.5">
              Chỉ khi đăng (post), tồn kho thực mới được cập nhật. Phiếu bị hủy giữ nguyên lịch sử để kiểm toán.
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <Skeleton className="h-64" />
      ) : (
        <Tabs defaultValue="import">
          <TabsList>
            <TabsTrigger value="import">
              Chờ nhập ({imports.length})
            </TabsTrigger>
            <TabsTrigger value="export">
              Chờ xuất ({exports.length})
            </TabsTrigger>
            <TabsTrigger value="transfer">
              Chuyển kho ({transfers.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="import" className="mt-4">
            {renderList(imports)}
          </TabsContent>
          <TabsContent value="export" className="mt-4">
            {renderList(exports)}
          </TabsContent>
          <TabsContent value="transfer" className="mt-4">
            {renderList(transfers)}
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
