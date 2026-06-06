"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { ChevronDown, ChevronUp, ImagePlus, Plus, Trash2 } from "lucide-react"
import type { Product } from "@/types"

type Tab = "info" | "description" | "warranty"

interface ProductFormProps {
  product?: Product
  /** Compact mode hides large sections — used inside dialogs. */
  variant?: "full" | "compact"
  /** Called after a successful save. Receives the saved product. */
  onSaved?: (product: Product) => void
  /** Optional cancel handler (overrides the default router.back). */
  onCancel?: () => void
  /** Hide the action footer (parent renders its own). */
  hideFooter?: boolean
}

const VAT_OPTIONS = [
  { value: "0", label: "0%" },
  { value: "0.05", label: "5%" },
  { value: "0.08", label: "8%" },
  { value: "0.1", label: "10%" },
]

const WEIGHT_UNITS = [
  { value: "g", label: "g" },
  { value: "kg", label: "kg" },
  { value: "ml", label: "ml" },
  { value: "l", label: "l" },
]

const UNIT_SUGGESTIONS = ["lon", "chai", "gói", "thùng", "hộp", "kg", "túi", "cái"]

function genSku(): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.floor(Math.random() * 36 * 36)
    .toString(36)
    .toUpperCase()
    .padStart(2, "0")
  return `SP${ts.slice(-5)}${rand}`
}

export function ProductForm({
  product,
  variant = "full",
  onSaved,
  onCancel,
  hideFooter,
}: ProductFormProps) {
  const { user } = useAuth()
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const [tab, setTab] = useState<Tab>("info")
  const [loading, setLoading] = useState(false)
  const [saveAndAdd, setSaveAndAdd] = useState(false)
  const [openSection, setOpenSection] = useState<Record<string, boolean>>({
    price: true,
    stock: true,
    location: true,
  })

  const [form, setForm] = useState({
    sku: product?.sku || "",
    name: product?.name || "",
    category: product?.category || "",
    brand: product?.brand || "",
    barcode: product?.barcode || "",
    base_unit: product?.base_unit || "",
    vat_rate: product?.vat_rate?.toString() || "0.1",
    shelf_life_days: product?.shelf_life_days?.toString() || "",
    status: product?.status || "active",
    description: product?.description || "",
    warranty_info: product?.warranty_info || "",
    cost_price: (product?.cost_price ?? 0).toString(),
    sell_price: (product?.sell_price ?? 0).toString(),
    track_serial: product?.track_serial ?? false,
    min_stock: (product?.min_stock ?? 0).toString(),
    max_stock: (product?.max_stock ?? "").toString() || "999999999",
    shelf_location: product?.shelf_location || "",
    weight: (product?.weight ?? "").toString(),
    weight_unit: product?.weight_unit || "g",
    direct_sale: product?.direct_sale ?? true,
  })

  // Đơn vị quy đổi (secondary units). Mỗi dòng = 1 unit_name + conversion (số
  // lượng đơn vị cơ sở / 1 đơn vị này). VD baseUnit="lon", thêm "thùng" với
  // conversion=24 ⇒ 1 thùng = 24 lon. `id` là id db nếu đã tồn tại; tạm thời
  // null để báo "chưa lưu".
  const [secondaryUnits, setSecondaryUnits] = useState<
    { id: string | null; tempId: string; unit_name: string; conversion: string }[]
  >([])

  // Load secondary units khi sửa sản phẩm
  const productId = product?.id
  useEffect(() => {
    if (!productId) return
    let cancelled = false
    async function load() {
      const { data } = await supabase
        .from("product_units")
        .select("id, unit_name, conversion")
        .eq("product_id", productId!)
        .order("conversion", { ascending: false })
      if (cancelled) return
      const rows = ((data as { id: string; unit_name: string; conversion: number }[]) || []).map((u) => ({
        id: u.id,
        tempId: u.id,
        unit_name: u.unit_name,
        conversion: String(u.conversion),
      }))
      setSecondaryUnits(rows)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [productId, supabase])

  const addSecondaryUnit = () => {
    setSecondaryUnits((prev) => [
      ...prev,
      {
        id: null,
        tempId: `tmp-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
        unit_name: "",
        conversion: "",
      },
    ])
  }

  const setSecondaryUnit = (
    tempId: string,
    field: "unit_name" | "conversion",
    value: string
  ) => {
    setSecondaryUnits((prev) =>
      prev.map((u) => (u.tempId === tempId ? { ...u, [field]: value } : u))
    )
  }

  const removeSecondaryUnit = (tempId: string) => {
    setSecondaryUnits((prev) => prev.filter((u) => u.tempId !== tempId))
  }

  // Suggestion lists pulled from existing data so the user can pick or
  // type a brand-new value (KiotViet-style "Tạo mới" inline).
  const [categorySuggest, setCategorySuggest] = useState<string[]>([])
  const [brandSuggest, setBrandSuggest] = useState<string[]>([])
  const [showNewCategory, setShowNewCategory] = useState(false)
  const [showNewBrand, setShowNewBrand] = useState(false)

  const orgId = user?.org_id
  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    async function load() {
      const { data } = await supabase
        .from("products")
        .select("category, brand")
        .eq("org_id", orgId!)
      if (cancelled) return
      const cats = new Set<string>()
      const brands = new Set<string>()
      for (const p of (data as { category: string | null; brand: string | null }[]) || []) {
        if (p.category) cats.add(p.category)
        if (p.brand) brands.add(p.brand)
      }
      setCategorySuggest(Array.from(cats).sort())
      setBrandSuggest(Array.from(brands).sort())
    }
    load()
    return () => {
      cancelled = true
    }
  }, [orgId, supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user?.org_id) return

    if (!form.name.trim()) {
      toast({ title: "Vui lòng nhập tên hàng", variant: "destructive" })
      setTab("info")
      return
    }
    if (!form.base_unit.trim()) {
      toast({ title: "Vui lòng chọn đơn vị tính", variant: "destructive" })
      setTab("info")
      return
    }
    setLoading(true)
    try {
      const payload = {
        sku: form.sku.trim() || genSku(),
        name: form.name.trim(),
        category: form.category.trim() || null,
        brand: form.brand.trim() || null,
        barcode: form.barcode.trim() || null,
        base_unit: form.base_unit.trim(),
        vat_rate: parseFloat(form.vat_rate) || 0,
        shelf_life_days: form.shelf_life_days ? parseInt(form.shelf_life_days) : null,
        status: form.status,
        description: form.description.trim() || null,
        warranty_info: form.warranty_info.trim() || null,
        cost_price: parseFloat(form.cost_price) || 0,
        sell_price: parseFloat(form.sell_price) || 0,
        track_serial: !!form.track_serial,
        min_stock: parseFloat(form.min_stock) || 0,
        max_stock: form.max_stock ? parseFloat(form.max_stock) : null,
        shelf_location: form.shelf_location.trim() || null,
        weight: form.weight ? parseFloat(form.weight) : null,
        weight_unit: form.weight_unit,
        direct_sale: !!form.direct_sale,
      }

      let saved: Product
      if (product) {
        const { data, error } = await supabase
          .from("products")
          .update(payload)
          .eq("id", product.id)
          .select("*")
          .single()
        if (error) throw error
        saved = data as Product
        toast({ title: "Đã cập nhật sản phẩm" })
      } else {
        const { data, error } = await supabase
          .from("products")
          .insert({ ...payload, org_id: user.org_id })
          .select("*")
          .single()
        if (error) throw error
        saved = data as Product
        toast({ title: "Đã tạo sản phẩm mới" })
      }

      // ----- Đồng bộ đơn vị quy đổi (product_units) -----
      // Lọc dòng hợp lệ: phải có tên + conversion > 0
      const validUnits = secondaryUnits
        .map((u) => ({
          ...u,
          conversion: parseFloat(u.conversion) || 0,
          unit_name: u.unit_name.trim(),
        }))
        .filter(
          (u) =>
            u.unit_name &&
            u.conversion > 0 &&
            // Cấm trùng tên với đơn vị cơ sở
            u.unit_name.toLowerCase() !== payload.base_unit.toLowerCase()
        )

      if (product) {
        // Update flow: tính diff để insert / update / delete
        const incomingIds = new Set(validUnits.filter((u) => u.id).map((u) => u.id))
        // Xóa những đơn vị không còn trong list
        const { data: existing } = await supabase
          .from("product_units")
          .select("id")
          .eq("product_id", saved.id)
        const removeIds = ((existing as { id: string }[]) || [])
          .map((r) => r.id)
          .filter((id) => !incomingIds.has(id))
        if (removeIds.length > 0) {
          await supabase.from("product_units").delete().in("id", removeIds)
        }
        // Update các dòng có id, insert các dòng chưa có id
        for (const u of validUnits) {
          if (u.id) {
            await supabase
              .from("product_units")
              .update({ unit_name: u.unit_name, conversion: u.conversion })
              .eq("id", u.id)
          } else {
            await supabase.from("product_units").insert({
              product_id: saved.id,
              unit_name: u.unit_name,
              conversion: u.conversion,
            })
          }
        }
      } else if (validUnits.length > 0) {
        // Create flow: bulk insert
        await supabase.from("product_units").insert(
          validUnits.map((u) => ({
            product_id: saved.id,
            unit_name: u.unit_name,
            conversion: u.conversion,
          }))
        )
      }

      if (onSaved) {
        onSaved(saved)
        if (saveAndAdd && !product) {
          // Reset form for next entry but keep section toggles.
          setForm((prev) => ({
            ...prev,
            sku: "",
            name: "",
            barcode: "",
            cost_price: "0",
            sell_price: "0",
            shelf_life_days: "",
            description: "",
            warranty_info: "",
          }))
          setTab("info")
        }
      } else {
        router.push(saveAndAdd && !product ? "/products/new" : "/products")
        router.refresh()
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Có lỗi xảy ra"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  const toggleSection = (key: string) =>
    setOpenSection((prev) => ({ ...prev, [key]: !prev[key] }))

  const isEdit = !!product

  const TABS: { key: Tab; label: string }[] = [
    { key: "info", label: "Thông tin" },
    { key: "description", label: "Mô tả" },
    { key: "warranty", label: "Bảo hành, bảo trì" },
  ]

  const compact = variant === "compact"

  const containerClass = compact
    ? "space-y-4"
    : "rounded-xl border border-border/40 bg-card p-5 shadow-sm space-y-5"

  return (
    <form onSubmit={handleSubmit} className={containerClass}>
      {/* Tabs */}
      <div className="flex gap-1 border-b border-border/40">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium -mb-px",
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "info" ? (
        <InfoTab
          form={form}
          setForm={setForm}
          categorySuggest={categorySuggest}
          brandSuggest={brandSuggest}
          showNewCategory={showNewCategory}
          setShowNewCategory={setShowNewCategory}
          showNewBrand={showNewBrand}
          setShowNewBrand={setShowNewBrand}
          openSection={openSection}
          toggleSection={toggleSection}
          compact={compact}
          secondaryUnits={secondaryUnits}
          addSecondaryUnit={addSecondaryUnit}
          setSecondaryUnit={setSecondaryUnit}
          removeSecondaryUnit={removeSecondaryUnit}
        />
      ) : tab === "description" ? (
        <div className="space-y-2">
          <Label htmlFor="description">Mô tả sản phẩm</Label>
          <Textarea
            id="description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={8}
            placeholder="Mô tả ngắn gọn về sản phẩm, thành phần, đối tượng sử dụng..."
          />
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="warranty">Thông tin bảo hành, bảo trì</Label>
          <Textarea
            id="warranty"
            value={form.warranty_info}
            onChange={(e) => setForm({ ...form, warranty_info: e.target.value })}
            rows={8}
            placeholder="Thời hạn bảo hành, điều kiện đổi trả..."
          />
        </div>
      )}

      {/* Footer */}
      {hideFooter ? null : (
        <div className="flex flex-col-reverse gap-3 border-t border-border/40 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.direct_sale}
              onChange={(e) => setForm({ ...form, direct_sale: e.target.checked })}
              className="h-4 w-4 rounded border-border/60 accent-primary"
            />
            <span>Bán trực tiếp</span>
          </label>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => (onCancel ? onCancel() : router.back())}
              disabled={loading}
            >
              Bỏ qua
            </Button>
            {!isEdit ? (
              <Button
                type="submit"
                variant="outline"
                onClick={() => setSaveAndAdd(true)}
                disabled={loading}
              >
                Lưu &amp; Tạo thêm hàng
              </Button>
            ) : null}
            <Button
              type="submit"
              onClick={() => setSaveAndAdd(false)}
              disabled={loading}
            >
              {loading ? "Đang lưu..." : "Lưu"}
            </Button>
          </div>
        </div>
      )}
    </form>
  )
}

type FormState = {
  sku: string
  name: string
  category: string
  brand: string
  barcode: string
  base_unit: string
  vat_rate: string
  shelf_life_days: string
  status: string
  description: string
  warranty_info: string
  cost_price: string
  sell_price: string
  track_serial: boolean
  min_stock: string
  max_stock: string
  shelf_location: string
  weight: string
  weight_unit: string
  direct_sale: boolean
}

interface SecondaryUnit {
  id: string | null
  tempId: string
  unit_name: string
  conversion: string
}

interface InfoTabProps {
  form: FormState
  setForm: React.Dispatch<React.SetStateAction<FormState>>
  categorySuggest: string[]
  brandSuggest: string[]
  showNewCategory: boolean
  setShowNewCategory: (v: boolean) => void
  showNewBrand: boolean
  setShowNewBrand: (v: boolean) => void
  openSection: Record<string, boolean>
  toggleSection: (key: string) => void
  compact: boolean
  secondaryUnits: SecondaryUnit[]
  addSecondaryUnit: () => void
  setSecondaryUnit: (
    tempId: string,
    field: "unit_name" | "conversion",
    value: string
  ) => void
  removeSecondaryUnit: (tempId: string) => void
}

function InfoTab({
  form,
  setForm,
  categorySuggest,
  brandSuggest,
  showNewCategory,
  setShowNewCategory,
  showNewBrand,
  setShowNewBrand,
  openSection,
  toggleSection,
  compact,
  secondaryUnits,
  addSecondaryUnit,
  setSecondaryUnit,
  removeSecondaryUnit,
}: InfoTabProps) {
  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm({ ...form, [key]: value })
  const skuVal = form.sku

  const placeholderImages = useMemo(() => Array.from({ length: 4 }, (_, i) => i), [])

  return (
    <div className="space-y-4">
      {/* Top: code/barcode + name + category/brand + image */}
      <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sku">Mã hàng</Label>
              <Input
                id="sku"
                value={skuVal}
                onChange={(e) => setField("sku", e.target.value)}
                placeholder="Tự động"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="barcode">Mã vạch</Label>
              <Input
                id="barcode"
                value={String(form.barcode || "")}
                onChange={(e) => setField("barcode", e.target.value)}
                placeholder="Nhập mã vạch"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="name">
              Tên hàng <span className="text-error">*</span>
            </Label>
            <Input
              id="name"
              value={String(form.name || "")}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="Bắt buộc"
              required
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Nhóm hàng</Label>
                <button
                  type="button"
                  onClick={() => setShowNewCategory(!showNewCategory)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  {showNewCategory ? "Chọn từ danh sách" : "Tạo mới"}
                </button>
              </div>
              {showNewCategory ? (
                <Input
                  value={String(form.category || "")}
                  onChange={(e) => setField("category", e.target.value)}
                  placeholder="VD: Bánh kẹo"
                  autoFocus
                />
              ) : (
                <Select
                  value={String(form.category || "")}
                  onValueChange={(v) => setField("category", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Chọn nhóm hàng" />
                  </SelectTrigger>
                  <SelectContent>
                    {categorySuggest.length === 0 ? (
                      <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                        Chưa có nhóm hàng — bấm &quot;Tạo mới&quot;
                      </div>
                    ) : (
                      categorySuggest.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Thương hiệu</Label>
                <button
                  type="button"
                  onClick={() => setShowNewBrand(!showNewBrand)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  {showNewBrand ? "Chọn từ danh sách" : "Tạo mới"}
                </button>
              </div>
              {showNewBrand ? (
                <Input
                  value={String(form.brand || "")}
                  onChange={(e) => setField("brand", e.target.value)}
                  placeholder="VD: Coca Cola"
                  autoFocus
                />
              ) : (
                <Select
                  value={String(form.brand || "")}
                  onValueChange={(v) => setField("brand", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Chọn thương hiệu" />
                  </SelectTrigger>
                  <SelectContent>
                    {brandSuggest.length === 0 ? (
                      <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                        Chưa có thương hiệu — bấm &quot;Tạo mới&quot;
                      </div>
                    ) : (
                      brandSuggest.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </div>

        {/* Image gallery placeholder */}
        <div className="space-y-2">
          <div className="flex h-44 items-center justify-center rounded-lg border-2 border-dashed border-border/60 bg-muted/30 text-center">
            <div>
              <ImagePlus className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-1 text-sm font-medium">Thêm ảnh</p>
              <p className="text-[11px] text-muted-foreground">Mỗi ảnh không quá 2 MB</p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {placeholderImages.map((i) => (
              <div
                key={i}
                className="flex aspect-square items-center justify-center rounded-md border border-dashed border-border/60 bg-muted/20 text-muted-foreground/60"
              >
                <ImagePlus className="h-3.5 w-3.5" />
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Chức năng tải ảnh sẽ sớm có mặt — hiện tại bạn có thể dán URL vào trường Mô tả.
          </p>
        </div>
      </div>

      {/* Section: Giá vốn, giá bán */}
      <Section
        title="Giá vốn, giá bán"
        open={openSection.price}
        onToggle={() => toggleSection("price")}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="cost">Giá vốn</Label>
            <Input
              id="cost"
              type="number"
              min={0}
              step="any"
              value={String(form.cost_price)}
              onChange={(e) => setField("cost_price", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sell">Giá bán</Label>
            <Input
              id="sell"
              type="number"
              min={0}
              step="any"
              value={String(form.sell_price)}
              onChange={(e) => setField("sell_price", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vat">Thuế VAT</Label>
            <Select
              value={String(form.vat_rate)}
              onValueChange={(v) => setField("vat_rate", v)}
            >
              <SelectTrigger id="vat">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VAT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Section>

      {/* Section: Tồn kho */}
      <Section
        title="Tồn kho"
        description="Quản lý số lượng tồn kho và định mức tồn. Khi tồn kho chạm đến định mức, bạn sẽ nhận được cảnh báo."
        open={openSection.stock}
        onToggle={() => toggleSection("stock")}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Quản lý theo serial / IMEI</Label>
            <Select
              value={form.track_serial ? "yes" : "no"}
              onValueChange={(v) => setField("track_serial", v === "yes")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no">Không</SelectItem>
                <SelectItem value="yes">Có</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="base_unit">
              Đơn vị tính <span className="text-error">*</span>
            </Label>
            <Input
              id="base_unit"
              list="unit-suggestions"
              value={String(form.base_unit || "")}
              onChange={(e) => setField("base_unit", e.target.value)}
              placeholder="VD: lon, chai, gói"
              required
            />
            <datalist id="unit-suggestions">
              {UNIT_SUGGESTIONS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="min_stock">Định mức tồn thấp nhất</Label>
            <Input
              id="min_stock"
              type="number"
              min={0}
              step="any"
              value={String(form.min_stock)}
              onChange={(e) => setField("min_stock", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="max_stock">Định mức tồn cao nhất</Label>
            <Input
              id="max_stock"
              type="number"
              min={0}
              step="any"
              value={String(form.max_stock)}
              onChange={(e) => setField("max_stock", e.target.value)}
            />
          </div>
        </div>

        {/* Đơn vị quy đổi (thùng, lốc, …) — gắn ngay cạnh Đơn vị tính cơ sở */}
        <div className="mt-4 rounded-md border border-dashed border-border/60 bg-muted/20 p-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Đơn vị quy đổi</p>
              <p className="text-[11px] text-muted-foreground">
                Thêm các đơn vị bán khác (thùng, lốc, hộp…) cùng số lượng quy đổi sang
                đơn vị cơ sở{form.base_unit ? ` "${form.base_unit}"` : ""}.
              </p>
            </div>
            <button
              type="button"
              onClick={addSecondaryUnit}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-2.5 py-1 text-xs font-semibold hover:bg-muted/40"
            >
              <Plus className="h-3 w-3" /> Thêm đơn vị
            </button>
          </div>

          {secondaryUnits.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Chưa có đơn vị quy đổi. Bấm <span className="font-medium">&quot;Thêm đơn vị&quot;</span>{" "}
              để khai báo (vd. 1 thùng = 24 lon).
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {secondaryUnits.map((u) => {
                const conversionNum = parseFloat(u.conversion) || 0
                return (
                  <div
                    key={u.tempId}
                    className="grid grid-cols-[1fr_140px_auto] items-center gap-2"
                  >
                    <Input
                      value={u.unit_name}
                      onChange={(e) =>
                        setSecondaryUnit(u.tempId, "unit_name", e.target.value)
                      }
                      placeholder="VD: thùng"
                      className="h-9"
                    />
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">=</span>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={u.conversion}
                        onChange={(e) =>
                          setSecondaryUnit(u.tempId, "conversion", e.target.value)
                        }
                        placeholder="24"
                        className="h-9 text-right tabular-nums"
                      />
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {form.base_unit || "ĐV cơ sở"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSecondaryUnit(u.tempId)}
                      className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title="Xóa đơn vị"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <p className="col-span-3 -mt-1 text-[11px] text-muted-foreground">
                      {u.unit_name && conversionNum > 0
                        ? `1 ${u.unit_name} = ${conversionNum} ${form.base_unit || "ĐV cơ sở"}`
                        : "Nhập đầy đủ tên + số quy đổi"}
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </Section>

      {/* Section: Vị trí, trọng lượng */}
      {compact ? null : (
        <Section
          title="Vị trí, trọng lượng"
          description="Quản lý việc sắp xếp kho, vị trí bán hàng hoặc trọng lượng hàng hóa."
          open={openSection.location}
          onToggle={() => toggleSection("location")}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="loc">Vị trí</Label>
              <Input
                id="loc"
                value={String(form.shelf_location || "")}
                onChange={(e) => setField("shelf_location", e.target.value)}
                placeholder="VD: A1-Tầng 2-Kệ 3"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="weight">Trọng lượng</Label>
              <div className="flex gap-2">
                <Input
                  id="weight"
                  type="number"
                  min={0}
                  step="any"
                  value={String(form.weight || "")}
                  onChange={(e) => setField("weight", e.target.value)}
                  placeholder="0"
                />
                <Select
                  value={String(form.weight_unit)}
                  onValueChange={(v) => setField("weight_unit", v)}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEIGHT_UNITS.map((u) => (
                      <SelectItem key={u.value} value={u.value}>
                        {u.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shelf_life">Hạn sử dụng (ngày)</Label>
              <Input
                id="shelf_life"
                type="number"
                min={0}
                value={String(form.shelf_life_days || "")}
                onChange={(e) => setField("shelf_life_days", e.target.value)}
                placeholder="VD: 365"
              />
            </div>
          </div>
        </Section>
      )}

      {/* Status (always visible, simple row) */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Trạng thái</Label>
          <Select
            value={String(form.status)}
            onValueChange={(v) => setField("status", v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Đang bán</SelectItem>
              <SelectItem value="inactive">Ngừng bán</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}

function Section({
  title,
  description,
  open,
  onToggle,
  children,
}: {
  title: string
  description?: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open ? <div className="border-t border-border/40 px-4 py-4">{children}</div> : null}
    </div>
  )
}

// Re-export Plus icon used in sibling components if needed.
export { Plus as ProductFormPlusIcon }
