"use client"

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { UsePaginationReturn } from "@/hooks/use-pagination"

interface DataPaginationProps {
  pg: UsePaginationReturn
  /** Số mẫu được hiển thị trên trang hiện tại — để show "showing X-Y of Z". */
  shownCount?: number
  /** Bật/tắt selector pageSize. Mặc định bật. */
  showSizeSelector?: boolean
  sizes?: number[]
}

export function DataPagination({
  pg,
  shownCount,
  showSizeSelector = true,
  sizes = [25, 50, 100, 200],
}: DataPaginationProps) {
  if (pg.total === 0) return null
  const startIndex = pg.from + 1
  const endIndex = Math.min(pg.from + (shownCount ?? pg.pageSize), pg.total)
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap pt-2">
      <p className="text-xs text-muted-foreground">
        Hiển thị <span className="font-medium text-foreground">{startIndex}–{endIndex}</span>
        {" / "}
        <span className="font-medium text-foreground">{pg.total}</span> dòng
      </p>
      <div className="flex items-center gap-2">
        {showSizeSelector && (
          <Select value={String(pg.pageSize)} onValueChange={(v) => pg.setPageSize(parseInt(v, 10))}>
            <SelectTrigger className="h-8 w-[80px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sizes.map((s) => (
                <SelectItem key={s} value={String(s)} className="text-xs">
                  {s}/trang
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={!pg.hasPrev}
            onClick={() => pg.setPage(1)}
            aria-label="Trang đầu"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={!pg.hasPrev}
            onClick={() => pg.setPage(pg.page - 1)}
            aria-label="Trang trước"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs px-2 tabular-nums min-w-[64px] text-center">
            {pg.page} / {pg.totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={!pg.hasNext}
            onClick={() => pg.setPage(pg.page + 1)}
            aria-label="Trang sau"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={!pg.hasNext}
            onClick={() => pg.setPage(pg.totalPages)}
            aria-label="Trang cuối"
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
