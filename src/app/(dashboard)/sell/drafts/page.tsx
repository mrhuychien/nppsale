"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft, CloudOff, Send } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { listOutbox, removeEntry, type OutboxEntry } from "@/lib/offline/outbox"
import { useAuth } from "@/hooks/use-auth"
import { deleteOrder } from "@/lib/orders/delete"
import { errorMessage } from "@/lib/errors"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/utils"
import { toast } from "@/hooks/use-toast"
import { loadApprovalContext } from "@/lib/sell/approval-context"
import { sendOrder, grossFromSavedLines } from "@/lib/sell/send-order"
import { evaluateApproval } from "@/lib/approval"

interface DraftOrder {
  id: string
  order_code: string
  customer_id: string
  subtotal: number
  total: number
  created_at: string
  approval_reason: string | null
  customer: { store_name: string; credit_limit: number | null } | null
}

export default function SellDraftsPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [queued, setQueued] = useState<OutboxEntry[]>([])
  const [drafts, setDrafts] = useState<DraftOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<DraftOrder | null>(null)
  const [sendingId, setSendingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setQueued(await listOutbox())
    if (!user?.id) return
    const res = await fetchAllForAggregate<DraftOrder>((from, to) =>
      createClient()
        .from("sales_orders")
        .select(
          "id, order_code, customer_id, subtotal, total, created_at, approval_reason, customer:customers(store_name, credit_limit)",
          { count: "exact" }
        )
        .eq("sales_user_id", user.id)
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .range(from, to)
    )
    // ⚠ Đọc hỏng mà hiện "Chưa có đơn tạm" là nói dối: nhân viên tưởng đơn
    // mình lưu đã mất và ngồi soạn lại từ đầu.
    setLoadError(res.error ?? null)
    setDrafts(res.rows)
    setLoading(false)
  }, [user?.id])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Gửi một đơn nháp đi duyệt.
   *
   * ⚠ PHẢI ĐỌC LẠI DÒNG HÀNG, không dùng mỗi cột `total`. Quy tắc chiết
   * khấu sâu cần giá TRƯỚC chiết khấu, mà con số đó không nằm trên đầu đơn
   * — thiếu nó thì đơn cho không hàng (sửa giá về 0) đi thẳng qua mọi
   * ngưỡng và TỰ ĐỘNG DUYỆT.
   */
  const doSend = async (o: DraftOrder) => {
    if (sendingId || !user?.id || !user.org_id) return
    setSendingId(o.id)
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("sales_order_lines")
        .select("line_discount")
        .eq("order_id", o.id)
      // ⚠ Đọc hỏng thì DỪNG. Coi như đơn không có dòng nào là chiết khấu
      // bằng 0, và khi đó quy tắc chiết khấu sâu không chạy.
      if (error) throw new Error(`Không đọc được dòng hàng của đơn: ${error.message}`)
      const rows = (data as Array<{ line_discount: number | null }>) ?? []
      if (rows.length === 0) {
        throw new Error("Đơn chưa có mặt hàng nào. Mở đơn ra thêm hàng rồi gửi.")
      }

      const ctx = await loadApprovalContext(supabase, {
        orgId: user.org_id,
        customerId: o.customer_id,
        salesUserId: user.id,
      })
      // Bộ quy tắc vẫn chạy, nhưng chỉ để ghi CẢNH BÁO cho NPP đọc trước
      // khi bấm Xuất hàng — nó không chặn ai và không quyết trạng thái.
      const subtotal = Number(o.subtotal || 0)
      const warn = ctx.failed
        ? "Không đọc được công nợ / quy tắc — NPP kiểm tay trước khi xuất hàng."
        : evaluateApproval(ctx.rules, {
            orderTotal: Number(o.total || 0),
            grossBeforeDiscount: grossFromSavedLines(subtotal, rows),
            discountAmount: Math.max(0, grossFromSavedLines(subtotal, rows) - subtotal),
            customer: o.customer
              ? { id: o.customer_id, credit_limit: Number(o.customer.credit_limit || 0) }
              : null,
            customerDebt: ctx.customerDebt,
            customerOverdue: ctx.customerOverdue,
            repPortfolioDebt: ctx.repPortfolioDebt,
            role: user.role,
          }).reason

      await sendOrder(supabase, { orderId: o.id, reason: warn })
      toast({
        title: `Đã gửi đơn ${o.order_code}`,
        description: warn || undefined,
      })
      void load()
    } catch (err) {
      toast({
        title: "Không gửi được đơn",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
        variant: "destructive",
      })
    } finally {
      setSendingId(null)
    }
  }

  const doDelete = async (o: DraftOrder) => {
    // ⚠ Một chỗ xoá cho cả ba màn — xem `deleteOrder`: RLS từ chối thì 0
    // dòng, HTTP 200, không lỗi, và hàm đó ném lỗi thay vì báo "đã xoá".
    try {
      await deleteOrder(createClient(), o.id)
    } catch (err) {
      toast({ title: "Không xoá được đơn này", description: errorMessage(err), variant: "destructive" })
      return
    }
    toast({ title: `Đã xoá đơn ${o.order_code}` })
    void load()
  }

  const isEmpty = !loading && queued.length === 0 && drafts.length === 0

  return (
    <div className="flex min-h-screen flex-col bg-surface pb-nav">
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1.5 pt-0.5">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Quay lại"
          className="tap grid h-11 w-11 place-items-center text-on-surface"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <h1 className="flex-1 text-[22px] font-extrabold">
          Đơn tạm{" "}
          <span className="text-[15px] font-bold text-on-surface-variant">
            · chưa gửi &amp; chờ duyệt
          </span>
        </h1>
      </div>

      <div className="grid content-start gap-2 px-3 pt-1">
        {loadError && (
          <div className="rounded-xl bg-error/10 px-3 py-2.5 text-[13px] font-semibold text-error">
            Không đọc được danh sách đơn tạm: {loadError}
          </div>
        )}

        {/* Đơn đang chờ mạng nằm TRÊN CÙNG: chúng chưa tồn tại trên server,
            nên nếu người dùng không thấy, họ sẽ soạn lại lần nữa. */}
        {queued.map((q) => (
          <div
            key={q.id}
            className="flex flex-col gap-2 rounded-2xl bg-surface-container-lowest p-3 shadow-card"
          >
            <div className="flex justify-between gap-2">
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-[15px] font-extrabold">
                  <CloudOff className="h-4 w-4 shrink-0 text-[#8a5a00]" />
                  <span className="truncate">{q.payload.meta.customerName || "—"}</span>
                </span>
                <span className="mt-0.5 block text-xs font-semibold text-on-surface-variant">
                  {q.payload.meta.lineCount} mặt hàng · chờ đẩy lên khi có mạng
                </span>
              </span>
              <span className="shrink-0 text-[15px] font-extrabold tabular-data">
                {formatCurrency(q.payload.meta.total)}
              </span>
            </div>
            <button
              type="button"
              onClick={async () => {
                await removeEntry(q.id)
                toast({ title: "Đã bỏ đơn khỏi hàng chờ" })
                void load()
              }}
              className="h-10 self-start rounded-xl border-[1.5px] border-outline-variant px-3.5 text-sm font-extrabold text-error"
            >
              Bỏ khỏi hàng chờ
            </button>
          </div>
        ))}

        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)
        ) : isEmpty ? (
          <p className="py-10 text-center text-sm font-semibold text-on-surface-variant">
            Chưa có đơn tạm nào.
          </p>
        ) : (
          drafts.map((o) => {
            // Màn này chỉ còn đơn NHÁP: gửi đi là nó thành phiếu tạm và
            // rời khỏi đây, sang danh sách đơn của tôi.
            return (
            <div
              key={o.id}
              className="flex flex-col gap-2 rounded-2xl bg-surface-container-lowest p-3 shadow-card"
            >
              <div className="flex justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-extrabold">
                    {o.customer?.store_name ?? "—"}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-on-surface-variant">
                    <span>{o.order_code}</span>
                    <span className="rounded-md bg-surface-container px-1.5 py-px font-extrabold">
                      Chưa gửi
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-[15px] font-extrabold tabular-data">
                  {formatCurrency(Number(o.total || 0))}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={sendingId === o.id}
                  onClick={() => void doSend(o)}
                  className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary text-sm font-extrabold text-on-primary disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                  {sendingId === o.id ? "Đang gửi…" : "Gửi đơn"}
                </button>
                {/* ⚠ "Sửa" mở lại ĐÚNG màn bán hàng đã dùng lúc tạo, không
                    phải màn chi tiết đơn — một việc thì một cách làm. */}
                <button
                  type="button"
                  onClick={() => router.push(`/sell/edit/${o.id}`)}
                  className="h-11 rounded-xl border-[1.5px] border-outline-variant px-3.5 text-sm font-extrabold text-on-surface"
                >
                  Sửa đơn
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(o)}
                  className="h-11 rounded-xl border-[1.5px] border-outline-variant px-3.5 text-sm font-extrabold text-error"
                >
                  Xoá
                </button>
              </div>
            </div>
            )
          })
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title="Xoá đơn tạm?"
        description={`Đơn ${confirmDelete?.order_code ?? ""} sẽ bị xoá hẳn, không khôi phục được.`}
        confirmLabel="Xoá đơn"
        variant="destructive"
        onConfirm={async () => {
          const o = confirmDelete
          setConfirmDelete(null)
          if (o) await doDelete(o)
        }}
      />
    </div>
  )
}
