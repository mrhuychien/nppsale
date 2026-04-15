"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ProductForm } from "@/components/products/product-form"
import { UnitManager } from "@/components/products/unit-manager"
import { PriceListManager } from "@/components/products/price-list-manager"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import type { Product, ProductUnit, PriceList, CustomerGroup } from "@/types"

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { loading: authLoading } = useRoleGuard("products")
  const [product, setProduct] = useState<Product | null>(null)
  const [units, setUnits] = useState<ProductUnit[]>([])
  const [priceLists, setPriceLists] = useState<PriceList[]>([])
  const [customerGroups, setCustomerGroups] = useState<CustomerGroup[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

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

  return (
    <div className="space-y-4">
      <PageHeader title={product.name} description={`SKU: ${product.sku}`} />

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
  )
}
