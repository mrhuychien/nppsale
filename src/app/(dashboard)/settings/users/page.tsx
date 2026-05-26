"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
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
import { Users, Pencil, Lock, Unlock, Plus, Trash2 } from "lucide-react"
import type { User } from "@/types"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { ColumnPicker } from "@/components/ui/list-view-toolbar"
import {
  USER_COLUMNS,
  DEFAULT_USER_COLUMNS,
  type UserColumnKey,
} from "./list-config"

export default function UsersPage() {
  const { user: currentUser, loading: authLoading } = useRoleGuard("settings")
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [toggleTarget, setToggleTarget] = useState<User | null>(null)
  const [toggling, setToggling] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null)
  const [deleting, setDeleting] = useState(false)
  const router = useRouter()
  const supabase = createClient()
  const { toast } = useToast()
  const {
    columns: visibleColumns,
    setColumns,
    resetColumns,
  } = useListViewPrefs("settings-users", DEFAULT_USER_COLUMNS, [])
  const show = (k: UserColumnKey) => visibleColumns.includes(k)

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
  const isOwner = currentUser?.role === "owner"

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/users/${deleteTarget.id}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Xóa thất bại")
      toast({ title: `Đã xóa người dùng ${deleteTarget.full_name}` })
      setDeleteTarget(null)
      fetchUsers()
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
    } finally {
      setDeleting(false)
    }
  }

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
      <PageHeader title="Quản lý người dùng" description={`${users.length} người dùng`} backHref="/settings">
        <div className="flex items-center gap-2">
          <ColumnPicker
            available={USER_COLUMNS}
            value={visibleColumns}
            onChange={setColumns}
            onReset={resetColumns}
          />
          {isOwner && (
            <Button asChild>
              <Link href="/settings/users/new">
                <Plus className="mr-2 h-4 w-4" /> Tạo người dùng
              </Link>
            </Button>
          )}
        </div>
      </PageHeader>

      {users.length === 0 ? (
        <EmptyState icon={<Users className="h-8 w-8 text-muted-foreground" />} title="Chưa có người dùng" description="Tạo người dùng qua Supabase Auth" />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Họ tên</TableHead>
                  {show("role") && <TableHead>Vai trò</TableHead>}
                  {show("phone") && <TableHead>SĐT</TableHead>}
                  {show("status") && <TableHead>Trạng thái</TableHead>}
                  {show("action") && <TableHead className="text-right">Thao tác</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.full_name}</TableCell>
                    {show("role") && <TableCell><Badge variant="outline">{ROLE_LABELS[u.role] || u.role}</Badge></TableCell>}
                    {show("phone") && <TableCell>{u.phone || "-"}</TableCell>}
                    {show("status") && (
                      <TableCell>
                        <Badge variant={u.is_active ? "success" : "secondary"}>
                          {u.is_active ? "Đang hoạt động" : "Tạm khóa"}
                        </Badge>
                      </TableCell>
                    )}
                    {show("action") && (
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
                            {isOwner && u.id !== currentUser?.id && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-destructive hover:bg-destructive/10"
                                onClick={() => setDeleteTarget(u)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile card list */}
          <div className="lg:hidden space-y-3">
            {users.map((u) => (
              <div
                key={u.id}
                className="rounded-2xl border bg-card shadow-ambient overflow-hidden"
              >
                <div className="p-4">
                  <div className="flex justify-between items-start gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-extrabold text-base leading-tight truncate">
                        {u.full_name}
                      </h3>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <Badge variant="outline" className="text-xs">
                          {ROLE_LABELS[u.role] || u.role}
                        </Badge>
                        {u.phone && (
                          <span className="text-xs text-muted-foreground">
                            SĐT: {u.phone}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0">
                      <Badge variant={u.is_active ? "success" : "secondary"}>
                        {u.is_active ? "Hoạt động" : "Tạm khóa"}
                      </Badge>
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap items-center gap-2 pt-2 mt-2 border-t">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
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
                        className="flex-1"
                        onClick={() => router.push(`/settings/users/${u.id}`)}
                      >
                        <Pencil className="h-4 w-4 mr-1" /> Sửa
                      </Button>
                      {isOwner && u.id !== currentUser?.id && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:bg-destructive/10"
                          onClick={() => setDeleteTarget(u)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
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

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Xóa vĩnh viễn người dùng ${deleteTarget?.full_name}?`}
        description="Tài khoản + dữ liệu cá nhân sẽ bị xóa không thể khôi phục. Các bản ghi đã tạo (đơn hàng, phiếu kho...) vẫn giữ nhưng mất tham chiếu tới người tạo."
        variant="destructive"
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={handleDelete}
        loading={deleting}
      />
    </div>
  )
}
