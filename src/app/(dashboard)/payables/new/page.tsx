"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import Link from "next/link"
import type { Supplier, StockEntry } from "@/types"

export default function NewPayablePage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("receivables")
  const [loading, setLoading] = useState(false)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [stockEntries, setStockEntries] = useState<StockEntry[]>([])
  const [form, setForm] = useState({
    supplier_id: "",
    stock_entry_id: "",
    invoice_number: "",
    amount: "",
    due_date: "",
    notes: "",
  })
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    async function fetchSuppliers() {
      const { data } = await supabase
        .from("suppliers")
        .select("*")
        .eq("is_active", true)
        .order("name")
      setSuppliers((data as Supplier[]) || [])
    }
    fetchSuppliers()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch stock entries when supplier changes
  useEffect(() => {
    async function fetchEntries() {
      if (!form.supplier_id) {
        setStockEntries([])
        return
      }
      const { data } = await supabase
        .from("stock_entries")
        .select("*")
        .eq("supplier_id", form.supplier_id)
        .eq("type", "import")
        .order("created_at", { ascending: false })
      setStockEntries((data as StockEntry[]) || [])

      // Auto-calc due_date from supplier payment_terms
      const supplier = suppliers.find((s) => s.id === form.supplier_id)
      if (supplier?.payment_terms) {
        const match = supplier.payment_terms.match(/NET(\d+)/)
        if (match) {
          const days = parseInt(match[1])
          const due = new Date()
          due.setDate(due.getDate() + days)
          setForm((prev) => ({
            ...prev,
            due_date: prev.due_date || due.toISOString().split("T")[0],
          }))
        }
      }
    }
    fetchEntries()
  }, [form.supplier_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    setLoading(true)

    try {
      const payload = {
        org_id: user.org_id,
        supplier_id: form.supplier_id,
        stock_entry_id: form.stock_entry_id || null,
        invoice_number: form.invoice_number.trim() || null,
        amount: parseFloat(form.amount),
        paid: 0,
        due_date: form.due_date || null,
        status: "open",
        notes: form.notes.trim() || null,
      }

      if (!payload.amount || payload.amount <= 0) {
        toast({ title: "Số tiền không hợp lệ", variant: "destructive" })
        setLoading(false)
        return
      }

      const { error } = await supabase.from("payables").insert(payload)
      if (error) throw error

      toast({ title: "Đã tạo công nợ NCC mới" })
      router.push("/payables")
      router.refresh()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Có lỗi xảy ra"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Tạo công nợ nhà cung cấp" backHref="/payables" />

      <Card>
        <CardHeader>
          <CardTitle>Thông tin công nợ</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Nhà cung cấp *</Label>
                <Select
                  value={form.supplier_id}
                  onValueChange={(v) => setForm({ ...form, supplier_id: v, stock_entry_id: "" })}
                >
                  <SelectTrigger><SelectValue placeholder="Chọn NCC" /></SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.code} - {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Link href="/suppliers/new" className="text-xs text-primary hover:underline">
                  + Tạo NCC mới
                </Link>
              </div>

              <div className="space-y-2">
                <Label>Phiếu nhập kho (tùy chọn)</Label>
                <Select
                  value={form.stock_entry_id}
                  onValueChange={(v) => setForm({ ...form, stock_entry_id: v })}
                  disabled={!form.supplier_id}
                >
                  <SelectTrigger><SelectValue placeholder="Chọn phiếu nhập" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Không liên kết</SelectItem>
                    {stockEntries.map((se) => (
                      <SelectItem key={se.id} value={se.id}>
                        {se.entry_code} ({new Date(se.created_at).toLocaleDateString("vi-VN")})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Mã hóa đơn</Label>
                <Input
                  value={form.invoice_number}
                  onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
                  placeholder="VD: HD-2024-001"
                />
              </div>

              <div className="space-y-2">
                <Label>Số tiền *</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  required
                  placeholder="Nhập số tiền"
                />
              </div>

              <div className="space-y-2">
                <Label>Hạn thanh toán</Label>
                <Input
                  type="date"
                  value={form.due_date}
                  onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                />
                {form.supplier_id && suppliers.find((s) => s.id === form.supplier_id)?.payment_terms && (
                  <p className="text-xs text-muted-foreground">
                    Điều khoản NCC: {suppliers.find((s) => s.id === form.supplier_id)?.payment_terms}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Ghi chú</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Ghi chú thêm..."
                rows={3}
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Hủy
              </Button>
              <Button
                type="submit"
                disabled={loading || !form.supplier_id || !form.amount}
                className="bg-primary text-on-primary shadow-card"
              >
                {loading ? "Đang lưu..." : "Tạo công nợ"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
