"use client"

/**
 * LƯỚI DANH SÁCH CHỨNG TỪ TRÊN MÁY TÍNH — khuôn chung, rút từ `desktop-invoice-table`.
 *
 * ⚠ CHỦ NHÀ 27/09/2026: "Làm chung form hiển thị danh sách cho toàn bộ các danh sách theo
 *   form đang dùng cho Đơn hàng, hóa đơn, trả hàng." Cùng tiêu đề chữ hoa nhỏ trên nền
 *   `surface-container-low`, cùng hàng cao 52px, cùng cách bấm: BẤM DÒNG → XEM NHANH, BẤM
 *   MÃ → CHI TIẾT (`DocCodeLink` chặn nổi bọt), cùng biểu tượng con mắt ở cột cuối.
 *
 * ⚠ MỘT PHÉP DỰNG CỘT, DÙNG CHO CẢ TIÊU ĐỀ LẪN DÒNG — chép hai chỗ là một ngày bật một cột
 *   lên và tiêu đề lệch khỏi dữ liệu đúng một ô.
 * ⚠ HAI CÁCH SẮP XẾP — chọn đúng theo cách màn nạp dữ liệu:
 *   - Màn nạp ĐỦ (cả danh sách nằm trong `rows`): cột có `sort` so sánh, bảng tự xếp trong bộ nhớ.
 *   - Màn PHÂN TRANG Ở MÁY CHỦ: truyền `sort` + `onSortChange`, bảng KHÔNG xếp gì cả — chỉ vẽ
 *     mũi tên và báo khoá cột; màn gửi `.order(...)` xuống máy chủ (`apSapXep`,
 *     `src/lib/list/sap-xep-may-chu.ts`). Xếp trong bộ nhớ trên một trang 20 dòng là "Còn lại ↓"
 *     ra khoản lớn nhất của 20 dòng chứ không phải của cả sổ. Cột bấm được là cột `sortable`.
 */

import { useMemo, useState, type ReactNode } from "react"
import Link from "@/components/ui/link"
import { ArrowDown, ArrowUp, Eye } from "lucide-react"
import { cn } from "@/lib/utils"
import { doiSapXep, type DocSort } from "@/lib/list/sap-xep-may-chu"

export interface DocColumn<T> {
  key: string
  /** Chữ tiêu đề — hoặc một ô (vd hộp chọn tất cả của chế độ chọn nhiều). */
  label: ReactNode
  /** Rãnh lưới: "140px", "minmax(200px,1.5fr)". */
  width: string
  align?: "right"
  /** Màn nạp đủ: có thì tiêu đề bấm được để xếp trong bộ nhớ. Bảng xếp ở máy chủ bỏ qua. */
  sort?: (a: T, b: T) => number
  /** Bảng xếp ở máy chủ (`onSortChange`): bật thì tiêu đề bấm được. Cột tính ra thì để trống. */
  sortable?: boolean
  render: (row: T) => ReactNode
}

/** Cột này có nút xếp không — tách ra để chốt kiểm được hai chế độ. */
export function cotXepDuoc<T>(c: DocColumn<T>, mayChu: boolean): boolean {
  return mayChu ? !!c.sortable : !!c.sort
}

/**
 * Thứ tự dòng bảng vẽ ra. ⚠ Xếp ở máy chủ thì GIỮ NGUYÊN thứ tự máy chủ trả — xếp lại trong
 * bộ nhớ là xếp trên một trang.
 */
export function sapXepDong<T>(rows: T[], columns: DocColumn<T>[], sort: DocSort | null, mayChu: boolean): T[] {
  if (mayChu || !sort) return rows
  const col = columns.find((c) => c.key === sort.key)
  if (!col?.sort) return rows
  const dir = sort.dir === "asc" ? 1 : -1
  return [...rows].sort((a, b) => dir * col.sort!(a, b))
}

export function DocTable<T extends { id: string }>({
  rows,
  columns,
  activeId,
  onOpen,
  minWidth = 980,
  rowTestId,
  sort: sortNgoai,
  onSortChange,
}: {
  rows: T[]
  /** Các cột ĐANG HIỆN, đúng thứ tự — nơi gọi lọc theo `useListViewPrefs`. */
  columns: DocColumn<T>[]
  /** Dòng đang mở ở ngăn xem nhanh — tô nền để biết đang xem dòng nào. */
  activeId?: string | null
  /** Bấm dòng. Bỏ trống thì dòng không bấm được (và không có con mắt). */
  onOpen?: (row: T) => void
  minWidth?: number
  rowTestId?: string
  /** Xếp ở MÁY CHỦ: thứ tự đang áp (để vẽ mũi tên). Đi cùng `onSortChange`. */
  sort?: DocSort | null
  /** Có thì bảng không tự xếp — báo thứ tự mới để màn hỏi lại máy chủ. */
  onSortChange?: (next: DocSort) => void
}) {
  const mayChu = !!onSortChange
  const [sortTaiCho, setSortTaiCho] = useState<DocSort | null>(null)
  const sort = mayChu ? sortNgoai ?? null : sortTaiCho
  const sorted = useMemo(() => sapXepDong(rows, columns, sort, mayChu), [rows, columns, sort, mayChu])
  const bam = (key: string) => {
    if (onSortChange) onSortChange(doiSapXep(sort, key))
    else setSortTaiCho((cur) => doiSapXep(cur, key))
  }

  const tracks = [...columns.map((c) => c.width), onOpen ? "64px" : null].filter(Boolean).join(" ")
  const head = "flex items-center px-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-on-surface-variant"
  const sortBtn = cn(head, "h-full w-full text-left hover:text-on-surface")

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth }}>
        <div
          role="row"
          className="grid h-[42px] items-center border-b border-outline-variant/40 bg-surface-container-low px-2"
          style={{ gridTemplateColumns: tracks }}
        >
          {columns.map((c) =>
            cotXepDuoc(c, mayChu) ? (
              <button
                key={c.key}
                type="button"
                data-sort-key={c.key}
                data-sort-dir={sort?.key === c.key ? sort.dir : undefined}
                onClick={() => bam(c.key)}
                className={cn(sortBtn, c.align === "right" && "justify-end")}
              >
                {c.label}
                {sort?.key === c.key &&
                  (sort.dir === "asc" ? <ArrowUp className="ml-1 inline h-3 w-3" /> : <ArrowDown className="ml-1 inline h-3 w-3" />)}
              </button>
            ) : (
              <span key={c.key} className={cn(head, c.align === "right" && "justify-end")}>{c.label}</span>
            )
          )}
          {onOpen && <span className={head} />}
        </div>

        {sorted.map((r) => (
          <div
            key={r.id}
            role="row"
            data-testid={rowTestId}
            onClick={onOpen ? () => onOpen(r) : undefined}
            className={cn(
              "grid min-h-[52px] items-center border-b border-outline-variant/30 px-2 transition-colors",
              onOpen && "cursor-pointer hover:bg-surface-container-low",
              activeId === r.id ? "bg-surface-container-low" : "bg-transparent"
            )}
            style={{ gridTemplateColumns: tracks }}
          >
            {columns.map((c) => (
              <span
                key={c.key}
                className={cn(
                  "min-w-0 px-2 text-[13px] text-on-surface",
                  c.align === "right" && "text-right font-extrabold tabular-data"
                )}
              >
                {c.render(r)}
              </span>
            ))}
            {onOpen && (
              <span className="grid place-items-center">
                <Eye className="h-4 w-4 text-on-surface-variant" />
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Mã chứng từ ở cột đầu — sang trang chi tiết.
 *
 * ⚠ CHẶN NỔI BỌT. Cả hàng đã mở ngăn xem nhanh; không chặn thì bấm mã là chạy cả hai
 *   lệnh và người dùng đáp xuống đúng chỗ họ không chọn.
 */
export function DocCodeLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      onClick={(e) => e.stopPropagation()}
      className="whitespace-nowrap text-[13px] font-extrabold tabular-data text-primary hover:underline"
    >
      {children}
    </Link>
  )
}

/** Ô chữ một dòng, cắt khi dài — ô trống nói "—", không để trắng (đọc như lỗi tải). */
export function DocCellText({ children, muted, title }: { children: ReactNode; muted?: boolean; title?: string }) {
  return (
    <span className={cn("block truncate", muted ? "text-on-surface-variant" : "font-semibold")} title={title}>
      {children === null || children === undefined || children === "" ? "—" : children}
    </span>
  )
}

/** Ngày ở trên, giờ nhỏ ở dưới — cùng cách trình bày với bảng đơn / hóa đơn. */
export function DocCellDate({ date, time }: { date: string; time?: string | null }) {
  return (
    <span className="font-semibold tabular-data">
      <span className="block">{date}</span>
      {time && <span className="block text-xs font-normal text-on-surface-variant">{time}</span>}
    </span>
  )
}
