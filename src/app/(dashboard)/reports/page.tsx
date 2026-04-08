"use client"

import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { BarChart3, TrendingUp, Package } from "lucide-react"
import Link from "next/link"

export default function ReportsPage() {
  const { loading } = useRoleGuard("reports")
  if (loading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Bao cao" description="Tong hop bao cao kinh doanh" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/reports/sales">
          <Card className="hover:border-primary transition-colors cursor-pointer">
            <CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" /> Doanh so</CardTitle></CardHeader>
            <CardContent><p className="text-sm text-muted-foreground">Bao cao doanh so, top san pham, xu huong</p></CardContent>
          </Card>
        </Link>
        <Link href="/reports/inventory">
          <Card className="hover:border-primary transition-colors cursor-pointer">
            <CardHeader><CardTitle className="flex items-center gap-2"><Package className="h-5 w-5" /> Kho hang</CardTitle></CardHeader>
            <CardContent><p className="text-sm text-muted-foreground">Ton kho, canh bao HSD, bao cao xuat nhap</p></CardContent>
          </Card>
        </Link>
        <Link href="/receivables/aging">
          <Card className="hover:border-primary transition-colors cursor-pointer">
            <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" /> Cong no</CardTitle></CardHeader>
            <CardContent><p className="text-sm text-muted-foreground">Aging report, cong no theo NV</p></CardContent>
          </Card>
        </Link>
      </div>
    </div>
  )
}
