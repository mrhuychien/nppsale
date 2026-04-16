"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/ui/page-header"
import { useToast } from "@/hooks/use-toast"
import { ROLE_LABELS } from "@/lib/constants"
import type { User, Role } from "@/types"

const ROLE_OPTIONS: Role[] = ["owner", "manager", "accountant", "sales", "warehouse", "driver"]

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user: currentUser, authUser, loading: authLoading } = useAuth()
  useRoleGuard("settings")
  const [target, setTarget] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    full_name: "",
    role: "sales" as Role,
    phone: "",
    is_active: true,
  })
  const supabase = createClient()
  const { toast } = useToast()

  const fetchUser = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from("users").select("*").eq("id", id).maybeSingle()
    if (data) {
      const u = data as User
      setTarget(u)
      setForm({
        full_name: u.full_name || "",
        role: u.role,
        phone: u.phone || "",
        is_active: u.is_active,
      })
    }
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  // Owner-only guard
  useEffect(() => {
    if (!authLoading && currentUser && !hasPermission(currentUser.role, "settings", "update")) {
      router.replace("/settings/users")
    }
  }, [authLoading, currentUser, router])

  const handleSave = async () => {
    if (!target) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from("users")
        .update({
          full_name: form.full_name,
          role: form.role,
          phone: form.phone || null,
          is_active: form.is_active,
        })
        .eq("id", target.id)
      if (error) throw error
      toast({ title: "Đã cập nhật người dùng" })
      router.push("/settings/users")
    } catch (err) {
      toast({
        title: "Lỗi",
        description: (err as Error).message,
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!target) return <div className="text-center py-12 text-muted-foreground">Không tìm thấy người dùng</div>

  // Show email only when viewing the currently logged-in user (auth.users not directly readable for other users)
  const displayEmail = authUser && target.id === authUser.id ? authUser.email : ""

  return (
    <div className="space-y-4">
      <PageHeader title={target.full_name} description={`Vai trò hiện tại: ${ROLE_LABELS[target.role] || target.role}`}>
        <Badge variant={target.is_active ? "success" : "secondary"}>
          {target.is_active ? "Đang hoạt động" : "Tạm khóa"}
        </Badge>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Chỉnh sửa thông tin</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Họ tên *</Label>
                <Input
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  value={displayEmail}
                  disabled
                  placeholder={displayEmail ? "" : "Không hiển thị (chỉ đổi qua Supabase Auth)"}
                />
                <p className="text-xs text-muted-foreground">
                  Email được quản lý bởi Supabase Auth, không thể chỉnh sửa tại đây.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Vai trò *</Label>
                <Select
                  value={form.role}
                  onValueChange={(v) => setForm({ ...form, role: v as Role })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r] || r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Số điện thoại</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="0901000001"
                />
              </div>
              <div className="space-y-2">
                <Label>Trạng thái</Label>
                <Select
                  value={form.is_active ? "active" : "inactive"}
                  onValueChange={(v) => setForm({ ...form, is_active: v === "active" })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Đang hoạt động</SelectItem>
                    <SelectItem value="inactive">Tạm khóa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2 border-t border-border/40">
              <Button variant="outline" onClick={() => router.push("/settings/users")} disabled={saving}>
                Hủy
              </Button>
              <Button onClick={handleSave} disabled={saving || !form.full_name}>
                {saving ? "Đang lưu..." : "Lưu thay đổi"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Thông tin tài khoản</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">User ID</Label>
                <p className="font-mono text-xs break-all">{target.id}</p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ngày tạo</Label>
                <p>{new Date(target.created_at).toLocaleString("vi-VN")}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lưu ý</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                Không thể xóa người dùng tại đây vì sẽ ảnh hưởng đến dữ liệu lịch sử (đơn hàng, công nợ, hoa hồng...).
              </p>
              <p>
                Để vô hiệu hóa truy cập, hãy chuyển trạng thái sang &quot;Tạm khóa&quot;.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
