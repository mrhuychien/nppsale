"use client"

/**
 * KHUNG MÀN Báo cáo tổng hợp (spec mục 2.2, thiết kế 26/09/2026).
 * Máy tính: "Báo cáo tổng hợp · /bao-cao/…" · tên màn · câu hỏi · [In] [Xuất Excel] → thanh lọc →
 *   đường đào sâu `Tổng quan › Tháng 9 › Cô Ba ✕`.
 * Điện thoại: đầu trang xanh (☰ menu 6 màn, tên màn, In / Xuất) + thẻ trắng nổi (kỳ + Lọc) →
 *   `‹ bước trước` + ✕.
 */
import { useState, type ReactNode } from "react"
import { BarChart3, ChevronRight, CreditCard, Download, FileText, Menu, Package, Printer, Receipt, ShoppingCart, X, type LucideIcon } from "lucide-react"
import Link from "@/components/ui/link"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { BAO_CAO_TONG_HOP } from "@/lib/nav/bao-cao-tong-hop"
import { duocVaoTrang } from "@/lib/nav/nav-permission"
import { NoiThanhLoc } from "./thanh-loc"
import type { Role } from "@/lib/permissions"

export const BIEU_TUONG_MAN: Record<string, { icon: LucideIcon; mau: string }> = {
  "/bao-cao": { icon: BarChart3, mau: "bg-blue-50 text-blue-600 dark:bg-blue-950/40" },
  "/bao-cao/ban-hang": { icon: ShoppingCart, mau: "bg-violet-50 text-violet-600 dark:bg-violet-950/40" },
  "/bao-cao/cuoi-ngay": { icon: Receipt, mau: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40" },
  "/bao-cao/kho": { icon: Package, mau: "bg-amber-50 text-amber-700 dark:bg-amber-950/40" },
  "/bao-cao/cong-no": { icon: CreditCard, mau: "bg-pink-50 text-pink-700 dark:bg-pink-950/40" },
  "/bao-cao/tai-chinh": { icon: FileText, mau: "bg-blue-50 text-blue-700 dark:bg-blue-950/40" },
}

export interface MatDao {
  label: string
  onClick: () => void
}

export interface KhungProps {
  href: string
  role: Role | null | undefined
  thanhLoc: ReactNode
  /** Đường đào sâu: phần tử đầu là tên màn (+ chế độ xem gốc). */
  dao: MatDao[]
  onBoDao: () => void
  onXuat?: (() => void) | null
  onIn?: (() => void) | null
  nhanIn?: string
  children: ReactNode
}

export function KhungBaoCao(p: KhungProps) {
  const man = BAO_CAO_TONG_HOP.find((m) => m.href === p.href)!
  const [menu, setMenu] = useState(false)
  const coDao = p.dao.length > 1
  const cuoi = p.dao.length - 1
  const lui = coDao ? p.dao[cuoi - 1] : null
  return (
    <div className="space-y-4" data-testid="bao-cao-tong-hop">
      {/* Máy tính */}
      <div className="hidden flex-col gap-3 lg:flex">
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">Báo cáo tổng hợp · {man.href}</div>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight">{man.label}</h1>
            <div className="mt-0.5 text-[13px] text-muted-foreground">{man.cauHoi}</div>
          </div>
          {p.onIn && (
            <button type="button" onClick={p.onIn} className="flex h-10 items-center gap-2 rounded-xl border bg-card px-3.5 text-sm font-semibold hover:bg-muted/50">
              <Printer className="h-4 w-4" />
              {p.nhanIn || "In"}
            </button>
          )}
          {p.onXuat && (
            <button type="button" onClick={p.onXuat} data-testid="bc-xuat" className="flex h-10 items-center gap-2 rounded-xl border bg-card px-3.5 text-sm font-semibold hover:bg-muted/50">
              <Download className="h-4 w-4" />
              Xuất Excel
            </button>
          )}
        </div>
        <NoiThanhLoc.Provider value="may">{p.thanhLoc}</NoiThanhLoc.Provider>
        {coDao && (
          <nav className="flex flex-wrap items-center gap-1" aria-label="Đường đào sâu" data-testid="bc-duong-dao">
            {p.dao.map((m, i) => (
              <div key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />}
                <button
                  type="button"
                  onClick={m.onClick}
                  className={cn("rounded-lg px-2 py-1 text-[13px] hover:bg-primary/10", i === cuoi ? "bg-primary/10 font-semibold text-primary" : "font-medium")}
                >
                  {m.label}
                </button>
              </div>
            ))}
            <button type="button" title="Về trạng thái ban đầu" aria-label="Về trạng thái ban đầu" onClick={p.onBoDao} className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted/60">
              <X className="h-3.5 w-3.5" />
            </button>
          </nav>
        )}
      </div>

      {/* Điện thoại */}
      <div className="-mx-4 !-mt-4 lg:hidden">
        <div className="bg-primary px-3.5 pb-[58px] pt-3.5 text-primary-foreground">
          <div className="flex items-center gap-2.5">
            <button type="button" aria-label="Menu báo cáo" onClick={() => setMenu(true)} className="grid h-10 w-10 place-items-center rounded-xl bg-primary-foreground/15">
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-xs opacity-80">Báo cáo tổng hợp</div>
              <div className="text-lg font-bold">{man.label}</div>
            </div>
            {p.onIn && (
              <button type="button" aria-label={p.nhanIn || "In"} onClick={p.onIn} className="grid h-10 w-10 place-items-center rounded-xl bg-primary-foreground/15">
                <Printer className="h-[18px] w-[18px]" />
              </button>
            )}
            {p.onXuat && (
              <button type="button" aria-label="Xuất Excel" onClick={p.onXuat} className="grid h-10 w-10 place-items-center rounded-xl bg-primary-foreground/15">
                <Download className="h-[18px] w-[18px]" />
              </button>
            )}
          </div>
        </div>
        <div className="relative -mt-[46px] px-3.5">
          <NoiThanhLoc.Provider value="dt">{p.thanhLoc}</NoiThanhLoc.Provider>
        </div>
        {coDao && lui && (
          <div className="flex items-center gap-2 px-3.5 pt-3">
            <button type="button" onClick={lui.onClick} className="flex h-10 min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-semibold text-primary">
              <span aria-hidden>‹</span>
              <span className="truncate">{lui.label}</span>
            </button>
            <button type="button" aria-label="Về trạng thái ban đầu" onClick={p.onBoDao} className="grid h-10 w-10 place-items-center rounded-xl border bg-card text-muted-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      <Sheet open={menu} onOpenChange={setMenu}>
        <SheetContent side="left" className="w-[300px] p-3">
          <SheetTitle className="px-2.5 pb-2 text-lg">Báo cáo tổng hợp</SheetTitle>
          <MenuBaoCao role={p.role} hienTai={p.href} onChon={() => setMenu(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex flex-col gap-4">{p.children}</div>
    </div>
  )
}

export function MenuBaoCao({ role, hienTai, onChon }: { role: Role | null | undefined; hienTai: string; onChon?: () => void }) {
  const ds = BAO_CAO_TONG_HOP.filter((m) => duocVaoTrang(role, m.href, "reports"))
  return (
    <div className="flex flex-col gap-0.5">
      {ds.map((m) => {
        const b = BIEU_TUONG_MAN[m.href]
        const on = m.href === hienTai
        return (
          <Link key={m.href} href={m.href} onClick={onChon} className={cn("flex min-h-11 items-center gap-2.5 rounded-xl px-2.5", on ? "bg-primary/10 font-semibold text-primary" : "hover:bg-muted/50")}>
            <span className={cn("grid h-[30px] w-[30px] place-items-center rounded-lg", b.mau)}>
              <b.icon className="h-4 w-4" />
            </span>
            <span className="text-sm">{m.label}</span>
          </Link>
        )
      })}
      <div className="mt-2 border-t px-2.5 pt-3 text-xs leading-relaxed text-muted-foreground">Menu báo cáo cũ vẫn chạy song song, chỉ gỡ khi 6 màn mới đã dùng ổn.</div>
    </div>
  )
}
