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
    <div className="min-h-screen flex items-center justify-center bg-surface px-4">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center text-on-primary font-bold text-2xl mb-3 shadow-card">
            N
          </div>
          <h1 className="text-headline-lg font-bold text-on-surface">npp.sale</h1>
          <p className="text-sm text-on-surface-variant mt-1">Mini ERP cho Nhà Phân Phối</p>
        </div>

        {/* Form Card */}
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/60 p-8 shadow-card">
          <h2 className="text-headline-md font-semibold text-on-surface mb-1">Đăng nhập</h2>
          <p className="text-sm text-on-surface-variant mb-6">Truy cập hệ thống quản lý</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-label-md text-on-surface-variant uppercase">
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
              <Label htmlFor="password" className="text-label-md text-on-surface-variant uppercase">
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
              <div className="p-3 rounded-lg bg-error-container text-on-error-container text-sm">
                {error}
              </div>
            )}
            <Button type="submit" className="w-full h-10 text-sm mt-6" disabled={loading}>
              {loading ? "Đang đăng nhập..." : "Đăng nhập"}
            </Button>
          </form>

          <div className="mt-6 pt-5 border-t border-outline-variant/40 text-center">
            <p className="text-xs text-on-surface-variant">
              Demo: <span className="font-mono text-on-surface/70">owner@demo.com / Demo@123456</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
