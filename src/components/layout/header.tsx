"use client"

import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { NotificationBell } from "@/components/layout/notification-bell"
import { ROLE_LABELS } from "@/lib/constants"
import { LogOut, Menu, Search } from "lucide-react"
import { useRouter, usePathname } from "next/navigation"

interface HeaderProps {
  onMenuClick?: () => void
}

const PAGE_TITLES: Record<string, string> = {
  "/home": "Trang chủ",
  "/dashboard": "Tổng quan kinh doanh",
  "/orders": "Quản lý đơn hàng",
  "/customers": "Quản lý khách hàng",
  "/products": "Quản lý sản phẩm",
  "/inventory": "Quản lý kho hàng",
  "/suppliers": "Nhà cung cấp",
  "/commissions": "Quản lý hoa hồng",
  "/receivables": "Quản lý công nợ",
  "/payables": "Công nợ nhà cung cấp",
  "/purchasing": "Mua hàng",
  "/purchasing/orders": "Đơn mua hàng",
  "/purchasing/invoices": "Hóa đơn mua hàng",
  "/deliveries": "Quản lý giao hàng",
  "/promotions": "Quản lý khuyến mãi",
  "/invoices": "Quản lý hóa đơn",
  "/returns": "Quản lý trả hàng",
  "/reports": "Báo cáo",
  "/settings": "Cài đặt",
  "/hr": "Nhân sự",
  "/help": "Trợ giúp & Hướng dẫn",
}

export function Header({ onMenuClick }: HeaderProps) {
  const { user, signOut } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  const handleSignOut = async () => {
    await signOut()
    router.push("/login")
  }

  const initials = user?.full_name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?"

  // Find page title by matching the longest prefix
  const pageTitle = Object.entries(PAGE_TITLES)
    .sort(([a], [b]) => b.length - a.length)
    .find(([prefix]) => pathname.startsWith(prefix))?.[1] || "Dashboard"

  return (
    <header className="sticky top-0 z-40 w-full bg-card/80 backdrop-blur border-b border-border/50 px-4 lg:px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-4 min-w-0 flex-1">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden h-9 w-9 shrink-0"
          onClick={onMenuClick}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <h2 className="text-base lg:text-lg font-semibold tracking-tight text-foreground truncate">
          {pageTitle}
        </h2>
      </div>

      <div className="flex items-center gap-2 lg:gap-3">
        {/* Search - hidden on mobile */}
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <input
            type="text"
            placeholder="Tìm kiếm nhanh..."
            className="pl-10 pr-4 py-2 bg-card border border-border/60 rounded-[10px] text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none w-56"
          />
        </div>

        <NotificationBell />

        <div className="hidden sm:block h-6 w-px bg-border/50 mx-1"></div>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 hover:bg-muted/50 rounded-lg pl-1 pr-3 py-1 transition-colors">
              <Avatar className="h-8 w-8 border border-border/40">
                <AvatarFallback className="text-xs bg-primary text-white font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="hidden lg:block text-left">
                <p className="text-sm font-medium leading-none">{user?.full_name}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {user?.role ? ROLE_LABELS[user.role] : ""}
                </p>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <p className="font-semibold">{user?.full_name}</p>
              <p className="text-xs font-normal text-muted-foreground mt-0.5">
                {user?.role ? ROLE_LABELS[user.role] : ""}
              </p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              Đăng xuất
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
