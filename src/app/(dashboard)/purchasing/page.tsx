"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { AGGREGATE_ROW_CAP, capRows, truncationWarning } from "@/lib/supabase/aggregate"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/utils"
import { Factory, FileText, CreditCard, ArrowRight, Plus, PackagePlus, RotateCcw } from "lucide-react"

export default function PurchasingHubPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const { user } = useAuth()
  const [stats, setStats] = useState({ importsThisMonth: 0, monthTotal: 0, openPayables: 0 })
  const [loading, setLoading] = useState(true)
  // true = số tổng bên dưới đang cộng thiếu vì dữ liệu bị cắt ở trần.
  const [truncated, setTruncated] = useState(false)
  const supabase = createClient()

  const canCreate = !!user && hasPermission(user.role, "inventory", "update")

  useEffect(() => {
    async function fetch() {
      const now = new Date()
      const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01T00:00:00`
      const [impRes, payRes, monthPayRes] = await Promise.all([
        supabase
          .from("stock_entries")
          .select("id", { count: "exact", head: true })
          .eq("type", "import")
          .gte("created_at", firstDay),
        // Tải để cộng → phải có trần, và phải biết khi bị cắt.
        supabase.from("payables").select("amount, paid").neq("status", "paid").range(0, AGGREGATE_ROW_CAP),
        supabase.from("payables").select("amount").gte("created_at", firstDay).not("stock_entry_id", "is", null),
      ])
      const qErr = ([impRes, payRes, monthPayRes] as Array<{ error?: { message?: string } | null }>)
        .find((r) => r?.error)?.error
      if (qErr) console.error("[app/purchasing] truy vấn lỗi:", qErr.message)
      const pay = capRows<{ amount: number; paid: number }>(payRes.data)
      setTruncated(pay.truncated)
      const openPayables = pay.rows.reduce(
        (s, r) => s + Math.max(0, Number(r.amount || 0) - Number(r.paid || 0)),
        0
      )
      const monthTotal = ((monthPayRes.data as Array<{ amount: number }>) || []).reduce((s, r) => s + Number(r.amount || 0), 0)
      setStats({ importsThisMonth: impRes.count || 0, monthTotal, openPayables })
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <Skeleton className="h-96" />

  const cards = [
    { title: "Tạo phiếu nhập kho", description: "Nhập hàng → tăng tồn kho + ghi công nợ NCC", href: "/inventory/stock-in", icon: PackagePlus, color: "text-primary", bg: "bg-primary/10" },
    { title: "Hoá đơn mua hàng (tra cứu)", description: "Danh sách phiếu nhập từ NCC — bấm để sửa phiếu nhập", href: "/purchasing/invoices", icon: FileText, color: "text-[#b54708]", bg: "bg-[#fff4ed]" },
    { title: "Trả hàng NCC", description: "Hoàn trả hàng cho NCC — xuất kho + giảm công nợ", href: "/purchase-returns", icon: RotateCcw, color: "text-[#c2410c]", bg: "bg-[#fff4ed]" },
    { title: "Nhà cung cấp", description: "Danh sách và thông tin nhà cung cấp", href: "/suppliers", icon: Factory, color: "text-tertiary", bg: "bg-[#ecfdf3]" },
    { title: "Công nợ NCC", description: "Theo dõi & thanh toán công nợ phải trả", href: "/payables", icon: CreditCard, color: "text-error", bg: "bg-error-container" },
  ]

  return (
    <div className="space-y-6">
      <PageHeader title="Mua hàng" description="Nhập hàng từ nhà cung cấp & quản lý công nợ">
        {canCreate && (
          <Button asChild>
            <Link href="/inventory/stock-in"><Plus className="h-4 w-4 mr-1.5" /> Tạo phiếu nhập kho</Link>
          </Button>
        )}
      </PageHeader>

      {truncated && (
        <div className="rounded-xl border border-warning/40 bg-warning-container px-4 py-3 text-sm text-on-warning-container">
          <p className="font-semibold">Số tổng chưa đầy đủ</p>
          <p className="mt-0.5 break-words">{truncationWarning()}</p>
        </div>
      )}

      <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm text-primary">
        <strong>Quy trình mua hàng:</strong> Vào Kho → Tạo phiếu nhập kho → Lưu xong: tồn kho tăng + ghi công nợ NCC. Xong.
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="rounded-xl shadow-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><PackagePlus className="h-6 w-6 text-primary" /></div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Phiếu nhập tháng này</p>
              {loading ? <Skeleton className="h-7 w-16 mt-1" /> : <p className="text-2xl font-black">{stats.importsThisMonth}</p>}
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-[#fff4ed] flex items-center justify-center shrink-0"><FileText className="h-6 w-6 text-[#b54708]" /></div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Giá trị nhập tháng này</p>
              {loading ? <Skeleton className="h-7 w-32 mt-1" /> : <p className="text-2xl font-black truncate">{formatCurrency(stats.monthTotal)}</p>}
            </div>
          </CardContent>
        </Card>
        <Link href="/payables" className="block">
          <Card className="rounded-xl shadow-card transition-colors hover:bg-muted/30 h-full">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-error-container flex items-center justify-center shrink-0"><CreditCard className="h-6 w-6 text-error" /></div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Công nợ NCC</p>
                {loading ? <Skeleton className="h-7 w-32 mt-1" /> : <p className="text-2xl font-black truncate text-error">{formatCurrency(stats.openPayables)}</p>}
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Nav cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon
          return (
            <Link key={card.href} href={card.href}>
              <Card className="rounded-xl shadow-card transition-all hover:shadow-card-hover hover:scale-[1.01] cursor-pointer h-full">
                <CardContent className="p-5 flex flex-col gap-4">
                  <div className={`h-11 w-11 rounded-xl ${card.bg} flex items-center justify-center`}><Icon className={`h-5 w-5 ${card.color}`} /></div>
                  <div className="flex-1">
                    <h3 className="font-bold text-sm mb-1">{card.title}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">{card.description}</p>
                  </div>
                  <div className="flex items-center gap-1 text-xs font-semibold text-primary">Mở <ArrowRight className="h-3.5 w-3.5" /></div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
