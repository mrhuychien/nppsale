"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import type { Product } from "@/types"

interface ProductFormProps {
  product?: Product
  onSaved?: () => void
}

export function ProductForm({ product, onSaved }: ProductFormProps) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    sku: product?.sku || "",
    name: product?.name || "",
    category: product?.category || "",
    brand: product?.brand || "",
    barcode: product?.barcode || "",
    base_unit: product?.base_unit || "",
    vat_rate: product?.vat_rate?.toString() || "0.1",
    shelf_life_days: product?.shelf_life_days?.toString() || "",
    status: product?.status || "active",
  })
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const payload = {
        sku: form.sku,
        name: form.name,
        category: form.category || null,
        brand: form.brand || null,
        barcode: form.barcode || null,
        base_unit: form.base_unit,
        vat_rate: parseFloat(form.vat_rate) || 0.1,
        shelf_life_days: form.shelf_life_days ? parseInt(form.shelf_life_days) : null,
        status: form.status,
      }

      if (product) {
        const { error } = await supabase.from("products").update(payload).eq("id", product.id)
        if (error) throw error
        toast({ title: "Đã cập nhật sản phẩm" })
      } else {
        const { error } = await supabase.from("products").insert({ ...payload, org_id: user?.org_id })
        if (error) throw error
        toast({ title: "Đã tạo sản phẩm mới" })
      }

      if (onSaved) {
        onSaved()
      } else {
        router.push("/products")
        router.refresh()
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Có lỗi xảy ra"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{product ? "Cập nhật sản phẩm" : "Thêm sản phẩm mới"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sku">Mã SKU *</Label>
              <Input id="sku" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} required placeholder="VD: SNP-001" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Tên sản phẩm *</Label>
              <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="VD: Nước ngọt Coca Cola 330ml" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Danh mục</Label>
              <Input id="category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="VD: Nước giải khát" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="brand">Nhãn hàng</Label>
              <Input id="brand" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="VD: Coca Cola" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="base_unit">Đơn vị tính cơ bản *</Label>
              <Input id="base_unit" value={form.base_unit} onChange={(e) => setForm({ ...form, base_unit: e.target.value })} required placeholder="VD: lon, chai, gói" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="barcode">Mã vạch</Label>
              <Input id="barcode" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="VD: 8934588012345" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vat_rate">Thuế VAT</Label>
              <Select value={form.vat_rate} onValueChange={(v) => setForm({ ...form, vat_rate: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">0%</SelectItem>
                  <SelectItem value="0.05">5%</SelectItem>
                  <SelectItem value="0.08">8%</SelectItem>
                  <SelectItem value="0.1">10%</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="shelf_life">Hạn sử dụng (ngày)</Label>
              <Input id="shelf_life" type="number" value={form.shelf_life_days} onChange={(e) => setForm({ ...form, shelf_life_days: e.target.value })} placeholder="VD: 365" />
            </div>
            <div className="space-y-2">
              <Label>Trạng thái</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Đang bán</SelectItem>
                  <SelectItem value="inactive">Ngừng bán</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => router.back()}>Hủy</Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Đang lưu..." : (product ? "Cập nhật" : "Tạo mới")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
