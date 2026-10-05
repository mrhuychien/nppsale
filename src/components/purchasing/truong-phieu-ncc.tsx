"use client"

/**
 * Ô RIÊNG của phiếu nhập hàng / phiếu trả NCC trên điện thoại — dùng chung cho màn TẠO và màn SỬA.
 *
 * ⚠ Chủ nhà 05/10/2026: "sửa phiếu nhập hàng ncc chưa quay về giống phần tạo phiếu mà dùng form riêng (trên di
 *   động)". Màn sửa từng vẽ `PurchaseReceiptForm` / `PurchaseReturnForm` (bảng kiểu máy tính) trong khi màn tạo
 *   là `PhieuNccMobile`. Nay hai màn cùng một khung, và các ô riêng nằm ở ĐÂY để không lệch nhau lần nữa.
 */

import { NhomNut, OTruong } from "@/components/purchasing/phieu-ncc-mobile"
import type { PurchaseReceiptFormValue } from "@/components/purchasing/purchase-receipt-form"
import type { PurchaseReturnFormValue } from "@/components/purchasing/purchase-return-form"
import { RECEIPT_ZONES } from "@/lib/purchasing/receipt-form"
import { RETURN_REASONS } from "@/lib/purchasing/return-form"
import type { WarehouseZone } from "@/types"

const O_NHAP =
  "h-11 w-full rounded-[10px] border border-border bg-surface-container-lowest px-3 text-[14px] outline-none focus:border-primary"

export function TruongPhieuNhap({
  form,
  patch,
}: {
  form: PurchaseReceiptFormValue
  patch: (p: Partial<PurchaseReceiptFormValue>) => void
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <OTruong label="Số HĐ NCC">
          <input
            id="pn-so-hd"
            value={form.invoiceNumber}
            onChange={(e) => patch({ invoiceNumber: e.target.value })}
            placeholder="Không bắt buộc"
            className={O_NHAP}
          />
        </OTruong>
        <OTruong label="Ngày HĐ">
          <input
            id="pn-ngay"
            type="date"
            value={form.invoiceDate}
            onChange={(e) => patch({ invoiceDate: e.target.value })}
            className={O_NHAP}
          />
        </OTruong>
      </div>
      <OTruong label="Nhập vào kho">
        <NhomNut label="Nhập vào kho" value={form.zone} options={RECEIPT_ZONES} onChange={(v) => patch({ zone: v })} />
      </OTruong>
    </>
  )
}

export function TruongPhieuTraNcc({
  form,
  patch,
}: {
  form: PurchaseReturnFormValue
  patch: (p: Partial<PurchaseReturnFormValue>) => void
}) {
  return (
    <>
      <OTruong label="Ngày trả">
        <input
          id="pr-date"
          type="date"
          value={form.returnDate}
          onChange={(e) => patch({ returnDate: e.target.value })}
          className={O_NHAP}
        />
      </OTruong>
      <OTruong label="Xuất từ kho (FIFO, hạn cũ trước)">
        <NhomNut<WarehouseZone>
          label="Xuất từ kho"
          value={form.zone}
          options={[{ value: "date", label: "Kho hàng date" }, { value: "sale", label: "Kho hàng bán" }]}
          onChange={(v) => patch({ zone: v })}
        />
      </OTruong>
      <OTruong label="Lý do">
        <NhomNut label="Lý do trả" value={form.reason} options={RETURN_REASONS} onChange={(v) => patch({ reason: v })} />
      </OTruong>
    </>
  )
}
