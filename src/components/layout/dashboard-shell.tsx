"use client"

import { useState } from "react"
import { usePathname } from "next/navigation"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { MobileNav } from "@/components/layout/mobile-nav"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { PermissionsLoader } from "@/components/permissions-loader"
import { WorkflowResumeBar } from "@/components/dashboard/workflow-resume-bar"
import type { Role } from "@/types"

interface DashboardShellProps {
  role: Role
  children: React.ReactNode
}

export function DashboardShell({ role, children }: DashboardShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()
  const isLauncher = pathname === "/home"

  if (isLauncher) {
    return (
      <>
        <PermissionsLoader />
        {children}
      </>
    )
  }

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
        <WorkflowResumeBar />
        <main className="flex-1 p-6 pb-24 lg:pb-6">
          {children}
        </main>
      </div>

      <MobileNav role={role} onMenuClick={() => setMobileOpen(true)} />
    </div>
  )
}
