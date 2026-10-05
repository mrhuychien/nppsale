"use client"

/**
 * Ô NHẬP HỒ SƠ NHÀ CUNG CẤP — dùng chung cho tạo mới (`SupplierForm`) và sửa ở màn chi tiết (`SupplierEditSheet`).
 * Mỗi ô có `id="ncc-<cột>"` để nút "Bổ sung" ở khối "Cần hoàn thiện" nhảy thẳng tới ô thiếu.
 */
import type { ReactNode } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { MoneyInput } from "@/components/ui/money-input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PAYMENT_TERMS } from "@/lib/constants"
import { LOAI_HINH_NCC } from "@/lib/suppliers/chi-tiet"
import type { NccForm } from "@/lib/suppliers/form"

const NHAN = "text-xs uppercase tracking-wider text-muted-foreground"

function O({ id, label, children, rong }: { id: string; label: string; children: ReactNode; rong?: boolean }) {
  return (
    <div className={rong ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
      <Label htmlFor={id} className={NHAN}>{label}</Label>
      {children}
    </div>
  )
}

function Nhom({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

export function SupplierFields({
  form,
  onChange,
}: {
  form: NccForm
  onChange: (patch: Partial<NccForm>) => void
}) {
  const txt = (k: keyof NccForm, extra?: Partial<React.ComponentProps<typeof Input>>) => (
    <Input
      id={`ncc-${k}`}
      value={String(form[k] ?? "")}
      onChange={(e) => onChange({ [k]: e.target.value } as Partial<NccForm>)}
      className="text-base sm:text-sm"
      {...extra}
    />
  )
  const loaiHinh = form.business_type && !(LOAI_HINH_NCC as readonly string[]).includes(form.business_type)
    ? [form.business_type, ...LOAI_HINH_NCC]
    : [...LOAI_HINH_NCC]

  return (
    <div className="space-y-6" data-testid="ncc-truong">
      <Nhom title="Thông tin chung">
        <O id="ncc-name" label="Tên nhà cung cấp *">{txt("name", { required: true, placeholder: "VD: Công ty TNHH ABC" })}</O>
        <O id="ncc-code" label="Mã NCC">{txt("code", { placeholder: "Tự động: NCC-0001" })}</O>
        <O id="ncc-category" label="Danh mục">{txt("category", { placeholder: "VD: Thực phẩm, Hóa phẩm..." })}</O>
        <O id="ncc-payment_terms" label="Điều khoản thanh toán">
          <Select value={form.payment_terms} onValueChange={(v) => onChange({ payment_terms: v })}>
            <SelectTrigger id="ncc-payment_terms" className="h-11 lg:h-10"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAYMENT_TERMS.map((pt) => (
                <SelectItem key={pt.value} value={pt.value}>{pt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </O>
        <O id="ncc-credit_limit" label="Hạn mức công nợ">
          <div className="flex items-center gap-2">
            <MoneyInput
              id="ncc-credit_limit"
              className="flex-1"
              inputClassName="text-base sm:text-sm"
              value={form.credit_limit}
              onChange={(v) => onChange({ credit_limit: v })}
              placeholder="Không đặt hạn mức"
            />
            {form.credit_limit !== "" && (
              <Button type="button" variant="ghost" size="sm" className="h-11 shrink-0 lg:h-10" onClick={() => onChange({ credit_limit: "" })}>
                Bỏ hạn mức
              </Button>
            )}
          </div>
        </O>
      </Nhom>

      <Nhom title="Thông tin liên hệ">
        <O id="ncc-contact_name" label="Người liên hệ">{txt("contact_name", { placeholder: "Tên người liên hệ" })}</O>
        <O id="ncc-phone" label="Số điện thoại">{txt("phone", { inputMode: "tel", placeholder: "0901000001" })}</O>
        <O id="ncc-email" label="Email">{txt("email", { type: "email", placeholder: "supplier@email.com" })}</O>
        <O id="ncc-address" label="Địa chỉ" rong>
          <Textarea
            id="ncc-address"
            value={form.address}
            onChange={(e) => onChange({ address: e.target.value })}
            placeholder="Số nhà, tên đường, quận/huyện..."
            className="text-base sm:text-sm"
          />
        </O>
      </Nhom>

      <Nhom title="Thông tin pháp lý & ngân hàng">
        <O id="ncc-legal_name" label="Tên pháp nhân">{txt("legal_name", { placeholder: "Tên trên giấy phép ĐKKD" })}</O>
        <O id="ncc-tax_code" label="Mã số thuế">{txt("tax_code", { inputMode: "numeric", placeholder: "VD: 0123456789" })}</O>
        <O id="ncc-business_type" label="Loại hình">
          <Select value={form.business_type || undefined} onValueChange={(v) => onChange({ business_type: v })}>
            <SelectTrigger id="ncc-business_type" className="h-11 lg:h-10"><SelectValue placeholder="Chọn loại hình" /></SelectTrigger>
            <SelectContent>
              {loaiHinh.map((l) => (
                <SelectItem key={l} value={l}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </O>
        <O id="ncc-representative" label="Người đại diện">{txt("representative", { placeholder: "Người đại diện theo pháp luật" })}</O>
        <O id="ncc-business_license_no" label="Số giấy phép ĐKKD">{txt("business_license_no")}</O>
        <O id="ncc-business_license_date" label="Ngày cấp">{txt("business_license_date", { type: "date" })}</O>
        <O id="ncc-registered_address" label="Địa chỉ đăng ký" rong>{txt("registered_address", { placeholder: "Địa chỉ trên giấy phép ĐKKD" })}</O>
        <O id="ncc-bank_account" label="Số tài khoản ngân hàng">{txt("bank_account", { inputMode: "numeric", placeholder: "Số tài khoản" })}</O>
        <O id="ncc-bank_name" label="Tên ngân hàng">{txt("bank_name", { placeholder: "VD: Vietcombank" })}</O>
      </Nhom>

      <div className="space-y-1.5">
        <Label htmlFor="ncc-notes" className={NHAN}>Ghi chú</Label>
        <Textarea
          id="ncc-notes"
          value={form.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="Ghi chú thêm về nhà cung cấp..."
          rows={3}
          className="text-base sm:text-sm"
        />
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
        <div className="flex min-h-11 items-center gap-3">
          <Checkbox id="ncc-is_verified" checked={form.is_verified} onCheckedChange={(c) => onChange({ is_verified: c === true })} />
          <Label htmlFor="ncc-is_verified" className="cursor-pointer">Đã xác minh</Label>
        </div>
        <div className="flex min-h-11 items-center gap-3">
          <Switch id="ncc-is_active" checked={form.is_active} onCheckedChange={(c) => onChange({ is_active: c })} />
          <Label htmlFor="ncc-is_active" className="cursor-pointer">Đang hợp tác</Label>
        </div>
      </div>
    </div>
  )
}
