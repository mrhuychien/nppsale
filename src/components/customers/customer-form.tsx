"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { CHANNELS, PAYMENT_TERMS } from "@/lib/constants"
import type { Customer, CustomerGroup } from "@/types"

interface CustomerFormProps {
  customer?: Customer
  groups: CustomerGroup[]
}

export function CustomerForm({ customer, groups }: CustomerFormProps) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({
    store_name: customer?.store_name || "",
    owner_name: customer?.owner_name || "",
    phone: customer?.phone || "",
    address: customer?.address || "",
    province: customer?.province || "",
    district: customer?.district || "",
    ward: customer?.ward || "",
    channel: customer?.channel || "",
    group_id: customer?.group_id || "",
    credit_limit: customer?.credit_limit?.toString() || "0",
    payment_terms: customer?.payment_terms || "COD",
    status: customer?.status || "active",
  })
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      // Check duplicate phone
      if (!customer || customer.phone !== form.phone) {
        const { data: existing } = await supabase
          .from("customers")
          .select("id")
          .eq("phone", form.phone)
          .limit(1)
        if (existing && existing.length > 0) {
          toast({ title: "Loi", description: "So dien thoai da ton tai", variant: "destructive" })
          setLoading(false)
          return
        }
      }

      const payload = {
        store_name: form.store_name,
        owner_name: form.owner_name,
        phone: form.phone,
        address: form.address,
        province: form.province || null,
        district: form.district || null,
        ward: form.ward || null,
        channel: form.channel || null,
        group_id: form.group_id || null,
        credit_limit: parseInt(form.credit_limit) || 0,
        payment_terms: form.payment_terms,
        status: form.status,
      }

      if (customer) {
        const { error } = await supabase.from("customers").update(payload).eq("id", customer.id)
        if (error) throw error
        toast({ title: "Da cap nhat khach hang" })
      } else {
        const { error } = await supabase.from("customers").insert({ ...payload, org_id: user?.org_id })
        if (error) throw error
        toast({ title: "Da tao khach hang moi" })
      }

      router.push("/customers")
      router.refresh()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Co loi xay ra"
      toast({ title: "Loi", description: message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{customer ? "Cap nhat khach hang" : "Them khach hang moi"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Ten cua hang *</Label>
              <Input value={form.store_name} onChange={(e) => setForm({ ...form, store_name: e.target.value })} required placeholder="VD: Tap hoa Ba Hai" />
            </div>
            <div className="space-y-2">
              <Label>Ten chu cua hang *</Label>
              <Input value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>So dien thoai *</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required placeholder="0901000001" />
            </div>
            <div className="space-y-2">
              <Label>Kenh ban hang</Label>
              <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
                <SelectTrigger><SelectValue placeholder="Chon kenh" /></SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((ch) => <SelectItem key={ch.value} value={ch.value}>{ch.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Dia chi *</Label>
              <Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} required placeholder="So nha, ten duong" />
            </div>
            <div className="space-y-2">
              <Label>Tinh/Thanh</Label>
              <Input value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} placeholder="VD: TP HCM" />
            </div>
            <div className="space-y-2">
              <Label>Quan/Huyen</Label>
              <Input value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Nhom khach hang</Label>
              <Select value={form.group_id} onValueChange={(v) => setForm({ ...form, group_id: v })}>
                <SelectTrigger><SelectValue placeholder="Chon nhom" /></SelectTrigger>
                <SelectContent>
                  {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Han muc cong no (VND)</Label>
              <Input type="number" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Dieu khoan thanh toan</Label>
              <Select value={form.payment_terms} onValueChange={(v) => setForm({ ...form, payment_terms: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_TERMS.map((pt) => <SelectItem key={pt.value} value={pt.value}>{pt.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Trang thai</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Hoat dong</SelectItem>
                  <SelectItem value="suspended">Tam ngung</SelectItem>
                  <SelectItem value="locked">Khoa</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => router.back()}>Huy</Button>
            <Button type="submit" disabled={loading}>{loading ? "Dang luu..." : (customer ? "Cap nhat" : "Tao moi")}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
