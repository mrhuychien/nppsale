"use client"

/**
 * SỬA HỒ SƠ NHÀ CUNG CẤP — tấm trượt phải ở màn chi tiết (thiết kế "ncc chi tiết", chủ nhà 05/10/2026). Mở từ
 * "Sửa thông tin" / "Cập nhật" (tab pháp lý) / "Bổ sung" (khối Cần hoàn thiện — nhảy thẳng tới ô thiếu).
 */
import { useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { SupplierFields } from "@/components/suppliers/supplier-fields"
import { nccFormTu, nccPayload, type NccForm } from "@/lib/suppliers/form"
import type { NccHoSo, TruongSua } from "@/lib/suppliers/chi-tiet"
import { ghiPhaiTrungDong } from "@/lib/db/must-write"
import { errorMessage } from "@/lib/errors"

export function SupplierEditSheet({
  open,
  onOpenChange,
  supplier,
  focus,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  supplier: NccHoSo & { is_verified?: boolean | null }
  /** Ô cần nhảy tới khi mở (nút "Bổ sung"). */
  focus?: TruongSua | null
  onSaved: () => void
}) {
  const [form, setForm] = useState<NccForm>(() => nccFormTu(supplier))
  const goc = useRef<NccForm>(nccFormTu(supplier))
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  // Mỗi lần mở: nạp lại từ bản đang có, rồi nhảy tới ô thiếu (đợi tấm trượt mở xong).
  useEffect(() => {
    if (!open) return
    const f = nccFormTu(supplier)
    goc.current = f
    setForm(f)
    if (!focus) return
    const t = setTimeout(() => {
      const el = document.getElementById(`ncc-${focus}`)
      el?.scrollIntoView({ block: "center" })
      el?.focus()
    }, 350)
    return () => clearTimeout(t)
  }, [open, focus]) // eslint-disable-line react-hooks/exhaustive-deps

  const luu = async () => {
    const { payload, loi } = nccPayload(form, goc.current)
    if (loi) {
      toast({ title: loi, variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      await ghiPhaiTrungDong(createClient().from("suppliers").update(payload).eq("id", supplier.id))
      toast({ title: "Đã cập nhật nhà cung cấp" })
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast({ title: "Không lưu được", description: errorMessage(err), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[560px]" data-testid="ncc-sua">
        <SheetHeader className="border-b px-5 py-4 text-left">
          <SheetTitle>Sửa thông tin nhà cung cấp</SheetTitle>
          <SheetDescription>{supplier.name}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <SupplierFields form={form} onChange={(p) => setForm((f) => ({ ...f, ...p }))} />
        </div>
        <div className="flex gap-2 border-t px-5 py-3 pb-safe">
          <Button variant="outline" className="h-11 flex-1 lg:h-10" onClick={() => onOpenChange(false)} disabled={saving}>Huỷ</Button>
          <Button className="h-11 flex-1 lg:h-10" onClick={luu} disabled={saving || !form.name.trim()} title={!form.name.trim() ? "Nhập tên nhà cung cấp" : undefined}>
            {saving ? "Đang lưu..." : "Lưu thay đổi"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
