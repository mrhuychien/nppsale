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

import { usePosDesktopRedirect } from "@/components/sell/pos-desktop-redirect"
import { posEditPurchaseHref } from "@/lib/nav/pos-preview"
import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { HopLoiTai } from "@/components/ui/hop-loi-tai"
import { useToast } from "@/hooks/use-toast"
import type { PurchaseReceiptFormValue } from "@/components/purchasing/purchase-receipt-form"
import { PhieuNccMobile } from "@/components/purchasing/phieu-ncc-mobile"
import { TruongPhieuNhap } from "@/components/purchasing/truong-phieu-ncc"
import { loadPickerExtras, type PickerExtra } from "@/lib/purchasing/picker-extras"
import {
  receiptTotals, validReceiptLines, friendlyReceiptError,
  type ReceiptLine, type ReceiptProduct,
} from "@/lib/purchasing/receipt-form"
import { percentToRatio, ratioToPercent } from "@/lib/purchasing/return-form"
import { saveReceiptLines, suaPhieuNhapDaXong } from "@/lib/purchasing/save-receipt"
import type { Supplier } from "@/types"
import { loadCatalogue } from "@/lib/products/load-catalogue"
import { errorMessage } from "@/lib/errors"

export default function EditPurchaseReceiptPage() {
  const { id } = useParams<{ id: string }>()
  /* Máy tính → màn POS (chủ nhà 24/09/2026: "tạo phiếu nhập hàng / trả hàng ncc trên desktop trên pos hết"). */
  usePosDesktopRedirect(posEditPurchaseHref(id))
  const { loading: authLoading } = useRoleGuard("inventory")
  const { user } = useAuth()
  const router = useRouter()
  const supabase = createClient()
  const { toast } = useToast()

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<ReceiptProduct[]>([])
  /** Danh mục đọc chưa hết — ô tìm phải nói ra. */
  const [catTruncated, setCatTruncated] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
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
    /* ⚠ ĐỌC HỎNG THÌ DỪNG, KHÔNG DỰNG FORM. Dòng hàng đọc hỏng mà vẫn dựng form là một phiếu KHÔNG DÒNG nào — thêm một
       dòng rồi Lưu là lưu đè cả phiếu bằng đúng một dòng ấy (mất hàng, lệch kho, lệch công nợ NCC). Phiếu đọc hỏng /
       không có cũng thế: một form trống mang mã của một phiếu có thật. */
    const loi = supRes.error || hRes.error || lRes.error
    if (loi || !hRes.data) {
      setLoadError(loi ? errorMessage(loi, "Không đọc được phiếu nhập") : "Không tìm thấy phiếu nhập này.")
      setLoading(false)
      return
    }
    setLoadError(null)
    /* ⚠ `rows`, KHÔNG PHẢI `data` — danh mục nay kéo ĐỦ theo trang,
       không dừng ở 1.000 mã đầu. Xem `loadCatalogue`. */
    const prods = prodRes.rows
    setSuppliers((supRes.data as Supplier[]) || [])
    setProducts(prods)
    setCatTruncated(prodRes.truncated)
    /* NCC và tồn kho cho ô tìm — nạp NỀN, không chặn màn. */
    void fillExtras(prods)

    const h = hRes.data as {
      supplier_id: string; invoice_number: string | null; invoice_date: string | null
      warehouse_zone: string | null; discount: number | null; vat_override: number | null
      notes: string | null; status: string
    }
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
      const dauPhieu = {
        supplier_id: form.supplierId,
        invoice_number: form.invoiceNumber.trim() || null,
        invoice_date: form.invoiceDate,
        warehouse_zone: form.zone,
        discount: totals.discount,
        notes: form.notes.trim() || null,
        /* ⚠ Ô TRỐNG → `null`, nghĩa là "để máy chủ tự cộng". Gửi 0 lên là khai "hoá đơn này không có thuế". */
        vat_override: form.vatOverride.trim() === "" ? null : Number(form.vatOverride),
      }
      /**
       * ⚠ PHIẾU ĐÃ HOÀN THÀNH: SỬA TẠI CHỖ (mig 235) — chủ nhà 06/10/2026: "những phiếu nhập hàng từ NCC đã bán hàng
       *   ra không sửa được, tao muốn sửa được". Không huỷ-rồi-lập-lại nữa (huỷ bị chặn khi hàng đã bán / đã trả tiền
       *   NCC); RPC giữ lô, sửa công nợ, tính lại giá vốn phần đã bán — một giao dịch, hỏng thì không đổi gì.
       */
      if (wasCompleted) {
        try {
          await suaPhieuNhapDaXong(supabase, id, dauPhieu, lines, percentToRatio)
        } catch (e) {
          throw new Error(friendlyReceiptError(errorMessage(e)))
        }
        toast({ title: "Đã sửa phiếu nhập" })
        router.push(`/purchasing/receipts/${id}`)
        return
      }

      const { error: hErr } = await supabase
        .from("purchase_invoices")
        .update({ ...dauPhieu, subtotal: totals.subtotal, vat: totals.vat, total: totals.total })
        .eq("id", id)
        .select("id")
      if (hErr) throw new Error(hErr.message)

      await saveReceiptLines(supabase, id, lines, percentToRatio)

      if (complete) {
        const { error } = await supabase.rpc("complete_purchase_invoice", { p_invoice_id: id })
        if (error) {
          throw new Error(
            `${friendlyReceiptError(error.message)} — Phiếu đã lưu thành PHIẾU TẠM. Vào lại phiếu rồi bấm Hoàn thành.`
          )
        }
      }
      toast({ title: complete ? "Đã hoàn thành phiếu" : "Đã lưu thay đổi" })
      router.push(`/purchasing/receipts/${id}`)
    } catch (e) {
      toast({ title: "Không lưu được", description: errorMessage(e), variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />

  if (loadError) {
    return (
      <div className="space-y-4">
        <PageHeader title="Không mở được phiếu nhập" backHref={`/purchasing/receipts/${id}`} />
        <HopLoiTai tieuDe="Không tải được phiếu nhập để sửa" loi={loadError} onRetry={load} />
      </div>
    )
  }

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

  /* ⚠ Cùng khung với màn TẠO (chủ nhà 05/10/2026: "sửa phiếu nhập hàng ncc chưa quay về giống phần tạo phiếu mà
     dùng form riêng (trên di động)"). Máy tính đã chuyển sang POS ở đầu màn. */
  const daXong = status === "completed"
  return (
    <PhieuNccMobile
      kind="nhap"
      suppliers={suppliers}
      products={products}
      catalogueTruncated={catTruncated}
      extras={extras}
      value={form}
      onChange={patch}
      submitting={submitting}
      onDraft={() => submit(false)}
      onDone={() => submit(true)}
      backHref={`/purchasing/receipts/${id}`}
      buocDau="phieu"
      chuRieng={{
        them: "Sửa phiếu nhập",
        phieu: "Sửa phiếu nhập hàng",
        xong: daXong ? "Lưu sửa" : "Hoàn thành",
        goiY: daXong
          ? "Phiếu đã hoàn thành: Lưu sửa = sửa kho + công nợ NCC theo số mới (hàng đã bán vẫn giữ; SL không thấp hơn số đã xuất)."
          : "Phiếu tạm — Hoàn thành = nhập kho + ghi công nợ NCC.",
      }}
      fields={<TruongPhieuNhap form={form} patch={patch} />}
    />
  )
}
