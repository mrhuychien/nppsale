"use client"

/**
 * KHỐI DỰNG CHUNG CHO HAI MÀN CHI TIẾT — đơn hàng và hóa đơn bán.
 *
 * Theo mẫu chủ nhà chốt: tiêu đề lớn bằng phông đều nét, huy hiệu trạng
 * thái hình viên thuốc có chấm màu, một dòng tóm tắt, hàng nút bên phải;
 * dưới là hai cột — nội dung bên trái, các thẻ tóm tắt bên phải.
 *
 * ⚠ VÌ SAO TÁCH RA. Hai màn này phải giống nhau tới từng khoảng cách;
 * dựng riêng mỗi bên là chúng trôi xa nhau ngay từ lần sửa thứ hai, và
 * người dùng đi lại giữa hai màn suốt ngày sẽ thấy rõ.
 *
 * ⚠ DÙNG BIẾN MÀU CỦA DỰ ÁN, không chép mã màu từ mẫu. Mẫu vẽ bằng màu
 * tuyệt đối (#f6f7f9, #2563eb…); dự án này có sẵn bộ biến ngữ nghĩa và
 * có chế độ in. Chép mã màu là một ngày nào đó đổi bộ màu mà hai màn này
 * nằm im một chỗ.
 */

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Đầu trang: mã chứng từ + huy hiệu trạng thái + dòng tóm tắt + hàng nút.
 *
 * ⚠ MÃ CHỨNG TỪ DÙNG PHÔNG ĐỀU NÉT. Nó là thứ người ta đọc qua điện
 * thoại cho nhau; phông tỉ lệ làm số 1 và chữ l dính nhau.
 */
export function DetailHero({
  code,
  status,
  summary,
  actions,
}: {
  code: string
  status: ReactNode
  /** Một dòng: ngày tạo · số mặt hàng · tuyến · nhân viên. */
  summary: ReactNode
  actions?: ReactNode
}) {
  return (
    <section className="flex flex-wrap items-start gap-5">
      <div className="flex min-w-[260px] flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-bold tracking-tight sm:text-3xl">{code}</h1>
          {status}
        </div>
        <p className="text-sm text-on-surface-variant">{summary}</p>
      </div>
      <div className="min-w-[12px] flex-1" />
      {actions && <div className="flex flex-wrap gap-2.5">{actions}</div>}
    </section>
  )
}

/**
 * Huy hiệu trạng thái: chấm màu + nhãn.
 *
 * ⚠ CHẤM MÀU KHÔNG PHẢI TRANG TRÍ. Nó là thứ phân biệt được khi in đen
 * trắng và khi người dùng không phân biệt được màu — nhãn chữ vẫn nói
 * đủ, chấm chỉ để liếc nhanh.
 */
export function StatusPill({
  label,
  tone,
}: {
  label: string
  /** bg / chữ / chấm — lấy từ `orderTone` hoặc bảng trạng thái hóa đơn. */
  tone: { bg: string; fg: string; accent: string }
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold"
      style={{ background: tone.bg, color: tone.fg }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.accent }} />
      {label}
    </span>
  )
}

/** Hai cột: nội dung chính bên trái, các thẻ tóm tắt bên phải. */
export function DetailColumns({ main, rail }: { main: ReactNode; rail: ReactNode }) {
  return (
    <div className="grid items-start gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">{main}</div>
      {/* ⚠ `self-start` + sticky: cột phải bám theo khi cuộn bảng dài, nhưng
          KHÔNG kéo dài theo cột trái — thẻ tóm tắt cao 2000px là vô nghĩa. */}
      <aside className="space-y-5 self-start lg:sticky lg:top-4">{rail}</aside>
    </div>
  )
}

/** Thẻ có tiêu đề nhỏ in hoa, đúng khuôn mẫu. */
export function DetailCard({
  title,
  aside,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  /** Chữ phụ bên phải tiêu đề — ví dụ "4 dòng · 23 thùng". */
  aside?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn("overflow-hidden rounded-2xl border border-outline-variant/60 bg-surface-container-lowest", className)}>
      {title && (
        <div className="flex items-center justify-between gap-3 border-b border-outline-variant/40 px-4 py-3">
          <h2 className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-on-surface-variant">
            {title}
          </h2>
          {aside && <span className="text-xs text-on-surface-variant">{aside}</span>}
        </div>
      )}
      <div className={cn("px-4 py-3.5", bodyClassName)}>{children}</div>
    </section>
  )
}

/** Một dòng nhãn — giá trị trong thẻ tóm tắt. */
export function DetailRow({
  label,
  value,
  strong,
}: {
  label: ReactNode
  value: ReactNode
  strong?: boolean
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 py-1",
        strong && "border-t border-outline-variant/40 pt-2.5"
      )}
    >
      <span className={cn("text-sm", strong ? "font-extrabold text-on-surface" : "text-on-surface-variant")}>
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums",
          strong ? "text-xl font-extrabold text-on-surface" : "text-sm font-semibold text-on-surface"
        )}
      >
        {value}
      </span>
    </div>
  )
}

/**
 * Tiến trình: các mốc có chấm nối.
 *
 * ⚠ MỐC CHƯA XẢY RA PHẢI NHÌN RA LÀ CHƯA XẢY RA. Vẽ giống mốc đã xong là
 * người đọc tưởng đơn đã đi tới đó — và đó là loại hiểu nhầm kéo theo
 * một cuộc gọi cho kho.
 */
export interface TimelineStep {
  label: string
  detail: string
  state: "done" | "current" | "todo"
}

export function DetailTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="space-y-3.5">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span className="relative flex flex-col items-center">
            <span
              className={cn(
                "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                s.state === "done" && "bg-primary",
                s.state === "current" && "bg-primary ring-4 ring-primary/20",
                s.state === "todo" && "bg-outline-variant"
              )}
            />
            {i < steps.length - 1 && (
              <span className="mt-1 w-px flex-1 bg-outline-variant/60" aria-hidden />
            )}
          </span>
          <span className="min-w-0 flex-1 pb-0.5">
            <span
              className={cn(
                "block text-[13px] font-bold",
                s.state === "todo" ? "text-on-surface-variant" : "text-on-surface"
              )}
            >
              {s.label}
            </span>
            <span className="block text-xs text-on-surface-variant">{s.detail}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

/**
 * Khối KHÁCH HÀNG ở đầu cột nội dung — theo đúng mẫu: ô chữ cái đầu, tên
 * cửa hàng, dòng "điện thoại · địa chỉ", rồi ba ô số liệu bên phải.
 *
 * ⚠ Ô NÀO KHÔNG CÓ SỐ THÌ KHÔNG VẼ, đừng vẽ ô trống có nhãn. Nhãn "CÔNG
 * NỢ / HẠN MỨC" trên một ô rỗng đọc như dữ liệu chưa tải xong.
 */
export function DetailCustomerCard({
  name,
  contact,
  stats,
}: {
  name: string
  /** "0903 812 447 · 128 Dương Bá Trạc, Q.8" */
  contact?: string | null
  stats?: Array<{ label: string; value: ReactNode; bar?: { pct: number; tone: string } | null }>
}) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?"
  return (
    <section className="flex flex-wrap items-center gap-6 rounded-2xl border border-outline-variant/60 bg-surface-container-lowest px-5 py-4">
      <div className="flex min-w-[240px] items-center gap-3.5">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-lg font-bold text-primary">
          {initial}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[17px] font-bold text-on-surface">{name}</span>
          {contact && (
            <span className="mt-0.5 block truncate text-[13px] text-on-surface-variant">{contact}</span>
          )}
        </span>
      </div>
      <div className="min-w-[12px] flex-1" />
      {stats && stats.length > 0 && (
        <div className="flex flex-wrap gap-7">
          {stats.map((s, i) => (
            <div key={i} className="flex min-w-[150px] flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
                {s.label}
              </span>
              <span className="text-[15px] font-semibold tabular-nums text-on-surface">{s.value}</span>
              {s.bar && (
                <span className="block h-[5px] overflow-hidden rounded-full bg-outline-variant/40">
                  {/*
                    ⚠ KẸP VỀ [0,100]. Khách vượt hạn mức cho ra hơn 100% và
                      thanh màu tràn khỏi ô; khách trả dư cho ra số âm và
                      thanh biến mất — cả hai đều là con số thật, chỉ có
                      cách VẼ là phải kẹp.
                  */}
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${Math.min(100, Math.max(0, s.bar.pct))}%`,
                      background: s.bar.tone,
                    }}
                  />
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
