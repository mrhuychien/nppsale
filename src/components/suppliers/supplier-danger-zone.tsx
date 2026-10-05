"use client"

/**
 * VÙNG NGUY HIỂM — xoá / ngừng hợp tác / gộp NCC (chủ nhà 05/10/2026: "Xem lại phần xóa NCC?", mig 232).
 *
 *  · Bấm "Xóa nhà cung cấp" (CHỈ Chủ NPP — chủ nhà 05/10/2026 "Chỉ NPP được xoá") → hỏi máy chủ `so_chung_tu_ncc` TRƯỚC:
 *      – chưa có gì → hỏi xác nhận tại chỗ rồi xoá;
 *      – chưa có chứng từ, chỉ còn N mặt hàng gắn NCC chính → hỏi "Xoá luôn N mặt hàng…?" (chủ nhà 05/10/2026):
 *        Xoá NCC và mặt hàng (mặt hàng đã có trong phiếu chuyển Ngừng bán) / Chỉ xoá NCC, giữ mặt hàng / Hủy;
 *      – đã có phiếu nhập / phiếu trả / công nợ / mặt hàng… → KHÔNG xoá, kể ra số chứng từ, mời "Ngừng hợp tác"
 *        (ẩn khỏi ô chọn NCC, chứng từ cũ giữ nguyên) hoặc "Gộp vào NCC khác".
 *  · Xoá đi RPC `xoa_nha_cung_cap(p_id, p_xoa_hang)` (mig 233) — một giao dịch; trình duyệt không xoá thẳng `suppliers`.
 *    Máy chủ vẫn chặn ở trigger `trg_ncc_chan_xoa` — màn hình chỉ nói trước cho rõ.
 */
import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { ghiPhaiTrungDong } from "@/lib/db/must-write"
import { errorMessage } from "@/lib/errors"
import { formatCurrency } from "@/lib/utils"
import {
  buocXoaNcc, loiNcc, moTaChungTu, moTaKetQuaXoaNcc, soMatHangNcc, type KetQuaXoaNcc, type SoChungTuNcc,
} from "@/lib/suppliers/chi-tiet"

type TrangThai =
  | { b: "nghi" }
  | { b: "dang-hoi" }
  | { b: "xac-nhan" }
  | { b: "hoi-mat-hang"; soHang: number }
  | { b: "co-chung-tu"; so: SoChungTuNcc }

const thongDiep = (err: unknown) => loiNcc((err as { message?: string } | null)?.message || errorMessage(err))

export function SupplierDangerZone({
  supplier,
  canDelete,
  canEdit,
  canMerge,
  onDeleted,
  onDeactivated,
  onMerge,
}: {
  supplier: { id: string; name: string; is_active: boolean | null }
  canDelete: boolean
  canEdit: boolean
  canMerge: boolean
  onDeleted: () => void
  onDeactivated: () => void
  onMerge: () => void
}) {
  const [tt, setTt] = useState<TrangThai>({ b: "nghi" })
  const [dangGhi, setDangGhi] = useState(false)
  /** Nút xoá nào đang chạy — để chữ "Đang xóa..." hiện đúng nút. */
  const [dangXoa, setDangXoa] = useState<"hang" | "ncc" | null>(null)
  const { toast } = useToast()
  const supabase = createClient()

  const hoiXoa = async () => {
    setTt({ b: "dang-hoi" })
    const { data, error } = await supabase.rpc("so_chung_tu_ncc", { p_supplier_id: supplier.id })
    if (error) {
      setTt({ b: "nghi" })
      toast({ title: "Không kiểm được chứng từ của NCC", description: thongDiep(error), variant: "destructive" })
      return
    }
    const so = data as SoChungTuNcc
    const buoc = buocXoaNcc(so)
    setTt(
      buoc === "xoa" ? { b: "xac-nhan" }
        : buoc === "hoi-mat-hang" ? { b: "hoi-mat-hang", soHang: soMatHangNcc(so) }
        : { b: "co-chung-tu", so }
    )
  }

  /** `xoaHang` — xoá luôn mặt hàng gắn NCC (mặt hàng đã có trong phiếu: máy chủ chuyển Ngừng bán). */
  const xoa = async (xoaHang: boolean) => {
    setDangGhi(true)
    setDangXoa(xoaHang ? "hang" : "ncc")
    try {
      const { data, error } = await supabase.rpc("xoa_nha_cung_cap", { p_id: supplier.id, p_xoa_hang: xoaHang })
      if (error) throw error
      toast({ title: "Đã xóa nhà cung cấp", description: moTaKetQuaXoaNcc(data as KetQuaXoaNcc) || undefined })
      onDeleted()
    } catch (err) {
      toast({ title: "Không xóa được", description: thongDiep(err), variant: "destructive" })
      setTt({ b: "nghi" })
    } finally {
      setDangGhi(false)
      setDangXoa(null)
    }
  }

  const ngung = async () => {
    setDangGhi(true)
    try {
      await ghiPhaiTrungDong(supabase.from("suppliers").update({ is_active: false }).eq("id", supplier.id))
      toast({ title: "Đã ngừng hợp tác", description: "NCC không còn hiện ở ô chọn NCC; chứng từ cũ giữ nguyên." })
      setTt({ b: "nghi" })
      onDeactivated()
    } catch (err) {
      toast({ title: "Không đổi được trạng thái", description: thongDiep(err), variant: "destructive" })
    } finally {
      setDangGhi(false)
    }
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-destructive/30 bg-card p-4 sm:p-6" data-testid="ncc-vung-nguy-hiem">
      <h3 className="text-base font-bold text-destructive">Vùng nguy hiểm</h3>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Xóa nhà cung cấp vĩnh viễn. Không thể xóa nếu nhà cung cấp đã có phiếu nhập hoặc còn công nợ.
      </p>

      {tt.b === "xac-nhan" ? (
        <div className="flex flex-col gap-2 rounded-xl bg-destructive/10 p-3" data-testid="ncc-xac-nhan-xoa">
          <span className="text-sm font-semibold text-foreground">Xóa &quot;{supplier.name}&quot;?</span>
          <div className="flex gap-2">
            <Button variant="outline" className="h-10 flex-1" onClick={() => setTt({ b: "nghi" })} disabled={dangGhi}>Hủy</Button>
            <Button variant="destructive" className="h-10 flex-1" onClick={() => xoa(false)} disabled={dangGhi}>{dangGhi ? "Đang xóa..." : "Xóa"}</Button>
          </div>
        </div>
      ) : tt.b === "hoi-mat-hang" ? (
        <div className="flex flex-col gap-2 rounded-xl bg-destructive/10 p-3" data-testid="ncc-hoi-xoa-mat-hang">
          <span className="text-sm font-semibold text-foreground">Xoá luôn {tt.soHang} mặt hàng của nhà cung cấp này?</span>
          <p className="text-xs leading-relaxed text-muted-foreground">
            &quot;{supplier.name}&quot; chưa có chứng từ nhưng đang là NCC chính của {tt.soHang} mặt hàng.
          </p>
          <Button variant="destructive" className="h-11 w-full" onClick={() => xoa(true)} disabled={dangGhi}>
            {dangXoa === "hang" ? "Đang xóa..." : "Xoá NCC và mặt hàng"}
          </Button>
          <p className="text-xs text-muted-foreground">Mặt hàng đã có trong phiếu sẽ chuyển Ngừng bán, không bị xoá.</p>
          <Button variant="outline" className="h-11 w-full" onClick={() => xoa(false)} disabled={dangGhi}>
            {dangXoa === "ncc" ? "Đang xóa..." : "Chỉ xoá NCC, giữ mặt hàng"}
          </Button>
          <Button variant="ghost" className="h-11 w-full" onClick={() => setTt({ b: "nghi" })} disabled={dangGhi}>Hủy</Button>
        </div>
      ) : tt.b === "co-chung-tu" ? (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-500/10 p-3 text-sm" data-testid="ncc-khong-xoa-duoc">
          <p className="font-semibold text-foreground">Không xóa được &quot;{supplier.name}&quot;</p>
          <p className="text-muted-foreground">
            Đã có {moTaChungTu(tt.so.chi_tiet)}
            {Number(tt.so.so_khoan_no) > 0 ? ` · còn nợ ${formatCurrency(Number(tt.so.con_no) || 0)}` : ""}. Chứng từ phải giữ
            lại — hãy ngừng hợp tác hoặc gộp vào NCC khác.
          </p>
          <div className="flex flex-wrap gap-2">
            {canEdit && supplier.is_active !== false && (
              <Button variant="outline" className="h-10 flex-1" onClick={ngung} disabled={dangGhi}>
                {dangGhi ? "Đang lưu..." : "Ngừng hợp tác"}
              </Button>
            )}
            {canMerge && (
              <Button variant="outline" className="h-10 flex-1" onClick={onMerge} disabled={dangGhi}>Gộp vào NCC khác…</Button>
            )}
            <Button variant="ghost" className="h-10" onClick={() => setTt({ b: "nghi" })} disabled={dangGhi}>Đóng</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {canMerge && (
            <Button variant="outline" className="h-11 rounded-xl" onClick={onMerge}>Gộp vào NCC khác…</Button>
          )}
          {canDelete && (
            <Button
              variant="outline"
              className="h-11 rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={hoiXoa}
              disabled={tt.b === "dang-hoi"}
            >
              {tt.b === "dang-hoi" ? "Đang kiểm chứng từ..." : "Xóa nhà cung cấp"}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
