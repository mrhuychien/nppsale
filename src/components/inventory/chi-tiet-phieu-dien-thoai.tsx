"use client"

/**
 * CHI TIẾT PHIẾU KHO trên điện thoại — thiết kế "chi-tiet-phieu" (chủ nhà 30/09/2026): đầu trắng,
 * băng trạng thái, 3 ô số, khối theo khách (phiếu xuất gộp đơn) hoặc dòng hàng, thông tin phiếu,
 * Huỷ phiếu, thanh đáy In. Dữ liệu / huỷ / in đều là của `inventory/entries/[id]/page.tsx`.
 */

import { DauTrangTrang } from "@/components/mobile/dau-trang"
import { Button } from "@/components/ui/button"
import { StickyActionBar } from "@/components/ui/sticky-action-bar"
import { formatDate, cn } from "@/lib/utils"
import {
  bangTrangThai, nhanKho, nhanSoLuong, nhanTongSoLuong, slCoSoDong, tomTatDong, type TonePhieu,
} from "@/lib/inventory/phieu-kho-mobile"
import { AlertTriangle, Check, CircleX, Package, Store, Trash2 } from "lucide-react"
import { SoThuTu } from "@/components/mobile/so-thu-tu"

export interface DongChiTiet {
  id: string
  product_id: string
  unit_name: string
  quantity: number
  notes: string | null
  qty_in_base_uom?: number | null
  qty_in_transaction_uom?: number | null
  conversion_factor_snapshot?: number | null
  product?: { name?: string | null; sku?: string | null; base_unit?: string | null } | null
  batch?: { batch_code?: string | null } | null
}

export interface DonTheoPhieu {
  id: string
  order_code: string
  customer?: { store_name?: string | null } | null
  lines?: Array<{
    product_id: string
    unit_name: string
    quantity: number
    product?: { name: string; sku: string } | null
  }>
}

const TEN_PHIEU: Record<string, string> = {
  export: "Phiếu xuất kho",
  import: "Phiếu nhập kho",
  transfer: "Phiếu chuyển kho",
  stocktake: "Phiếu kiểm kê",
}

const NHAN_KHO: Record<string, string> = {
  export: "Kho xuất",
  import: "Kho nhập",
  transfer: "Chuyển",
  stocktake: "Kho",
}

const BANG: Record<TonePhieu, string> = {
  xanh: "bg-tertiary/10 text-tertiary",
  vang: "bg-amber-50 text-amber-800",
  xam: "bg-muted text-on-surface-variant",
  do: "bg-destructive/10 text-destructive",
}

export function ChiTietPhieuDienThoai({
  entry, typeLabel, lines, refOrders, canCancel, canDeleteDraft, onCancel, onDelete, onInPhieu, onInDsGiao,
}: {
  entry: {
    entry_code: string
    type: string
    status: string | null
    created_at: string
    notes: string | null
    warehouse_zone?: string | null
    dest_warehouse_zone?: string | null
    creator?: { full_name?: string | null } | null
  }
  typeLabel: string
  lines: DongChiTiet[]
  refOrders: DonTheoPhieu[]
  canCancel: boolean
  canDeleteDraft: boolean
  onCancel: () => void
  onDelete: () => void
  onInPhieu: () => void
  onInDsGiao: (() => void) | null
}) {
  const bang = bangTrangThai(entry.type, entry.status)
  const tom = tomTatDong(entry.type, lines)
  const laXuat = entry.type === "export"
  // Đơn vị cơ sở theo mã — dòng đơn chỉ có đơn vị giao dịch + hệ số.
  const dvCoSo = new Map(lines.map((l) => [l.product_id, l.product?.base_unit || ""]))

  const oTong =
    entry.type === "stocktake"
      ? nhanSoLuong("stocktake", tom.tong)
      : tom.tong.toLocaleString("vi-VN")

  const kho =
    entry.warehouse_zone === undefined
      ? null
      : entry.type === "transfer"
        ? `${nhanKho(entry.warehouse_zone)} → ${nhanKho(entry.dest_warehouse_zone)}`
        : nhanKho(entry.warehouse_zone)

  const thongTin: Array<[string, string]> = [
    ["Loại", typeLabel],
    ...(kho ? [[NHAN_KHO[entry.type] ?? "Kho", kho] as [string, string]] : []),
    ["Người tạo", entry.creator?.full_name || "—"],
    ["Ngày tạo", formatDate(entry.created_at)],
    ["Ghi chú", entry.notes || "Không có"],
  ]

  return (
    <div className="-mx-4 -mt-4 lg:hidden" data-testid="chi-tiet-phieu-dien-thoai">
      <DauTrangTrang
        title={entry.entry_code}
        subtitle={`${TEN_PHIEU[entry.type] ?? typeLabel} · ${formatDate(entry.created_at)}`}
        backHref="/inventory/entries"
      />

      <div className="space-y-4 px-3.5 pb-[var(--action-bar-h)] pt-3.5">
        <div className="overflow-hidden rounded-2xl border bg-card">
          <div className={cn("flex items-center gap-2 px-4 py-2.5 text-sm font-semibold", BANG[bang.tone])} data-testid="bang-trang-thai">
            {bang.tone === "xanh" ? <Check className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
            {bang.text}
          </div>
          <div className="grid grid-cols-3 divide-x border-t">
            <div className="px-3 py-2.5">
              <p className="text-xs text-muted-foreground">Sản phẩm</p>
              <p className="text-lg font-bold tabular-nums">{tom.soSku} SKU</p>
            </div>
            <div className="px-3 py-2.5">
              <p className="text-xs text-muted-foreground">{nhanTongSoLuong(entry.type)}</p>
              <p className="text-lg font-bold tabular-nums" data-testid="o-tong-sl">
                {oTong} <span className="text-xs font-normal text-muted-foreground">{tom.donVi}</span>
              </p>
            </div>
            <div className="px-3 py-2.5">
              <p className="text-xs text-muted-foreground">{laXuat ? "Đơn hàng" : "Số dòng"}</p>
              <p className="text-lg font-bold tabular-nums">{laXuat ? refOrders.length : lines.length}</p>
            </div>
          </div>
        </div>

        {refOrders.length > 0 ? (
          <div className="space-y-2">
            {refOrders.map((o) => {
              const ls = o.lines || []
              const cs = ls.map((l) => {
                const f = Number((l as { conversion_factor?: number }).conversion_factor ?? 1) || 1
                return { l, f, base: (Number(l.quantity) || 0) * f, dv: dvCoSo.get(l.product_id) || "" }
              })
              const dvs = new Set(cs.map((x) => x.dv))
              const tong = cs.reduce((s, x) => s + x.base, 0)
              const dv = dvs.size === 1 ? Array.from(dvs)[0] || "đơn vị" : "đơn vị"
              return (
                <div key={o.id} className="overflow-hidden rounded-2xl border bg-card" data-testid="khoi-khach">
                  <div className="flex items-center gap-3 border-b px-3.5 py-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Store className="h-4 w-4" /></span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{o.customer?.store_name || "—"}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {o.order_code} · {ls.length} sản phẩm · {tong.toLocaleString("vi-VN")} {dv}
                      </p>
                    </div>
                  </div>
                  <ul className="divide-y">
                    {cs.map(({ l, f, base, dv: d }, i) => (
                      <li key={i} className="flex items-start gap-3 px-3.5 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium leading-snug">{l.product?.name || "—"}</p>
                          <p className="font-mono text-xs text-muted-foreground">{l.product?.sku || "—"}</p>
                        </div>
                        <p className="shrink-0 text-sm font-semibold tabular-nums">
                          {l.quantity} {l.unit_name}
                          {f > 1 && d && <span className="ml-1 text-xs font-normal text-muted-foreground">({base.toLocaleString("vi-VN")} {d})</span>}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
            <p className="px-0.5 text-xs text-muted-foreground">Dùng khi bàn giao để chia hàng đã gộp cho từng khách.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border bg-card">
            {lines.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <Package className="mx-auto mb-2 h-8 w-8 opacity-40" />
                Phiếu chưa có chi tiết sản phẩm
              </div>
            ) : (
              <ul className="divide-y" data-testid="dong-hang-phieu">
                {lines.map((l, i) => {
                  const f = Number(l.conversion_factor_snapshot ?? 1) || 1
                  const tx = Number(l.qty_in_transaction_uom ?? l.quantity) || 0
                  const base = slCoSoDong(l)
                  const baseUnit = l.product?.base_unit || ""
                  const kk = entry.type === "stocktake"
                  return (
                    <li key={l.id} className="flex items-start gap-3 px-3.5 py-2.5">
                      <SoThuTu n={i + 1} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-snug">{l.product?.name || "—"}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          <span className="font-mono">{l.product?.sku || "—"}</span>
                          {l.batch?.batch_code ? ` · Lô ${l.batch.batch_code}` : ""}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold tabular-nums">
                        {kk ? nhanSoLuong("stocktake", Number(l.quantity) || 0) : tx} {l.unit_name}
                        {!kk && f > 1 && baseUnit && baseUnit !== l.unit_name && (
                          <span className="ml-1 text-xs font-normal text-muted-foreground">({base.toLocaleString("vi-VN")} {baseUnit})</span>
                        )}
                      </p>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}

        <section className="space-y-2">
          <h2 className="text-base font-bold">Thông tin phiếu</h2>
          <dl className="divide-y overflow-hidden rounded-2xl border bg-card">
            {thongTin.map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-4 px-3.5 py-3 text-sm">
                <dt className="shrink-0 text-muted-foreground">{k}</dt>
                <dd className="min-w-0 whitespace-pre-wrap text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {canCancel && (
          <div className="space-y-1.5">
            <Button variant="outline" className="h-12 w-full rounded-2xl text-destructive" onClick={onCancel}>
              <CircleX className="mr-1.5 h-4 w-4" /> Huỷ phiếu
            </Button>
            <p className="px-0.5 text-[11px] text-muted-foreground">
              {entry.status === "posted"
                ? "Phiếu đã ghi sổ: hàng sẽ được hoàn lại kho trong cùng một giao dịch."
                : "Phiếu chưa ghi sổ nên kho không đổi."}
            </p>
          </div>
        )}
        {canDeleteDraft && (
          <Button variant="ghost" className="h-11 w-full text-destructive" onClick={onDelete}>
            <Trash2 className="mr-1.5 h-4 w-4" /> Xoá phiếu nháp
          </Button>
        )}
      </div>

      <StickyActionBar>
        {laXuat ? (
          <>
            {onInDsGiao && (
              <Button variant="outline" className="h-12 flex-1" onClick={onInDsGiao}>In DS giao</Button>
            )}
            <Button className="h-12 flex-1" onClick={onInPhieu}>In phiếu xuất</Button>
          </>
        ) : (
          <Button className="h-12 flex-1" onClick={onInPhieu}>In phiếu</Button>
        )}
      </StickyActionBar>
    </div>
  )
}
