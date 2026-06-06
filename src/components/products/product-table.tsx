"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { formatCurrency } from "@/lib/utils"
import { Eye } from "lucide-react"
import type { Product, PriceList } from "@/types"
import type { ProductColumnKey } from "@/app/(dashboard)/products/list-config"

interface ProductTableProps {
  products: (Product & {
    price_lists?: PriceList[]
    supplier?: { id: string; name: string } | null
  })[]
  visibleColumns: ProductColumnKey[]
  selectable?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string, next: boolean) => void
  onToggleSelectAll?: (next: boolean) => void
  allSelected?: boolean
  someSelected?: boolean
}

export function ProductTable({
  products,
  visibleColumns,
  selectable = false,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  allSelected = false,
  someSelected = false,
}: ProductTableProps) {
  const router = useRouter()
  const show = (key: ProductColumnKey) => visibleColumns.includes(key)

  return (
    <>
      {/* Desktop table */}
      <div className="hidden lg:block overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              {selectable && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={(v) => onToggleSelectAll?.(!!v)}
                    aria-label="Chọn tất cả"
                  />
                </TableHead>
              )}
              {show("sku") && <TableHead>SKU</TableHead>}
              <TableHead>Tên sản phẩm</TableHead>
              {show("category") && <TableHead>Danh mục</TableHead>}
              {show("supplier") && <TableHead>Nhà cung cấp</TableHead>}
              {show("unit") && <TableHead>ĐVT</TableHead>}
              {show("price") && <TableHead className="text-right">Giá bán</TableHead>}
              {show("status") && <TableHead>Trạng thái</TableHead>}
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => {
              const defaultPrice = product.price_lists?.find((p) => !p.group_id)?.price ?? Number(product.sell_price ?? 0)
              const checked = selectedIds?.has(product.id) ?? false
              return (
                <TableRow
                  key={product.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => router.push(`/products/${product.id}`)}
                >
                  {selectable && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => onToggleSelect?.(product.id, !!v)}
                        aria-label={`Chọn ${product.name}`}
                      />
                    </TableCell>
                  )}
                  {show("sku") && (
                    <TableCell>
                      <Link
                        href={`/products/${product.id}`}
                        className="font-mono text-sm text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {product.sku}
                      </Link>
                    </TableCell>
                  )}
                  <TableCell className="font-medium">{product.name}</TableCell>
                  {show("category") && <TableCell>{product.category || "-"}</TableCell>}
                  {show("supplier") && <TableCell>{product.supplier?.name || "-"}</TableCell>}
                  {show("unit") && <TableCell>{product.base_unit}</TableCell>}
                  {show("price") && (
                    <TableCell className="text-right tabular-nums">
                      {defaultPrice > 0 ? formatCurrency(defaultPrice) : "-"}
                    </TableCell>
                  )}
                  {show("status") && (
                    <TableCell>
                      <Badge variant={product.status === "active" ? "success" : "secondary"}>
                        {product.status === "active" ? "Đang bán" : "Ngừng"}
                      </Badge>
                    </TableCell>
                  )}
                  <TableCell>
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile card list — layout cố định, không phụ thuộc visibleColumns */}
      <div className="lg:hidden space-y-3">
        {products.map((product) => {
          const defaultPrice = product.price_lists?.find((p) => !p.group_id)
          const checked = selectedIds?.has(product.id) ?? false
          return (
            <div
              key={product.id}
              className="relative rounded-xl border border-outline-variant/60 bg-surface-container-lowest shadow-card overflow-hidden active:scale-[0.99] transition-transform"
            >
              <div className="p-4">
                <div className="flex justify-between items-start gap-3 mb-2">
                  {selectable && (
                    <div onClick={(e) => e.stopPropagation()} className="pt-0.5">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => onToggleSelect?.(product.id, !!v)}
                        aria-label={`Chọn ${product.name}`}
                      />
                    </div>
                  )}
                  <div
                    className="min-w-0 flex-1 cursor-pointer"
                    onClick={() => router.push(`/products/${product.id}`)}
                  >
                    <p className="font-mono text-xs font-bold text-primary">{product.sku}</p>
                    <h3 className="font-extrabold text-base leading-tight mt-0.5">
                      {product.name}
                    </h3>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {product.category && (
                        <Badge variant="outline" className="text-xs">{product.category}</Badge>
                      )}
                      {product.supplier?.name && (
                        <Badge variant="outline" className="text-xs">{product.supplier.name}</Badge>
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
                  <span className="font-bold text-base tabular-nums">
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
