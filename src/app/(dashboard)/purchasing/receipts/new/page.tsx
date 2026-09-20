"use client"

/**
 * TẠO PHIẾU NHẬP HÀNG.
 *
 * ⚠ LƯU LÀ `draft`, HOÀN THÀNH LÀ MỘT RPC. Màn này KHÔNG tự cộng kho và
 * KHÔNG tự ghi công nợ — đó là việc của `complete_purchase_invoice`,
 * một giao dịch. Màn cũ (`/inventory/stock-in`) làm ngược lại: vòng lặp
 * từ trình duyệt ghi thẳng `batches` rồi `payables`, và mạng rớt giữa
 * chừng là kho đã cộng mà công nợ chưa ghi.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import {
  PurchaseReceiptForm, type PurchaseReceiptFormValue,
} from "@/components/purchasing/purchase-receipt-form"
import {
  receiptTotals, validReceiptLines, friendlyReceiptError,
  type ReceiptProduct,
} from "@/lib/purchasing/receipt-form"
import { percentToRatio } from "@/lib/purchasing/return-form"
import { saveReceiptLines } from "@/lib/purchasing/save-receipt"
import type { Supplier } from "@/types"
import { errorMessage } from "@/lib/errors"

export default function NewPurchaseReceiptPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const { user } = useAuth()
  const router = useRouter()
  const supabase = createClient()
  const { toast } = useToast()

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<ReceiptProduct[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState<PurchaseReceiptFormValue>(() => ({
    supplierId: "",
    invoiceNumber: "",
    invoiceDate: new Date().toISOString().slice(0, 10),
    zone: "sale",
    discount: "",
    notes: "",
    lines: [],
  }))

  const patch = (p: Partial<PurchaseReceiptFormValue>) => setForm((f) => ({ ...f, ...p }))

  useEffect(() => {
    if (!user?.org_id) return
    let cancelled = false
    ;(async () => {
      const [supRes, prodRes] = await Promise.all([
        supabase.from("suppliers").select("id, name, code")
          .eq("org_id", user.org_id).eq("is_active", true).order("name"),
        supabase.from("products")
          .select("id, name, sku, barcode, base_unit, cost_price, vat_rate, shelf_life_days, units:product_units(*)")
          .eq("org_id", user.org_id).order("name"),
      ])
      if (cancelled) return
      const e = ([supRes, prodRes] as Array<{ error?: { message?: string } | null }>)
        .find((r) => r?.error)?.error
      if (e) console.error("[purchasing/receipts/new] truy vấn lỗi:", e.message)
      setSuppliers((supRes.data as Supplier[]) || [])
      setProducts((prodRes.data as ReceiptProduct[]) || [])
    })()
    return () => { cancelled = true }
  }, [user?.org_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (complete: boolean) => {
    if (!user?.org_id) return
    if (!form.supplierId) {
      toast({ title: "Chưa chọn nhà cung cấp", variant: "destructive" })
      return
    }
    const lines = validReceiptLines(form.lines)
    if (lines.length === 0) {
      toast({ title: "Chưa có dòng hàng hợp lệ", variant: "destructive" })
      return
    }
    const totals = receiptTotals(lines, form.discount)

    setSubmitting(true)
    try {
      const { data: head, error: hErr } = await supabase
        .from("purchase_invoices")
        .insert({
          org_id: user.org_id,
          supplier_id: form.supplierId,
          invoice_number: form.invoiceNumber.trim() || null,
          invoice_date: form.invoiceDate,
          warehouse_zone: form.zone,
          discount: totals.discount,
          notes: form.notes.trim() || null,
          status: "draft",
          created_by: user.id,
          /* ⚠ SỐ Ở ĐÂY CHỈ ĐỂ XEM TRÊN DANH SÁCH KHI CÒN LÀ PHIẾU TẠM.
             Lúc hoàn thành, RPC tính lại từ dòng hàng và ghi đè — nó
             mới là số đi vào công nợ NCC. */
          subtotal: totals.subtotal,
          vat: totals.vat,
          total: totals.total,
        })
        .select("id")
        .single()
      if (hErr || !head) throw new Error(hErr?.message || "Không tạo được phiếu")
      const id = (head as { id: string }).id

      await saveReceiptLines(supabase, id, lines, percentToRatio)

      if (complete) {
        const { error: rErr } = await supabase.rpc("complete_purchase_invoice", {
          p_invoice_id: id,
        })
        if (rErr) throw new Error(friendlyReceiptError(rErr.message))
      }
      toast({ title: complete ? "Đã hoàn thành — nhập kho và ghi công nợ NCC" : "Đã lưu phiếu tạm" })
      router.push(`/purchasing/receipts/${id}`)
    } catch (err) {
      toast({ title: "Lỗi", description: errorMessage(err), variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4 pb-28">
      <PageHeader
        title="Tạo phiếu nhập hàng"
        description="Hoàn thành phiếu là nhập kho và ghi công nợ NCC, trong một giao dịch."
        backHref="/purchasing/receipts"
      />
      <PurchaseReceiptForm
        suppliers={suppliers}
        products={products}
        value={form}
        onChange={patch}
        submitting={submitting}
        actions={
          <>
            <Button variant="outline" onClick={() => submit(false)} disabled={submitting}>
              Lưu tạm
            </Button>
            <Button onClick={() => submit(true)} disabled={submitting || form.lines.length === 0}>
              {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Hoàn thành
            </Button>
          </>
        }
      />
    </div>
  )
}
