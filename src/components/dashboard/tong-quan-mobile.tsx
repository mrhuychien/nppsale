"use client"

/**
 * TỔNG QUAN — ĐIỆN THOẠI theo thiết kế "tongquan" (chủ nhà 30/09/2026). Chỉ vẽ: số liệu do
 * `dashboard/page.tsx` nạp (ba RPC thuần + đếm lô + 5 đơn gần đây) rồi truyền vào.
 * ⚠ Route /dashboard phải ẩn app bar chuẩn trên điện thoại (`hidesMobileAppBar`), không thì
 *   hai hàng tiêu đề.
 */

import Link from "@/components/ui/link"
import { CheckCircle2, CreditCard, Package, ReceiptText, Hourglass } from "lucide-react"
import { DauTrangXanh } from "@/components/mobile/dau-trang"
import { cn, formatCurrency } from "@/lib/utils"
import {
  KY_TONG_QUAN,
  chiaKenh,
  demViecCanXuLy,
  tienRutGon,
  trungBinhDon,
  type KyTongQuan,
} from "@/lib/dashboard/tong-quan"

export interface TongQuanMobileProps {
  isSales: boolean
  subtitle: string
  period: KyTongQuan
  onPeriod: (p: KyTongQuan) => void
  revenue: number
  orders: number
  openReceivables: number
  overdueCount: number
  lowStockCount: number
  expiringSoonCount: number
  channels: ReadonlyArray<{ channel: string; revenue: number }>
  topCustomers: ReadonlyArray<{ customer_id: string; store_name: string; total: number }>
  recentOrders: ReadonlyArray<{ id: string; order_code: string; total: number; customer?: { store_name?: string | null } | null }>
}

/** Sáu nấc xanh của thanh xếp chồng — từ token primary, không mã màu cứng. */
const KENH_MAU = ["bg-primary", "bg-primary/75", "bg-primary/55", "bg-primary/40", "bg-primary/25", "bg-primary/15"]

export function TongQuanMobile(p: TongQuanMobileProps) {
  const tenKy = KY_TONG_QUAN.find((k) => k.value === p.period)?.ten ?? "tháng này"
  const viec = demViecCanXuLy({ quaHan: p.overdueCount, tonThap: p.lowStockCount, sapHetHan: p.expiringSoonCount })
  const kenh = chiaKenh(p.channels)
  const topMax = Math.max(1, ...p.topCustomers.map((c) => c.total))

  return (
    <div className="-mx-4 -mt-4 bg-surface-container-low pb-4" data-testid="tong-quan-mobile">
      <DauTrangXanh title={p.isSales ? "Tổng quan của tôi" : "Tổng quan"} subtitle={p.subtitle} className="pb-14" />

      <div className="-mt-11 space-y-5 px-3.5">
        {/* Thẻ nổi: kỳ + doanh thu + số đơn */}
        <section className="space-y-3.5 rounded-2xl border border-outline-variant/60 bg-card p-3 pb-4 shadow-card">
          <div role="tablist" aria-label="Kỳ" className="grid grid-cols-4 gap-1 rounded-xl bg-surface-container-low p-1">
            {KY_TONG_QUAN.map((k) => (
              <button
                key={k.value}
                type="button"
                role="tab"
                aria-selected={p.period === k.value}
                onClick={() => p.onPeriod(k.value)}
                className={cn(
                  "h-9 rounded-lg text-[13px] font-medium transition-colors",
                  p.period === k.value ? "bg-card text-primary font-semibold shadow-sm" : "text-on-surface-variant",
                )}
              >
                {k.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_auto] items-end gap-3 px-1">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-muted-foreground">
                {p.isSales ? `Doanh số của tôi ${tenKy}` : `Doanh thu ${tenKy}`}
              </p>
              <p className="mt-1 truncate text-[28px] font-bold leading-tight tracking-tight tabular-data" data-testid="tq-doanh-thu">
                {tienRutGon(p.revenue)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[13px] font-medium text-muted-foreground">Đơn hàng</p>
              <p className="mt-1 text-xl font-bold tabular-data" data-testid="tq-so-don">
                {p.orders.toLocaleString("vi-VN")}
              </p>
            </div>
          </div>
          <p className="-mt-2 px-1 text-xs text-muted-foreground tabular-data">
            {formatCurrency(p.revenue)} · trung bình {tienRutGon(trungBinhDon(p.revenue, p.orders))}/đơn
          </p>
        </section>

        {/* Cần xử lý */}
        <section>
          <TieuDeKhoi title="Cần xử lý">
            {viec > 0 && (
              <span className="rounded-full bg-error/10 px-2 py-0.5 text-xs font-semibold text-error" data-testid="tq-so-viec">
                {viec} việc
              </span>
            )}
          </TieuDeKhoi>
          <div className="divide-y divide-outline-variant/40 overflow-hidden rounded-2xl border border-outline-variant/60 bg-card">
            <DongViec
              icon={CreditCard}
              tone="error"
              title={p.overdueCount > 0 ? `${p.overdueCount} khoản nợ quá hạn` : "Không có khoản nợ quá hạn"}
              detail={`Công nợ mở ${tienRutGon(p.openReceivables)}`}
              href="/receivables"
              action="Nhắc nợ"
            />
            <DongViec
              icon={Package}
              tone="warning"
              title={`${p.lowStockCount.toLocaleString("vi-VN")} lô tồn kho thấp`}
              detail="Tồn dưới 10 đơn vị · cần nhập hàng"
              href="/inventory"
              action="Xem kho"
            />
            {p.expiringSoonCount > 0 ? (
              <DongViec
                icon={Hourglass}
                tone="warning"
                title={`${p.expiringSoonCount.toLocaleString("vi-VN")} lô hết hạn trong 30 ngày tới`}
                detail="Ưu tiên xuất trước"
                href="/inventory"
                action="Xem lô"
              />
            ) : (
              <p className="flex items-center gap-2 px-3.5 py-3 text-[13px] font-medium text-emerald-700" data-testid="tq-khong-het-han">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Không có lô hàng hết hạn trong 30 ngày tới
              </p>
            )}
          </div>
        </section>

        {/* Doanh thu theo kênh (customers.channel, thuần — dashboard_channel_revenue) */}
        {kenh.items.length > 0 && (
          <section data-testid="tq-kenh">
            <TieuDeKhoi title="Doanh thu theo kênh">
              <Link href="/reports/channels" className="text-[13px] font-semibold text-primary">
                {kenh.soKenh} kênh
              </Link>
            </TieuDeKhoi>
            <div className="space-y-3 rounded-2xl border border-outline-variant/60 bg-card p-3.5">
              <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-surface-container">
                {kenh.items.map((k, i) =>
                  k.width > 0 ? (
                    <div key={k.channel} className={cn("h-full", KENH_MAU[i] ?? KENH_MAU[5])} style={{ width: `${k.width}%` }} />
                  ) : null,
                )}
              </div>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {kenh.items.map((k, i) => (
                  <li key={k.channel} className="flex items-center gap-2 text-[13px]">
                    <span className={cn("h-2 w-2 shrink-0 rounded-sm", KENH_MAU[i] ?? KENH_MAU[5])} />
                    <span className="min-w-0 flex-1 truncate text-on-surface">{k.channel}</span>
                    <span className="font-semibold tabular-data">{k.percent}%</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* Top khách hàng (doanh thu hoá đơn thuần — dashboard_top_customers) */}
        <section data-testid="tq-top-khach">
          <TieuDeKhoi title="Top khách hàng">
            <Link href="/reports/customers" className="text-[13px] font-semibold text-primary">
              Tất cả
            </Link>
          </TieuDeKhoi>
          <div className="rounded-2xl border border-outline-variant/60 bg-card px-3.5 py-2">
            {p.topCustomers.length === 0 ? (
              <p className="py-5 text-center text-sm text-muted-foreground">Chưa có dữ liệu</p>
            ) : (
              <ol>
                {p.topCustomers.map((c, i) => (
                  <li key={c.customer_id} className="flex items-center gap-3 py-2">
                    <span className="w-4 shrink-0 text-xs text-muted-foreground tabular-data">{i + 1}</span>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-baseline justify-between gap-2 text-[13px]">
                        <span className="truncate font-semibold">{c.store_name}</span>
                        <span className="shrink-0 font-semibold tabular-data">{tienRutGon(c.total)}</span>
                      </div>
                      <div className="h-1 overflow-hidden rounded-full bg-surface-container">
                        <div
                          className="h-full rounded-full bg-primary/70"
                          style={{ width: `${Math.max(2, Math.round((Math.max(0, c.total) / topMax) * 100))}%` }}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>

        {/* Đơn hàng gần đây (số liệu HOẠT ĐỘNG — tiền đơn, không phải doanh thu) */}
        <section data-testid="tq-don-gan-day">
          <TieuDeKhoi title="Đơn hàng gần đây">
            <Link href="/orders" className="text-[13px] font-semibold text-primary">
              Tất cả
            </Link>
          </TieuDeKhoi>
          <div className="divide-y divide-outline-variant/40 overflow-hidden rounded-2xl border border-outline-variant/60 bg-card">
            {p.recentOrders.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Chưa có đơn hàng</p>
            ) : (
              p.recentOrders.map((o) => (
                <Link key={o.id} href={`/orders/${o.id}`} className="flex min-h-[60px] items-center gap-3 px-3.5 py-2.5 active:bg-surface-container-low">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    <ReceiptText className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-on-surface">{o.customer?.store_name || "-"}</span>
                    <span className="block text-xs text-muted-foreground">{o.order_code}</span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-on-surface tabular-data">{formatCurrency(Number(o.total) || 0)}</span>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function TieuDeKhoi({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-2 px-0.5">
      <h2 className="text-base font-semibold text-on-surface">{title}</h2>
      {children}
    </div>
  )
}

function DongViec({
  icon: Icon,
  tone,
  title,
  detail,
  href,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>
  tone: "error" | "warning"
  title: string
  detail: string
  href: string
  action: string
}) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <span
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
          tone === "error" ? "bg-error/10 text-error" : "bg-amber-50 text-amber-700",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-on-surface">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      </div>
      <Link
        href={href}
        className="tap inline-flex h-9 shrink-0 items-center rounded-lg border border-outline-variant/60 bg-card px-3 text-[13px] font-semibold text-primary active:bg-surface-container-low"
      >
        {action}
      </Link>
    </div>
  )
}

/** Dùng lại cho màn lỗi / đang tải trên điện thoại (app bar chuẩn đã ẩn). */
export function TongQuanMobileKhung({ subtitle, children }: { subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="-mx-4 -mt-4 lg:hidden">
      <DauTrangXanh title="Tổng quan" subtitle={subtitle} />
      <div className="space-y-3 p-3.5">{children}</div>
    </div>
  )
}
