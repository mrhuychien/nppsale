"use client"

import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Users, Building2, CheckCircle2, ShieldCheck } from "lucide-react"
import Link from "next/link"

export default function SettingsPage() {
  const { loading } = useRoleGuard("settings")
  if (loading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Cài đặt" description="Quản lý người dùng và cấu hình hệ thống" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/settings/users">
          <Card className="hover:border-primary transition-colors cursor-pointer h-full">
            <CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> Người dùng</CardTitle></CardHeader>
            <CardContent><p className="text-sm text-muted-foreground">Quản lý tài khoản, gán vai trò</p></CardContent>
          </Card>
        </Link>
        <Link href="/settings/permissions">
          <Card className="hover:border-primary transition-colors cursor-pointer h-full">
            <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Phân quyền</CardTitle></CardHeader>
            <CardContent><p className="text-sm text-muted-foreground">Cấu hình quyền chi tiết: Xem, Tạo, Cập nhật, Xóa, Duyệt, Xuất</p></CardContent>
          </Card>
        </Link>
        <Link href="/settings/approval-rules">
          <Card className="hover:border-primary transition-colors cursor-pointer h-full">
            <CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5" /> Duyệt đơn tự động</CardTitle></CardHeader>
            <CardContent><p className="text-sm text-muted-foreground">Ngưỡng giá trị đơn, công nợ KH, công nợ NV, hạn mức</p></CardContent>
          </Card>
        </Link>
        <Link href="/settings/org">
          <Card className="hover:border-primary transition-colors cursor-pointer h-full">
            <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" /> Tổ chức</CardTitle></CardHeader>
            <CardContent><p className="text-sm text-muted-foreground">Thông tin NPP, cảnh báo chung</p></CardContent>
          </Card>
        </Link>
      </div>
    </div>
  )
}
