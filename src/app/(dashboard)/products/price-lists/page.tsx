"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils"
import { Search, Pencil, Save, X, Plus, FileText } from "lucide-react"
import type { Product, PriceList } from "@/types"

interface PivotRow {
  productId: string
  productName: string
  sku: string
  unitName: string
  prices: Record<string, PriceList | undefined>
  effectiveRange: string
  isNew?: boolean
}

export default function PriceListsPage() {
  const { user, loading: authLoading } = useRoleGuard("products")
  const [products, setProducts] = useState<Product[]>([])
  const [priceLists, setPriceLists] = useState<PriceList[]>([])
  const { groups: customerGroups } = useCustomerGroups()
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filterGroup, setFilterGroup] = useState("all")
  const [editMode, setEditMode] = useState(false)
  const [editedPrices, setEditedPrices] = useState<
    Record<string, Record<string, string>>
  >({})
  const [saving, setSaving] = useState(false)
  const [addProductOpen, setAddProductOpen] = useState(false)
  const [addProductId, setAddProductId] = useState("")
  const router = useRouter()
  const supabase = createClient()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [productsRes, pricesRes] = await Promise.all([
      supabase
        .from("products")
        .select("*, units:product_units(*)")
        .order("name"),
      supabase
        .from("price_lists")
        .select("*, group:customer_groups(*)"),
    ])
    setProducts((productsRes.data as Product[]) || [])
    setPriceLists((pricesRes.data as PriceList[]) || [])
    setLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchData()
  }, [fetchData])

  if (authLoading) return <Skeleton className="h-96" />

  const canEdit =
    user &&
    (hasPermission(user.role, "products", "update") &&
      (user.role === "owner" || user.role === "manager"))

  // Build pivot rows: for each product x unit, show group prices side by side
  const buildPivotRows = (): PivotRow[] => {
    const rows: PivotRow[] = []
    const productsWithPrices = new Set(priceLists.map((pl) => pl.product_id))

    // Only show products that have at least one price entry
    const relevantProducts = products.filter(
      (p) =>
        productsWithPrices.has(p.id) &&
        (p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.sku.toLowerCase().includes(search.toLowerCase()))
    )

    for (const product of relevantProducts) {
      // Collect all unit names that have prices
      const productPrices = priceLists.filter(
        (pl) => pl.product_id === product.id
      )
      const unitNames = Array.from(new Set(productPrices.map((pl) => pl.unit_name)))

      for (const unitName of unitNames) {
        const unitPrices = productPrices.filter(
          (pl) => pl.unit_name === unitName
        )
        const priceMap: Record<string, PriceList | undefined> = {}

        // "default" key for null group_id
        priceMap["default"] = unitPrices.find((pl) => pl.group_id === null)
        for (const group of customerGroups) {
          priceMap[group.id] = unitPrices.find(
            (pl) => pl.group_id === group.id
          )
        }

        // Build effective range display
        const dates = unitPrices
          .map((pl) => pl.effective_from)
          .filter(Boolean)
        const effectiveRange =
          dates.length > 0 ? dates.sort()[0]! : "-"

        rows.push({
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          unitName,
          prices: priceMap,
          effectiveRange,
        })
      }
    }

    return rows
  }

  const pivotRows = buildPivotRows()

  // Filter by group: when a specific group is selected, still show all columns but highlight
  const filteredRows =
    filterGroup === "all"
      ? pivotRows
      : filterGroup === "default"
        ? pivotRows.filter((r) => r.prices["default"])
        : pivotRows.filter((r) => r.prices[filterGroup])

  const rowKey = (row: PivotRow) => `${row.productId}__${row.unitName}`

  const handleEditPrice = (
    rKey: string,
    groupKey: string,
    value: string
  ) => {
    setEditedPrices((prev) => ({
      ...prev,
      [rKey]: {
        ...(prev[rKey] || {}),
        [groupKey]: value,
      },
    }))
  }

  const getEditValue = (row: PivotRow, groupKey: string): string => {
    const rKey = rowKey(row)
    if (editedPrices[rKey]?.[groupKey] !== undefined) {
      return editedPrices[rKey][groupKey]
    }
    const pl = row.prices[groupKey]
    return pl ? String(pl.price) : ""
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const upserts: {
        product_id: string
        group_id: string | null
        unit_name: string
        price: number
        effective_from: string
      }[] = []

      for (const [rKey, groupEdits] of Object.entries(editedPrices)) {
        const [productId, unitName] = rKey.split("__")
        for (const [groupKey, val] of Object.entries(groupEdits)) {
          const numVal = parseInt(val)
          if (isNaN(numVal) || numVal <= 0) continue

          const existingRow = pivotRows.find(
            (r) => r.productId === productId && r.unitName === unitName
          )
          const existingPl =
            existingRow?.prices[groupKey]

          if (existingPl) {
            // Update existing
            const { error } = await supabase
              .from("price_lists")
              .update({ price: numVal })
              .eq("id", existingPl.id)
            if (error) throw error
          } else {
            // Insert new
            upserts.push({
              product_id: productId,
              group_id: groupKey === "default" ? null : groupKey,
              unit_name: unitName,
              price: numVal,
              effective_from: new Date().toISOString().slice(0, 10),
            })
          }
        }
      }

      if (upserts.length > 0) {
        const { error } = await supabase.from("price_lists").insert(upserts)
        if (error) throw error
      }

      toast({ title: "Đã lưu thay đổi bảng giá" })
      setEditMode(false)
      setEditedPrices({})
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

  const handleAddProduct = () => {
    if (!addProductId) return
    const product = products.find((p) => p.id === addProductId)
    if (!product) return

    // Check if the product already has prices
    const existing = pivotRows.find((r) => r.productId === addProductId)
    if (existing) {
      toast({
        title: "Sản phẩm đã có trong bảng giá",
        variant: "destructive",
      })
      return
    }

    // Add an empty price list entry so the product appears in the table
    // We'll insert a default price row with 0 to make it appear, then user edits
    const rKey = `${product.id}__${product.base_unit}`
    setEditedPrices((prev) => ({
      ...prev,
      [rKey]: { default: "" },
    }))

    // Temporarily add the product to priceLists so it shows up
    const tempPl: PriceList = {
      id: `temp_${product.id}`,
      product_id: product.id,
      group_id: null,
      unit_name: product.base_unit,
      price: 0,
      effective_from: null,
      effective_to: null,
    }
    setPriceLists((prev) => [...prev, tempPl])

    setAddProductOpen(false)
    setAddProductId("")
    if (!editMode) setEditMode(true)

    toast({ title: `Đã thêm ${product.name}. Nhập giá và lưu.` })
  }

  // Products not yet in the price list
  const productsNotInList = products.filter(
    (p) => !priceLists.some((pl) => pl.product_id === p.id)
  )

  return (
    <div className="space-y-4">
      <PageHeader title="Bảng giá bán hàng" backHref="/products">
        {canEdit && !editMode && (
          <Button
            variant="outline"
            onClick={() => setEditMode(true)}
          >
            <Pencil className="mr-2 h-4 w-4" /> Chỉnh sửa giá
          </Button>
        )}
        {editMode && (
          <>
            <Button
              variant="outline"
              onClick={() => {
                setEditMode(false)
                setEditedPrices({})
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

      {/* Filter Row */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={filterGroup} onValueChange={setFilterGroup}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Nhóm khách hàng" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả</SelectItem>
            <SelectItem value="default">Giá mặc định (chung)</SelectItem>
            {customerGroups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Tìm theo tên sản phẩm, SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {canEdit && (
          <div className="flex items-center gap-2 ml-auto">
            {addProductOpen ? (
              <>
                <Select
                  value={addProductId}
                  onValueChange={setAddProductId}
                >
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder="Chọn sản phẩm..." />
                  </SelectTrigger>
                  <SelectContent>
                    {productsNotInList.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={handleAddProduct}>
                  <Plus className="mr-1 h-4 w-4" /> Thêm
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAddProductOpen(false)
                    setAddProductId("")
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAddProductOpen(true)}
              >
                <Plus className="mr-1 h-4 w-4" /> Thêm sản phẩm vào bảng giá
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Group quick links */}
      <div className="flex flex-wrap gap-2">
        {customerGroups.map((g) => (
          <button
            key={g.id}
            onClick={() => router.push(`/products/price-lists/${g.id}`)}
            className="text-xs font-medium text-primary hover:underline"
          >
            Xem chi tiết: {g.name}
          </button>
        ))}
        <button
          onClick={() => router.push("/products/price-lists/default")}
          className="text-xs font-medium text-primary hover:underline"
        >
          Xem chi tiết: Giá mặc định
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : filteredRows.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-8 w-8 text-muted-foreground" />}
          title="Chưa có bảng giá"
          description="Thêm sản phẩm và thiết lập giá bán cho từng nhóm khách hàng"
        />
      ) : (
        <div className="rounded-2xl border bg-card shadow-sm overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">STT</TableHead>
                <TableHead>Sản phẩm</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>ĐVT</TableHead>
                <TableHead className="text-right">Giá mặc định</TableHead>
                {customerGroups.map((g) => (
                  <TableHead key={g.id} className="text-right">
                    Giá {g.name}
                  </TableHead>
                ))}
                <TableHead>Hiệu lực</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((row, idx) => {
                const rKey = rowKey(row)
                return (
                  <TableRow key={rKey}>
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

                    {/* Default price */}
                    <TableCell className="text-right">
                      {editMode ? (
                        <Input
                          type="number"
                          min="0"
                          className="w-28 ml-auto text-right"
                          value={getEditValue(row, "default")}
                          onChange={(e) =>
                            handleEditPrice(rKey, "default", e.target.value)
                          }
                          placeholder="0"
                        />
                      ) : row.prices["default"] ? (
                        <span className="font-medium">
                          {formatCurrency(row.prices["default"].price)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>

                    {/* Group prices */}
                    {customerGroups.map((g) => (
                      <TableCell key={g.id} className="text-right">
                        {editMode ? (
                          <Input
                            type="number"
                            min="0"
                            className="w-28 ml-auto text-right"
                            value={getEditValue(row, g.id)}
                            onChange={(e) =>
                              handleEditPrice(rKey, g.id, e.target.value)
                            }
                            placeholder="0"
                          />
                        ) : row.prices[g.id] ? (
                          <span className="font-medium">
                            {formatCurrency(row.prices[g.id]!.price)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    ))}

                    <TableCell className="text-sm text-muted-foreground">
                      {row.effectiveRange}
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
