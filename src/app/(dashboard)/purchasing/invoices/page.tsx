"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { hasPermission } from "@/lib/permissions"
import { useToast } from "@/hooks/use-toast"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/ui/status-badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Search, FileText, Plus, Columns3, Trash2, CheckCircle2, X } from "lucide-react"
import type { PurchaseInvoice } from "@/types"

type ColKey = "invoice_number" | "supplier" | "invoice_date" | "lines" | "total" | "status" | "created_at"
const ALL_COLS: { key: ColKey; label: string }[] = [
  { key: "invoice_number", label: "Số HĐ" },
  { key: "supplier", label: "Nhà cung cấp" },
  { key: "invoice_date", label: "Ngày HĐ" },
  { key: "lines", label: "Số dòng" },
  { key: "total", label: "Tổng tiền" },
  { key: "status", label: "Trạng thái" },
  { key: "created_at", label: "Ngày tạo" },
]
const DEFAULT_COLS: ColKey[] = ["invoice_number", "supplier", "invoice_date", "total", "status"]
const COLS_STORAGE_KEY = "pinv-list-cols"

type InvoiceRow = PurchaseInvoice & {
  supplier?: { name: string; code: string | null } | null
  _lineCount?: number
}

const STATUS_CHIPS: { value: string; label: string }[] = [
  { value: "all", label: "Tất cả" },
  { value: "draft", label: "Nháp" },
  { value: "completed", label: "Hoàn thành" },
  { value: "cancelled", label: "Đã huỷ" },
]

export default function PurchaseInvoicesPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const { user } = useAuth()
  const { toast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get("status") || "all")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [visibleCols, setVisibleCols] = useState<ColKey[]>(DEFAULT_COLS)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)

  const canManage = !!user && hasPermission(user.role, "inventory", "update")

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLS_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as ColKey[]
        if (Array.isArray(parsed) && parsed.length) setVisibleCols(parsed.filter((c) => ALL_COLS.some((x) => x.key === c)))
      }
    } catch { /* ignore */ }
  }, [])

  const persistCols = (cols: ColKey[]) => {
    setVisibleCols(cols)
    try { localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(cols)) } catch { /* ignore */ }
  }
  const toggleCol = (key: ColKey) => {
    const next = visibleCols.includes(key)
      ? visibleCols.filter((c) => c !== key)
      : [...visibleCols, key]
    if (next.length === 0) return // luôn giữ tối thiểu 1 cột
    // Sắp xếp lại theo thứ tự chuẩn của ALL_COLS.
    persistCols(ALL_COLS.map((c) => c.key).filter((c) => next.includes(c)))
  }

  const fetchData = async () => {
    setLoading(true)
    const { data } = await supabase
      .from("purchase_invoices")
      .select("*, supplier:suppliers(name, code), purchase_invoice_lines(id)")
      .order("created_at", { ascending: false })
    const rows = ((data as unknown as Array<InvoiceRow & { purchase_invoice_lines?: { id: string }[] }>) || []).map((r) => ({
      ...r,
      _lineCount: r.purchase_invoice_lines?.length ?? 0,
    }))
    setInvoices(rows)
    setSelectedIds(new Set())
    setLoading(false)
  }
  useEffect(() => { fetchData() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return invoices.filter((inv) => {
      const matchSearch =
        !q ||
        (inv.invoice_number || "").toLowerCase().includes(q) ||
        (inv.supplier?.name || "").toLowerCase().includes(q) ||
        (inv.supplier?.code || "").toLowerCase().includes(q)
      const matchStatus = statusFilter === "all" || inv.status === statusFilter
      return matchSearch && matchStatus
    })
  }, [invoices, search, statusFilter])

  const statusCounts = useMemo(() => {
    const m: Record<string, number> = { all: invoices.length }
    for (const inv of invoices) m[inv.status] = (m[inv.status] || 0) + 1
    return m
  }, [invoices])

  const selectedRows = filtered.filter((r) => selectedIds.has(r.id))
  const selectedDraftIds = selectedRows.filter((r) => r.status === "draft").map((r) => r.id)
  const allSelected = filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id))
  const someSelected = selectedIds.size > 0 && !allSelected

  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(filtered.map((r) => r.id)))
  }
  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const handleBulkDelete = async () => {
    if (selectedDraftIds.length === 0) return
    setBulkBusy(true)
    try {
      const { error } = await supabase.from("purchase_invoices").delete().in("id", selectedDraftIds)
      if (error) throw error
      toast({ title: `Đã xoá ${selectedDraftIds.length} hoá đơn nháp` })
      setBulkDeleteOpen(false)
      await fetchData()
    } catch (e) {
      toast({ title: "Lỗi", description: (e as Error).message, variant: "destructive" })
    } finally {
      setBulkBusy(false)
    }
  }

  const handleBulkComplete = async () => {
    if (selectedDraftIds.length === 0) return
    setBulkBusy(true)
    let ok = 0, fail = 0
    for (const id of selectedDraftIds) {
      const { error } = await supabase.rpc("complete_purchase_invoice", { p_invoice_id: id })
      if (error) fail++; else ok++
    }
    setBulkBusy(false)
    toast({
      title: `Hoàn thành ${ok} hoá đơn` + (fail ? `, ${fail} lỗi` : ""),
      variant: fail ? "destructive" : undefined,
    })
    await fetchData()
  }

  if (authLoading) return <Skeleton className="h-96" />

  const renderCell = (inv: InvoiceRow, col: ColKey) => {
    switch (col) {
      case "invoice_number":
        return (
          <Link
            href={`/purchasing/invoices/${inv.id}`}
            className="font-mono text-sm text-primary font-bold hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {inv.invoice_number || "(chưa có)"}
          </Link>
        )
      case "supplier":
        return <span className="font-medium">{inv.supplier?.name || "—"}</span>
      case "invoice_date":
        return <span className="text-sm">{formatDate(inv.invoice_date)}</span>
      case "lines":
        return <span className="tabular-nums text-sm">{inv._lineCount ?? 0}</span>
      case "total":
        return <span className="text-right tabular-nums font-semibold block">{formatCurrency(inv.total)}</span>
      case "status":
        return <StatusBadge status={inv.status} type="purchase_invoice" />
      case "created_at":
        return <span className="text-xs text-muted-foreground">{formatDate(inv.created_at)}</span>
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Hoá đơn nhập hàng"
        description={`${invoices.length} hoá đơn`}
        backHref="/purchasing"
      >
        {canManage && (
          <Button onClick={() => router.push("/purchasing/invoices/new")}>
            <Plus className="h-4 w-4 mr-1.5" /> Tạo hoá đơn nhập
          </Button>
        )}
      </PageHeader>

      {/* Status chips */}
      <div className="flex flex-wrap gap-2">
        {STATUS_CHIPS.map((s) => {
          const count = statusCounts[s.value] || 0
          const active = statusFilter === s.value
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => setStatusFilter(s.value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                active ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground hover:bg-muted/60"
              }`}
            >
              {s.label}
              {count > 0 && (
                <span className={`ml-1.5 inline-flex items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${active ? "bg-white/20" : "bg-background/70"}`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Toolbar: search + column config */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Tìm số HĐ, NCC…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Columns3 className="h-4 w-4 mr-1.5" /> Cột hiển thị
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Chọn cột</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {ALL_COLS.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.key}
                checked={visibleCols.includes(c.key)}
                onCheckedChange={() => toggleCol(c.key)}
                onSelect={(e) => e.preventDefault()}
                disabled={visibleCols.length === 1 && visibleCols.includes(c.key)}
              >
                {c.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch("")}><X className="h-3.5 w-3.5" /></Button>
        )}
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-primary/5 px-3 py-2 text-sm">
          <span className="font-semibold">{selectedIds.size} đã chọn</span>
          <span className="text-muted-foreground">({selectedDraftIds.length} nháp)</span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" disabled={bulkBusy || selectedDraftIds.length === 0} onClick={handleBulkComplete}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Hoàn thành ({selectedDraftIds.length})
            </Button>
            <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10" disabled={bulkBusy || selectedDraftIds.length === 0} onClick={() => setBulkDeleteOpen(true)}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Xoá ({selectedDraftIds.length})
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Bỏ chọn</Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-8 w-8 text-muted-foreground" />}
          title="Chưa có hoá đơn nhập hàng"
          description="Bấm “Tạo hoá đơn nhập” để tạo hoá đơn từ nhà cung cấp."
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr className="text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2.5 w-10">
                    <Checkbox checked={allSelected ? true : someSelected ? "indeterminate" : false} onCheckedChange={toggleAll} aria-label="Chọn tất cả" />
                  </th>
                  {ALL_COLS.filter((c) => visibleCols.includes(c.key)).map((c) => (
                    <th key={c.key} className={`px-3 py-2.5 text-left ${c.key === "total" ? "text-right" : ""}`}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => (
                  <tr
                    key={inv.id}
                    className={`border-t cursor-pointer hover:bg-muted/40 ${selectedIds.has(inv.id) ? "bg-primary/5" : ""}`}
                    onClick={() => router.push(`/purchasing/invoices/${inv.id}`)}
                  >
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selectedIds.has(inv.id)} onCheckedChange={() => toggleOne(inv.id)} aria-label="Chọn" />
                    </td>
                    {ALL_COLS.filter((c) => visibleCols.includes(c.key)).map((c) => (
                      <td key={c.key} className={`px-3 py-2.5 ${c.key === "total" ? "text-right" : ""}`}>{renderCell(inv, c.key)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="lg:hidden space-y-3">
            <div className="flex items-center gap-2 px-1">
              <Checkbox checked={allSelected ? true : someSelected ? "indeterminate" : false} onCheckedChange={toggleAll} id="pinv-all-mobile" />
              <label htmlFor="pinv-all-mobile" className="text-xs font-medium text-muted-foreground">Chọn tất cả ({filtered.length})</label>
            </div>
            {filtered.map((inv) => (
              <div
                key={inv.id}
                className={`relative rounded-2xl border bg-card shadow-ambient overflow-hidden ${selectedIds.has(inv.id) ? "border-primary bg-primary/5" : ""}`}
              >
                <div className="p-4">
                  <div className="flex items-start gap-2">
                    <div onClick={(e) => e.stopPropagation()} className="pt-0.5 shrink-0">
                      <Checkbox checked={selectedIds.has(inv.id)} onCheckedChange={() => toggleOne(inv.id)} aria-label="Chọn" />
                    </div>
                    <div
                      className="min-w-0 flex-1 cursor-pointer active:scale-[0.99] transition-transform"
                      onClick={() => router.push(`/purchasing/invoices/${inv.id}`)}
                    >
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-xs font-bold text-primary">{inv.invoice_number || "(chưa có số)"}</p>
                        <span className="text-xs text-muted-foreground">• {formatDate(inv.invoice_date)}</span>
                      </div>
                      <h3 className="font-extrabold text-base leading-tight truncate mt-0.5">{inv.supplier?.name || "—"}</h3>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <StatusBadge status={inv.status} type="purchase_invoice" />
                        <span className="text-[11px] text-muted-foreground">{inv._lineCount ?? 0} dòng</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 pt-2 mt-2 border-t">
                        <span className="text-xs text-muted-foreground">Tổng tiền</span>
                        <span className="font-bold text-base">{formatCurrency(inv.total)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`Xoá ${selectedDraftIds.length} hoá đơn nháp?`}
        description="Chỉ các hoá đơn ở trạng thái Nháp mới bị xoá. Hoá đơn đã hoàn thành sẽ được bỏ qua."
        variant="destructive"
        confirmLabel={bulkBusy ? "Đang xoá…" : "Xoá"}
        onConfirm={handleBulkDelete}
        loading={bulkBusy}
      />
    </div>
  )
}
