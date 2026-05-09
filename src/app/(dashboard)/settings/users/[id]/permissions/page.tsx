"use client"

/**
 * T-13: per-user permission override page.
 *
 * /settings/users/[id]/permissions
 *
 * Shows the standard module × action matrix. Each cell stores an
 * explicit grant/revoke in user_permission_overrides; removing the
 * row reverts the cell to the user's role default (the org-level
 * role_permissions / DEFAULT_PERMISSION_MAP).
 *
 * Tri-state toggle per cell:
 *   "Theo vai trò"  → no override row
 *   "Cấp quyền"     → override row with granted=true
 *   "Thu hồi"       → override row with granted=false
 *
 * Effective value shown next to the toggle so the user can see what
 * the role default actually is.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useToast } from "@/hooks/use-toast"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ChevronLeft, RotateCcw } from "lucide-react"
import {
  ACTIONS,
  ACTION_LABELS,
  MODULES,
  MODULE_LABELS,
  ROLE_LABELS,
  hasPermission,
  type Action,
  type Module,
  type Role,
} from "@/lib/permissions"

/**
 * Pack3 spec D8/D13 flat permission keys. These are override-only
 * (no role_permissions equivalent) and grant special capabilities
 * referenced by RLS or feature gates.
 */
interface SpecPermission {
  key: string
  label: string
}
interface SpecGroup {
  key: string
  label: string
  permissions: SpecPermission[]
}
const PACK3_SPEC_GROUPS: SpecGroup[] = [
  {
    key: "customer",
    label: "Khách hàng",
    permissions: [
      { key: "customer.view_all", label: "Xem tất cả KH (override row-level)" },
      { key: "customer.assign", label: "Phân công NV phụ trách" },
    ],
  },
  {
    key: "warehouse",
    label: "Kho vận",
    permissions: [
      { key: "warehouse.view_balance", label: "Xem tồn kho" },
      { key: "warehouse.view_cost", label: "Xem giá vốn" },
      { key: "warehouse.adjust", label: "Điều chỉnh tồn" },
      { key: "warehouse.picking", label: "Xuất kho" },
      { key: "warehouse.handover", label: "Nhận bàn giao" },
    ],
  },
  {
    key: "finance",
    label: "Tài chính",
    permissions: [
      { key: "finance.view_ar", label: "Xem công nợ" },
      { key: "finance.collect", label: "Thu tiền" },
      { key: "finance.print_receipt", label: "In phiếu thu" },
    ],
  },
  {
    key: "hr",
    label: "Nhân sự",
    permissions: [
      { key: "hr.view_attendance", label: "Xem chấm công" },
      { key: "hr.run_payroll", label: "Tính lương" },
      { key: "hr.config_salary", label: "Cấu hình lương" },
    ],
  },
  {
    key: "admin",
    label: "Quản trị",
    permissions: [
      { key: "admin.users", label: "Quản lý user" },
      { key: "admin.permissions", label: "Phân quyền" },
      { key: "admin.audit_log", label: "Xem audit log" },
    ],
  },
]

interface UserRow {
  id: string
  org_id: string
  full_name: string | null
  email: string
  role: Role
  is_active: boolean
}

interface OverrideRow {
  user_id: string
  permission_key: string
  granted: boolean
}

type CellMode = "inherit" | "grant" | "revoke"

const CELL_MODE_LABEL: Record<CellMode, string> = {
  inherit: "Theo vai trò",
  grant: "Cấp quyền",
  revoke: "Thu hồi",
}

function permissionKey(m: Module, a: Action): string {
  return `${m}.${a}`
}

export default function UserPermissionsPage() {
  const { id } = useParams<{ id: string }>()
  const { user: me } = useAuth()
  const { loading: authLoading } = useRoleGuard("settings")
  const supabase = createClient()
  const { toast } = useToast()

  const [user, setUser] = useState<UserRow | null>(null)
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map())
  const [pending, setPending] = useState<Map<string, CellMode>>(new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    if (!id || !me?.org_id) return
    setLoading(true)
    const [uRes, oRes] = await Promise.all([
      supabase
        .from("users")
        .select("id, org_id, full_name, email, role, is_active")
        .eq("id", id)
        .single(),
      supabase
        .from("user_permission_overrides")
        .select("user_id, permission_key, granted")
        .eq("user_id", id),
    ])
    setUser(((uRes.data as UserRow) || null))
    const map = new Map<string, boolean>()
    ;(((oRes.data as OverrideRow[]) || [])).forEach((o) =>
      map.set(o.permission_key, o.granted)
    )
    setOverrides(map)
    setPending(new Map())
    setLoading(false)
  }, [id, me?.org_id, supabase])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const cellMode = useCallback(
    (m: Module, a: Action): CellMode => {
      const k = permissionKey(m, a)
      if (pending.has(k)) return pending.get(k)!
      if (overrides.has(k)) return overrides.get(k) ? "grant" : "revoke"
      return "inherit"
    },
    [pending, overrides]
  )

  const setCell = (m: Module, a: Action, mode: CellMode) => {
    const k = permissionKey(m, a)
    setPending((prev) => {
      const next = new Map(prev)
      const original: CellMode = overrides.has(k)
        ? overrides.get(k)
          ? "grant"
          : "revoke"
        : "inherit"
      if (mode === original) {
        next.delete(k)
      } else {
        next.set(k, mode)
      }
      return next
    })
  }

  const dirty = pending.size > 0

  const effectiveValue = (m: Module, a: Action): boolean => {
    if (!user) return false
    const mode = cellMode(m, a)
    if (mode === "grant") return true
    if (mode === "revoke") return false
    return hasPermission(user.role, m, a)
  }

  const save = async () => {
    if (!user || !me?.org_id) return
    setSaving(true)
    try {
      const upserts: { user_id: string; permission_key: string; granted: boolean; org_id: string }[] = []
      const deletes: string[] = []
      pending.forEach((mode, key) => {
        if (mode === "inherit") {
          deletes.push(key)
        } else {
          upserts.push({
            user_id: user.id,
            permission_key: key,
            granted: mode === "grant",
            org_id: user.org_id,
          })
        }
      })
      if (upserts.length > 0) {
        const { error } = await supabase
          .from("user_permission_overrides")
          .upsert(upserts, { onConflict: "user_id,permission_key" })
        if (error) throw error
      }
      if (deletes.length > 0) {
        const { error } = await supabase
          .from("user_permission_overrides")
          .delete()
          .eq("user_id", user.id)
          .in("permission_key", deletes)
        if (error) throw error
      }
      toast({ title: `Đã lưu ${pending.size} thay đổi` })
      await fetchData()
    } catch (e) {
      toast({ title: "Lỗi", description: (e as Error).message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const resetAll = async () => {
    if (!user) return
    if (!window.confirm("Xoá toàn bộ tuỳ chỉnh? User sẽ chỉ còn quyền theo vai trò.")) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from("user_permission_overrides")
        .delete()
        .eq("user_id", user.id)
      if (error) throw error
      toast({ title: "Đã reset về quyền vai trò" })
      await fetchData()
    } catch (e) {
      toast({ title: "Lỗi", description: (e as Error).message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const overrideCount = useMemo(() => overrides.size, [overrides])

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!user) {
    return (
      <div className="space-y-3">
        <PageHeader title="Không tìm thấy user" backHref="/settings/users" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Phân quyền: ${user.full_name || user.email}`}
        description={`Vai trò: ${ROLE_LABELS[user.role]} • ${overrideCount} quyền đang tuỳ chỉnh`}
        backHref={`/settings/users/${user.id}`}
      >
        <Button variant="outline" size="sm" asChild>
          <Link href={`/settings/users/${user.id}`}>
            <ChevronLeft className="h-4 w-4 mr-1.5" /> Quay lại user
          </Link>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={resetAll}
          disabled={saving || overrideCount === 0}
        >
          <RotateCcw className="h-4 w-4 mr-1.5" /> Reset về vai trò
        </Button>
        <Button onClick={save} disabled={!dirty || saving}>
          {saving ? "Đang lưu..." : `Lưu (${pending.size})`}
        </Button>
      </PageHeader>

      {/* Legend */}
      <Card>
        <CardContent className="p-3 text-xs flex flex-wrap items-center gap-3">
          <span className="text-muted-foreground">Trạng thái mỗi ô:</span>
          <Badge variant="secondary">Theo vai trò</Badge>
          <Badge variant="success">Cấp quyền</Badge>
          <Badge variant="danger">Thu hồi</Badge>
          <span className="ml-auto text-muted-foreground">
            &ldquo;Theo vai trò&rdquo; = lấy mặc định từ vai trò {ROLE_LABELS[user.role]}.
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ma trận quyền</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr className="text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2 text-left w-48">Module</th>
                {ACTIONS.map((a) => (
                  <th key={a} className="px-3 py-2 text-left w-44">
                    {ACTION_LABELS[a]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODULES.map((m) => (
                <tr key={m} className="border-b last:border-0 align-middle">
                  <td className="px-3 py-2 font-medium">{MODULE_LABELS[m]}</td>
                  {ACTIONS.map((a) => {
                    const mode = cellMode(m, a)
                    const eff = effectiveValue(m, a)
                    const variant: "secondary" | "success" | "danger" =
                      mode === "grant" ? "success" : mode === "revoke" ? "danger" : "secondary"
                    return (
                      <td key={a} className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <Select
                            value={mode}
                            onValueChange={(v) => setCell(m, a, v as CellMode)}
                          >
                            <SelectTrigger className="h-8 w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="inherit">{CELL_MODE_LABEL.inherit}</SelectItem>
                              <SelectItem value="grant">{CELL_MODE_LABEL.grant}</SelectItem>
                              <SelectItem value="revoke">{CELL_MODE_LABEL.revoke}</SelectItem>
                            </SelectContent>
                          </Select>
                          <Badge
                            variant={eff ? "success" : "secondary"}
                            className="text-[10px]"
                          >
                            {eff ? "✓" : "—"}
                          </Badge>
                          {mode !== "inherit" && (
                            <span className="text-[9px] uppercase text-muted-foreground">
                              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-0.5 ${
                                variant === "success" ? "bg-emerald-500" : "bg-rose-500"
                              }`} />
                            </span>
                          )}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Pack3 spec D8/D13 — flat keys consumed by RLS / feature gates.
          Override-only: tick = grant, untick = revoke (no inherit), since
          no role_permissions row backs these keys. */}
      <Card>
        <CardHeader>
          <CardTitle>Quyền đặc biệt (Pack3)</CardTitle>
          <p className="text-xs text-muted-foreground">
            Các quyền chỉ kích hoạt khi tick: vd. <code>customer.view_all</code>{" "}
            override row-level RLS để xem mọi KH (D8).
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {PACK3_SPEC_GROUPS.map((g) => (
            <div key={g.key}>
              <h3 className="text-sm font-semibold mb-2">{g.label}</h3>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {g.permissions.map((p) => {
                  const mode = pending.has(p.key)
                    ? pending.get(p.key)!
                    : overrides.has(p.key)
                      ? overrides.get(p.key)
                        ? "grant"
                        : "revoke"
                      : "inherit"
                  const granted = mode === "grant"
                  return (
                    <label
                      key={p.key}
                      className="flex items-center gap-2 rounded border bg-muted/10 px-3 py-1.5 cursor-pointer text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={granted}
                        onChange={(e) => {
                          const k = p.key
                          setPending((prev) => {
                            const next = new Map(prev)
                            const original =
                              overrides.has(k)
                                ? overrides.get(k)
                                  ? "grant"
                                  : "revoke"
                                : "inherit"
                            const target: CellMode = e.target.checked
                              ? "grant"
                              : "inherit"
                            if (target === original) {
                              next.delete(k)
                            } else {
                              next.set(k, target)
                            }
                            return next
                          })
                        }}
                      />
                      <span className="flex-1">{p.label}</span>
                      <code className="text-[10px] text-muted-foreground">
                        {p.key}
                      </code>
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
