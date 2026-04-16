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
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>SKU</TableHead>
          <TableHead>Tên sản phẩm</TableHead>
          <TableHead className="hidden sm:table-cell">Danh mục</TableHead>
          <TableHead className="hidden md:table-cell">Nhãn hàng</TableHead>
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
              <TableCell className="hidden sm:table-cell">{product.category || "-"}</TableCell>
              <TableCell className="hidden md:table-cell">{product.brand || "-"}</TableCell>
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
  )
}
