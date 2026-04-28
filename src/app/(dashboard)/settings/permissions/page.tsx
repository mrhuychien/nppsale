"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useToast } from "@/hooks/use-toast"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import {
  ROLES,
  ROLE_LABELS,
  ACTIONS,
  ACTION_LABELS,
  DEFAULT_PERMISSION_MAP,
  type Action,
  type Role,
} from "@/lib/permissions"
import {
  FEATURES,
  FEATURE_GROUPS,
  featuresByGroup,
  type FeatureDef,
  type FeatureGroup,
} from "@/lib/permissions-features"
import { cn } from "@/lib/utils"
import {
  ShieldCheck,
  RefreshCcw,
  Save,
  Lock,
  Eye,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  Download,
  ChevronDown,
  ChevronRight,
} from "lucide-react"

interface DbRow {
  role: string
  module: string
  action: string
  allowed: boolean
}

/**
 * For each role, store an explicit allowed/denied state per feature
 * key per action. We materialise the full grid (including features that
 * inherit) so the UI can show every checkbox; on save we only persist
 * rows that differ from the parent module to keep the table tight.
 */
type FeatureMatrix = Record<Role, Record<string, Record<Action, boolean>>>

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

function defaultActionsForFeature(role: Role, feature: FeatureDef): Action[] {
  // Every feature inherits from its parent module's defaults — that's
  // the baseline before any per-feature override is applied.
  return DEFAULT_PERMISSION_MAP[role][feature.module] ?? []
}

function buildBaselineMatrix(): FeatureMatrix {
  const m = {} as FeatureMatrix
  for (const r of ROLES) {
    m[r] = {}
    for (const f of FEATURES) {
      const defaults = new Set(defaultActionsForFeature(r, f))
      const cells: Record<Action, boolean> = {} as Record<Action, boolean>
      for (const a of ACTIONS) cells[a] = defaults.has(a)
      m[r][f.key] = cells
    }
  }
  return m
}

export default function PermissionsPage() {
  const { user, loading: authLoading } = useRoleGuard("settings")
  const { toast } = useToast()
  const supabase = createClient()
  const isOwner = user?.role === "owner"

  const [activeRole, setActiveRole] = useState<Role>("manager")
  const [matrix, setMatrix] = useState<FeatureMatrix>(() => buildBaselineMatrix())
  const [original, setOriginal] = useState<FeatureMatrix>(() => buildBaselineMatrix())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState("")
  const [openGroups, setOpenGroups] = useState<Set<FeatureGroup>>(
    () => new Set(FEATURE_GROUPS)
  )

  const grouped = useMemo(() => featuresByGroup(), [])

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const baseline = buildBaselineMatrix()
    const { data, error } = await supabase
      .from("role_permissions")
      .select("role, module, action, allowed")
      .eq("org_id", user.org_id)
    if (error) {
      console.warn("[permissions] load failed:", error.message)
    } else {
      // Apply DB rows on top of the baseline. Rows whose `module` key
      // matches a Module name override every feature that inherits
      // from that module; rows whose key matches a feature key only
      // override that one feature.
      const moduleOverrides: Record<Role, Record<string, Record<Action, boolean>>> = {} as Record<Role, Record<string, Record<Action, boolean>>>
      const featureOverrides: Record<Role, Record<string, Partial<Record<Action, boolean>>>> = {} as Record<Role, Record<string, Partial<Record<Action, boolean>>>>
      for (const role of ROLES) {
        moduleOverrides[role] = {}
        featureOverrides[role] = {}
      }
      for (const r of (data as DbRow[]) || []) {
        if (!ROLES.includes(r.role as Role)) continue
        if (!ACTIONS.includes(r.action as Action)) continue
        const role = r.role as Role
        const action = r.action as Action
        // Is the key a known module name?
        const isModuleKey = (FEATURES.find((f) => f.module === r.module && f.key === r.module) !== undefined)
        if (isModuleKey) {
          moduleOverrides[role][r.module] = moduleOverrides[role][r.module] ?? ({} as Record<Action, boolean>)
          moduleOverrides[role][r.module][action] = r.allowed
        } else {
          featureOverrides[role][r.module] = featureOverrides[role][r.module] ?? {}
          featureOverrides[role][r.module][action] = r.allowed
        }
      }
      // Apply module overrides to all features inheriting from that module
      for (const role of ROLES) {
        for (const f of FEATURES) {
          const modOverride = moduleOverrides[role][f.module]
          if (modOverride) {
            for (const a of ACTIONS) {
              if (modOverride[a] !== undefined) baseline[role][f.key][a] = modOverride[a]
            }
          }
          const featOverride = featureOverrides[role][f.key]
          if (featOverride) {
            for (const a of ACTIONS) {
              if (featOverride[a] !== undefined) baseline[role][f.key][a] = featOverride[a]!
            }
          }
        }
      }
    }
    setMatrix(baseline)
    setOriginal(JSON.parse(JSON.stringify(baseline)) as FeatureMatrix)
    setLoading(false)
  }, [user?.org_id, supabase])

  useEffect(() => {
    load()
  }, [load])

  const dirty = useMemo(
    () => JSON.stringify(matrix) !== JSON.stringify(original),
    [matrix, original]
  )

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return grouped
    const out: Record<FeatureGroup, FeatureDef[]> = {} as Record<FeatureGroup, FeatureDef[]>
    for (const g of FEATURE_GROUPS) {
      out[g] = grouped[g].filter(
        (f) =>
          f.label.toLowerCase().includes(q) ||
          f.key.toLowerCase().includes(q) ||
          f.module.toLowerCase().includes(q)
      )
    }
    return out
  }, [search, grouped])

  const toggle = (role: Role, featureKey: string, action: Action) => {
    if (role === "owner") return
    setMatrix((prev) => ({
      ...prev,
      [role]: {
        ...prev[role],
        [featureKey]: {
          ...prev[role][featureKey],
          [action]: !prev[role][featureKey][action],
        },
      },
    }))
  }

  const toggleFeatureRow = (role: Role, featureKey: string, allow: boolean) => {
    if (role === "owner") return
    const next = ACTIONS.reduce(
      (acc, a) => ({ ...acc, [a]: allow }),
      {} as Record<Action, boolean>
    )
    setMatrix((prev) => ({
      ...prev,
      [role]: { ...prev[role], [featureKey]: next },
    }))
  }

  const toggleGroup = (role: Role, group: FeatureGroup, allow: boolean) => {
    if (role === "owner") return
    setMatrix((prev) => {
      const nextRole = { ...prev[role] }
      for (const f of grouped[group]) {
        nextRole[f.key] = ACTIONS.reduce(
          (acc, a) => ({ ...acc, [a]: allow }),
          {} as Record<Action, boolean>
        )
      }
      return { ...prev, [role]: nextRole }
    })
  }

  const resetRoleToDefault = (role: Role) => {
    if (role === "owner") return
    const defaults = buildBaselineMatrix()
    setMatrix((prev) => ({ ...prev, [role]: defaults[role] }))
  }

  const discardChanges = () => {
    setMatrix(JSON.parse(JSON.stringify(original)) as FeatureMatrix)
  }

  const toggleGroupOpen = (group: FeatureGroup) => {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const save = async () => {
    if (!user?.org_id || !isOwner) return
    setSaving(true)
    // Persist one row per (role, feature, action) — the table now
    // treats each feature key as its own permission cell.
    const rows: {
      org_id: string
      role: Role
      module: string
      action: Action
      allowed: boolean
      updated_by: string
    }[] = []
    for (const role of ROLES) {
      if (role === "owner") continue
      for (const f of FEATURES) {
        for (const action of ACTIONS) {
          rows.push({
            org_id: user.org_id,
            role,
            module: f.key,
            action,
            allowed: !!matrix[role][f.key][action],
            updated_by: user.id,
          })
        }
      }
    }
    const { error } = await supabase
      .from("role_permissions")
      .upsert(rows, { onConflict: "org_id,role,module,action" })
    setSaving(false)
    if (error) {
      toast({
        title: "Lưu thất bại",
        description: error.message,
        variant: "destructive",
      })
      return
    }
    setOriginal(JSON.parse(JSON.stringify(matrix)) as FeatureMatrix)
    toast({
      title: "Đã lưu phân quyền",
      description: "Các thay đổi sẽ được áp dụng sau khi tải lại trang.",
    })
  }

  if (authLoading || loading) return <Skeleton className="h-96" />

  if (!isOwner) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Phân quyền"
          description="Cấu hình quyền chi tiết cho từng vai trò"
          backHref="/settings"
        />
        <div className="rounded-xl border border-border/40 bg-card p-8 text-center">
          <Lock className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <h3 className="mb-1 text-lg font-semibold">Chỉ Chủ doanh nghiệp được sửa</h3>
          <p className="text-sm text-muted-foreground">
            Trang này hiển thị cấu hình hiện tại nhưng không cho phép thay đổi.
          </p>
        </div>
      </div>
    )
  }

  const roleStats = (role: Role) => {
    let allowed = 0
    let total = 0
    for (const f of FEATURES) {
      for (const a of ACTIONS) {
        total += 1
        if (role === "owner" || matrix[role][f.key][a]) allowed += 1
      }
    }
    return { allowed, total }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Phân quyền"
        description="Cấu hình chi tiết cho từng menu: Xem, Tạo, Cập nhật, Xóa, Duyệt, Xuất file."
        backHref="/settings"
      >
        <div className="flex items-center gap-2">
          {dirty ? (
            <Button variant="outline" size="sm" onClick={discardChanges} disabled={saving}>
              Hủy thay đổi
            </Button>
          ) : null}
          <Button onClick={save} disabled={!dirty || saving} size="sm">
            <Save className="mr-1.5 h-4 w-4" />
            {saving ? "Đang lưu..." : "Lưu"}
          </Button>
        </div>
      </PageHeader>

      {/* Role tabs */}
      <div className="rounded-xl border border-border/40 bg-card p-2 shadow-sm">
        <div className="flex flex-wrap gap-1">
          {ROLES.map((r) => {
            const active = r === activeRole
            const { allowed, total } = roleStats(r)
            return (
              <button
                key={r}
                onClick={() => setActiveRole(r)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/[0.08] text-primary"
                    : "text-foreground hover:bg-muted/40"
                )}
              >
                <ShieldCheck className="h-4 w-4" />
                <div className="text-left">
                  <div className="leading-tight">{ROLE_LABELS[r]}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {r === "owner" ? "Toàn quyền" : `${allowed}/${total} quyền`}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Action toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/40 bg-card px-4 py-3 shadow-sm">
        <div className="flex flex-1 items-center gap-3">
          <h3 className="text-base font-semibold">
            Vai trò: <span className="text-primary">{ROLE_LABELS[activeRole]}</span>
          </h3>
          {activeRole === "owner" ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
              <Lock className="h-3 w-3" /> Chủ DN luôn có toàn quyền — không thể thay đổi
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            placeholder="Tìm menu..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-44 rounded-md border border-border/60 bg-background px-2 text-sm"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => resetRoleToDefault(activeRole)}
            disabled={activeRole === "owner"}
          >
            <RefreshCcw className="mr-1.5 h-3.5 w-3.5" /> Khôi phục mặc định
          </Button>
        </div>
      </div>

      {/* Permission matrix grouped by menu group */}
      <div className="space-y-3">
        {FEATURE_GROUPS.map((group) => {
          const items = filteredGroups[group]
          if (!items || items.length === 0) return null
          const isOpen = openGroups.has(group)
          // Group-level summary
          let groupAllowed = 0
          let groupTotal = 0
          for (const f of items) {
            for (const a of ACTIONS) {
              groupTotal += 1
              if (activeRole === "owner" || matrix[activeRole][f.key][a]) {
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
                  <h3 className="text-sm font-semibold text-foreground">
                    {group}
                  </h3>
                  <span className="text-[11px] text-muted-foreground">
                    {items.length} menu • {groupAllowed}/{groupTotal} quyền
                  </span>
                </button>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => toggleGroup(activeRole, group, true)}
                    disabled={activeRole === "owner"}
                  >
                    Bật cả nhóm
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => toggleGroup(activeRole, group, false)}
                    disabled={activeRole === "owner"}
                  >
                    Tắt cả nhóm
                  </Button>
                </div>
              </div>

              {isOpen ? (
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
                        const allOn =
                          activeRole === "owner" ||
                          ACTIONS.every((a) => matrix[activeRole][f.key][a])
                        const noneOn =
                          activeRole !== "owner" &&
                          ACTIONS.every((a) => !matrix[activeRole][f.key][a])
                        return (
                          <tr
                            key={f.key}
                            className="border-b border-border/30 hover:bg-muted/20"
                          >
                            <td className="px-4 py-2.5 align-middle">
                              <div className="font-medium text-foreground">
                                {f.label}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {f.key}
                              </div>
                            </td>
                            {ACTIONS.map((a) => {
                              const checked =
                                activeRole === "owner"
                                  ? true
                                  : !!matrix[activeRole][f.key][a]
                              const disabled = activeRole === "owner"
                              return (
                                <td
                                  key={a}
                                  className="px-3 py-2.5 text-center align-middle"
                                >
                                  <label
                                    className={cn(
                                      "inline-flex cursor-pointer items-center justify-center",
                                      disabled && "cursor-not-allowed"
                                    )}
                                    title={ACTION_DESC[a]}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={disabled}
                                      onChange={() => toggle(activeRole, f.key, a)}
                                      className="h-4 w-4 rounded border-border/60 accent-primary"
                                    />
                                  </label>
                                </td>
                              )
                            })}
                            <td className="px-3 py-2.5 text-center align-middle">
                              <div className="flex justify-center gap-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleFeatureRow(activeRole, f.key, true)
                                  }
                                  disabled={activeRole === "owner" || allOn}
                                  className="rounded-md border border-border/60 px-2 py-0.5 text-xs hover:bg-muted/40 disabled:opacity-40"
                                >
                                  Bật
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleFeatureRow(activeRole, f.key, false)
                                  }
                                  disabled={activeRole === "owner" || noneOn}
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
              ) : null}
            </div>
          )
        })}
        {Object.values(filteredGroups).every((arr) => arr.length === 0) ? (
          <div className="rounded-xl border border-border/40 bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            Không tìm thấy menu phù hợp
          </div>
        ) : null}
      </div>

      {/* Sticky save bar when dirty */}
      {dirty ? (
        <div className="sticky bottom-4 z-20 flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 shadow-md">
          <div className="text-sm">
            <span className="font-medium">Có thay đổi chưa lưu</span>
            <span className="ml-2 text-muted-foreground">
              Vai trò: {ROLE_LABELS[activeRole]} • Sẽ áp dụng sau khi lưu.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={discardChanges} disabled={saving}>
              Hủy
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              <Save className="mr-1.5 h-4 w-4" />
              {saving ? "Đang lưu..." : "Lưu thay đổi"}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Legend */}
      <div className="rounded-xl border border-border/40 bg-card p-4 text-sm shadow-sm">
        <h3 className="mb-2 font-semibold">Giải thích các quyền</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ACTIONS.map((a) => {
            const Icon = ACTION_ICONS[a]
            return (
              <div key={a} className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div>
                  <div className="font-medium">{ACTION_LABELS[a]}</div>
                  <div className="text-xs text-muted-foreground">{ACTION_DESC[a]}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
