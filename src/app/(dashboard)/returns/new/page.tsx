"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { RETURN_REASONS } from "@/lib/constants"
import type { Customer } from "@/types"

export default function NewReturnPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("returns")
  const [customers, setCustomers] = useState<Customer[]>([])
  const [customerId, setCustomerId] = useState("")
  const [reason, setReason] = useState("")
  const [notes, setNotes] = useState("")
  const [creditAmount, setCreditAmount] = useState("")
  const [loading, setLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase.from("customers").select("*").eq("status", "active").order("store_name")
      setCustomers((data as Customer[]) || [])
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <Skeleton className="h-96" />

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!customerId || !reason) return
    setLoading(true)

    try {
      const { error } = await supabase.from("returns").insert({
        customer_id: customerId,
        requested_by: user?.id,
        reason,
        notes: notes || null,
        credit_note_amount: creditAmount ? parseInt(creditAmount) : null,
        // Workflow duyệt đã bỏ — phiếu trả tạo tay cũng vào thẳng
        // trạng thái 'completed' (bản ghi tra cứu).
        status: "completed",
        org_id: user?.org_id,
      })
      if (error) throw error
      toast({ title: "Đã tạo phiếu trả hàng" })
      router.push("/returns")
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Có lỗi xảy ra"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Tạo yêu cầu trả hàng" backHref="/returns" />
      <Card>
        <CardHeader><CardTitle>Thông tin trả hàng</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Khách hàng *</Label>
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger><SelectValue placeholder="Chọn khách hàng" /></SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.store_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Lý do *</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger><SelectValue placeholder="Chọn lý do" /></SelectTrigger>
                  <SelectContent>
                    {RETURN_REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Giá trị Credit Note (VND)</Label>
                <Input type="number" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} placeholder="0" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Ghi chú</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Mô tả chi tiết..." />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => router.back()}>Hủy</Button>
              <Button type="submit" disabled={loading}>{loading ? "Đang gửi..." : "Gửi yêu cầu"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
