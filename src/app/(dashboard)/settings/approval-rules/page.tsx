"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils"
import { DEFAULT_APPROVAL_RULES } from "@/lib/approval"
import { Save, RotateCcw, Info } from "lucide-react"
import type { ApprovalRules } from "@/types"

export default function ApprovalRulesPage() {
  const { loading: authLoading } = useRoleGuard("settings")
  const { user: authUser } = useAuth()
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const [rules, setRules] = useState<ApprovalRules | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function fetchRules() {
      if (!authUser?.org_id) return
      setLoading(true)
      const { data, error: dataErr } = await supabase
        .from("approval_rules")
        .select("id, org_id, auto_approve_max, manager_approve_max, customer_debt_max, customer_overdue_max, rep_portfolio_debt_max, enforce_credit_limit, notes, is_active, updated_by, created_at, updated_at")
        .eq("org_id", authUser.org_id)
        .maybeSingle()
      if (dataErr) console.error("[settings/approval-rules] truy vấn lỗi:", dataErr.message)

      if (data) {
        setRules(data as ApprovalRules)
      } else {
        setRules({
          id: "",
          org_id: authUser.org_id,
          ...DEFAULT_APPROVAL_RULES,
          updated_by: null,
          created_at: "",
          updated_at: "",
        } as ApprovalRules)
      }
      setLoading(false)
    }
    fetchRules()
  }, [authUser?.org_id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading || !rules) return <Skeleton className="h-96" />

  const update = <K extends keyof ApprovalRules>(key: K, value: ApprovalRules[K]) => {
    setRules((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  const parseMoney = (value: string): number => {
    const n = parseFloat(value.replace(/[^\d]/g, ""))
    return isNaN(n) ? 0 : n
  }

  const handleSave = async () => {
    if (!authUser || !rules) return
    setSaving(true)
    try {
      const payload: Partial<ApprovalRules> = {
        org_id: authUser.org_id,
        auto_approve_max: rules.auto_approve_max,
        manager_approve_max: rules.manager_approve_max,
        customer_debt_max: rules.customer_debt_max,
        customer_overdue_max: rules.customer_overdue_max,
        rep_portfolio_debt_max: rules.rep_portfolio_debt_max,
        enforce_credit_limit: rules.enforce_credit_limit,
        notes: rules.notes,
        is_active: rules.is_active,
        updated_by: authUser.id,
      }

      if (rules.id) {
        const { error } = await supabase
          .from("approval_rules")
          .update(payload)
          .eq("id", rules.id)
        if (error) throw error
      } else {
        const { data, error } = await supabase
          .from("approval_rules")
          .insert(payload)
          .select("id, org_id, auto_approve_max, manager_approve_max, customer_debt_max, customer_overdue_max, rep_portfolio_debt_max, enforce_credit_limit, notes, is_active, updated_by, created_at, updated_at")
          .single()
        if (error) throw error
        if (data) setRules(data as ApprovalRules)
      }

      toast({ title: "Đã lưu quy tắc duyệt" })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Không thể lưu"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setRules((prev) =>
      prev
        ? {
            ...prev,
            ...DEFAULT_APPROVAL_RULES,
          }
        : prev
    )
  }

  // Role check — only owner/manager can edit, but we still show to accountant in read-only
  const canEdit = authUser && ["owner", "manager"].includes(authUser.role)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Duyệt đơn tự động"
        description="Cấu hình ngưỡng để đơn hàng được duyệt tự động hoặc chuyển sang chờ duyệt"
        backHref="/settings"
      >
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw className="h-4 w-4 mr-1.5" /> Mặc định
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4 mr-1.5" /> {saving ? "Đang lưu..." : "Lưu"}
            </Button>
          </div>
        )}
      </PageHeader>

      {!canEdit && (
        <div className="rounded-xl bg-[#fff4ed] border border-[#fdb022]/40 p-3 text-sm text-[#b54708] flex items-start gap-2">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          Chỉ Owner/Manager mới có thể chỉnh quy tắc duyệt. Bạn có thể xem cấu hình hiện tại.
        </div>
      )}

      {/* Kích hoạt */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trạng thái</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">Bật quy tắc duyệt tự động</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Khi tắt, mọi đơn đều phải duyệt thủ công
              </p>
            </div>
            <Switch
              checked={rules.is_active}
              onCheckedChange={(v) => update("is_active", v)}
              disabled={!canEdit}
            />
          </div>
        </CardContent>
      </Card>

      {/* Ngưỡng giá trị đơn */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ngưỡng theo giá trị đơn</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Duyệt tự động khi đơn &lt;</Label>
            <Input
              type="number"
              value={rules.auto_approve_max || ""}
              onChange={(e) => update("auto_approve_max", parseMoney(e.target.value))}
              disabled={!canEdit}
            />
            <p className="text-xs text-muted-foreground">
              Hiện tại: {formatCurrency(rules.auto_approve_max)}
            </p>
          </div>
          <div className="space-y-2">
            <Label>Manager được duyệt tới</Label>
            <Input
              type="number"
              value={rules.manager_approve_max || ""}
              onChange={(e) => update("manager_approve_max", parseMoney(e.target.value))}
              disabled={!canEdit}
            />
            <p className="text-xs text-muted-foreground">
              Đơn &gt; {formatCurrency(rules.manager_approve_max)} cần Owner duyệt
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Ngưỡng công nợ khách hàng */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ngưỡng theo công nợ khách hàng</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Tổng công nợ KH vượt</Label>
            <Input
              type="number"
              value={rules.customer_debt_max || ""}
              onChange={(e) => update("customer_debt_max", parseMoney(e.target.value))}
              placeholder="0 = không áp dụng"
              disabled={!canEdit}
            />
            <p className="text-xs text-muted-foreground">
              {rules.customer_debt_max > 0
                ? `Chặn tự động nếu KH đang nợ > ${formatCurrency(rules.customer_debt_max)}`
                : "Chưa áp dụng"}
            </p>
          </div>
          <div className="space-y-2">
            <Label>Công nợ quá hạn vượt</Label>
            <Input
              type="number"
              value={rules.customer_overdue_max || ""}
              onChange={(e) => update("customer_overdue_max", parseMoney(e.target.value))}
              placeholder="0 = không áp dụng"
              disabled={!canEdit}
            />
            <p className="text-xs text-muted-foreground">
              {rules.customer_overdue_max > 0
                ? `Chặn tự động nếu quá hạn > ${formatCurrency(rules.customer_overdue_max)}`
                : "Chưa áp dụng"}
            </p>
          </div>
          <div className="sm:col-span-2 flex items-center justify-between rounded-xl border p-3">
            <div>
              <p className="font-semibold text-sm">Kiểm tra hạn mức tín dụng của KH</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Chặn nếu dư nợ hiện tại + đơn mới &gt; hạn mức (credit_limit) của KH
              </p>
            </div>
            <Switch
              checked={rules.enforce_credit_limit}
              onCheckedChange={(v) => update("enforce_credit_limit", v)}
              disabled={!canEdit}
            />
          </div>
        </CardContent>
      </Card>

      {/* Ngưỡng công nợ nhân viên */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ngưỡng theo công nợ nhân viên</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label>Tổng công nợ KH do NV phụ trách vượt</Label>
            <Input
              type="number"
              value={rules.rep_portfolio_debt_max || ""}
              onChange={(e) => update("rep_portfolio_debt_max", parseMoney(e.target.value))}
              placeholder="0 = không áp dụng"
              disabled={!canEdit}
            />
            <p className="text-xs text-muted-foreground">
              {rules.rep_portfolio_debt_max > 0
                ? `Chặn tự động nếu NV đang phụ trách nợ > ${formatCurrency(rules.rep_portfolio_debt_max)}`
                : "Chưa áp dụng"}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Ghi chú */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ghi chú nội bộ</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={3}
            value={rules.notes || ""}
            onChange={(e) => update("notes", e.target.value)}
            placeholder="VD: Tạm dừng tự động duyệt vào cuối quý..."
            disabled={!canEdit}
          />
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => router.push("/settings")}>
            Hủy
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-1.5" /> {saving ? "Đang lưu..." : "Lưu quy tắc"}
          </Button>
        </div>
      )}
    </div>
  )
}
