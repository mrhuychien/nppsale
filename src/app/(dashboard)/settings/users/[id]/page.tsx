"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PermissionMatrix } from "@/components/settings/permission-matrix"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
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
    username: "",
    is_active: true,
    allow_price_edit: false,
    price_edit_max_increase_pct: 0,
  })
  const [allSuppliers, setAllSuppliers] = useState<{ id: string; name: string }[]>([])
  const [supplierIds, setSupplierIds] = useState<Set<string>>(new Set())
  const supabase = createClient()
  const { toast } = useToast()

  const fetchUser = useCallback(async () => {
    setLoading(true)
    const [userRes, supRes, mySupRes] = await Promise.all([
      supabase.from("users").select("id, org_id, full_name, role, phone, username, is_active, allow_price_edit, price_edit_max_increase_pct, created_at").eq("id", id).maybeSingle(),
      supabase.from("suppliers").select("id, name").order("name"),
      supabase.from("user_suppliers").select("supplier_id").eq("user_id", id),
    ])
    const qErr = ([userRes, supRes, mySupRes] as Array<{ error?: { message?: string } | null }>)
      .find((r) => r?.error)?.error
    if (qErr) console.error("[users/id] truy vấn lỗi:", qErr.message)
    if (userRes.data) {
      const u = userRes.data as User
      setTarget(u)
      setForm({
        full_name: u.full_name || "",
        role: u.role,
        phone: u.phone || "",
        username: u.username || "",
        is_active: u.is_active,
        allow_price_edit: u.allow_price_edit ?? false,
        price_edit_max_increase_pct: u.price_edit_max_increase_pct ?? 0,
      })
    }
    setAllSuppliers((supRes.data as { id: string; name: string }[]) || [])
    setSupplierIds(new Set(
      ((mySupRes.data as { supplier_id: string }[]) || []).map((r) => r.supplier_id)
    ))
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
      const cleanUsername = form.username.trim()
      const { error } = await supabase
        .from("users")
        .update({
          full_name: form.full_name,
          role: form.role,
          phone: form.phone || null,
          username: cleanUsername || null,
          is_active: form.is_active,
          allow_price_edit: form.allow_price_edit,
          price_edit_max_increase_pct: form.allow_price_edit
            ? Math.max(0, Math.min(100, Number(form.price_edit_max_increase_pct) || 0))
            : 0,
        })
        .eq("id", target.id)
      if (error) {
        if (/idx_users_username_unique/i.test(error.message)) {
          throw new Error("Tên tài khoản đã được dùng. Chọn tên khác.")
        }
        if (/idx_users_phone_unique/i.test(error.message)) {
          throw new Error("Số điện thoại đã được dùng. Chọn số khác.")
        }
        throw error
      }

      // Sync user_suppliers — diff state Set vs DB: delete cũ-không-còn, insert mới.
      const { data: currentRows, error: currentRowsErr } = await supabase
        .from("user_suppliers")
        .select("supplier_id")
        .eq("user_id", target.id)
      if (currentRowsErr) console.error("[users/id] truy vấn lỗi:", currentRowsErr.message)
      const currentIds = new Set(
        ((currentRows as { supplier_id: string }[]) || []).map((r) => r.supplier_id)
      )
      const toDelete = Array.from(currentIds).filter((sid) => !supplierIds.has(sid))
      const toInsert = Array.from(supplierIds).filter((sid) => !currentIds.has(sid))
      if (toDelete.length > 0) {
        const { error: delErr } = await supabase
          .from("user_suppliers")
          .delete()
          .eq("user_id", target.id)
          .in("supplier_id", toDelete)
        if (delErr) throw delErr
      }
      if (toInsert.length > 0 && target.org_id) {
        const { error: insErr } = await supabase.from("user_suppliers").insert(
          toInsert.map((sid) => ({
            user_id: target.id,
            supplier_id: sid,
            org_id: target.org_id,
          }))
        )
        if (insErr) throw insErr
      }

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
      <PageHeader title={target.full_name} description={`Vai trò hiện tại: ${ROLE_LABELS[target.role] || target.role}`} backHref="/settings/users">
        <Badge variant={target.is_active ? "success" : "secondary"}>
          {target.is_active ? "Đang hoạt động" : "Tạm khóa"}
        </Badge>
        {/* T-13: per-user permission overrides */}
        <Link
          href={`/settings/users/${target.id}/permissions`}
          className="text-sm font-medium text-primary hover:underline"
        >
          Phân quyền tuỳ chỉnh →
        </Link>
        {/* T-15: per-user salary config */}
        <Link
          href={`/settings/users/${target.id}/salary`}
          className="text-sm font-medium text-primary hover:underline"
        >
          Cấu hình lương →
        </Link>
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
                <p className="text-[10px] text-muted-foreground">
                  Dùng được làm tên đăng nhập (nếu duy nhất).
                </p>
              </div>
              <div className="space-y-2">
                <Label>Tài khoản đăng nhập</Label>
                <Input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="nguyenvana"
                  autoComplete="off"
                />
                <p className="text-[10px] text-muted-foreground">
                  Tuỳ chọn. Chữ + số, không khoảng trắng. Dùng đăng nhập thay email.
                </p>
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

            <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-3 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Quyền sửa giá khi tạo / sửa đơn
              </p>
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-background p-2">
                <div>
                  <Label className="text-xs">Cho phép sửa giá</Label>
                  <p className="text-[10px] text-muted-foreground">
                    Bật để nhân viên chỉnh được unit_price khi tạo / sửa đơn.
                  </p>
                </div>
                <Switch
                  checked={form.allow_price_edit}
                  onCheckedChange={(v) => setForm({ ...form, allow_price_edit: v })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">% tăng tối đa so với giá list</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={form.price_edit_max_increase_pct}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      price_edit_max_increase_pct: Math.max(
                        0,
                        Math.min(100, parseFloat(e.target.value) || 0)
                      ),
                    })
                  }
                  disabled={!form.allow_price_edit}
                />
                <p className="text-[10px] text-muted-foreground">
                  VD 10 = giá tối đa = giá list × 1,10. Chỉ áp dụng khi bật &ldquo;Cho phép sửa giá&rdquo;.
                </p>
              </div>
            </div>

            {form.role === "sales" && (
              <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Phân quyền theo NCC
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      NV chỉ thấy SP thuộc các NCC được chọn. Bỏ chọn hết = thấy SP chưa gán NCC (legacy).
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                    {supplierIds.size}/{allSuppliers.length}
                    {supplierIds.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setSupplierIds(new Set())}
                        className="text-primary hover:underline ml-1"
                      >
                        Bỏ tất cả
                      </button>
                    )}
                    {supplierIds.size < allSuppliers.length && (
                      <button
                        type="button"
                        onClick={() => setSupplierIds(new Set(allSuppliers.map((s) => s.id)))}
                        className="text-primary hover:underline ml-1"
                      >
                        Chọn tất cả
                      </button>
                    )}
                  </div>
                </div>
                {allSuppliers.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    Chưa có NCC nào. Vào{" "}
                    <Link href="/suppliers" className="text-primary hover:underline">
                      Nhà cung cấp
                    </Link>{" "}
                    để tạo.
                  </p>
                ) : (
                  <div className="grid gap-1.5 sm:grid-cols-2 max-h-64 overflow-y-auto rounded-lg border bg-background p-2">
                    {allSuppliers.map((s) => {
                      const checked = supplierIds.has(s.id)
                      return (
                        <label
                          key={s.id}
                          className={
                            "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50 " +
                            (checked ? "bg-primary/[0.06]" : "")
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = new Set(supplierIds)
                              if (e.target.checked) next.add(s.id)
                              else next.delete(s.id)
                              setSupplierIds(next)
                            }}
                            className="h-4 w-4 accent-primary"
                          />
                          <span className="truncate">{s.name}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

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

      {/* Phân quyền chi tiết — embedded matrix giống /settings/permissions
          (role page) nhưng cho user cụ thể. Click cell để cycle 3 trạng
          thái: theo vai trò / cấp quyền / thu hồi. */}
      <Card>
        <CardHeader>
          <CardTitle>Phân quyền chi tiết</CardTitle>
          <p className="text-xs text-muted-foreground">
            Tuỳ chỉnh quyền per-user. Mặc định inherit theo vai trò; click cell
            để cấp / thu hồi từng action. Owner luôn có toàn quyền.
          </p>
        </CardHeader>
        <CardContent>
          <PermissionMatrix
            userId={target.id}
            userRole={target.role}
            orgId={target.org_id}
          />
        </CardContent>
      </Card>
    </div>
  )
}
