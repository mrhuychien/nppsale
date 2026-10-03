"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "@/components/ui/link"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchSelect } from "@/components/ui/search-select"
import { CatalogueShortNote } from "@/components/ui/catalogue-short-note"
import { TaoNhanhSanPham } from "@/components/tao-nhanh/tao-nhanh-san-pham"
import { NHAN_TAO_NHANH, duocTaoNhanh } from "@/lib/tao-nhanh/quyen"
import { gopVuaTao } from "@/lib/tao-nhanh/vua-tao"
import { loadCatalogue } from "@/lib/products/load-catalogue"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import type { Product } from "@/types"
import { errorMessage } from "@/lib/errors"

export default function NewBatchPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("inventory")
  const [products, setProducts] = useState<Product[]>([])
  /** Danh mục đọc chưa hết — ô tìm phải nói ra. */
  const [catTruncated, setCatTruncated] = useState(false)
  const [productId, setProductId] = useState("")
  const [batchCode, setBatchCode] = useState("")
  const [manufacturedAt, setManufacturedAt] = useState("")
  const [expiresAt, setExpiresAt] = useState("")
  const [location, setLocation] = useState("")
  const [loading, setLoading] = useState(false)
  const [productsLoading, setProductsLoading] = useState(true)
  /** Khung tạo nhanh sản phẩm đang mở, kèm chữ đã gõ ở ô tìm (chủ nhà 03/10/2026). */
  const [taoSp, setTaoSp] = useState<{ chu: string } | null>(null)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    /* ⚠ KÉO ĐỦ DANH MỤC (`loadCatalogue`), không dừng ở 1.000 mã đầu — mã sau đó không tạo được lô. */
    loadCatalogue<Product>(supabase, "id, sku, name, barcode", { activeOnly: true }).then((res) => {
      setProducts(res.rows)
      setCatTruncated(res.truncated)
      setProductsLoading(false)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const productOptions = useMemo(
    () => products.map((p) => ({ id: p.id, label: p.name, hint: p.sku || null, keywords: [p.sku, p.barcode].filter(Boolean).join(" ") })),
    [products]
  )

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
    if (!productId || !batchCode.trim() || !expiresAt) {
      toast({ title: "Vui lòng nhập đầy đủ thông tin bắt buộc", variant: "destructive" })
      return
    }
    /**
     * ⚠ LÔ RỖNG. Mig 123 dừng phiếu kiểm kê khi sản phẩm thừa hàng mà chưa
     * có lô nào ("NO_BATCH: … Tạo lô cho sản phẩm này trước."). Cách đi
     * đúng là tạo một lô RỖNG rồi để phiếu kiểm kê ghi phần thừa vào đó.
     * Từ mig 170 máy chủ cũng chỉ nhận lô rỗng từ màn hình — gõ sẵn số ở
     * đây là cộng kho mà không có dòng thẻ kho, và phiếu kiểm kê
     * cộng thêm lần nữa.
     */
    const qty = 0
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
      toast({ title: "Lỗi", description: errorMessage(err), variant: "destructive" })
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
                <Label htmlFor="batch-product">Sản phẩm *</Label>
                {/* Ô tìm (thay `<Select>` liệt kê hết) — cuối danh sách là "+ Tạo sản phẩm mới", tạo tại chỗ. */}
                <SearchSelect
                  id="batch-product"
                  options={productOptions}
                  valueId={productId}
                  onPick={(o) => setProductId(o?.id ?? "")}
                  placeholder="Tên hàng, mã SKU hoặc mã vạch…"
                  emptyHint="Không tìm thấy mã nào khớp."
                  taoMoi={
                    duocTaoNhanh(user?.role, "san-pham")
                      ? { nhan: NHAN_TAO_NHANH["san-pham"], onTao: (chu) => setTaoSp({ chu }) }
                      : undefined
                  }
                />
                {catTruncated && <CatalogueShortNote />}
                <TaoNhanhSanPham
                  open={!!taoSp}
                  onOpenChange={(o) => !o && setTaoSp(null)}
                  chuBanDau={taoSp?.chu}
                  moTa="Tạo xong sản phẩm được chọn luôn cho lô này."
                  onDaTao={(sp) => {
                    setProducts((ds) => gopVuaTao(ds, [sp]))
                    setProductId(sp.id)
                  }}
                />
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
              {/* ⚠ LÔ TẠO Ở ĐÂY LUÔN RỖNG (mig 170). Hàng có tồn vào kho qua
                  Nhập kho hoặc phiếu kiểm kê — có thẻ kho, có giá vốn. */}
              <div className="space-y-2">
                <Label>Số lượng ban đầu</Label>
                <Input type="number" value={0} disabled readOnly />
                <p className="text-xs text-muted-foreground">
                  Lô tạo ở đây là lô <strong>rỗng</strong> — dùng khi phiếu kiểm kê cần ghi phần thừa vào
                  một lô chưa có. Nhập hàng có số lượng thì dùng{" "}
                  <Link href="/inventory/stock-in" className="underline">Nhập kho</Link>.
                </p>
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
