"use client"

/**
 * BIỂU MẪU PHIẾU NHẬP HÀNG — dùng chung cho màn tạo và màn sửa.
 *
 * ⚠ THEO ĐÚNG KHUÔN MÀN ĐẶT HÀNG (chủ nhà chốt 20/09/2026: "giao diện
 * làm đơn giống làm đơn hàng đi"). Khuôn đó là: chọn đối tác bằng ô gõ
 * được, tìm hàng bằng MỘT ô tìm rồi chạm để thêm, và một thanh dính đáy
 * luôn hiện tổng tiền cùng nút đi tiếp — giống hệt phiếu trả NCC đã làm
 * ở bước trước.
 *
 * ⚠ CỘT CỦA BẢNG HÀNG DO CHỦ NHÀ CHỐT: STT · Mã hàng · Tên hàng · ghi
 * chú · ĐVT · Số lượng · Đơn giá · giảm giá · thành tiền. Không tự thêm
 * cột nào nữa vào bảng chính — mọi thứ khác đi vào modal chi tiết
 * ("thông tin sản phẩm hiển thị đơn giản, cần nhiều thông tin hơn thì
 * bấm vào ra modal").
 *
 * ⚠ TIỀN Ở ĐÂY CHỈ ĐỂ XEM TRƯỚC. `complete_purchase_invoice` tính lại
 * từ dòng hàng và ghi số của NÓ vào công nợ NCC. Xem
 * `@/lib/purchasing/receipt-form`.
 */

import { useMemo, useRef, useState } from "react"
import { Info, Plus, Search, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MoneyInput } from "@/components/ui/money-input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { SearchSelect, type SearchSelectOption } from "@/components/ui/search-select"
import { formatCurrency } from "@/lib/utils"
import { ratioToPercent, searchReturnProducts } from "@/lib/purchasing/return-form"
import {
  lineTotalOf, receiptTotals, unitCostOf, RECEIPT_ZONES,
  type ReceiptLine, type ReceiptProduct,
} from "@/lib/purchasing/receipt-form"
import type { Supplier } from "@/types"

export interface PurchaseReceiptFormValue {
  supplierId: string
  invoiceNumber: string
  invoiceDate: string
  zone: string
  /** Giảm giá đầu phiếu — trừ SAU thuế (chủ nhà chốt). */
  discount: string
  notes: string
  lines: ReceiptLine[]
}

/** Dòng mới từ một mặt hàng vừa chọn. */
function lineFromProduct(p: ReceiptProduct, seq: number): ReceiptLine {
  return {
    id: `${p.id}-${seq}`,
    product_id: p.id,
    product_name: p.name,
    sku: p.sku ?? "",
    note: "",
    base_unit: p.base_unit,
    available_units: p.units ?? [],
    unit_name: p.base_unit,
    conversion_factor: "1",
    /* ⚠ SỐ LƯỢNG ĐỂ TRỐNG. Điền sẵn 1 là để một con số KHÔNG AI GÕ có
       cơ hội đi thẳng vào phiếu — và phiếu nhập thì cộng kho thật. */
    quantity: "",
    unit_price: p.cost_price ? String(p.cost_price) : "",
    line_discount: "",
    /* ⚠ `products.vat_rate` là TỈ LỆ, ô này là PHẦN TRĂM — quy đổi bằng
       đúng hàm của cả module (xem migration 141). */
    vat_percent: p.vat_rate != null ? ratioToPercent(p.vat_rate) : "0",
  }
}

export function PurchaseReceiptForm({
  suppliers,
  products,
  value,
  onChange,
  submitting,
  actions,
}: {
  suppliers: Supplier[]
  products: ReceiptProduct[]
  value: PurchaseReceiptFormValue
  onChange: (patch: Partial<PurchaseReceiptFormValue>) => void
  submitting: boolean
  actions: React.ReactNode
}) {
  const [term, setTerm] = useState("")
  /** Dòng đang mở modal chi tiết. */
  const [detailId, setDetailId] = useState<string | null>(null)
  const seqRef = useRef(0)

  const totals = useMemo(
    () => receiptTotals(value.lines, value.discount),
    [value.lines, value.discount]
  )

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

  const setLines = (fn: (a: ReceiptLine[]) => ReceiptLine[]) => onChange({ lines: fn(value.lines) })
  const patchLine = (id: string, patch: Partial<ReceiptLine>) =>
    setLines((a) => a.map((l) => (l.id === id ? { ...l, ...patch } : l)))

  const addProduct = (p: ReceiptProduct) => {
    seqRef.current += 1
    setLines((a) => [...a, lineFromProduct(p, seqRef.current)])
    // Thêm xong xoá ô tìm — chữ cũ là bộ lọc không ai yêu cầu, che mất
    // đúng thứ người ta sắp gõ cho dòng tiếp theo.
    setTerm("")
  }

  /** Đổi đơn vị kéo theo hệ số quy đổi. */
  const pickUnit = (l: ReceiptLine, unitName: string) => {
    if (unitName === l.base_unit) {
      patchLine(l.id, { unit_name: unitName, conversion_factor: "1" })
      return
    }
    const u = l.available_units.find((x) => x.unit_name === unitName)
    patchLine(l.id, { unit_name: unitName, conversion_factor: u ? String(u.conversion) : "1" })
  }

  const detail = value.lines.find((l) => l.id === detailId) ?? null

  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-base">Thông tin chung</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pr-supplier" className="text-xs uppercase tracking-wider text-muted-foreground">
              Nhà cung cấp *
            </Label>
            {/* ⚠ KHÔNG CHO GÕ TAY. Phiếu ghi thẳng `supplier_id` và RPC
                ghi công nợ cho đúng NCC đó; một cái tên gõ tay không có
                mã thì không có sổ nợ nào để ghi vào. */}
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
            <Label htmlFor="pr-invno" className="text-xs uppercase tracking-wider text-muted-foreground">
              Số hoá đơn đầu vào
            </Label>
            {/* ⚠ ĐÂY LÀ SỐ CỦA NCC, KHÔNG PHẢI MÃ PHIẾU CỦA MÌNH. Mã
                phiếu (PN-xxxx) do máy chủ cấp lúc hoàn thành. */}
            <Input
              id="pr-invno"
              value={value.invoiceNumber}
              onChange={(e) => onChange({ invoiceNumber: e.target.value })}
              placeholder="Số trên hoá đơn NCC đưa"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pr-date" className="text-xs uppercase tracking-wider text-muted-foreground">
              Ngày nhập *
            </Label>
            <Input
              id="pr-date" type="date" value={value.invoiceDate}
              onChange={(e) => onChange({ invoiceDate: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Kho đích *</Label>
            <Select value={value.zone} onValueChange={(v) => onChange({ zone: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RECEIPT_ZONES.map((z) => (
                  <SelectItem key={z.value} value={z.value}>{z.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* ⚠ Từ mig 138, CHỈ kho hàng bán mới bán ra được. Nhập nhầm
                vào kho cận date là hàng nằm đó không ai bán được. */}
            <p className="text-[11px] text-muted-foreground">
              Chỉ hàng trong kho bán mới xuất bán được.
            </p>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="pr-notes" className="text-xs uppercase tracking-wider text-muted-foreground">
              Ghi chú
            </Label>
            <Textarea
              id="pr-notes" rows={2} value={value.notes}
              onChange={(e) => onChange({ notes: e.target.value })}
              placeholder="Ghi chú nội bộ…"
            />
          </div>
        </CardContent>
      </Card>

      {/* ---------------- Tìm hàng để thêm ---------------- */}
      <Card>
        <CardContent className="space-y-3 pt-5">
          <Label htmlFor="pr-find" className="text-xs uppercase tracking-wider text-muted-foreground">
            Thêm mặt hàng
          </Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="pr-find" value={term} onChange={(e) => setTerm(e.target.value)}
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
                    <div className="text-xs text-muted-foreground">{p.sku || "—"} · {p.base_unit}</div>
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

      {/* ---------------- Bảng hàng ---------------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Chi tiết hàng nhập {value.lines.length > 0 && `(${value.lines.length} dòng)`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:px-6 sm:pb-6">
          {value.lines.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Phiếu chưa có mặt hàng nào. Tìm ở ô trên rồi bấm Thêm.
            </p>
          ) : (
            <>
              {/*
                ⚠ BẢNG CHÍN CỘT KHÔNG VỪA MÀN 375px. Trên điện thoại vẽ
                  danh sách thẻ; bảng chỉ hiện từ lg trở lên. Ép cả chín
                  cột vào màn hẹp là người dùng cuộn ngang để gõ một ô số
                  lượng.
              */}
              <div className="hidden overflow-x-auto rounded-xl border bg-card lg:block">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="w-10 px-2 py-2 text-left">STT</th>
                      <th className="w-28 px-2 py-2 text-left">Mã hàng</th>
                      <th className="px-2 py-2 text-left">Tên hàng</th>
                      <th className="w-40 px-2 py-2 text-left">Ghi chú</th>
                      <th className="w-28 px-2 py-2 text-left">ĐVT</th>
                      <th className="w-24 px-2 py-2 text-right">Số lượng</th>
                      <th className="w-32 px-2 py-2 text-right">Đơn giá</th>
                      <th className="w-28 px-2 py-2 text-right">Giảm giá</th>
                      <th className="w-32 px-2 py-2 text-right">Thành tiền</th>
                      <th className="w-10 px-1 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {value.lines.map((l, i) => (
                      <tr key={l.id} className="border-t align-top">
                        <td className="px-2 py-2 tabular-nums text-muted-foreground">{i + 1}</td>
                        <td className="px-2 py-2 font-mono text-xs">{l.sku || "—"}</td>
                        <td className="px-2 py-2">
                          {/* ⚠ TÊN HÀNG LÀ CỬA VÀO MODAL CHI TIẾT (chủ nhà
                              chốt). Bảng chính giữ đúng chín cột; mọi thứ
                              khác — hệ số quy đổi, VAT, giá vốn quy đổi —
                              nằm sau cú bấm này. */}
                          <button
                            type="button"
                            onClick={() => setDetailId(l.id)}
                            className="flex items-start gap-1 text-left font-medium hover:text-primary hover:underline"
                          >
                            <span className="min-w-0">{l.product_name}</span>
                            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-50" />
                          </button>
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            value={l.note}
                            onChange={(e) => patchLine(l.id, { note: e.target.value })}
                            placeholder="—"
                            className="h-9"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Select value={l.unit_name} onValueChange={(v) => pickUnit(l, v)}>
                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
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
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            type="number" step="any" min={0} value={l.quantity}
                            onChange={(e) => patchLine(l.id, { quantity: e.target.value })}
                            className="h-9 text-right tabular-nums"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <MoneyInput
                            value={l.unit_price}
                            onChange={(v) => patchLine(l.id, { unit_price: String(v) })}
                            showSuffix={false}
                            inputClassName="h-9 text-right tabular-nums"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <MoneyInput
                            value={l.line_discount}
                            onChange={(v) => patchLine(l.id, { line_discount: String(v) })}
                            showSuffix={false}
                            inputClassName="h-9 text-right tabular-nums"
                          />
                        </td>
                        <td className="px-2 py-2 text-right font-semibold tabular-nums">
                          {formatCurrency(lineTotalOf(l))}
                        </td>
                        <td className="px-1 py-2">
                          <Button
                            variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                            onClick={() => setLines((a) => a.filter((x) => x.id !== l.id))}
                            title="Bỏ dòng này khỏi phiếu"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Bản điện thoại — cùng đủ chín ô, xếp dọc. */}
              <div className="space-y-3 px-3 pb-3 lg:hidden">
                {value.lines.map((l, i) => (
                  <div key={l.id} className="rounded-xl border p-3">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setDetailId(l.id)}
                        className="flex min-w-0 items-start gap-1 text-left"
                      >
                        <span className="min-w-0">
                          <span className="block text-xs text-muted-foreground">
                            {i + 1}. {l.sku || "—"}
                          </span>
                          <span className="block text-sm font-semibold">{l.product_name}</span>
                        </span>
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-50" />
                      </button>
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive"
                        onClick={() => setLines((a) => a.filter((x) => x.id !== l.id))}
                        title="Bỏ dòng này khỏi phiếu"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="col-span-2 space-y-1">
                        <Label className="text-xs">Ghi chú</Label>
                        <Input
                          value={l.note}
                          onChange={(e) => patchLine(l.id, { note: e.target.value })}
                          placeholder="—" className="h-9"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">ĐVT</Label>
                        <Select value={l.unit_name} onValueChange={(v) => pickUnit(l, v)}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
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
                      <div className="space-y-1">
                        <Label className="text-xs">Số lượng</Label>
                        <Input
                          type="number" step="any" min={0} value={l.quantity}
                          onChange={(e) => patchLine(l.id, { quantity: e.target.value })}
                          className="h-9 text-right tabular-nums"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Đơn giá</Label>
                        <MoneyInput
                          value={l.unit_price}
                          onChange={(v) => patchLine(l.id, { unit_price: String(v) })}
                          showSuffix={false}
                          inputClassName="h-9 text-right tabular-nums"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Giảm giá</Label>
                        <MoneyInput
                          value={l.line_discount}
                          onChange={(v) => patchLine(l.id, { line_discount: String(v) })}
                          showSuffix={false}
                          inputClassName="h-9 text-right tabular-nums"
                        />
                      </div>
                      <div className="col-span-2 text-right text-sm">
                        Thành tiền:{" "}
                        <span className="font-semibold tabular-nums">{formatCurrency(lineTotalOf(l))}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ---------------- Tổng tiền ---------------- */}
      <div className="ml-auto grid w-full max-w-sm gap-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="pr-discount" className="text-xs uppercase tracking-wider text-muted-foreground">
            Giảm giá cả phiếu
          </Label>
          <MoneyInput
            value={value.discount}
            onChange={(v) => onChange({ discount: String(v) })}
            showSuffix={false}
            className="w-40"
            inputClassName="h-9 text-right tabular-nums"
            id="pr-discount"
          />
        </div>
        <dl className="grid gap-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Tiền hàng</dt>
            <dd className="tabular-nums">{formatCurrency(totals.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Thuế GTGT</dt>
            <dd className="tabular-nums">{formatCurrency(totals.vat)}</dd>
          </div>
          {/* ⚠ GIẢM GIÁ TRỪ SAU THUẾ (chủ nhà chốt 20/09/2026). Hiện nó
              thành một dòng riêng, dưới dòng thuế, để thứ tự trên màn
              đúng bằng thứ tự trong phép tính. */}
          {totals.discount > 0 && (
            <div className="flex justify-between text-[#b54708]">
              <dt>Giảm giá cả phiếu</dt>
              <dd className="tabular-nums">−{formatCurrency(totals.discount)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t pt-1 text-base font-extrabold">
            <dt>Cần trả NCC</dt>
            <dd className="tabular-nums">{formatCurrency(totals.total)}</dd>
          </div>
        </dl>
      </div>

      {/* Thanh hành động dính đáy — đúng khuôn màn đặt hàng. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 p-3 backdrop-blur lg:pl-[var(--sidebar-w,0px)]">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">{value.lines.length} dòng · Cần trả NCC</div>
            <div className="truncate text-lg font-bold tabular-nums">{formatCurrency(totals.total)}</div>
          </div>
          {actions}
        </div>
      </div>

      {/* ---------------- Modal chi tiết mặt hàng ---------------- */}
      {/*
        ⚠ MODAL GIỮ NHỮNG THỨ KHÔNG VÀO ĐƯỢC CHÍN CỘT (chủ nhà chốt:
          "thông tin sản phẩm hiển thị đơn giản, cần nhiều thông tin hơn
          thì bấm vào ra modal"). Thuế suất nằm ở đây chứ không ở bảng:
          nó gần như luôn là giá trị mặc định của mặt hàng, và cho nó
          một cột riêng là bắt chín cột kia hẹp lại vì một ô ít ai sửa.
      */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="sm:max-w-md">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">{detail.product_name}</DialogTitle>
              </DialogHeader>
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Mã hàng</dt>
                  <dd className="font-mono">{detail.sku || "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Đơn vị cơ sở</dt>
                  <dd>{detail.base_unit}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Đang nhập theo</dt>
                  <dd>
                    {detail.unit_name}
                    {Number(detail.conversion_factor) > 1 && (
                      <span className="text-muted-foreground">
                        {" "}(×{detail.conversion_factor} {detail.base_unit})
                      </span>
                    )}
                  </dd>
                </div>
                {/* ⚠ GIÁ VỐN QUY VỀ ĐƠN VỊ CƠ SỞ — đúng con số sẽ ghi vào
                    `batches.unit_cost`. Người nhập gõ giá một thùng, còn
                    kho và mọi báo cáo lãi lỗ đọc giá một hộp; không hiện
                    ra đây thì không ai đối chiếu được. */}
                <div className="flex justify-between gap-3 border-t pt-2">
                  <dt className="text-muted-foreground">Giá vốn / {detail.base_unit}</dt>
                  <dd className="font-semibold tabular-nums">
                    {formatCurrency(unitCostOf(detail))}
                  </dd>
                </div>
              </dl>
              <div className="space-y-1">
                <Label htmlFor="pr-vat" className="text-xs uppercase tracking-wider text-muted-foreground">
                  Thuế GTGT (%)
                </Label>
                <Input
                  id="pr-vat" type="number" step="any" min={0} max={100}
                  value={detail.vat_percent}
                  onChange={(e) => patchLine(detail.id, { vat_percent: e.target.value })}
                  className="h-9 text-right tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pr-lnote" className="text-xs uppercase tracking-wider text-muted-foreground">
                  Ghi chú dòng
                </Label>
                <Textarea
                  id="pr-lnote" rows={2} value={detail.note}
                  onChange={(e) => patchLine(detail.id, { note: e.target.value })}
                  placeholder="Ví dụ: lô cận date, nhận bù đợt trước"
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
