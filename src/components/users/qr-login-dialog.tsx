"use client"

import { useCallback, useEffect, useState } from "react"
import QRCode from "qrcode"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { QrCode } from "@/components/ui/qr-code"
import { useToast } from "@/hooks/use-toast"
import {
  Copy,
  Printer,
  RefreshCw,
  ShieldOff,
  QrCode as QrIcon,
  Check,
} from "lucide-react"

interface QrLoginDialogProps {
  userId: string
  userName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface QrState {
  token: string | null
  loginUrl: string | null
  issuedAt: string | null
}

/**
 * Xem / phát / xoay / thu hồi mã QR đăng nhập cho 1 nhân viên. Chỉ Chủ
 * sở hữu mở được (API tự chặn). Mã QR dựng local, in được để phát cho NV.
 */
export function QrLoginDialog({
  userId,
  userName,
  open,
  onOpenChange,
}: QrLoginDialogProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [state, setState] = useState<QrState>({
    token: null,
    loginUrl: null,
    issuedAt: null,
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}/qr`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Không tải được mã QR")
      setState({
        token: data.token,
        loginUrl: data.loginUrl,
        issuedAt: data.issuedAt,
      })
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [userId, toast])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const rotate = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}/qr`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Không phát được mã QR")
      setState({ token: data.token, loginUrl: data.loginUrl, issuedAt: data.issuedAt })
      toast({ title: "Đã phát mã QR mới", description: "Mã QR cũ (nếu có) đã hết hiệu lực." })
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const revoke = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}/qr`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Không thu hồi được")
      setState({ token: null, loginUrl: null, issuedAt: null })
      toast({ title: "Đã thu hồi mã QR", description: "Nhân viên không thể quét để đăng nhập nữa." })
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const copyLink = async () => {
    if (!state.loginUrl) return
    try {
      await navigator.clipboard.writeText(state.loginUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast({ title: "Không sao chép được", variant: "destructive" })
    }
  }

  const printQr = async () => {
    if (!state.loginUrl) return
    const svg = await QRCode.toString(state.loginUrl, {
      type: "svg",
      margin: 1,
      width: 320,
      errorCorrectionLevel: "M",
    })
    const w = window.open("", "_blank", "width=520,height=680")
    if (!w) return
    w.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8" />
      <title>QR đăng nhập — ${userName}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;text-align:center;padding:32px;color:#111}
        .name{font-size:20px;font-weight:700;margin:8px 0 2px}
        .role{font-size:13px;color:#555;margin-bottom:16px}
        .qr{display:inline-block;padding:12px;border:1px solid #ddd;border-radius:12px}
        .hint{font-size:12px;color:#666;margin-top:16px;max-width:340px;margin-left:auto;margin-right:auto;line-height:1.5}
        .brand{font-size:15px;font-weight:700;color:#2563eb;margin-bottom:4px}
      </style></head><body>
      <div class="brand">npp.sale</div>
      <div class="name">${userName}</div>
      <div class="role">Mã QR đăng nhập nhanh</div>
      <div class="qr">${svg}</div>
      <div class="hint">Dùng camera điện thoại quét mã QR để đăng nhập vào app.
      Giữ mã QR ở nơi an toàn — bất kỳ ai quét được cũng vào được tài khoản này.</div>
      <script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
      </body></html>`)
    w.document.close()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrIcon className="h-5 w-5 text-primary" />
            Mã QR đăng nhập
          </DialogTitle>
          <DialogDescription>
            {userName} — nhân viên quét mã bằng camera điện thoại để vào app.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col items-center gap-4 py-4">
            <Skeleton className="h-[248px] w-[248px] rounded-xl" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : state.token && state.loginUrl ? (
          <div className="flex flex-col items-center gap-4 py-2">
            <QrCode value={state.loginUrl} size={220} />
            <div className="w-full rounded-lg bg-surface-container-low px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Đường dẫn đăng nhập
              </p>
              <p className="break-all font-mono text-[11px] text-on-surface/80">
                {state.loginUrl}
              </p>
            </div>

            <div className="grid w-full grid-cols-2 gap-2">
              <Button variant="outline" size="sm" onClick={copyLink}>
                {copied ? <Check className="mr-1.5 h-4 w-4 text-success" /> : <Copy className="mr-1.5 h-4 w-4" />}
                {copied ? "Đã chép" : "Chép link"}
              </Button>
              <Button variant="outline" size="sm" onClick={printQr}>
                <Printer className="mr-1.5 h-4 w-4" />
                In mã
              </Button>
              <Button variant="secondary" size="sm" onClick={rotate} disabled={busy}>
                <RefreshCw className="mr-1.5 h-4 w-4" />
                Phát lại
              </Button>
              <Button variant="ghost" size="sm" onClick={revoke} disabled={busy} className="text-error hover:bg-error-container">
                <ShieldOff className="mr-1.5 h-4 w-4" />
                Thu hồi
              </Button>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              QR là &ldquo;chìa khoá&rdquo; — bất kỳ ai quét được cũng vào được tài khoản này.
              Nếu lộ, bấm <span className="font-semibold">Phát lại</span> để vô hiệu hoá mã cũ.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-container-low">
              <QrIcon className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              Chưa bật đăng nhập QR cho nhân viên này.
            </p>
            <Button onClick={rotate} disabled={busy}>
              <QrIcon className="mr-2 h-4 w-4" />
              {busy ? "Đang tạo..." : "Tạo mã QR đăng nhập"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
