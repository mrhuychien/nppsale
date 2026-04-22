"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
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
import { EmptyState } from "@/components/ui/empty-state"
import { useToast } from "@/hooks/use-toast"
import { PAYMENT_METHODS } from "@/lib/constants"
import { formatCurrency, formatDate } from "@/lib/utils"
import { CreditCard } from "lucide-react"
import type { Receivable } from "@/types"

export default function CollectPaymentPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("receivables")
  const searchParams = useSearchParams()
  const customerIdParam = searchParams.get("customerId") || ""
  const receivableIdParam = searchParams.get("receivableId") || ""

  const [receivables, setReceivables] = useState<Receivable[]>([])
  const [customerName, setCustomerName] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState(receivableIdParam)
  const [amount, setAmount] = useState("")
  const [method, setMethod] = useState("cash")
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    async function fetchData() {
      setFetching(true)
      let query = supabase
        .from("receivables")
        .select("*, customer:customers(store_name)")
        .neq("status", "paid")
        .order("due_date")

      if (customerIdParam) {
        query = query.eq("customer_id", customerIdParam)
      }

      const { data } = await query
      const list = (data as Receivable[]) || []
      setReceivables(list)

      if (customerIdParam) {
        if (list.length > 0) {
          setCustomerName(list[0].customer?.store_name || null)
        } else {
          const { data: customerData } = await supabase
            .from("customers")
            .select("store_name")
            .eq("id", customerIdParam)
            .single()
          setCustomerName((customerData as { store_name?: string } | null)?.store_name || null)
        }
      }

      // Auto-select first receivable when filtering by customer
      if (customerIdParam && list.length > 0 && !receivableIdParam) {
        setSelectedId(list[0].id)
      }

      setFetching(false)
    }
    fetchData()
  }, [customerIdParam, receivableIdParam]) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = useMemo(
    () => receivables.find((r) => r.id === selectedId),
    [receivables, selectedId]
  )
  const remaining = selected ? selected.amount - selected.paid : 0

  if (authLoading) return <Skeleton className="h-96" />

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
      if (customerIdParam) {
        router.push(`/customers/${customerIdParam}`)
      } else {
        router.push("/receivables")
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Có lỗi xảy ra"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  const pageTitle = customerIdParam && customerName
    ? `Thu tiền: ${customerName}`
    : "Thu tiền tại hiện trường"
  const backHref = customerIdParam ? `/customers/${customerIdParam}` : "/receivables"

  const totalOutstanding = receivables.reduce((sum, r) => sum + (r.amount - r.paid), 0)

  return (
    <div className="space-y-4">
      <PageHeader
        title={pageTitle}
        description={customerIdParam
          ? `${receivables.length} công nợ • Tổng còn: ${formatCurrency(totalOutstanding)}`
          : undefined}
        backHref={backHref}
      />

      {fetching ? (
        <Skeleton className="h-64" />
      ) : customerIdParam && receivables.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="h-8 w-8 text-muted-foreground" />}
          title="Khách hàng này không có công nợ"
          description="Tất cả công nợ đã được thanh toán"
        />
      ) : (
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
                          {customerIdParam
                            ? `${r.due_date ? formatDate(r.due_date) : "Không hạn"} - Còn: ${formatCurrency(r.amount - r.paid)}`
                            : `${r.customer?.store_name} - Còn nợ: ${formatCurrency(r.amount - r.paid)}`}
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
                  <Input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    max={remaining}
                    required
                    placeholder="Nhập số tiền"
                  />
                  {selected && <p className="text-xs text-muted-foreground">Còn nợ: {formatCurrency(remaining)}</p>}
                </div>
                {selected && (
                  <div className="space-y-2">
                    <Label>Thao tác nhanh</Label>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => setAmount(String(remaining))}
                    >
                      Thu toàn bộ ({formatCurrency(remaining)})
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => router.back()}>Hủy</Button>
                <Button type="submit" disabled={loading}>{loading ? "Đang xử lý..." : "Xác nhận thu tiền"}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
