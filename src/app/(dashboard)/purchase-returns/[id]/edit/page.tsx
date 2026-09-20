"use client"

/**
 * SỬA PHIẾU TRẢ HÀNG NCC.
 *
 * ⚠ BIỂU MẪU NẰM Ở `PurchaseReturnForm`, dùng chung với màn tạo. Trang
 * này chỉ còn ba việc: nạp phiếu cũ, dựng lại dòng hàng, và ghi đè.
 */

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import {
  PurchaseReturnForm, type PurchaseReturnFormValue,
} from "@/components/purchasing/purchase-return-form"
import {
  friendlyReturnError, percentToRatio, ratioToPercent,
} from "@/lib/purchasing/return-form"
import {
  receiptTotals, validReceiptLines,
  type ReceiptLine, type ReceiptProduct,
} from "@/lib/purchasing/receipt-form"
import { loadPickerExtras, type PickerExtra } from "@/lib/purchasing/picker-extras"
import { saveReturnLines } from "@/lib/purchasing/save-receipt"
import type { Supplier, SupplierReturn } from "@/types"
import { errorMessage } from "@/lib/errors"

/** Dòng đọc lên từ `supplier_return_lines` — đúng các cột đang chọn. */
interface SavedLine {
  id: string
  product_id: string
  unit_name: string
  quantity: number
  unit_price: number
  line_discount: number | null
  vat_rate: number | null
  conversion_factor: number | null
  notes: string | null
  sort_order: number | null
}

export default function EditPurchaseReturnPage() {
  const { id } = useParams<{ id: string }>()
  const { loading: authLoading } = useRoleGuard("inventory")
  const { user } = useAuth()
  const router = useRouter()
  const supabase = createClient()
  const { toast } = useToast()

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<ReceiptProduct[]>([])
  const [extras, setExtras] = useState<Record<string, PickerExtra>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [notDraft, setNotDraft] = useState(false)
  const [status, setStatus] = useState<string>("draft")
  const [form, setForm] = useState<PurchaseReturnFormValue>({
    supplierId: "",
    returnDate: new Date().toISOString().slice(0, 10),
    zone: "date",
    reason: "near_expiry",
    discount: "",
    vatOverride: "",
    notes: "",
    lines: [],
  })

  const patch = (p: Partial<PurchaseReturnFormValue>) => setForm((f) => ({ ...f, ...p }))

  const fillExtras = useCallback(async (prods: ReceiptProduct[]) => {
    setExtras(await loadPickerExtras(supabase, prods))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const [supRes, prodRes, hdrRes, lineRes] = await Promise.all([
      supabase
        .from("suppliers")
        .select("id, name, code")
        .eq("org_id", user.org_id)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("products")
        .select("id, name, sku, barcode, base_unit, cost_price, vat_rate, primary_supplier_id, units:product_units(*)")
        .eq("org_id", user.org_id)
        .order("name"),
      supabase
        .from("supplier_returns")
        .select("id, supplier_id, return_date, warehouse_zone, reason, discount, vat_override, notes, status")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("supplier_return_lines")
        .select("id, product_id, unit_name, quantity, unit_price, line_discount, vat_rate, conversion_factor, notes, sort_order")
        .eq("return_id", id)
        .order("sort_order"),
    ])
    const qErr = ([supRes, prodRes, hdrRes, lineRes] as Array<{ error?: { message?: string } | null }>)
      .find((r) => r?.error)?.error
    if (qErr) console.error("[purchase-returns/edit] truy vấn lỗi:", qErr.message)
    const prods = (prodRes.data as ReceiptProduct[]) || []
    setSuppliers((supRes.data as Supplier[]) || [])
    setProducts(prods)
    void fillExtras(prods)

    const hdr = hdrRes.data as (SupplierReturn & {
      discount: number | null; vat_override: number | null
    }) | null
    if (!hdr) {
      setLoading(false)
      return
    }
    /**
     * ⚠ PHIẾU ĐÃ GỬI VẪN SỬA ĐƯỢC (chủ nhà chốt 20/09/2026: "Tương tự
     *   phiếu trả hàng cũng vậy"). Cách làm giống phiếu nhập hàng: huỷ
     *   bản cũ → ghi lại dòng mới → gửi lại, gọi đúng hai RPC đã có.
     *   Nghĩa là phép sửa THỪA HƯỞNG mọi chốt chặn của phép huỷ — NCC
     *   đã cấn trừ tiền hoặc lô đã đóng thì không sửa được.
     *
     * ⚠ PHIẾU ĐÃ HUỶ THÌ KHÔNG. Đó là chứng từ đã đóng; sửa lại nó là
     *   làm sống lại một thứ đã kết thúc. Lập phiếu mới.
     */
    if (hdr.status === "cancelled") {
      setNotDraft(true)
      setLoading(false)
      return
    }
    setStatus(hdr.status)
    /**
     * ⚠ DỰNG LẠI DÒNG TỪ PHIẾU ĐÃ LƯU, KHÔNG TỪ DANH MỤC. Số lượng, đơn
     *   giá, giảm giá và thuế suất đã ghi xuống là thứ người dùng gõ;
     *   lấy lại từ `products` là lặng lẽ đè lên chúng bằng giá vốn hôm
     *   nay. Chỉ tên hàng, đơn vị cơ sở và bảng quy đổi mới tra danh mục.
     */
    setForm({
      supplierId: hdr.supplier_id,
      returnDate: hdr.return_date,
      zone: hdr.warehouse_zone,
      reason: hdr.reason || "near_expiry",
      discount: hdr.discount ? String(hdr.discount) : "",
      /* ⚠ SỐ 0 KHÁC Ô TRỐNG — so với `null` chứ không dùng `||`, nếu
         không một chứng từ khai thuế 0 nạp lại thành "để máy tự cộng". */
      vatOverride: hdr.vat_override == null ? "" : String(hdr.vat_override),
      notes: hdr.notes || "",
      lines: ((lineRes.data as SavedLine[]) || []).map((l): ReceiptLine => {
        const prod = prods.find((p) => p.id === l.product_id)
        return {
          id: l.id,
          product_id: l.product_id,
          /* ⚠ MÃ ĐÃ XOÁ KHỎI DANH MỤC VẪN PHẢI HIỆN RA. Vẽ một dòng
             không tên là giấu mất chính thứ cần sửa. */
          product_name: prod?.name || "Sản phẩm đã xoá",
          sku: prod?.sku || "",
          note: l.notes || "",
          unit_name: l.unit_name,
          quantity: String(l.quantity),
          unit_price: String(l.unit_price),
          line_discount: l.line_discount ? String(l.line_discount) : "",
          /* ⚠ CỘT LƯU LÀ TIỀN, nên dòng nạp lại LUÔN ở chế độ tiền. Đoán
             ngược ra phần trăm là bịa — cùng một số tiền ra vô số phần
             trăm tuỳ giá. */
          discount_mode: "amount",
          vat_percent: ratioToPercent(l.vat_rate),
          conversion_factor: String(l.conversion_factor || 1),
          available_units: prod?.units || [],
          base_unit: prod?.base_unit || l.unit_name,
        }
      }),
    })
    setLoading(false)
  }, [id, user?.org_id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const handleSubmit = async (sendNow: boolean) => {
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

    const wasCompleted = status === "completed"

    setSubmitting(true)
    try {
      /**
       * ⚠ HUỶ BẢN CŨ TRƯỚC, và hỏng thì DỪNG HẲN. Đi tiếp khi kho chưa
       *   hoàn về là ghi đè dòng hàng của một phiếu vẫn đang giữ số đã
       *   trừ trong kho — chứng từ nói một đằng, kho nói một nẻo.
       */
      if (wasCompleted) {
        const { error } = await supabase.rpc("cancel_supplier_return", {
          p_return_id: id, p_reason: "Sửa phiếu — lập lại",
        })
        if (error) throw new Error(friendlyReturnError(error.message))
      }

      const { error: hdrErr } = await supabase
        .from("supplier_returns")
        .update({
          supplier_id: form.supplierId,
          return_date: form.returnDate,
          warehouse_zone: form.zone,
          reason: form.reason || null,
          notes: form.notes.trim() || null,
          discount: totals.discount,
          vat_override: form.vatOverride.trim() === "" ? null : Number(form.vatOverride),
          subtotal: totals.subtotal,
          vat: totals.vat,
          total: totals.total,
          /* Phiếu vừa huỷ phải quay về nháp thì `complete_supplier_return`
             mới nhận — nó chỉ chạy trên `draft`. */
          status: "draft",
          cancel_reason: null,
        })
        .eq("id", id)
        .select("id")
      if (hdrErr) throw new Error(hdrErr.message)

      await saveReturnLines(supabase, id, lines, percentToRatio)

      if (sendNow) {
        const { error: rpcErr } = await supabase.rpc("complete_supplier_return", {
          p_return_id: id,
        })
        /**
         * ⚠ BA BƯỚC KHÔNG NẰM TRONG MỘT GIAO DỊCH. Hỏng ở đây thì kho
         *   ĐÃ hoàn về đúng và phiếu nằm lại ở nháp — không lệch gì,
         *   chỉ là chưa gửi lại. Phải NÓI RA, nếu không người dùng
         *   tưởng mất hàng.
         */
        if (rpcErr) {
          throw new Error(
            `${friendlyReturnError(rpcErr.message)} — Phiếu đã lưu lại thành NHÁP và kho đã hoàn về đúng. Vào lại phiếu rồi bấm Gửi phiếu.`
          )
        }
      }

      toast({
        title: sendNow ? "Đã gửi phiếu — xuất kho + giảm công nợ NCC" : "Đã lưu thay đổi",
      })
      router.push(`/purchase-returns/${id}`)
    } catch (err) {
      toast({ title: "Lỗi", description: errorMessage(err), variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />

  if (notDraft) {
    return (
      <div className="space-y-4">
        <PageHeader title="Không thể sửa" backHref={`/purchase-returns/${id}`} />
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Phiếu này đã huỷ. Lập phiếu trả mới thay vì sửa lại một chứng từ đã đóng.
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-28">
      <PageHeader
        title="Sửa phiếu trả NCC"
        description={
          status === "completed"
            ? "Phiếu đã gửi: lưu lại sẽ hoàn kho và công nợ của bản cũ rồi lập lại theo số mới."
            : "Phiếu nháp — sửa thoải mái, chưa đụng tới kho hay công nợ."
        }
        backHref={`/purchase-returns/${id}`}
      />

      <PurchaseReturnForm
        suppliers={suppliers}
        products={products}
        value={form}
        onChange={patch}
        submitting={submitting}
        extras={extras}
        actions={
          <>
            <Button variant="outline" onClick={() => handleSubmit(false)} disabled={submitting}>
              Lưu nháp
            </Button>
            <Button onClick={() => handleSubmit(true)} disabled={submitting || form.lines.length === 0}>
              {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {status === "completed" ? "Lập lại" : "Lưu & gửi"}
            </Button>
          </>
        }
      />
    </div>
  )
}
