"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, formatDate } from "@/lib/utils"
import { COMMISSION_TYPES } from "@/lib/constants"
import { Pencil, Trash2, X, Power, PowerOff, Plus } from "lucide-react"
import type { CommissionPolicy } from "@/types"

interface TierForm {
  min: string
  max: string
  rate: string
}

export default function CommissionPolicyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("commissions")
  const [policy, setPolicy] = useState<CommissionPolicy | null>(null)
  const [loading, setLoading] = useState(true)
  const [toggleOpen, setToggleOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({
    name: "",
    applies_to: "all",
    effective_from: "",
    effective_to: "",
    is_active: true,
  })
  const [percentageRate, setPercentageRate] = useState("")
  const [fixedAmount, setFixedAmount] = useState("")
  const [tiers, setTiers] = useState<TierForm[]>([{ min: "", max: "", rate: "" }])
  const [actionLoading, setActionLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data, error: dataErr } = await supabase.from("commission_policies").select("id, org_id, name, type, tiers, applies_to, effective_from, effective_to, is_active, created_at").eq("id", id).single()
    if (dataErr) console.error("[policies/id] truy vấn lỗi:", dataErr.message)
    if (data) {
      const p = data as CommissionPolicy
      setPolicy(p)
      setEditForm({
        name: p.name || "",
        applies_to: p.applies_to || "all",
        effective_from: p.effective_from ? p.effective_from.slice(0, 10) : "",
        effective_to: p.effective_to ? p.effective_to.slice(0, 10) : "",
        is_active: p.is_active,
      })
      // Parse tiers based on type
      const t = p.tiers || []
      if (p.type === "percentage" && t.length > 0) {
        const r = t[0].rate as number | undefined
        setPercentageRate(r != null ? String(r * 100) : "")
      } else if (p.type === "fixed" && t.length > 0) {
        const a = t[0].amount as number | undefined
        setFixedAmount(a != null ? String(a) : "")
      } else if (p.type === "tiered") {
        setTiers(
          t.length > 0
            ? t.map((tier) => ({
                min: tier.min != null ? String(tier.min) : "",
                max: tier.max != null ? String(tier.max) : "",
                rate: tier.rate != null ? String((tier.rate as number) * 100) : "",
              }))
            : [{ min: "", max: "", rate: "" }]
        )
      }
    }
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  const handleToggleActive = async () => {
    if (!policy) return
    setActionLoading(true)
    try {
      const { error } = await supabase
        .from("commission_policies")
        .update({ is_active: !policy.is_active })
        .eq("id", policy.id)
      if (error) throw error
      toast({ title: policy.is_active ? "Đã tắt chính sách" : "Đã bật chính sách" })
      setToggleOpen(false)
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!policy) return
    setActionLoading(true)
    try {
      const { error } = await supabase.from("commission_policies").delete().eq("id", policy.id)
      if (error) throw error
      toast({ title: "Đã xóa chính sách hoa hồng" })
      router.push("/commissions/policies")
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
      setActionLoading(false)
    }
  }

  const buildTiersJson = (): Record<string, unknown>[] | null => {
    if (!policy) return null
    if (policy.type === "percentage") {
      const rate = parseFloat(percentageRate)
      if (isNaN(rate) || rate <= 0) {
        toast({ title: "Tỷ lệ phần trăm không hợp lệ", variant: "destructive" })
        return null
      }
      return [{ rate: rate / 100 }]
    }
    if (policy.type === "fixed") {
      const amount = parseFloat(fixedAmount)
      if (isNaN(amount) || amount <= 0) {
        toast({ title: "Số tiền cố định không hợp lệ", variant: "destructive" })
        return null
      }
      return [{ amount }]
    }
    if (policy.type === "tiered") {
      const parsed = tiers.map((t) => ({
        min: parseFloat(t.min),
        max: parseFloat(t.max),
        rate: parseFloat(t.rate) / 100,
      }))
      const invalid = parsed.some((t) => isNaN(t.min) || isNaN(t.max) || isNaN(t.rate) || t.rate <= 0)
      if (invalid) {
        toast({ title: "Các bậc lũy kế không hợp lệ", variant: "destructive" })
        return null
      }
      return parsed
    }
    return null
  }

  const handleSaveEdit = async () => {
    if (!policy) return
    const tiersJson = buildTiersJson()
    if (tiersJson === null) return
    setActionLoading(true)
    try {
      const { error } = await supabase
        .from("commission_policies")
        .update({
          name: editForm.name,
          applies_to: editForm.applies_to || "all",
          effective_from: editForm.effective_from || null,
          effective_to: editForm.effective_to || null,
          is_active: editForm.is_active,
          tiers: tiersJson,
        })
        .eq("id", policy.id)
      if (error) throw error
      toast({ title: "Đã cập nhật chính sách hoa hồng" })
      setEditMode(false)
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  const addTier = () => setTiers([...tiers, { min: "", max: "", rate: "" }])
  const removeTier = (idx: number) => {
    if (tiers.length <= 1) return
    setTiers(tiers.filter((_, i) => i !== idx))
  }
  const updateTier = (idx: number, field: keyof TierForm, value: string) => {
    const updated = [...tiers]
    updated[idx] = { ...updated[idx], [field]: value }
    setTiers(updated)
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!policy) return <div className="text-center py-12 text-muted-foreground">Không tìm thấy chính sách hoa hồng</div>

  const typeLabel = COMMISSION_TYPES.find((t) => t.value === policy.type)?.label || policy.type
  const canEdit = user && hasPermission(user.role, "commissions", "update")
  const canDelete = user && user.role === "owner"

  const renderTiersDisplay = () => {
    const t = policy.tiers || []
    if (policy.type === "percentage" && t.length > 0) {
      const rate = (t[0].rate as number) * 100
      return <p className="text-2xl font-black">{rate.toFixed(2)}%</p>
    }
    if (policy.type === "fixed" && t.length > 0) {
      const amount = t[0].amount as number
      return <p className="text-2xl font-black">{formatCurrency(amount)}</p>
    }
    if (policy.type === "tiered") {
      return (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bậc</TableHead>
              <TableHead className="text-right">Min</TableHead>
              <TableHead className="text-right">Max</TableHead>
              <TableHead className="text-right">Tỷ lệ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {t.map((tier, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">Bậc {i + 1}</TableCell>
                <TableCell className="text-right">{formatCurrency((tier.min as number) || 0)}</TableCell>
                <TableCell className="text-right">{formatCurrency((tier.max as number) || 0)}</TableCell>
                <TableCell className="text-right font-bold">{(((tier.rate as number) || 0) * 100).toFixed(2)}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )
    }
    return <p className="text-muted-foreground">Chưa có cấu hình</p>
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={policy.name}
        description={`${typeLabel} • Tạo: ${formatDate(policy.created_at)}`}
        backHref="/commissions/policies"
      >
        <Badge variant={policy.is_active ? "success" : "secondary"}>
          {policy.is_active ? "Đang áp dụng" : "Ngừng"}
        </Badge>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left column - details */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Thông tin chính sách</CardTitle>
              {canEdit && !editMode && (
                <Button size="sm" variant="ghost" onClick={() => setEditMode(true)}>
                  <Pencil className="h-4 w-4 mr-1" /> Sửa
                </Button>
              )}
              {editMode && (
                <Button size="sm" variant="ghost" onClick={() => {
                  setEditMode(false)
                  fetchData()
                }}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {!editMode ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Tên chính sách</Label>
                    <p className="font-semibold">{policy.name}</p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Loại</Label>
                    <p><Badge variant="outline">{typeLabel}</Badge></p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Áp dụng cho</Label>
                    <p>{policy.applies_to === "all" ? "Tất cả" : policy.applies_to}</p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Trạng thái</Label>
                    <p>
                      <Badge variant={policy.is_active ? "success" : "secondary"}>
                        {policy.is_active ? "Đang áp dụng" : "Ngừng"}
                      </Badge>
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Hiệu lực từ</Label>
                    <p>{policy.effective_from ? formatDate(policy.effective_from) : <span className="text-muted-foreground">-</span>}</p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Hiệu lực đến</Label>
                    <p>{policy.effective_to ? formatDate(policy.effective_to) : <span className="text-muted-foreground">Vô thời hạn</span>}</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Tên chính sách *</Label>
                      <Input
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Áp dụng cho</Label>
                      <Input
                        value={editForm.applies_to}
                        onChange={(e) => setEditForm({ ...editForm, applies_to: e.target.value })}
                        placeholder="all"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Hiệu lực từ</Label>
                      <Input
                        type="date"
                        value={editForm.effective_from}
                        onChange={(e) => setEditForm({ ...editForm, effective_from: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Hiệu lực đến</Label>
                      <Input
                        type="date"
                        value={editForm.effective_to}
                        onChange={(e) => setEditForm({ ...editForm, effective_to: e.target.value })}
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
                    <Label htmlFor="is_active">Kích hoạt chính sách</Label>
                  </div>

                  {/* Tier-specific edit */}
                  <div className="border-t border-border/40 pt-4 space-y-3">
                    <Label className="text-sm font-semibold">Cấu hình ({typeLabel})</Label>
                    {policy.type === "percentage" && (
                      <div className="space-y-1">
                        <Label>Tỷ lệ hoa hồng (%) *</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={percentageRate}
                          onChange={(e) => setPercentageRate(e.target.value)}
                        />
                      </div>
                    )}
                    {policy.type === "fixed" && (
                      <div className="space-y-1">
                        <Label>Số tiền cố định (VND) *</Label>
                        <Input
                          type="number"
                          step="1"
                          min="0"
                          value={fixedAmount}
                          onChange={(e) => setFixedAmount(e.target.value)}
                        />
                      </div>
                    )}
                    {policy.type === "tiered" && (
                      <div className="space-y-3">
                        {tiers.map((tier, idx) => (
                          <div key={idx} className="flex items-end gap-2">
                            <div className="space-y-1 flex-1">
                              {idx === 0 && <Label className="text-xs text-muted-foreground">Min</Label>}
                              <Input
                                type="number"
                                value={tier.min}
                                onChange={(e) => updateTier(idx, "min", e.target.value)}
                                placeholder="0"
                              />
                            </div>
                            <div className="space-y-1 flex-1">
                              {idx === 0 && <Label className="text-xs text-muted-foreground">Max</Label>}
                              <Input
                                type="number"
                                value={tier.max}
                                onChange={(e) => updateTier(idx, "max", e.target.value)}
                                placeholder="10000000"
                              />
                            </div>
                            <div className="space-y-1 flex-1">
                              {idx === 0 && <Label className="text-xs text-muted-foreground">Tỷ lệ (%)</Label>}
                              <Input
                                type="number"
                                step="0.01"
                                value={tier.rate}
                                onChange={(e) => updateTier(idx, "rate", e.target.value)}
                                placeholder="3"
                              />
                            </div>
                            <Button type="button" variant="ghost" size="icon" onClick={() => removeTier(idx)} disabled={tiers.length <= 1}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                        <Button type="button" variant="outline" size="sm" onClick={addTier}>
                          <Plus className="mr-2 h-4 w-4" /> Thêm bậc
                        </Button>
                      </div>
                    )}
                  </div>

                  <Button onClick={handleSaveEdit} disabled={actionLoading} className="w-full">
                    {actionLoading ? "Đang lưu..." : "Lưu thay đổi"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {/* Tiers display */}
          {!editMode && (
            <Card>
              <CardHeader><CardTitle>Cấu hình hoa hồng</CardTitle></CardHeader>
              <CardContent>
                {renderTiersDisplay()}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column - actions */}
        <div className="space-y-4">
          {/* Toggle active */}
          {canEdit && (
            <Card>
              <CardHeader><CardTitle>Trạng thái</CardTitle></CardHeader>
              <CardContent>
                <Button
                  onClick={() => setToggleOpen(true)}
                  variant={policy.is_active ? "destructive" : "default"}
                  className="w-full justify-start"
                  size="lg"
                >
                  {policy.is_active ? (
                    <><PowerOff className="h-4 w-4 mr-2" /> Tắt chính sách</>
                  ) : (
                    <><Power className="h-4 w-4 mr-2" /> Bật chính sách</>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground mt-2">
                  {policy.is_active
                    ? "Chính sách đang được áp dụng để tính hoa hồng"
                    : "Chính sách không được áp dụng để tính hoa hồng"}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Delete - owner only */}
          {canDelete && (
            <Card>
              <CardHeader><CardTitle>Thao tác</CardTitle></CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  className="w-full justify-start text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Xóa chính sách
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
        title={policy.is_active ? "Tắt chính sách?" : "Bật chính sách?"}
        description={policy.is_active
          ? `Chính sách "${policy.name}" sẽ ngừng được áp dụng để tính hoa hồng.`
          : `Chính sách "${policy.name}" sẽ được áp dụng để tính hoa hồng.`}
        variant={policy.is_active ? "destructive" : "default"}
        confirmLabel={policy.is_active ? "Tắt" : "Bật"}
        onConfirm={handleToggleActive}
        loading={actionLoading}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xóa vĩnh viễn chính sách?"
        description={`Chính sách "${policy.name}" sẽ bị xóa vĩnh viễn. Không thể khôi phục.`}
        variant="destructive"
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={handleDelete}
        loading={actionLoading}
      />
    </div>
  )
}
