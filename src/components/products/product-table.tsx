"use client"

import Link from "next/link"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/utils"
import type { Product, PriceList } from "@/types"

interface ProductTableProps {
  products: (Product & { price_lists?: PriceList[] })[]
}

export function ProductTable({ products }: ProductTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>SKU</TableHead>
          <TableHead>Ten san pham</TableHead>
          <TableHead className="hidden sm:table-cell">Danh muc</TableHead>
          <TableHead className="hidden md:table-cell">Nha hang</TableHead>
          <TableHead>DVT</TableHead>
          <TableHead className="text-right">Gia ban</TableHead>
          <TableHead>Trang thai</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {products.map((product) => {
          const defaultPrice = product.price_lists?.find((p) => !p.group_id)
          return (
            <TableRow key={product.id}>
              <TableCell>
                <Link href={`/products/${product.id}`} className="font-mono text-sm text-primary hover:underline">
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
                  {product.status === "active" ? "Dang ban" : "Ngung"}
                </Badge>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
