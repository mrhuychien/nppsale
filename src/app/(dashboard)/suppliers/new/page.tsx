"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { PAYMENT_TERMS } from "@/lib/constants"

export default function NewSupplierPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("inventory")
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: "",
    code: "",
    category: "",
    contact_name: "",
    phone: "",
    email: "",
    address: "",
    tax_code: "",
    bank_account: "",
    bank_name: "",
    payment_terms: "NET30",
    notes: "",
    is_verified: false,
    is_active: true,
  })
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      // Auto-gen code if empty
      let code = form.code.trim()
      if (!code) {
        const { count } = await supabase
          .from("suppliers")
          .select("*", { count: "exact", head: true })
        const nextNum = (count || 0) + 1
        code = `NCC-${String(nextNum).padStart(4, "0")}`
      }

      const payload = {
        org_id: user?.org_id,
        name: form.name.trim(),
        code,
        category: form.category.trim() || null,
        contact_name: form.contact_name.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        tax_code: form.tax_code.trim() || null,
        bank_account: form.bank_account.trim() || null,
        bank_name: form.bank_name.trim() || null,
        payment_terms: form.payment_terms,
        notes: form.notes.trim() || null,
        is_verified: form.is_verified,
        is_active: form.is_active,
      }

      const { error } = await supabase.from("suppliers").insert(payload)
      if (error) throw error

      toast({ title: "Đã tạo nhà cung cấp mới" })
      router.push("/suppliers")
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
      <PageHeader title="Thêm nhà cung cấp mới" backHref="/suppliers" />

      <Card>
        <CardHeader>
          <CardTitle>Thông tin nhà cung cấp</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic info */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Tên nhà cung cấp *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  placeholder="VD: Công ty TNHH ABC"
                />
              </div>
              <div className="space-y-2">
                <Label>Mã NCC</Label>
                <Input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="Tự động: NCC-0001"
                />
              </div>
              <div className="space-y-2">
                <Label>Danh mục</Label>
                <Input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="VD: Thực phẩm, Hóa phẩm..."
                />
              </div>
              <div className="space-y-2">
                <Label>Điều khoản thanh toán</Label>
                <Select value={form.payment_terms} onValueChange={(v) => setForm({ ...form, payment_terms: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_TERMS.map((pt) => (
                      <SelectItem key={pt.value} value={pt.value}>{pt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Contact info */}
            <div>
              <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-3">Thông tin liên hệ</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Người liên hệ</Label>
                  <Input
                    value={form.contact_name}
                    onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                    placeholder="Tên người liên hệ"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Số điện thoại</Label>
                  <Input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="0901000001"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="supplier@email.com"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Địa chỉ</Label>
                  <Textarea
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    placeholder="Số nhà, tên đường, quận/huyện..."
                  />
                </div>
              </div>
            </div>

            {/* Legal / bank info */}
            <div>
              <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-3">Thông tin pháp lý & ngân hàng</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Mã số thuế</Label>
                  <Input
                    value={form.tax_code}
                    onChange={(e) => setForm({ ...form, tax_code: e.target.value })}
                    placeholder="VD: 0123456789"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Số tài khoản ngân hàng</Label>
                  <Input
                    value={form.bank_account}
                    onChange={(e) => setForm({ ...form, bank_account: e.target.value })}
                    placeholder="Số tài khoản"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tên ngân hàng</Label>
                  <Input
                    value={form.bank_name}
                    onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                    placeholder="VD: Vietcombank"
                  />
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>Ghi chú</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Ghi chú thêm về nhà cung cấp..."
                rows={3}
              />
            </div>

            {/* Switches */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
              <div className="flex items-center gap-3">
                <Checkbox
                  id="is_verified"
                  checked={form.is_verified}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, is_verified: checked === true })
                  }
                />
                <Label htmlFor="is_verified" className="cursor-pointer">
                  Đã xác minh
                </Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="is_active"
                  checked={form.is_active}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, is_active: checked })
                  }
                />
                <Label htmlFor="is_active" className="cursor-pointer">
                  Hoạt động
                </Label>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Hủy
              </Button>
              <Button type="submit" disabled={loading} className="bg-gradient-primary text-white shadow-ambient">
                {loading ? "Đang lưu..." : "Tạo mới"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
