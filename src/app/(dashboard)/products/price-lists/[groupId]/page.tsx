"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useCustomerGroups } from "@/hooks/use-customer-groups"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils"
import { Pencil, Save, X, Copy, FileText } from "lucide-react"
import type { Product, PriceList } from "@/types"

interface GroupPriceRow {
  productId: string
  productName: string
  sku: string
  unitName: string
  priceList: PriceList | null
  defaultPrice: PriceList | null
}

export default function GroupPriceListPage() {
  const { groupId } = useParams<{ groupId: string }>()
  const { user, loading: authLoading } = useRoleGuard("products")
  const isDefault = groupId === "default"
  const [products, setProducts] = useState<Product[]>([])
  const [priceLists, setPriceLists] = useState<PriceList[]>([])
  const { groups: customerGroups } = useCustomerGroups()
  const group = isDefault
    ? null
    : customerGroups.find((g) => g.id === groupId) ?? null
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [editedRows, setEditedRows] = useState<
    Record<string, { price: string; effectiveFrom: string; effectiveTo: string }>
  >({})
  const [saving, setSaving] = useState(false)
  const [copyingDefaults, setCopyingDefaults] = useState(false)
  const supabase = createClient()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [productsRes, pricesRes] = await Promise.all([
      supabase
        .from("products")
        .select("*, units:product_units(*)")
        .order("name"),
      supabase.from("price_lists").select("*, group:customer_groups(*)"),
    ])
    setProducts((productsRes.data as Product[]) || [])
    setPriceLists((pricesRes.data as PriceList[]) || [])
    setLoading(false)
  }, [groupId, isDefault]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchData()
  }, [fetchData])

  if (authLoading) return <Skeleton className="h-96" />

  const canEdit =
    user &&
    hasPermission(user.role, "products", "update") &&
    (user.role === "owner" || user.role === "manager")

  const groupName = isDefault ? "Giá mặc định (chung)" : group?.name || "Nhóm khách hàng"

  // Build rows for this group
  const buildRows = (): GroupPriceRow[] => {
    const rows: GroupPriceRow[] = []

    // Get all unique product+unit combos that have any price
    const productUnits = new Map<string, { productId: string; unitName: string }>()
    for (const pl of priceLists) {
      const key = `${pl.product_id}__${pl.unit_name}`
      if (!productUnits.has(key)) {
        productUnits.set(key, {
          productId: pl.product_id,
          unitName: pl.unit_name,
        })
      }
    }

    for (const [, { productId, unitName }] of Array.from(productUnits)) {
      const product = products.find((p) => p.id === productId)
      if (!product) continue

      const groupPrice = priceLists.find(
        (pl) =>
          pl.product_id === productId &&
          pl.unit_name === unitName &&
          (isDefault ? pl.group_id === null : pl.group_id === groupId)
      )

      const defaultPrice = priceLists.find(
        (pl) =>
          pl.product_id === productId &&
          pl.unit_name === unitName &&
          pl.group_id === null
      )

      rows.push({
        productId,
        productName: product.name,
        sku: product.sku,
        unitName,
        priceList: groupPrice || null,
        defaultPrice: defaultPrice || null,
      })
    }

    return rows
  }

  const rows = buildRows()
  const rKey = (row: GroupPriceRow) => `${row.productId}__${row.unitName}`

  const getEditValue = (row: GroupPriceRow, field: "price" | "effectiveFrom" | "effectiveTo"): string => {
    const key = rKey(row)
    if (editedRows[key]?.[field] !== undefined) {
      return editedRows[key][field]
    }
    if (field === "price") return row.priceList ? String(row.priceList.price) : ""
    if (field === "effectiveFrom") return row.priceList?.effective_from || ""
    return row.priceList?.effective_to || ""
  }

  const handleEditField = (
    key: string,
    field: "price" | "effectiveFrom" | "effectiveTo",
    value: string
  ) => {
    setEditedRows((prev) => ({
      ...prev,
      [key]: {
        price: prev[key]?.price ?? "",
        effectiveFrom: prev[key]?.effectiveFrom ?? "",
        effectiveTo: prev[key]?.effectiveTo ?? "",
        [field]: value,
      },
    }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      for (const [key, edits] of Object.entries(editedRows)) {
        const [productId, unitName] = key.split("__")
        const numPrice = parseInt(edits.price)
        if (isNaN(numPrice) || numPrice <= 0) continue

        const existingRow = rows.find(
          (r) => r.productId === productId && r.unitName === unitName
        )

        if (existingRow?.priceList) {
          // Update
          const updateData: Record<string, unknown> = { price: numPrice }
          if (edits.effectiveFrom) updateData.effective_from = edits.effectiveFrom
          if (edits.effectiveTo) updateData.effective_to = edits.effectiveTo || null

          const { error } = await supabase
            .from("price_lists")
            .update(updateData)
            .eq("id", existingRow.priceList.id)
          if (error) throw error
        } else {
          // Insert
          const { error } = await supabase.from("price_lists").insert({
            product_id: productId,
            group_id: isDefault ? null : groupId,
            unit_name: unitName,
            price: numPrice,
            effective_from: edits.effectiveFrom || new Date().toISOString().slice(0, 10),
            effective_to: edits.effectiveTo || null,
          })
          if (error) throw error
        }
      }

      toast({ title: "Đã lưu thay đổi" })
      setEditMode(false)
      setEditedRows({})
      fetchData()
    } catch (err) {
      toast({
        title: "Lỗi",
        description: (err as Error).message,
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const handleCopyDefaults = async () => {
    if (isDefault) return
    setCopyingDefaults(true)
    try {
      // Get all default prices
      const defaultPrices = priceLists.filter((pl) => pl.group_id === null)
      const existingGroupPrices = priceLists.filter(
        (pl) => pl.group_id === groupId
      )

      const inserts: {
        product_id: string
        group_id: string
        unit_name: string
        price: number
        effective_from: string
      }[] = []

      for (const dp of defaultPrices) {
        // Skip if there's already a group price for this product+unit
        const exists = existingGroupPrices.find(
          (gp) =>
            gp.product_id === dp.product_id && gp.unit_name === dp.unit_name
        )
        if (!exists) {
          inserts.push({
            product_id: dp.product_id,
            group_id: groupId,
            unit_name: dp.unit_name,
            price: dp.price,
            effective_from: new Date().toISOString().slice(0, 10),
          })
        }
      }

      if (inserts.length === 0) {
        toast({ title: "Tất cả sản phẩm đã có giá cho nhóm này" })
      } else {
        const { error } = await supabase.from("price_lists").insert(inserts)
        if (error) throw error
        toast({
          title: `Đã sao chép ${inserts.length} giá mặc định`,
        })
        fetchData()
      }
    } catch (err) {
      toast({
        title: "Lỗi",
        description: (err as Error).message,
        variant: "destructive",
      })
    } finally {
      setCopyingDefaults(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={groupName}
        description={`Bảng giá cho nhóm: ${groupName}`}
        backHref="/products/price-lists"
      >
        {canEdit && !isDefault && (
          <Button
            variant="outline"
            onClick={handleCopyDefaults}
            disabled={copyingDefaults}
          >
            <Copy className="mr-2 h-4 w-4" />{" "}
            {copyingDefaults ? "Đang sao chép..." : "Áp dụng giá mặc định"}
          </Button>
        )}
        {canEdit && !editMode && (
          <Button variant="outline" onClick={() => setEditMode(true)}>
            <Pencil className="mr-2 h-4 w-4" /> Chỉnh sửa giá
          </Button>
        )}
        {editMode && (
          <>
            <Button
              variant="outline"
              onClick={() => {
                setEditMode(false)
                setEditedRows({})
              }}
            >
              <X className="mr-2 h-4 w-4" /> Hủy
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />{" "}
              {saving ? "Đang lưu..." : "Lưu thay đổi"}
            </Button>
          </>
        )}
      </PageHeader>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-8 w-8 text-muted-foreground" />}
          title="Chưa có giá cho nhóm này"
          description={
            isDefault
              ? "Thêm giá mặc định cho sản phẩm trong trang chi tiết sản phẩm"
              : "Sao chép giá mặc định hoặc chỉnh sửa trực tiếp"
          }
        >
          {canEdit && !isDefault && (
            <Button onClick={handleCopyDefaults} disabled={copyingDefaults}>
              <Copy className="mr-2 h-4 w-4" /> Áp dụng giá mặc định
            </Button>
          )}
        </EmptyState>
      ) : (
        <div className="rounded-2xl border bg-card shadow-sm overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">STT</TableHead>
                <TableHead>Sản phẩm</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>ĐVT</TableHead>
                {!isDefault && (
                  <TableHead className="text-right">Giá mặc định</TableHead>
                )}
                <TableHead className="text-right">
                  {isDefault ? "Giá mặc định" : `Giá ${groupName}`}
                </TableHead>
                <TableHead>Từ ngày</TableHead>
                <TableHead>Đến ngày</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, idx) => {
                const key = rKey(row)
                return (
                  <TableRow key={key}>
                    <TableCell className="text-muted-foreground">
                      {idx + 1}
                    </TableCell>
                    <TableCell className="font-medium">
                      {row.productName}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.sku}</Badge>
                    </TableCell>
                    <TableCell>{row.unitName}</TableCell>

                    {!isDefault && (
                      <TableCell className="text-right text-muted-foreground">
                        {row.defaultPrice
                          ? formatCurrency(row.defaultPrice.price)
                          : "-"}
                      </TableCell>
                    )}

                    <TableCell className="text-right">
                      {editMode ? (
                        <Input
                          type="number"
                          min="0"
                          className="w-32 ml-auto text-right"
                          value={getEditValue(row, "price")}
                          onChange={(e) =>
                            handleEditField(key, "price", e.target.value)
                          }
                          placeholder="0"
                        />
                      ) : row.priceList ? (
                        <span className="font-medium">
                          {formatCurrency(row.priceList.price)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>

                    <TableCell>
                      {editMode ? (
                        <Input
                          type="date"
                          className="w-36"
                          value={getEditValue(row, "effectiveFrom")}
                          onChange={(e) =>
                            handleEditField(key, "effectiveFrom", e.target.value)
                          }
                        />
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {row.priceList?.effective_from || "-"}
                        </span>
                      )}
                    </TableCell>

                    <TableCell>
                      {editMode ? (
                        <Input
                          type="date"
                          className="w-36"
                          value={getEditValue(row, "effectiveTo")}
                          onChange={(e) =>
                            handleEditField(key, "effectiveTo", e.target.value)
                          }
                        />
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {row.priceList?.effective_to || "-"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
