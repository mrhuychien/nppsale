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
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { COMMISSION_TYPES } from "@/lib/constants"
import { Plus, Trash2 } from "lucide-react"

interface Tier {
  min: string
  max: string
  rate: string
}

export default function NewCommissionPolicyPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("commissions")
  const [name, setName] = useState("")
  const [type, setType] = useState("percentage")
  const [appliesTo, setAppliesTo] = useState("all")
  const [effectiveFrom, setEffectiveFrom] = useState("")
  const [effectiveTo, setEffectiveTo] = useState("")
  const [isActive, setIsActive] = useState(true)
  const [percentageRate, setPercentageRate] = useState("")
  const [fixedAmount, setFixedAmount] = useState("")
  const [tiers, setTiers] = useState<Tier[]>([{ min: "", max: "", rate: "" }])
  const [loading, setLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  if (authLoading) return <Skeleton className="h-96" />

  const addTier = () => {
    setTiers([...tiers, { min: "", max: "", rate: "" }])
  }

  const removeTier = (index: number) => {
    if (tiers.length <= 1) return
    setTiers(tiers.filter((_, i) => i !== index))
  }

  const updateTier = (index: number, field: keyof Tier, value: string) => {
    const updated = [...tiers]
    updated[index] = { ...updated[index], [field]: value }
    setTiers(updated)
  }

  const buildTiersJson = (): Record<string, unknown>[] | null => {
    if (type === "percentage") {
      const rate = parseFloat(percentageRate)
      if (isNaN(rate) || rate <= 0) {
        toast({ title: "Ty le phan tram khong hop le", variant: "destructive" })
        return null
      }
      return [{ rate: rate / 100 }]
    }
    if (type === "fixed") {
      const amount = parseFloat(fixedAmount)
      if (isNaN(amount) || amount <= 0) {
        toast({ title: "So tien co dinh khong hop le", variant: "destructive" })
        return null
      }
      return [{ amount }]
    }
    if (type === "tiered") {
      const parsed = tiers.map((t) => ({
        min: parseFloat(t.min),
        max: parseFloat(t.max),
        rate: parseFloat(t.rate) / 100,
      }))
      const invalid = parsed.some((t) => isNaN(t.min) || isNaN(t.max) || isNaN(t.rate) || t.rate <= 0)
      if (invalid) {
        toast({ title: "Cac bac luy ke khong hop le", description: "Vui long kiem tra lai gia tri min, max va ty le", variant: "destructive" })
        return null
      }
      return parsed
    }
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const tiersJson = buildTiersJson()
      if (tiersJson === null) {
        setLoading(false)
        return
      }

      const { error } = await supabase.from("commission_policies").insert({
        name,
        type,
        tiers: tiersJson,
        applies_to: appliesTo || "all",
        effective_from: effectiveFrom || null,
        effective_to: effectiveTo || null,
        is_active: isActive,
        org_id: user?.org_id,
      })
      if (error) throw error
      toast({ title: "Da tao chinh sach hoa hong" })
      router.push("/commissions/policies")
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Co loi xay ra"
      toast({ title: "Loi", description: message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Tao chinh sach hoa hong" />
      <Card>
        <CardHeader><CardTitle>Thong tin chinh sach</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Ten chinh sach *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="VD: Hoa hong theo doanh so" />
              </div>
              <div className="space-y-2">
                <Label>Loai hoa hong *</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COMMISSION_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Ap dung cho</Label>
                <Input value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)} placeholder="all" />
              </div>
              <div className="space-y-2">
                <Label>Hieu luc tu</Label>
                <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Hieu luc den</Label>
                <Input type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
              </div>
              <div className="flex items-center gap-3 pt-6">
                <Switch checked={isActive} onCheckedChange={setIsActive} id="is-active" />
                <Label htmlFor="is-active">Kich hoat ngay</Label>
              </div>
            </div>

            {type === "percentage" && (
              <div className="space-y-2">
                <Label>Ty le hoa hong (%) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={percentageRate}
                  onChange={(e) => setPercentageRate(e.target.value)}
                  required
                  placeholder="VD: 5 (tuong duong 5%)"
                />
              </div>
            )}

            {type === "fixed" && (
              <div className="space-y-2">
                <Label>So tien co dinh (VND) *</Label>
                <Input
                  type="number"
                  step="1"
                  min="0"
                  value={fixedAmount}
                  onChange={(e) => setFixedAmount(e.target.value)}
                  required
                  placeholder="VD: 100000"
                />
              </div>
            )}

            {type === "tiered" && (
              <div className="space-y-3">
                <Label>Cac bac luy ke *</Label>
                {tiers.map((tier, index) => (
                  <div key={index} className="flex items-end gap-2">
                    <div className="space-y-1 flex-1">
                      {index === 0 && <Label className="text-xs text-muted-foreground">Gia tri min</Label>}
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        value={tier.min}
                        onChange={(e) => updateTier(index, "min", e.target.value)}
                        required
                        placeholder="0"
                      />
                    </div>
                    <div className="space-y-1 flex-1">
                      {index === 0 && <Label className="text-xs text-muted-foreground">Gia tri max</Label>}
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        value={tier.max}
                        onChange={(e) => updateTier(index, "max", e.target.value)}
                        required
                        placeholder="10000000"
                      />
                    </div>
                    <div className="space-y-1 flex-1">
                      {index === 0 && <Label className="text-xs text-muted-foreground">Ty le (%)</Label>}
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={tier.rate}
                        onChange={(e) => updateTier(index, "rate", e.target.value)}
                        required
                        placeholder="3"
                      />
                    </div>
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeTier(index)} disabled={tiers.length <= 1}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addTier}>
                  <Plus className="mr-2 h-4 w-4" /> Them bac
                </Button>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => router.back()}>Huy</Button>
              <Button type="submit" disabled={loading}>{loading ? "Dang luu..." : "Tao chinh sach"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
