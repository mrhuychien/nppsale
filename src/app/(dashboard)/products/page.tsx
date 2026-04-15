"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { ProductTable } from "@/components/products/product-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Plus, Search, Package } from "lucide-react"
import type { Product } from "@/types"

export default function ProductsPage() {
  const { user, loading: authLoading } = useRoleGuard("products")
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    fetchProducts()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchProducts() {
    setLoading(true)
    const { data } = await supabase
      .from("products")
      .select("*, price_lists(*)")
      .order("name")
    setProducts((data as Product[]) || [])
    setLoading(false)
  }

  if (authLoading) return <Skeleton className="h-96" />

  const filtered = products.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase()) ||
      (p.brand || "").toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-4">
      <PageHeader title="Sản phẩm" description={`${products.length} sản phẩm`}>
        {user && hasPermission(user.role, "products", "create") && (
          <Button onClick={() => router.push("/products/new")}>
            <Plus className="mr-2 h-4 w-4" /> Thêm sản phẩm
          </Button>
        )}
      </PageHeader>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Tìm kiếm theo tên, SKU, nhãn hàng..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Package className="h-8 w-8 text-muted-foreground" />} title="Chưa có sản phẩm" description="Bắt đầu bằng cách thêm sản phẩm đầu tiên">
          {user && hasPermission(user.role, "products", "create") && (
            <Button onClick={() => router.push("/products/new")}><Plus className="mr-2 h-4 w-4" /> Thêm sản phẩm</Button>
          )}
        </EmptyState>
      ) : (
        <ProductTable products={filtered} />
      )}
    </div>
  )
}
