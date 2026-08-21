"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { Plus, Trash2 } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import type { Supplier, Product, ProductUnit, WarehouseZone } from "@/types"

interface Line {
  id: string
  product_id: string
  product_name: string
  unit_name: string
  quantity: string
  unit_price: string
  vat_rate: string
  conversion_factor: string
  available_units: ProductUnit[]
  base_unit: string
}

function newLine(): Line {
  return {
    id: Math.random().toString(36).slice(2, 10),
    product_id: "",
    product_name: "",
    unit_name: "",
    quantity: "",
    unit_price: "",
    vat_rate: "0",
    conversion_factor: "1",
    available_units: [],
    base_unit: "",
  }
}

export default function NewPurchaseReturnPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const { user } = useAuth()
  const router = useRouter()
  const supabase = createClient()
  const { toast } = useToast()

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Array<Product & { units?: ProductUnit[] }>>([])
  const [supplierId, setSupplierId] = useState("")
  const [returnDate, setReturnDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [zone, setZone] = useState<WarehouseZone>("date")
  const [reason, setReason] = useState<string>("near_expiry")
  const [notes, setNotes] = useState("")
  const [lines, setLines] = useState<Line[]>([newLine()])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    async function fetch() {
      if (!user?.org_id) return
      const [supRes, prodRes] = await Promise.all([
        supabase
          .from("suppliers")
          .select("id, name, code")
          .eq("org_id", user.org_id)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("products")
          .select("id, name, sku, base_unit, cost_price, vat_rate, units:product_units(*)")
          .eq("org_id", user.org_id)
          .order("name"),
      ])
      const qErr = ([supRes, prodRes] as Array<{ error?: { message?: string } | null }>)
        .find((r) => r?.error)?.error
      if (qErr) console.error("[purchase-returns/new] truy vấn lỗi:", qErr.message)
      setSuppliers((supRes.data as Supplier[]) || [])
      setProducts((prodRes.data as Array<Product & { units?: ProductUnit[] }>) || [])
    }
    fetch()
  }, [user?.org_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => {
    let sub = 0, vatTotal = 0
    for (const l of lines) {
      const q = parseFloat(l.quantity) || 0
      const p = parseFloat(l.unit_price) || 0
      const vatRate = parseFloat(l.vat_rate) || 0
      const lineSub = q * p
      sub += lineSub
      vatTotal += lineSub * (vatRate / 100)
    }
    return { sub, vat: vatTotal, total: sub + vatTotal }
  }, [lines])

  const updateLine = (id: string, patch: Partial<Line>) => {
    setLines((arr) => arr.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  const pickProduct = (lineId: string, productId: string) => {
    const p = products.find((x) => x.id === productId)
    if (!p) return
    const units = p.units || []
    const baseUnit = p.base_unit
    // Default unit = base_unit (cf=1); user có thể đổi sang unit khác
    updateLine(lineId, {
      product_id: p.id,
      product_name: p.name,
      base_unit: baseUnit,
      available_units: units,
      unit_name: baseUnit,
      conversion_factor: "1",
      unit_price: p.cost_price ? String(p.cost_price) : "",
      vat_rate: p.vat_rate != null ? String(p.vat_rate) : "0",
    })
  }

  const pickUnit = (lineId: string, unitName: string) => {
    const line = lines.find((l) => l.id === lineId)
    if (!line) return
    if (unitName === line.base_unit) {
      updateLine(lineId, { unit_name: unitName, conversion_factor: "1" })
      return
    }
    const u = line.available_units.find((x) => x.unit_name === unitName)
    updateLine(lineId, {
      unit_name: unitName,
      conversion_factor: u ? String(u.conversion) : "1",
    })
  }

  const handleSubmit = async (asDraft: boolean) => {
    if (!user?.org_id) return
    if (!supplierId) {
      toast({ title: "Chưa chọn nhà cung cấp", variant: "destructive" })
      return
    }
    const validLines = lines.filter(
      (l) => l.product_id && parseFloat(l.quantity) > 0 && parseFloat(l.unit_price) >= 0
    )
    if (validLines.length === 0) {
      toast({ title: "Chưa có dòng hàng hợp lệ", variant: "destructive" })
      return
    }

    setSubmitting(true)
    try {
      const { data: header, error: hdrErr } = await supabase
        .from("supplier_returns")
        .insert({
          org_id: user.org_id,
          supplier_id: supplierId,
          return_date: returnDate,
          warehouse_zone: zone,
          reason: reason || null,
          notes: notes || null,
          subtotal: totals.sub,
          vat: totals.vat,
          total: totals.total,
          status: "draft",
          created_by: user.id,
        })
        .select()
        .single()
      if (hdrErr || !header) throw new Error(hdrErr?.message || "Tạo phiếu thất bại")
      const returnId = (header as { id: string }).id

      const linesPayload = validLines.map((l) => {
        const q = parseFloat(l.quantity)
        const p = parseFloat(l.unit_price)
        const vatRate = parseFloat(l.vat_rate) || 0
        const cf = parseFloat(l.conversion_factor) || 1
        return {
          return_id: returnId,
          product_id: l.product_id,
          unit_name: l.unit_name || l.base_unit,
          quantity: q,
          unit_price: p,
          vat_rate: vatRate,
          conversion_factor: cf,
          line_total: q * p * (1 + vatRate / 100),
        }
      })
      const { error: linesErr } = await supabase
        .from("supplier_return_lines")
        .insert(linesPayload)
      if (linesErr) throw new Error(linesErr.message)

      if (!asDraft) {
        const { error: rpcErr } = await supabase.rpc("complete_supplier_return", {
          p_return_id: returnId,
        })
        if (rpcErr) throw new Error(rpcErr.message)
      }

      toast({
        title: asDraft ? "Đã lưu phiếu nháp" : "Đã gửi phiếu — xuất kho + giảm công nợ NCC",
      })
      router.push(`/purchase-returns/${returnId}`)
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tạo phiếu trả NCC"
        description="Khi gửi phiếu hệ thống sẽ tự xuất kho và giảm công nợ NCC"
        backHref="/purchase-returns"
      />

      <Card>
        <CardHeader><CardTitle>Thông tin chung</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Nhà cung cấp *</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger><SelectValue placeholder="Chọn NCC" /></SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}{s.code ? ` (${s.code})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Ngày trả *</Label>
            <Input
              type="date"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Xuất từ kho *</Label>
            <Select value={zone} onValueChange={(v) => setZone(v as WarehouseZone)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="date">Kho hàng date (gần hạn) — mặc định</SelectItem>
                <SelectItem value="sale">Kho hàng bán</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Trừ kho theo FIFO (hạn cũ trước) trong zone đã chọn.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Lý do</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger><SelectValue placeholder="Lý do trả" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="near_expiry">Hàng gần hạn</SelectItem>
                <SelectItem value="expired">Hàng hết hạn</SelectItem>
                <SelectItem value="damaged">Hàng hư hỏng</SelectItem>
                <SelectItem value="wrong_item">Sai hàng</SelectItem>
                <SelectItem value="other">Khác</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Ghi chú</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ghi chú nội bộ..."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Chi tiết hàng trả</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setLines((a) => [...a, newLine()])}>
            <Plus className="h-4 w-4 mr-1.5" /> Thêm dòng
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {lines.map((l, i) => (
            <div key={l.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">Dòng {i + 1}</span>
                {lines.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setLines((a) => a.filter((x) => x.id !== l.id))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-12">
                <div className="sm:col-span-5 space-y-1">
                  <Label className="text-xs">Sản phẩm *</Label>
                  <Select value={l.product_id} onValueChange={(v) => pickProduct(l.id, v)}>
                    <SelectTrigger><SelectValue placeholder="Chọn sản phẩm" /></SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}{p.sku ? ` · ${p.sku}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2 space-y-1">
                  <Label className="text-xs">ĐVT *</Label>
                  <Select
                    value={l.unit_name}
                    onValueChange={(v) => pickUnit(l.id, v)}
                    disabled={!l.product_id}
                  >
                    <SelectTrigger><SelectValue placeholder="ĐVT" /></SelectTrigger>
                    <SelectContent>
                      {l.base_unit && (
                        <SelectItem value={l.base_unit}>{l.base_unit} (cơ sở)</SelectItem>
                      )}
                      {l.available_units
                        .filter((u) => u.unit_name !== l.base_unit)
                        .map((u) => (
                          <SelectItem key={u.id} value={u.unit_name}>
                            {u.unit_name} (×{u.conversion})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2 space-y-1">
                  <Label className="text-xs">Số lượng *</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={l.quantity}
                    onChange={(e) => updateLine(l.id, { quantity: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-3 space-y-1">
                  <Label className="text-xs">Đơn giá *</Label>
                  <Input
                    type="number"
                    min={0}
                    value={l.unit_price}
                    onChange={(e) => updateLine(l.id, { unit_price: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2 space-y-1">
                  <Label className="text-xs">VAT %</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    value={l.vat_rate}
                    onChange={(e) => updateLine(l.id, { vat_rate: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-10 text-right text-sm">
                  Thành tiền:{" "}
                  <span className="font-semibold tabular-nums">
                    {formatCurrency(
                      (parseFloat(l.quantity) || 0) *
                        (parseFloat(l.unit_price) || 0) *
                        (1 + (parseFloat(l.vat_rate) || 0) / 100)
                    )}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tổng hàng (chưa VAT)</span>
            <span className="tabular-nums">{formatCurrency(totals.sub)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">VAT</span>
            <span className="tabular-nums">{formatCurrency(totals.vat)}</span>
          </div>
          <div className="flex justify-between font-bold text-base pt-1 border-t">
            <span>Tổng cộng</span>
            <span className="text-primary tabular-nums">{formatCurrency(totals.total)}</span>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2 justify-end">
        <Button variant="outline" onClick={() => router.back()} disabled={submitting}>
          Hủy
        </Button>
        <Button variant="outline" onClick={() => handleSubmit(true)} disabled={submitting}>
          Lưu nháp
        </Button>
        <Button onClick={() => handleSubmit(false)} disabled={submitting}>
          {submitting ? "Đang gửi..." : "Gửi phiếu (xuất kho + giảm công nợ)"}
        </Button>
      </div>
    </div>
  )
}
