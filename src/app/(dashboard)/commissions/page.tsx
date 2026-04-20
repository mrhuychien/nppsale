"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCurrency } from "@/lib/utils"
import { Award, CheckCircle2, Target, Wallet } from "lucide-react"
import Link from "next/link"
import type { CommissionWallet } from "@/types"

function initials(name: string | undefined): string {
  if (!name) return "?"
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(-2)
    .join("")
    .toUpperCase()
}

export default function CommissionsPage() {
  const { loading: authLoading } = useRoleGuard("commissions")
  const { user: authUser } = useAuth()
  const isSales = authUser?.role === "sales"
  const [wallets, setWallets] = useState<CommissionWallet[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("commission_wallets")
        .select("*, user:users(*)")
        .order("earned", { ascending: false })
      setWallets((data as CommissionWallet[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) return <Skeleton className="h-96" />

  const currentMonth = new Date().toISOString().slice(0, 7)
  const monthlyWallets = wallets.filter((w) => (w.period || "").startsWith(currentMonth))
  const totalEarnedMonth = monthlyWallets.reduce((s, w) => s + w.earned, 0)
  const totalPaid = wallets.reduce((s, w) => s + w.paid, 0)
  const totalBalance = wallets.reduce((s, w) => s + w.balance, 0)
  const achieversCount = wallets.filter((w) => w.earned > 0).length

  return (
    <div className="space-y-6">
      <PageHeader title={isSales ? "Ví hoa hồng của tôi" : "Hoa hồng"} description="Tự thưởng và bảng xếp hạng NV">
        <Button variant="outline" asChild>
          <Link href="/commissions/policies">Chính sách hoa hồng</Link>
        </Button>
      </PageHeader>

      {isSales && (
        <div className="rounded-xl bg-primary/5 border border-primary/20 p-3 text-sm text-primary flex items-center gap-2">
          <span className="inline-flex h-5 w-5 rounded-full bg-primary/20 items-center justify-center text-xs font-black">i</span>
          Bạn chỉ thấy ví hoa hồng cá nhân.
        </div>
      )}

      {/* KPI Bento Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {/* Big card */}
        <Card className="md:col-span-2 overflow-hidden bg-primary text-primary-foreground">
          <CardContent className="relative flex h-full flex-col justify-between p-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest opacity-80">
                Tổng hoa hồng tháng
              </p>
              <h3 className="mt-2 text-3xl font-black md:text-4xl">
                {formatCurrency(totalEarnedMonth)}
              </h3>
            </div>
            <div className="mt-4 inline-flex items-center gap-2 text-xs font-bold">
              <span className="rounded-full bg-white/20 px-3 py-1">
                Kỳ {currentMonth}
              </span>
            </div>
            <div className="pointer-events-none absolute -bottom-12 -right-12 h-48 w-48 rounded-full bg-white/10 blur-3xl" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex h-full flex-col justify-between p-6">
            <div className="flex items-start justify-between">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Đã chi trả
              </p>
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            </div>
            <h3 className="mt-4 text-2xl font-black">{formatCurrency(totalPaid)}</h3>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex h-full flex-col justify-between p-6">
            <div className="flex items-start justify-between">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Còn phải trả
              </p>
              <Wallet className="h-5 w-5 text-primary" />
            </div>
            <h3 className="mt-4 text-2xl font-black text-primary">
              {formatCurrency(totalBalance)}
            </h3>
          </CardContent>
        </Card>

        <Card className="md:col-span-4">
          <CardContent className="flex items-center justify-between p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Target className="h-6 w-6" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Số NV đạt KPI
                </p>
                <h3 className="text-2xl font-black">
                  {achieversCount}{" "}
                  <span className="text-sm font-medium text-muted-foreground">
                    / {wallets.length} nhân viên
                  </span>
                </h3>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Tỷ lệ đạt
              </p>
              <p className="text-2xl font-black text-green-600">
                {wallets.length > 0
                  ? Math.round((achieversCount / wallets.length) * 100)
                  : 0}
                %
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-user performance cards */}
      {wallets.length === 0 ? (
        <EmptyState
          icon={<Award className="h-8 w-8 text-muted-foreground" />}
          title="Chưa có dữ liệu hoa hồng"
          description="Hoa hồng sẽ được tính từ đơn hàng đã giao"
        />
      ) : (
        <div>
          <h2 className="mb-4 text-xl font-black">Chi tiết hiệu suất nhân viên</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {wallets.map((w) => {
              const paidPct =
                w.earned > 0 ? Math.min(100, Math.round((w.paid / w.earned) * 100)) : 0
              const achieved = w.earned > 0
              return (
                <Card key={w.id} className="transition-all hover:shadow-md">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">
                          {initials(w.user?.full_name)}
                        </div>
                        <div>
                          <h4 className="font-bold">{w.user?.full_name || "-"}</h4>
                          <p className="text-xs capitalize text-muted-foreground">
                            {w.user?.role || "sales"} · Kỳ {w.period}
                          </p>
                        </div>
                      </div>
                      {achieved && (
                        <span className="rounded-full bg-green-100 px-3 py-1 text-[10px] font-black uppercase text-green-700">
                          Đạt chỉ tiêu
                        </span>
                      )}
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-muted/40 p-2">
                        <p className="text-[10px] font-bold uppercase text-muted-foreground">
                          Earned
                        </p>
                        <p className="text-sm font-bold">{formatCurrency(w.earned)}</p>
                      </div>
                      <div className="rounded-lg bg-muted/40 p-2">
                        <p className="text-[10px] font-bold uppercase text-muted-foreground">
                          Paid
                        </p>
                        <p className="text-sm font-bold text-green-600">
                          {formatCurrency(w.paid)}
                        </p>
                      </div>
                      <div className="rounded-lg bg-muted/40 p-2">
                        <p className="text-[10px] font-bold uppercase text-muted-foreground">
                          Balance
                        </p>
                        <p className="text-sm font-bold text-primary">
                          {formatCurrency(w.balance)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="mb-1 flex justify-between text-xs font-bold text-muted-foreground">
                        <span>Đã chi trả</span>
                        <span>{paidPct}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full ${
                            paidPct >= 100
                              ? "bg-green-500"
                              : paidPct >= 50
                                ? "bg-primary"
                                : "bg-amber-400"
                          }`}
                          style={{ width: `${paidPct}%` }}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
