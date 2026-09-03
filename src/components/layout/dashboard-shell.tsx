"use client"

import { useState } from "react"
import { usePathname } from "next/navigation"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { MobileNav, hasMobileFab } from "@/components/layout/mobile-nav"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { PermissionsLoader } from "@/components/permissions-loader"
import { WorkflowResumeBar } from "@/components/dashboard/workflow-resume-bar"
import { OrderSyncProvider } from "@/hooks/use-order-sync"
import { cn } from "@/lib/utils"
import type { Role } from "@/types"

interface DashboardShellProps {
  role: Role
  children: React.ReactNode
}

/**
 * Vùng đệm đáy cho nội dung trên mobile.
 *
 * Thanh nav cố định cao 88px và nút "+" nhô lên tới 136px tính từ đáy.
 * Không chừa đủ đệm thì phần cuối danh sách nằm khuất bên dưới — cuộn hết
 * cỡ vẫn không đọc được, cũng không bấm được.
 *
 * Con số khớp với MOBILE_NAV_HEIGHT / MOBILE_FAB_TOP trong mobile-nav.tsx
 * (Tailwind cần chuỗi class tĩnh nên không nội suy biến vào đây được).
 * `env(safe-area-inset-bottom)` lo phần thanh gạt của iPhone.
 */
const PAD_NAV = "pb-[calc(7rem+env(safe-area-inset-bottom,0px))]"
const PAD_NAV_FAB = "pb-[calc(10rem+env(safe-area-inset-bottom,0px))]"

export function DashboardShell({ role, children }: DashboardShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()
  const isLauncher = pathname === "/home"
  const bottomPad = hasMobileFab(role, pathname) ? PAD_NAV_FAB : PAD_NAV

  // Ngăn kéo menu — dùng chung cho cả trang chủ lẫn các trang còn lại.
  const menuSheet = (
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
      <SheetContent side="left" className="w-72 p-0 bg-surface-container-low border-0">
        <Sidebar role={role} mobile onNavigate={() => setMobileOpen(false)} />
      </SheetContent>
    </Sheet>
  )

  // Trang chủ NVBH giữ bố cục tràn viền riêng (không sidebar, không header
  // chuẩn) nhưng VẪN phải có thanh nav dưới — nếu không thì đây là trang
  // đầu tiên sau khi đăng nhập mà lại không có đường nào đi tiếp ngoài
  // lưới icon, muốn về menu chính phải đi vòng qua một trang khác.
  if (isLauncher) {
    return (
      <OrderSyncProvider>
        <PermissionsLoader />
        {menuSheet}
        {children}
        <MobileNav role={role} onMenuClick={() => setMobileOpen(true)} />
      </OrderSyncProvider>
    )
  }

  return (
    <OrderSyncProvider>
    <div className="flex min-h-screen bg-surface">
      <PermissionsLoader />
      <Sidebar role={role} />

      {menuSheet}

      <div className="flex flex-1 flex-col min-h-screen min-w-0">
        <Header onMenuClick={() => setMobileOpen(true)} />
        <WorkflowResumeBar />
        {/* key={pathname}: remount main mỗi lần đổi route để chạy hiệu ứng
            page-enter (fadeInUp 0.3s) — app cảm giác mượt hơn khi điều hướng. */}
        <main
          key={pathname}
          className={cn(
            "flex-1 p-4 lg:p-container-padding lg:pb-container-padding page-enter",
            bottomPad
          )}
        >
          {children}
        </main>
      </div>

      <MobileNav role={role} onMenuClick={() => setMobileOpen(true)} />
    </div>
    </OrderSyncProvider>
  )
}
