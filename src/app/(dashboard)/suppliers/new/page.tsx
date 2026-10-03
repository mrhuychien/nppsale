"use client"

import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { SupplierForm } from "@/components/suppliers/supplier-form"

export default function NewSupplierPage() {
  const { loading: authLoading } = useRoleGuard("inventory")

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Thêm nhà cung cấp mới" backHref="/suppliers" />

      <Card>
        <CardHeader>
          <CardTitle>Thông tin nhà cung cấp</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Biểu mẫu dùng chung với khung tạo nhanh NCC — lưu xong về /suppliers. */}
          <SupplierForm />
        </CardContent>
      </Card>
    </div>
  )
}
