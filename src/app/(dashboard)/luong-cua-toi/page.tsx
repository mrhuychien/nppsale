"use client"

import { useEffect, useState } from "react"
import { Wallet } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { cn, formatCurrency, formatDate } from "@/lib/utils"
import {
  doanhSoTinhLuong,
  khoanLuong,
  nhanThangLuong,
  type DongPhieuLuong,
} from "@/lib/hr/phieu-luong-cua-toi"

/** Phiếu lương của chính người đăng nhập — chỉ kỳ đã chốt (chủ nhà 26/09/2026, mig 201). */
export default function LuongCuaToiPage() {
  const { user, loading: authLoading } = useAuth()
  const [rows, setRows] = useState<DongPhieuLuong[] | null>(null)
  const [loi, setLoi] = useState<string | null>(null)
  const [mo, setMo] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.id) return
    let huy = false
    createClient()
      .rpc("my_payslips")
      .then(({ data, error }) => {
        if (huy) return
        if (error) {
          setLoi(error.message)
          setRows([])
          return
        }
        const ds = (data as DongPhieuLuong[] | null) || []
        setRows(ds)
        setMo(ds[0]?.payroll_run_id ?? null)
      })
    return () => { huy = true }
  }, [user?.id])

  if (authLoading || (user && rows === null)) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-40" />
        <Skeleton className="h-16" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Phiếu lương của tôi" description="Các kỳ lương đã chốt" backHref="/home" />

      {loi && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <p className="font-semibold">Không tải được phiếu lương</p>
          <p className="mt-0.5 break-words">{loi}</p>
        </div>
      )}

      {!loi && (rows?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<Wallet className="h-8 w-8 text-muted-foreground" />}
          title="Chưa có phiếu lương"
          description="Phiếu lương hiện ở đây khi kế toán chốt bảng lương của kỳ."
        />
      ) : (
        <div className="space-y-3" data-testid="phieu-luong">
          {(rows || []).map((r) => {
            const dangMo = mo === r.payroll_run_id
            const doanhSo = doanhSoTinhLuong(r)
            return (
              <section key={r.payroll_run_id} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
                <button
                  type="button"
                  aria-expanded={dangMo}
                  onClick={() => setMo(dangMo ? null : r.payroll_run_id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <div className="min-w-0">
                    <p className="font-bold">{nhanThangLuong(r.month)}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.locked_at ? `Chốt ${formatDate(r.locked_at)}` : "Đã chốt"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-muted-foreground">Thực nhận</p>
                    <p className="text-lg font-black tabular-nums text-primary">{formatCurrency(Number(r.net_salary || 0))}</p>
                  </div>
                </button>
                {dangMo && (
                  <div className="border-t px-4 py-3 text-sm">
                    {doanhSo !== null && (
                      <p className="mb-2 text-xs text-muted-foreground">
                        Doanh số tính lương: <span className="font-semibold text-foreground tabular-nums">{formatCurrency(doanhSo)}</span>
                      </p>
                    )}
                    <dl className="divide-y">
                      {khoanLuong(r).map((k) => (
                        <div key={k.label} className="flex items-center justify-between gap-3 py-1.5">
                          <dt className="text-muted-foreground">{k.label}</dt>
                          <dd className={cn("tabular-nums font-medium", k.amount < 0 && "text-destructive")}>
                            {formatCurrency(k.amount)}
                          </dd>
                        </div>
                      ))}
                      <div className="flex items-center justify-between gap-3 py-2 font-bold">
                        <dt>Thực nhận</dt>
                        <dd className="tabular-nums">{formatCurrency(Number(r.net_salary || 0))}</dd>
                      </div>
                    </dl>
                    {r.notes && <p className="mt-2 text-xs text-muted-foreground">Ghi chú: {r.notes}</p>}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
