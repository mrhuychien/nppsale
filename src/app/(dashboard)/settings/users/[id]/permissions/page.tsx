"use client"

/**
 * T-13: Phân quyền chi tiết theo từng nhân viên.
 *
 * Mirror /settings/permissions (role matrix) ở mức granularity
 * FEATURE × ACTION — không phải MODULE × ACTION như trước. Cell có
 * 3 trạng thái:
 *
 *   ● Theo vai trò (mặc định) — không có row trong user_permission_overrides
 *   ✓ Cấp quyền                — override granted=true
 *   ✗ Thu hồi                  — override granted=false
 *
 * Click cycle: inherit → grant → revoke → inherit. Effective value
 * hiển thị dạng nhỏ phía dưới (xanh = có quyền, đỏ = không).
 *
 * Permission key format: `${feature.key}.${action}` — vd
 *   "customers.analytics.read", "orders.create".
 * Resolver mig 058 split-on-last-dot fall back về role_permissions.
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
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  RotateCcw,
  Eye,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  Download,
} from "lucide-react"
import {
  ACTIONS,
  ACTION_LABELS,
  DEFAULT_PERMISSION_MAP,
  ROLE_LABELS,
  type Action,
  type Role,
} from "@/lib/permissions"
import {
  FEATURE_GROUPS,
  featuresByGroup,
  type FeatureDef,
  type FeatureGroup,
} from "@/lib/permissions-features"
import { cn } from "@/lib/utils"

const ACTION_ICONS: Record<Action, typeof Eye> = {
  read: Eye,
  create: Plus,
  update: Pencil,
  delete: Trash2,
  approve: CheckCircle2,
  export: Download,
}

const ACTION_DESC: Record<Action, string> = {
  read: "Xem danh sách và chi tiết",
  create: "Tạo bản ghi mới",
  update: "Sửa thông tin có sẵn",
  delete: "Xóa bản ghi",
  approve: "Phê duyệt / hủy duyệt",
  export: "Xuất file CSV / In ra giấy",
}

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

interface RolePermRow {
  role: string
  module: string
  action: string
  allowed: boolean
}

type CellMode = "inherit" | "grant" | "revoke"

const PACK3_SPEC_GROUPS: Array<{
  key: string
  label: string
  permissions: Array<{ key: string; label: string }>
}> = [
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

function permissionKey(featureKey: string, action: Action): string {
  return `${featureKey}.${action}`
}

/** Resolve effective value for a (feature, action) — mirror DB resolver
 *  but client-side so the UI shows current state instantly. */
function effectiveValue(
  role: Role,
  feature: FeatureDef,
  action: Action,
  overrides: Map<string, boolean>,
  rolePerms: Map<string, boolean>
): boolean {
  if (role === "owner") return true
  const key = permissionKey(feature.key, action)
  const override = overrides.get(key)
  if (override !== undefined) return override
  // role_permissions fallback by feature key first.
  const rpByFeature = rolePerms.get(`${feature.key}::${action}`)
  if (rpByFeature !== undefined) return rpByFeature
  // Then by parent module key (DEFAULT_PERMISSION_MAP).
  const moduleDefaults = DEFAULT_PERMISSION_MAP[role][feature.module] ?? []
  return moduleDefaults.includes(action)
}

export default function UserPermissionsPage() {
  const { id } = useParams<{ id: string }>()
  const { user: me } = useAuth()
  const { loading: authLoading } = useRoleGuard("settings")
  const supabase = createClient()
  const { toast } = useToast()

  const [user, setUser] = useState<UserRow | null>(null)
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map())
  const [rolePerms, setRolePerms] = useState<Map<string, boolean>>(new Map())
  const [pending, setPending] = useState<Map<string, CellMode>>(new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState("")
  const [openGroups, setOpenGroups] = useState<Set<FeatureGroup>>(
    () => new Set(FEATURE_GROUPS)
  )

  const fetchData = useCallback(async () => {
    if (!id || !me?.org_id) return
    setLoading(true)
    const [uRes, oRes, rpRes] = await Promise.all([
      supabase
        .from("users")
        .select("id, org_id, full_name, email, role, is_active")
        .eq("id", id)
        .single(),
      supabase
        .from("user_permission_overrides")
        .select("user_id, permission_key, granted")
        .eq("user_id", id),
      supabase
        .from("role_permissions")
        .select("role, module, action, allowed")
        .eq("org_id", me.org_id),
    ])
    setUser(((uRes.data as UserRow) || null))

    const omap = new Map<string, boolean>()
    ;(((oRes.data as OverrideRow[]) || [])).forEach((o) =>
      omap.set(o.permission_key, o.granted)
    )
    setOverrides(omap)

    const rmap = new Map<string, boolean>()
    const target = (uRes.data as UserRow | null)?.role
    ;(((rpRes.data as RolePermRow[]) || [])).forEach((rp) => {
      if (rp.role === target) {
        rmap.set(`${rp.module}::${rp.action}`, rp.allowed)
      }
    })
    setRolePerms(rmap)

    setPending(new Map())
    setLoading(false)
  }, [id, me?.org_id, supabase])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const filteredGroups = useMemo(() => {
    const grouped = featuresByGroup()
    if (!search.trim()) return grouped
    const q = search.trim().toLowerCase()
    const out: Record<FeatureGroup, FeatureDef[]> = {} as Record<FeatureGroup, FeatureDef[]>
    for (const g of FEATURE_GROUPS) {
      const list = (grouped[g] || []).filter(
        (f) =>
          f.label.toLowerCase().includes(q) ||
          f.key.toLowerCase().includes(q)
      )
      if (list.length > 0) out[g] = list
    }
    return out
  }, [search])

  const toggleGroupOpen = (group: FeatureGroup) => {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const cellMode = useCallback(
    (key: string): CellMode => {
      if (pending.has(key)) return pending.get(key)!
      if (overrides.has(key)) return overrides.get(key) ? "grant" : "revoke"
      return "inherit"
    },
    [pending, overrides]
  )

  const cycleCell = (key: string) => {
    setPending((prev) => {
      const next = new Map(prev)
      const original: CellMode = overrides.has(key)
        ? overrides.get(key)
          ? "grant"
          : "revoke"
        : "inherit"
      const current = pending.has(key) ? pending.get(key)! : original
      // Cycle: inherit → grant → revoke → inherit
      const target: CellMode =
        current === "inherit" ? "grant" : current === "grant" ? "revoke" : "inherit"
      if (target === original) {
        next.delete(key)
      } else {
        next.set(key, target)
      }
      return next
    })
  }

  /** Bulk: set all cells in a feature row to a target. Compares against
   *  CURRENT state (effective value). If user clicks "Bật cả dòng" while
   *  some cells are off → flips them on (grant); already-on stays in
   *  "inherit" if role default already allows. */
  const bulkRow = (feature: FeatureDef, target: boolean) => {
    if (!user || user.role === "owner") return
    setPending((prev) => {
      const next = new Map(prev)
      for (const a of ACTIONS) {
        const key = permissionKey(feature.key, a)
        const roleDefault = effectiveValue(user.role, feature, a, new Map(), rolePerms)
        const original: CellMode = overrides.has(key)
          ? overrides.get(key)
            ? "grant"
            : "revoke"
          : "inherit"
        const desired: CellMode =
          target === roleDefault ? "inherit" : target ? "grant" : "revoke"
        if (desired === original) {
          next.delete(key)
        } else {
          next.set(key, desired)
        }
      }
      return next
    })
  }

  const bulkGroup = (group: FeatureGroup, target: boolean) => {
    if (!user || user.role === "owner") return
    const items = filteredGroups[group] || []
    items.forEach((f) => bulkRow(f, target))
  }

  const dirty = pending.size > 0

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

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!user) {
    return (
      <div className="space-y-3">
        <PageHeader title="Không tìm thấy user" backHref="/settings/users" />
      </div>
    )
  }

  const isOwner = user.role === "owner"
  const overrideCount = overrides.size

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
          disabled={saving || overrideCount === 0 || isOwner}
        >
          <RotateCcw className="h-4 w-4 mr-1.5" /> Reset về vai trò
        </Button>
        <Button onClick={save} disabled={!dirty || saving || isOwner}>
          {saving ? "Đang lưu..." : `Lưu (${pending.size})`}
        </Button>
      </PageHeader>

      {/* Legend */}
      <Card>
        <CardContent className="p-3 text-xs flex flex-wrap items-center gap-3">
          <span className="text-muted-foreground">3 trạng thái mỗi ô (click để chuyển):</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 h-4 rounded border border-border bg-background" />
            <span className="text-muted-foreground">Theo vai trò</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 h-4 rounded bg-emerald-500 text-white text-[10px] flex items-center justify-center font-bold">✓</span>
            <span className="text-emerald-700">Cấp quyền</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 h-4 rounded bg-rose-500 text-white text-[10px] flex items-center justify-center font-bold">✗</span>
            <span className="text-rose-700">Thu hồi</span>
          </span>
          {isOwner && (
            <span className="ml-auto text-amber-700 text-[11px]">
              Chủ DN luôn có toàn quyền — không thể tuỳ chỉnh.
            </span>
          )}
        </CardContent>
      </Card>

      {/* Search + summary */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-1 items-center gap-3">
            <h3 className="text-base font-semibold">
              Vai trò mặc định:{" "}
              <span className="text-primary">{ROLE_LABELS[user.role]}</span>
            </h3>
            <span className="text-[11px] text-muted-foreground">
              ({overrideCount} cell tuỳ chỉnh)
            </span>
          </div>
          <input
            type="search"
            placeholder="Tìm menu..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-44 rounded-md border border-border/60 bg-background px-2 text-sm"
          />
        </CardContent>
      </Card>

      {/* Permission matrix grouped by menu group */}
      <div className="space-y-3">
        {FEATURE_GROUPS.map((group) => {
          const items = filteredGroups[group]
          if (!items || items.length === 0) return null
          const isOpen = openGroups.has(group)

          let groupAllowed = 0
          let groupTotal = 0
          for (const f of items) {
            for (const a of ACTIONS) {
              groupTotal += 1
              if (effectiveValue(user.role, f, a, overrides, rolePerms)) {
                groupAllowed += 1
              }
            }
          }
          return (
            <div
              key={group}
              className="overflow-hidden rounded-xl border border-border/40 bg-card shadow-sm"
            >
              <div className="flex items-center justify-between gap-2 border-b border-border/40 bg-muted/20 px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => toggleGroupOpen(group)}
                  className="flex flex-1 items-center gap-2 text-left"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <h3 className="text-sm font-semibold text-foreground">{group}</h3>
                  <span className="text-[11px] text-muted-foreground">
                    {items.length} menu • {groupAllowed}/{groupTotal} có quyền
                  </span>
                </button>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => bulkGroup(group, true)}
                    disabled={isOwner}
                  >
                    Bật cả nhóm
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => bulkGroup(group, false)}
                    disabled={isOwner}
                  >
                    Tắt cả nhóm
                  </Button>
                </div>
              </div>

              {isOpen && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/40 bg-muted/10">
                        <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Menu
                        </th>
                        {ACTIONS.map((a) => {
                          const Icon = ACTION_ICONS[a]
                          return (
                            <th
                              key={a}
                              className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                              title={ACTION_DESC[a]}
                            >
                              <div className="flex flex-col items-center gap-0.5">
                                <Icon className="h-3.5 w-3.5" />
                                <span>{ACTION_LABELS[a]}</span>
                              </div>
                            </th>
                          )
                        })}
                        <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Bật/Tắt cả dòng
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((f) => {
                        return (
                          <tr
                            key={f.key}
                            className="border-b border-border/30 hover:bg-muted/20"
                          >
                            <td className="px-4 py-2.5 align-middle">
                              <div className="font-medium text-foreground">
                                {f.label}
                              </div>
                              <div className="text-[11px] font-mono text-muted-foreground">
                                {f.key}
                              </div>
                            </td>
                            {ACTIONS.map((a) => {
                              const key = permissionKey(f.key, a)
                              const mode = cellMode(key)
                              // Apply pending changes for instant UI feedback.
                              const liveOverrides = new Map(overrides)
                              pending.forEach((m, k) => {
                                if (m === "inherit") liveOverrides.delete(k)
                                else liveOverrides.set(k, m === "grant")
                              })
                              const eff = effectiveValue(
                                user.role,
                                f,
                                a,
                                liveOverrides,
                                rolePerms
                              )
                              const cellBg =
                                mode === "grant"
                                  ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                                  : mode === "revoke"
                                    ? "bg-rose-500 hover:bg-rose-600 text-white"
                                    : eff
                                      ? "bg-emerald-50 hover:bg-emerald-100 border border-emerald-200"
                                      : "bg-rose-50 hover:bg-rose-100 border border-rose-200"
                              const symbol =
                                mode === "grant"
                                  ? "✓"
                                  : mode === "revoke"
                                    ? "✗"
                                    : eff
                                      ? "·"
                                      : "·"
                              return (
                                <td
                                  key={a}
                                  className="px-3 py-2.5 text-center align-middle"
                                >
                                  <button
                                    type="button"
                                    onClick={() => cycleCell(key)}
                                    disabled={isOwner}
                                    title={
                                      mode === "inherit"
                                        ? `Theo vai trò (${eff ? "có quyền" : "không có quyền"})`
                                        : mode === "grant"
                                          ? "Đã cấp quyền"
                                          : "Đã thu hồi"
                                    }
                                    className={cn(
                                      "inline-flex h-7 w-9 items-center justify-center rounded-md text-xs font-bold transition-colors",
                                      cellBg,
                                      isOwner && "cursor-not-allowed opacity-50"
                                    )}
                                  >
                                    {symbol}
                                  </button>
                                </td>
                              )
                            })}
                            <td className="px-3 py-2.5 text-center align-middle">
                              <div className="flex justify-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => bulkRow(f, true)}
                                  disabled={isOwner}
                                  className="rounded-md border border-border/60 px-2 py-0.5 text-xs hover:bg-muted/40 disabled:opacity-40"
                                >
                                  Bật
                                </button>
                                <button
                                  type="button"
                                  onClick={() => bulkRow(f, false)}
                                  disabled={isOwner}
                                  className="rounded-md border border-border/60 px-2 py-0.5 text-xs hover:bg-muted/40 disabled:opacity-40"
                                >
                                  Tắt
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Pack3 spec D8/D13 — flat keys (override-only). */}
      <Card>
        <CardHeader>
          <CardTitle>Quyền đặc biệt (Pack3)</CardTitle>
          <p className="text-xs text-muted-foreground">
            Các quyền chỉ kích hoạt khi tick — không có mặc định theo vai trò.
            Vd: <code>customer.view_all</code> override row-level RLS để xem mọi KH (D8).
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {PACK3_SPEC_GROUPS.map((g) => (
            <div key={g.key}>
              <h3 className="text-sm font-semibold mb-2">{g.label}</h3>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {g.permissions.map((p) => {
                  const mode = cellMode(p.key)
                  const granted = mode === "grant"
                  return (
                    <label
                      key={p.key}
                      className={cn(
                        "flex items-center gap-2 rounded border px-3 py-1.5 text-sm cursor-pointer",
                        isOwner ? "cursor-not-allowed opacity-60" : "hover:bg-muted/30",
                        granted && "border-emerald-300 bg-emerald-50"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={granted}
                        disabled={isOwner}
                        onChange={(e) => {
                          if (isOwner) return
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
                            if (target === original) next.delete(k)
                            else next.set(k, target)
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
