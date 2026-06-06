"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { ProductForm } from "@/components/products/product-form"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import Link from "next/link"
import { Trash2, ClipboardList } from "lucide-react"
import type { Product } from "@/types"

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("products")
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from("products").select("*").eq("id", id).single()
    if (data) setProduct(data as Product)
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
        <PageHeader title="Thêm sản phẩm mới" backHref="/products" />
        <ProductForm />
      </div>
    )
  }

  if (!product) return <div>Không tìm thấy sản phẩm</div>

  const canDelete = user && hasPermission(user.role, "products", "delete")

  return (
    <div className="space-y-4">
      <PageHeader title={product.name} description={`SKU: ${product.sku}`} backHref="/products">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/inventory/stock-card/${product.id}`}>
            <ClipboardList className="h-4 w-4 mr-1.5" /> Thẻ kho
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ProductForm product={product} />
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
        description={`Sản phẩm "${product.name}" (SKU: ${product.sku}) sẽ bị xóa cùng các đơn vị tính. Thao tác có thể thất bại nếu sản phẩm đã có trong đơn hàng hoặc tồn kho. Không thể khôi phục.`}
        variant="destructive"
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={handleDelete}
        loading={deleting}
      />
    </div>
  )
}
