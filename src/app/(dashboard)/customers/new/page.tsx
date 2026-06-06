"use client"

import { useState } from "react"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useCustomerGroups } from "@/hooks/use-customer-groups"
import { PageHeader } from "@/components/ui/page-header"
import { CustomerForm } from "@/components/customers/customer-form"
import { CustomerDupeFinder } from "@/components/customers/customer-dupe-finder"
import { Skeleton } from "@/components/ui/skeleton"

export default function NewCustomerPage() {
  const { loading: authLoading } = useRoleGuard("customers")
  const { groups, loading } = useCustomerGroups()
  const [showForm, setShowForm] = useState(false)

  if (authLoading || loading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Thêm khách hàng mới" backHref="/customers" />
      {showForm ? (
        <CustomerForm groups={groups} />
      ) : (
        <CustomerDupeFinder onConfirmCreateNew={() => setShowForm(true)} />
      )}
    </div>
  )
}
