"use client"

import { useEffect, useState } from "react"
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
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { PAYMENT_METHODS } from "@/lib/constants"
import { formatCurrency } from "@/lib/utils"
import type { Receivable } from "@/types"

export default function CollectPaymentPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("receivables")
  const [receivables, setReceivables] = useState<Receivable[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [amount, setAmount] = useState("")
  const [method, setMethod] = useState("cash")
  const [loading, setLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("receivables")
        .select("*, customer:customers(store_name)")
        .neq("status", "paid")
        .order("due_date")
      setReceivables((data as Receivable[]) || [])
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <Skeleton className="h-96" />

  const selected = receivables.find((r) => r.id === selectedId)
  const remaining = selected ? selected.amount - selected.paid : 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedId || !amount) return
    setLoading(true)

    try {
      const { error } = await supabase.from("payments").insert({
        receivable_id: selectedId,
        collected_by: user?.id,
        amount: parseInt(amount),
        method,
      })
      if (error) throw error

      const newPaid = (selected?.paid || 0) + parseInt(amount)
      const newStatus = newPaid >= (selected?.amount || 0) ? "paid" : "partial"
      await supabase.from("receivables").update({ paid: newPaid, status: newStatus }).eq("id", selectedId)

      toast({ title: `Đã thu ${formatCurrency(parseInt(amount))}` })
      router.push("/receivables")
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Có lỗi xảy ra"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Thu tiền tại hiện trường" />
      <Card>
        <CardHeader><CardTitle>Thông tin thu tiền</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Công nợ *</Label>
                <Select value={selectedId} onValueChange={setSelectedId}>
                  <SelectTrigger><SelectValue placeholder="Chọn công nợ" /></SelectTrigger>
                  <SelectContent>
                    {receivables.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.customer?.store_name} - Còn nợ: {formatCurrency(r.amount - r.paid)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Hình thức *</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Số tiền thu *</Label>
                <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} max={remaining} required placeholder="Nhập số tiền" />
                {selected && <p className="text-xs text-muted-foreground">Còn nợ: {formatCurrency(remaining)}</p>}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => router.back()}>Hủy</Button>
              <Button type="submit" disabled={loading}>{loading ? "Đang xử lý..." : "Xác nhận thu tiền"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
