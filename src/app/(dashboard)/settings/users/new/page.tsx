"use client"

import { isValidPhone } from "@/lib/users/phone"

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
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { ROLE_LABELS } from "@/lib/constants"
import { Eye, EyeOff, ShieldAlert } from "lucide-react"

const ROLES = ["owner", "manager", "accountant", "sales", "warehouse", "driver"] as const

export default function NewUserPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("settings")
  const router = useRouter()
  const { toast } = useToast()

  const [password, setPassword] = useState("")
  const [fullName, setFullName] = useState("")
  const [role, setRole] = useState<string>("sales")
  const [phone, setPhone] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)


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
    if (!fullName.trim() || !phone.trim() || !password.trim() || !role) {
      toast({ title: "Vui lòng điền đầy đủ các trường bắt buộc", variant: "destructive" })
      return
    }
    // Chặn ngay ở form thay vì để server trả lỗi sau một vòng mạng.
    if (!isValidPhone(phone)) {
      toast({
        title: "Số điện thoại không hợp lệ",
        description: "Nhân viên dùng số này để đăng nhập. Ví dụ: 0909123456",
        variant: "destructive",
      })
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
        // Không gửi email: server tự sinh từ SĐT. Không gửi cờ sửa giá /
        // hạn mức: đặt ở trang phân quyền ngay sau khi tạo.
        body: JSON.stringify({
          password,
          full_name: fullName,
          role,
          phone,
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
            <div className="grid gap-4 sm:grid-cols-2">
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
              <div className="space-y-2">
                <Label>Số điện thoại *</Label>
                <Input
                  type="tel"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0909123456"
                  required
                />
                <p className="text-[10px] text-muted-foreground">
                  Đây là tên đăng nhập của nhân viên. Không cần email.
                </p>
              </div>
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

            <div className="space-y-2">
              <Label>Vai trò *</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS[r] || r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Tạo xong sẽ chuyển thẳng sang trang phân quyền chi tiết — quyền
                theo module, sửa giá, hạn mức… đặt ở đó.
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
