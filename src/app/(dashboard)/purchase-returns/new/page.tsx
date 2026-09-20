"use client"

/**
 * TẠO PHIẾU TRẢ HÀNG NCC.
 *
 * ⚠ BIỂU MẪU NẰM Ở `PurchaseReturnForm`, dùng chung với màn sửa. Trang
 * này chỉ còn ba việc: nạp danh mục, dựng phiếu, và ghi xuống.
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
  PurchaseReturnForm, type PurchaseReturnFormValue,
} from "@/components/purchasing/purchase-return-form"
import {
  friendlyReturnError, linePayload, returnTotals, validReturnLines,
  type ReturnProduct,
} from "@/lib/purchasing/return-form"
import type { Supplier } from "@/types"
import { errorMessage } from "@/lib/errors"

export default function NewPurchaseReturnPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const { user } = useAuth()
  const router = useRouter()
  const supabase = createClient()
  const { toast } = useToast()

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<ReturnProduct[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState<PurchaseReturnFormValue>(() => ({
    supplierId: "",
    returnDate: new Date().toISOString().slice(0, 10),
    zone: "date",
    reason: "near_expiry",
    notes: "",
    /* ⚠ MỞ RA LÀ PHIẾU RỖNG, không phải một dòng trống dựng sẵn. */
    lines: [],
  }))

  const patch = (p: Partial<PurchaseReturnFormValue>) => setForm((f) => ({ ...f, ...p }))

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
        supabase
          .from("products")
          .select("id, name, sku, barcode, base_unit, cost_price, vat_rate, units:product_units(*)")
          .eq("org_id", user.org_id)
          .order("name"),
      ])
      if (cancelled) return
      const qErr = ([supRes, prodRes] as Array<{ error?: { message?: string } | null }>)
        .find((r) => r?.error)?.error
      if (qErr) console.error("[purchase-returns/new] truy vấn lỗi:", qErr.message)
      setSuppliers((supRes.data as Supplier[]) || [])
      setProducts((prodRes.data as ReturnProduct[]) || [])
    })()
    return () => { cancelled = true }
  }, [user?.org_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (asDraft: boolean) => {
    if (!user?.org_id) return
    if (!form.supplierId) {
      toast({ title: "Chưa chọn nhà cung cấp", variant: "destructive" })
      return
    }
    const lines = validReturnLines(form.lines)
    if (lines.length === 0) {
      toast({ title: "Chưa có dòng hàng hợp lệ", variant: "destructive" })
      return
    }
    const totals = returnTotals(lines)

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
          notes: form.notes || null,
          subtotal: totals.sub,
          vat: totals.vat,
          total: totals.total,
          status: "draft",
          created_by: user.id,
        })
        .select()
        .single()
      if (hdrErr || !header) throw new Error(hdrErr?.message || "Tạo phiếu thất bại")
      const returnId = (header as { id: string }).id

      const { error: linesErr } = await supabase
        .from("supplier_return_lines")
        .insert(lines.map((l) => linePayload(returnId, l)))
      if (linesErr) throw new Error(linesErr.message)

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
        value={form}
        onChange={patch}
        submitting={submitting}
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
