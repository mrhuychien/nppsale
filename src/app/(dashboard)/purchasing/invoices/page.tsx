"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Search, FileText, Plus, Columns3, X, Pencil } from "lucide-react"

type ColKey = "entry_code" | "supplier" | "invoice_number" | "date" | "total" | "paid" | "remaining" | "debt_status"
const ALL_COLS: { key: ColKey; label: string }[] = [
  { key: "entry_code", label: "Mã phiếu nhập" },
  { key: "supplier", label: "Nhà cung cấp" },
  { key: "invoice_number", label: "Số HĐ" },
  { key: "date", label: "Ngày nhập" },
  { key: "total", label: "Tổng tiền" },
  { key: "paid", label: "Đã trả" },
  { key: "remaining", label: "Còn nợ" },
  { key: "debt_status", label: "Trạng thái nợ" },
]
const DEFAULT_COLS: ColKey[] = ["entry_code", "supplier", "date", "total", "remaining", "debt_status"]
const COLS_STORAGE_KEY = "pinv-lookup-cols"

interface ImportRow {
  id: string
  entry_code: string
  posted_at: string | null
  created_at: string
  supplier?: { name: string; code: string | null } | null
  payable?: { id: string; amount: number; paid: number; status: string; invoice_number: string | null } | null
}

const DEBT_FILTERS = [
  { value: "all", label: "Tất cả" },
  { value: "open", label: "Còn nợ" },
  { value: "paid", label: "Đã trả đủ" },
  { value: "no_supplier", label: "Không gắn NCC" },
]

const DEBT_LABEL: Record<string, { label: string; variant: "secondary" | "success" | "warning" | "danger" }> = {
  open: { label: "Còn nợ", variant: "warning" },
  partial: { label: "Trả 1 phần", variant: "warning" },
  overdue: { label: "Quá hạn", variant: "danger" },
  paid: { label: "Đã trả đủ", variant: "success" },
}

export default function PurchaseInvoicesLookupPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const { user } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [rows, setRows] = useState<ImportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [debtFilter, setDebtFilter] = useState(() => searchParams.get("debt") || "all")
  const [visibleCols, setVisibleCols] = useState<ColKey[]>(DEFAULT_COLS)

  const canCreate = !!user && hasPermission(user.role, "inventory", "update")

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
    const next = visibleCols.includes(key) ? visibleCols.filter((c) => c !== key) : [...visibleCols, key]
    if (next.length === 0) return
    persistCols(ALL_COLS.map((c) => c.key).filter((c) => next.includes(c)))
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      // Phiếu nhập kho (import) + NCC + công nợ liên kết.
      const [entriesRes, payRes] = await Promise.all([
        supabase
          .from("stock_entries")
          .select("id, entry_code, posted_at, created_at, supplier:suppliers(name, code)")
          .eq("type", "import")
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("payables")
          .select("id, stock_entry_id, amount, paid, status, invoice_number")
          .not("stock_entry_id", "is", null),
      ])
      if (cancelled) return
      const payByEntry = new Map<string, ImportRow["payable"]>()
      for (const p of (payRes.data as Array<{ id: string; stock_entry_id: string; amount: number; paid: number; status: string; invoice_number: string | null }>) || []) {
        payByEntry.set(p.stock_entry_id, { id: p.id, amount: p.amount, paid: p.paid, status: p.status, invoice_number: p.invoice_number })
      }
      const list = ((entriesRes.data as unknown as Array<Omit<ImportRow, "payable">>) || []).map((e) => ({
        ...e,
        payable: payByEntry.get(e.id) || null,
      }))
      setRows(list)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      const matchSearch =
        !q ||
        r.entry_code.toLowerCase().includes(q) ||
        (r.supplier?.name || "").toLowerCase().includes(q) ||
        (r.supplier?.code || "").toLowerCase().includes(q) ||
        (r.payable?.invoice_number || "").toLowerCase().includes(q)
      let matchDebt = true
      if (debtFilter === "open") matchDebt = !!r.payable && r.payable.status !== "paid"
      else if (debtFilter === "paid") matchDebt = !!r.payable && r.payable.status === "paid"
      else if (debtFilter === "no_supplier") matchDebt = !r.supplier
      return matchSearch && matchDebt
    })
  }, [rows, search, debtFilter])

  if (authLoading) return <Skeleton className="h-96" />

  const renderCell = (r: ImportRow, col: ColKey) => {
    const amount = r.payable?.amount ?? 0
    const paid = r.payable?.paid ?? 0
    const remaining = Math.max(0, amount - paid)
    switch (col) {
      case "entry_code":
        return (
          <Link
            href={`/inventory/entries/${r.id}`}
            className="font-mono text-sm text-primary font-bold hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {r.entry_code}
          </Link>
        )
      case "supplier":
        return <span className="font-medium">{r.supplier?.name || <span className="text-muted-foreground italic">—</span>}</span>
      case "invoice_number":
        return <span className="text-sm">{r.payable?.invoice_number || "—"}</span>
      case "date":
        return <span className="text-sm">{formatDate(r.posted_at || r.created_at)}</span>
      case "total":
        return <span className="block text-right tabular-nums">{r.payable ? formatCurrency(amount) : "—"}</span>
      case "paid":
        return <span className="block text-right tabular-nums">{r.payable ? formatCurrency(paid) : "—"}</span>
      case "remaining":
        return <span className={`block text-right tabular-nums font-semibold ${remaining > 0 ? "text-rose-700" : ""}`}>{r.payable ? formatCurrency(remaining) : "—"}</span>
      case "debt_status":
        if (!r.payable) return <Badge variant="secondary">Không gắn NCC</Badge>
        { const m = DEBT_LABEL[r.payable.status] || { label: r.payable.status, variant: "secondary" as const }
          return <Badge variant={m.variant}>{m.label}</Badge> }
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Hoá đơn mua hàng (tra cứu)"
        description="Danh sách phiếu nhập kho từ nhà cung cấp. Bấm Sửa để chỉnh phiếu nhập."
        backHref="/purchasing"
      >
        {canCreate && (
          <Button asChild>
            <Link href="/inventory/stock-in"><Plus className="h-4 w-4 mr-1.5" /> Tạo phiếu nhập kho</Link>
          </Button>
        )}
      </PageHeader>

      <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-primary">
        Trang này chỉ để tra cứu. Việc tạo / sửa hàng nhập + công nợ NCC thực hiện ở phiếu nhập kho
        (Kho → Tạo phiếu nhập kho). Bấm vào dòng để mở phiếu nhập tương ứng.
      </div>

      {/* Debt chips */}
      <div className="flex flex-wrap gap-2">
        {DEBT_FILTERS.map((f) => {
          const active = debtFilter === f.value
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setDebtFilter(f.value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                active ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground hover:bg-muted/60"
              }`}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Tìm mã phiếu, NCC, số HĐ…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline"><Columns3 className="h-4 w-4 mr-1.5" /> Cột hiển thị</Button>
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
        {search && <Button variant="ghost" size="sm" onClick={() => setSearch("")}><X className="h-3.5 w-3.5" /></Button>}
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-8 w-8 text-muted-foreground" />}
          title="Chưa có phiếu nhập kho nào"
          description="Vào Kho → Tạo phiếu nhập kho để nhập hàng từ nhà cung cấp."
        />
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden lg:block overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr className="text-xs uppercase text-muted-foreground">
                  {ALL_COLS.filter((c) => visibleCols.includes(c.key)).map((c) => (
                    <th key={c.key} className={`px-3 py-2.5 text-left ${["total", "paid", "remaining"].includes(c.key) ? "text-right" : ""}`}>{c.label}</th>
                  ))}
                  <th className="px-3 py-2.5 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t cursor-pointer hover:bg-muted/40" onClick={() => router.push(`/inventory/entries/${r.id}`)}>
                    {ALL_COLS.filter((c) => visibleCols.includes(c.key)).map((c) => (
                      <td key={c.key} className={`px-3 py-2.5 ${["total", "paid", "remaining"].includes(c.key) ? "text-right" : ""}`}>{renderCell(r, c.key)}</td>
                    ))}
                    <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="ghost" asChild>
                        <Link href={`/inventory/entries/${r.id}`}><Pencil className="h-3.5 w-3.5 mr-1" /> Sửa</Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="lg:hidden space-y-3">
            {filtered.map((r) => {
              const amount = r.payable?.amount ?? 0
              const remaining = Math.max(0, amount - (r.payable?.paid ?? 0))
              const m = r.payable ? (DEBT_LABEL[r.payable.status] || { label: r.payable.status, variant: "secondary" as const }) : null
              return (
                <div
                  key={r.id}
                  className="rounded-2xl border bg-card shadow-ambient overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
                  onClick={() => router.push(`/inventory/entries/${r.id}`)}
                >
                  <div className="p-4">
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-xs font-bold text-primary">{r.entry_code}</p>
                      <span className="text-xs text-muted-foreground">• {formatDate(r.posted_at || r.created_at)}</span>
                    </div>
                    <h3 className="font-extrabold text-base leading-tight truncate mt-0.5">{r.supplier?.name || "— Không gắn NCC —"}</h3>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      {m ? <Badge variant={m.variant}>{m.label}</Badge> : <Badge variant="secondary">Không gắn NCC</Badge>}
                      {r.payable?.invoice_number && <span className="text-[11px] text-muted-foreground font-mono">HĐ: {r.payable.invoice_number}</span>}
                    </div>
                    {r.payable && (
                      <div className="flex items-center justify-between gap-2 pt-2 mt-2 border-t text-sm">
                        <span className="text-muted-foreground">Còn nợ</span>
                        <span className={`font-bold ${remaining > 0 ? "text-rose-700" : ""}`}>{formatCurrency(remaining)} <span className="text-[11px] text-muted-foreground font-normal">/ {formatCurrency(amount)}</span></span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
