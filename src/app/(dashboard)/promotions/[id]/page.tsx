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
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { formatDate } from "@/lib/utils"
import { PROMOTION_TYPES } from "@/lib/constants"
import { Pencil, Trash2, X, Power, PowerOff } from "lucide-react"
import type { Promotion } from "@/types"

export default function PromotionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("promotions")
  const [promotion, setPromotion] = useState<Promotion | null>(null)
  const [loading, setLoading] = useState(true)
  const [toggleOpen, setToggleOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({
    name: "",
    priority: 0,
    starts_at: "",
    ends_at: "",
    is_active: true,
  })
  const [actionLoading, setActionLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from("promotions").select("*").eq("id", id).single()
    if (data) {
      const p = data as Promotion
      setPromotion(p)
      setEditForm({
        name: p.name || "",
        priority: p.priority || 0,
        starts_at: p.starts_at ? p.starts_at.slice(0, 10) : "",
        ends_at: p.ends_at ? p.ends_at.slice(0, 10) : "",
        is_active: p.is_active,
      })
    }
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  const handleToggleActive = async () => {
    if (!promotion) return
    setActionLoading(true)
    try {
      const { error } = await supabase
        .from("promotions")
        .update({ is_active: !promotion.is_active })
        .eq("id", promotion.id)
      if (error) throw error
      toast({ title: promotion.is_active ? "Đã tắt khuyến mãi" : "Đã bật khuyến mãi" })
      setToggleOpen(false)
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!promotion) return
    setActionLoading(true)
    try {
      const { error } = await supabase.from("promotions").delete().eq("id", promotion.id)
      if (error) throw error
      toast({ title: "Đã xóa chương trình khuyến mãi" })
      router.push("/promotions")
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
      setActionLoading(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!promotion) return
    setActionLoading(true)
    try {
      const { error } = await supabase
        .from("promotions")
        .update({
          name: editForm.name,
          priority: editForm.priority,
          starts_at: editForm.starts_at || null,
          ends_at: editForm.ends_at || null,
          is_active: editForm.is_active,
        })
        .eq("id", promotion.id)
      if (error) throw error
      toast({ title: "Đã cập nhật khuyến mãi" })
      setEditMode(false)
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!promotion) return <div className="text-center py-12 text-muted-foreground">Không tìm thấy khuyến mãi</div>

  const typeLabel = PROMOTION_TYPES.find((t) => t.value === promotion.type)?.label || promotion.type
  const canEdit = user && hasPermission(user.role, "promotions", "update")
  const canDelete = user && ["owner", "manager"].includes(user.role)

  return (
    <div className="space-y-4">
      <PageHeader
        title={promotion.name}
        description={`${typeLabel} • Tạo: ${formatDate(promotion.created_at)}`}
      >
        <Badge variant={promotion.is_active ? "success" : "secondary"}>
          {promotion.is_active ? "Đang chạy" : "Ngừng"}
        </Badge>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left column - details */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Thông tin khuyến mãi</CardTitle>
              {canEdit && !editMode && (
                <Button size="sm" variant="ghost" onClick={() => setEditMode(true)}>
                  <Pencil className="h-4 w-4 mr-1" /> Sửa
                </Button>
              )}
              {editMode && (
                <Button size="sm" variant="ghost" onClick={() => {
                  setEditMode(false)
                  setEditForm({
                    name: promotion.name || "",
                    priority: promotion.priority || 0,
                    starts_at: promotion.starts_at ? promotion.starts_at.slice(0, 10) : "",
                    ends_at: promotion.ends_at ? promotion.ends_at.slice(0, 10) : "",
                    is_active: promotion.is_active,
                  })
                }}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {!editMode ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Tên chương trình</Label>
                      <p className="font-semibold">{promotion.name}</p>
                    </div>
                    <div>
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Loại</Label>
                      <p><Badge variant="outline">{typeLabel}</Badge></p>
                    </div>
                    <div>
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Độ ưu tiên</Label>
                      <p>{promotion.priority}</p>
                    </div>
                    <div>
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Trạng thái</Label>
                      <p>
                        <Badge variant={promotion.is_active ? "success" : "secondary"}>
                          {promotion.is_active ? "Đang chạy" : "Ngừng"}
                        </Badge>
                      </p>
                    </div>
                    <div>
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Bắt đầu</Label>
                      <p>{promotion.starts_at ? formatDate(promotion.starts_at) : <span className="text-muted-foreground">-</span>}</p>
                    </div>
                    <div>
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Kết thúc</Label>
                      <p>{promotion.ends_at ? formatDate(promotion.ends_at) : <span className="text-muted-foreground">Vô thời hạn</span>}</p>
                    </div>
                  </div>
                  {promotion.target_groups && promotion.target_groups.length > 0 && (
                    <div>
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Nhóm áp dụng</Label>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {promotion.target_groups.map((g, i) => (
                          <Badge key={i} variant="outline">{g}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Tên chương trình *</Label>
                      <Input
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Độ ưu tiên</Label>
                      <Input
                        type="number"
                        value={editForm.priority}
                        onChange={(e) => setEditForm({ ...editForm, priority: parseInt(e.target.value) || 0 })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Bắt đầu</Label>
                      <Input
                        type="date"
                        value={editForm.starts_at}
                        onChange={(e) => setEditForm({ ...editForm, starts_at: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Kết thúc</Label>
                      <Input
                        type="date"
                        value={editForm.ends_at}
                        onChange={(e) => setEditForm({ ...editForm, ends_at: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="is_active"
                      checked={editForm.is_active}
                      onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
                      className="h-4 w-4"
                    />
                    <Label htmlFor="is_active">Kích hoạt khuyến mãi</Label>
                  </div>
                  <Button onClick={handleSaveEdit} disabled={actionLoading} className="w-full">
                    {actionLoading ? "Đang lưu..." : "Lưu thay đổi"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {/* Rules - JSON */}
          <Card>
            <CardHeader><CardTitle>Quy tắc khuyến mãi (Rules)</CardTitle></CardHeader>
            <CardContent>
              <pre className="bg-surface-low rounded-xl p-4 text-xs font-mono overflow-x-auto">
                {JSON.stringify(promotion.rules || {}, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </div>

        {/* Right column - actions */}
        <div className="space-y-4">
          {/* Toggle active - prominent */}
          {canEdit && (
            <Card>
              <CardHeader><CardTitle>Trạng thái hoạt động</CardTitle></CardHeader>
              <CardContent>
                <Button
                  onClick={() => setToggleOpen(true)}
                  variant={promotion.is_active ? "destructive" : "default"}
                  className="w-full justify-start"
                  size="lg"
                >
                  {promotion.is_active ? (
                    <><PowerOff className="h-4 w-4 mr-2" /> Tắt khuyến mãi</>
                  ) : (
                    <><Power className="h-4 w-4 mr-2" /> Bật khuyến mãi</>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground mt-2">
                  {promotion.is_active
                    ? "Chương trình đang được áp dụng cho đơn hàng"
                    : "Chương trình không được áp dụng cho đơn hàng"}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Delete */}
          {canDelete && (
            <Card>
              <CardHeader><CardTitle>Thao tác</CardTitle></CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  className="w-full justify-start text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Xóa khuyến mãi
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Toggle confirm */}
      <ConfirmDialog
        open={toggleOpen}
        onOpenChange={setToggleOpen}
        title={promotion.is_active ? "Tắt khuyến mãi?" : "Bật khuyến mãi?"}
        description={promotion.is_active
          ? `Chương trình "${promotion.name}" sẽ ngừng áp dụng cho đơn hàng mới.`
          : `Chương trình "${promotion.name}" sẽ được áp dụng cho đơn hàng mới.`}
        variant={promotion.is_active ? "destructive" : "default"}
        confirmLabel={promotion.is_active ? "Tắt" : "Bật"}
        onConfirm={handleToggleActive}
        loading={actionLoading}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xóa vĩnh viễn khuyến mãi?"
        description={`Chương trình "${promotion.name}" sẽ bị xóa vĩnh viễn. Không thể khôi phục.`}
        variant="destructive"
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={handleDelete}
        loading={actionLoading}
      />
    </div>
  )
}
