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
  MODULES,
  MODULE_LABELS,
  ACTIONS,
  ACTION_LABELS,
  DEFAULT_PERMISSION_MAP,
  type Action,
  type Module,
  type Role,
} from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { ShieldCheck, RefreshCcw, Save, Lock, Eye, Plus, Pencil, Trash2, CheckCircle2, Download } from "lucide-react"

interface DbRow {
  role: string
  module: string
  action: string
  allowed: boolean
}

type Matrix = Record<Role, Record<Module, Record<Action, boolean>>>

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

function buildEmptyMatrix(): Matrix {
  const m = {} as Matrix
  for (const r of ROLES) {
    m[r] = {} as Record<Module, Record<Action, boolean>>
    for (const mod of MODULES) {
      m[r][mod] = {} as Record<Action, boolean>
      for (const a of ACTIONS) m[r][mod][a] = false
    }
  }
  return m
}

function buildDefaultMatrix(): Matrix {
  const m = buildEmptyMatrix()
  for (const r of ROLES) {
    for (const mod of MODULES) {
      for (const a of DEFAULT_PERMISSION_MAP[r][mod]) {
        m[r][mod][a] = true
      }
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
  const [matrix, setMatrix] = useState<Matrix>(() => buildDefaultMatrix())
  const [original, setOriginal] = useState<Matrix>(() => buildDefaultMatrix())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [moduleSearch, setModuleSearch] = useState("")

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const baseline = buildDefaultMatrix()
    const { data, error } = await supabase
      .from("role_permissions")
      .select("role, module, action, allowed")
      .eq("org_id", user.org_id)
    if (error) {
      // Fallback to defaults silently — usually means migration pending.
      console.warn("[permissions] load failed:", error.message)
    } else {
      for (const r of (data as DbRow[]) || []) {
        const role = r.role as Role
        const mod = r.module as Module
        const act = r.action as Action
        if (!ROLES.includes(role) || !MODULES.includes(mod) || !ACTIONS.includes(act)) continue
        baseline[role][mod][act] = !!r.allowed
      }
    }
    setMatrix(baseline)
    setOriginal(JSON.parse(JSON.stringify(baseline)))
    setLoading(false)
  }, [user?.org_id, supabase])

  useEffect(() => {
    load()
  }, [load])

  const dirty = useMemo(() => {
    return JSON.stringify(matrix) !== JSON.stringify(original)
  }, [matrix, original])

  const filteredModules = useMemo(() => {
    if (!moduleSearch) return MODULES
    const q = moduleSearch.toLowerCase()
    return MODULES.filter(
      (m) => MODULE_LABELS[m].toLowerCase().includes(q) || m.toLowerCase().includes(q)
    )
  }, [moduleSearch])

  const toggle = (role: Role, mod: Module, act: Action) => {
    if (role === "owner") return // never editable
    setMatrix((prev) => ({
      ...prev,
      [role]: {
        ...prev[role],
        [mod]: { ...prev[role][mod], [act]: !prev[role][mod][act] },
      },
    }))
  }

  const toggleRow = (role: Role, mod: Module, allow: boolean) => {
    if (role === "owner") return
    setMatrix((prev) => ({
      ...prev,
      [role]: {
        ...prev[role],
        [mod]: ACTIONS.reduce(
          (acc, a) => ({ ...acc, [a]: allow }),
          {} as Record<Action, boolean>
        ),
      },
    }))
  }

  const toggleColumn = (role: Role, act: Action, allow: boolean) => {
    if (role === "owner") return
    setMatrix((prev) => ({
      ...prev,
      [role]: MODULES.reduce(
        (acc, mod) => ({
          ...acc,
          [mod]: { ...prev[role][mod], [act]: allow },
        }),
        {} as Record<Module, Record<Action, boolean>>
      ),
    }))
  }

  const resetRoleToDefault = (role: Role) => {
    if (role === "owner") return
    const defaults = buildDefaultMatrix()
    setMatrix((prev) => ({ ...prev, [role]: defaults[role] }))
  }

  const discardChanges = () => {
    setMatrix(JSON.parse(JSON.stringify(original)))
  }

  const save = async () => {
    if (!user?.org_id || !isOwner) return
    setSaving(true)
    // Build all rows except owner (always full).
    const rows: { org_id: string; role: Role; module: Module; action: Action; allowed: boolean; updated_by: string }[] = []
    for (const role of ROLES) {
      if (role === "owner") continue
      for (const mod of MODULES) {
        for (const act of ACTIONS) {
          rows.push({
            org_id: user.org_id,
            role,
            module: mod,
            action: act,
            allowed: !!matrix[role][mod][act],
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
    setOriginal(JSON.parse(JSON.stringify(matrix)))
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
    for (const mod of MODULES) {
      for (const act of ACTIONS) {
        total += 1
        if (role === "owner" || matrix[role][mod][act]) allowed += 1
      }
    }
    return { allowed, total }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Phân quyền"
        description="Cấu hình chi tiết các quyền cho từng vai trò: Xem, Tạo, Cập nhật, Xóa, Duyệt, Xuất file."
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
            placeholder="Tìm module..."
            value={moduleSearch}
            onChange={(e) => setModuleSearch(e.target.value)}
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

      {/* Permission matrix */}
      <div className="overflow-hidden rounded-xl border border-border/40 bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 bg-muted/40">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Module
                </th>
                {ACTIONS.map((a) => {
                  const Icon = ACTION_ICONS[a]
                  return (
                    <th
                      key={a}
                      className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      <div className="flex flex-col items-center gap-1">
                        <Icon className="h-3.5 w-3.5" />
                        <span>{ACTION_LABELS[a]}</span>
                        <button
                          type="button"
                          onClick={() => toggleColumn(activeRole, a, true)}
                          disabled={activeRole === "owner"}
                          className="text-[10px] font-normal text-primary hover:underline disabled:opacity-40"
                          title={`Cấp quyền ${ACTION_LABELS[a].toLowerCase()} cho mọi module`}
                        >
                          Cấp tất cả
                        </button>
                      </div>
                    </th>
                  )
                })}
                <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Bật/Tắt cả dòng
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredModules.map((mod) => {
                const allOn =
                  activeRole === "owner" ||
                  ACTIONS.every((a) => matrix[activeRole][mod][a])
                const noneOn =
                  activeRole !== "owner" &&
                  ACTIONS.every((a) => !matrix[activeRole][mod][a])
                return (
                  <tr key={mod} className="border-b border-border/30 hover:bg-muted/20">
                    <td className="px-4 py-3 align-middle">
                      <div className="font-medium text-foreground">{MODULE_LABELS[mod]}</div>
                      <div className="text-[11px] text-muted-foreground">{mod}</div>
                    </td>
                    {ACTIONS.map((a) => {
                      const checked =
                        activeRole === "owner" ? true : !!matrix[activeRole][mod][a]
                      const disabled = activeRole === "owner"
                      return (
                        <td key={a} className="px-3 py-3 text-center align-middle">
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
                              onChange={() => toggle(activeRole, mod, a)}
                              className="h-4 w-4 rounded border-border/60 accent-primary"
                            />
                          </label>
                        </td>
                      )
                    })}
                    <td className="px-3 py-3 text-center align-middle">
                      <div className="flex justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggleRow(activeRole, mod, true)}
                          disabled={activeRole === "owner" || allOn}
                          className="rounded-md border border-border/60 px-2 py-0.5 text-xs hover:bg-muted/40 disabled:opacity-40"
                        >
                          Bật
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleRow(activeRole, mod, false)}
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
              {filteredModules.length === 0 ? (
                <tr>
                  <td
                    colSpan={ACTIONS.length + 2}
                    className="px-4 py-6 text-center text-sm text-muted-foreground"
                  >
                    Không tìm thấy module phù hợp
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
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
