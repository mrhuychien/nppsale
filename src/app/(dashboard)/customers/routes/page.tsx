"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { Plus, Pencil, Trash2, Route, Info } from "lucide-react"
import type { SalesRoute } from "@/types"

export default function SalesRoutesPage() {
  const { loading: authLoading } = useRoleGuard("customers")
  const { user } = useAuth()
  const supabase = createClient()
  const { toast } = useToast()

  const [routes, setRoutes] = useState<SalesRoute[]>([])
  const [customerCounts, setCustomerCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SalesRoute | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const [form, setForm] = useState({
    code: "",
    name: "",
    description: "",
    sort_order: 0,
    is_active: true,
  })

  const fetchData = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const [routesRes, custRes] = await Promise.all([
      supabase
        .from("sales_routes")
        .select("id, org_id, code, name, description, is_active, sort_order, created_at, updated_at")
        .eq("org_id", user.org_id)
        .order("sort_order")
        .order("code"),
      supabase
        .from("customers")
        .select("channel")
        .eq("org_id", user.org_id),
    ])
    setRoutes((routesRes.data as SalesRoute[]) || [])
    const counts: Record<string, number> = {}
    for (const c of (custRes.data as Array<{ channel: string | null }>) || []) {
      if (c.channel) counts[c.channel] = (counts[c.channel] || 0) + 1
    }
    setCustomerCounts(counts)
    setLoading(false)
  }, [user?.org_id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  const openCreate = () => {
    setEditing(null)
    setForm({ code: "", name: "", description: "", sort_order: routes.length + 1, is_active: true })
    setDialogOpen(true)
  }
  const openEdit = (r: SalesRoute) => {
    setEditing(r)
    setForm({
      code: r.code,
      name: r.name,
      description: r.description || "",
      sort_order: r.sort_order,
      is_active: r.is_active,
    })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!user?.org_id) return
    const code = form.code.trim().toUpperCase()
    const name = form.name.trim()
    if (!code || !name) {
      toast({ title: "Thiếu mã hoặc tên tuyến", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      if (editing) {
        const { error } = await supabase
          .from("sales_routes")
          .update({
            code,
            name,
            description: form.description.trim() || null,
            sort_order: form.sort_order,
            is_active: form.is_active,
          })
          .eq("id", editing.id)
        if (error) throw error
        // If the code changed, update every customer row that referenced the old code
        if (editing.code !== code) {
          await supabase
            .from("customers")
            .update({ channel: code })
            .eq("org_id", user.org_id)
            .eq("channel", editing.code)
        }
        toast({ title: `Đã cập nhật tuyến ${code}` })
      } else {
        const { error } = await supabase.from("sales_routes").insert({
          org_id: user.org_id,
          code,
          name,
          description: form.description.trim() || null,
          sort_order: form.sort_order,
          is_active: form.is_active,
        })
        if (error) throw error
        toast({ title: `Đã tạo tuyến ${code}` })
      }
      setDialogOpen(false)
      fetchData()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Lỗi khi lưu"
      toast({ title: "Lỗi", description: msg, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (r: SalesRoute) => {
    const count = customerCounts[r.code] || 0
    if (count > 0) {
      if (!confirm(
        `Tuyến ${r.code} đang có ${count} khách hàng. Xóa sẽ giữ các khách hàng đó nhưng bỏ tuyến (ô "Tuyến bán hàng" trống). Tiếp tục?`
      )) return
    } else {
      if (!confirm(`Xóa tuyến ${r.code}?`)) return
    }
    setDeleting(r.id)
    try {
      // Clear channel on customers pointing at this route
      if (count > 0) {
        await supabase
          .from("customers")
          .update({ channel: null })
          .eq("org_id", r.org_id)
          .eq("channel", r.code)
      }
      const { error } = await supabase.from("sales_routes").delete().eq("id", r.id)
      if (error) throw error
      toast({ title: `Đã xóa tuyến ${r.code}` })
      fetchData()
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
    } finally {
      setDeleting(null)
    }
  }

  const canEdit = user && ["owner", "manager"].includes(user.role)

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tuyến bán hàng"
        description="Thay cho 'Kênh bán' cũ. Thêm / sửa / xóa các tuyến bán hàng theo đặc điểm NPP."
        backHref="/customers"
      >
        {canEdit && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1.5" /> Thêm tuyến
          </Button>
        )}
      </PageHeader>

      <div className="rounded-xl border border-dashed p-3 flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        Khi đổi mã tuyến, hệ thống tự cập nhật cho tất cả khách hàng đang gắn
        với tuyến cũ. Khi xóa tuyến đang có khách, trường &ldquo;Tuyến bán hàng&rdquo;
        của các khách hàng đó sẽ bị xóa trắng (không xóa khách hàng).
      </div>

      {loading ? (
        <Skeleton className="h-64" />
      ) : routes.length === 0 ? (
        <EmptyState
          icon={<Route className="h-8 w-8 text-muted-foreground" />}
          title="Chưa có tuyến bán hàng"
          description="Thêm tuyến đầu tiên (VD: GT, MT, HORECA, TUYEN-1)"
        >
          {canEdit && (
            <Button className="mt-4" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1.5" /> Thêm tuyến đầu tiên
            </Button>
          )}
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {routes.map((r) => {
            const count = customerCounts[r.code] || 0
            return (
              <Card key={r.id}>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="shrink-0 w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    <Route className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-bold text-primary">{r.code}</span>
                      <span className="font-semibold">{r.name}</span>
                      {!r.is_active && <Badge variant="secondary">Tạm ngừng</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {count} khách hàng
                      {r.description ? ` • ${r.description}` : ""}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="shrink-0 flex gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive"
                        onClick={() => handleDelete(r)}
                        disabled={deleting === r.id}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <div className="flex justify-center">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/customers">← Về danh sách khách hàng</Link>
        </Button>
      </div>

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Sửa tuyến bán hàng" : "Thêm tuyến bán hàng"}</DialogTitle>
            <DialogDescription>
              Mã tuyến là duy nhất trong tổ chức, viết hoa (VD: GT, MT, HORECA, TUYEN1).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Mã tuyến *</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="GT"
                className="font-mono uppercase"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tên tuyến *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="General Trade"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Mô tả</Label>
              <Textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Chi tiết khu vực, đặc điểm KH..."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Thứ tự hiển thị</Label>
                <Input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Trạng thái</Label>
                <label className="flex items-center gap-2 h-10 px-3 rounded-md border cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                    className="h-4 w-4"
                  />
                  <span className="text-sm">Đang hoạt động</span>
                </label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Hủy
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Đang lưu..." : editing ? "Cập nhật" : "Tạo tuyến"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
