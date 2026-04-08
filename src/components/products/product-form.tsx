"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
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
        toast({ title: "Da cap nhat san pham" })
      } else {
        const { error } = await supabase.from("products").insert(payload)
        if (error) throw error
        toast({ title: "Da tao san pham moi" })
      }

      onSaved?.()
      router.push("/products")
      router.refresh()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Co loi xay ra"
      toast({ title: "Loi", description: message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{product ? "Cap nhat san pham" : "Them san pham moi"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sku">Ma SKU *</Label>
              <Input id="sku" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} required placeholder="VD: SNP-001" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Ten san pham *</Label>
              <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="VD: Nuoc ngot Coca Cola 330ml" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Danh muc</Label>
              <Input id="category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="VD: Nuoc giai khat" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="brand">Nha hang</Label>
              <Input id="brand" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="VD: Coca Cola" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="base_unit">Don vi tinh co ban *</Label>
              <Input id="base_unit" value={form.base_unit} onChange={(e) => setForm({ ...form, base_unit: e.target.value })} required placeholder="VD: lon, chai, goi" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="barcode">Ma vach</Label>
              <Input id="barcode" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="VD: 8934588012345" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vat_rate">Thue VAT</Label>
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
              <Label htmlFor="shelf_life">Han su dung (ngay)</Label>
              <Input id="shelf_life" type="number" value={form.shelf_life_days} onChange={(e) => setForm({ ...form, shelf_life_days: e.target.value })} placeholder="VD: 365" />
            </div>
            <div className="space-y-2">
              <Label>Trang thai</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Dang ban</SelectItem>
                  <SelectItem value="inactive">Ngung ban</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => router.back()}>Huy</Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Dang luu..." : (product ? "Cap nhat" : "Tao moi")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
