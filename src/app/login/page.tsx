"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Eye, EyeOff, QrCode, ShieldCheck, Truck, BarChart3, Boxes } from "lucide-react"
import { VN_TZ } from "@/lib/utils"

const QR_MESSAGES: Record<string, string> = {
  invalid: "Mã QR không hợp lệ hoặc đã bị thu hồi. Liên hệ quản lý để được cấp lại.",
  inactive: "Tài khoản đã bị tạm khóa. Liên hệ quản lý.",
  server: "Không đăng nhập được bằng QR. Vui lòng thử lại hoặc đăng nhập bằng mật khẩu.",
}

function LoginForm() {
  // Năm ở chân trang: server chạy UTC, điện thoại ở UTC+7 nên trong 7 tiếng
  // đầu ngày 1/1 hai bên ra hai năm khác nhau → lệch hydration mỗi đầu năm.
  const [year, setYear] = useState("")
  useEffect(() => {
    setYear(new Date().toLocaleDateString("vi-VN", { year: "numeric", timeZone: VN_TZ }))
  }, [])
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const qrError = searchParams.get("qr")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const id = identifier.trim()
      let email = id
      if (!id.includes("@")) {
        const { data: looked, error: lookupErr } = await supabase.rpc(
          "lookup_email_by_identifier",
          { p_id: id }
        )
        if (lookupErr || !looked) {
          setError("Sai tài khoản hoặc mật khẩu.")
          return
        }
        email = String(looked)
      }
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) {
        setError("Sai tài khoản hoặc mật khẩu.")
        return
      }
      router.push("/orders")
      router.refresh()
    } catch {
      setError("Có lỗi xảy ra. Vui lòng thử lại.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen w-full lg:grid lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel — ẩn trên mobile */}
      <aside className="relative hidden overflow-hidden bg-gradient-primary lg:flex lg:flex-col lg:justify-between p-12 text-white">
        <div className="absolute inset-0 bg-brand-mesh opacity-70" aria-hidden />
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 text-2xl font-bold backdrop-blur">
              N
            </div>
            <div>
              <p className="text-lg font-bold leading-tight">npp.sale</p>
              <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-white/70">
                Phân phối FMCG
              </p>
            </div>
          </div>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-bold leading-tight">
            Mini ERP cho Nhà Phân Phối
          </h2>
          <p className="mt-3 text-white/80">
            Đơn hàng, kho, khách hàng, công nợ và hoa hồng — gọn trong một hệ thống.
          </p>
          <ul className="mt-8 space-y-3 text-sm">
            {[
              { icon: BarChart3, label: "Báo cáo kinh doanh thời gian thực" },
              { icon: Boxes, label: "Quản lý kho theo lô, hạn dùng" },
              { icon: Truck, label: "Điều phối giao hàng & thu hồi công nợ" },
            ].map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15">
                  <Icon className="h-4 w-4" />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/60">
          © {year} npp.sale — nppsale.vercel.app
        </p>
      </aside>

      {/* Form panel */}
      <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
        <div className="w-full max-w-sm">
          {/* Brand — chỉ hiện trên mobile */}
          <div className="mb-8 flex flex-col items-center lg:hidden">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-primary text-2xl font-bold text-white shadow-brand">
              N
            </div>
            <h1 className="text-2xl font-bold text-on-surface">npp.sale</h1>
            <p className="mt-1 text-sm text-muted-foreground">Mini ERP cho Nhà Phân Phối</p>
          </div>

          <div className="rounded-2xl border border-outline-variant/60 bg-card p-8 shadow-card">
            <h2 className="text-xl font-bold text-on-surface">Đăng nhập</h2>
            <p className="mt-1 text-sm text-muted-foreground">Truy cập hệ thống quản lý</p>

            {qrError && (
              <div className="mt-4 rounded-lg bg-error-container px-3 py-2.5 text-sm text-on-error-container">
                {QR_MESSAGES[qrError] || QR_MESSAGES.server}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="identifier" className="text-xs uppercase tracking-wider text-muted-foreground">
                  Email / SĐT / Tài khoản
                </Label>
                <Input
                  id="identifier"
                  type="text"
                  autoComplete="username"
                  placeholder="email, số điện thoại hoặc tên tài khoản"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-xs uppercase tracking-wider text-muted-foreground">
                  Mật khẩu
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Nhập mật khẩu"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-on-surface"
                    aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {error && (
                <div className="rounded-lg bg-error-container px-3 py-2.5 text-sm text-on-error-container">
                  {error}
                </div>
              )}
              <Button type="submit" size="lg" className="w-full" disabled={loading}>
                {loading ? "Đang đăng nhập..." : "Đăng nhập"}
              </Button>
            </form>

            {/* QR login hint cho nhân viên */}
            <div className="mt-6 flex items-start gap-3 rounded-xl border border-outline-variant/60 bg-surface-container-low p-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <QrCode className="h-5 w-5" />
              </span>
              <div className="text-xs text-muted-foreground">
                <p className="font-semibold text-on-surface">Nhân viên có mã QR?</p>
                <p>Dùng camera điện thoại quét mã QR do quản lý cấp để đăng nhập ngay, không cần mật khẩu.</p>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Kết nối được mã hoá &amp; bảo mật
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <LoginForm />
    </Suspense>
  )
}
