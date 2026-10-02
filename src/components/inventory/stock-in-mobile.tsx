"use client"

/**
 * PHIẾU NHẬP KHO TRÊN ĐIỆN THOẠI — theo bản thiết kế "phieu-nhap" (chủ nhà 30/09/2026).
 *
 * Chỉ là giao diện: state, quy đổi, giá vốn và lệnh ghi (`ghiPhieuNhapKho` → RPC
 * `post_stock_import`) vẫn ở `inventory/stock-in/page.tsx`. Ô NCC, ô tìm hàng và dòng nhắc công nợ
 * NCC do trang dựng sẵn rồi đưa vào, để hai giao diện không thành hai bản luật.
 *
 * ⚠ Màn có thanh đáy riêng → route phải nằm trong OWN_ACTION_BAR_ROUTES và ẩn app bar chuẩn.
 */

import { KHO_NHAN, type KhoNhan } from "@/lib/inventory/post-import"
import { CompactSelect } from "@/components/ui/compact-select"
import { useState, type ReactNode } from "react"
import { ScanBarcode, Tag, Trash2 } from "lucide-react"
import { DauTrangTrang } from "@/components/mobile/dau-trang"
import { MoneyInput } from "@/components/ui/money-input"
import { cn, formatCurrency } from "@/lib/utils"
import { resolveUnitCost } from "@/lib/inventory/opening-stock"
import {
  buocSoLuong, dongCoHang, locSoLuong, lyDoKhoaNut, moneyDisplay, soCuaO, tomTatLo, tomTatThanhDay,
} from "@/lib/inventory/stock-in-mobile"
import { SoThuTu } from "@/components/mobile/so-thu-tu"

export interface DongNhapKhoMobile {
  id: string
  product_id: string
  product_name: string
  sku: string
  unit_name: string
  quantity: string
  unit_price: string
  unit_cost: string
  vat_rate: number
  batch_code: string
  manufactured_at: string
  expires_at: string
  location: string
  available_units: string[]
}

export interface StockInMobileProps {
  lines: DongNhapKhoMobile[]
  onPatch: (id: string, patch: Partial<DongNhapKhoMobile>) => void
  onRemove: (id: string) => void
  /** Hệ số của đơn vị trên dòng về đơn vị cơ sở (`conversionFor` của trang). */
  heSo: (l: DongNhapKhoMobile) => number
  summary: { subtotal: number; vat: number; total: number }
  entryDate: string
  onEntryDate: (v: string) => void
  /** Kho nhận (mig 219) — kho bán / kho date. */
  zone: KhoNhan
  onZone: (v: KhoNhan) => void
  invoiceNo: string
  onInvoiceNo: (v: string) => void
  /** Ô chọn NCC (SearchSelect) + dòng nhắc có / không sinh công nợ NCC. */
  nccField: ReactNode
  nccHint: ReactNode
  /** Ô tìm mặt hàng (ProductPicker) của trang. */
  picker: ReactNode
  onScan: () => void
  onDiscard: () => void
  onSubmit: () => void
  saving: boolean
}

const O_NHAP =
  "h-11 w-full min-w-0 rounded-xl border border-border bg-surface-container-lowest px-3 text-base text-on-surface outline-none focus:border-primary"
const O_NHO =
  "h-10 w-full min-w-0 rounded-[10px] border border-border bg-surface-container-lowest px-2.5 text-base text-on-surface outline-none focus:border-primary disabled:opacity-60"

function Nhan({ children }: { children: ReactNode }) {
  return <span className="text-xs font-medium text-muted-foreground">{children}</span>
}

function NhanNho({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-medium text-muted-foreground">{children}</span>
}

/** VAT % gõ tay — giữ chuỗi đang gõ ("8.") để dấu chấm không bị nuốt; state trang giữ tỉ lệ 0..1. */
function OVat({ rate, onRate, id }: { rate: number; onRate: (r: number) => void; id: string }) {
  const hien = String(Math.round((rate || 0) * 1000) / 10)
  const [nhap, setNhap] = useState<string | null>(null)
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={nhap ?? hien}
      onChange={(e) => {
        const s = locSoLuong(e.target.value)
        setNhap(s)
        onRate(Math.max(0, Math.min(100, soCuaO(s))) / 100)
      }}
      onBlur={() => setNhap(null)}
      className={cn(O_NHO, "text-center")}
    />
  )
}

export function StockInMobile(p: StockInMobileProps) {
  const [moLo, setMoLo] = useState<Record<string, boolean>>({})
  const dong = dongCoHang(p.lines)
  const { matHang, donViCoSo } = tomTatThanhDay(p.lines, p.heSo)
  const lyDo = lyDoKhoaNut(p.lines)

  return (
    <div className="-mx-4 -mt-4 flex min-h-screen flex-col bg-surface-container-low" data-testid="nhap-kho-mobile">
      <DauTrangTrang
        title="Nhập kho"
        subtitle="Phiếu mới · nháp"
        backHref="/inventory"
        className="sticky top-0 z-20"
        action={
          <button
            type="button"
            onClick={p.onDiscard}
            disabled={p.saving}
            className="tap px-1 text-[13px] font-semibold text-destructive disabled:opacity-50"
          >
            Huỷ nháp
          </button>
        }
      />

      <div className="flex flex-col gap-[22px] px-3.5 pb-[190px] pt-3.5">
        {/* Thông tin chung — NCC / số HĐ không có trong ảnh thiết kế nhưng trang đang ghi (công nợ NCC,
            ghi chú phiếu) nên đặt gọn ở đây, không bỏ. */}
        <section>
          <h2 className="mb-2 text-base font-bold text-on-surface">Thông tin chung</h2>
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3.5">
            <label className="flex min-w-0 flex-col gap-1.5">
              <Nhan>Ngày nhập</Nhan>
              <input
                id="nk-m-ngay"
                type="date"
                value={p.entryDate}
                onChange={(e) => p.onEntryDate(e.target.value)}
                className={O_NHAP}
              />
            </label>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Nhan>Kho nhận</Nhan>
              {/* Hai nút như bản thiết kế — hàng vào đúng kho đã chọn (mig 219: post_stock_import nhận vùng kho). */}
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-container-low p-1" role="group" aria-label="Kho nhận">
                {KHO_NHAN.map((k) => (
                  <button
                    key={k.v}
                    type="button"
                    aria-pressed={p.zone === k.v}
                    data-testid={`nk-m-kho-${k.v}`}
                    onClick={() => p.onZone(k.v)}
                    className={cn(
                      "h-9 rounded-lg text-[14px] font-semibold",
                      p.zone === k.v ? "bg-card text-primary shadow-sm" : "text-muted-foreground"
                    )}
                  >
                    {k.nhan}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Nhan>Nhà cung cấp</Nhan>
              {p.nccField}
              {p.nccHint}
            </div>
            <label className="flex min-w-0 flex-col gap-1.5">
              <Nhan>Số hoá đơn</Nhan>
              <input
                id="nk-m-so-hd"
                value={p.invoiceNo}
                onChange={(e) => p.onInvoiceNo(e.target.value)}
                placeholder="VD: HD-2026-001"
                className={O_NHAP}
              />
            </label>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold text-on-surface">
            Mặt hàng{dong.length > 0 ? ` (${dong.length})` : ""}
          </h2>
          <div className="flex flex-col gap-2.5">
            <div className="flex items-start gap-2 rounded-2xl border border-border bg-card p-1.5 pl-2">
              {/* Bỏ viền riêng của ô tìm — khung trắng bên ngoài là viền (như thiết kế). */}
              <div className="min-w-0 flex-1 [&_input]:h-10 [&_input]:border-0 [&_input]:bg-transparent [&_input]:text-base [&_input]:shadow-none [&_input]:focus-visible:ring-0 [&_input]:focus-visible:ring-offset-0">
                {p.picker}
              </div>
              <button
                type="button"
                aria-label="Quét mã"
                onClick={p.onScan}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-border bg-card text-on-surface-variant"
              >
                <ScanBarcode className="h-[18px] w-[18px]" />
              </button>
            </div>

            {dong.length === 0 && (
              <div
                data-testid="nk-m-trong"
                className="rounded-2xl border border-dashed border-border px-4 py-5 text-center text-[13px] text-muted-foreground"
              >
                Chưa có mặt hàng. Tìm hoặc quét mã để thêm.
              </div>
            )}

            {dong.map((l, i) => {
              const qty = soCuaO(l.quantity)
              const thanhTien = qty * soCuaO(l.unit_price)
              const thieuVon = qty > 0 && !resolveUnitCost(l.unit_cost).known
              const mo = !!moLo[l.id]
              return (
                <div
                  key={l.id}
                  data-testid="nk-m-dong"
                  className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card px-3.5 py-3"
                >
                  <div className="flex items-start gap-2.5">
                    <SoThuTu n={i + 1} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-snug text-on-surface">{l.product_name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {l.sku} · {l.unit_name}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Xoá dòng ${l.product_name}`}
                      onClick={() => p.onRemove(l.id)}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground active:bg-destructive/10 active:text-destructive"
                    >
                      <Trash2 className="h-[18px] w-[18px]" />
                    </button>
                  </div>

                  <div className="grid grid-cols-[118px_1fr_64px] gap-2">
                    <div className="flex min-w-0 flex-col gap-1">
                      <NhanNho>Số lượng</NhanNho>
                      <div className="flex h-10 items-center overflow-hidden rounded-[10px] border border-border">
                        <button
                          type="button"
                          aria-label={`Giảm ${l.product_name}`}
                          onClick={() => p.onPatch(l.id, { quantity: buocSoLuong(l.quantity, -1) })}
                          className="h-full w-[34px] bg-surface-container text-lg text-on-surface-variant"
                        >
                          −
                        </button>
                        <input
                          aria-label={`Số lượng ${l.product_name}`}
                          type="text"
                          inputMode="decimal"
                          value={l.quantity}
                          onChange={(e) => p.onPatch(l.id, { quantity: locSoLuong(e.target.value) })}
                          onFocus={(e) => e.currentTarget.select()}
                          placeholder="0"
                          className="w-full min-w-0 flex-1 border-0 bg-transparent text-center text-base font-semibold tabular-nums text-on-surface outline-none"
                        />
                        <button
                          type="button"
                          aria-label={`Tăng ${l.product_name}`}
                          onClick={() => p.onPatch(l.id, { quantity: buocSoLuong(l.quantity, 1) })}
                          className="h-full w-[34px] bg-surface-container text-lg text-on-surface-variant"
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                      <NhanNho>Đơn giá (đ)</NhanNho>
                      <MoneyInput
                        aria-label={`Đơn giá ${l.product_name}`}
                        value={moneyDisplay(l.unit_price)}
                        onChange={(n) => p.onPatch(l.id, { unit_price: n > 0 ? String(n) : "" })}
                        placeholder="0"
                        showSuffix={false}
                        inputClassName="h-10 text-base text-right"
                      />
                    </div>
                    <label className="flex min-w-0 flex-col gap-1">
                      <NhanNho>VAT %</NhanNho>
                      <OVat id={`nk-m-vat-${l.id}`} rate={l.vat_rate} onRate={(r) => p.onPatch(l.id, { vat_rate: r })} />
                    </label>
                  </div>

                  {/* ĐVT + giá vốn: ảnh thiết kế không có, nhưng trang đang ghi (quy đổi về đơn vị cơ sở,
                      giá vốn của lô) nên giữ trên thẻ. */}
                  <div className="grid grid-cols-[118px_1fr] gap-2">
                    <label className="flex min-w-0 flex-col gap-1">
                      <NhanNho>Đơn vị</NhanNho>
                      {l.available_units.length > 1 ? (
                        <CompactSelect
                          ariaLabel={`Đơn vị ${l.product_name}`}
                          value={l.unit_name}
                          onChange={(v) => p.onPatch(l.id, { unit_name: v })}
                          options={l.available_units.map((u) => ({ value: u, label: u }))}
                          className={O_NHO}
                        />
                      ) : (
                        <input value={l.unit_name} disabled className={O_NHO} aria-label={`Đơn vị ${l.product_name}`} />
                      )}
                    </label>
                    <div className="flex min-w-0 flex-col gap-1">
                      <NhanNho>Giá vốn (đ / {l.unit_name})</NhanNho>
                      <MoneyInput
                        aria-label={`Giá vốn ${l.product_name}`}
                        value={moneyDisplay(l.unit_cost)}
                        onChange={(n) => p.onPatch(l.id, { unit_cost: n > 0 ? String(n) : "" })}
                        placeholder="Chưa biết"
                        showSuffix={false}
                        inputClassName={cn("h-10 text-base text-right", thieuVon && "border-amber-300 bg-amber-50/50")}
                      />
                    </div>
                  </div>
                  {thieuVon && (
                    <p className="-mt-1 text-[11px] leading-tight text-amber-600">
                      Chưa có giá vốn — lãi gộp của lô này sẽ tính sai.
                    </p>
                  )}

                  <button
                    type="button"
                    aria-expanded={mo}
                    onClick={() => setMoLo((s) => ({ ...s, [l.id]: !s[l.id] }))}
                    className="flex items-center gap-2 rounded-[10px] bg-surface-container px-2.5 py-2 text-left"
                  >
                    <Tag className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-xs text-on-surface-variant">{tomTatLo(l)}</span>
                    <span className="text-xs font-semibold text-primary">{mo ? "Thu gọn" : "Sửa"}</span>
                  </button>
                  {mo && (
                    <div className="grid grid-cols-2 gap-2" data-testid="nk-m-lo">
                      <label className="flex min-w-0 flex-col gap-1">
                        <NhanNho>Mã lô</NhanNho>
                        <input
                          value={l.batch_code}
                          onChange={(e) => p.onPatch(l.id, { batch_code: e.target.value })}
                          placeholder="Tự sinh"
                          className={cn(O_NHO, "font-mono")}
                        />
                      </label>
                      <label className="flex min-w-0 flex-col gap-1">
                        <NhanNho>Hạn sử dụng</NhanNho>
                        <input
                          type="date"
                          value={l.expires_at}
                          onChange={(e) => p.onPatch(l.id, { expires_at: e.target.value })}
                          className={O_NHO}
                        />
                      </label>
                      <label className="flex min-w-0 flex-col gap-1">
                        <NhanNho>Ngày sản xuất</NhanNho>
                        <input
                          type="date"
                          value={l.manufactured_at}
                          onChange={(e) => p.onPatch(l.id, { manufactured_at: e.target.value })}
                          className={O_NHO}
                        />
                      </label>
                      <label className="flex min-w-0 flex-col gap-1">
                        <NhanNho>Vị trí</NhanNho>
                        <input
                          value={l.location}
                          onChange={(e) => p.onPatch(l.id, { location: e.target.value })}
                          placeholder="Kệ A1"
                          className={O_NHO}
                        />
                      </label>
                    </div>
                  )}

                  <div className="flex justify-between border-t border-border/60 pt-2.5 text-[13px]">
                    <span className="text-muted-foreground">Thành tiền</span>
                    <span className="font-bold tabular-nums text-on-surface">{formatCurrency(thanhTien)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {dong.length > 0 && (
          <section>
            <h2 className="mb-2 text-base font-bold text-on-surface">Giá trị nhập</h2>
            <div className="overflow-hidden rounded-2xl border border-border bg-card text-sm">
              <div className="flex justify-between px-3.5 py-[11px]">
                <span className="text-muted-foreground">Tạm tính</span>
                <span className="font-medium tabular-nums">{formatCurrency(p.summary.subtotal)}</span>
              </div>
              <div className="flex justify-between border-t border-border/60 px-3.5 py-[11px]">
                <span className="text-muted-foreground">Thuế VAT</span>
                <span className="font-medium tabular-nums">{formatCurrency(p.summary.vat)}</span>
              </div>
              <div className="flex justify-between border-t border-border/60 px-3.5 py-3 text-[15px]">
                <span className="font-semibold">Tổng cộng</span>
                <span className="font-bold tabular-nums">{formatCurrency(p.summary.total)}</span>
              </div>
            </div>
            <p className="px-0.5 pt-2 text-xs leading-relaxed text-muted-foreground">
              Mỗi dòng tạo một lô. Khi xuất, lô có HSD gần nhất được lấy trước (FEFO).
            </p>
          </section>
        )}
      </div>

      <div
        data-testid="nk-m-thanh-day"
        className="kb-hide fixed inset-x-0 bottom-0 z-30 flex flex-col gap-2.5 border-t border-border bg-card px-3.5 pb-[calc(var(--safe-b)+16px)] pt-3 lg:hidden"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {matHang} mặt hàng · {donViCoSo.toLocaleString("vi-VN")} đơn vị
          </span>
          <span className="text-lg font-bold tabular-nums text-on-surface" data-testid="nk-m-tong">
            {formatCurrency(p.summary.total)}
          </span>
        </div>
        <button
          type="button"
          onClick={p.onSubmit}
          disabled={!!lyDo || p.saving}
          title={lyDo || undefined}
          className="h-[52px] rounded-[14px] bg-primary text-[15px] font-semibold text-primary-foreground active:opacity-90 disabled:bg-primary/25 disabled:text-primary-foreground"
        >
          {p.saving ? "Đang lưu..." : lyDo || "Xác nhận nhập kho"}
        </button>
      </div>
    </div>
  )
}
