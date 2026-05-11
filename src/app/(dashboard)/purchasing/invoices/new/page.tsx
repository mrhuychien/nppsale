"use client"

import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { PurchaseInvoiceForm } from "@/components/purchasing/purchase-invoice-form"

export default function NewPurchaseInvoicePage() {
  const { loading } = useRoleGuard("inventory")
  if (loading) return <Skeleton className="h-96" />
  return (
    <div className="space-y-4">
      <PageHeader
        title="Tạo hoá đơn nhập hàng"
        description="Lưu lần đầu sẽ ở trạng thái Nháp. Bấm Hoàn thành để ghi công nợ NCC + nhập kho."
        backHref="/purchasing/invoices"
      />
      <PurchaseInvoiceForm />
    </div>
  )
}
