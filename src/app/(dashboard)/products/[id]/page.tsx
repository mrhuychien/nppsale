"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ProductForm } from "@/components/products/product-form"
import { UnitManager } from "@/components/products/unit-manager"
import { PriceListManager } from "@/components/products/price-list-manager"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { Trash2 } from "lucide-react"
import type { Product, ProductUnit, PriceList, CustomerGroup } from "@/types"

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("products")
  const [product, setProduct] = useState<Product | null>(null)
  const [units, setUnits] = useState<ProductUnit[]>([])
  const [priceLists, setPriceLists] = useState<PriceList[]>([])
  const [customerGroups, setCustomerGroups] = useState<CustomerGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [productRes, unitsRes, priceRes, groupsRes] = await Promise.all([
      supabase.from("products").select("*").eq("id", id).single(),
      supabase.from("product_units").select("*").eq("product_id", id),
      supabase.from("price_lists").select("*, group:customer_groups(*)").eq("product_id", id),
      supabase.from("customer_groups").select("*"),
    ])
    if (productRes.data) setProduct(productRes.data as Product)
    setUnits((unitsRes.data as ProductUnit[]) || [])
    setPriceLists((priceRes.data as PriceList[]) || [])
    setCustomerGroups((groupsRes.data as CustomerGroup[]) || [])
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (id && id !== "new") fetchData()
    else setLoading(false)
  }, [id, fetchData])

  const handleDelete = async () => {
    if (!product) return
    setDeleting(true)
    try {
      const { error } = await supabase.from("products").delete().eq("id", product.id)
      if (error) throw error
      toast({ title: "Đã xóa sản phẩm" })
      router.push("/products")
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

  if (id === "new") {
    return (
      <div className="space-y-4">
        <PageHeader title="Thêm sản phẩm mới" />
        <ProductForm />
      </div>
    )
  }

  if (!product) return <div>Không tìm thấy sản phẩm</div>

  const canDelete = user && hasPermission(user.role, "products", "delete")

  return (
    <div className="space-y-4">
      <PageHeader title={product.name} description={`SKU: ${product.sku}`} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Tabs defaultValue="info">
            <TabsList>
              <TabsTrigger value="info">Thông tin</TabsTrigger>
              <TabsTrigger value="units">Đơn vị tính ({units.length})</TabsTrigger>
              <TabsTrigger value="prices">Bảng giá ({priceLists.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="info">
              <ProductForm product={product} />
            </TabsContent>
            <TabsContent value="units">
              <UnitManager productId={product.id} baseUnit={product.base_unit} units={units} onUpdate={fetchData} />
            </TabsContent>
            <TabsContent value="prices">
              <PriceListManager
                productId={product.id}
                baseUnit={product.base_unit}
                units={units}
                priceLists={priceLists}
                customerGroups={customerGroups}
                onUpdate={fetchData}
              />
            </TabsContent>
          </Tabs>
        </div>

        {canDelete && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Vùng nguy hiểm</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Xóa sản phẩm vĩnh viễn. Thao tác có thể thất bại nếu sản phẩm đã có trong đơn hàng hoặc tồn kho.
                </p>
                <Button
                  variant="outline"
                  className="w-full justify-start text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Xóa sản phẩm
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xóa vĩnh viễn sản phẩm?"
        description={`Sản phẩm "${product.name}" (SKU: ${product.sku}) sẽ bị xóa cùng các đơn vị tính và bảng giá. Thao tác có thể thất bại nếu sản phẩm đã có trong đơn hàng hoặc tồn kho. Không thể khôi phục.`}
        variant="destructive"
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={handleDelete}
        loading={deleting}
      />
    </div>
  )
}
