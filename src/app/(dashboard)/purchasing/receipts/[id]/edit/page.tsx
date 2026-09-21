"use client"

/**
 * SỬA PHIẾU NHẬP HÀNG.
 *
 * ⚠ SỬA PHIẾU ĐÃ HOÀN THÀNH ĐƯỢC PHÉP (chủ nhà chốt: "Có thể cập nhật
 * được phiếu nhập khi hoàn thành (sửa) hoặc Huỷ"), nhưng KHÔNG phải
 * bằng cách sửa đè lên một chứng từ đã vào kho và vào sổ nợ. Cách làm:
 *
 *     huỷ bản cũ  →  ghi lại dòng mới  →  hoàn thành lại
 *
 * cả ba bước gọi đúng hai RPC đã có, mỗi RPC một giao dịch. Nghĩa là
 * phép sửa THỪA HƯỞNG luôn mọi chốt chặn của phép huỷ: hàng đã xuất bớt
 * hoặc đã trả tiền thì không sửa được, và người dùng nhận đúng câu nói
 * rõ mặt hàng nào đang kẹt.
 *
 * ⚠ BA BƯỚC KHÔNG NẰM TRONG MỘT GIAO DỊCH. Mạng rớt giữa chừng thì
 * phiếu nằm lại ở trạng thái đã huỷ — kho và công nợ ĐÃ hoàn về đúng,
 * không có gì lệch, chỉ là phiếu chưa được lập lại. Màn này nói rõ điều
 * đó khi hỏng, để người dùng vào lại bấm Hoàn thành chứ không tưởng mất
 * hàng. Muốn đúng một giao dịch thì phải có một RPC `reissue` riêng —
 * ghi ra đây để lần sau không phải suy lại.
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
  PurchaseReceiptForm, type PurchaseReceiptFormValue,
} from "@/components/purchasing/purchase-receipt-form"
import { loadPickerExtras, type PickerExtra } from "@/lib/purchasing/picker-extras"
import {
  receiptTotals, validReceiptLines, friendlyReceiptError,
  type ReceiptLine, type ReceiptProduct,
} from "@/lib/purchasing/receipt-form"
import { percentToRatio, ratioToPercent } from "@/lib/purchasing/return-form"
import { saveReceiptLines } from "@/lib/purchasing/save-receipt"
import type { Supplier } from "@/types"
import { loadCatalogue } from "@/lib/products/load-catalogue"
import { errorMessage } from "@/lib/errors"

export default function EditPurchaseReceiptPage() {
  const { id } = useParams<{ id: string }>()
  const { loading: authLoading } = useRoleGuard("inventory")
  const { user } = useAuth()
  const router = useRouter()
  const supabase = createClient()
  const { toast } = useToast()

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<ReceiptProduct[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [extras, setExtras] = useState<Record<string, PickerExtra>>({})
  const [form, setForm] = useState<PurchaseReceiptFormValue>({
    supplierId: "", invoiceNumber: "",
    invoiceDate: new Date().toISOString().slice(0, 10),
    zone: "sale", discount: "", vatOverride: "", notes: "", lines: [],
  })

  const patch = (p: Partial<PurchaseReceiptFormValue>) => setForm((f) => ({ ...f, ...p }))

  const fillExtras = useCallback(async (prods: ReceiptProduct[]) => {
    setExtras(await loadPickerExtras(supabase, prods))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const [supRes, prodRes, hRes, lRes] = await Promise.all([
      supabase.from("suppliers").select("id, name, code")
        .eq("org_id", user.org_id).eq("is_active", true).order("name"),
      loadCatalogue<ReceiptProduct>(supabase, "id, name, sku, barcode, base_unit, cost_price, vat_rate, shelf_life_days, primary_supplier_id, units:product_units(*)", { orgId: user.org_id }),
      supabase.from("purchase_invoices")
        .select("id, supplier_id, invoice_number, invoice_date, warehouse_zone, discount, vat_override, notes, status")
        .eq("id", id).maybeSingle(),
      supabase.from("purchase_invoice_lines")
        .select("id, product_id, unit_name, quantity, unit_price, line_discount, vat_rate, conversion_factor, notes, sort_order")
        .eq("invoice_id", id).order("sort_order"),
    ])
    /* ⚠ `rows`, KHÔNG PHẢI `data` — danh mục nay kéo ĐỦ theo trang,
       không dừng ở 1.000 mã đầu. Xem `loadCatalogue`. */
    const prods = prodRes.rows
    setSuppliers((supRes.data as Supplier[]) || [])
    setProducts(prods)
    /* NCC và tồn kho cho ô tìm — nạp NỀN, không chặn màn. */
    void fillExtras(prods)

    const h = hRes.data as {
      supplier_id: string; invoice_number: string | null; invoice_date: string | null
      warehouse_zone: string | null; discount: number | null; vat_override: number | null
      notes: string | null; status: string
    } | null
    if (!h) { setLoading(false); return }
    setStatus(h.status)

    /**
     * ⚠ DỰNG LẠI DÒNG TỪ PHIẾU ĐÃ LƯU, KHÔNG TỪ DANH MỤC. Số lượng, đơn
     *   giá, giảm giá và thuế suất đã ghi xuống là thứ người dùng gõ;
     *   lấy lại từ `products` là lặng lẽ đè lên chúng bằng giá vốn hôm
     *   nay. Chỉ tên hàng, đơn vị cơ sở và bảng quy đổi mới tra danh mục.
     */
    setForm({
      supplierId: h.supplier_id,
      invoiceNumber: h.invoice_number || "",
      invoiceDate: h.invoice_date || new Date().toISOString().slice(0, 10),
      zone: h.warehouse_zone || "sale",
      discount: h.discount ? String(h.discount) : "",
      /* ⚠ `null` → ô TRỐNG (máy tự cộng); 0 → ô ghi "0" (hoá đơn không
         thuế). Dùng `?? ""` chứ không `|| ""` — `|| ""` biến số 0 thành
         ô trống và mất hẳn nghĩa "không thuế". */
      vatOverride: h.vat_override == null ? "" : String(h.vat_override),
      notes: h.notes || "",
      lines: ((lRes.data as Array<{
        id: string; product_id: string; unit_name: string; quantity: number
        unit_price: number; line_discount: number | null; vat_rate: number | null
        conversion_factor: number | null; notes: string | null
      }>) || []).map((l): ReceiptLine => {
        const p = prods.find((x) => x.id === l.product_id)
        return {
          id: l.id,
          product_id: l.product_id,
          /* Mã đã xoá khỏi danh mục vẫn phải hiện ra — vẽ một dòng không
             tên là giấu mất chính thứ cần sửa. */
          product_name: p?.name || "Sản phẩm đã xoá",
          sku: p?.sku || "",
          note: l.notes || "",
          unit_name: l.unit_name,
          quantity: String(l.quantity),
          unit_price: String(l.unit_price),
          line_discount: l.line_discount ? String(l.line_discount) : "",
          /* ⚠ CỘT LƯU LÀ TIỀN, nên dòng nạp lại LUÔN ở chế độ tiền.
             Đoán ngược ra phần trăm là bịa — cùng một số tiền ra vô số
             phần trăm tuỳ giá. */
          discount_mode: "amount",
          vat_percent: ratioToPercent(l.vat_rate),
          conversion_factor: String(l.conversion_factor || 1),
          available_units: p?.units || [],
          base_unit: p?.base_unit || l.unit_name,
        }
      }),
    })
    setLoading(false)
  }, [id, user?.org_id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])


  const submit = async (complete: boolean) => {
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
       * ⚠ HUỶ TRƯỚC, và nếu bước này hỏng thì DỪNG HẲN. Đi tiếp khi kho
       *   chưa hoàn về là ghi đè dòng hàng của một phiếu vẫn đang giữ lô
       *   cũ trong kho — chứng từ nói một đằng, kho nói một nẻo.
       */
      if (wasCompleted) {
        const { error } = await supabase.rpc("cancel_purchase_invoice", {
          p_invoice_id: id, p_reason: "Sửa phiếu — lập lại",
        })
        if (error) throw new Error(friendlyReceiptError(error.message))
      }

      const { error: hErr } = await supabase
        .from("purchase_invoices")
        .update({
          supplier_id: form.supplierId,
          invoice_number: form.invoiceNumber.trim() || null,
          invoice_date: form.invoiceDate,
          warehouse_zone: form.zone,
          discount: totals.discount,
          notes: form.notes.trim() || null,
          /* ⚠ Ô TRỐNG → `null`, nghĩa là "để máy chủ tự cộng". Gửi 0
             lên là khai "hoá đơn này không có thuế". */
          vat_override: form.vatOverride.trim() === "" ? null : Number(form.vatOverride),
          subtotal: totals.subtotal, vat: totals.vat, total: totals.total,
          /* Phiếu vừa huỷ phải quay về phiếu tạm thì mới hoàn thành lại
             được — `complete_purchase_invoice` chỉ nhận `draft`. */
          status: "draft",
          cancelled_at: null, cancelled_by: null, cancel_reason: null,
        })
        .eq("id", id)
        .select("id")
      if (hErr) throw new Error(hErr.message)

      await saveReceiptLines(supabase, id, lines, percentToRatio)

      if (complete) {
        const { error } = await supabase.rpc("complete_purchase_invoice", { p_invoice_id: id })
        if (error) {
          throw new Error(
            `${friendlyReceiptError(error.message)} — Phiếu đã lưu lại thành PHIẾU TẠM và kho đã hoàn về đúng. Vào lại phiếu rồi bấm Hoàn thành.`
          )
        }
      }
      toast({ title: complete ? "Đã lập lại và hoàn thành phiếu" : "Đã lưu thay đổi" })
      router.push(`/purchasing/receipts/${id}`)
    } catch (e) {
      toast({ title: "Không lưu được", description: errorMessage(e), variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />

  if (status === "cancelled") {
    return (
      <div className="space-y-4">
        <PageHeader title="Không sửa được" backHref={`/purchasing/receipts/${id}`} />
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Phiếu này đã huỷ. Tạo phiếu nhập mới thay vì sửa lại một chứng từ đã đóng.
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-28">
      <PageHeader
        title="Sửa phiếu nhập hàng"
        description={
          status === "completed"
            ? "Phiếu đã hoàn thành: lưu lại sẽ hoàn kho và công nợ của bản cũ rồi lập lại theo số mới."
            : "Phiếu tạm — sửa thoải mái, chưa đụng tới kho hay công nợ."
        }
        backHref={`/purchasing/receipts/${id}`}
      />
      <PurchaseReceiptForm
        suppliers={suppliers}
        products={products}
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
              {status === "completed" ? "Lập lại" : "Hoàn thành"}
            </Button>
          </>
        }
      />
    </div>
  )
}
