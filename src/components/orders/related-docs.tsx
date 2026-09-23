"use client"

/**
 * CHỨNG TỪ LIÊN QUAN + HÀNG ĐỔI TRẢ — một khối dùng chung cho chi tiết hóa
 * đơn (POS và web) và chi tiết đơn (POS).
 *
 * ⚠ CHỦ NHÀ YÊU CẦU 23/09/2026: "Chi tiết hoá đơn không có thông tin hàng đổi
 *   trả?" và "Chi tiết hoá đơn, chi tiết đơn hàng có liên kết đến các chứng từ
 *   liên quan (vd trong chi tiết đơn hàng có hoá đơn và trả hàng tương ứng,
 *   trong chi tiết hoá đơn có đơn hàng và trả hàng tương ứng)".
 *
 * ⚠ MỘT KHỐI, KHÔNG BA BẢN. Ba màn tự vẽ là ba câu truy vấn trôi khỏi nhau —
 *   đúng kiểu một màn tính cả phiếu đã huỷ còn màn kia thì không.
 *
 * ⚠ PHIẾU TRẢ LẤY THEO ĐƠN **VÀ** THEO HÓA ĐƠN. Phiếu trả độc lập (lập từ màn
 *   hóa đơn, không qua đơn) chỉ có `invoice_id`; lọc theo đơn thôi là nó
 *   biến mất khỏi chi tiết hóa đơn — đúng tờ mà nó trừ tiền.
 *
 * ⚠ PHIẾU ĐÃ HUỶ VẪN HIỆN Ở PHẦN LIÊN KẾT (có nhãn), nhưng KHÔNG vào bảng
 *   hàng đổi trả và không vào khoản trừ — nó không trừ gì.
 */

import { useEffect, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { errorMessage } from "@/lib/errors"
import { formatCurrency, formatDate } from "@/lib/utils"
import { INVOICE_STATUS_MAP, ORDER_STATUS_MAP, RETURN_STATUS_MAP } from "@/lib/constants"

interface Don { id: string; order_code: string; status: string }
interface HoaDon { id: string; invoice_code: string; status: string; total: number; invoice_date: string | null }
interface DongTra {
  id: string; unit_name: string; quantity: number; unit_price: number | null; vat_rate: number | null
  line_total: number | null; is_exchange: boolean | null
  product?: { name?: string | null; sku?: string | null } | null
}
interface PhieuTra {
  id: string; status: string; created_at: string; credit_note_amount: number | null
  invoice_id: string | null; order_id: string | null; lines?: DongTra[] | null
}

export interface RelatedDocsProps {
  /** Đơn gốc — chi tiết hóa đơn truyền `order_id` của tờ, chi tiết đơn truyền chính đơn. */
  orderId: string | null | undefined
  /** Có thì đây là chi tiết HÓA ĐƠN: tờ này không tự liên kết, hàng đổi trả chỉ của tờ này. */
  invoiceId?: string | null
  /** Liên kết mở màn POS (`/pos/…`) thay vì màn web. */
  pos?: boolean
  /** Vẽ bảng hàng đổi trả (tắt khi màn đã có khối hàng trả riêng). */
  hienHangTra?: boolean
  /** Tiêu đề khối — màn đã có thẻ "Chứng từ liên quan" riêng thì đặt tên khác. */
  tieuDe?: string
  /** Không vẽ liên kết về đơn (màn đã có sẵn). */
  anDon?: boolean
}

export function RelatedDocs({ orderId, invoiceId = null, pos = false, hienHangTra = true, tieuDe = "Chứng từ liên quan", anDon = false }: RelatedDocsProps) {
  const [don, setDon] = useState<Don | null>(null)
  const [hoaDon, setHoaDon] = useState<HoaDon[]>([])
  const [tra, setTra] = useState<PhieuTra[]>([])
  const [loi, setLoi] = useState<string | null>(null)
  const [xong, setXong] = useState(false)

  useEffect(() => {
    let huy = false
    ;(async () => {
      const sb = createClient()
      const dk = [orderId ? `order_id.eq.${orderId}` : null, invoiceId ? `invoice_id.eq.${invoiceId}` : null]
        .filter(Boolean)
        .join(",")
      const [o, hd, rt] = await Promise.all([
        orderId
          ? sb.from("sales_orders").select("id, order_code, status").eq("id", orderId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        orderId
          ? sb.from("sales_invoices").select("id, invoice_code, status, total, invoice_date")
              .eq("order_id", orderId).order("created_at", { ascending: true })
          : Promise.resolve({ data: [], error: null }),
        dk
          ? sb.from("returns")
              .select("id, status, created_at, credit_note_amount, invoice_id, order_id, lines:return_lines(id, unit_name, quantity, unit_price, vat_rate, line_total, is_exchange, product:products(name, sku))")
              .or(dk)
              .order("created_at", { ascending: true })
          : Promise.resolve({ data: [], error: null }),
      ])
      if (huy) return
      const e = o.error || hd.error || rt.error
      if (e) setLoi(errorMessage(e))
      setDon((o.data as unknown as Don) ?? null)
      setHoaDon((hd.data as unknown as HoaDon[]) ?? [])
      setTra((rt.data as unknown as PhieuTra[]) ?? [])
      setXong(true)
    })()
    return () => { huy = true }
  }, [orderId, invoiceId])

  const hrefDon = (id: string) => (pos ? `/pos/don-hang/${id}` : `/orders/${id}`)
  const hrefHD = (id: string) => (pos ? `/pos/hoa-don/${id}` : `/sales-invoices/${id}`)
  const hrefTra = (id: string) => (pos ? `/pos/tra-hang/${id}` : `/returns/${id}`)

  /* Hàng đổi trả: của tờ này (chi tiết hóa đơn) hoặc của cả đơn; bỏ phiếu đã huỷ. */
  const traHieuLuc = tra.filter((r) => r.status !== "cancelled" && (!invoiceId || r.invoice_id === invoiceId))
  const dongTra = traHieuLuc.flatMap((r) => (r.lines ?? []).map((l) => ({ ...l, phieu: r })))
  const tongTru = dongTra.reduce(
    (s, l) => s + (l.is_exchange ? 0 : Math.max(0, Number(l.line_total ?? Math.round(Number(l.quantity) * Number(l.unit_price ?? 0) * (1 + Number(l.vat_rate ?? 0)))))),
    0
  )

  const hdKhac = hoaDon.filter((h) => h.id !== invoiceId)
  const coLienKet = (!!don && !!invoiceId && !anDon) || hdKhac.length > 0 || tra.length > 0

  return (
    <div data-testid="chung-tu-lien-quan" className="rounded-xl border bg-card p-3.5 text-[13px]">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
        {tieuDe}
      </p>
      {loi && <p className="mt-1.5 text-[12px] font-semibold text-destructive">Không đọc đủ chứng từ liên quan — {loi}</p>}
      {xong && !coLienKet && !loi && (
        <p className="mt-1.5 text-muted-foreground">Chưa có chứng từ nào khác.</p>
      )}
      <div className="mt-1.5 grid gap-1">
        {don && invoiceId && !anDon && (
          <Link href={hrefDon(don.id)} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/50">
            <span className="min-w-0 truncate">Đơn hàng <b className="font-mono">{don.order_code}</b></span>
            <span className="shrink-0 text-[12px] text-muted-foreground">{ORDER_STATUS_MAP[don.status]?.label ?? don.status}</span>
          </Link>
        )}
        {hdKhac.map((h) => (
          <Link key={h.id} href={hrefHD(h.id)} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/50">
            <span className="min-w-0 truncate">
              Hóa đơn <b className="font-mono">{h.invoice_code}</b>
              {h.invoice_date ? <span className="text-muted-foreground"> · {formatDate(h.invoice_date)}</span> : null}
            </span>
            <span className="shrink-0 text-[12px] text-muted-foreground">
              {formatCurrency(h.total)} · {INVOICE_STATUS_MAP[h.status]?.label ?? h.status}
            </span>
          </Link>
        ))}
        {tra.map((r) => (
          <Link key={r.id} href={hrefTra(r.id)} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/50">
            <span className="min-w-0 truncate">
              Phiếu trả <span className="text-muted-foreground">· {formatDate(r.created_at)}</span>
              {invoiceId && r.invoice_id && r.invoice_id !== invoiceId && (
                <span className="text-muted-foreground"> · của hóa đơn khác</span>
              )}
            </span>
            <span className="shrink-0 text-[12px] text-muted-foreground">
              {r.status !== "cancelled" && Number(r.credit_note_amount) > 0 ? `− ${formatCurrency(Number(r.credit_note_amount))} · ` : ""}
              {RETURN_STATUS_MAP[r.status]?.label ?? r.status}
            </span>
          </Link>
        ))}
      </div>

      {hienHangTra && (
        <div data-testid="hang-doi-tra" className="mt-3 border-t pt-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
              Hàng đổi trả {invoiceId ? "kèm hóa đơn" : "kèm đơn"}
            </p>
            {tongTru > 0 && <span className="text-[12.5px] font-bold text-amber-700">trừ {formatCurrency(tongTru)}</span>}
          </div>
          {xong && dongTra.length === 0 ? (
            <p className="mt-1 text-muted-foreground">Không có.</p>
          ) : (
            <div className="mt-1 grid gap-0.5">
              {dongTra.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-2 px-2 py-1">
                  <span className="min-w-0 truncate">
                    {l.product?.name || "Sản phẩm đã xoá"}{" "}
                    <span className="text-muted-foreground">· {Number(l.quantity).toLocaleString("vi-VN")} {l.unit_name}</span>
                  </span>
                  <span className="shrink-0 text-[12px]">
                    <span className={`mr-2 rounded px-1.5 py-px font-bold ${l.is_exchange ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-700"}`}>
                      {l.is_exchange ? "Đổi" : "Trả"}
                    </span>
                    {l.is_exchange ? "—" : `− ${formatCurrency(Math.max(0, Number(l.line_total ?? 0)))}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
