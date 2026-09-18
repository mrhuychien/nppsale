"use client"

/**
 * LẬP PHIẾU THU — chứng từ độc lập của workflow v2.
 *
 * Kế toán chọn một khách, tick những khoản nợ muốn thu, tick thêm những
 * phiếu trả ĐỘC LẬP muốn cấn trừ, rồi lưu. Toàn bộ việc ghi sổ nằm trong
 * RPC `create_cash_receipt` — một giao dịch, có khoá hàng, có chống thu
 * vượt và chống cấn trừ trùng.
 *
 * ⚠ HAI LOẠI PHIẾU TRẢ GIẢM CÔNG NỢ THEO HAI ĐƯỜNG KHÁC NHAU. Phiếu trả
 * GẮN ĐƠN đã giảm nợ ngay lúc `complete_return` chạy; đem nó vào đây nữa
 * là trừ hai lần, nên RPC từ chối bằng `BAD_CREDIT`. Chỉ phiếu ĐỘC LẬP
 * (`order_id` null) mới nằm chờ ở đây — đó chính là "cấn trừ đơn trả
 * độc lập".
 *
 * ⚠ CON SỐ TO NHẤT MÀN PHẢI LÀ SỐ TIỀN KHÁCH ĐƯA THẬT, tức tổng khoản nợ
 * đã chọn TRỪ tổng khoản có cấn trừ. Hiện tổng khoản nợ thay cho nó là
 * bảo kế toán thu nhiều hơn số khách phải trả.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { useToast } from "@/hooks/use-toast"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { MoneyInput } from "@/components/ui/money-input"
import { formatCurrency, formatDate } from "@/lib/utils"
import { PAYMENT_METHODS } from "@/lib/constants"
import { errorMessage } from "@/lib/errors"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { createCashReceipt, cashToCollect } from "@/lib/finance/cash-receipt"
import { Save, HandCoins, Undo2, TriangleAlert } from "lucide-react"

interface OpenReceivable {
  id: string
  order_id: string | null
  amount: number
  paid: number
  due_date: string | null
  status: string
  order?: { order_code?: string | null } | null
}

interface StandaloneCredit {
  id: string
  credit_note_amount: number | null
  created_at: string
  reason: string | null
}

export default function NewCashReceiptPage() {
  const router = useRouter()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("receivables")
  const { toast } = useToast()
  const supabase = createClient()

  const [customers, setCustomers] = useState<Array<{ id: string; store_name: string }>>([])
  const [customerId, setCustomerId] = useState("")
  const [method, setMethod] = useState("cash")
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState("")

  const [receivables, setReceivables] = useState<OpenReceivable[] | null>(null)
  const [credits, setCredits] = useState<StandaloneCredit[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  /** id khoản nợ → số tiền thu. `MoneyInput` trả về số đã phân tích sẵn. */
  const [amounts, setAmounts] = useState<Record<string, number>>({})
  const [pickedCredits, setPickedCredits] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await fetchAllForAggregate<{ id: string; store_name: string }>((from, to) =>
        supabase
          .from("customers")
          .select("id, store_name", { count: "exact" })
          .order("store_name")
          .range(from, to)
      )
      if (cancelled) return
      if (res.error) setLoadError(res.error)
      setCustomers(res.rows)
    })()
    return () => {
      cancelled = true
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Nạp khoản nợ còn mở + khoản có đang chờ của khách vừa chọn.
   *
   * ⚠ ĐỌC HỎNG THÌ NÓI RA. Hiện danh sách rỗng cho một lỗi mạng là kế
   * toán kết luận khách này không nợ gì, rồi đóng sổ sai.
   */
  const loadCustomer = useCallback(
    async (cid: string) => {
      setReceivables(null)
      setCredits(null)
      setAmounts({})
      setPickedCredits(new Set())
      setLoadError(null)
      if (!cid) return

      const [recRes, credRes] = await Promise.all([
        supabase
          .from("receivables")
          .select("id, order_id, amount, paid, due_date, status, order:sales_orders(order_code)")
          .eq("customer_id", cid)
          .in("status", ["open", "partial", "overdue"])
          .order("due_date", { ascending: true, nullsFirst: false }),
        /**
         * ⚠ BA ĐIỀU KIỆN NÀY PHẢI KHỚP ĐÚNG THỨ RPC KIỂM (`BAD_CREDIT`):
         * đã hoàn thành, KHÔNG gắn đơn nào, và chưa cấn trừ vào phiếu thu
         * nào. Hiện rộng hơn là người dùng tick được một phiếu mà RPC sẽ
         * từ chối; hiện hẹp hơn là khoản có nằm chờ mãi không ai thấy.
         */
        supabase
          .from("returns")
          .select("id, credit_note_amount, created_at, reason")
          .eq("customer_id", cid)
          .eq("status", "completed")
          .is("order_id", null)
          .is("applied_receipt_id", null)
          .order("created_at", { ascending: true }),
      ])
      if (recRes.error || credRes.error) {
        setLoadError(errorMessage(recRes.error ?? credRes.error))
        return
      }
      setReceivables(((recRes.data as unknown) as OpenReceivable[]) ?? [])
      setCredits(((credRes.data as unknown) as StandaloneCredit[]) ?? [])
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  )

  useEffect(() => {
    void loadCustomer(customerId)
  }, [customerId, loadCustomer])

  const remainingOf = (r: OpenReceivable) =>
    Math.max(0, Number(r.amount || 0) - Number(r.paid || 0))

  const linesTotal = useMemo(
    () => Object.values(amounts).reduce((s, v) => s + (Number(v) || 0), 0),
    [amounts]
  )
  const creditsTotal = useMemo(
    () =>
      (credits ?? [])
        .filter((c) => pickedCredits.has(c.id))
        .reduce((s, c) => s + Number(c.credit_note_amount || 0), 0),
    [credits, pickedCredits]
  )
  const toCollect = cashToCollect(linesTotal, creditsTotal)

  /**
   * ⚠ BA LUẬT NÀY LÀ BẢN SAO CỦA BA PHÉP KIỂM TRONG RPC. Chặn ở đây để
   * người dùng thấy lý do ngay cạnh ô nhập, thay vì bấm Lưu rồi nhận một
   * mã lỗi. RPC vẫn kiểm lại — đây là lớp lịch sự, không phải lớp an
   * toàn.
   */
  const overAmount = useMemo(
    () =>
      (receivables ?? []).filter((r) => (Number(amounts[r.id]) || 0) > remainingOf(r) + 0.01),
    [receivables, amounts]
  )
  const creditOverflow = creditsTotal > linesTotal
  const nothingPicked = linesTotal <= 0 && creditsTotal <= 0
  const canSave =
    !!user &&
    hasPermission(user.role, "receivables", "create") &&
    !!customerId &&
    !nothingPicked &&
    !creditOverflow &&
    overAmount.length === 0 &&
    !saving

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const lines = Object.entries(amounts)
        .map(([receivable_id, v]) => ({ receivable_id, amount: Number(v) || 0 }))
        .filter((l) => l.amount > 0)
      const id = await createCashReceipt(supabase, {
        customer_id: customerId,
        method,
        receipt_date: receiptDate,
        notes: notes.trim() || null,
        lines,
        credits: Array.from(pickedCredits).map((return_id) => ({ return_id })),
      })
      toast({
        title: "Đã lập phiếu thu",
        description:
          creditsTotal > 0
            ? `Khách đưa ${formatCurrency(toCollect)}, cấn trừ ${formatCurrency(creditsTotal)} từ phiếu trả.`
            : `Khách đưa ${formatCurrency(toCollect)}.`,
      })
      router.push(`/finance/cash-receipts/${id}`)
    } catch (err) {
      toast({ title: "Không lập được phiếu thu", description: errorMessage(err), variant: "destructive" })
      setSaving(false)
    }
  }

  if (authLoading) return <Skeleton className="h-96" />

  const noPermission = !!user && !hasPermission(user.role, "receivables", "create")

  return (
    <div className="space-y-4">
      <PageHeader
        title="Lập phiếu thu"
        description="Chọn khách, tick khoản nợ cần thu, cấn trừ phiếu trả độc lập nếu có."
        backHref="/finance/cash-receipts"
      />

      {noPermission && (
        <Card className="border-error/40 bg-error-container">
          <CardContent className="p-3 text-sm font-semibold text-on-error-container">
            Bạn chưa được cấp quyền lập phiếu thu.
          </CardContent>
        </Card>
      )}

      {loadError && (
        <Card className="border-error/40 bg-error-container">
          <CardContent className="p-3 text-sm text-on-error-container">
            <p className="font-semibold">Không đọc được dữ liệu</p>
            <p className="mt-0.5 break-words">{loadError}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Thông tin phiếu</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5 sm:col-span-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Khách hàng
                </Label>
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Chọn khách hàng" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.store_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Ngày thu
                </Label>
                <Input
                  type="date"
                  value={receiptDate}
                  onChange={(e) => setReceiptDate(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Hình thức
                </Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Ghi chú
                </Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <HandCoins className="h-4 w-4" /> Khoản nợ còn mở
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {!customerId ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Chọn khách hàng để xem khoản nợ.
                </p>
              ) : receivables === null ? (
                <>
                  <Skeleton className="h-14" />
                  <Skeleton className="h-14" />
                </>
              ) : receivables.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Khách này không còn khoản nợ nào đang mở.
                </p>
              ) : (
                receivables.map((r) => {
                  const remaining = remainingOf(r)
                  const picked = (Number(amounts[r.id]) || 0) > 0
                  const over = (Number(amounts[r.id]) || 0) > remaining + 0.01
                  return (
                    <div
                      key={r.id}
                      className={`grid gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_auto] sm:items-center ${
                        over ? "border-error/50 bg-error/5" : picked ? "border-primary/40 bg-primary/5" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">
                          {r.order?.order_code || "Công nợ không gắn đơn"}
                        </p>
                        <p className="mt-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                          Còn nợ {formatCurrency(remaining)}
                          {r.due_date ? ` · hạn ${formatDate(r.due_date)}` : ""}
                        </p>
                        {over && (
                          <p className="mt-1 text-xs font-bold text-error">
                            Thu vượt số còn nợ — nhiều nhất {formatCurrency(remaining)}.
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <MoneyInput
                          value={amounts[r.id] ?? ""}
                          onChange={(v) => setAmounts((p) => ({ ...p, [r.id]: v }))}
                          className="w-40"
                          inputClassName="tabular-nums"
                        />
                        {/* Bấm một lần là điền hết phần còn nợ — việc kế toán
                            làm nhiều nhất, đừng bắt gõ lại con số đã hiện. */}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setAmounts((p) => ({ ...p, [r.id]: remaining }))}
                        >
                          Đủ
                        </Button>
                      </div>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Undo2 className="h-4 w-4" /> Cấn trừ phiếu trả độc lập
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {/* ⚠ NÓI RÕ VÌ SAO DANH SÁCH NÀY HẸP. Phiếu trả gắn đơn đã giảm
                  nợ ngay lúc hoàn thành; đem vào đây nữa là trừ hai lần, và
                  RPC sẽ từ chối. Không giải thích thì kế toán đi tìm một
                  phiếu trả họ biết chắc là có. */}
              <p className="text-xs font-semibold leading-snug text-muted-foreground">
                Chỉ hiện phiếu trả ĐÃ hoàn thành, KHÔNG gắn đơn nào, và chưa cấn trừ ở phiếu thu
                khác. Phiếu trả gắn đơn đã tự trừ vào công nợ của đơn đó rồi.
              </p>
              {!customerId ? null : credits === null ? (
                <Skeleton className="h-14" />
              ) : credits.length === 0 ? (
                <p className="py-3 text-center text-sm text-muted-foreground">
                  Khách này không có khoản có nào đang chờ.
                </p>
              ) : (
                credits.map((c) => {
                  const on = pickedCredits.has(c.id)
                  return (
                    <label
                      key={c.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${
                        on ? "border-primary/40 bg-primary/5" : ""
                      }`}
                    >
                      <Checkbox
                        checked={on}
                        onCheckedChange={(v) =>
                          setPickedCredits((p) => {
                            const next = new Set(p)
                            if (v) next.add(c.id)
                            else next.delete(c.id)
                            return next
                          })
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold">
                          Phiếu trả {formatDate(c.created_at)}
                        </span>
                        <span className="mt-0.5 block text-xs font-semibold text-muted-foreground">
                          {c.reason || "—"}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-extrabold tabular-nums text-[#b54708]">
                        −{formatCurrency(Number(c.credit_note_amount || 0))}
                      </span>
                    </label>
                  )
                })
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4 self-start lg:sticky lg:top-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tổng kết</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <Row label="Khoản nợ đã chọn" value={formatCurrency(linesTotal)} />
              <Row label="Cấn trừ phiếu trả" value={`−${formatCurrency(creditsTotal)}`} />
              <div className="h-px bg-border" />
              {/* ⚠ ĐÂY LÀ CON SỐ KHÁCH ĐƯA THẬT, và là con số RPC ghi vào
                  phiếu. Để tổng khoản nợ ở vị trí này là bảo kế toán thu
                  nhiều hơn số khách phải trả. */}
              <div className="flex items-baseline justify-between">
                <span className="font-bold">Khách đưa</span>
                <span className="text-2xl font-extrabold tabular-nums">
                  {formatCurrency(toCollect)}
                </span>
              </div>

              {creditOverflow && (
                <p className="flex items-start gap-1.5 rounded-lg bg-error-container p-2 text-xs font-bold text-on-error-container">
                  <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
                  Cấn trừ lớn hơn số nợ đã chọn. Chọn thêm khoản nợ, hoặc bỏ bớt phiếu trả.
                </p>
              )}
              {overAmount.length > 0 && (
                <p className="flex items-start gap-1.5 rounded-lg bg-error-container p-2 text-xs font-bold text-on-error-container">
                  <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
                  {overAmount.length} khoản đang thu vượt số còn nợ.
                </p>
              )}

              <Button className="mt-2 w-full" onClick={save} disabled={!canSave}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Đang lưu…" : "Lập phiếu thu"}
              </Button>
              {nothingPicked && !!customerId && (
                <p className="text-center text-xs text-muted-foreground">
                  Chưa chọn khoản nào để thu.
                </p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  )
}
