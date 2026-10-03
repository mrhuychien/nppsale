"use client"

/**
 * DANH SÁCH SẢN PHẨM — lưới máy tính + thẻ điện thoại, theo khuôn danh sách chung
 * (chủ nhà 27/09/2026: "Làm chung form hiển thị danh sách cho toàn bộ các danh sách theo
 * form đang dùng cho Đơn hàng, hóa đơn, trả hàng"): `DocTable` + `DocCardList`, bấm dòng mở
 * xem nhanh, bấm SKU sang chi tiết.
 */

import { useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { DocTable, DocCodeLink, DocCellText, type DocColumn } from "@/components/ui/doc-table"
import type { DocSort } from "@/lib/list/sap-xep-may-chu"
import { DocCardList } from "@/components/ui/doc-card-list"
import { formatCurrency } from "@/lib/utils"
import type { Product, PriceList } from "@/types"
import type { ProductColumnKey } from "@/app/(dashboard)/products/list-config"

export type ProductRow = Product & {
  price_lists?: PriceList[]
  supplier?: { id: string; name: string } | null
}

/**
 * Giá bán mặc định — MỘT công thức cho lưới, thẻ điện thoại và ngăn xem nhanh.
 * ⚠ Bảng giá chung (không nhóm) trước, KHÔNG có thì dự phòng `sell_price`. Trước đây thẻ
 *   mobile chỉ đọc price_lists: sản phẩm định giá thẳng ở sell_price hiện "-" trên điện
 *   thoại trong khi máy tính ra giá đúng — nhân viên đứng ở cửa hàng không báo được giá.
 */
export function giaMacDinh(product: ProductRow): number {
  return product.price_lists?.find((p) => !p.group_id)?.price ?? Number(product.sell_price ?? 0)
}

interface ProductTableProps {
  products: ProductRow[]
  visibleColumns: ProductColumnKey[]
  selectable?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string, next: boolean) => void
  onToggleSelectAll?: (next: boolean) => void
  allSelected?: boolean
  someSelected?: boolean
  activeId?: string | null
  onOpen: (product: ProductRow) => void
  /**
   * ⚠ XẾP Ở MÁY CHỦ — màn Sản phẩm phân trang ở máy chủ; bảng chỉ vẽ mũi tên và báo lại.
   * Chỉ cột Tên xếp được (`.order("name")`); "Giá bán" tính từ bảng giá → không xếp.
   */
  sort?: DocSort | null
  onSortChange?: (next: DocSort) => void
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
  activeId,
  onOpen,
  sort,
  onSortChange,
}: ProductTableProps) {
  const columns = useMemo(() => {
    const cols: Array<DocColumn<ProductRow> & { k?: ProductColumnKey }> = [
      ...(selectable
        ? [{
            key: "select",
            label: (
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={(v) => onToggleSelectAll?.(!!v)}
                aria-label="Chọn tất cả"
              />
            ),
            width: "44px",
            render: (product: ProductRow) => (
              <span onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={selectedIds?.has(product.id) ?? false}
                  onCheckedChange={(v) => onToggleSelect?.(product.id, !!v)}
                  aria-label={`Chọn ${product.name}`}
                />
              </span>
            ),
          }]
        : []),
      { k: "sku", key: "sku", label: "SKU", width: "130px", render: (p) => <DocCodeLink href={`/products/${p.id}`}>{p.sku}</DocCodeLink> },
      {
        key: "name", label: "Tên sản phẩm", width: "minmax(240px,2fr)",
        sortable: true,
        render: (p) => <span className="block truncate text-sm font-bold" title={p.name}>{p.name}</span>,
      },
      /* Không còn cột "Danh mục" (Nhóm hàng) — chủ nhà 03/10/2026 bỏ trường; hàng nhóm theo NCC. */
      { k: "supplier", key: "supplier", label: "Nhà cung cấp", width: "170px", render: (p) => <DocCellText muted>{p.supplier?.name}</DocCellText> },
      { k: "unit", key: "unit", label: "ĐVT", width: "90px", render: (p) => <DocCellText muted>{p.base_unit}</DocCellText> },
      {
        /* ⚠ KHÔNG XẾP: giá lấy từ bảng giá (`giaMacDinh`) — xếp được chỉ trên trang đang xem. */
        k: "price", key: "price", label: "Giá bán", width: "130px", align: "right",
        render: (p) => (giaMacDinh(p) > 0 ? formatCurrency(giaMacDinh(p)) : "-"),
      },
      {
        k: "status", key: "status", label: "Trạng thái", width: "120px",
        render: (p) => (
          <Badge variant={p.status === "active" ? "success" : "secondary"}>{p.status === "active" ? "Đang bán" : "Ngừng"}</Badge>
        ),
      },
    ]
    return cols.filter((c) => !c.k || visibleColumns.includes(c.k))
  }, [visibleColumns, selectable, selectedIds, allSelected, someSelected, onToggleSelect, onToggleSelectAll])

  return <DocTable rows={products} columns={columns} activeId={activeId} onOpen={onOpen} sort={sort} onSortChange={onSortChange} />
}

/** Thẻ điện thoại — bố cục cố định, không phụ thuộc cột đang chọn. */
export function ProductCards({
  products,
  selectable = false,
  selectedIds,
  onToggleSelect,
  onOpen,
}: Pick<ProductTableProps, "products" | "selectable" | "selectedIds" | "onToggleSelect" | "onOpen">) {
  return (
    <DocCardList
      items={products}
      onOpen={onOpen}
      select={selectable ? { checked: (p) => selectedIds?.has(p.id) ?? false, onChange: (p, v) => onToggleSelect?.(p.id, v) } : undefined}
      card={(p) => {
        const gia = giaMacDinh(p)
        return {
          accent: p.status === "active" ? "#22c55e" : "#98a2b3",
          title: p.name,
          total: gia > 0 ? formatCurrency(gia) : "-",
          meta: [p.sku, `ĐVT: ${p.base_unit}`].filter(Boolean).join(" · "),
          summary: p.supplier?.name || undefined,
          badge: p.status === "active" ? null : { label: "Ngừng", bg: "#eef1f5", fg: "#565a67" },
        }
      }}
    />
  )
}
