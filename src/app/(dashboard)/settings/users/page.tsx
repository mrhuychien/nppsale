"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { ROLE_LABELS } from "@/lib/constants"
import { Users, Pencil, Lock, Unlock } from "lucide-react"
import type { User } from "@/types"

export default function UsersPage() {
  const { user: currentUser, loading: authLoading } = useRoleGuard("settings")
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [toggleTarget, setToggleTarget] = useState<User | null>(null)
  const [toggling, setToggling] = useState(false)
  const router = useRouter()
  const supabase = createClient()
  const { toast } = useToast()

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from("users").select("*").order("full_name")
    setUsers((data as User[]) || [])
    setLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const canManage = currentUser && hasPermission(currentUser.role, "settings", "update")

  const handleToggleActive = async () => {
    if (!toggleTarget) return
    setToggling(true)
    try {
      const { error } = await supabase
        .from("users")
        .update({ is_active: !toggleTarget.is_active })
        .eq("id", toggleTarget.id)
      if (error) throw error
      toast({
        title: toggleTarget.is_active ? "Đã tạm khóa người dùng" : "Đã kích hoạt người dùng",
      })
      setToggleTarget(null)
      fetchUsers()
    } catch (err) {
      toast({
        title: "Lỗi",
        description: (err as Error).message,
        variant: "destructive",
      })
    } finally {
      setToggling(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Quản lý người dùng" description={`${users.length} người dùng`} />

      <div className="rounded-md border border-border/40 bg-muted/30 p-3 text-xs text-muted-foreground">
        Người dùng được tạo qua Supabase Auth. Tại đây chỉ có thể chỉnh sửa thông tin hồ sơ và bật/tắt trạng thái hoạt động.
      </div>

      {users.length === 0 ? (
        <EmptyState icon={<Users className="h-8 w-8 text-muted-foreground" />} title="Chưa có người dùng" description="Tạo người dùng qua Supabase Auth" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Họ tên</TableHead>
              <TableHead>Vai trò</TableHead>
              <TableHead className="hidden sm:table-cell">SĐT</TableHead>
              <TableHead>Trạng thái</TableHead>
              <TableHead className="text-right">Thao tác</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.full_name}</TableCell>
                <TableCell><Badge variant="outline">{ROLE_LABELS[u.role] || u.role}</Badge></TableCell>
                <TableCell className="hidden sm:table-cell">{u.phone || "-"}</TableCell>
                <TableCell>
                  <Badge variant={u.is_active ? "success" : "secondary"}>
                    {u.is_active ? "Đang hoạt động" : "Tạm khóa"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {canManage ? (
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setToggleTarget(u)}
                      >
                        {u.is_active ? (
                          <>
                            <Lock className="h-4 w-4 mr-1" /> Tạm khóa
                          </>
                        ) : (
                          <>
                            <Unlock className="h-4 w-4 mr-1" /> Kích hoạt
                          </>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => router.push(`/settings/users/${u.id}`)}
                      >
                        <Pencil className="h-4 w-4 mr-1" /> Chỉnh sửa
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ConfirmDialog
        open={!!toggleTarget}
        onOpenChange={(open) => !open && setToggleTarget(null)}
        title={toggleTarget?.is_active ? "Tạm khóa người dùng?" : "Kích hoạt người dùng?"}
        description={
          toggleTarget?.is_active
            ? `Người dùng "${toggleTarget?.full_name}" sẽ không thể đăng nhập sử dụng hệ thống cho đến khi được kích hoạt lại.`
            : `Người dùng "${toggleTarget?.full_name}" sẽ được phép đăng nhập và sử dụng hệ thống.`
        }
        variant={toggleTarget?.is_active ? "destructive" : "default"}
        confirmLabel={toggleTarget?.is_active ? "Tạm khóa" : "Kích hoạt"}
        onConfirm={handleToggleActive}
        loading={toggling}
      />
    </div>
  )
}
