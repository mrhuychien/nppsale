"use client"

/**
 * BIỂU MẪU PHIẾU TRẢ HÀNG NCC — phần ĐẦU PHIẾU.
 *
 * ⚠ Ô TÌM HÀNG, BẢNG CHÍN CỘT, KHỐI TỔNG VÀ MODAL NẰM Ở
 * `PurchasingLinesEditor`, dùng chung với phiếu nhập hàng (chủ nhà chốt
 * 20/09/2026: "hãy làm phiếu trả NCC tương tự"). Hai chứng từ này là
 * hai chiều của cùng một việc với cùng một NCC, nên chúng phải có cùng
 * bộ ô và cùng phép tính. Giữ hai bản là chỗ để một bên được sửa còn
 * bên kia thì không — đúng chuyện đã xảy ra: phiếu nhập có ghi chú
 * dòng, giảm giá và tiền thuế gõ tay, phiếu trả không có gì trong ba
 * thứ đó.
 *
 * ⚠ CHỈ PHẦN ĐẦU LÀ RIÊNG. Phiếu trả cần Lý do trả và Kho NGUỒN (xuất
 * từ đâu); phiếu nhập cần Số hoá đơn đầu vào và Kho ĐÍCH. Ép chung là
 * dựng một component nhận mười cờ bật/tắt.
 *
 * ⚠ MỘT BIỂU MẪU, KHÔNG PHẢI HAI. Màn tạo và màn sửa trước đây là hai
 * bản sao chép gần như từng dòng. Giữ hai bản là sửa một phép tính ở
 * một bên rồi quên bên kia — và hai màn cho ra hai con số khác nhau cho
 * đúng cùng mấy dòng hàng.
 */

import { useMemo } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { SearchSelect, type SearchSelectOption } from "@/components/ui/search-select"
import {
  PurchasingLinesEditor, type PickerExtra,
} from "@/components/purchasing/purchasing-lines-editor"
import { RETURN_REASONS } from "@/lib/purchasing/return-form"
import type { ReceiptLine, ReceiptProduct } from "@/lib/purchasing/receipt-form"
import type { Supplier, WarehouseZone } from "@/types"

export type { PickerExtra }

export interface PurchaseReturnFormValue {
  supplierId: string
  returnDate: string
  zone: WarehouseZone
  reason: string
  /** Giảm giá đầu phiếu — trừ SAU thuế, cùng quy ước với phiếu nhập. */
  discount: string
  /**
   * Tiền thuế GTGT gõ tay theo giấy của NCC.
   *
   * ⚠ Ô TRỐNG KHÁC SỐ 0. Trống nghĩa là "để máy tự cộng từ thuế suất
   * từng dòng"; số 0 nghĩa là "chứng từ này KHÔNG có thuế".
   */
  vatOverride: string
  notes: string
  lines: ReceiptLine[]
}

export function PurchaseReturnForm({
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
  value: PurchaseReturnFormValue
  onChange: (patch: Partial<PurchaseReturnFormValue>) => void
  submitting: boolean
  /** Các nút của thanh dính đáy — màn tạo và màn sửa đặt tên khác nhau. */
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
      supplierId={value.supplierId || null}
      linesTitle="Chi tiết hàng trả"
      totalLabel="NCC hoàn lại"
      header={
        <Card>
          <CardHeader><CardTitle className="text-base">Thông tin chung</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pr-supplier" className="text-xs uppercase tracking-wider text-muted-foreground">
                Nhà cung cấp *
              </Label>
              {/* ⚠ KHÔNG CHO GÕ TAY. Phiếu trả ghi thẳng `supplier_id` và
                  RPC giảm công nợ của đúng NCC đó; một cái tên gõ tay
                  không có mã thì không có sổ nợ nào để giảm, và phiếu lưu
                  xuống sẽ trượt khoá ngoại. */}
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
                id="pr-date" type="date" value={value.returnDate}
                onChange={(e) => onChange({ returnDate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Xuất từ kho *</Label>
              <Select value={value.zone} onValueChange={(v) => onChange({ zone: v as WarehouseZone })}>
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
