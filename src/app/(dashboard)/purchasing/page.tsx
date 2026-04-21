"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/utils"
import {
  ShoppingCart,
  Factory,
  FileText,
  CreditCard,
  ArrowRight,
  ClipboardList,
} from "lucide-react"

export default function PurchasingHubPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const [stats, setStats] = useState({ pendingCount: 0, monthTotal: 0 })
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      const now = new Date()
      const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`

      const [pendingRes, monthRes] = await Promise.all([
        supabase
          .from("purchase_orders")
          .select("id", { count: "exact", head: true })
          .eq("status", "draft"),
        supabase
          .from("purchase_orders")
          .select("total")
          .gte("order_date", firstDay)
          .neq("status", "cancelled"),
      ])

      const monthTotal = (monthRes.data || []).reduce(
        (sum: number, r: { total: number }) => sum + (r.total || 0),
        0
      )

      setStats({
        pendingCount: pendingRes.count || 0,
        monthTotal,
      })
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <Skeleton className="h-96" />

  const cards = [
    {
      title: "Đơn mua hàng",
      description: "Tạo và quản lý đơn đặt hàng nhà cung cấp",
      href: "/purchasing/orders",
      icon: ShoppingCart,
      color: "text-primary",
      bg: "bg-primary/10",
    },
    {
      title: "Nhà cung cấp",
      description: "Danh sách và quản lý nhà cung cấp",
      href: "/suppliers",
      icon: Factory,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
    {
      title: "Hóa đơn mua hàng",
      description: "Theo dõi hóa đơn từ nhà cung cấp",
      href: "/purchasing/invoices",
      icon: FileText,
      color: "text-amber-600",
      bg: "bg-amber-50",
    },
    {
      title: "Công nợ NCC",
      description: "Quản lý công nợ phải trả nhà cung cấp",
      href: "/payables",
      icon: CreditCard,
      color: "text-rose-600",
      bg: "bg-rose-50",
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mua hàng"
        description="Quản lý quy trình mua hàng từ nhà cung cấp"
      />

      {/* Quick stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="rounded-2xl shadow-ambient">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
              <ClipboardList className="h-6 w-6 text-amber-600" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                PO chờ duyệt
              </p>
              {loading ? (
                <Skeleton className="h-7 w-16 mt-1" />
              ) : (
                <p className="text-2xl font-black">{stats.pendingCount}</p>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-ambient">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <ShoppingCart className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Tổng giá trị PO tháng này
              </p>
              {loading ? (
                <Skeleton className="h-7 w-32 mt-1" />
              ) : (
                <p className="text-2xl font-black">
                  {formatCurrency(stats.monthTotal)}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Navigation cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => {
          const Icon = card.icon
          return (
            <Link key={card.href} href={card.href}>
              <Card className="rounded-2xl shadow-ambient hover:shadow-ambient-md transition-all hover:scale-[1.01] cursor-pointer h-full">
                <CardContent className="p-5 flex flex-col gap-4">
                  <div
                    className={`h-11 w-11 rounded-xl ${card.bg} flex items-center justify-center`}
                  >
                    <Icon className={`h-5 w-5 ${card.color}`} />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-sm mb-1">{card.title}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {card.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 text-xs font-semibold text-primary">
                    Xem chi tiết
                    <ArrowRight className="h-3.5 w-3.5" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
