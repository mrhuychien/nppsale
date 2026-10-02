"use client"

/**
 * XOÁ / CHO NGHỈ VIỆC một nhân viên — chủ nhà 02/10/2026 (mig 223): hỏi máy chủ người này đã có chứng từ
 * chưa. Chưa có → xoá hẳn. Đã có → không xoá được, "Cho nghỉ việc": khoá đăng nhập, khách + lịch tuyến +
 * công nợ chưa thu về NPP ("Npp sẽ phân phối lại sau"), tên vẫn giữ trên chứng từ cũ.
 */

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/utils"
import { errorMessage } from "@/lib/errors"
import { loiNhanVien, tomTatChungTu, xoaHanDuoc, type ChungTuNv } from "@/lib/users/nghi-viec"

export function XoaNhanVienDialog({
  user,
  onClose,
  onDone,
}: {
  user: { id: string; full_name: string } | null
  onClose: () => void
  /** Báo kết quả để trang tải lại danh sách + hiện thông báo. */
  onDone: (thongBao: string) => void
}) {
  const [ct, setCt] = useState<ChungTuNv | null>(null)
  const [loi, setLoi] = useState<string | null>(null)
  const [dang, setDang] = useState(false)

  useEffect(() => {
    setCt(null)
    setLoi(null)
    if (!user) return
    let huy = false
    createClient()
      .rpc("so_chung_tu_nhan_vien", { p_user_id: user.id })
      .then(({ data, error }) => {
        if (huy) return
        if (error) setLoi(loiNhanVien(error.message))
        else setCt(data as ChungTuNv)
      })
    return () => { huy = true }
  }, [user])

  const xoa = ct ? xoaHanDuoc(ct) : false

  const lam = async () => {
    if (!user || !ct || dang) return
    setDang(true)
    setLoi(null)
    try {
      if (xoa) {
        const res = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || "Xóa thất bại")
        onDone(`Đã xóa ${user.full_name}`)
      } else {
        const { data, error } = await createClient().rpc("cho_nhan_vien_nghi", { p_user_id: user.id })
        if (error) throw new Error(loiNhanVien(error.message))
        const kq = (data ?? {}) as Partial<ChungTuNv>
        onDone(`${user.full_name} đã nghỉ việc — ${kq.khach ?? 0} khách, ${kq.so_khoan_no ?? 0} khoản nợ về NPP`)
      }
    } catch (e) {
      setLoi(errorMessage(e, "Không làm được — thử lại"))
    } finally {
      setDang(false)
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && !dang && onClose()}>
      <DialogContent data-testid="xoa-nv-dialog">
        <DialogHeader>
          <DialogTitle>{!ct ? `Xoá ${user?.full_name ?? ""}?` : xoa ? `Xóa vĩnh viễn ${user?.full_name}?` : `Cho ${user?.full_name} nghỉ việc?`}</DialogTitle>
          <DialogDescription>
            {!ct
              ? "Đang kiểm tra chứng từ của nhân viên…"
              : xoa
                ? "Nhân viên chưa có chứng từ nào — tài khoản sẽ bị xóa hẳn, không khôi phục được."
                : "Nhân viên đã có chứng từ nên không xóa được. Cho nghỉ việc thì tên vẫn giữ trên chứng từ và báo cáo cũ."}
          </DialogDescription>
        </DialogHeader>

        {!ct && !loi && <Skeleton className="h-16" />}
        {ct && (
          <div className="space-y-2 text-sm" data-testid="xoa-nv-chi-tiet">
            {!xoa && (
              <p className="rounded-lg bg-muted/40 px-3 py-2" data-testid="xoa-nv-chung-tu">
                Đã có: {tomTatChungTu(ct)}
              </p>
            )}
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {!xoa && <li>Khoá đăng nhập ngay (kể cả mã QR), ẩn khỏi ô chọn nhân viên.</li>}
              {ct.khach > 0 && <li><b className="text-foreground">{ct.khach} khách</b> đang phụ trách {xoa ? "bị gỡ phân công" : "về NPP (không ai phụ trách)"}.</li>}
              {ct.lich_tuyen > 0 && <li><b className="text-foreground">{ct.lich_tuyen} lịch tuyến</b> bị gỡ.</li>}
              {!xoa && ct.so_khoan_no > 0 && (
                <li data-testid="xoa-nv-no">
                  <b className="text-foreground">{ct.so_khoan_no} khoản nợ · {formatCurrency(ct.tien_no)}</b> chưa thu về NPP giữ —
                  phân lại ở màn khách hàng (Phân công).
                </li>
              )}
            </ul>
          </div>
        )}
        {loi && <p className="text-sm text-destructive" data-testid="xoa-nv-loi">{loi}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={dang}>Huỷ</Button>
          <Button variant="destructive" onClick={lam} disabled={!ct || dang} data-testid="xoa-nv-xac-nhan">
            {dang ? "Đang xử lý..." : !ct ? "Xoá" : xoa ? "Xóa vĩnh viễn" : "Cho nghỉ việc"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
