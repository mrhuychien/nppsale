"use client"

/**
 * MÀN DUYỆT ĐIỀU CHỈNH TRÊN ĐIỆN THOẠI (< lg) — chủ nhà 30/09/2026 gửi thiết kế "Duyệt điều chỉnh".
 * Chỉ VẼ: dữ liệu, quyền (`canApprove`) và hai lệnh RPC (`post_stock_adjustment`,
 * `reject_stock_adjustment`) nằm ở trang `/inventory/adjustments`, truyền vào qua props.
 */

import { AlertTriangle, AlertCircle, ChevronRight, FileText, Plus } from "lucide-react"
import Link from "@/components/ui/link"
import { DauTrangTrang } from "@/components/mobile/dau-trang"
import { productsMissingBatch } from "@/lib/inventory/post-adjustment"
import {
  coThuaChuaGiaVon,
  soCoDau,
  tomTatPhieuDieuChinh,
  type TomTatPhieuDieuChinh,
} from "@/lib/inventory/kiem-ke-mobile"
import { cn, formatCurrency, formatDate } from "@/lib/utils"
import { SoThuTu } from "@/components/mobile/so-thu-tu"

export interface DongPhieuMobile {
  id: string
  product_id: string
  batch_id: string | null
  unit_name: string
  quantity: number
  unit_cost: number
  notes: string | null
  product?: { name: string; sku: string; base_unit: string } | null
  batch?: { batch_code?: string; qty_on_hand?: number } | null
}

export interface PhieuDieuChinhMobile {
  id: string
  entry_code: string
  status: string
  notes: string | null
  posted_at: string | null
  created_at: string
  creator?: { full_name?: string } | null
  lines?: DongPhieuMobile[]
}

function BaO({ s }: { s: TomTatPhieuDieuChinh }) {
  return (
    <div className="grid grid-cols-3 divide-x divide-outline-variant/60 border-y border-outline-variant/60">
      <div className="px-3.5 py-2.5">
        <p className="text-xs text-muted-foreground">Hao hụt</p>
        <p className="text-base font-bold text-destructive">{s.shrinkQty > 0 ? `-${s.shrinkQty}` : "0"}</p>
        <p className="truncate text-[11px] text-muted-foreground">{formatCurrency(s.shrinkValue)}</p>
      </div>
      <div className="px-3.5 py-2.5">
        <p className="text-xs text-muted-foreground">Thừa</p>
        <p className="text-base font-bold text-tertiary">{soCoDau(s.surplusQty)}</p>
        <p className="truncate text-[11px] text-muted-foreground">{formatCurrency(s.surplusValue)}</p>
      </div>
      <div className="px-3.5 py-2.5">
        <p className="text-xs text-muted-foreground">Chênh ròng</p>
        <p className={cn("truncate text-base font-bold", s.netValue < 0 ? "text-destructive" : s.netValue > 0 ? "text-tertiary" : "text-on-surface")}>
          {s.netValue > 0 ? "+" : ""}
          {formatCurrency(s.netValue)}
        </p>
      </div>
    </div>
  )
}

export function DuyetDieuChinhMobile({
  loading,
  drafts,
  recentPosted,
  productsWithBatch,
  canApprove,
  approvingId,
  rejectingId,
  expandedId,
  onExpand,
  onApprove,
  onReject,
}: {
  loading: boolean
  drafts: PhieuDieuChinhMobile[]
  recentPosted: PhieuDieuChinhMobile[]
  productsWithBatch: Set<string>
  canApprove: boolean
  approvingId: string | null
  rejectingId: string | null
  expandedId: string | null
  onExpand: (id: string | null) => void
  onApprove: (a: PhieuDieuChinhMobile) => void
  onReject: (a: PhieuDieuChinhMobile) => void
}) {
  return (
    <div className="-mx-4 -mt-4 flex min-h-screen flex-col bg-surface-container-low pb-6" data-testid="duyet-dc-mobile">
      <DauTrangTrang
        title="Duyệt điều chỉnh"
        subtitle="Cập nhật tồn · ghi hao hụt"
        backHref="/inventory"
        action={
          <Link
            href="/inventory/stocktake-adjust"
            className="flex h-10 shrink-0 items-center gap-1 rounded-xl border border-outline-variant/60 px-3 text-sm font-semibold text-primary active:bg-surface-container-low"
          >
            <Plus className="h-4 w-4" /> Kiểm kê
          </Link>
        }
      />

      <div className="space-y-3 px-3.5 pt-3.5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-on-surface">Chờ duyệt</h2>
          {drafts.length > 0 && (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive" data-testid="so-phieu-cho-duyet">
              {drafts.length} phiếu
            </span>
          )}
        </div>

        {loading ? (
          <div className="h-56 animate-pulse rounded-2xl bg-card" />
        ) : drafts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-outline-variant bg-card px-4 py-6 text-center">
            <p className="text-sm font-semibold text-on-surface">Không có phiếu chờ duyệt</p>
            <p className="mt-1 text-xs text-muted-foreground">Phiếu kiểm kê có chênh lệch sẽ hiện ở đây</p>
          </div>
        ) : (
          drafts.map((a) => {
            const lines = a.lines || []
            const s = tomTatPhieuDieuChinh(lines)
            const thieuLo = productsMissingBatch(lines, productsWithBatch)
            const moRong = expandedId === a.id
            const dangBan = approvingId === a.id || rejectingId === a.id
            return (
              <div key={a.id} className="overflow-hidden rounded-2xl border border-outline-variant/60 bg-card" data-testid="phieu-cho-duyet">
                <div className="flex items-start gap-3 px-3.5 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
                    <FileText className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link href={`/inventory/entries/${a.id}`} className="font-mono text-[15px] font-bold text-on-surface">
                        {a.entry_code}
                      </Link>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Chờ duyệt</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {formatDate(a.created_at)}
                      {a.creator?.full_name ? ` · ${a.creator.full_name}` : ""}
                      {` · ${lines.length} dòng`}
                    </p>
                    {a.notes && <p className="mt-0.5 truncate text-xs italic text-muted-foreground">&ldquo;{a.notes}&rdquo;</p>}
                  </div>
                </div>

                <BaO s={s} />

                {coThuaChuaGiaVon(lines) && (
                  <div className="flex items-start gap-2 border-b border-outline-variant/60 bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-800" data-testid="canh-bao-thua-chua-gia-von">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Sản phẩm thừa chưa có giá vốn nên giá trị đang là 0đ
                  </div>
                )}

                {thieuLo.length > 0 && (
                  <div className="space-y-1.5 border-b border-outline-variant/60 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
                    <p className="flex items-center gap-1.5 font-semibold">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      {thieuLo.length} sản phẩm thừa hàng nhưng chưa có lô nào
                    </p>
                    <ul className="list-disc space-y-0.5 pl-5">
                      {thieuLo.map((p) => (
                        <li key={p.productId}>{p.name}</li>
                      ))}
                    </ul>
                    <p>
                      Tạo lô với <strong>số lượng ban đầu = 0</strong> rồi quay lại duyệt.{" "}
                      <Link href="/inventory/batches/new" className="font-semibold text-primary">
                        Tạo lô hàng →
                      </Link>
                    </p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => onExpand(moRong ? null : a.id)}
                  aria-expanded={moRong}
                  className="flex h-11 w-full items-center justify-between border-b border-outline-variant/60 px-3.5 text-sm active:bg-surface-container-low"
                >
                  <span className="text-on-surface">Chi tiết dòng kiểm</span>
                  <span className="flex items-center gap-0.5 font-semibold text-primary">
                    {moRong ? "Ẩn" : "Xem"}
                    <ChevronRight className={cn("h-4 w-4 transition-transform", moRong && "rotate-90")} />
                  </span>
                </button>

                {moRong && (
                  <div className="divide-y divide-outline-variant/60 border-b border-outline-variant/60" data-testid="dong-kiem-chi-tiet">
                    {lines.length === 0 && <p className="px-3.5 py-3 text-xs text-muted-foreground">Phiếu không có dòng.</p>}
                    {lines.map((l, i) => {
                      const diff = Number(l.quantity)
                      const cost = Number(l.unit_cost) || 0
                      const value = Math.abs(diff) * cost
                      return (
                        <div key={l.id} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                          <SoThuTu n={i + 1} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-on-surface">{l.product?.name || "-"}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {l.product?.sku || "-"}
                              {l.batch?.batch_code ? ` · Lô ${l.batch.batch_code}` : ""}
                              {cost > 0 ? ` · GV ${formatCurrency(cost)}` : ""}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className={cn("text-sm font-bold", diff < 0 ? "text-destructive" : diff > 0 ? "text-tertiary" : "")}>
                              {soCoDau(diff)} <span className="font-normal text-muted-foreground">{l.unit_name}</span>
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {value > 0 ? (diff < 0 ? "-" : "+") + formatCurrency(value) : "-"}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {canApprove && (
                  <div className="flex gap-2.5 px-3.5 py-3">
                    <button
                      type="button"
                      onClick={() => onReject(a)}
                      disabled={dangBan}
                      className="h-12 w-[40%] rounded-xl border border-destructive/40 bg-card text-[15px] font-semibold text-destructive active:bg-destructive/5 disabled:opacity-40"
                    >
                      {rejectingId === a.id ? "Đang huỷ…" : "Huỷ phiếu"}
                    </button>
                    {/* Khoá + nói lý do khi còn sản phẩm thừa chưa có lô (như màn máy tính). */}
                    <button
                      type="button"
                      onClick={() => onApprove(a)}
                      disabled={dangBan || thieuLo.length > 0}
                      title={thieuLo.length > 0 ? `Còn ${thieuLo.length} sản phẩm chưa có lô — tạo lô trước rồi mới duyệt được` : undefined}
                      className="h-12 min-w-0 flex-1 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground active:opacity-90 disabled:opacity-40"
                    >
                      {approvingId === a.id ? "Đang duyệt…" : "Duyệt điều chỉnh"}
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}

        {!canApprove && drafts.length > 0 && (
          <p className="flex items-start gap-2 rounded-xl border border-dashed border-outline-variant px-3 py-2.5 text-xs text-muted-foreground">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            Chỉ chủ NPP / quản lý mới duyệt được điều chỉnh. Bạn có thể xem.
          </p>
        )}

        {recentPosted.length > 0 && (
          <>
            <h2 className="pt-3 text-base font-bold text-on-surface">Đã xử lý gần đây</h2>
            <div className="divide-y divide-outline-variant/60 overflow-hidden rounded-2xl border border-outline-variant/60 bg-card" data-testid="da-xu-ly-gan-day">
              {recentPosted.map((a) => {
                const s = tomTatPhieuDieuChinh(a.lines || [])
                return (
                  <Link
                    key={a.id}
                    href={`/inventory/entries/${a.id}`}
                    className="flex min-h-[60px] items-center justify-between gap-3 px-3.5 py-2.5 active:bg-surface-container-low"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm font-bold text-on-surface">{a.entry_code}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatDate(a.posted_at || a.created_at)} · Đã duyệt
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={cn("text-sm font-bold", s.netValue < 0 ? "text-destructive" : s.netValue > 0 ? "text-tertiary" : "text-on-surface")}>
                        {s.netValue > 0 ? "+" : ""}
                        {formatCurrency(s.netValue)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">thừa {formatCurrency(s.surplusValue)}</p>
                    </div>
                  </Link>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
