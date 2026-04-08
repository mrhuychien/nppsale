"use client"

import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { OrderForm } from "@/components/orders/order-form"
import { Skeleton } from "@/components/ui/skeleton"

export default function NewOrderPage() {
  const { loading } = useRoleGuard("orders")
  if (loading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Tao don hang moi" />
      <OrderForm />
    </div>
  )
}
