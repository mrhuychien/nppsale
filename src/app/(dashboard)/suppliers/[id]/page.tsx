"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { PAYMENT_TERMS } from "@/lib/constants"
import {
  Trash2, CheckCircle2, Mail, Star, Tag, MessageSquare,
  FileDown, CreditCard, Package, History, Scale, Building2,
  Phone, MapPin, Pencil,
} from "lucide-react"
import type { Supplier, StockEntry } from "@/types"

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("inventory")
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [stockEntries, setStockEntries] = useState<StockEntry[]>([])
  const [stockEntryCount, setStockEntryCount] = useState(0)
  const [unpaidCount, setUnpaidCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [form, setForm] = useState<Record<string, string | boolean>>({})
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [supplierRes, entriesRes, countRes] = await Promise.all([
      supabase.from("suppliers").select("*").eq("id", id).single(),
      supabase
        .from("stock_entries")
        .select("*")
        .eq("supplier_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("stock_entries")
        .select("*", { count: "exact", head: true })
        .eq("supplier_id", id),
    ])

    if (supplierRes.data) {
      const s = supplierRes.data as Supplier
      setSupplier(s)
      setForm({
        name: s.name || "",
        code: s.code || "",
        category: s.category || "",
        contact_name: s.contact_name || "",
        phone: s.phone || "",
        email: s.email || "",
        address: s.address || "",
        tax_code: s.tax_code || "",
        bank_account: s.bank_account || "",
        bank_name: s.bank_name || "",
        payment_terms: s.payment_terms || "NET30",
        notes: s.notes || "",
        is_verified: s.is_verified,
        is_active: s.is_active,
        rating: String(s.rating || 0),
      })
    }

    const entries = (entriesRes.data as StockEntry[]) || []
    setStockEntries(entries)
    setStockEntryCount(countRes.count || 0)
    // Placeholder: count "unpaid" as all entries (no payment status on stock_entries yet)
    setUnpaidCount(0)
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleSave = async () => {
    if (!supplier) return
    setSaving(true)
    try {
      const payload = {
        name: (form.name as string).trim(),
        code: (form.code as string).trim(),
        category: (form.category as string).trim() || null,
        contact_name: (form.contact_name as string).trim() || null,
        phone: (form.phone as string).trim() || null,
        email: (form.email as string).trim() || null,
        address: (form.address as string).trim() || null,
        tax_code: (form.tax_code as string).trim() || null,
        bank_account: (form.bank_account as string).trim() || null,
        bank_name: (form.bank_name as string).trim() || null,
        payment_terms: form.payment_terms as string,
        notes: (form.notes as string).trim() || null,
        is_verified: form.is_verified as boolean,
        is_active: form.is_active as boolean,
        rating: Number(form.rating) || 0,
      }
      const { error } = await supabase.from("suppliers").update(payload).eq("id", supplier.id)
      if (error) throw error
      toast({ title: "Đã cập nhật nhà cung cấp" })
      setEditing(false)
      fetchData()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Có lỗi xảy ra"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!supplier) return
    setDeleting(true)
    try {
      const { error } = await supabase.from("suppliers").delete().eq("id", supplier.id)
      if (error) throw error
      toast({ title: "Đã xóa nhà cung cấp" })
      router.push("/suppliers")
    } catch (err) {
      toast({
        title: "Lỗi",
        description: (err as Error).message,
        variant: "destructive",
      })
      setDeleting(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!supplier) return <div className="p-8 text-center text-muted-foreground">Không tìm thấy nhà cung cấp</div>

  const canEdit = user && (hasPermission(user.role, "inventory", "update"))
  const canDelete = user && hasPermission(user.role, "inventory", "delete")
  const initial = supplier.name.charAt(0).toUpperCase()

  return (
    <div className="space-y-6">
      <PageHeader title="" backHref="/suppliers" />

      {/* Overview header card */}
      <div className="rounded-2xl bg-surface-low shadow-ambient overflow-hidden">
        <div className="bg-gradient-primary h-24 relative" />
        <div className="px-6 pb-6 -mt-12">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            {/* Avatar initial */}
            <div className="w-20 h-20 rounded-2xl bg-card shadow-ambient flex items-center justify-center text-3xl font-black text-primary border-4 border-white shrink-0">
              {initial}
            </div>
            <div className="flex-1 min-w-0 pt-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-3xl font-black tracking-tight text-foreground">{supplier.name}</h1>
                {supplier.is_verified && (
                  <Badge variant="success" className="gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Đã xác minh
                  </Badge>
                )}
              </div>
              {supplier.notes && (
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{supplier.notes}</p>
              )}
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                {supplier.category && (
                  <Badge variant="outline" className="gap-1">
                    <Tag className="h-3 w-3" />
                    {supplier.category}
                  </Badge>
                )}
                {supplier.rating > 0 && (
                  <Badge variant="warning" className="gap-1">
                    <Star className="h-3 w-3" />
                    {supplier.rating}
                  </Badge>
                )}
                {supplier.email && (
                  <Badge variant="secondary" className="gap-1">
                    <Mail className="h-3 w-3" />
                    {supplier.email}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" className="gap-1.5">
                <MessageSquare className="h-4 w-4" />
                Nhắn tin
              </Button>
              <Button
                size="sm"
                className="bg-gradient-primary text-white shadow-ambient gap-1.5"
                onClick={() => router.push("/inventory/stock-in")}
              >
                <FileDown className="h-4 w-4" />
                Tạo phiếu nhập
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-red-100 p-3">
                <CreditCard className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Công nợ NCC</p>
                <p className="text-2xl font-black tracking-tight">{unpaidCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-blue-100 p-3">
                <FileDown className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Số phiếu nhập</p>
                <p className="text-2xl font-black tracking-tight">{stockEntryCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-green-100 p-3">
                <Package className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Sản phẩm</p>
                <p className="text-2xl font-black tracking-tight">0</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="price_list">
        <TabsList>
          <TabsTrigger value="price_list">Bảng giá</TabsTrigger>
          <TabsTrigger value="debt">Công nợ</TabsTrigger>
          <TabsTrigger value="history">Lịch sử giao dịch</TabsTrigger>
          <TabsTrigger value="legal">Thông tin pháp lý</TabsTrigger>
        </TabsList>

        {/* Tab: Bảng giá */}
        <TabsContent value="price_list">
          <Card>
            <CardHeader>
              <CardTitle>Bảng giá sản phẩm</CardTitle>
            </CardHeader>
            <CardContent>
              {stockEntries.length === 0 ? (
                <EmptyState
                  icon={<Package className="h-8 w-8 text-muted-foreground" />}
                  title="Chưa có sản phẩm"
                  description="Các sản phẩm sẽ hiển thị khi có phiếu nhập từ nhà cung cấp này"
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Dữ liệu bảng giá sẽ được tổng hợp từ {stockEntryCount} phiếu nhập kho.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: Công nợ */}
        <TabsContent value="debt">
          <Card>
            <CardHeader>
              <CardTitle>Công nợ nhà cung cấp</CardTitle>
            </CardHeader>
            <CardContent>
              {stockEntries.length === 0 ? (
                <EmptyState
                  icon={<CreditCard className="h-8 w-8 text-muted-foreground" />}
                  title="Không có công nợ"
                  description="Chưa có phiếu nhập nào từ nhà cung cấp này"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mã phiếu</TableHead>
                      <TableHead>Loại</TableHead>
                      <TableHead>Ngày tạo</TableHead>
                      <TableHead>Ghi chú</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stockEntries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="font-mono text-xs font-bold text-primary">
                          {entry.entry_code}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{entry.type}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(entry.created_at).toLocaleDateString("vi-VN")}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {entry.notes || "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: Lịch sử giao dịch */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Lịch sử giao dịch</CardTitle>
            </CardHeader>
            <CardContent>
              {stockEntries.length === 0 ? (
                <EmptyState
                  icon={<History className="h-8 w-8 text-muted-foreground" />}
                  title="Chưa có giao dịch"
                  description="Lịch sử giao dịch sẽ hiển thị khi có phiếu nhập từ NCC này"
                />
              ) : (
                <div className="space-y-3">
                  {stockEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-start gap-3 rounded-xl border p-4 hover:bg-surface-low/50 transition-colors"
                    >
                      <div className="rounded-lg bg-primary/10 p-2 shrink-0">
                        <FileDown className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">
                          Phiếu {entry.entry_code}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {entry.type === "import" ? "Nhập kho" : entry.type} &middot;{" "}
                          {new Date(entry.created_at).toLocaleString("vi-VN")}
                        </p>
                        {entry.notes && (
                          <p className="text-xs text-muted-foreground mt-1">{entry.notes}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: Thông tin pháp lý */}
        <TabsContent value="legal">
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Legal & bank info - read or edit mode */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Scale className="h-5 w-5" />
                  Thông tin pháp lý
                </CardTitle>
                {canEdit && !editing && (
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="gap-1.5">
                    <Pencil className="h-3.5 w-3.5" /> Sửa
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {editing ? (
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Tên nhà cung cấp *</Label>
                        <Input value={form.name as string} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                      </div>
                      <div className="space-y-2">
                        <Label>Mã NCC</Label>
                        <Input value={form.code as string} onChange={(e) => setForm({ ...form, code: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Danh mục</Label>
                        <Input value={form.category as string} onChange={(e) => setForm({ ...form, category: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Điều khoản thanh toán</Label>
                        <Select value={form.payment_terms as string} onValueChange={(v) => setForm({ ...form, payment_terms: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PAYMENT_TERMS.map((pt) => (
                              <SelectItem key={pt.value} value={pt.value}>{pt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Người liên hệ</Label>
                        <Input value={form.contact_name as string} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>SĐT</Label>
                        <Input value={form.phone as string} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Email</Label>
                        <Input value={form.email as string} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Đánh giá (0-5)</Label>
                        <Input type="number" min="0" max="5" step="0.1" value={form.rating as string} onChange={(e) => setForm({ ...form, rating: e.target.value })} />
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label>Địa chỉ</Label>
                        <Textarea value={form.address as string} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Mã số thuế</Label>
                      <Input value={form.tax_code as string} onChange={(e) => setForm({ ...form, tax_code: e.target.value })} />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Số tài khoản</Label>
                        <Input value={form.bank_account as string} onChange={(e) => setForm({ ...form, bank_account: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Ngân hàng</Label>
                        <Input value={form.bank_name as string} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Ghi chú</Label>
                      <Textarea value={form.notes as string} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
                    </div>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
                      <div className="flex items-center gap-3">
                        <Checkbox
                          id="edit_verified"
                          checked={form.is_verified as boolean}
                          onCheckedChange={(checked) => setForm({ ...form, is_verified: checked === true })}
                        />
                        <Label htmlFor="edit_verified" className="cursor-pointer">Đã xác minh</Label>
                      </div>
                      <div className="flex items-center gap-3">
                        <Switch
                          id="edit_active"
                          checked={form.is_active as boolean}
                          onCheckedChange={(checked) => setForm({ ...form, is_active: checked })}
                        />
                        <Label htmlFor="edit_active" className="cursor-pointer">Hoạt động</Label>
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>Hủy</Button>
                      <Button onClick={handleSave} disabled={saving} className="bg-gradient-primary text-white shadow-ambient">
                        {saving ? "Đang lưu..." : "Lưu thay đổi"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <InfoRow icon={<Scale className="h-4 w-4" />} label="Mã số thuế" value={supplier.tax_code} />
                    <InfoRow icon={<Building2 className="h-4 w-4" />} label="Ngân hàng" value={supplier.bank_name} />
                    <InfoRow icon={<CreditCard className="h-4 w-4" />} label="Số tài khoản" value={supplier.bank_account} />
                    <InfoRow icon={<MapPin className="h-4 w-4" />} label="Địa chỉ" value={supplier.address} />
                    <InfoRow icon={<Phone className="h-4 w-4" />} label="SĐT" value={supplier.phone} />
                    <InfoRow icon={<Mail className="h-4 w-4" />} label="Email" value={supplier.email} />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Danger zone - owner only */}
            {canDelete && (
              <Card>
                <CardHeader>
                  <CardTitle>Vùng nguy hiểm</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Xóa nhà cung cấp vĩnh viễn. Thao tác này không thể khôi phục và có thể thất bại nếu NCC có phiếu nhập kho.
                  </p>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" /> Xóa nhà cung cấp
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xóa vĩnh viễn nhà cung cấp?"
        description={`Nhà cung cấp "${supplier.name}" sẽ bị xóa. Thao tác có thể thất bại nếu NCC có phiếu nhập kho. Không thể khôi phục.`}
        variant="destructive"
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={handleDelete}
        loading={deleting}
      />
    </div>
  )
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string | null | undefined
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="text-muted-foreground mt-0.5 shrink-0">{icon}</div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value || "-"}</p>
      </div>
    </div>
  )
}
