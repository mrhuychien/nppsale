"use client"

/**
 * XEM NHANH THÔNG TIN KHÁCH — modal mở từ tên khách ở hai màn chi tiết.
 *
 * Chủ nhà chốt: bấm khách hàng ở chi tiết đơn / chi tiết hóa đơn thì ra
 * modal thông tin chi tiết, không chuyển trang.
 *
 * ⚠ VÌ SAO KHÔNG CHUYỂN TRANG. Người đang xem một đơn chỉ muốn kiểm một
 * điều — khách này còn nợ bao nhiêu, hạn mức bao nhiêu, số điện thoại là
 * gì. Đẩy họ sang hồ sơ khách là mất chỗ đang đứng, và đường về là nút
 * Back của trình duyệt, thứ hay đưa họ ra khỏi hẳn màn đơn.
 *
 * ⚠ ĐỌC KHI MỞ, KHÔNG ĐỌC SẴN. Modal này gắn vào mọi màn chi tiết đơn và
 * hóa đơn; đọc sẵn là mỗi lần mở một cái đơn lại thêm hai truy vấn cho
 * một khung người dùng có thể không bấm tới.
 *
 * ⚠ CÔNG NỢ PHẢI KÉO QUA `fetchAllForAggregate`. Khách lâu năm vượt 1000
 * dòng công nợ là PostgREST cắt bớt TRONG IM LẶNG, và con số nợ hiện ra
 * THIẾU — đúng con số người ta mở modal này ra để xem.
 */

import { useEffect, useState } from "react"
import Link from "@/components/ui/link"
import { createClient } from "@/lib/supabase/client"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/utils"
import { fullCustomerAddress } from "@/lib/customers/address"
import { totalRemaining, type ReceivableAmounts } from "@/lib/receivables/credit"
import { PAYMENT_TERMS } from "@/lib/constants"
import { errorMessage } from "@/lib/errors"
import { Phone, ExternalLink } from "lucide-react"

interface CustomerRow {
  id: string
  store_name: string
  owner_name: string | null
  phone: string | null
  address: string | null
  ward: string | null
  district: string | null
  province: string | null
  channel: string | null
  credit_limit: number | null
  payment_terms: string | null
  status: string | null
  group?: { name?: string | null } | null
}

const CHANNEL_LABEL: Record<string, string> = {
  GT: "Tạp hoá (GT)",
  MT: "Siêu thị (MT)",
  HORECA: "Nhà hàng / quán (HORECA)",
}

const STATUS_LABEL: Record<string, { label: string; variant: "success" | "warning" | "danger" }> = {
  active: { label: "Đang hoạt động", variant: "success" },
  suspended: { label: "Tạm ngưng", variant: "warning" },
  locked: { label: "Đã khoá", variant: "danger" },
}

export function CustomerQuickView({
  customerId,
  onClose,
}: {
  /** `null` = đóng. Đổi mã khách thì đọc lại. */
  customerId: string | null
  onClose: () => void
}) {
  const [row, setRow] = useState<CustomerRow | null>(null)
  const [debt, setDebt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!customerId) return
    let cancelled = false
    setRow(null)
    setDebt(null)
    setError(null)
    const supabase = createClient()
    ;(async () => {
      const [cusRes, debtRes] = await Promise.all([
        supabase
          .from("customers")
          .select(
            "id, store_name, owner_name, phone, address, ward, district, province, channel, credit_limit, payment_terms, status, group:customer_groups(name)"
          )
          .eq("id", customerId)
          .maybeSingle(),
        fetchAllForAggregate<ReceivableAmounts>((from, to) =>
          supabase
            .from("receivables")
            .select("amount, paid", { count: "exact" })
            .eq("customer_id", customerId)
            .neq("status", "paid")
            .order("id")
            .range(from, to)
        ),
      ])
      if (cancelled) return
      if (cusRes.error) {
        setError(errorMessage(cusRes.error))
        return
      }
      if (!cusRes.data) {
        // ⚠ RLS từ chối = 0 dòng, HTTP 200, không lỗi. "Không tìm thấy" và
        //   "không được xem" nhìn giống hệt nhau từ đây, nên nói cả hai.
        setError("Không mở được khách này — khách không tồn tại hoặc bạn không có quyền xem.")
        return
      }
      setRow((cusRes.data as unknown) as CustomerRow)
      // ⚠ ĐỌC HỎNG THÌ ĐỂ `null` → hiện "chưa đọc được", KHÔNG hiện 0.
      //   Số 0 ở đây nghĩa là "khách không nợ gì", và đó là câu trả lời
      //   sai cho một câu hỏi chưa đọc được.
      setDebt(debtRes.error || debtRes.truncated ? null : totalRemaining(debtRes.rows))
    })()
    return () => {
      cancelled = true
    }
  }, [customerId])

  const limit = Number(row?.credit_limit || 0)
  const st = row?.status ? STATUS_LABEL[row.status] : undefined

  return (
    <Dialog open={!!customerId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="pr-6">
            {row?.store_name || "Thông tin khách hàng"}
          </DialogTitle>
        </DialogHeader>

        {error ? (
          <p className="rounded-xl bg-error-container p-3 text-sm font-semibold text-on-error-container">
            {error}
          </p>
        ) : !row ? (
          <div className="grid gap-2">
            <Skeleton className="h-6" />
            <Skeleton className="h-20" />
            <Skeleton className="h-14" />
          </div>
        ) : (
          <div className="grid gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              {st && <Badge variant={st.variant}>{st.label}</Badge>}
              {row.channel && (
                <Badge variant="secondary">{CHANNEL_LABEL[row.channel] || row.channel}</Badge>
              )}
              {row.group?.name && <Badge variant="outline">{row.group.name}</Badge>}
            </div>

            <Row label="Chủ quán" value={row.owner_name || "—"} />
            <Row
              label="Điện thoại"
              value={
                row.phone ? (
                  /* Gọi được ngay từ đây — NVBH đang đứng trước cửa hàng
                     thì việc tiếp theo thường là bấm gọi. */
                  <a
                    href={`tel:${row.phone}`}
                    className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    {row.phone}
                  </a>
                ) : (
                  "—"
                )
              }
            />
            <Row label="Địa chỉ" value={fullCustomerAddress(row) || "—"} />
            <Row
              label="Điều khoản TT"
              value={
                /* ⚠ Không có nhãn thì in NGUYÊN mã, đừng in "—". Mã lạ
                   nghĩa là dữ liệu có thứ bảng nhãn chưa biết; giấu đi là
                   giấu luôn manh mối. */
                PAYMENT_TERMS.find((t) => t.value === row.payment_terms)?.label ||
                row.payment_terms ||
                "—"
              }
            />

            <div className="h-px bg-border" />

            {/* ⚠ CÔNG NỢ VÀ HẠN MỨC ĐỨNG CẠNH NHAU, kèm phần CÒN ĐƯỢC NỢ.
                Bắt người dùng trừ nhẩm ngay lúc khách đang đứng đợi là
                chỗ hay trừ sai nhất. */}
            <Row
              label="Công nợ hiện tại"
              value={
                debt === null ? (
                  <span className="text-on-surface-variant">chưa đọc được</span>
                ) : (
                  <span className={limit > 0 && debt >= limit ? "text-error" : undefined}>
                    {formatCurrency(debt)}
                  </span>
                )
              }
            />
            <Row label="Hạn mức" value={limit > 0 ? formatCurrency(limit) : "không hạn mức"} />
            {limit > 0 && debt !== null && (
              <Row
                label="Còn được nợ"
                value={
                  <span className={limit - debt <= 0 ? "font-bold text-error" : undefined}>
                    {formatCurrency(Math.max(0, limit - debt))}
                  </span>
                }
              />
            )}

            <Link
              href={`/customers/${row.id}`}
              className="mt-1 inline-flex items-center gap-1.5 text-sm font-bold text-primary hover:underline"
            >
              Mở hồ sơ khách hàng <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-semibold">{value}</span>
    </div>
  )
}
