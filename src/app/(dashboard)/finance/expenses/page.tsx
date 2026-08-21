"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Plus, Search, Trash2, Wallet, Receipt, Info } from "lucide-react"
import type { Expense, ExpenseCategory, ExpenseBucket } from "@/types"

const BUCKET_LABEL: Record<ExpenseBucket, { label: string; color: string }> = {
  cogs: { label: "Giá vốn", color: "text-error bg-error-container" },
  operating: { label: "Vận hành", color: "text-[#175cd3] bg-[#eff8ff]" },
  hr: { label: "Nhân sự", color: "text-[#6941c6] bg-[#f4f3ff]" },
  financial: { label: "Tài chính", color: "text-[#b54708] bg-[#fff4ed]" },
  tax: { label: "Thuế", color: "text-on-surface-variant bg-surface-container" },
  other: { label: "Khác", color: "text-muted-foreground bg-muted" },
}

export default function ExpensesPage() {
  const { loading: authLoading } = useRoleGuard("settings")
  const { user } = useAuth()
  const supabase = createClient()
  const { toast } = useToast()

  const today = new Date()
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)

  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [dateFrom, setDateFrom] = useState(monthStart)
  const [dateTo, setDateTo] = useState(today.toISOString().slice(0, 10))
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  // Form state
  const [formDate, setFormDate] = useState(today.toISOString().slice(0, 10))
  const [formCategoryId, setFormCategoryId] = useState("")
  const [formAmount, setFormAmount] = useState("")
  const [formDescription, setFormDescription] = useState("")
  const [formReference, setFormReference] = useState("")
  const [formIsPaid, setFormIsPaid] = useState(true)
  const [formPaymentMethod, setFormPaymentMethod] = useState<string>("cash")

  const fetch = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const [expensesRes, categoriesRes] = await Promise.all([
      // Cộng tổng chi phí trong kỳ → phải lấy đủ.
      fetchAllForAggregate((from, to) =>
        supabase
          .from("expenses")
          .select(
            "id, category_id, expense_date, amount, description, reference_code, source_type, is_paid, payment_method, category:expense_categories(*)",
            { count: "exact" }
          )
          .eq("org_id", user.org_id)
          .gte("expense_date", dateFrom)
          .lte("expense_date", dateTo)
          .order("expense_date", { ascending: false })
          .order("created_at", { ascending: false })
          .range(from, to)
      ),
      supabase
        .from("expense_categories")
        .select("id, name, bucket")
        .eq("org_id", user.org_id)
        .eq("is_active", true)
        .order("bucket")
        .order("code"),
    ])
    if (expensesRes.error) console.error("[finance/expenses] truy vấn lỗi:", expensesRes.error)
    const qErr = ([categoriesRes] as Array<{ error?: { message?: string } | null }>)
      .find((r) => r?.error)?.error
    if (qErr) console.error("[finance/expenses] truy vấn lỗi:", qErr.message)
    setExpenses(expensesRes.rows as unknown as Expense[])
    setCategories((categoriesRes.data as ExpenseCategory[]) || [])
    setLoading(false)
  }, [user?.org_id, dateFrom, dateTo]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetch() }, [fetch])

  const filtered = useMemo(() => {
    return expenses.filter((e) => {
      if (categoryFilter !== "all" && e.category_id !== categoryFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (
          !e.description?.toLowerCase().includes(q) &&
          !e.reference_code?.toLowerCase().includes(q) &&
          !e.category?.name.toLowerCase().includes(q)
        ) {
          return false
        }
      }
      return true
    })
  }, [expenses, categoryFilter, search])

  const totals = useMemo(() => {
    const byBucket: Record<string, number> = {}
    let total = 0
    let paid = 0
    let unpaid = 0
    for (const e of filtered) {
      const bucket = e.category?.bucket || "other"
      byBucket[bucket] = (byBucket[bucket] || 0) + Number(e.amount)
      total += Number(e.amount)
      if (e.is_paid) paid += Number(e.amount)
      else unpaid += Number(e.amount)
    }
    return { byBucket, total, paid, unpaid }
  }, [filtered])

  const resetForm = () => {
    setFormDate(today.toISOString().slice(0, 10))
    setFormCategoryId(categories[0]?.id || "")
    setFormAmount("")
    setFormDescription("")
    setFormReference("")
    setFormIsPaid(true)
    setFormPaymentMethod("cash")
  }

  const openAdd = () => {
    resetForm()
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!user?.org_id || !user.id) return
    if (!formAmount || !formDate) {
      toast({ title: "Vui lòng nhập số tiền và ngày", variant: "destructive" })
      return
    }
    const amount = parseFloat(formAmount.replace(/[^\d.]/g, ""))
    if (isNaN(amount) || amount <= 0) {
      toast({ title: "Số tiền không hợp lệ", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.from("expenses").insert({
        org_id: user.org_id,
        category_id: formCategoryId || null,
        expense_date: formDate,
        amount,
        description: formDescription || null,
        reference_code: formReference || null,
        is_paid: formIsPaid,
        paid_at: formIsPaid ? new Date().toISOString() : null,
        payment_method: formIsPaid ? formPaymentMethod : null,
        created_by: user.id,
      })
      if (error) throw error
      toast({ title: "Đã thêm chi phí" })
      setDialogOpen(false)
      fetch()
    } catch (err) {
      const message = err instanceof Error ? err.message : "Lỗi khi lưu"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Xóa chi phí này?")) return
    setDeleting(id)
    try {
      const { error } = await supabase.from("expenses").delete().eq("id", id)
      if (error) throw error
      toast({ title: "Đã xóa" })
      setExpenses((prev) => prev.filter((e) => e.id !== id))
    } catch (err) {
      const message = err instanceof Error ? err.message : "Lỗi"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setDeleting(null)
    }
  }

  const canEdit = user && ["owner", "manager", "accountant"].includes(user.role)

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Chi phí" description={`${formatDate(dateFrom)} → ${formatDate(dateTo)}`}>
        {canEdit && (
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4 mr-1.5" /> Thêm chi phí
          </Button>
        )}
      </PageHeader>

      {/* Period filter */}
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Từ ngày</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Đến ngày</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Danh mục</Label>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Wallet className="h-3.5 w-3.5" /> Tổng chi phí
            </div>
            <p className="text-xl font-black mt-1">{formatCurrency(totals.total)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-xs text-tertiary">
              <Receipt className="h-3.5 w-3.5" /> Đã trả
            </div>
            <p className="text-xl font-black mt-1 text-tertiary">{formatCurrency(totals.paid)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-xs text-[#b54708]">
              <Receipt className="h-3.5 w-3.5" /> Chưa trả
            </div>
            <p className="text-xl font-black mt-1 text-[#b54708]">{formatCurrency(totals.unpaid)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Phân loại
            </p>
            <div className="space-y-0.5">
              {(Object.entries(totals.byBucket) as Array<[ExpenseBucket, number]>)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 3)
                .map(([bucket, amount]) => (
                  <div key={bucket} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{BUCKET_LABEL[bucket]?.label || bucket}</span>
                    <span className="font-semibold">{formatCurrency(amount)}</span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Tìm mô tả, mã tham chiếu..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* List */}
      {loading ? (
        <Skeleton className="h-64" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Wallet className="h-8 w-8 text-muted-foreground" />}
          title={expenses.length === 0 ? "Chưa có chi phí" : "Không có chi phí khớp bộ lọc"}
          description={expenses.length === 0 ? "Thêm chi phí đầu tiên" : "Thử đổi khoảng thời gian hoặc danh mục"}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((e) => {
            const bucket = e.category?.bucket || "other"
            const meta = BUCKET_LABEL[bucket]
            return (
              <Card key={e.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-[10px] font-bold uppercase rounded px-1.5 py-0.5 ${meta.color}`}>
                          {meta.label}
                        </span>
                        {e.category && (
                          <span className="text-xs font-semibold">{e.category.name}</span>
                        )}
                        {e.is_paid ? (
                          <Badge variant="success">Đã trả</Badge>
                        ) : (
                          <Badge variant="warning">Chưa trả</Badge>
                        )}
                        {e.source_type && (
                          <span className="text-[10px] text-muted-foreground italic flex items-center gap-0.5">
                            <Info className="h-2.5 w-2.5" /> auto: {e.source_type}
                          </span>
                        )}
                      </div>
                      {e.description && (
                        <p className="text-sm mt-1">{e.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDate(e.expense_date)}
                        {e.reference_code && ` • Ref: ${e.reference_code}`}
                        {e.payment_method && ` • ${e.payment_method}`}
                      </p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-2">
                      <p className="text-lg font-black">{formatCurrency(e.amount)}</p>
                      {canEdit && e.source_type === null && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => handleDelete(e.id)}
                          disabled={deleting === e.id}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Add dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Thêm chi phí</DialogTitle>
            <DialogDescription>Ghi nhận một khoản chi phí phát sinh</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Danh mục *</Label>
              <Select value={formCategoryId} onValueChange={setFormCategoryId}>
                <SelectTrigger><SelectValue placeholder="Chọn danh mục" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} <span className="text-muted-foreground">• {BUCKET_LABEL[c.bucket].label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Ngày *</Label>
                <Input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Số tiền *</Label>
                <Input
                  type="number"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Mô tả</Label>
              <Textarea
                rows={2}
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Chi tiết khoản chi..."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Mã tham chiếu</Label>
              <Input
                value={formReference}
                onChange={(e) => setFormReference(e.target.value)}
                placeholder="Số hóa đơn, mã chứng từ..."
              />
            </div>
            <div className="rounded-xl border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label>Đã thanh toán</Label>
                <input
                  type="checkbox"
                  checked={formIsPaid}
                  onChange={(e) => setFormIsPaid(e.target.checked)}
                  className="h-4 w-4"
                />
              </div>
              {formIsPaid && (
                <div className="space-y-1.5">
                  <Label>Hình thức</Label>
                  <Select value={formPaymentMethod} onValueChange={setFormPaymentMethod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Tiền mặt</SelectItem>
                      <SelectItem value="transfer">Chuyển khoản</SelectItem>
                      <SelectItem value="ewallet">Ví điện tử</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Hủy
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Đang lưu..." : "Lưu"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
