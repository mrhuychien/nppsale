"use client"

/**
 * MỘT DÒNG KHÁCH trong danh sách — khuôn theo mẫu chủ nhà gửi.
 *
 * Trước đây mỗi khách là một THẺ cao ~180px với năm nút (Gọi, Tạo đơn,
 * Ghé thăm, Thu tiền, Kiểm tồn). Màn hình 6 inch vì thế chỉ chứa ba
 * khách — muốn tìm một cửa hàng trong tuyến bốn chục điểm là cuộn mười
 * lần. Mẫu mới đổi sang DÒNG: một khách một dòng ~60px, và mọi hành động
 * dời vào màn chi tiết.
 *
 * ⚠ CẢ DÒNG LÀ MỘT VÙNG CHẠM. Đây chính là lỗi các bản danh sách cũ mắc
 * phải — rải nút 32px khắp thẻ rồi người dùng bấm trượt sang nút bên
 * cạnh. Dòng này không có nút con nào.
 *
 * ⚠ CỘT PHẢI LÀ TIỀN, KHÔNG PHẢI MŨI TÊN. Người bán quét danh sách để
 * tìm "ai đang nợ" và "ai lâu chưa đặt"; một mũi tên ">" chiếm đúng chỗ
 * của hai câu trả lời đó.
 */

import Link from "next/link"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import type { RowAccent } from "@/lib/customers/list-view"

const ACCENT_BAR: Record<RowAccent, string> = {
  visited: "bg-tertiary",
  overdue: "bg-error",
  today: "bg-primary",
  cold: "bg-warning",
  none: "bg-transparent",
}

/**
 * ⚠ DÙNG BỘ `*-fixed` CHO Ô TRÒN. `primary-container` trong bộ token này
 * là nền ĐẬM (#0052cc) với chữ sáng — đặt ở ô tròn 36px thì cả danh sách
 * lốm đốm những chấm xanh đặc, đúng thứ mẫu tránh. `primary-fixed` mới là
 * nền nhạt chữ đậm như mẫu.
 */
const AVATAR_TONE: Record<RowAccent, string> = {
  visited: "bg-tertiary-fixed text-on-tertiary-fixed",
  overdue: "bg-error-container text-on-error-container",
  today: "bg-primary-fixed text-on-primary-fixed-variant",
  cold: "bg-primary-fixed text-on-primary-fixed-variant",
  none: "bg-primary-fixed text-on-primary-fixed-variant",
}

export interface CustomerRowTag {
  label: string
  tone: "danger" | "warning" | "success"
}

export function CustomerListRow({
  href,
  accent,
  avatar,
  name,
  meta,
  tags,
  rightTop,
  rightTopTone = "default",
  rightBottom,
  divider,
}: {
  href: string
  accent: RowAccent
  /** Số điểm dừng khi đang đi tuyến, dấu ✓ khi đã ghé, hoặc chữ cái đầu. */
  avatar: string
  name: string
  /** Dòng phụ: phường · chủ quán · người phụ trách. */
  meta: string
  tags?: CustomerRowTag[]
  rightTop: string
  rightTopTone?: "default" | "danger" | "success" | "muted"
  rightBottom: string
  divider: boolean
}) {
  return (
    <Link
      href={href}
      className={cn(
        "relative flex min-h-[60px] items-center gap-3 py-2.5 pl-4 pr-3 active:bg-surface-container lg:hover:bg-surface-container/60",
        divider && "border-t border-outline-variant/40"
      )}
    >
      {/* Vạch màu — dấu hiệu duy nhất đọc được khi lướt nhanh bằng đuôi mắt. */}
      <span
        aria-hidden
        className={cn("absolute inset-y-0 left-0 w-1", ACCENT_BAR[accent])}
      />
      <span
        aria-hidden
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-bold tabular-data",
          AVATAR_TONE[accent]
        )}
      >
        {avatar}
      </span>

      <div className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-bold leading-tight text-on-surface">
          {name}
        </span>
        <span className="mt-0.5 block truncate text-[12px] font-medium text-on-surface-variant">
          {meta}
        </span>
        {/* ⚠ `<Badge>` là `<div>`. Bọc trong `<span>` là HTML sai chỗ và
            React báo lệch hydration — khối này phải là `<div>`. */}
        {tags && tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {tags.map((t) => (
              <Badge
                key={t.label}
                variant={t.tone === "danger" ? "danger" : t.tone === "success" ? "success" : "warning"}
                className="px-2 py-0 text-[10px]"
              >
                {t.label}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 text-right">
        <span
          className={cn(
            "block text-[13px] font-bold tabular-data",
            rightTopTone === "danger"
              ? "text-error"
              : rightTopTone === "success"
                ? "text-tertiary"
                : rightTopTone === "muted"
                  ? "text-on-surface-variant"
                  : "text-on-surface"
          )}
        >
          {rightTop}
        </span>
        <span className="mt-0.5 block text-[11px] font-medium text-on-surface-variant">
          {rightBottom}
        </span>
      </div>
    </Link>
  )
}
