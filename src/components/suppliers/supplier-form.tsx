"use client"

/**
 * BIỂU MẪU NHÀ CUNG CẤP MỚI — tách khỏi /suppliers/new để khung tạo nhanh NCC dùng chung (chủ nhà 03/10/2026,
 * Update 3.10: "Khi tạo xong sản phẩm hoặc NCC -> bấm xong thì quay về phần đang làm"). Không có `onDaTao`
 * thì như cũ: lưu xong về /suppliers.
 */
import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { PAYMENT_TERMS } from "@/lib/constants"
import { errorMessage } from "@/lib/errors"

/** NCC vừa tạo — đủ cho ô chọn NCC hiện ra và tự chọn. */
export interface NccVuaTao {
  id: string
  code: string
  name: string
}

export function SupplierForm({
  tenBanDau,
  onDaTao,
  onHuy,
}: {
  /** Tên gán sẵn — chữ đang gõ ở ô tìm NCC. */
  tenBanDau?: string
  /** Tạo nhanh tại chỗ: có thì lưu xong KHÔNG chuyển trang mà trả NCC vừa tạo. */
  onDaTao?: (ncc: NccVuaTao) => void
  /** Nút Huỷ (mặc định: lùi trang). */
  onHuy?: () => void
}) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  /** Chống bấm Lưu hai lần — `loading` chưa kịp vẽ lại thì cú bấm thứ hai vẫn lọt. */
  const khoa = useRef(false)
  const [form, setForm] = useState({
    name: tenBanDau?.trim() ?? "",
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
    if (khoa.current) return
    khoa.current = true
    setLoading(true)

    try {
      // Auto-gen code if empty
      let code = form.code.trim()
      if (!code) {
        const { count, error: cntErr } = await supabase
          .from("suppliers")
          .select("id", { count: "exact", head: true })
        if (cntErr) console.error("[suppliers/new] đếm NCC lỗi:", cntErr.message)
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

      const { data, error } = await supabase.from("suppliers").insert(payload).select("id, code, name").single()
      if (error) throw error

      toast({ title: "Đã tạo nhà cung cấp mới" })
      // Tạo nhanh tại chỗ: trả NCC cho nơi gọi, ở lại trang đang làm.
      const r = data as { id: string; code: string | null; name: string } | null
      if (onDaTao) {
        if (r?.id) onDaTao({ id: r.id, code: r.code ?? code, name: r.name ?? payload.name })
        else {
          toast({ title: "Đã lưu NCC nhưng chưa đọc lại được mã", description: "Gõ tìm lại NCC trong ô chọn.", variant: "destructive" })
          onHuy?.()
        }
        return
      }
      router.push("/suppliers")
      router.refresh()
    } catch (err: unknown) {
      const message = errorMessage(err)
      toast({ title: "Không tạo được nhà cung cấp", description: message, variant: "destructive" })
    } finally {
      khoa.current = false
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" data-testid="supplier-form">
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
        <Button type="button" variant="outline" onClick={() => (onHuy ? onHuy() : router.back())}>
          Hủy
        </Button>
        <Button type="submit" disabled={loading} className="bg-primary text-on-primary shadow-card">
          {loading ? "Đang lưu..." : "Tạo mới"}
        </Button>
      </div>
    </form>
  )
}
