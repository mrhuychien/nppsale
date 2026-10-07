"use client"

/**
 * ĐỔI NGÀY PHIẾU TRẢ — chủ nhà 08/10/2026: "phiếu tự sinh theo đơn đặt hàng tao cũng muốn sửa được ngày tháng".
 * Luật ở `loiDoiNgayPhieuTra` / `giaiThichDoiNgay` (src/lib/returns/loai-phieu.ts).
 */
import { useState } from "react"
import { CalendarDays, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createClient } from "@/lib/supabase/client"
import { errorMessage } from "@/lib/errors"
import { useToast } from "@/hooks/use-toast"
import { vnDateKey } from "@/lib/orders/status-tone"
import { formatDate } from "@/lib/utils"
import { giaiThichDoiNgay, loiDoiNgayPhieuTra, type PhieuTraXet } from "@/lib/returns/loai-phieu"

export function DoiNgayPhieuTra({
  phieu,
  ngay,
  onDaDoi,
}: {
  phieu: PhieuTraXet & { id: string; created_at: string }
  /** Ngày chứng từ đang lưu (`return_date`); null = phiếu cũ chưa có, lấy ngày lập. */
  ngay: string | null
  onDaDoi: (ngayMoi: string) => void
}) {
  const { toast } = useToast()
  const hienTai = ngay ?? vnDateKey(new Date(phieu.created_at))
  const [mo, setMo] = useState(false)
  const [gt, setGt] = useState(hienTai)
  const [dang, setDang] = useState(false)
  const homNay = vnDateKey(new Date())
  const loi = loiDoiNgayPhieuTra(phieu, gt, homNay)

  const luu = async () => {
    if (loi || dang) return
    if (gt === hienTai) {
      setMo(false)
      return
    }
    setDang(true)
    try {
      const { data, error } = await createClient().from("returns").update({ return_date: gt }).eq("id", phieu.id).select("id")
      if (error) throw new Error(error.message)
      /* ⚠ RLS từ chối = 0 dòng, HTTP 200 — đừng báo "đã đổi". */
      if (!data || data.length === 0) throw new Error("Không đổi được ngày — bạn không có quyền sửa phiếu trả này.")
      toast({ title: `Đã đổi ngày phiếu sang ${formatDate(gt)}` })
      onDaDoi(gt)
      setMo(false)
    } catch (e) {
      toast({ title: "Không đổi được ngày phiếu", description: errorMessage(e), variant: "destructive" })
    } finally {
      setDang(false)
    }
  }

  if (!mo) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-testid="doi-ngay-phieu-tra"
        onClick={() => {
          setGt(hienTai)
          setMo(true)
        }}
      >
        <CalendarDays className="mr-1.5 h-4 w-4" /> Đổi ngày
      </Button>
    )
  }
  return (
    <div className="flex w-full flex-col gap-1.5 rounded-xl border bg-card p-3 sm:w-auto" data-testid="khung-doi-ngay">
      <label htmlFor="ngay-phieu-tra" className="text-xs uppercase tracking-wider text-muted-foreground">
        Ngày phiếu
      </label>
      <div className="flex items-center gap-2">
        <Input id="ngay-phieu-tra" type="date" max={homNay} value={gt} onChange={(e) => setGt(e.target.value)} className="h-9 w-44" />
        <Button type="button" size="sm" onClick={luu} disabled={!!loi || dang} title={loi ?? undefined}>
          {dang ? <Loader2 className="h-4 w-4 animate-spin" /> : "Lưu"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setMo(false)} disabled={dang}>
          Huỷ
        </Button>
      </div>
      <p className="max-w-xs text-xs text-muted-foreground">{loi ?? giaiThichDoiNgay(phieu)}</p>
    </div>
  )
}
