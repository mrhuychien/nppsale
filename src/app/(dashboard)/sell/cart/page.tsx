"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Search,
  ScanBarcode,
  Trash2,
  TriangleAlert,
} from "lucide-react"
import { useSellCart } from "@/hooks/use-sell-cart"
import { useSellData } from "@/hooks/use-sell-data"
import { LineEditSheet, Stepper } from "@/components/sell/line-edit-sheet"
import { baseQtyOf, priceViolation } from "@/lib/sell/cart"
import { unitPriceFor, stockInUnit } from "@/lib/sell/pricing"
import { userPriceRulesFrom } from "@/lib/pricing"
import { useAuth } from "@/hooks/use-auth"
import { cn, formatCurrency, formatDate, generateOrderCode } from "@/lib/utils"
import { PAYMENT_TERMS } from "@/lib/constants"
import { createClient } from "@/lib/supabase/client"
import { buildOrderPayload } from "@/lib/sell/create-order"
import { submitSellOrder } from "@/lib/sell/submit"
import { toast } from "@/hooks/use-toast"
import type { ApprovalRules } from "@/types"

export default function SellCartPage() {
  const router = useRouter()
  const { user } = useAuth()
  const cart = useSellCart()
  const { productById, customerById, stockByProduct, loading } = useSellData()

  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [breakdownOpen, setBreakdownOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const customer = customerById(cart.customerId) ?? null
  const groupId = customer?.group_id ?? null

  // Quyền sửa giá theo từng người — NVBH phải được bật riêng.
  const rules = userPriceRulesFrom(user)
  const isSales = user?.role === "sales"
  const canEditPrice = !isSales || rules.allow_price_edit
  const maxIncreasePct = Number(rules.price_edit_max_increase_pct ?? 0)

  const rows = useMemo(
    () =>
      cart.cart.map((l, i) => {
        const p = productById(l.productId)
        const onHand = stockByProduct[l.productId] ?? 0
        // ⚠ Vượt tồn xét trên TỔNG mọi dòng cùng sản phẩm. Hai dòng mỗi
        // dòng 6 thùng trên tồn 10 thì từng dòng đều "hợp lệ".
        const over = baseQtyOf(cart.cart, l.productId) > onHand
        const listNow = p ? unitPriceFor(p, l.unit, groupId) : l.listPrice
        return {
          i,
          line: l,
          product: p,
          over,
          onHand,
          stockText: p ? `tồn ${stockInUnit(p, l.unit, onHand)} ${l.unit}` : "",
          // ⚠ Đổi khách là đổi bảng giá. Dòng đã có trong giỏ giữ giá cũ,
          // nên phải NÓI RA chỗ nào lệch chứ đừng lặng lẽ tính giá cũ.
          staleList: listNow !== l.listPrice,
          listNow,
          priceBad: priceViolation(l, { canEditPrice, maxIncreasePct }) !== null,
        }
      }),
    [cart.cart, productById, stockByProduct, groupId, canEditPrice, maxIncreasePct]
  )

  const hasOver = rows.some((r) => r.over)
  const hasPriceBad = rows.some((r) => r.priceBad)
  const staleCount = rows.filter((r) => r.staleList).length

  const projectedOver = useMemo(() => {
    if (!customer || !customer.credit_limit) return 0
    // Chỉ cảnh báo phần VƯỢT, không hiện "vượt 0đ" cho đơn bình thường.
    return Math.max(0, cart.totals.grandTotal - Number(customer.credit_limit))
  }, [customer, cart.totals.grandTotal])

  const termsSummary = useMemo(() => {
    const t =
      PAYMENT_TERMS.find((x) => x.value === (cart.paymentTerms || customer?.payment_terms))?.label ??
      "Theo điều khoản của khách"
    const giao = cart.expectedDelivery
      ? `giao ${formatDate(cart.expectedDelivery)}`
      : "chưa chọn ngày giao"
    return `${t} · ${giao}`
  }, [cart.paymentTerms, cart.expectedDelivery, customer])


  /**
   * Gửi đơn.
   *
   * ⚠ KHOÁ NỐI SINH TRƯỚC KHI GỬI và không đổi nữa. Mạng chập chờn thì cú
   * gửi có thể lặp lại; `createOrderRecords` dựa vào khoá đó để lần thứ
   * hai không thành đơn thứ hai.
   */
  const submit = async (asDraft: boolean) => {
    if (submitting || !cart.customerId || !user?.id || !user.org_id) return
    setSubmitting(true)
    try {
      const supabase = createClient()
      const online = typeof navigator === "undefined" || navigator.onLine
      const payload = buildOrderPayload({
        clientRequestId:
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        orderCode: generateOrderCode(),
        customerId: cart.customerId,
        customerName: customer?.store_name ?? "",
        paymentTerms: cart.paymentTerms || customer?.payment_terms || "COD",
        expectedDelivery: cart.expectedDelivery || null,
        notes: cart.notes,
        cart: cart.cart,
        totals: cart.totals,
        createdAt: new Date().toISOString(),
        returnReason: cart.returnReason,
        returnLines: cart.returnLines,
      })

      // Ngữ cảnh duyệt chỉ cần khi THẬT SỰ gửi đi và đang có mạng.
      let rules: ApprovalRules | null = null
      let customerDebt = 0
      let customerOverdue = 0
      let repPortfolioDebt = 0
      let contextFailed = false
      if (online && !asDraft) {
        const [rulesRes, recRes, repRes] = await Promise.all([
          supabase
            .from("approval_rules")
            .select(
              "id, org_id, auto_approve_max, manager_approve_max, customer_debt_max, customer_overdue_max, rep_portfolio_debt_max, enforce_credit_limit, notes, is_active, updated_by, created_at, updated_at"
            )
            .eq("org_id", user.org_id)
            .maybeSingle(),
          supabase
            .from("receivables")
            .select("amount, paid, due_date")
            .eq("customer_id", cart.customerId)
            .neq("status", "paid"),
          supabase
            .from("receivables")
            .select("amount, paid")
            .eq("sales_user_id", user.id)
            .neq("status", "paid"),
        ])
        // ⚠ Đọc hỏng thì công nợ về 0, mà 0 nghĩa là "khách không nợ gì" —
        // đúng cái làm mọi ngưỡng đều lọt. Gắn cờ để đơn rơi về chờ duyệt
        // tay thay vì tự duyệt trên một con số chưa bao giờ đọc được.
        contextFailed = !!(rulesRes.error || recRes.error || repRes.error)
        rules = (rulesRes.data as ApprovalRules) ?? null
        const rows = (recRes.data as Array<{ amount: number; paid: number; due_date: string | null }>) || []
        customerDebt = rows.reduce((s, r) => s + (Number(r.amount) - Number(r.paid)), 0)
        const now = Date.now()
        customerOverdue = rows
          .filter((r) => r.due_date && new Date(r.due_date).getTime() < now)
          .reduce((s, r) => s + (Number(r.amount) - Number(r.paid)), 0)
        repPortfolioDebt = ((repRes.data as Array<{ amount: number; paid: number }>) || []).reduce(
          (s, r) => s + (Number(r.amount) - Number(r.paid)),
          0
        )
      }

      const out = await submitSellOrder(
        supabase,
        {
          payload,
          asDraft,
          cart: cart.cart,
          customer: customer ? { id: customer.id, credit_limit: customer.credit_limit } : null,
          rules,
          customerDebt,
          customerOverdue,
          repPortfolioDebt,
          role: user.role,
          online,
          contextFailed,
        },
        { userId: user.id, orgId: user.org_id }
      )

      const status = out.kind === "queued" ? "queued" : out.status
      const reason = out.kind === "queued" ? "" : out.reason
      cart.clear()
      router.replace(
        `/sell/done?code=${encodeURIComponent(out.orderCode)}&status=${status}` +
          (reason ? `&reason=${encodeURIComponent(reason)}` : "")
      )
    } catch (err) {
      toast({
        title: "Không gửi được đơn",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
        variant: "destructive",
      })
      setSubmitting(false)
    }
  }

  const edit = editIdx != null ? cart.cart[editIdx] : null

  return (
    <div className="flex min-h-screen flex-col bg-surface pb-[210px]">
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1.5 pt-0.5">
        <button
          type="button"
          onClick={() => router.push("/sell")}
          aria-label="Quay lại"
          className="tap grid h-11 w-11 place-items-center text-on-surface"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[22px] font-extrabold">
          Đơn hàng{" "}
          <span className="text-[15px] font-bold text-on-surface-variant">
            · {cart.cart.length} mặt hàng
          </span>
        </h1>
      </div>

      <div className="flex shrink-0 gap-2 px-4 pb-2.5">
        <button
          type="button"
          onClick={() => router.push("/sell")}
          className="flex h-11 flex-1 items-center gap-2.5 rounded-xl bg-surface-container px-3 text-left text-base font-semibold text-on-surface-variant"
        >
          <Search className="h-[18px] w-[18px]" />
          <span className="flex-1 truncate">Tên, mã hàng, mã vạch…</span>
        </button>
        <button
          type="button"
          onClick={() => router.push("/sell/scan")}
          aria-label="Quét mã"
          className="tap grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface-container text-on-surface"
        >
          <ScanBarcode className="h-[22px] w-[22px]" />
        </button>
      </div>

      <div className="grid content-start gap-2.5 px-3">
        <button
          type="button"
          onClick={() => router.push("/sell/customer")}
          className="flex items-center gap-3 rounded-2xl bg-surface-container-lowest p-3 text-left shadow-card"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-[15px] font-extrabold text-primary">
            {(customer?.store_name ?? "?").trim().charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-extrabold text-on-surface">
              {customer?.store_name ?? "Chọn khách hàng"}
            </span>
            <span className="mt-0.5 block truncate text-xs font-semibold text-on-surface-variant">
              {customer
                ? customer.credit_limit
                  ? `Hạn mức ${formatCurrency(customer.credit_limit)} · ${customer.group?.name ?? "Bảng giá chung"}`
                  : (customer.group?.name ?? "Bảng giá chung")
                : "Đơn nào cũng phải có khách"}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-on-surface-variant" />
        </button>

        {projectedOver > 0 && (
          <div className="flex items-start gap-2.5 rounded-xl bg-[#fff7e6] px-3 py-2.5 text-[13px] font-semibold leading-snug text-[#7a4b00]">
            <TriangleAlert className="mt-px h-[18px] w-[18px] shrink-0" />
            <span>
              Đơn này đẩy khách <b>vượt hạn mức {formatCurrency(projectedOver)}</b>. Vẫn lưu được
              nhưng sẽ cần duyệt.
            </span>
          </div>
        )}

        {staleCount > 0 && (
          <div className="rounded-xl bg-[#fff7e6] px-3 py-2.5 text-[13px] font-semibold leading-snug text-[#7a4b00]">
            {staleCount} dòng đang giữ giá của bảng giá cũ. Mở từng dòng để lấy giá mới của khách
            này.
          </div>
        )}

        <div className="overflow-hidden rounded-2xl bg-surface-container-lowest shadow-card">
          {cart.cart.length === 0 ? (
            <p className="p-7 text-center text-sm font-semibold text-on-surface-variant">
              {loading
                ? "Đang tải danh mục…"
                : "Chưa có sản phẩm. Gõ tên/mã hàng ở ô tìm kiếm hoặc quét mã để thêm."}
            </p>
          ) : (
            rows.map((r) => (
              <div
                key={`${r.line.productId}|${r.line.unit}`}
                className="flex flex-col gap-2 border-b border-outline-variant/30 p-3 last:border-0"
              >
                <div className="flex items-start gap-1">
                <button
                  type="button"
                  onClick={() => setEditIdx(r.i)}
                  className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold leading-snug">
                      {r.product?.name ?? "Sản phẩm không còn trong danh mục"}{" "}
                      <span className="font-semibold text-on-surface-variant">({r.line.unit})</span>
                    </span>
                    <span className="mt-1 flex flex-wrap gap-x-2.5 gap-y-1 text-xs font-semibold text-on-surface-variant">
                      <span>
                        {formatCurrency(r.line.price)} × {r.line.qty}
                      </span>
                      {r.over && (
                        <span className="font-extrabold text-error">Vượt tồn ({r.stockText})</span>
                      )}
                      {r.priceBad && <span className="font-extrabold text-error">Giá ngoài hạn mức</span>}
                      {r.line.price !== r.line.listPrice && !r.priceBad && (
                        <span className="rounded-md bg-primary/10 px-1.5 py-px font-bold text-primary">
                          Giá sửa
                        </span>
                      )}
                      {r.line.note && <span className="italic">“{r.line.note}”</span>}
                    </span>
                  </span>
                </button>
                {/* ⚠ NÚT XOÁ LUÔN CÓ MẶT, không nấp sau nút − ở số 1: muốn
                    bỏ một dòng đang để 8 thùng thì không phải bấm − bảy
                    lần mới thấy nó. */}
                <button
                  type="button"
                  onClick={() => cart.setQty(r.i, 0)}
                  aria-label={`Xoá ${r.product?.name ?? "dòng"}`}
                  className="tap grid h-11 w-11 shrink-0 place-items-center rounded-xl text-on-surface-variant active:bg-error/10 active:text-error"
                >
                  <Trash2 className="h-[18px] w-[18px]" />
                </button>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[17px] font-extrabold tabular-data">
                    {formatCurrency(r.line.qty * r.line.price)}
                  </span>
                  <div className="w-[164px]">
                    <Stepper qty={r.line.qty} onChange={(q) => cart.setQty(r.i, q)} />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <button
          type="button"
          onClick={() => router.push("/sell/returns")}
          className="flex min-h-14 items-center gap-2.5 rounded-2xl bg-surface-container-lowest px-3.5 text-left shadow-card"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-extrabold">Hàng trả / đổi kèm đơn</span>
            <span className="mt-px block truncate text-xs font-semibold text-on-surface-variant">
              {cart.returnLines.length
                ? `${cart.returnLines.length} dòng · trừ ${formatCurrency(cart.returnCredit)}`
                : "Chưa có"}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-on-surface-variant" />
        </button>

        <div className="rounded-2xl bg-surface-container-lowest px-3 py-2 shadow-card">
          <input
            value={cart.notes}
            onChange={(e) => cart.setNotes(e.target.value)}
            placeholder="Ghi chú đơn (giao trước 10h, để hàng sau quầy…)"
            className="h-10 w-full border-0 bg-transparent text-sm font-semibold outline-none"
          />
        </div>

        <button
          type="button"
          onClick={() => router.push("/sell/terms")}
          className="flex min-h-14 items-center gap-2.5 rounded-2xl bg-surface-container-lowest px-3.5 text-left shadow-card"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-extrabold">Điều khoản &amp; giao hàng</span>
            <span className="mt-px block truncate text-xs font-semibold text-on-surface-variant">
              {termsSummary}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-on-surface-variant" />
        </button>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 flex flex-col gap-2.5 border-t border-outline-variant/60 bg-surface-container-lowest/95 px-4 pb-[calc(var(--safe-b)+16px)] pt-2.5 backdrop-blur-xl">
        {breakdownOpen && (
          <div className="flex flex-col gap-1.5 border-b border-outline-variant/40 pb-1.5 text-[13px] font-semibold text-on-surface-variant">
            <Row label="Tạm tính" value={formatCurrency(cart.totals.subtotal)} />
            {cart.totals.discount > 0 && (
              <Row label="Chiết khấu" value={`−${formatCurrency(cart.totals.discount)}`} error />
            )}
            <Row label="VAT" value={formatCurrency(cart.totals.vat)} />
            {cart.totals.returnCredit > 0 && (
              <Row label="Trừ hàng trả" value={`−${formatCurrency(cart.totals.returnCredit)}`} />
            )}
            <button
              type="button"
              onClick={() => {
                cart.clear()
                router.push("/sell")
              }}
              className="h-8 self-start text-[13px] font-extrabold text-error"
            >
              Huỷ đơn
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setBreakdownOpen((v) => !v)}
          aria-expanded={breakdownOpen}
          className="flex min-h-8 w-full items-center justify-between"
        >
          <span className="flex items-center gap-2 text-[15px] font-extrabold">
            Tổng tiền
            <span className="grid h-[22px] min-w-[22px] place-items-center rounded-full border-[1.5px] border-primary px-1 text-xs text-primary">
              {cart.cart.length}
            </span>
            {breakdownOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-on-surface-variant" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5 text-on-surface-variant" />
            )}
          </span>
          <span className="text-[22px] font-extrabold tabular-data">
            {formatCurrency(cart.totals.grandTotal)}
          </span>
        </button>
        <div className="flex gap-2.5">
          <button
            type="button"
            disabled={submitting || !cart.customerId || hasPriceBad}
            onClick={() => submit(true)}
            className="h-13 flex-1 rounded-2xl border-[1.5px] border-primary bg-surface-container-lowest py-3.5 text-base font-extrabold text-primary disabled:opacity-40"
          >
            Lưu tạm
          </button>
          <button
            type="button"
            disabled={submitting || cart.cart.length === 0 || !cart.customerId || hasOver || hasPriceBad}
            onClick={() => submit(false)}
            className="h-13 flex-[1.3] rounded-2xl bg-primary py-3.5 text-base font-extrabold text-on-primary disabled:opacity-40"
          >
            {submitting
              ? "Đang gửi…"
              : !cart.customerId
              ? "Chọn khách"
              : hasOver
                ? "Vượt tồn kho"
                : hasPriceBad
                  ? "Giá ngoài hạn mức"
                  : "Đặt hàng"}
          </button>
        </div>
      </div>

      <LineEditSheet
        line={edit}
        product={edit ? productById(edit.productId) : undefined}
        groupId={groupId}
        canEditPrice={canEditPrice}
        maxIncreasePct={maxIncreasePct}
        baseOnHand={edit ? (stockByProduct[edit.productId] ?? 0) : 0}
        onPatch={(patch) => editIdx != null && cart.patchLine(editIdx, patch)}
        onRemove={() => {
          if (editIdx != null) cart.setQty(editIdx, 0)
          setEditIdx(null)
        }}
        onClose={() => setEditIdx(null)}
      />
    </div>
  )
}

function Row({ label, value, error }: { label: string; value: string; error?: boolean }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className={cn("tabular-data", error ? "text-error" : "text-on-surface")}>{value}</span>
    </div>
  )
}
