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
 * Chiều cao thanh nav và chỗ cho nút "+" nằm trong globals.css
 * (--bottom-nav-h, --fab-extra-h); ở đây chỉ chọn lớp .pb-nav hoặc
 * .pb-nav-fab. Không chừa đủ đệm thì phần cuối danh sách nằm khuất dưới
 * nav — cuộn hết cỡ vẫn không đọc được, cũng không bấm được.
 *
 * Trước đây ba file tự giữ ba con số riêng (7rem / 10rem / 88px) trong khi
 * nav thật cao 103px, nên không bao giờ khớp nhau.
 */
export function DashboardShell({ role, children }: DashboardShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()
  const isLauncher = pathname === "/home"
  const bottomPad = hasMobileFab(role, pathname) ? "pb-nav-fab" : "pb-nav"

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
