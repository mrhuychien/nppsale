"use client"

/**
 * BIỂU MẪU PHIẾU NHẬP HÀNG — phần ĐẦU PHIẾU.
 *
 * ⚠ Ô TÌM HÀNG, BẢNG CHÍN CỘT, KHỐI TỔNG VÀ MODAL NẰM Ở
 * `PurchasingLinesEditor`, dùng chung với phiếu trả NCC (chủ nhà chốt
 * 20/09/2026: "hãy làm phiếu trả NCC tương tự"). Giữ hai bản là chỗ để
 * một bên được sửa còn bên kia thì không — đúng chuyện đã xảy ra:
 * phiếu nhập có ghi chú dòng, giảm giá và tiền thuế gõ tay, phiếu trả
 * không có gì trong ba thứ đó.
 *
 * ⚠ CHỈ PHẦN ĐẦU LÀ RIÊNG. Phiếu nhập cần Số hoá đơn đầu vào và Kho
 * đích; phiếu trả cần Lý do trả và Kho nguồn. Ép chung là dựng một
 * component nhận mười cờ bật/tắt.
 */

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { SearchSelect, type SearchSelectOption } from "@/components/ui/search-select"
import { useMemo } from "react"
import {
  PurchasingLinesEditor, type PickerExtra,
} from "@/components/purchasing/purchasing-lines-editor"
import { RECEIPT_ZONES, type ReceiptLine, type ReceiptProduct } from "@/lib/purchasing/receipt-form"
import type { Supplier } from "@/types"

export type { PickerExtra }

export interface PurchaseReceiptFormValue {
  supplierId: string
  invoiceNumber: string
  invoiceDate: string
  zone: string
  /** Giảm giá đầu phiếu — trừ SAU thuế (chủ nhà chốt). */
  discount: string
  /**
   * Tiền thuế GTGT gõ tay theo hoá đơn giấy của NCC.
   *
   * ⚠ Ô TRỐNG KHÁC SỐ 0. Trống nghĩa là "để máy tự cộng từ thuế suất
   * từng dòng"; số 0 nghĩa là "hoá đơn này KHÔNG có thuế".
   */
  vatOverride: string
  notes: string
  lines: ReceiptLine[]
}

export function PurchaseReceiptForm({
  suppliers,
  products,
  value,
  onChange,
  submitting,
  actions,
  extras = {},
}: {
  suppliers: Supplier[]
  products: ReceiptProduct[]
  value: PurchaseReceiptFormValue
  onChange: (patch: Partial<PurchaseReceiptFormValue>) => void
  submitting: boolean
  actions: React.ReactNode
  extras?: Record<string, PickerExtra>
}) {
  const supplierOptions: SearchSelectOption[] = useMemo(
    () => suppliers.map((s) => ({ id: s.id, label: s.name, hint: s.code || null, keywords: s.code })),
    [suppliers]
  )

  return (
    <PurchasingLinesEditor
      products={products}
      value={value}
      onChange={onChange}
      submitting={submitting}
      actions={actions}
      extras={extras}
      linesTitle="Chi tiết hàng nhập"
      totalLabel="Cần trả NCC"
      header={
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
      }
    />
  )
}
