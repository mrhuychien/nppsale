"use client"

import { useEffect, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent } from "@/components/ui/card"
import { ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react"
import type { User, AttendanceStatus, HrAttendance } from "@/types"

const STATUS_CYCLE: AttendanceStatus[] = ["present", "absent", "half_day", "leave"]
const STATUS_DISPLAY: Record<AttendanceStatus, { icon: string; color: string }> = {
  present: { icon: "\u2713", color: "bg-green-100 text-green-700" },
  absent: { icon: "\u2717", color: "bg-red-100 text-red-700" },
  half_day: { icon: "\u00BD", color: "bg-amber-100 text-amber-700" },
  leave: { icon: "L", color: "bg-blue-100 text-blue-700" },
  holiday: { icon: "H", color: "bg-purple-100 text-purple-700" },
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

export default function AttendancePage() {
  const { loading: authLoading } = useRoleGuard("settings")
  const { user: authUser } = useAuth()
  const canEdit = authUser?.role === "owner" || authUser?.role === "manager"
  const supabase = createClient()

  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [employees, setEmployees] = useState<User[]>([])
  const [attendance, setAttendance] = useState<Record<string, HrAttendance>>({})
  const [loading, setLoading] = useState(true)

  const daysInMonth = getDaysInMonth(year, month)

  const fetchData = useCallback(async () => {
    if (!authUser?.org_id) return
    setLoading(true)

    const startDate = `${year}-${String(month).padStart(2, "0")}-01`
    const endDate = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`

    const [usersRes, attendRes] = await Promise.all([
      supabase
        .from("users")
        .select("*")
        .eq("org_id", authUser.org_id)
        .eq("is_active", true)
        .order("full_name"),
      supabase
        .from("hr_attendance")
        .select("*")
        .eq("org_id", authUser.org_id)
        .gte("work_date", startDate)
        .lte("work_date", endDate),
    ])

    setEmployees((usersRes.data as User[]) || [])

    const map: Record<string, HrAttendance> = {}
    for (const row of (attendRes.data as HrAttendance[]) || []) {
      map[`${row.user_id}_${row.work_date}`] = row
    }
    setAttendance(map)
    setLoading(false)
  }, [authUser?.org_id, year, month, daysInMonth]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const toggleCell = async (userId: string, day: number) => {
    if (!canEdit || !authUser?.org_id) return
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    const key = `${userId}_${dateStr}`
    const existing = attendance[key]
    const currentStatus: AttendanceStatus = existing?.status || "present"
    const idx = STATUS_CYCLE.indexOf(currentStatus)
    const nextStatus = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]

    // Optimistic update
    const newRecord: HrAttendance = {
      id: existing?.id || "temp",
      org_id: authUser.org_id,
      user_id: userId,
      work_date: dateStr,
      status: nextStatus,
      check_in: null,
      check_out: null,
      notes: null,
      created_at: new Date().toISOString(),
    }
    setAttendance((prev) => ({ ...prev, [key]: newRecord }))

    const { data } = await supabase
      .from("hr_attendance")
      .upsert(
        {
          org_id: authUser.org_id,
          user_id: userId,
          work_date: dateStr,
          status: nextStatus,
        },
        { onConflict: "org_id,user_id,work_date" }
      )
      .select()
      .single()

    if (data) {
      setAttendance((prev) => ({ ...prev, [key]: data as HrAttendance }))
    }
  }

  const bulkMarkPresent = async (day: number) => {
    if (!canEdit || !authUser?.org_id) return
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`

    const rows = employees.map((emp) => ({
      org_id: authUser.org_id,
      user_id: emp.id,
      work_date: dateStr,
      status: "present" as AttendanceStatus,
    }))

    await supabase
      .from("hr_attendance")
      .upsert(rows, { onConflict: "org_id,user_id,work_date" })

    fetchData()
  }

  const changeMonth = (delta: number) => {
    let m = month + delta
    let y = year
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    setMonth(m)
    setYear(y)
  }

  const countPresent = (userId: string): number => {
    let count = 0
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`
      const rec = attendance[`${userId}_${dateStr}`]
      if (rec?.status === "present") count += 1
      else if (rec?.status === "half_day") count += 0.5
    }
    return count
  }

  const countDayTotal = (day: number): number => {
    let count = 0
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    for (const emp of employees) {
      const rec = attendance[`${emp.id}_${dateStr}`]
      if (rec?.status === "present") count += 1
      else if (rec?.status === "half_day") count += 0.5
    }
    return count
  }

  if (authLoading || loading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Chấm công" description="Bảng chấm công nhân viên" backHref="/hr" />

      {/* Month/Year Selector */}
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <Button variant="outline" size="icon" onClick={() => changeMonth(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-black">
            Tháng {month}/{year}
          </h2>
          <Button variant="outline" size="icon" onClick={() => changeMonth(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>

      {/* Attendance Grid */}
      <div className="overflow-auto bg-card rounded-2xl shadow-ambient">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-surface-low">
            <tr>
              <th className="sticky left-0 z-10 bg-surface-low px-3 py-2 text-left font-bold min-w-[140px]">
                Nhân viên
              </th>
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
                <th key={d} className="px-1 py-2 text-center font-bold min-w-[32px]">
                  <div>{d}</div>
                  {canEdit && (
                    <button
                      onClick={() => bulkMarkPresent(d)}
                      className="text-[8px] text-primary hover:underline mt-0.5"
                      title="Đánh dấu tất cả có mặt"
                    >
                      <CheckCircle2 className="h-3 w-3 mx-auto" />
                    </button>
                  )}
                </th>
              ))}
              <th className="px-3 py-2 text-center font-bold min-w-[50px] sticky right-0 bg-surface-low">
                Tổng
              </th>
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <tr key={emp.id} className="border-t border-border/30 hover:bg-surface-low/30">
                <td className="sticky left-0 z-10 bg-card px-3 py-1.5 font-semibold whitespace-nowrap">
                  {emp.full_name}
                </td>
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
                  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`
                  const rec = attendance[`${emp.id}_${dateStr}`]
                  const status = rec?.status
                  const display = status ? STATUS_DISPLAY[status] : null
                  return (
                    <td
                      key={d}
                      className="px-0.5 py-1 text-center"
                    >
                      <button
                        onClick={() => toggleCell(emp.id, d)}
                        disabled={!canEdit}
                        className={`w-7 h-7 rounded-md text-[10px] font-black transition-all ${
                          display
                            ? display.color
                            : "bg-muted/30 text-muted-foreground/40"
                        } ${canEdit ? "hover:ring-2 hover:ring-primary/30 cursor-pointer" : ""}`}
                      >
                        {display ? display.icon : "\u00B7"}
                      </button>
                    </td>
                  )
                })}
                <td className="sticky right-0 bg-card px-3 py-1.5 text-center font-black text-primary">
                  {countPresent(emp.id)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-surface-low">
            <tr>
              <td className="sticky left-0 z-10 bg-surface-low px-3 py-2 font-bold">
                Tổng / ngày
              </td>
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
                <td key={d} className="px-1 py-2 text-center font-bold text-primary">
                  {countDayTotal(d) || ""}
                </td>
              ))}
              <td className="sticky right-0 bg-surface-low px-3 py-2" />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {Object.entries(STATUS_DISPLAY).map(([key, val]) => (
          <div key={key} className="flex items-center gap-1.5">
            <span className={`w-5 h-5 rounded text-center leading-5 font-black ${val.color}`}>
              {val.icon}
            </span>
            <span className="text-muted-foreground capitalize">
              {key === "present" ? "Có mặt" : key === "absent" ? "Vắng" : key === "half_day" ? "Nửa ngày" : key === "leave" ? "Nghỉ phép" : "Nghỉ lễ"}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
