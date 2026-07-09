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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import type { Product } from "@/types"

export default function NewBatchPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("inventory")
  const [products, setProducts] = useState<Product[]>([])
  const [productId, setProductId] = useState("")
  const [batchCode, setBatchCode] = useState("")
  const [manufacturedAt, setManufacturedAt] = useState("")
  const [expiresAt, setExpiresAt] = useState("")
  const [location, setLocation] = useState("")
  const [qtyInitial, setQtyInitial] = useState("")
  const [loading, setLoading] = useState(false)
  const [productsLoading, setProductsLoading] = useState(true)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("products")
        .select("id, sku, name")
        .eq("status", "active")
        .order("name")
      setProducts((data as Product[]) || [])
      setProductsLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || productsLoading) return <Skeleton className="h-96" />

  // Permission check: warehouse + owner can create
  if (user && !["warehouse", "owner"].includes(user.role)) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Bạn chưa có quyền tạo lô hàng
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!productId || !batchCode.trim() || !expiresAt || !qtyInitial) {
      toast({ title: "Vui lòng nhập đầy đủ thông tin bắt buộc", variant: "destructive" })
      return
    }
    const qty = parseInt(qtyInitial)
    if (qty <= 0) {
      toast({ title: "Số lượng phải lớn hơn 0", variant: "destructive" })
      return
    }
    if (!user?.org_id) {
      toast({ title: "Không xác định được tổ chức", variant: "destructive" })
      return
    }

    setLoading(true)
    try {
      const { data, error } = await supabase
        .from("batches")
        .insert({
          org_id: user.org_id,
          product_id: productId,
          batch_code: batchCode.trim(),
          manufactured_at: manufacturedAt || null,
          expires_at: expiresAt,
          location: location.trim() || null,
          qty_initial: qty,
          qty_on_hand: qty,
        })
        .select()
        .single()
      if (error) throw error

      toast({ title: `Đã tạo lô ${batchCode.trim()}` })
      if (data?.id) {
        router.push(`/inventory/batches/${data.id}`)
      } else {
        router.push("/inventory/batches")
      }
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Tạo lô hàng mới" description="Nhập thông tin lô hàng để theo dõi tồn kho và HSD" backHref="/inventory/batches" />
      <Card>
        <CardHeader>
          <CardTitle>Thông tin lô hàng</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Sản phẩm *</Label>
                <Select value={productId} onValueChange={setProductId}>
                  <SelectTrigger><SelectValue placeholder="Chọn sản phẩm" /></SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.sku} - {p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Mã lô *</Label>
                <Input
                  value={batchCode}
                  onChange={(e) => setBatchCode(e.target.value)}
                  placeholder="VD: LOT-2026-001"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Ngày sản xuất</Label>
                <Input
                  type="date"
                  value={manufacturedAt}
                  onChange={(e) => setManufacturedAt(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Hạn sử dụng *</Label>
                <Input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Vị trí kho</Label>
                <Input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="VD: T2-K3-05"
                />
              </div>
              <div className="space-y-2">
                <Label>Số lượng ban đầu *</Label>
                <Input
                  type="number"
                  min={1}
                  value={qtyInitial}
                  onChange={(e) => setQtyInitial(e.target.value)}
                  required
                  placeholder="Tồn ban đầu (= tồn hiện tại)"
                />
                <p className="text-xs text-muted-foreground">Tồn hiện tại sẽ được đặt bằng số lượng ban đầu.</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => router.back()}>Hủy</Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Đang lưu..." : "Tạo lô hàng"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
