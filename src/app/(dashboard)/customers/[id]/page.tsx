"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CustomerForm } from "@/components/customers/customer-form"
import { AssignmentManager } from "@/components/customers/assignment-manager"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { StatusBadge } from "@/components/ui/status-badge"
import type { Customer, CustomerGroup, CustomerAssignment } from "@/types"

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { loading: authLoading } = useRoleGuard("customers")
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [groups, setGroups] = useState<CustomerGroup[]>([])
  const [assignments, setAssignments] = useState<CustomerAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [custRes, groupsRes, assignRes] = await Promise.all([
      supabase.from("customers").select("*, group:customer_groups(*)").eq("id", id).single(),
      supabase.from("customer_groups").select("*"),
      supabase.from("customer_assignments").select("*, user:users(*)").eq("customer_id", id),
    ])
    if (custRes.data) setCustomer(custRes.data as Customer)
    setGroups((groupsRes.data as CustomerGroup[]) || [])
    setAssignments((assignRes.data as CustomerAssignment[]) || [])
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!customer) return <div>Khong tim thay khach hang</div>

  return (
    <div className="space-y-4">
      <PageHeader title={customer.store_name} description={customer.address}>
        <StatusBadge status={customer.status} type="customer" />
      </PageHeader>

      <Tabs defaultValue="info">
        <TabsList>
          <TabsTrigger value="info">Thong tin</TabsTrigger>
          <TabsTrigger value="assignments">Phan cong NV ({assignments.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="info">
          <CustomerForm customer={customer} groups={groups} />
        </TabsContent>
        <TabsContent value="assignments">
          <AssignmentManager customerId={customer.id} assignments={assignments} onUpdate={fetchData} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
