"use client"

/**
 * XEM NHANH CHỨNG TỪ — điểm cuối của mọi lần đào sâu (spec mục 2.5: "Điểm cuối luôn là chứng từ").
 * Hoá đơn · đơn đặt · phiếu trả · phiếu thu (khoản thu) · phiếu chi. Nút mở màn đầy đủ của
 * chứng từ; hoá đơn còn nợ có thêm nút "Thu tiền".
 */
import { useEffect, useState } from "react"
import Link from "@/components/ui/link"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { createClient } from "@/lib/supabase/client"
import { soDu } from "@/lib/bao-cao/so"
import { ngayDu } from "@/lib/bao-cao/ky"
import { nhanTrangThaiDon } from "@/lib/bao-cao/nap-don-dat"
import { errorMessage } from "@/lib/errors"
import { docMaPhieuTra } from "@/lib/returns/ma-phieu"

export type LoaiChungTu = "hd" | "don" | "tra" | "thu" | "chi"

export interface ChungTuMo {
  loai: LoaiChungTu
  id: string
}

interface NoiDung {
  tieuDe: string
  phu: string
  meta: [string, string][]
  dong: { ten: string; sl: string; tien: string }[]
  tong: string | null
  nut: { label: string; href: string; chinh?: boolean }[]
}

type Mot = { [k: string]: unknown } | null
const ten = (x: unknown, k = "store_name") => ((x as Record<string, unknown> | null)?.[k] as string) || "—"
const ngay = (s: unknown) => (typeof s === "string" && s ? ngayDu(s.slice(0, 10)) : "—")

async function napNoiDung(ct: ChungTuMo): Promise<NoiDung> {
  const sb = createClient()
  const mot = async (q: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return data as Mot
  }
  const nhieu = async (q: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return (data || []) as Record<string, unknown>[]
  }
  const dongHang = (ls: Record<string, unknown>[]) =>
    ls.map((l) => ({ ten: ten(l.product, "name"), sl: `${soDu(Number(l.quantity || 0))} ${l.unit_name || ""}`.trim(), tien: soDu(Number(l.line_total || 0)) }))
  switch (ct.loai) {
    case "hd": {
      const [h, ls, cn] = await Promise.all([
        mot(sb.from("sales_invoices").select("id, invoice_code, invoice_date, total, due_date, customer_id, customer:customers(store_name), sales_user:users!sales_invoices_sales_user_id_fkey(full_name), order:sales_orders(order_code)").eq("id", ct.id).maybeSingle()),
        nhieu(sb.from("sales_invoice_lines").select("quantity, unit_name, line_total, product:products(name)").eq("invoice_id", ct.id).order("id")),
        nhieu(sb.from("receivables").select("amount, paid, status").eq("invoice_id", ct.id)),
      ])
      if (!h) throw new Error("Không tìm thấy hoá đơn")
      const con = cn.filter((r) => r.status !== "paid").reduce((s, r) => s + Number(r.amount || 0) - Number(r.paid || 0), 0)
      return {
        tieuDe: `Hoá đơn ${h.invoice_code}`,
        phu: ten(h.customer),
        meta: [
          ["Ngày", ngay(h.invoice_date)],
          ["Nhân viên", ten(h.sales_user, "full_name")],
          ["Từ đơn đặt", ten(h.order, "order_code")],
          ["Hạn thanh toán", ngay(h.due_date)],
          ["Thanh toán", con > 0 ? `Còn phải thu ${soDu(con)}` : con < 0 ? `Dư có ${soDu(-con)}` : "Đã thu đủ"],
        ],
        dong: dongHang(ls),
        tong: soDu(Number(h.total || 0)),
        nut: [
          ...(con > 0 ? [{ label: "Thu tiền", href: `/receivables/collect?customerId=${h.customer_id}`, chinh: true }] : []),
          { label: "Mở hoá đơn", href: `/sales-invoices/${h.id}`, chinh: con <= 0 },
        ],
      }
    }
    case "don": {
      const [o, ls] = await Promise.all([
        mot(sb.from("sales_orders").select("id, order_code, order_date, status, total, customer:customers(store_name), sales_user:users!sales_orders_sales_user_id_fkey(full_name)").eq("id", ct.id).maybeSingle()),
        nhieu(sb.from("sales_order_lines").select("quantity, unit_name, line_total, product:products(name)").eq("order_id", ct.id).order("id")),
      ])
      if (!o) throw new Error("Không tìm thấy đơn")
      return {
        tieuDe: `Đơn đặt ${o.order_code}`,
        phu: ten(o.customer),
        meta: [
          ["Ngày đặt", ngay(o.order_date)],
          ["Nhân viên", ten(o.sales_user, "full_name")],
          ["Trạng thái", nhanTrangThaiDon(String(o.status))],
        ],
        dong: dongHang(ls),
        tong: soDu(Number(o.total || 0)),
        nut: [{ label: "Mở đơn", href: `/orders/${o.id}`, chinh: true }],
      }
    }
    case "tra": {
      const [r, ls, ma] = await Promise.all([
        mot(sb.from("returns").select("id, revenue_date, reason, credit_note_amount, credit_with_invoice, customer:customers(store_name), invoice:sales_invoices(invoice_code)").eq("id", ct.id).maybeSingle()),
        nhieu(sb.from("return_lines").select("quantity, unit_name, line_total, is_exchange, product:products(name)").eq("return_id", ct.id).order("id")),
        docMaPhieuTra(sb, [ct.id]),
      ])
      if (!r) throw new Error("Không tìm thấy phiếu trả")
      return {
        tieuDe: `Phiếu trả ${ma.get(ct.id) || ""}`.trim(),
        phu: ten(r.customer),
        meta: [
          ["Ngày trừ doanh số", ngay(r.revenue_date)],
          ["Hoá đơn gốc", ten(r.invoice, "invoice_code")],
          ["Lý do", String(r.reason || "—")],
          ["Loại", r.credit_with_invoice ? "Tự sinh (theo hoá đơn)" : "Tự lập"],
        ],
        dong: dongHang(ls.filter((l) => !l.is_exchange)),
        tong: soDu(Math.abs(Number(r.credit_note_amount || 0))),
        nut: [{ label: "Mở phiếu trả", href: `/returns/${r.id}`, chinh: true }],
      }
    }
    case "thu": {
      const p = await mot(
        sb.from("payments").select("id, amount, method, collected_at, receivable_id, collector:users!payments_collected_by_fkey(full_name), receivable:receivables(customer:customers(store_name), invoice:sales_invoices(invoice_code))").eq("id", ct.id).maybeSingle()
      )
      if (!p) throw new Error("Không tìm thấy khoản thu")
      const rc = p.receivable as Record<string, unknown> | null
      return {
        tieuDe: "Khoản thu",
        phu: ten(rc?.customer),
        meta: [
          ["Ngày", ngay(p.collected_at)],
          ["Hình thức", p.method === "cash" ? "Tiền mặt" : p.method === "transfer" ? "Chuyển khoản" : String(p.method || "—")],
          ["Người thu", ten(p.collector, "full_name")],
          ["Cho hoá đơn", ten(rc?.invoice, "invoice_code")],
        ],
        dong: [],
        tong: soDu(Number(p.amount || 0)),
        nut: [{ label: "Mở công nợ", href: `/receivables/${p.receivable_id}`, chinh: true }],
      }
    }
    default: {
      const e = await mot(sb.from("expenses").select("id, reference_code, expense_date, amount, description, category:expense_categories(name)").eq("id", ct.id).maybeSingle())
      if (!e) throw new Error("Không tìm thấy phiếu chi")
      return {
        tieuDe: `Phiếu chi ${e.reference_code || ""}`.trim(),
        phu: ten(e.category, "name"),
        meta: [
          ["Ngày", ngay(e.expense_date)],
          ["Nội dung", String(e.description || "—")],
        ],
        dong: [],
        tong: soDu(Number(e.amount || 0)),
        nut: [{ label: "Mở danh sách chi phí", href: "/finance/expenses", chinh: true }],
      }
    }
  }
}

export function XemNhanhChungTu({ ct, onDong }: { ct: ChungTuMo | null; onDong: () => void }) {
  const [nd, setNd] = useState<NoiDung | null>(null)
  const [loi, setLoi] = useState<string | null>(null)
  useEffect(() => {
    if (!ct) return
    let huy = false
    setNd(null)
    setLoi(null)
    napNoiDung(ct)
      .then((x) => !huy && setNd(x))
      .catch((e) => !huy && setLoi(errorMessage(e)))
    return () => {
      huy = true
    }
  }, [ct])
  return (
    <Dialog open={!!ct} onOpenChange={(o) => !o && onDong()}>
      <DialogContent className="max-h-[85vh] max-w-[520px] overflow-hidden p-0" data-testid="bc-xem-nhanh">
        <div className="border-b px-5 pb-3 pt-4">
          <div className="text-xs text-muted-foreground">Xem nhanh chứng từ</div>
          <DialogTitle className="text-[17px] font-bold">{nd?.tieuDe || (loi ? "Không mở được" : "Đang tải…")}</DialogTitle>
          {nd && <div className="text-[13px]">{nd.phu}</div>}
        </div>
        <div className="max-h-[55vh] overflow-auto px-5 pb-3 pt-1.5">
          {loi && <div className="py-3 text-sm text-destructive">{loi}</div>}
          {!nd && !loi && <Skeleton className="my-3 h-32" />}
          {nd && (
            <>
              {nd.meta.map(([k, v]) => (
                <div key={k} className="flex gap-3 py-1.5 text-[13px]">
                  <span className="w-[130px] shrink-0 text-muted-foreground">{k}</span>
                  <span className="font-medium">{v}</span>
                </div>
              ))}
              {nd.dong.length > 0 && (
                <div className="mt-2 overflow-hidden rounded-xl border">
                  {nd.dong.map((l, i) => (
                    <div key={i} className="flex gap-2.5 border-b px-3 py-2.5 text-[13px] last:border-b-0">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">{l.ten}</div>
                        <div className="text-xs text-muted-foreground">{l.sl}</div>
                      </div>
                      <div className="font-semibold tabular-nums">{l.tien}</div>
                    </div>
                  ))}
                </div>
              )}
              {nd.tong && (
                <div className="flex pt-3 text-[15px] font-bold">
                  <span className="flex-1">Tổng tiền</span>
                  <span className="tabular-nums">{nd.tong}</span>
                </div>
              )}
            </>
          )}
        </div>
        {nd && (
          <div className="flex gap-2 border-t px-5 pb-4 pt-3">
            {nd.nut.map((n) => (
              <Link key={n.label} href={n.href} className={n.chinh ? "grid h-11 flex-1 place-items-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground" : "grid h-11 flex-1 place-items-center rounded-xl border text-sm font-semibold"}>
                {n.label}
              </Link>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
