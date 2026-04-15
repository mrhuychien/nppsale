"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { PROMOTION_TYPES } from "@/lib/constants"

export default function NewPromotionPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("promotions")
  const [name, setName] = useState("")
  const [type, setType] = useState("trade_discount")
  const [priority, setPriority] = useState("0")
  const [startsAt, setStartsAt] = useState("")
  const [endsAt, setEndsAt] = useState("")
  const [rulesJson, setRulesJson] = useState('{"discount_percent": 5}')
  const [loading, setLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  if (authLoading) return <Skeleton className="h-96" />

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      let rules = {}
      try { rules = JSON.parse(rulesJson) } catch { toast({ title: "JSON rules không hợp lệ", variant: "destructive" }); setLoading(false); return }

      const { error } = await supabase.from("promotions").insert({
        name,
        type,
        rules,
        priority: parseInt(priority) || 0,
        starts_at: startsAt || null,
        ends_at: endsAt || null,
        is_active: true,
        org_id: user?.org_id,
      })
      if (error) throw error
      toast({ title: "Đã tạo chương trình khuyến mãi" })
      router.push("/promotions")
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Có lỗi xảy ra"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Tạo chương trình khuyến mãi" />
      <Card>
        <CardHeader><CardTitle>Thông tin khuyến mãi</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Tên chương trình *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="VD: Chiết khấu mùa tết" />
              </div>
              <div className="space-y-2">
                <Label>Loại KM *</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROMOTION_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Độ ưu tiên</Label>
                <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Bắt đầu</Label>
                <Input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Kết thúc</Label>
                <Input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Rules (JSON)</Label>
              <Textarea value={rulesJson} onChange={(e) => setRulesJson(e.target.value)} rows={4} className="font-mono text-sm" />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => router.back()}>Hủy</Button>
              <Button type="submit" disabled={loading}>{loading ? "Đang lưu..." : "Tạo khuyến mãi"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
