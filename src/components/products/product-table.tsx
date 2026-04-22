"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/utils"
import { Eye } from "lucide-react"
import type { Product, PriceList } from "@/types"

interface ProductTableProps {
  products: (Product & { price_lists?: PriceList[] })[]
}

export function ProductTable({ products }: ProductTableProps) {
  const router = useRouter()

  return (
    <>
      {/* Desktop table */}
      <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Tên sản phẩm</TableHead>
              <TableHead>Danh mục</TableHead>
              <TableHead>Nhãn hàng</TableHead>
              <TableHead>ĐVT</TableHead>
              <TableHead className="text-right">Giá bán</TableHead>
              <TableHead>Trạng thái</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => {
              const defaultPrice = product.price_lists?.find((p) => !p.group_id)
              return (
                <TableRow
                  key={product.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/products/${product.id}`)}
                >
                  <TableCell>
                    <Link
                      href={`/products/${product.id}`}
                      className="font-mono text-sm text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {product.sku}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium">{product.name}</TableCell>
                  <TableCell>{product.category || "-"}</TableCell>
                  <TableCell>{product.brand || "-"}</TableCell>
                  <TableCell>{product.base_unit}</TableCell>
                  <TableCell className="text-right">
                    {defaultPrice ? formatCurrency(defaultPrice.price) : "-"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={product.status === "active" ? "success" : "secondary"}>
                      {product.status === "active" ? "Đang bán" : "Ngừng"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile card list */}
      <div className="lg:hidden space-y-3">
        {products.map((product) => {
          const defaultPrice = product.price_lists?.find((p) => !p.group_id)
          return (
            <div
              key={product.id}
              className="relative rounded-2xl border bg-card shadow-ambient overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
              onClick={() => router.push(`/products/${product.id}`)}
            >
              <div className="p-4">
                <div className="flex justify-between items-start gap-3 mb-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs font-bold text-primary">{product.sku}</p>
                    <h3 className="font-extrabold text-base leading-tight mt-0.5">
                      {product.name}
                    </h3>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {product.category && (
                        <Badge variant="outline" className="text-xs">{product.category}</Badge>
                      )}
                      {product.brand && (
                        <Badge variant="outline" className="text-xs">{product.brand}</Badge>
                      )}
                      <Badge variant="outline" className="text-xs">ĐVT: {product.base_unit}</Badge>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <Badge variant={product.status === "active" ? "success" : "secondary"}>
                      {product.status === "active" ? "Đang bán" : "Ngừng"}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 pt-2 mt-2 border-t">
                  <span className="text-xs text-muted-foreground">Giá bán</span>
                  <span className="font-bold text-base">
                    {defaultPrice ? formatCurrency(defaultPrice.price) : "-"}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
