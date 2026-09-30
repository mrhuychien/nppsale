"use client"

/**
 * MÀN KIỂM KÊ TRÊN ĐIỆN THOẠI (< lg) — chủ nhà 30/09/2026 gửi thiết kế "Kiểm kê".
 * Chỉ là phần VẼ: mọi trạng thái (dòng, ô tìm, ghi chú) và lệnh ghi nằm ở trang
 * `/inventory/stocktake-adjust` — màn này nhận qua props, không tự đọc / ghi gì.
 * Thanh đáy riêng (Huỷ + Gửi) → route phải ẩn nav đáy + app bar chuẩn.
 */

import { Search, Warehouse, Trash2, ScanBarcode } from "lucide-react"
import { DauTrangTrang } from "@/components/mobile/dau-trang"
import { SellBottomBar } from "@/components/sell/bottom-bar"
import { SEARCH_FIELD_PROPS, HIDE_NATIVE_CLEAR } from "@/lib/ui/search-field"
import { chenhCuaDong, nutGuiKiemKe, soCoDau, type TomTatKiemKe } from "@/lib/inventory/kiem-ke-mobile"
import { cn, formatCurrency } from "@/lib/utils"

export interface DongKiemKeMobile {
  key: string
  productId: string
  sku: string
  name: string
  baseUnit: string
  batchCode: string | null
  batchCost: number
  systemQty: number
  actualQty: string
  notes: string
}

export interface KetQuaTimKiemKe {
  id: string
  sku: string
  name: string
  base_unit: string
  batches?: Array<{ qty_on_hand?: number | null }>
}

export function KiemKeMobile({
  rows,
  tomTat,
  search,
  onSearch,
  searchOpen,
  onSearchOpen,
  matches,
  onChon,
  onTaiToanBo,
  soSkuTon,
  onSuaDong,
  onXoaDong,
  notes,
  onNotes,
  saving,
  onGui,
  onHuy,
}: {
  rows: DongKiemKeMobile[]
  tomTat: TomTatKiemKe
  search: string
  onSearch: (v: string) => void
  searchOpen: boolean
  onSearchOpen: (v: boolean) => void
  matches: KetQuaTimKiemKe[]
  onChon: (p: KetQuaTimKiemKe) => void
  onTaiToanBo: () => void
  /** Số SKU đang có tồn (null = chưa biết → không hiện số). */
  soSkuTon: number | null
  onSuaDong: (key: string, patch: Partial<DongKiemKeMobile>) => void
  onXoaDong: (key: string) => void
  notes: string
  onNotes: (v: string) => void
  saving: boolean
  onGui: () => void
  onHuy: () => void
}) {
  const nut = nutGuiKiemKe(tomTat, saving)
  const rong = tomTat.totalDiffValue

  return (
    <div className="-mx-4 -mt-4 flex min-h-screen flex-col bg-surface-container-low pb-32" data-testid="kiem-ke-mobile">
      <DauTrangTrang title="Kiểm kê" subtitle="Nhập tồn thực tế · tất cả kho" backHref="/inventory" />

      {/* Dải 3 ô: Hao hụt / Thừa / Chênh ròng */}
      <div className="grid grid-cols-3 divide-x divide-outline-variant/60 border-b border-outline-variant/60 bg-card" data-testid="kiem-ke-tom-tat">
        <div className="px-3.5 py-2.5">
          <p className="text-xs text-muted-foreground">Hao hụt</p>
          <p className="text-base font-bold text-destructive">{tomTat.shrinkageQty > 0 ? `-${tomTat.shrinkageQty}` : "0"}</p>
          <p className="truncate text-[11px] text-muted-foreground">{formatCurrency(tomTat.shrinkageValue)}</p>
        </div>
        <div className="px-3.5 py-2.5">
          <p className="text-xs text-muted-foreground">Thừa</p>
          <p className="text-base font-bold text-tertiary">{soCoDau(tomTat.surplusQty)}</p>
          <p className="truncate text-[11px] text-muted-foreground">{formatCurrency(tomTat.surplusValue)}</p>
        </div>
        <div className="px-3.5 py-2.5">
          <p className="text-xs text-muted-foreground">Chênh ròng</p>
          <p className={cn("truncate text-base font-bold", rong < 0 ? "text-destructive" : rong > 0 ? "text-tertiary" : "text-on-surface")}>
            {rong > 0 ? "+" : ""}
            {formatCurrency(rong)}
          </p>
          <p className="text-[11px] text-muted-foreground" data-testid="kiem-ke-da-dem">
            {tomTat.daDem}/{tomTat.tongDong} đã đếm
          </p>
        </div>
      </div>

      <div className="space-y-3 px-3.5 pt-3.5">
        {/* Khung tìm + tải toàn bộ tồn */}
        <div className="relative rounded-2xl border border-outline-variant/60 bg-card">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => {
                onSearch(e.target.value)
                onSearchOpen(true)
              }}
              onFocus={() => onSearchOpen(true)}
              onBlur={() => window.setTimeout(() => onSearchOpen(false), 150)}
              placeholder="Thêm SKU hoặc tên sản phẩm"
              aria-label="Thêm SKU hoặc tên sản phẩm"
              {...SEARCH_FIELD_PROPS}
              className={cn("h-12 w-full rounded-t-2xl bg-transparent pl-10 pr-10 text-base text-on-surface outline-none", HIDE_NATIVE_CLEAR)}
            />
            <ScanBarcode className="pointer-events-none absolute right-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
          </div>
          {searchOpen && matches.length > 0 && (
            <div className="absolute inset-x-0 top-12 z-20 max-h-72 overflow-y-auto rounded-xl border bg-card shadow-lg" data-testid="kiem-ke-goi-y">
              {matches.map((p) => {
                const ton = (p.batches || []).reduce((s, b) => s + Number(b.qty_on_hand || 0), 0)
                const daCo = rows.some((r) => r.productId === p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={daCo}
                    /* Chặn blur trước click: không thì hộp đóng mất trước khi chạm ăn. */
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onChon(p)}
                    className="flex min-h-[52px] w-full items-center justify-between gap-2 border-b px-3.5 py-2.5 text-left last:border-0 active:bg-surface-container-low disabled:opacity-40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-on-surface">{p.name}</span>
                      <span className="block font-mono text-xs text-muted-foreground">
                        {p.sku}
                        {daCo ? " · Đã trong danh sách" : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-sm font-semibold">
                      {ton} <span className="font-normal text-muted-foreground">{p.base_unit}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          <button
            type="button"
            onClick={onTaiToanBo}
            className="flex h-11 w-full items-center gap-2.5 border-t border-outline-variant/60 px-3.5 text-sm font-semibold text-primary active:bg-surface-container-low"
          >
            <Warehouse className="h-[18px] w-[18px]" />
            Tải toàn bộ tồn kho{soSkuTon !== null ? ` (${soSkuTon} SKU)` : ""}
          </button>
        </div>

        {/* Danh sách kiểm */}
        <div className="flex items-baseline justify-between gap-2 pt-1">
          <h2 className="text-base font-bold text-on-surface">Danh sách kiểm ({rows.length})</h2>
          {rows.length > 0 && <p className="text-xs text-muted-foreground">Bấm &ldquo;Khớp&rdquo; nếu đếm đúng</p>}
        </div>

        {rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-outline-variant bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            Chưa có sản phẩm — tìm ở ô trên hoặc tải toàn bộ tồn kho.
          </p>
        ) : (
          <div className="space-y-2.5">
            {rows.map((r) => {
              const diff = chenhCuaDong(r)
              const lech = diff !== null && diff !== 0
              return (
                <div
                  key={r.key}
                  data-testid="dong-kiem-ke"
                  className={cn(
                    "rounded-2xl border bg-card px-3.5 py-3",
                    lech ? (diff! < 0 ? "border-destructive/40" : "border-tertiary/40") : "border-outline-variant/60"
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-semibold leading-tight text-on-surface">{r.name}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {r.sku}
                        {r.batchCode ? ` · Lô ${r.batchCode}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Bỏ ${r.name} khỏi danh sách`}
                      onClick={() => onXoaDong(r.key)}
                      className="-mr-2 -mt-1.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted-foreground active:bg-surface-container-low"
                    >
                      <Trash2 className="h-[18px] w-[18px]" />
                    </button>
                  </div>

                  <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-end gap-2.5">
                    <div>
                      <p className="text-[11px] font-semibold text-muted-foreground">Hệ thống</p>
                      <p className="mt-2 text-sm font-bold text-on-surface">
                        {r.systemQty} <span className="font-normal text-muted-foreground">{r.baseUnit}</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-muted-foreground">Thực tế</p>
                      <div className="mt-1 flex gap-1.5">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={r.actualQty}
                          onChange={(e) => onSuaDong(r.key, { actualQty: e.target.value })}
                          placeholder="Đếm"
                          aria-label={`Tồn thực tế ${r.name}`}
                          className="h-11 w-[72px] rounded-xl border border-outline-variant bg-card text-center text-base font-semibold text-on-surface outline-none focus:border-primary"
                        />
                        <button
                          type="button"
                          onClick={() => onSuaDong(r.key, { actualQty: String(r.systemQty) })}
                          className="h-11 rounded-xl bg-surface-container-low px-2.5 text-sm font-semibold text-on-surface active:bg-surface-container"
                        >
                          Khớp
                        </button>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] font-semibold text-muted-foreground">Chênh lệch</p>
                      {diff === null ? (
                        <p className="mt-2 text-sm text-muted-foreground">Chưa đếm</p>
                      ) : (
                        <>
                          <p
                            className={cn(
                              "mt-2 text-sm font-bold",
                              diff < 0 ? "text-destructive" : diff > 0 ? "text-tertiary" : "text-muted-foreground"
                            )}
                            data-testid="chenh-dong-kiem-ke"
                          >
                            {diff === 0 ? "Khớp" : soCoDau(diff)}
                          </p>
                          {lech && r.batchCost > 0 && (
                            <p className="text-[11px] text-muted-foreground">{formatCurrency(diff! * r.batchCost)}</p>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Ghi chú dòng chỉ khi có chênh (luồng cũ ghi `notes` theo dòng). */}
                  {lech && (
                    <input
                      value={r.notes}
                      onChange={(e) => onSuaDong(r.key, { notes: e.target.value })}
                      placeholder="Lý do chênh (hỏng, rớt vỡ…)"
                      aria-label={`Ghi chú ${r.name}`}
                      className="mt-2.5 h-10 w-full rounded-xl border border-outline-variant/60 bg-surface-container-low px-3 text-base text-on-surface outline-none focus:border-primary"
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="space-y-1.5 pt-1">
          <label htmlFor="ghi-chu-phieu-kk" className="text-[13px] font-medium text-muted-foreground">
            Ghi chú phiếu
          </label>
          <textarea
            id="ghi-chu-phieu-kk"
            rows={3}
            value={notes}
            onChange={(e) => onNotes(e.target.value)}
            placeholder="VD: Kiểm kê định kỳ tháng 9"
            className="w-full resize-none rounded-2xl border border-outline-variant/60 bg-card px-3.5 py-3 text-base text-on-surface outline-none focus:border-primary"
          />
          {tomTat.shrinkageValue > 0 && (
            <p className="text-xs text-amber-700">
              Hao hụt {formatCurrency(tomTat.shrinkageValue)} ghi vào chi phí khi phiếu được duyệt điều chỉnh.
            </p>
          )}
        </div>
      </div>

      <SellBottomBar className="kb-hide flex items-center gap-2.5 lg:hidden">
        <button
          type="button"
          onClick={onHuy}
          className="h-[52px] w-[96px] shrink-0 rounded-2xl border border-outline-variant bg-card text-[15px] font-semibold text-on-surface active:bg-surface-container-low"
        >
          Huỷ
        </button>
        <button
          type="button"
          onClick={onGui}
          disabled={nut.khoa}
          data-testid="kiem-ke-gui"
          className="h-[52px] min-w-0 flex-1 truncate rounded-2xl bg-primary px-3 text-[15px] font-semibold text-primary-foreground active:opacity-90 disabled:opacity-40"
        >
          {nut.nhan}
        </button>
      </SellBottomBar>
    </div>
  )
}
