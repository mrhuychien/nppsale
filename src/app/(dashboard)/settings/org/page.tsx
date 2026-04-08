"use client"

import { useEffect, useState } from "react"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useOrg } from "@/hooks/use-org"
import { createClient } from "@/lib/supabase/client"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"

export default function OrgSettingsPage() {
  const { loading: authLoading } = useRoleGuard("settings")
  const { org } = useOrg()
  const [name, setName] = useState("")
  const [loading, setLoading] = useState(false)
  const supabase = createClient()
  const { toast } = useToast()

  useEffect(() => {
    if (org) setName(org.name)
  }, [org])

  if (authLoading) return <Skeleton className="h-96" />

  const handleSave = async () => {
    if (!org) return
    setLoading(true)
    try {
      const { error } = await supabase.from("organizations").update({ name }).eq("id", org.id)
      if (error) throw error
      toast({ title: "Da cap nhat thong tin to chuc" })
    } catch {
      toast({ title: "Loi", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Cau hinh to chuc" />
      <Card>
        <CardHeader><CardTitle>Thong tin NPP</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Ten NPP</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button onClick={handleSave} disabled={loading}>{loading ? "Dang luu..." : "Luu thay doi"}</Button>
        </CardContent>
      </Card>
    </div>
  )
}
