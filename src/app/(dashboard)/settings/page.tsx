"use client"

import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Users, Building2 } from "lucide-react"
import Link from "next/link"

export default function SettingsPage() {
  const { loading } = useRoleGuard("settings")
  if (loading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Cai dat" description="Quan ly nguoi dung va cau hinh he thong" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/settings/users">
          <Card className="hover:border-primary transition-colors cursor-pointer">
            <CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> Nguoi dung</CardTitle></CardHeader>
            <CardContent><p className="text-sm text-muted-foreground">Quan ly tai khoan, phan quyen</p></CardContent>
          </Card>
        </Link>
        <Link href="/settings/org">
          <Card className="hover:border-primary transition-colors cursor-pointer">
            <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" /> To chuc</CardTitle></CardHeader>
            <CardContent><p className="text-sm text-muted-foreground">Cau hinh NPP, nguong duyet, canh bao</p></CardContent>
          </Card>
        </Link>
      </div>
    </div>
  )
}
