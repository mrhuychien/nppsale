"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { MobileNav } from "@/components/layout/mobile-nav"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { PermissionsLoader } from "@/components/permissions-loader"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, authUser, loading, authError } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    // Only redirect to login if we're sure there's no session at all
    if (!loading && !authUser && !authError) {
      router.replace("/login")
    }
  }, [loading, authUser, authError, router])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 mx-auto bg-primary rounded-[10px] flex items-center justify-center text-white font-black text-2xl animate-pulse">
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
        <div className="bg-card rounded-2xl border border-border/40 p-8 max-w-md w-full text-center space-y-4">
          <div className="w-12 h-12 mx-auto bg-destructive/10 rounded-2xl flex items-center justify-center text-destructive text-2xl font-black">
            !
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-1">Không thể kết nối</h2>
            <p className="text-sm text-muted-foreground">{authError}</p>
          </div>
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => window.location.reload()}
              className="bg-primary text-white px-4 py-2 rounded-[10px] text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              Thử lại
            </button>
            <button
              onClick={() => router.push("/login")}
              className="bg-muted text-foreground px-4 py-2 rounded-[10px] text-sm font-semibold hover:bg-muted/80 transition-colors"
            >
              Đăng nhập lại
            </button>
          </div>
        </div>
      </div>
    )
  }

  // No session at all -> redirecting to login (handled by useEffect above)
  if (!authUser) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center space-y-3 max-w-sm px-4">
          <p className="text-sm text-muted-foreground">
            Đang chuyển đến trang đăng nhập...
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

  // authUser exists but user profile is still loading OR doesn't exist.
  // Use a safe fallback role "sales" for sidebar so user can at least see the app.
  const role = user?.role ?? "sales"

  return (
    <div className="flex min-h-screen bg-background">
      <PermissionsLoader />
      <Sidebar role={role} />

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0 bg-card border-0">
          <Sidebar role={role} mobile onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex flex-1 flex-col min-h-screen min-w-0">
        <Header onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 p-6 pb-24 lg:pb-6">
          {children}
        </main>
      </div>

      <MobileNav role={role} onMenuClick={() => setMobileOpen(true)} />
    </div>
  )
}
