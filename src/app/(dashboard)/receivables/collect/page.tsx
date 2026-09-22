"use client"

import { useEffect, useMemo, useState } from "react"
import { totalRemaining } from "@/lib/receivables/credit"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useOrg } from "@/hooks/use-org"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MoneyInput } from "@/components/ui/money-input"
import { StickyActionBar } from "@/components/ui/sticky-action-bar"
import { AlertTriangle, CheckCircle2, Printer } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { useToast } from "@/hooks/use-toast"
import { PAYMENT_METHODS, labelPaymentMethod } from "@/lib/constants"
import { formatCurrency, formatDate } from "@/lib/utils"
import { CreditCard } from "lucide-react"
import { PaymentReceiptTT200 } from "@/components/printing/payment-receipt-tt200"
import type { Receivable } from "@/types"
import { errorMessage } from "@/lib/errors"
import { createCashReceipt } from "@/lib/finance/cash-receipt"

/**
 * Nhãn hình thức thu.
 *
 * ⚠ TRA Ở BẢNG RỘNG, KHÔNG TRA Ở DANH SÁCH CHỌN. `PAYMENT_METHODS` chỉ
 * có ba giá trị người dùng chọn được; màn này còn ĐỌC LÊN các dòng do
 * RPC ghi (`return_credit`, `credit_applied`), và tra ở danh sách hẹp là
 * in ra chữ tiếng Anh giữa bảng.
 */
const labelMethod = (v: string) =>
  labelPaymentMethod(v)

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
  /**
   * M5.1 mục 7 — sau khi thu xong KHÔNG điều hướng ngay.
   *
   * VÌ SAO: NVBH vừa cầm tiền của khách, và khách đang đứng đó chờ xem
   * "đã ghi chưa, còn nợ bao nhiêu". Đá thẳng về danh sách rồi hiện một
   * toast 3 giây là bắt họ vừa cất tiền vừa đọc. Còn phiếu thu thì không
   * có đường nào in được nữa ngoài mở lại màn khác.
   *
   * `paymentId` là id THẬT của dòng payments vừa ghi — số phiếu in ra
   * được suy ra từ nó chứ không phải một dãy số tự bịa (xem receiptNo).
   */
  const [done, setDone] = useState<{
    receiptId: string
    receiptCode: string
    amount: number
    method: string
    storeName: string
    remainingAfter: number
    at: Date
  } | null>(null)
  const { org } = useOrg()
  const orgName = org?.name ?? ""
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    async function fetchData() {
      setFetching(true)
      let query = supabase
        .from("receivables")
        .select("id, amount, paid, due_date, customer:customers(store_name)")
        .neq("status", "paid")
        .order("due_date")

      if (customerIdParam) {
        query = query.eq("customer_id", customerIdParam)
      }

      const { data , error: qErr } = await query
      if (qErr) console.error("[receivables/collect] truy vấn lỗi:", qErr.message)
      const list = (data as unknown as Receivable[]) || []
      setReceivables(list)

      if (customerIdParam) {
        if (list.length > 0) {
          setCustomerName(list[0].customer?.store_name || null)
        } else {
          const { data: customerData, error: customerDataErr } = await supabase
            .from("customers")
            .select("store_name")
            .eq("id", customerIdParam)
            .single()
          if (customerDataErr) console.error("[receivables/collect] truy vấn lỗi:", customerDataErr.message)
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
  const amountNum = parseInt(amount || "0", 10) || 0
  const afterCollect = remaining - amountNum
  const overCollect = amountNum > remaining
  // Làm tròn XUỐNG tới trăm nghìn — khách trả chẵn là chuyện thường.
  const roundedDown = Math.floor(remaining / 100_000) * 100_000

  /**
   * Vì sao KHÔNG cho bấm. `max` trên <input type="number"> không chặn được
   * khi gõ tay — trình duyệt chỉ dùng nó cho nút tăng/giảm. Chặn phải nằm
   * ở đây và ở handleSubmit, và phải NÓI RA lý do (SKILL.md §4: disable +
   * tooltip dễ tìm hơn là ẩn nút).
   */
  const submitBlockReason = !selectedId
    ? "Chọn khoản nợ"
    : amountNum <= 0
      ? "Nhập số tiền"
      : overCollect
        ? "Vượt số còn nợ"
        : null
  const canSubmit = !loading && !submitBlockReason

  if (authLoading) return <Skeleton className="h-96" />

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedId || !amount) return
    // Chặn LẠI ở đây, không chỉ ở nút: Enter trên bàn phím ảo gửi form mà
    // không đi qua nút, và ghi thừa tiền vào công nợ là sai sổ.
    if (amountNum <= 0 || amountNum > remaining) {
      toast({
        title: "Số tiền không hợp lệ",
        description: `Chỉ thu được tối đa ${formatCurrency(remaining)}.`,
        variant: "destructive",
      })
      return
    }
    setLoading(true)

    try {
      /**
       * ⚠ LẬP PHIẾU THU QUA RPC, KHÔNG GHI THẲNG HAI BẢNG.
       *
       * Bản trước ghi `payments` rồi `UPDATE receivables` ngay tại đây,
       * và chú thích của chính nó đã đoán đúng hậu quả: "tiền đã thu
       * nhưng công nợ vẫn nguyên → khách bị đòi lại số đã trả". Nó gác
       * bằng `.throwOnError()`, mà `.throwOnError()` chỉ ném khi CÓ
       * `error` — còn RLS từ chối thì trả 0 dòng và KHÔNG có lỗi.
       *
       * ⚠ VÀ ĐÚNG NVBH LÀ NGƯỜI VẤP. Chính sách cho `sales`/`driver`
       *   CHÈN `payments` nhưng chỉ cho `owner`/`accountant` SỬA
       *   `receivables`. Đã đo trên Postgres 16: NVBH ghi phiếu thu
       *   100.000 → được; trừ vào công nợ → 0 dòng, không lỗi; công nợ
       *   vẫn 800.000/0/open còn payments đã có 100.000.
       *
       * `create_cash_receipt` là `SECURITY DEFINER`, làm cả hai việc
       * trong MỘT giao dịch, gác bằng quyền `receivables.create` mà NVBH
       * có. Đã đo lại bằng chính NVBH: paid 0 → 200.000, trạng thái
       * `partial`, và thu vượt số còn nợ bị chặn kèm câu đọc được.
       */
      const daTraHet = amountNum >= remaining
      const receiptId = await createCashReceipt(supabase, {
        customer_id: selected?.customer_id ?? customerIdParam ?? "",
        method,
        lines: [{ receivable_id: selectedId, amount: amountNum }],
      })

      /* ⚠ ĐỌC HỎNG KHÔNG ĐƯỢC LÀM HỎNG VIỆC ĐÃ XONG. Tiền đã ghi trong
         một giao dịch rồi; không đọc ra mã thì hiện tạm theo id chứ
         đừng ném, vì ném ở đây là người dùng tưởng chưa thu được. */
      const { data: rcRow } = await supabase
        .from("cash_receipts")
        .select("receipt_code")
        .eq("id", receiptId)
        .maybeSingle()

      // Notify the sales rep who owns the receivable (if different from collector)
      if (selected && user?.org_id) {
        const { data: recFull, error: recFullErr } = await supabase
          .from("receivables")
          .select("sales_user_id, customer:customers(store_name)")
          .eq("id", selectedId)
          .maybeSingle()
        if (recFullErr) console.error("[receivables/collect] truy vấn lỗi:", recFullErr.message)
        const repId = (recFull as { sales_user_id?: string } | null)?.sales_user_id
        const storeName = (recFull as { customer?: { store_name?: string } } | null)?.customer?.store_name
        if (repId && repId !== user.id) {
          const { createNotification } = await import("@/lib/notifications")
          createNotification(supabase, {
            orgId: user.org_id,
            userId: repId,
            type: "payment_received",
            title: `Đã thu ${formatCurrency(amountNum)}`,
            body: `${storeName || "Khách hàng"}${daTraHet ? " — đã thanh toán đủ" : ""}`,
            linkUrl: `/receivables/${selectedId}`,
            metadata: { receivable_id: selectedId, amount: amountNum, method },
          })
        }
      }

      toast({ title: `Đã thu ${formatCurrency(amountNum)}` })
      // M5.1 mục 7 — dừng lại ở màn xác nhận, KHÔNG router.push ngay.
      setDone({
        receiptId,
        receiptCode:
          (rcRow as { receipt_code?: string } | null)?.receipt_code ||
          `PT-${receiptId.slice(0, 8).toUpperCase()}`,
        amount: amountNum,
        method,
        storeName: selected?.customer?.store_name || customerName || "Khách hàng",
        remainingAfter: Math.max(0, remaining - amountNum),
        at: new Date(),
      })
    } catch (err: unknown) {
      const message = errorMessage(err)
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  const pageTitle = customerIdParam && customerName
    ? `Thu tiền: ${customerName}`
    : "Thu tiền tại hiện trường"
  const backHref = customerIdParam ? `/customers/${customerIdParam}` : "/receivables"

  // ⚠ Kẹp từng dòng: từ Q11 một dòng có thể đã thu dư, và trừ trần trụi
  // thì phần dư xoá bớt nợ của dòng khác — tổng phải thu nhỏ hơn thực tế.
  const totalOutstanding = totalRemaining(receivables)

  /** Rời màn — đúng chỗ trước đây gọi thẳng sau khi ghi xong. */
  const finish = () => {
    if (customerIdParam) router.push(`/customers/${customerIdParam}`)
    else router.push("/receivables")
  }

  /**
   * ⚠ SỐ PHIẾU THU NAY LÀ SỐ THẬT, không còn suy ra từ id.
   *
   * Bản trước suy số từ id dòng `payments` và ghi rõ lý do: màn này ghi
   * vào `payments` chứ không lập `cash_receipts`, nên in ra một số thuộc
   * dải phiếu thu của kế toán sẽ đụng số thật. Từ khi màn này đi qua
   * `create_cash_receipt` thì nó LẬP phiếu thu thật — lý do ấy hết đúng,
   * và in một số bịa bên cạnh một phiếu thu có thật mới là thứ đụng nhau.
   */
  const receiptNo = done ? done.receiptCode : ""

  const printReceipt = () => {
    const html = document.documentElement
    html.setAttribute("data-print-mode", "receipt-tt200")
    requestAnimationFrame(() => {
      window.print()
      setTimeout(() => html.removeAttribute("data-print-mode"), 200)
    })
  }

  return (
    <div className="space-y-4 pb-nav-action lg:pb-0">
      {/* Mọi thứ trên màn nằm trong `no-print`: @media print chỉ ẩn sẵn
          aside/header/nav, phần thân trang vẫn in ra. Không bọc thì tờ
          phiếu thu in kèm cả thẻ xác nhận và hai cái nút. */}
      <div className="space-y-4 no-print">
      <PageHeader
        title={pageTitle}
        description={customerIdParam
          ? `${receivables.length} công nợ • Tổng còn: ${formatCurrency(totalOutstanding)}`
          : undefined}
        backHref={backHref}
      />

      {done ? (
        <>
          <Card className="border-tertiary/40">
            <CardContent className="space-y-4 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-8 w-8 shrink-0 text-tertiary" />
                <div className="min-w-0">
                  <p className="text-lg font-bold text-tertiary">
                    Đã thu {formatCurrency(done.amount)}
                  </p>
                  <p className="truncate text-sm text-on-surface-variant">
                    {done.storeName} • {labelMethod(done.method)} • {formatDate(done.at)}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5 rounded-xl bg-surface-container p-3 text-sm">
                <div className="flex items-baseline justify-between">
                  <span className="text-on-surface-variant">Số phiếu</span>
                  <span className="font-mono font-semibold">{receiptNo}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-on-surface-variant">Còn nợ khoản này</span>
                  <span
                    className={`text-lg font-bold tabular-data ${
                      done.remainingAfter > 0 ? "text-error" : "text-tertiary"
                    }`}
                  >
                    {formatCurrency(done.remainingAfter)}
                  </span>
                </div>
              </div>

              {/* In là hành động PHỤ nhưng phải thấy được ngay: khách còn
                  đứng đó. Để trong thân thẻ, full width, 44px. */}
              <Button
                type="button"
                variant="outline"
                className="tap h-12 w-full"
                onClick={printReceipt}
              >
                <Printer className="mr-2 h-4 w-4" /> In phiếu thu
              </Button>
            </CardContent>
          </Card>

          <div className="hidden lg:flex justify-end">
            <Button onClick={finish}>Xong</Button>
          </div>
          <StickyActionBar>
            <Button className="h-12 flex-1" onClick={finish}>
              Xong
            </Button>
          </StickyActionBar>
        </>
      ) : fetching ? (
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
              {/* CHỌN CÔNG NỢ BẰNG THẺ, không bằng <Select>.
                  Select chỉ hiện một dòng chữ dài và bị cắt trên điện
                  thoại — NVBH đang cầm tiền của khách, không được đoán
                  mình chọn đúng khoản chưa. */}
              <div className="space-y-2">
                <Label>Công nợ *</Label>
                <div className="space-y-2">
                  {receivables.map((r) => {
                    const rem = r.amount - r.paid
                    const active = selectedId === r.id
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setSelectedId(r.id)}
                        aria-pressed={active}
                        className={`flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors ${
                          active
                            ? "border-primary bg-primary-fixed/40"
                            : "border-outline-variant bg-surface-container-lowest"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-semibold text-on-surface">
                            {r.customer?.store_name || "Khách hàng"}
                          </p>
                          <p className="text-xs text-on-surface-variant">
                            Hạn {r.due_date ? formatDate(r.due_date) : "không đặt"}
                          </p>
                        </div>
                        <span className="shrink-0 text-[15px] font-bold tabular-data text-error">
                          {formatCurrency(rem)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Hình thức *</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Số tiền thu *</Label>
                {/* MoneyInput chứ KHÔNG <Input type="number">: type=number
                    không nhóm hàng nghìn, NVBH gõ 12400000 và không đếm
                    được số 0. Đây là con số quan trọng nhất màn hình nên
                    để to hẳn. */}
                <MoneyInput
                  value={amountNum}
                  onChange={(v) => setAmount(v ? String(v) : "")}
                  inputClassName="h-14 text-right text-2xl font-bold"
                  placeholder="0"
                />

                {selected && (
                  <>
                    {/* Chip số tiền nhanh, mỗi chip 44px. */}
                    <div className="row-scroll pt-1">
                      <button
                        type="button"
                        onClick={() => setAmount(String(remaining))}
                        className="tap shrink-0 rounded-full border border-primary bg-primary/[0.08] px-3 text-[13px] font-semibold text-primary"
                      >
                        Thu đủ ({formatCurrency(remaining)})
                      </button>
                      <button
                        type="button"
                        onClick={() => setAmount(String(Math.round(remaining / 2)))}
                        className="tap shrink-0 rounded-full border border-outline-variant px-3 text-[13px] font-semibold text-on-surface-variant"
                      >
                        50%
                      </button>
                      {roundedDown > 0 && roundedDown < remaining && (
                        <button
                          type="button"
                          onClick={() => setAmount(String(roundedDown))}
                          className="tap shrink-0 rounded-full border border-outline-variant px-3 text-[13px] font-semibold text-on-surface-variant"
                        >
                          Làm tròn {formatCurrency(roundedDown)}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setAmount("")}
                        className="tap shrink-0 rounded-full border border-outline-variant px-3 text-[13px] font-semibold text-on-surface-variant"
                      >
                        Xoá
                      </button>
                    </div>

                    {/* DƯ NỢ SAU KHI THU — trước đây chỉ hiện nợ TRƯỚC khi
                        thu, NVBH phải tự trừ nhẩm ngay lúc đang đếm tiền. */}
                    <div className="flex items-baseline justify-between rounded-lg bg-surface-container-low px-3 py-2">
                      <span className="text-sm text-on-surface-variant">Còn nợ sau khi thu</span>
                      <span
                        className={`text-[15px] font-bold tabular-data ${
                          afterCollect > 0 ? "text-error" : "text-tertiary"
                        }`}
                      >
                        {formatCurrency(Math.max(0, afterCollect))}
                      </span>
                    </div>

                    {overCollect && (
                      <p className="flex items-start gap-1.5 text-[12px] font-semibold text-error">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        Số tiền thu vượt quá số còn nợ {formatCurrency(remaining)}.
                      </p>
                    )}
                  </>
                )}
              </div>

              <div className="hidden lg:flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => router.back()}>Hủy</Button>
                <Button type="submit" disabled={!canSubmit} title={submitBlockReason || undefined}>
                  {loading ? "Đang xử lý..." : "Xác nhận thu tiền"}
                </Button>
              </div>

              {/* Mobile: nút xác nhận vào thanh dính đáy. Nút "Huỷ" bỏ —
                  app bar đã có nút back, và ở màn đang cầm tiền thì hai
                  nút cạnh nhau là mời bấm nhầm. */}
              <StickyActionBar>
                <Button
                  type="submit"
                  className="h-12 flex-1"
                  disabled={!canSubmit}
                  title={submitBlockReason || undefined}
                >
                  {loading ? "Đang xử lý..." : submitBlockReason || "Xác nhận thu tiền"}
                </Button>
              </StickyActionBar>
            </form>
          </CardContent>
        </Card>
      )}
      </div>

      {/* Chỉ hiện khi in — dùng lại đúng mẫu 01-TT của màn nộp tiền
          chuyến giao, không dựng mẫu thứ hai để lệch nhau. */}
      {done && (
        <div className="print-receipt-tt200-only">
          <PaymentReceiptTT200
            organizationName={orgName || "—"}
            receiptNo={receiptNo}
            date={done.at}
            payerName={done.storeName}
            reason={`Thu tiền công nợ ${done.storeName}`}
            amount={done.amount}
          />
        </div>
      )}
    </div>
  )
}
