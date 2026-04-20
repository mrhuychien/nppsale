"use client"

import { useEffect, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { Save, Plus, Trash2, ChevronLeft, ChevronRight, Loader2 } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import type { HrMonthlyBonus } from "@/types"

interface BonusTier {
  min_revenue: number
  bonus: number
}

export default function BonusConfigPage() {
  const { loading: authLoading } = useRoleGuard("settings")
  const { user: authUser } = useAuth()
  const supabase = createClient()
  const isOwner = authUser?.role === "owner"

  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [config, setConfig] = useState<HrMonthlyBonus | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [history, setHistory] = useState<HrMonthlyBonus[]>([])

  // Form state
  const [tiers, setTiers] = useState<BonusTier[]>([])
  const [notes, setNotes] = useState("")

  const period = `${year}-${String(month).padStart(2, "0")}`

  const fetchData = useCallback(async () => {
    if (!authUser?.org_id) return
    setLoading(true)

    const [currentRes, historyRes] = await Promise.all([
      supabase
        .from("hr_monthly_bonus")
        .select("*")
        .eq("org_id", authUser.org_id)
        .eq("period", period)
        .maybeSingle(),
      supabase
        .from("hr_monthly_bonus")
        .select("*")
        .eq("org_id", authUser.org_id)
        .order("period", { ascending: false })
        .limit(12),
    ])

    if (currentRes.data) {
      const c = currentRes.data as HrMonthlyBonus
      setConfig(c)
      setTiers(c.tiers || [])
      setNotes(c.notes || "")
    } else {
      setConfig(null)
      setTiers([
        { min_revenue: 50000000, bonus: 500000 },
        { min_revenue: 100000000, bonus: 1000000 },
        { min_revenue: 200000000, bonus: 2000000 },
      ])
      setNotes("")
    }

    setHistory((historyRes.data as HrMonthlyBonus[]) || [])
    setLoading(false)
  }, [authUser?.org_id, period]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleSave = async () => {
    if (!authUser?.org_id || !isOwner) return
    setSaving(true)

    const payload = {
      org_id: authUser.org_id,
      period,
      tiers,
      notes,
    }

    if (config?.id) {
      await supabase.from("hr_monthly_bonus").update(payload).eq("id", config.id)
    } else {
      await supabase.from("hr_monthly_bonus").insert(payload)
    }

    await fetchData()
    setSaving(false)
  }

  const addTier = () => {
    setTiers([...tiers, { min_revenue: 0, bonus: 0 }])
  }

  const removeTier = (idx: number) => {
    setTiers(tiers.filter((_, i) => i !== idx))
  }

  const updateTier = (idx: number, field: keyof BonusTier, value: number) => {
    const updated = [...tiers]
    updated[idx] = { ...updated[idx], [field]: value }
    setTiers(updated)
  }

  const changeMonth = (delta: number) => {
    let m = month + delta
    let y = year
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    setMonth(m)
    setYear(y)
  }

  if (authLoading || loading) return <Skeleton className="h-96" />

  if (!isOwner) {
    return (
      <div className="space-y-4">
        <PageHeader title="Thưởng doanh số" backHref="/hr" />
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Chỉ chủ NPP được phép chỉnh sửa cấu hình thưởng.
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Thưởng doanh số"
        description="Cấu hình mức thưởng theo doanh số hàng tháng"
        backHref="/hr"
      >
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Lưu
        </Button>
      </PageHeader>

      {/* Period Selector */}
      <Card>
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

      {/* Tiers Editor */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Mức thưởng doanh số</CardTitle>
          <Button variant="outline" size="sm" onClick={addTier}>
            <Plus className="h-4 w-4 mr-1" /> Thêm mức
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {tiers.map((tier, idx) => (
              <div key={idx} className="flex items-end gap-3">
                <div className="flex-1">
                  <Label>Doanh số tối thiểu (VNĐ)</Label>
                  <Input
                    type="number"
                    value={tier.min_revenue}
                    onChange={(e) => updateTier(idx, "min_revenue", Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground mt-0.5">{formatCurrency(tier.min_revenue)}</p>
                </div>
                <div className="flex-1">
                  <Label>Thưởng (VNĐ)</Label>
                  <Input
                    type="number"
                    value={tier.bonus}
                    onChange={(e) => updateTier(idx, "bonus", Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground mt-0.5">{formatCurrency(tier.bonus)}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive shrink-0"
                  onClick={() => removeTier(idx)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {tiers.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Chưa có mức thưởng nào</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader>
          <CardTitle>Ghi chú</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Ghi chú về cấu hình thưởng tháng này..."
          />
        </CardContent>
      </Card>

      {/* History */}
      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Lịch sử cấu hình</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kỳ</TableHead>
                  <TableHead className="text-right">Số mức</TableHead>
                  <TableHead>Ghi chú</TableHead>
                  <TableHead>Ngày tạo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((h) => (
                  <TableRow
                    key={h.id}
                    className={h.period === period ? "bg-primary/5" : "cursor-pointer"}
                    onClick={() => {
                      const [y, m] = h.period.split("-").map(Number)
                      setYear(y)
                      setMonth(m)
                    }}
                  >
                    <TableCell className="font-semibold">{h.period}</TableCell>
                    <TableCell className="text-right">{h.tiers?.length || 0}</TableCell>
                    <TableCell className="text-muted-foreground truncate max-w-[200px]">
                      {h.notes || "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(h.created_at).toLocaleDateString("vi-VN")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
