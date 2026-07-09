"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { STOCK_ENTRY_TYPES } from "@/lib/constants"
import type { Product } from "@/types"

export default function StocktakePage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("inventory")
  const [products, setProducts] = useState<Product[]>([])
  const [entryType, setEntryType] = useState("import")
  const [productId, setProductId] = useState("")
  const [batchCode, setBatchCode] = useState("")
  const [quantity, setQuantity] = useState("")
  const [expiresAt, setExpiresAt] = useState("")
  const [location, setLocation] = useState("")
  const [notes, setNotes] = useState("")
  const [loading, setLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase.from("products").select("id, sku, name, base_unit").eq("status", "active").order("name")
      setProducts((data as Product[]) || [])
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <Skeleton className="h-96" />

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!productId || !quantity) return
    setLoading(true)

    try {
      const entryCode = `WH-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(1000 + Math.random() * 9000)}`
      const { data: entry, error: entryErr } = await supabase
        .from("stock_entries")
        .insert({ entry_code: entryCode, type: entryType, created_by: user?.id, notes: notes || null, org_id: user?.org_id })
        .select()
        .single()
      if (entryErr) throw entryErr

      const qty = parseInt(quantity)

      if (entryType === "import" && batchCode && expiresAt) {
        const { error: batchErr } = await supabase.from("batches").insert({
          product_id: productId,
          batch_code: batchCode,
          expires_at: expiresAt,
          location: location || null,
          qty_initial: qty,
          qty_on_hand: qty,
          org_id: user?.org_id,
        })
        if (batchErr) throw batchErr
      }

      const selectedProduct = products.find((p) => p.id === productId)
      const signedQty = entryType === "export" ? -qty : qty
      const { error: lineErr } = await supabase.from("stock_entry_lines").insert({
        entry_id: entry.id,
        product_id: productId,
        unit_name: selectedProduct?.base_unit || "",
        quantity: signedQty,
        qty_in_base_uom: signedQty,
        qty_in_transaction_uom: signedQty,
        transaction_uom: selectedProduct?.base_unit || "",
        conversion_factor_snapshot: 1,
      })
      if (lineErr) throw lineErr

      toast({ title: `Đã tạo phiếu ${entryCode}` })
      router.push("/inventory/entries")
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Có lỗi xảy ra"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Tạo phiếu kho" backHref="/inventory" />
      <Card>
        <CardHeader><CardTitle>Thông tin phiếu kho</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Loại phiếu *</Label>
                <Select value={entryType} onValueChange={setEntryType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STOCK_ENTRY_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Sản phẩm *</Label>
                <Select value={productId} onValueChange={setProductId}>
                  <SelectTrigger><SelectValue placeholder="Chọn sản phẩm" /></SelectTrigger>
                  <SelectContent>
                    {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.sku} - {p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Số lượng *</Label>
                <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
              </div>
              {entryType === "import" && (
                <>
                  <div className="space-y-2">
                    <Label>Mã lô hàng</Label>
                    <Input value={batchCode} onChange={(e) => setBatchCode(e.target.value)} placeholder="VD: LOT-2026-001" />
                  </div>
                  <div className="space-y-2">
                    <Label>Hạn sử dụng</Label>
                    <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Vị trí kho</Label>
                    <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="VD: T2-K3-05" />
                  </div>
                </>
              )}
            </div>
            <div className="space-y-2">
              <Label>Ghi chú</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => router.back()}>Hủy</Button>
              <Button type="submit" disabled={loading}>{loading ? "Đang lưu..." : "Tạo phiếu"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
