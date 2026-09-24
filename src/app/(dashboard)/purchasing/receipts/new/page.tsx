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

import { usePosDesktopRedirect } from "@/components/sell/pos-desktop-redirect"
import { posNewPurchaseHref } from "@/lib/nav/pos-preview"
import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { duocGhiMuaHang } from "@/lib/purchasing/roles"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import {
  PurchaseReceiptForm, type PurchaseReceiptFormValue,
} from "@/components/purchasing/purchase-receipt-form"
import { loadPickerExtras, type PickerExtra } from "@/lib/purchasing/picker-extras"
import {
  receiptTotals, validReceiptLines, friendlyReceiptError,
  type ReceiptProduct,
} from "@/lib/purchasing/receipt-form"
import { percentToRatio } from "@/lib/purchasing/return-form"
import { saveReceiptLines } from "@/lib/purchasing/save-receipt"
import type { Supplier } from "@/types"
import { loadCatalogue } from "@/lib/products/load-catalogue"
import { errorMessage } from "@/lib/errors"

export default function NewPurchaseReceiptPage() {
  /* Máy tính → màn POS (chủ nhà 24/09/2026: "tạo phiếu nhập hàng / trả hàng ncc trên desktop trên pos hết"). */
  usePosDesktopRedirect(posNewPurchaseHref())
  const { loading: authLoading } = useRoleGuard("inventory")
  const { user } = useAuth()
  const router = useRouter()
  const supabase = createClient()
  const { toast } = useToast()

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<ReceiptProduct[]>([])
  /** Danh mục đọc chưa hết — ô tìm phải nói ra. */
  const [catTruncated, setCatTruncated] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [extras, setExtras] = useState<Record<string, PickerExtra>>({})
  const [form, setForm] = useState<PurchaseReceiptFormValue>(() => ({
    supplierId: "",
    invoiceNumber: "",
    invoiceDate: new Date().toISOString().slice(0, 10),
    zone: "sale",
    discount: "",
    vatOverride: "",
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
        loadCatalogue<ReceiptProduct>(supabase, "id, name, sku, barcode, base_unit, cost_price, vat_rate, shelf_life_days, primary_supplier_id, units:product_units(*)", { orgId: user.org_id }),
      ])
      if (cancelled) return
      const e = ([supRes] as Array<{ error?: { message?: string } | null }>)
        .find((r) => r?.error)?.error
      if (e) console.error("[purchasing/receipts/new] truy vấn lỗi:", e.message)
      /* ⚠ `rows`, KHÔNG PHẢI `data` — danh mục nay kéo ĐỦ theo trang,
       không dừng ở 1.000 mã đầu. Xem `loadCatalogue`. */
    const prods = prodRes.rows
      setSuppliers((supRes.data as Supplier[]) || [])
      setProducts(prods)
    setCatTruncated(prodRes.truncated)
      /* NCC và tồn kho cho ô tìm — nạp NỀN, không chặn màn. */
      void fillExtras(prods)
    })()
    return () => { cancelled = true }
  }, [user?.org_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const fillExtras = useCallback(async (prods: ReceiptProduct[]) => {
    setExtras(await loadPickerExtras(supabase, prods))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
    const totals = receiptTotals(lines, form.discount, form.vatOverride)

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
          /* ⚠ Ô TRỐNG → `null`, nghĩa là "để máy chủ tự cộng". Gửi 0
             lên là khai "hoá đơn này không có thuế". */
          vat_override: form.vatOverride.trim() === "" ? null : Number(form.vatOverride),
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
  /* ⚠ ĐƯỜNG DẪN ĐỘNG NÊN `useRoleGuard` CHỈ KIỂM MÔ-ĐUN KHO, mà NVBH cũng
     đọc được kho: không gác ở đây là NVBH gõ xong cả phiếu mới bị RLS từ
     chối lúc lưu (đã đo). Vai được ghi: `duocGhiMuaHang` — chép RLS. */
  if (!duocGhiMuaHang(user?.role)) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        Vai trò của bạn không lập được phiếu nhập hàng. Nhờ chủ NPP, quản lý, kế toán hoặc thủ kho lập giúp.
      </div>
    )
  }

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
        catalogueTruncated={catTruncated}
        value={form}
        onChange={patch}
        submitting={submitting}
        extras={extras}
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
