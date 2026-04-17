"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CustomerForm } from "@/components/customers/customer-form"
import { AssignmentManager } from "@/components/customers/assignment-manager"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { Trash2 } from "lucide-react"
import type { Customer, CustomerGroup, CustomerAssignment } from "@/types"

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("customers")
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [groups, setGroups] = useState<CustomerGroup[]>([])
  const [assignments, setAssignments] = useState<CustomerAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

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

  const handleDelete = async () => {
    if (!customer) return
    setDeleting(true)
    try {
      const { error } = await supabase.from("customers").delete().eq("id", customer.id)
      if (error) throw error
      toast({ title: "Đã xóa khách hàng" })
      router.push("/customers")
    } catch (err) {
      toast({
        title: "Lỗi",
        description: (err as Error).message,
        variant: "destructive",
      })
      setDeleting(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!customer) return <div>Không tìm thấy khách hàng</div>

  const canDelete = user && hasPermission(user.role, "customers", "delete")

  return (
    <div className="space-y-4">
      <PageHeader title={customer.store_name} description={customer.address} backHref="/customers">
        <StatusBadge status={customer.status} type="customer" />
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Tabs defaultValue="info">
            <TabsList>
              <TabsTrigger value="info">Thông tin</TabsTrigger>
              <TabsTrigger value="assignments">Phân công NV ({assignments.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="info">
              <CustomerForm customer={customer} groups={groups} />
            </TabsContent>
            <TabsContent value="assignments">
              <AssignmentManager customerId={customer.id} assignments={assignments} onUpdate={fetchData} />
            </TabsContent>
          </Tabs>
        </div>

        {canDelete && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Vùng nguy hiểm</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Xóa khách hàng vĩnh viễn. Thao tác này cũng sẽ xóa các phân công nhân viên và có thể thất bại nếu khách hàng có đơn hàng.
                </p>
                <Button
                  variant="outline"
                  className="w-full justify-start text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Xóa khách hàng
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xóa vĩnh viễn khách hàng?"
        description={`Khách hàng "${customer.store_name}" sẽ bị xóa cùng các phân công nhân viên. Thao tác có thể thất bại nếu khách hàng có đơn hàng. Không thể khôi phục.`}
        variant="destructive"
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={handleDelete}
        loading={deleting}
      />
    </div>
  )
}
