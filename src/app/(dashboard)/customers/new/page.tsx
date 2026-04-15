"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { CustomerForm } from "@/components/customers/customer-form"
import { Skeleton } from "@/components/ui/skeleton"
import type { CustomerGroup } from "@/types"

export default function NewCustomerPage() {
  const { loading: authLoading } = useRoleGuard("customers")
  const [groups, setGroups] = useState<CustomerGroup[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase.from("customer_groups").select("*")
      setGroups((data as CustomerGroup[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Thêm khách hàng mới" />
      <CustomerForm groups={groups} />
    </div>
  )
}
