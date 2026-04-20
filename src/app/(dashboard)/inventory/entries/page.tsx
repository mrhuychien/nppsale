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
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { formatDate } from "@/lib/utils"
import { STOCK_ENTRY_TYPES } from "@/lib/constants"
import {
  ClipboardList, Plus, Eye, Trash2, MoreHorizontal, Search,
  ArrowDownToLine, ArrowUpFromLine, ClipboardCheck,
} from "lucide-react"
import Link from "next/link"
import type { StockEntry } from "@/types"

export default function StockEntriesPage() {
  const { user, loading: authLoading } = useRoleGuard("inventory")
  const [entries, setEntries] = useState<StockEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState("all")
  const [deleteTarget, setDeleteTarget] = useState<StockEntry | null>(null)
  const [deleting, setDeleting] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const fetchData = async () => {
    setLoading(true)
    const { data } = await supabase
      .from("stock_entries")
      .select("*, creator:users!stock_entries_created_by_fkey(*)")
      .order("created_at", { ascending: false })
    setEntries((data as StockEntry[]) || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const { error } = await supabase.from("stock_entries").delete().eq("id", deleteTarget.id)
      if (error) throw error
      toast({ title: `Đã xóa phiếu ${deleteTarget.entry_code}` })
      setDeleteTarget(null)
      fetchData()
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
    } finally {
      setDeleting(false)
    }
  }

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

  const canCreate = user && hasPermission(user.role, "inventory", "create")
  const canDelete = user && hasPermission(user.role, "inventory", "delete")

  const filtered = entries.filter((e) => {
    const matchSearch = e.entry_code.toLowerCase().includes(search.toLowerCase()) ||
      (e.notes || "").toLowerCase().includes(search.toLowerCase())
    const matchType = typeFilter === "all" || e.type === typeFilter
    return matchSearch && matchType
  })

  // Stats
  const importCount = entries.filter((e) => e.type === "import").length
  const exportCount = entries.filter((e) => e.type === "export").length
  const stocktakeCount = entries.filter((e) => e.type === "stocktake").length

  return (
    <div className="space-y-4">
      <PageHeader title="Phiếu nhập/xuất kho" description={`${entries.length} phiếu`} backHref="/inventory">
        {canCreate && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Tạo phiếu
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => router.push("/inventory/stock-in")}>
                <ArrowDownToLine className="mr-2 h-4 w-4 text-green-600" />
                Nhập kho
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push("/inventory/stock-out")}>
                <ArrowUpFromLine className="mr-2 h-4 w-4 text-amber-600" />
                Xuất kho
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push("/inventory/stocktake")}>
                <ClipboardCheck className="mr-2 h-4 w-4 text-primary" />
                Kiểm kê / Điều chỉnh
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </PageHeader>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="bg-card rounded-2xl shadow-ambient p-4 border-l-4 border-green-500">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-bold">Nhập kho</p>
          <p className="text-2xl font-black text-foreground mt-1">{importCount}</p>
        </div>
        <div className="bg-card rounded-2xl shadow-ambient p-4 border-l-4 border-amber-500">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-bold">Xuất kho</p>
          <p className="text-2xl font-black text-foreground mt-1">{exportCount}</p>
        </div>
        <div className="bg-card rounded-2xl shadow-ambient p-4 border-l-4 border-primary">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-bold">Kiểm kê</p>
          <p className="text-2xl font-black text-foreground mt-1">{stocktakeCount}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Tìm mã phiếu hoặc ghi chú..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả loại</SelectItem>
            {STOCK_ENTRY_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-8 w-8 text-muted-foreground" />}
          title={entries.length === 0 ? "Chưa có phiếu kho" : "Không tìm thấy phiếu"}
          description={entries.length === 0 ? "Tạo phiếu đầu tiên bằng nút 'Tạo phiếu'" : "Thử đổi bộ lọc"}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mã phiếu</TableHead>
              <TableHead>Loại</TableHead>
              <TableHead>Người tạo</TableHead>
              <TableHead>Ghi chú</TableHead>
              <TableHead>Ngày</TableHead>
              <TableHead className="w-20 text-right">Thao tác</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((e) => (
              <TableRow
                key={e.id}
                className="cursor-pointer"
                onClick={() => router.push(`/inventory/entries/${e.id}`)}
              >
                <TableCell>
                  <Link
                    href={`/inventory/entries/${e.id}`}
                    className="font-mono text-sm text-primary font-bold hover:underline"
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    {e.entry_code}
                  </Link>
                </TableCell>
                <TableCell><Badge variant={getTypeVariant(e.type)}>{getTypeLabel(e.type)}</Badge></TableCell>
                <TableCell>{e.creator?.full_name || "-"}</TableCell>
                <TableCell className="text-muted-foreground truncate max-w-xs">{e.notes || "-"}</TableCell>
                <TableCell>{formatDate(e.created_at)}</TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={(ev) => {
                          ev.stopPropagation()
                          router.push(`/inventory/entries/${e.id}`)
                        }}
                      >
                        <Eye className="mr-2 h-4 w-4" /> Xem chi tiết
                      </DropdownMenuItem>
                      {canDelete && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={(ev) => {
                              ev.stopPropagation()
                              setDeleteTarget(e)
                            }}
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Xóa
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Xóa phiếu ${deleteTarget?.entry_code}?`}
        description="Phiếu và toàn bộ dòng chi tiết sẽ bị xóa vĩnh viễn. Không thể khôi phục."
        variant="destructive"
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={handleDelete}
        loading={deleting}
      />
    </div>
  )
}
