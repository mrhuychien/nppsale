"use client"

import { useState } from "react"
import { usePathname } from "next/navigation"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { MobileNav } from "@/components/layout/mobile-nav"
import { PageTitleProvider } from "@/components/layout/page-title-context"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { PermissionsLoader } from "@/components/permissions-loader"
import { WorkflowResumeBar } from "@/components/dashboard/workflow-resume-bar"
import { OrderSyncProvider } from "@/hooks/use-order-sync"
import type { Role } from "@/types"

interface DashboardShellProps {
  role: Role
  children: React.ReactNode
}

export function DashboardShell({ role, children }: DashboardShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()
  const isLauncher = pathname === "/home"

  /**
   * Ngăn kéo menu — dùng chung cho cả trang chủ lẫn các trang còn lại.
   *
   * Trên mobile là bottom sheet, không phải ngăn kéo trái w-72: ngăn kéo
   * trái buộc ngón cái với ngang màn hình. `side="bottom"` cộng grabber và
   * pb-safe do sheet.tsx lo.
   */
  const menuSheet = (
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
      <SheetContent
        side="bottom"
        className="p-0 pt-3 bg-surface-container-low border-0 lg:hidden"
      >
        <Sidebar role={role} mobile onNavigate={() => setMobileOpen(false)} />
      </SheetContent>
    </Sheet>
  )

  // Trang chủ NVBH giữ bố cục tràn viền riêng (không sidebar, không header
  // chuẩn) nhưng VẪN phải có thanh nav dưới — nếu không thì đây là trang
  // đầu tiên sau khi đăng nhập mà lại không có đường nào đi tiếp ngoài
  // lưới icon.
  //
  // Không dựng ngăn kéo menu ở nhánh này: trang chủ KHÔNG có nút hamburger
  // (nó có ô tìm kiếm + avatar riêng) nên sẽ không có gì mở được ngăn kéo —
  // và bản thân trang chủ đã là lưới toàn bộ chức năng, đúng thứ ngăn kéo
  // định hiện.
  if (isLauncher) {
    return (
      <PageTitleProvider>
        <OrderSyncProvider>
          <PermissionsLoader />
          {children}
          <MobileNav role={role} />
        </OrderSyncProvider>
      </PageTitleProvider>
    )
  }

  return (
    <PageTitleProvider>
    <OrderSyncProvider>
    <div className="flex min-h-screen bg-surface">
      <PermissionsLoader />
      <Sidebar role={role} />

      {menuSheet}

      <div className="flex flex-1 flex-col min-h-screen min-w-0">
        <Header onMenuClick={() => setMobileOpen(true)} />
        <WorkflowResumeBar />
        {/* key={pathname}: remount main mỗi lần đổi route để chạy hiệu ứng
            page-enter (fadeInUp 0.3s) — app cảm giác mượt hơn khi điều hướng.
            .pb-nav chừa đệm cho thanh nav cố định; chiều cao nav nằm ở
            --bottom-nav-h trong globals.css, không hardcode ở đây. */}
        <main
          key={pathname}
          className="flex-1 p-4 pb-nav lg:p-container-padding lg:pb-container-padding page-enter"
        >
          {children}
        </main>
      </div>

      <MobileNav role={role} />
    </div>
    </OrderSyncProvider>
    </PageTitleProvider>
  )
}
