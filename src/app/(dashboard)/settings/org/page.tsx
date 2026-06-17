"use client"

import { useEffect, useState } from "react"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { clearOrgCache, useOrg } from "@/hooks/use-org"
import { createClient } from "@/lib/supabase/client"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"

export default function OrgSettingsPage() {
  const { loading: authLoading } = useRoleGuard("settings")
  const { org } = useOrg()
  const [name, setName] = useState("")
  const [allowOversell, setAllowOversell] = useState(false)
  const [loading, setLoading] = useState(false)
  const supabase = createClient()
  const { toast } = useToast()

  useEffect(() => {
    if (org) {
      setName(org.name)
      setAllowOversell(org.allow_oversell)
    }
  }, [org])

  if (authLoading) return <Skeleton className="h-96" />

  const handleSave = async () => {
    if (!org) return
    setLoading(true)
    try {
      const { error } = await supabase
        .from("organizations")
        .update({ name, allow_oversell: allowOversell })
        .eq("id", org.id)
      if (error) throw error
      clearOrgCache()
      toast({ title: "Đã cập nhật thông tin tổ chức" })
    } catch (err) {
      toast({
        title: "Lỗi",
        description: (err as Error).message,
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Cấu hình tổ chức" backHref="/settings" />

      <Card>
        <CardHeader><CardTitle>Thông tin NPP</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Tên NPP</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quy tắc bán hàng</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4 rounded-xl border bg-background p-3">
            <div className="space-y-1">
              <Label className="text-sm font-semibold">
                Cho phép bán vượt tồn kho
              </Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Bật để nhân viên tạo được đơn dù tồn không đủ (đơn đặt
                trước). Khi pick, tồn kho sẽ tạm về âm cho đến khi nhập
                hàng bổ sung. Tắt (mặc định) sẽ chặn ngay trên form và
                hiện lỗi &ldquo;Vượt tồn kho&rdquo;.
              </p>
            </div>
            <Switch
              checked={allowOversell}
              onCheckedChange={setAllowOversell}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={loading}>
          {loading ? "Đang lưu..." : "Lưu thay đổi"}
        </Button>
      </div>
    </div>
  )
}
