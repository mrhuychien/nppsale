"use client"

/**
 * BIỂU MẪU PHIẾU TRẢ HÀNG NCC — dùng chung cho màn tạo và màn sửa.
 *
 * ⚠ THEO ĐÚNG KHUÔN MÀN ĐẶT HÀNG (chủ nhà chốt 20/09/2026: "phiếu trả
 * hàng NCC làm theo form mẫu như tạo đơn hàng đi"). Khuôn đó là: chọn
 * đối tác bằng một ô GÕ ĐƯỢC, tìm hàng bằng MỘT ô tìm rồi chạm để thêm,
 * dòng hàng hiện ra đã có sẵn tên, và một thanh dính đáy luôn hiện tổng
 * tiền cùng nút đi tiếp.
 *
 * ⚠ BẢN CŨ BẮT CHỌN HÀNG TRONG MỘT `<Select>` LIỆT KÊ CẢ DANH MỤC — ở
 * TỪNG DÒNG. Với 1.700 mặt hàng thì mỗi dòng là một lần cuộn tay qua cả
 * kho, và mỗi dòng phải bấm "Thêm dòng" để lấy một thẻ TRỐNG trước đã.
 * Chính chủ nhà đã bác cách này một lần rồi cho ô chọn NCC ở phiếu nhập
 * kho ("làm như thông lệ" — xem `SearchSelect`); phiếu trả NCC là chỗ
 * duy nhất còn sót lại.
 *
 * ⚠ MỘT BIỂU MẪU, KHÔNG PHẢI HAI. Màn tạo và màn sửa trước đây là hai
 * bản sao chép gần như từng dòng. Giữ hai bản là sửa một phép tính ở
 * một bên rồi quên bên kia — và hai màn cho ra hai con số khác nhau cho
 * đúng cùng mấy dòng hàng.
 */

import { useMemo, useRef, useState } from "react"
import { Plus, Search, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchSelect, type SearchSelectOption } from "@/components/ui/search-select"
import { formatCurrency } from "@/lib/utils"
import type { Supplier, WarehouseZone } from "@/types"
import {
  lineFromProduct, lineTotalOf, returnTotals, searchReturnProducts, unitPatch,
  RETURN_REASONS,
  type ReturnLine, type ReturnProduct,
} from "@/lib/purchasing/return-form"

export interface PurchaseReturnFormValue {
  supplierId: string
  returnDate: string
  zone: WarehouseZone
  reason: string
  notes: string
  lines: ReturnLine[]
}

export function PurchaseReturnForm({
  suppliers,
  products,
  value,
  onChange,
  submitting,
  actions,
}: {
  suppliers: Supplier[]
  products: ReturnProduct[]
  value: PurchaseReturnFormValue
  onChange: (patch: Partial<PurchaseReturnFormValue>) => void
  submitting: boolean
  /** Các nút của thanh dính đáy — màn tạo và màn sửa đặt tên khác nhau. */
  actions: React.ReactNode
}) {
  const [term, setTerm] = useState("")
  const seqRef = useRef(0)

  const totals = useMemo(() => returnTotals(value.lines), [value.lines])

  const supplierOptions: SearchSelectOption[] = useMemo(
    () => suppliers.map((s) => ({ id: s.id, label: s.name, hint: s.code || null, keywords: s.code })),
    [suppliers]
  )

  const onSlip = useMemo(
    () => new Set(value.lines.map((l) => l.product_id).filter(Boolean)),
    [value.lines]
  )
  const hits = useMemo(
    () => searchReturnProducts(products, term, onSlip),
    [products, term, onSlip]
  )

  const setLines = (fn: (arr: ReturnLine[]) => ReturnLine[]) => onChange({ lines: fn(value.lines) })
  const patchLine = (id: string, patch: Partial<ReturnLine>) =>
    setLines((arr) => arr.map((l) => (l.id === id ? { ...l, ...patch } : l)))

  const addProduct = (p: ReturnProduct) => {
    seqRef.current += 1
    setLines((arr) => [...arr, lineFromProduct(p, seqRef.current)])
    /**
     * ⚠ XOÁ Ô TÌM SAU KHI THÊM — đúng như màn đặt hàng. Chữ cũ nằm lại
     *   là một bộ lọc không ai yêu cầu, che mất đúng thứ người ta sắp
     *   gõ cho dòng tiếp theo (xem `clearSearchMemory` ở `/sell`).
     */
    setTerm("")
  }

  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-base">Thông tin chung</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pr-supplier" className="text-xs uppercase tracking-wider text-muted-foreground">
              Nhà cung cấp *
            </Label>
            {/*
              ⚠ KHÔNG CHO GÕ TAY Ở ĐÂY, khác phiếu nhập kho. Phiếu trả
                ghi thẳng `supplier_id` và RPC giảm công nợ của đúng NCC
                đó; một cái tên gõ tay không có mã thì không có sổ nợ nào
                để giảm, và phiếu lưu xuống sẽ trượt khoá ngoại.
            */}
            <SearchSelect
              id="pr-supplier"
              options={supplierOptions}
              valueId={value.supplierId}
              onPick={(o) => onChange({ supplierId: o?.id ?? "" })}
              placeholder="Gõ tên hoặc mã NCC…"
              emptyHint="Không có NCC nào khớp. Thêm NCC ở mục Nhà cung cấp trước."
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pr-date" className="text-xs uppercase tracking-wider text-muted-foreground">
              Ngày trả *
            </Label>
            <Input
              id="pr-date"
              type="date"
              value={value.returnDate}
              onChange={(e) => onChange({ returnDate: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Xuất từ kho *</Label>
            <Select
              value={value.zone}
              onValueChange={(v) => onChange({ zone: v as WarehouseZone })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="date">Kho hàng date (gần hạn) — mặc định</SelectItem>
                <SelectItem value="sale">Kho hàng bán</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Trừ kho theo FIFO (hạn cũ trước) trong kho đã chọn.
            </p>
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Lý do</Label>
            <Select value={value.reason} onValueChange={(v) => onChange({ reason: v })}>
              <SelectTrigger><SelectValue placeholder="Lý do trả" /></SelectTrigger>
              <SelectContent>
                {RETURN_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="pr-notes" className="text-xs uppercase tracking-wider text-muted-foreground">
              Ghi chú
            </Label>
            <Textarea
              id="pr-notes"
              rows={2}
              value={value.notes}
              onChange={(e) => onChange({ notes: e.target.value })}
              placeholder="Ghi chú nội bộ…"
            />
          </div>
        </CardContent>
      </Card>

      {/* ---------------- Tìm hàng để thêm vào phiếu ---------------- */}
      <Card>
        <CardContent className="space-y-3 pt-5">
          <Label htmlFor="pr-find" className="text-xs uppercase tracking-wider text-muted-foreground">
            Thêm mặt hàng
          </Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="pr-find"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={products.length ? "Tên hàng, mã SKU hoặc mã vạch…" : "Đang nạp danh mục…"}
              disabled={products.length === 0}
              className="pl-8"
            />
          </div>
          {term.trim() !== "" && hits.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Không tìm thấy mã nào khớp, hoặc mã đó đã có trên phiếu.
            </p>
          )}
          {hits.length > 0 && (
            <ul className="divide-y rounded-xl border">
              {hits.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 p-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.sku || "—"} · {p.base_unit}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => addProduct(p)} disabled={submitting}>
                    <Plus className="mr-1 h-4 w-4" /> Thêm
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ---------------- Dòng hàng đã chọn ---------------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Hàng trả {value.lines.length > 0 && `(${value.lines.length} dòng)`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/*
            ⚠ PHIẾU RỖNG PHẢI NÓI VIỆC TIẾP THEO, không để trống. Màn cũ
              luôn mở sẵn một thẻ TRỐNG để "có cái mà nhìn"; thẻ trống đó
              lại đi thẳng vào phép đếm dòng và vào cả vòng lặp lưu.
          */}
          {value.lines.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Phiếu chưa có mặt hàng nào. Tìm ở ô trên rồi bấm Thêm.
            </p>
          ) : (
            value.lines.map((l) => (
              <div key={l.id} className="rounded-xl border p-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{l.product_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {l.sku || "—"} · {l.base_unit}
                    </div>
                  </div>
                  <Button
                    variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive"
                    onClick={() => setLines((arr) => arr.filter((x) => x.id !== l.id))}
                    title="Bỏ dòng này khỏi phiếu"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-12">
                  <div className="space-y-1 sm:col-span-3">
                    <Label className="text-xs">ĐVT *</Label>
                    <Select value={l.unit_name} onValueChange={(v) => patchLine(l.id, unitPatch(l, v))}>
                      <SelectTrigger><SelectValue placeholder="ĐVT" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={l.base_unit}>{l.base_unit} (cơ sở)</SelectItem>
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
                  <div className="space-y-1 sm:col-span-3">
                    <Label className="text-xs">Số lượng *</Label>
                    <Input
                      type="number" step="any" min={0} value={l.quantity}
                      onChange={(e) => patchLine(l.id, { quantity: e.target.value })}
                      className="text-right tabular-nums"
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-3">
                    <Label className="text-xs">Đơn giá *</Label>
                    <Input
                      type="number" step="any" min={0} value={l.unit_price}
                      onChange={(e) => patchLine(l.id, { unit_price: e.target.value })}
                      className="text-right tabular-nums"
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-3">
                    <Label className="text-xs">VAT %</Label>
                    <Input
                      type="number" step="any" min={0} max={100} value={l.vat_rate}
                      onChange={(e) => patchLine(l.id, { vat_rate: e.target.value })}
                      className="text-right tabular-nums"
                    />
                  </div>
                  <div className="text-right text-sm sm:col-span-12">
                    Thành tiền:{" "}
                    <span className="font-semibold tabular-nums">{formatCurrency(lineTotalOf(l))}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <dl className="ml-auto grid w-full max-w-xs gap-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Tiền hàng</dt>
          <dd className="tabular-nums">{formatCurrency(totals.sub)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Thuế GTGT</dt>
          <dd className="tabular-nums">{formatCurrency(totals.vat)}</dd>
        </div>
        <div className="flex justify-between border-t pt-1 font-semibold">
          <dt>Tổng cộng</dt>
          <dd className="tabular-nums">{formatCurrency(totals.total)}</dd>
        </div>
      </dl>

      {/*
        Thanh hành động dính đáy — đúng khuôn màn đặt hàng và màn xuất
        hàng: số dòng và tổng tiền luôn đọc được, nút đi tiếp luôn trong
        tầm ngón tay trên một biểu mẫu dài.
      */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 p-3 backdrop-blur lg:pl-[var(--sidebar-w,0px)]">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">{value.lines.length} dòng</div>
            <div className="truncate text-lg font-bold tabular-nums">
              {formatCurrency(totals.total)}
            </div>
          </div>
          {actions}
        </div>
      </div>
    </>
  )
}
