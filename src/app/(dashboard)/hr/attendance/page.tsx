"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { ROLE_LABELS } from "@/lib/constants"
import {
  ChevronLeft, ChevronRight,
  CalendarDays, Users, Check,
} from "lucide-react"
import type { User, AttendanceStatus, HrAttendance } from "@/types"

const STATUS_OPTIONS: { value: AttendanceStatus; label: string; icon: string; color: string; bg: string }[] = [
  { value: "present", label: "Có mặt", icon: "✓", color: "text-[#027a48]", bg: "bg-[#ecfdf3]" },
  { value: "absent", label: "Vắng", icon: "✗", color: "text-error", bg: "bg-error-container" },
  { value: "half_day", label: "Nửa ngày", icon: "½", color: "text-[#b54708]", bg: "bg-[#fff4ed]" },
  { value: "leave", label: "Nghỉ phép", icon: "P", color: "text-[#175cd3]", bg: "bg-[#eff8ff]" },
  { value: "holiday", label: "Nghỉ lễ", icon: "H", color: "text-[#6941c6]", bg: "bg-[#f4f3ff]" },
]

const DAY_NAMES = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"]

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function getDayOfWeek(year: number, month: number, day: number) {
  return new Date(year, month - 1, day).getDay()
}

function isWeekend(year: number, month: number, day: number) {
  const dow = getDayOfWeek(year, month, day)
  return dow === 0 || dow === 6
}

function isToday(year: number, month: number, day: number) {
  const now = new Date()
  return now.getFullYear() === year && now.getMonth() + 1 === month && now.getDate() === day
}

function dateStr(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

export default function AttendancePage() {
  const { loading: authLoading } = useRoleGuard("settings")
  const { user: authUser } = useAuth()
  const canEdit = authUser?.role === "owner" || authUser?.role === "manager"
  const supabase = createClient()
  const { toast } = useToast()
  const todayRef = useRef<HTMLTableCellElement>(null)

  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [employees, setEmployees] = useState<User[]>([])
  const [attendance, setAttendance] = useState<Record<string, HrAttendance>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [popupCell, setPopupCell] = useState<{ userId: string; day: number } | null>(null)

  // Mobile: day-by-day view
  const [mobileDay, setMobileDay] = useState(now.getDate())
  const [viewMode, setViewMode] = useState<"grid" | "day">("grid")

  const daysInMonth = getDaysInMonth(year, month)

  const fetchData = useCallback(async () => {
    if (!authUser?.org_id) return
    setLoading(true)
    const start = dateStr(year, month, 1)
    const end = dateStr(year, month, daysInMonth)
    const [usersRes, attendRes] = await Promise.all([
      supabase.from("users").select("*").eq("org_id", authUser.org_id).eq("is_active", true).order("full_name"),
      supabase.from("hr_attendance").select("*").eq("org_id", authUser.org_id).gte("work_date", start).lte("work_date", end),
    ])
    setEmployees((usersRes.data as User[]) || [])
    const map: Record<string, HrAttendance> = {}
    for (const row of (attendRes.data as HrAttendance[]) || []) {
      map[`${row.user_id}_${row.work_date}`] = row
    }
    setAttendance(map)
    setLoading(false)
  }, [authUser?.org_id, year, month, daysInMonth]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  // Auto-scroll to today column
  useEffect(() => {
    if (!loading && todayRef.current) {
      todayRef.current.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" })
    }
  }, [loading])

  const setStatus = async (userId: string, day: number, status: AttendanceStatus) => {
    if (!canEdit || !authUser?.org_id) return
    const ds = dateStr(year, month, day)
    const key = `${userId}_${ds}`

    // Optimistic
    setAttendance((prev) => ({
      ...prev,
      [key]: { ...prev[key], user_id: userId, work_date: ds, status, org_id: authUser.org_id } as HrAttendance,
    }))
    setPopupCell(null)

    const { data } = await supabase
      .from("hr_attendance")
      .upsert({ org_id: authUser.org_id, user_id: userId, work_date: ds, status }, { onConflict: "user_id,work_date" })
      .select()
      .single()
    if (data) setAttendance((prev) => ({ ...prev, [key]: data as HrAttendance }))
  }

  const bulkMarkAllToday = async () => {
    if (!canEdit || !authUser?.org_id) return
    setSaving(true)
    const ds = dateStr(year, month, mobileDay || now.getDate())
    const rows = employees.map((emp) => ({
      org_id: authUser.org_id,
      user_id: emp.id,
      work_date: ds,
      status: "present" as AttendanceStatus,
    }))
    await supabase.from("hr_attendance").upsert(rows, { onConflict: "user_id,work_date" })
    toast({ title: `Đã chấm tất cả có mặt ngày ${mobileDay || now.getDate()}/${month}` })
    await fetchData()
    setSaving(false)
  }

  const changeMonth = (delta: number) => {
    let m = month + delta, y = year
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    setMonth(m); setYear(y)
  }

  const countPresent = (userId: string): number => {
    let c = 0
    for (let d = 1; d <= daysInMonth; d++) {
      const rec = attendance[`${userId}_${dateStr(year, month, d)}`]
      if (rec?.status === "present") c += 1
      else if (rec?.status === "half_day") c += 0.5
    }
    return c
  }

  const getStatusDisplay = (status?: AttendanceStatus) =>
    STATUS_OPTIONS.find((s) => s.value === status)

  if (authLoading || loading) return <Skeleton className="h-96" />

  // Stats
  const todayDs = dateStr(year, month, now.getDate())
  const todayPresent = employees.filter((e) => attendance[`${e.id}_${todayDs}`]?.status === "present").length

  return (
    <div className="space-y-4">
      <PageHeader title="Chấm công" description={`Tháng ${month}/${year}`} backHref="/hr">
        <div className="flex gap-2">
          <Button
            variant={viewMode === "grid" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("grid")}
            className="hidden lg:flex"
          >
            <CalendarDays className="h-4 w-4 mr-1" /> Lưới
          </Button>
          <Button
            variant={viewMode === "day" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("day")}
          >
            <Users className="h-4 w-4 mr-1" /> Theo ngày
          </Button>
        </div>
      </PageHeader>

      {/* Month nav + stats */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="sm:col-span-2">
          <CardContent className="flex items-center justify-between p-4">
            <Button variant="outline" size="icon" onClick={() => changeMonth(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <h2 className="text-lg font-black">Tháng {month}/{year}</h2>
            <Button variant="outline" size="icon" onClick={() => changeMonth(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground uppercase font-bold">Hôm nay</p>
            <p className="text-2xl font-black text-primary">{todayPresent}/{employees.length}</p>
            <p className="text-xs text-muted-foreground">có mặt</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            {canEdit && (
              <Button
                onClick={bulkMarkAllToday}
                disabled={saving}
                className="w-full h-full"
                size="lg"
              >
                <Check className="h-5 w-5 mr-2" />
                {saving ? "Đang lưu..." : "Tất cả có mặt"}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* VIEW MODE: DAY-BY-DAY (mobile-friendly) */}
      {viewMode === "day" && (
        <div className="space-y-3">
          {/* Day selector */}
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
                  const weekend = isWeekend(year, month, d)
                  const today = isToday(year, month, d)
                  const active = d === mobileDay
                  return (
                    <button
                      key={d}
                      onClick={() => setMobileDay(d)}
                      className={`flex flex-col items-center min-w-[40px] py-1.5 px-1 rounded-lg text-xs transition-all ${
                        active
                          ? "bg-primary text-on-primary shadow-card"
                          : today
                            ? "bg-primary-fixed text-primary font-bold"
                            : weekend
                              ? "bg-surface-container text-on-surface-variant"
                              : "hover:bg-surface-container-low"
                      }`}
                    >
                      <span className="text-[10px] font-medium">{DAY_NAMES[getDayOfWeek(year, month, d)]}</span>
                      <span className="font-black text-sm">{d}</span>
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* Employee list for selected day */}
          <div className="space-y-2">
            {employees.map((emp) => {
              const ds = dateStr(year, month, mobileDay)
              const rec = attendance[`${emp.id}_${ds}`]
              const statusInfo = getStatusDisplay(rec?.status)
              return (
                <Card key={emp.id}>
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-sm truncate">{emp.full_name}</p>
                      <p className="text-xs text-muted-foreground">{ROLE_LABELS[emp.role] || emp.role}</p>
                    </div>
                    {canEdit ? (
                      <div className="flex gap-1.5 shrink-0">
                        {STATUS_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => setStatus(emp.id, mobileDay, opt.value)}
                            className={`w-9 h-9 rounded-lg text-xs font-black transition-all ${
                              rec?.status === opt.value
                                ? `${opt.bg} ${opt.color} ring-2 ring-offset-1 ring-current`
                                : "bg-muted/30 text-muted-foreground/50 hover:bg-muted"
                            }`}
                            title={opt.label}
                          >
                            {opt.icon}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <Badge variant={statusInfo ? "default" : "secondary"}>
                        {statusInfo?.label || "Chưa chấm"}
                      </Badge>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {/* VIEW MODE: GRID (desktop) */}
      {viewMode === "grid" && (
        <>
          <div className="overflow-auto bg-surface-container-lowest rounded-xl shadow-card border border-outline-variant/60 relative">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-surface-low">
                <tr>
                  <th className="sticky left-0 z-20 bg-surface-low px-3 py-2 text-left font-bold min-w-[150px]">
                    Nhân viên
                  </th>
                  {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
                    const weekend = isWeekend(year, month, d)
                    const today = isToday(year, month, d)
                    return (
                      <th
                        key={d}
                        ref={today ? todayRef : undefined}
                        className={`px-0.5 py-1 text-center min-w-[36px] ${
                          weekend ? "bg-surface-container" : ""
                        } ${today ? "bg-primary-fixed" : ""}`}
                      >
                        <div className={`text-[10px] ${weekend ? "text-destructive" : "text-muted-foreground"}`}>
                          {DAY_NAMES[getDayOfWeek(year, month, d)]}
                        </div>
                        <div className={`font-black ${today ? "text-primary" : ""}`}>{d}</div>
                      </th>
                    )
                  })}
                  <th className="sticky right-0 z-20 bg-surface-low px-3 py-2 text-center font-bold min-w-[50px]">
                    Công
                  </th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  <tr key={emp.id} className="border-t border-border/20 hover:bg-surface-low/20">
                    <td className="sticky left-0 z-10 bg-card px-3 py-1.5 whitespace-nowrap">
                      <div className="font-semibold text-sm">{emp.full_name}</div>
                      <div className="text-[10px] text-muted-foreground">{ROLE_LABELS[emp.role] || emp.role}</div>
                    </td>
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
                      const ds = dateStr(year, month, d)
                      const rec = attendance[`${emp.id}_${ds}`]
                      const statusInfo = getStatusDisplay(rec?.status)
                      const weekend = isWeekend(year, month, d)
                      const today = isToday(year, month, d)
                      const isPopup = popupCell?.userId === emp.id && popupCell?.day === d

                      return (
                        <td
                          key={d}
                          className={`px-0.5 py-1 text-center relative ${weekend ? "bg-surface-container-low" : ""} ${today ? "bg-primary-fixed/60" : ""}`}
                        >
                          <button
                            onClick={() => canEdit && setPopupCell(isPopup ? null : { userId: emp.id, day: d })}
                            disabled={!canEdit}
                            className={`w-8 h-8 rounded-lg text-[11px] font-black transition-all ${
                              statusInfo
                                ? `${statusInfo.bg} ${statusInfo.color}`
                                : "bg-muted/20 text-muted-foreground/30"
                            } ${canEdit ? "hover:ring-2 hover:ring-primary/30 cursor-pointer active:scale-95" : ""}`}
                          >
                            {statusInfo ? statusInfo.icon : "·"}
                          </button>

                          {/* Status picker popup */}
                          {isPopup && canEdit && (
                            <div className="absolute z-30 top-full left-1/2 -translate-x-1/2 mt-1 bg-surface-container-lowest rounded-lg shadow-overlay border border-outline-variant/60 p-1.5 flex gap-1">
                              {STATUS_OPTIONS.map((opt) => (
                                <button
                                  key={opt.value}
                                  onClick={(e) => { e.stopPropagation(); setStatus(emp.id, d, opt.value) }}
                                  className={`w-8 h-8 rounded-lg text-xs font-black ${opt.bg} ${opt.color} hover:ring-2 hover:ring-current transition-all`}
                                  title={opt.label}
                                >
                                  {opt.icon}
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                      )
                    })}
                    <td className="sticky right-0 z-10 bg-card px-3 py-1.5 text-center font-black text-primary text-sm">
                      {countPresent(emp.id)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 text-xs">
            {STATUS_OPTIONS.map((opt) => (
              <div key={opt.value} className="flex items-center gap-1.5">
                <span className={`w-6 h-6 rounded-lg text-center leading-6 font-black ${opt.bg} ${opt.color}`}>
                  {opt.icon}
                </span>
                <span className="text-muted-foreground">{opt.label}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <span className="w-6 h-6 rounded-lg bg-muted/50 text-center leading-6 text-destructive text-[10px] font-bold">T7</span>
              <span className="text-muted-foreground">Cuối tuần</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-6 h-6 rounded-md bg-primary-fixed text-center leading-6 text-primary text-[10px] font-bold">▼</span>
              <span className="text-muted-foreground">Hôm nay</span>
            </div>
          </div>
        </>
      )}

      {/* Close popup when clicking outside */}
      {popupCell && (
        <div className="fixed inset-0 z-20" onClick={() => setPopupCell(null)} />
      )}
    </div>
  )
}
