"use client"

/**
 * BIỂU MẪU NHÀ CUNG CẤP MỚI — tách khỏi /suppliers/new để khung tạo nhanh NCC dùng chung (chủ nhà 03/10/2026,
 * Update 3.10: "Khi tạo xong sản phẩm hoặc NCC -> bấm xong thì quay về phần đang làm"). Không có `onDaTao`
 * thì như cũ: lưu xong về /suppliers.
 */
import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { SupplierFields } from "@/components/suppliers/supplier-fields"
import { nccFormRong, nccPayload, type NccForm } from "@/lib/suppliers/form"
import { cauTrungMaNcc, laTrungMaNcc, maNccTiepTheo, SO_LAN_DANH_LAI_MA_NCC } from "@/lib/suppliers/ma-ncc"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { errorMessage } from "@/lib/errors"

/** NCC vừa tạo — đủ cho ô chọn NCC hiện ra và tự chọn. */
export interface NccVuaTao {
  id: string
  code: string
  name: string
}

export function SupplierForm({
  tenBanDau,
  onDaTao,
  onHuy,
}: {
  /** Tên gán sẵn — chữ đang gõ ở ô tìm NCC. */
  tenBanDau?: string
  /** Tạo nhanh tại chỗ: có thì lưu xong KHÔNG chuyển trang mà trả NCC vừa tạo. */
  onDaTao?: (ncc: NccVuaTao) => void
  /** Nút Huỷ (mặc định: lùi trang). */
  onHuy?: () => void
}) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  /** Chống bấm Lưu hai lần — `loading` chưa kịp vẽ lại thì cú bấm thứ hai vẫn lọt. */
  const khoa = useRef(false)
  const [form, setForm] = useState<NccForm>(() => nccFormRong(tenBanDau ?? ""))
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const { payload: duLieu, loi } = nccPayload(form)
    if (loi) {
      toast({ title: loi, variant: "destructive" })
      return
    }
    if (khoa.current) return
    khoa.current = true
    setLoading(true)

    try {
      /* Ô Mã NCC trống → tự đánh: số đuôi LỚN NHẤT của các mã "NCC-<số>" + 1, KHÔNG phải "số NCC + 1" (chủ nhà 22/11/2026 —
         xoá một NCC là số đếm trùng mã đã dùng, không tạo được NCC nào nữa). Xem `@/lib/suppliers/ma-ncc`. */
      let code = form.code.trim()
      const tuDanh = !code
      const daCo: string[] = []
      if (tuDanh) {
        /* Đọc MỌI mã (sổ NCC nhỏ) — `maNccTiepTheo` tự bỏ mã khác dạng. Không lọc `ilike` ở đây: ô tìm mới đi qua lib/search. */
        const res = await fetchAllForAggregate<{ code: string | null }>((from, to) =>
          supabase.from("suppliers").select("code", { count: "exact" }).order("id").range(from, to)
        )
        // Đọc hỏng vẫn thử ghi: máy chủ báo trùng thì vòng dưới đánh mã tiếp.
        if (res.error) console.error("[suppliers/new] đọc mã NCC đang có lỗi:", res.error)
        for (const r of res.rows) if (r.code) daCo.push(r.code)
        code = maNccTiepTheo(daCo)
      }

      const payload = { ...duLieu, name: form.name.trim(), org_id: user?.org_id, code }
      let { data, error } = await supabase.from("suppliers").insert(payload).select("id, code, name").single()
      /* Mã tự đánh vẫn trùng (NCC vừa tạo ở máy khác cùng lúc) → đánh mã kế tiếp, vài lần. */
      for (let lan = 0; tuDanh && error && laTrungMaNcc(error) && lan < SO_LAN_DANH_LAI_MA_NCC; lan++) {
        daCo.push(payload.code)
        payload.code = maNccTiepTheo(daCo)
        ;({ data, error } = await supabase.from("suppliers").insert(payload).select("id, code, name").single())
      }
      code = payload.code
      if (error && !tuDanh && laTrungMaNcc(error)) throw new Error(cauTrungMaNcc(code))
      if (error) throw error

      toast({ title: "Đã tạo nhà cung cấp mới" })
      // Tạo nhanh tại chỗ: trả NCC cho nơi gọi, ở lại trang đang làm.
      const r = data as { id: string; code: string | null; name: string } | null
      if (onDaTao) {
        if (r?.id) onDaTao({ id: r.id, code: r.code ?? code, name: r.name ?? payload.name })
        else {
          toast({ title: "Đã lưu NCC nhưng chưa đọc lại được mã", description: "Gõ tìm lại NCC trong ô chọn.", variant: "destructive" })
          onHuy?.()
        }
        return
      }
      router.push("/suppliers")
      router.refresh()
    } catch (err: unknown) {
      const message = errorMessage(err)
      toast({ title: "Không tạo được nhà cung cấp", description: message, variant: "destructive" })
    } finally {
      khoa.current = false
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" data-testid="supplier-form">
      <SupplierFields form={form} onChange={(p) => setForm((f) => ({ ...f, ...p }))} />

      {/* Actions */}
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" onClick={() => (onHuy ? onHuy() : router.back())}>
          Hủy
        </Button>
        <Button type="submit" disabled={loading} className="bg-primary text-on-primary shadow-card">
          {loading ? "Đang lưu..." : "Tạo mới"}
        </Button>
      </div>
    </form>
  )
}
