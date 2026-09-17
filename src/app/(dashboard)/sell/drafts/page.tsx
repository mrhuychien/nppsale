"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft, CloudOff } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { listOutbox, removeEntry, type OutboxEntry } from "@/lib/offline/outbox"
import { useAuth } from "@/hooks/use-auth"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/utils"
import { toast } from "@/hooks/use-toast"

interface DraftOrder {
  id: string
  order_code: string
  total: number
  created_at: string
  approval_reason: string | null
  customer: { store_name: string } | null
}

export default function SellDraftsPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [queued, setQueued] = useState<OutboxEntry[]>([])
  const [drafts, setDrafts] = useState<DraftOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<DraftOrder | null>(null)

  const load = useCallback(async () => {
    setQueued(await listOutbox())
    if (!user?.id) return
    const res = await fetchAllForAggregate<DraftOrder>((from, to) =>
      createClient()
        .from("sales_orders")
        .select("id, order_code, total, created_at, approval_reason, customer:customers(store_name)", {
          count: "exact",
        })
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

  const doDelete = async (o: DraftOrder) => {
    const { data, error } = await createClient()
      .from("sales_orders")
      .delete()
      .eq("id", o.id)
      .select("id")
    if (error) {
      toast({ title: "Không xoá được", description: error.message, variant: "destructive" })
      return
    }
    // ⚠ RLS từ chối thì 0 dòng, HTTP 200, không lỗi — "đã xoá" trong khi
    // đơn vẫn nằm đó. Đúng cái bẫy migration 117 sinh ra để bịt.
    if (!data || data.length === 0) {
      toast({
        title: "Không xoá được đơn này",
        description: "Có thể đơn đã được duyệt. Tải lại danh sách để xem trạng thái mới.",
        variant: "destructive",
      })
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
          <span className="text-[15px] font-bold text-on-surface-variant">· chưa gửi duyệt</span>
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
          drafts.map((o) => (
            <div
              key={o.id}
              className="flex flex-col gap-2 rounded-2xl bg-surface-container-lowest p-3 shadow-card"
            >
              <div className="flex justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-extrabold">
                    {o.customer?.store_name ?? "—"}
                  </span>
                  <span className="mt-0.5 block text-xs font-semibold text-on-surface-variant">
                    {o.order_code}
                  </span>
                </span>
                <span className="shrink-0 text-[15px] font-extrabold tabular-data">
                  {formatCurrency(Number(o.total || 0))}
                </span>
              </div>
              {o.approval_reason && (
                <p className="text-xs font-semibold leading-snug text-on-surface-variant">
                  {o.approval_reason}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => router.push(`/orders/${o.id}`)}
                  className="h-11 flex-1 rounded-xl bg-primary text-sm font-extrabold text-on-primary"
                >
                  Mở đơn
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
          ))
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
