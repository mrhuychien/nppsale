"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { ROLE_LABELS } from "@/lib/constants"
import { Eye, EyeOff, ShieldAlert, Check } from "lucide-react"
import {
  PERMISSION_TEMPLATES,
  getTemplate,
  type TemplateKey,
} from "@/lib/permission-templates"

const ROLES = ["owner", "manager", "accountant", "sales", "warehouse", "driver"] as const

export default function NewUserPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("settings")
  const router = useRouter()
  const { toast } = useToast()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [fullName, setFullName] = useState("")
  const [templateKey, setTemplateKey] = useState<TemplateKey>("sales_flex")
  const [role, setRole] = useState<string>("sales")
  const [allowPriceEdit, setAllowPriceEdit] = useState(true)
  const [priceEditMaxIncreasePct, setPriceEditMaxIncreasePct] = useState(10)
  const [phone, setPhone] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const applyTemplate = (key: TemplateKey) => {
    const t = getTemplate(key)
    if (!t) return
    setTemplateKey(key)
    setRole(t.role)
    setAllowPriceEdit(t.allow_price_edit)
    setPriceEditMaxIncreasePct(t.price_edit_max_increase_pct)
  }

  if (authLoading) return <Skeleton className="h-96" />

  // Only owner can create users
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

  const generatePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
    let pwd = ""
    for (let i = 0; i < 10; i++) {
      pwd += chars[Math.floor(Math.random() * chars.length)]
    }
    setPassword(pwd + "@1")
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password.trim() || !fullName.trim() || !role) {
      toast({ title: "Vui lòng điền đầy đủ các trường bắt buộc", variant: "destructive" })
      return
    }
    if (password.length < 8) {
      toast({ title: "Mật khẩu phải ít nhất 8 ký tự", variant: "destructive" })
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          full_name: fullName,
          role,
          phone,
          allow_price_edit: allowPriceEdit,
          price_edit_max_increase_pct: priceEditMaxIncreasePct,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        const msg = data.error || "Tạo người dùng thất bại"
        throw new Error(data.hint ? `${msg}\n${data.hint}` : msg)
      }
      toast({
        title: "Đã tạo người dùng",
        description: `${fullName} (${ROLE_LABELS[role] || role}) — tiếp tục phân quyền chi tiết.`,
      })
      // Sau khi tạo xong → redirect tới trang edit để admin tuỳ chỉnh
      // phân quyền chi tiết ngay (matrix mount sẵn ở dưới form).
      const newUserId = data?.user?.id || data?.id
      if (newUserId) {
        router.push(`/settings/users/${newUserId}`)
      } else {
        router.push("/settings/users")
      }
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <PageHeader
        title="Tạo người dùng mới"
        description="Cấp tài khoản đăng nhập và gán vai trò"
        backHref="/settings/users"
      />

      <Card className="border-l-4 border-l-[#fdb022]">
        <CardContent className="p-4 flex gap-3 text-sm">
          <ShieldAlert className="h-5 w-5 text-[#b54708] shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Lưu ý bảo mật</p>
            <p className="text-muted-foreground">
              Mật khẩu được lưu mã hóa. Gửi mật khẩu cho người dùng qua kênh bảo mật
              và yêu cầu họ đổi mật khẩu sau lần đăng nhập đầu tiên.
            </p>
          </div>
        </CardContent>
      </Card>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Thông tin tài khoản</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Email *</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nhanvien@example.com"
                required
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Mật khẩu *</Label>
                <button
                  type="button"
                  onClick={generatePassword}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  Tự động tạo
                </button>
              </div>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Ít nhất 8 ký tự"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Họ và tên *</Label>
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Nguyễn Văn A"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Số điện thoại</Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0901234567"
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
                      onClick={() => applyTemplate(t.key)}
                      className={`text-left rounded-xl border p-3 transition-all ${
                        active
                          ? "border-primary bg-primary-fixed ring-2 ring-primary/30"
                          : "border-outline-variant/60 hover:border-primary/40 hover:bg-surface-container-low"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-semibold text-sm">{t.label}</p>
                        {active && <Check className="h-4 w-4 text-primary" />}
                      </div>
                      <p className="text-[11px] text-muted-foreground mb-2">
                        {t.description}
                      </p>
                      <ul className="space-y-0.5">
                        {t.capabilities.map((c) => (
                          <li key={c} className="text-[10px] text-muted-foreground flex gap-1">
                            <span className="text-primary">•</span> {c}
                          </li>
                        ))}
                      </ul>
                    </button>
                  )
                })}
              </div>

              <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-3 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tuỳ chỉnh (override mẫu)
                </p>
                <div className="space-y-2">
                  <Label className="text-xs">Vai trò</Label>
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r}>{ROLE_LABELS[r] || r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border bg-background p-2">
                  <div>
                    <Label className="text-xs">Cho phép sửa giá</Label>
                    <p className="text-[10px] text-muted-foreground">
                      Bật để NV chỉnh được unit_price khi tạo / sửa đơn.
                    </p>
                  </div>
                  <Switch
                    checked={allowPriceEdit}
                    onCheckedChange={setAllowPriceEdit}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">% tăng tối đa so với giá list</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    value={priceEditMaxIncreasePct}
                    onChange={(e) =>
                      setPriceEditMaxIncreasePct(
                        Math.max(0, Math.min(100, parseFloat(e.target.value) || 0))
                      )
                    }
                    disabled={!allowPriceEdit}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    VD 10 = giá tối đa = giá list × 1,10. Chỉ áp dụng khi bật &ldquo;Cho phép sửa giá&rdquo;.
                  </p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Mẫu áp dụng vai trò + cờ năng lực (giá / chấm công). Quyền theo
                module vẫn theo ma trận tại{" "}
                <a href="/settings/permissions" className="text-primary hover:underline">
                  Phân quyền &amp; Template
                </a>.
              </p>
            </div>

            <div className="flex gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => router.back()} className="flex-1">
                Hủy
              </Button>
              <Button type="submit" disabled={submitting} className="flex-[2]">
                {submitting ? "Đang tạo..." : "Tạo người dùng"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}
