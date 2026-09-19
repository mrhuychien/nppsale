"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { usePageTitleOptional } from "@/components/layout/page-title-context"

interface PageHeaderProps {
  title: string
  description?: string
  /**
   * Giấu dòng mô tả trên điện thoại, vẫn giữ ở máy tính.
   *
   * ⚠ DÙNG CHO NHỮNG MÀN ĐÃ NÓI LẠI ĐÚNG NHỮNG CON SỐ ẤY Ở CHỖ KHÁC.
   * Danh sách đơn / hóa đơn trên điện thoại nay có thẻ đếm theo trạng
   * thái, dải "Tổng tiền hàng" và đầu nhóm ngày — dòng mô tả lặp lại cả
   * ba, chiếm một dải ngang ngay trên thứ người ta mở màn để xem. Trên
   * máy tính không có mấy thứ đó nên dòng mô tả vẫn là nơi duy nhất nói
   * ra, phải giữ.
   *
   * KHÔNG dùng nó để giấu một câu chỉ có ở đây — như vậy là điện thoại
   * mất thông tin mà máy tính có.
   */
  descriptionDesktopOnly?: boolean
  children?: React.ReactNode
  className?: string
  backHref?: string
  backLabel?: string
}

export function PageHeader({
  title,
  description,
  descriptionDesktopOnly,
  children,
  className,
  backHref,
  backLabel,
}: PageHeaderProps) {
  const router = useRouter()
  const { setPageTitle, clearPageTitle } = usePageTitleOptional()

  /**
   * Đẩy tiêu đề lên app bar để mobile không hiện HAI tiêu đề cùng nghĩa.
   *
   * `backHref` truyền nguyên trạng — kể cả khi nó là `undefined`, vì
   * `undefined` mang nghĩa "trang này không có nút back, cho hiện hamburger".
   * Dọn lại khi rời trang, nếu không app bar giữ tiêu đề cũ ở trang sau.
   */
  React.useEffect(() => {
    setPageTitle({ title, backHref })
    return clearPageTitle
  }, [title, backHref, setPageTitle, clearPageTitle])

  const backLink = backHref !== undefined && (
    <div className="mb-1">
      {backHref ? (
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-on-surface-variant hover:text-primary transition-colors group"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-1" />
          <span>{backLabel || "Quay lại"}</span>
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-on-surface-variant hover:text-primary transition-colors group"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-1" />
          <span>{backLabel || "Quay lại"}</span>
        </button>
      )}
    </div>
  )

  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-3 lg:mb-card-gap page-enter", className)}>
      {/* Khối tiêu đề CHỈ hiện từ lg trở lên — mobile đã có app bar. */}
      <div className="hidden lg:block space-y-2 min-w-0">
        {backLink}
        <h1 className="text-2xl lg:text-headline-xl font-bold tracking-tight text-on-surface leading-tight">{title}</h1>
        {description && <p className="text-sm text-on-surface-variant">{description}</p>}
      </div>

      {/* Mô tả vẫn có ích trên mobile (vd "108 đơn hàng") — thu thành 1 dòng
          nhỏ, không phải cả khối tiêu đề. Trừ khi màn đã nói lại đúng
          những con số ấy ở chỗ khác: xem `descriptionDesktopOnly`. */}
      {description && !descriptionDesktopOnly && (
        <p className="lg:hidden text-xs text-on-surface-variant">{description}</p>
      )}

      {children && <div className="flex items-center gap-2 shrink-0 flex-wrap">{children}</div>}
    </div>
  )
}
