"use client"

/**
 * BIỂU MẪU TUYẾN BÁN HÀNG — tách khỏi màn /customers/routes để khung tạo nhanh tuyến dùng chung
 * (chủ nhà 03/10/2026, Update 3.10). Sửa tuyến đổi mã thì kéo theo mã tuyến ở mọi khách (như trước).
 */
import { useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { errorMessage } from "@/lib/errors"
import { ghiPhaiTrungDong } from "@/lib/db/must-write"
import { xoaNhoNen } from "@/lib/cache/nho-nen"
import { chuBanDauTuyen, type TuyenVuaTao } from "@/lib/customers/tuyen"
import type { SalesRoute } from "@/types"

export function RouteForm({
  editing,
  chuBanDau,
  thuTuMacDinh = 0,
  onDaLuu,
  onHuy,
}: {
  /** Có = sửa tuyến này; không = tạo mới. */
  editing?: SalesRoute | null
  /** Chữ đang gõ ở ô tìm tuyến — gán sẵn vào mã hoặc tên (`chuBanDauTuyen`). */
  chuBanDau?: string
  thuTuMacDinh?: number
  onDaLuu: (tuyen: TuyenVuaTao) => void
  onHuy: () => void
}) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  /** Chống bấm Lưu hai lần — `saving` chưa kịp vẽ lại thì cú bấm thứ hai vẫn lọt. */
  const khoa = useRef(false)
  const [form, setForm] = useState(() => {
    if (editing) {
      return {
        code: editing.code,
        name: editing.name,
        description: editing.description || "",
        sort_order: editing.sort_order,
        is_active: editing.is_active,
      }
    }
    const dau = chuBanDauTuyen(chuBanDau)
    return { code: dau.code, name: dau.name, description: "", sort_order: thuTuMacDinh, is_active: true }
  })

  const handleSave = async () => {
    if (!user?.org_id || khoa.current) return
    const code = form.code.trim().toUpperCase()
    const name = form.name.trim()
    if (!code || !name) {
      toast({ title: "Thiếu mã hoặc tên tuyến", variant: "destructive" })
      return
    }
    const supabase = createClient()
    khoa.current = true
    setSaving(true)
    try {
      if (editing) {
        // RLS từ chối = 0 dòng, không lỗi — đếm dòng trước khi đổi mã tuyến
        // ở hàng nghìn khách theo sau.
        await ghiPhaiTrungDong(
          supabase
            .from("sales_routes")
            .update({
              code,
              name,
              description: form.description.trim() || null,
              sort_order: form.sort_order,
              is_active: form.is_active,
            })
            .eq("id", editing.id)
        )
        // If the code changed, update every customer row that referenced the old code
        if (editing.code !== code) {
          // Nếu bước này hỏng mà bỏ qua: tuyến đã đổi mã nhưng khách hàng
          // vẫn trỏ mã cũ → khách rơi khỏi mọi báo cáo theo tuyến.
          await supabase
            .from("customers")
            .update({ channel: code })
            .eq("org_id", user.org_id)
            .eq("channel", editing.code)
            .throwOnError()
        }
        xoaNhoNen("nen:tuyen") // ô lọc tuyến ở danh sách đơn / hoá đơn thấy tên mới ngay
        toast({ title: `Đã cập nhật tuyến ${code}` })
        onDaLuu({ id: editing.id, code, name })
      } else {
        const { data, error } = await supabase
          .from("sales_routes")
          .insert({
            org_id: user.org_id,
            code,
            name,
            description: form.description.trim() || null,
            sort_order: form.sort_order,
            is_active: form.is_active,
          })
          .select("id, code, name")
          .single()
        if (error) throw error
        xoaNhoNen("nen:tuyen")
        toast({ title: `Đã tạo tuyến ${code}` })
        const r = data as { id: string; code: string; name: string } | null
        onDaLuu({ id: r?.id ?? code, code: r?.code ?? code, name: r?.name ?? name })
      }
    } catch (err) {
      const msg = errorMessage(err, "Lỗi khi lưu")
      toast({ title: "Không lưu được tuyến", description: msg, variant: "destructive" })
    } finally {
      khoa.current = false
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4" data-testid="route-form">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="route-code">Mã tuyến *</Label>
          <Input
            id="route-code"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            placeholder="GT"
            className="font-mono uppercase"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="route-name">Tên tuyến *</Label>
          <Input
            id="route-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="General Trade"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Mô tả</Label>
          <Textarea
            rows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Chi tiết khu vực, đặc điểm KH..."
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Thứ tự hiển thị</Label>
            <Input
              type="text"
              inputMode="numeric"
              value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value.replace(/\D/g, "")) || 0 })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Trạng thái</Label>
            <label className="flex items-center gap-2 h-10 px-3 rounded-md border cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                className="h-4 w-4"
              />
              <span className="text-sm">Đang hoạt động</span>
            </label>
          </div>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onHuy} disabled={saving}>
          Hủy
        </Button>
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? "Đang lưu..." : editing ? "Cập nhật" : "Tạo tuyến"}
        </Button>
      </div>
    </div>
  )
}
