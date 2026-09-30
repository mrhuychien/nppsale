"use client"

import { useState } from "react"
import { LogIn } from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { errorMessage } from "@/lib/errors"
import { linkTrinhDuyetRieng } from "@/lib/users/mo-trinh-duyet"

/**
 * Nút "Đăng nhập" cạnh tên nhân viên — chủ nhà 30/09/2026: "thêm nút đăng nhập chức năng tương tự mở
 * tab trên safari cạnh tên nhân viên trong Danh sách nhân viên". Mở link QR của nhân viên bằng Safari
 * (`x-safari-https://`), app ở màn hình chính vẫn giữ phiên chủ NPP.
 * ⚠ Có link sẵn thì là thẻ <a> thật (iPhone chỉ chắc mở Safari khi bấm thẳng vào link). Chưa có mã
 *   thì bấm = tạo mã rồi mở.
 */
export function NutDangNhapNhanVien({
  userId,
  userName,
  loginUrl,
  onTaoMa,
  lon = false,
  chiIcon = false,
}: {
  userId: string
  userName: string
  loginUrl: string | null | undefined
  onTaoMa: (userId: string, loginUrl: string) => void
  lon?: boolean
  /** Nút vuông chỉ có icon — thẻ nhân viên trên điện thoại (thiết kế "ds-nhan-vien"). */
  chiIcon?: boolean
}) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const cls = chiIcon
    ? "grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-primary/10 text-primary active:bg-primary/20 disabled:opacity-50"
    : cn(
        "inline-flex shrink-0 items-center gap-1 rounded-lg border border-primary/40 px-2 font-semibold text-primary hover:bg-primary/10 disabled:opacity-50",
        lon ? "h-9 text-xs" : "h-7 text-[11px]"
      )
  const nhan = chiIcon ? (
    <>
      <LogIn className="h-[18px] w-[18px]" aria-hidden />
      <span className="sr-only">Đăng nhập</span>
    </>
  ) : (
    <>
      <LogIn className="h-3.5 w-3.5" />
      Đăng nhập
    </>
  )
  const safari = loginUrl ? linkTrinhDuyetRieng(loginUrl)?.safari : null

  if (safari) {
    return (
      <a
        href={safari}
        className={cls}
        data-testid="nv-dang-nhap"
        title={`Mở Safari đăng nhập thành ${userName}`}
        onClick={(e) => e.stopPropagation()}
      >
        {nhan}
      </a>
    )
  }

  const taoMa = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}/qr`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Không tạo được mã đăng nhập")
      onTaoMa(userId, data.loginUrl)
      toast({ title: `Đã tạo mã QR đăng nhập cho ${userName}` })
      const moi = linkTrinhDuyetRieng(data.loginUrl)
      if (moi) window.location.href = moi.safari
    } catch (err) {
      toast({ title: "Lỗi", description: errorMessage(err), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      className={cls}
      data-testid="nv-dang-nhap"
      disabled={busy}
      title={`Chưa có mã QR — bấm để tạo rồi mở Safari đăng nhập thành ${userName}`}
      onClick={taoMa}
    >
      {nhan}
    </button>
  )
}
