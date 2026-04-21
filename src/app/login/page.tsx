"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (authError) {
        setError(authError.message)
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
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 bg-primary rounded-[10px] flex items-center justify-center text-white font-black text-2xl mb-3">
            N
          </div>
          <h1 className="text-2xl font-bold text-primary">npp.sale</h1>
          <p className="text-sm text-muted-foreground mt-1">Mini ERP cho Nhà Phân Phối</p>
        </div>

        {/* Form Card */}
        <div className="bg-card rounded-2xl border border-border/40 p-8">
          <h2 className="text-lg font-semibold mb-1">Đăng nhập</h2>
          <p className="text-sm text-muted-foreground mb-6">Truy cập hệ thống quản lý</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium text-foreground">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium text-foreground">
                Mật khẩu
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="Nhập mật khẩu"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <div className="p-3 rounded-[10px] bg-destructive/10 text-destructive text-sm">
                {error}
              </div>
            )}
            <Button type="submit" className="w-full h-10 text-sm mt-6" disabled={loading}>
              {loading ? "Đang đăng nhập..." : "Đăng nhập"}
            </Button>
          </form>

          <div className="mt-6 pt-5 border-t border-border/30 text-center">
            <p className="text-xs text-muted-foreground">
              Demo: <span className="font-mono text-foreground/70">owner@demo.com / Demo@123456</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
