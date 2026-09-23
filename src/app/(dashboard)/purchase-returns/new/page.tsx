"use client"

/**
 * TẠO PHIẾU TRẢ HÀNG NCC.
 *
 * ⚠ BIỂU MẪU NẰM Ở `PurchaseReturnForm`, dùng chung với màn sửa. Trang
 * này chỉ còn ba việc: nạp danh mục, dựng phiếu, và ghi xuống.
 *
 * ⚠ MÀN NÀY KHÔNG TỰ TRỪ KHO VÀ KHÔNG TỰ GHI CÔNG NỢ — đó là việc của
 * `complete_supplier_return`, một giao dịch. Số tiền gửi lên chỉ để xem
 * trên danh sách khi phiếu còn là nháp; lúc gửi, RPC tính lại từ dòng
 * hàng và ghi số của NÓ vào công nợ NCC (migration 146).
 */

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
  PurchaseReturnForm, type PurchaseReturnFormValue,
} from "@/components/purchasing/purchase-return-form"
import { friendlyReturnError, percentToRatio } from "@/lib/purchasing/return-form"
import {
  receiptTotals, validReceiptLines, type ReceiptProduct,
} from "@/lib/purchasing/receipt-form"
import { loadPickerExtras, type PickerExtra } from "@/lib/purchasing/picker-extras"
import { saveReturnLines } from "@/lib/purchasing/save-receipt"
import type { Supplier } from "@/types"
import { loadCatalogue } from "@/lib/products/load-catalogue"
import { errorMessage } from "@/lib/errors"

export default function NewPurchaseReturnPage() {
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
  const [form, setForm] = useState<PurchaseReturnFormValue>(() => ({
    supplierId: "",
    returnDate: new Date().toISOString().slice(0, 10),
    zone: "date",
    reason: "near_expiry",
    discount: "",
    vatOverride: "",
    notes: "",
    /* ⚠ MỞ RA LÀ PHIẾU RỖNG, không phải một dòng trống dựng sẵn. */
    lines: [],
  }))

  const patch = (p: Partial<PurchaseReturnFormValue>) => setForm((f) => ({ ...f, ...p }))

  const fillExtras = useCallback(async (prods: ReceiptProduct[]) => {
    setExtras(await loadPickerExtras(supabase, prods))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user?.org_id) return
    let cancelled = false
    ;(async () => {
      const [supRes, prodRes] = await Promise.all([
        supabase
          .from("suppliers")
          .select("id, name, code")
          .eq("org_id", user.org_id)
          .eq("is_active", true)
          .order("name"),
        loadCatalogue<ReceiptProduct>(supabase, "id, name, sku, barcode, base_unit, cost_price, vat_rate, primary_supplier_id, units:product_units(*)", { orgId: user.org_id }),
      ])
      if (cancelled) return
      const qErr = ([supRes] as Array<{ error?: { message?: string } | null }>)
        .find((r) => r?.error)?.error
      if (qErr) console.error("[purchase-returns/new] truy vấn lỗi:", qErr.message)
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

  const handleSubmit = async (asDraft: boolean) => {
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
      const { data: header, error: hdrErr } = await supabase
        .from("supplier_returns")
        .insert({
          org_id: user.org_id,
          supplier_id: form.supplierId,
          return_date: form.returnDate,
          warehouse_zone: form.zone,
          reason: form.reason || null,
          notes: form.notes.trim() || null,
          discount: totals.discount,
          /* ⚠ Ô TRỐNG → `null`, nghĩa là "để máy chủ tự cộng". Gửi 0 lên
             là khai "chứng từ này không có thuế". */
          vat_override: form.vatOverride.trim() === "" ? null : Number(form.vatOverride),
          /* ⚠ BA SỐ NÀY CHỈ ĐỂ XEM TRÊN DANH SÁCH KHI CÒN LÀ NHÁP. Lúc
             gửi, RPC tính lại từ dòng hàng và ghi đè — nó mới là số đi
             vào công nợ NCC. */
          subtotal: totals.subtotal,
          vat: totals.vat,
          total: totals.total,
          status: "draft",
          created_by: user.id,
        })
        .select("id")
        .single()
      if (hdrErr || !header) throw new Error(hdrErr?.message || "Tạo phiếu thất bại")
      const returnId = (header as { id: string }).id

      await saveReturnLines(supabase, returnId, lines, percentToRatio)

      if (!asDraft) {
        const { error: rpcErr } = await supabase.rpc("complete_supplier_return", {
          p_return_id: returnId,
        })
        if (rpcErr) throw new Error(friendlyReturnError(rpcErr.message))
      }

      toast({
        title: asDraft ? "Đã lưu phiếu nháp" : "Đã gửi phiếu — xuất kho + giảm công nợ NCC",
      })
      router.push(`/purchase-returns/${returnId}`)
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
        Vai trò của bạn không lập được phiếu trả NCC. Nhờ chủ NPP, quản lý, kế toán hoặc thủ kho lập giúp.
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-28">
      <PageHeader
        title="Tạo phiếu trả NCC"
        description="Khi gửi phiếu hệ thống sẽ tự xuất kho và giảm công nợ NCC"
        backHref="/purchase-returns"
      />

      <PurchaseReturnForm
        suppliers={suppliers}
        products={products}
        catalogueTruncated={catTruncated}
        value={form}
        onChange={patch}
        submitting={submitting}
        extras={extras}
        actions={
          <>
            <Button variant="outline" onClick={() => handleSubmit(true)} disabled={submitting}>
              Lưu nháp
            </Button>
            <Button onClick={() => handleSubmit(false)} disabled={submitting || form.lines.length === 0}>
              {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Gửi phiếu
            </Button>
          </>
        }
      />
    </div>
  )
}
