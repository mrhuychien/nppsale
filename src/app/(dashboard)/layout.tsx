"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { MobileNav } from "@/components/layout/mobile-nav"
import { Sheet, SheetContent } from "@/components/ui/sheet"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, loading, authError } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user && !authError) {
      router.replace("/login")
    }
  }, [loading, user, authError, router])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 mx-auto bg-gradient-primary rounded-2xl flex items-center justify-center text-white font-black text-2xl shadow-ambient animate-pulse">
            N
          </div>
          <p className="text-sm text-muted-foreground">Đang tải...</p>
        </div>
      </div>
    )
  }

  if (authError) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-4">
        <div className="bg-card rounded-2xl shadow-ambient p-8 max-w-md w-full text-center space-y-4">
          <div className="w-12 h-12 mx-auto bg-destructive/10 rounded-2xl flex items-center justify-center text-destructive text-2xl font-black">
            ⚠
          </div>
          <div>
            <h2 className="text-lg font-bold mb-1">Không thể kết nối</h2>
            <p className="text-sm text-muted-foreground">{authError}</p>
          </div>
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => window.location.reload()}
              className="bg-gradient-primary text-white px-4 py-2 rounded-xl text-sm font-semibold"
            >
              Thử lại
            </button>
            <button
              onClick={() => router.push("/login")}
              className="bg-surface-low text-foreground px-4 py-2 rounded-xl text-sm font-semibold"
            >
              Đăng nhập lại
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center space-y-3 max-w-sm px-4">
          <div className="w-12 h-12 mx-auto bg-destructive/10 rounded-2xl flex items-center justify-center text-destructive">
            ⚠
          </div>
          <p className="text-sm text-muted-foreground">
            Phiên đăng nhập đã hết hạn. Đang chuyển đến trang đăng nhập...
          </p>
          <button
            onClick={() => router.push("/login")}
            className="text-sm font-semibold text-primary underline"
          >
            Đăng nhập ngay
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role={user.role} />

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0 bg-surface-low border-0">
          <Sidebar role={user.role} />
        </SheetContent>
      </Sheet>

      <div className="flex flex-1 flex-col min-h-screen min-w-0">
        <Header onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 p-4 pb-24 lg:p-6 lg:pb-6">
          {children}
        </main>
      </div>

      <MobileNav role={user.role} onMenuClick={() => setMobileOpen(true)} />
    </div>
  )
}
