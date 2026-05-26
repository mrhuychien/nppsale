"use client"

import { useRoleGuard } from "@/hooks/use-role-guard"
import { useCustomerGroups } from "@/hooks/use-customer-groups"
import { PageHeader } from "@/components/ui/page-header"
import { CustomerForm } from "@/components/customers/customer-form"
import { Skeleton } from "@/components/ui/skeleton"

export default function NewCustomerPage() {
  const { loading: authLoading } = useRoleGuard("customers")
  const { groups, loading } = useCustomerGroups()

  if (authLoading || loading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Thêm khách hàng mới" backHref="/customers" />
      <CustomerForm groups={groups} />
    </div>
  )
}
