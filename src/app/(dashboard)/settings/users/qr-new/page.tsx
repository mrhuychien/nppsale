"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { QrCode } from "@/components/ui/qr-code"
import { useToast } from "@/hooks/use-toast"
import { ROLE_LABELS } from "@/lib/constants"
import { PERMISSION_TEMPLATES, getTemplate, type TemplateKey } from "@/lib/permission-templates"
import QRCode from "qrcode"
import { QrCode as QrIcon, Check, Printer, Copy, UserPlus, ArrowRight, ShieldCheck } from "lucide-react"

interface CreatedEmployee {
  id: string
  name: string
  loginUrl: string
}

export default function QrNewUserPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("settings")
  const router = useRouter()
  const { toast } = useToast()

  const [fullName, setFullName] = useState("")
  const [phone, setPhone] = useState("")
  const [username, setUsername] = useState("")
  const [templateKey, setTemplateKey] = useState<TemplateKey>("sales_basic")
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<CreatedEmployee | null>(null)
  const [copied, setCopied] = useState(false)

  if (authLoading) return <Skeleton className="h-96" />

  if (user && user.role !== "owner") {
    return (
      <div className="space-y-4">
        <PageHeader title="Không có quyền" backHref="/settings/users" />
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Chỉ Chủ sở hữu mới được tạo người dùng mới.
          </CardContent>
        </Card>
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!fullName.trim()) {
      toast({ title: "Vui lòng nhập họ tên nhân viên", variant: "destructive" })
      return
    }
    const t = getTemplate(templateKey)
    setSubmitting(true)
    try {
      const res = await fetch("/api/admin/users/qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName.trim(),
          role: t?.role || "sales",
          phone: phone.trim() || null,
          username: username.trim() || null,
          allow_price_edit: t?.allow_price_edit ?? false,
          price_edit_max_increase_pct: t?.price_edit_max_increase_pct ?? 0,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.hint ? `${data.error}\n${data.hint}` : data.error || "Tạo thất bại")
      }
      setCreated({ id: data.id, name: fullName.trim(), loginUrl: data.loginUrl })
      toast({ title: "Đã tạo nhân viên", description: `${fullName.trim()} — phát mã QR để đăng nhập.` })
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  const copyLink = async () => {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.loginUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast({ title: "Không sao chép được", variant: "destructive" })
    }
  }

  const printQr = async () => {
    if (!created) return
    const svg = await QRCode.toString(created.loginUrl, {
      type: "svg", margin: 1, width: 320, errorCorrectionLevel: "M",
    })
    const w = window.open("", "_blank", "width=520,height=680")
    if (!w) return
    w.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8" />
      <title>QR đăng nhập — ${created.name}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;text-align:center;padding:32px;color:#111}
        .name{font-size:20px;font-weight:700;margin:8px 0 2px}
        .role{font-size:13px;color:#555;margin-bottom:16px}
        .qr{display:inline-block;padding:12px;border:1px solid #ddd;border-radius:12px}
        .hint{font-size:12px;color:#666;margin-top:16px;max-width:340px;margin-left:auto;margin-right:auto;line-height:1.5}
        .brand{font-size:15px;font-weight:700;color:#2563eb;margin-bottom:4px}
      </style></head><body>
      <div class="brand">npp.sale</div>
      <div class="name">${created.name}</div>
      <div class="role">Mã QR đăng nhập nhanh</div>
      <div class="qr">${svg}</div>
      <div class="hint">Dùng camera điện thoại quét mã QR để đăng nhập vào app.
      Giữ mã QR ở nơi an toàn — bất kỳ ai quét được cũng vào được tài khoản này.</div>
      <script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
      </body></html>`)
    w.document.close()
  }

  // === Màn hình kết quả: hiển thị mã QR ngay sau khi tạo ===
  if (created) {
    return (
      <div className="space-y-4 max-w-lg">
        <PageHeader
          title="Đã tạo nhân viên"
          description="Phát mã QR dưới đây cho nhân viên để đăng nhập"
          backHref="/settings/users"
        />
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-6">
            <div className="flex items-center gap-2 text-success">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-success-light">
                <Check className="h-5 w-5" />
              </div>
              <span className="font-semibold">{created.name}</span>
            </div>

            <QrCode value={created.loginUrl} size={240} />

            <div className="w-full rounded-lg bg-surface-container-low px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Đường dẫn đăng nhập
              </p>
              <p className="break-all font-mono text-[11px] text-on-surface/80">{created.loginUrl}</p>
            </div>

            <div className="grid w-full grid-cols-2 gap-2">
              <Button variant="outline" onClick={copyLink}>
                {copied ? <Check className="mr-1.5 h-4 w-4 text-success" /> : <Copy className="mr-1.5 h-4 w-4" />}
                {copied ? "Đã chép" : "Chép link"}
              </Button>
              <Button variant="outline" onClick={printQr}>
                <Printer className="mr-1.5 h-4 w-4" />
                In mã QR
              </Button>
            </div>

            <div className="flex w-full gap-2 pt-2">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => {
                  setCreated(null)
                  setFullName("")
                  setPhone("")
                  setUsername("")
                }}
              >
                <UserPlus className="mr-1.5 h-4 w-4" />
                Tạo tiếp
              </Button>
              <Button className="flex-1" onClick={() => router.push(`/settings/users/${created.id}`)}>
                Phân quyền chi tiết
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // === Form tạo ===
  return (
    <div className="space-y-4 max-w-lg">
      <PageHeader
        title="Tạo nhân viên quét QR"
        description="Nhân viên quét mã QR bằng điện thoại là đăng nhập, không cần email/mật khẩu"
        backHref="/settings/users"
      >
        <Link href="/settings/users/new" className="text-sm text-primary hover:underline">
          Tạo bằng email/mật khẩu →
        </Link>
      </PageHeader>

      <Card className="border-l-4 border-l-primary">
        <CardContent className="flex gap-3 p-4 text-sm">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="font-semibold">Đăng nhập bằng QR</p>
            <p className="text-muted-foreground">
              Hệ thống tự tạo tài khoản và sinh mã QR. Nhân viên dùng camera quét là vào app ngay.
              Mã QR có thể phát lại / thu hồi bất cứ lúc nào trong danh sách nhân viên.
            </p>
          </div>
        </CardContent>
      </Card>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Thông tin nhân viên</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Họ và tên *</Label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Nguyễn Văn A"
                required
                autoFocus
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Số điện thoại</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0901234567" />
              </div>
              <div className="space-y-2">
                <Label>Tài khoản (tuỳ chọn)</Label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="nguyenvana"
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label>Mẫu phân quyền *</Label>
              <div className="grid gap-2 md:grid-cols-2">
                {PERMISSION_TEMPLATES.map((t) => {
                  const active = templateKey === t.key
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setTemplateKey(t.key)}
                      className={`rounded-xl border p-3 text-left transition-all ${
                        active
                          ? "border-primary bg-primary-fixed ring-2 ring-primary/30"
                          : "border-outline-variant/60 hover:border-primary/40 hover:bg-surface-container-low"
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <p className="text-sm font-semibold">{t.label}</p>
                        {active && <Check className="h-4 w-4 text-primary" />}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Vai trò: {ROLE_LABELS[t.role] || t.role}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => router.back()} className="flex-1">
                Hủy
              </Button>
              <Button type="submit" disabled={submitting} className="flex-[2]">
                <QrIcon className="mr-1.5 h-4 w-4" />
                {submitting ? "Đang tạo..." : "Tạo & sinh mã QR"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}
