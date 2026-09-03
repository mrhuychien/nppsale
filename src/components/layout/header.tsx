"use client"

import { useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { NotificationBell } from "@/components/layout/notification-bell"
import { OfflineIndicator } from "@/components/offline/offline-indicator"
import { MobileSearchOverlay } from "@/components/layout/mobile-search-overlay"
import { usePageTitle } from "@/components/layout/page-title-context"
import { ROLE_LABELS } from "@/lib/constants"
import { ArrowLeft, LogOut, Menu, Search } from "lucide-react"
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
  "/purchasing/invoices": "Hoá đơn mua hàng (tra cứu)",
  "/deliveries": "Quản lý giao hàng",
  "/promotions": "Quản lý khuyến mãi",
  "/invoices": "Quản lý hóa đơn",
  "/returns": "Quản lý trả hàng",
  "/reports": "Báo cáo",
  "/settings": "Cài đặt",
  "/hr": "Nhân sự",
  "/help": "Trợ giúp & Hướng dẫn",
  // Tám nhóm dưới đây trước không có trong bảng nên rơi về mặc định
  // "Dashboard" — thanh trên cùng ghi "Dashboard" ở cả trang Lịch sử đi
  // tuyến, Trả hàng NCC, Phiếu thu, Chi phí và toàn bộ nhóm Phân tích.
  // Tiêu đề chi tiết đặt TRƯỚC tiêu đề nhóm không quan trọng: chỗ tra cứu
  // sắp theo độ dài prefix giảm dần nên prefix dài luôn thắng.
  "/analytics": "Phân tích",
  "/analytics/business": "Phân tích kinh doanh",
  "/analytics/customers": "Phân tích khách hàng",
  "/analytics/products": "Phân tích sản phẩm",
  "/analytics/performance": "Phân tích hiệu suất",
  "/finance": "Tài chính",
  "/finance/cash-receipts": "Phiếu thu",
  "/finance/expenses": "Chi phí",
  "/sales": "Bán hàng",
  "/sales/visits": "Lịch sử đi tuyến",
  "/sales/pjp": "Lộ trình viếng thăm",
  "/purchase-returns": "Trả hàng nhà cung cấp",
  "/notifications": "Thông báo",
  "/operations": "Vận hành",
  "/warehouse": "Kho",
  "/setup": "Thiết lập ban đầu",
}

export function Header({ onMenuClick }: HeaderProps) {
  const { user, signOut } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const { title: pushedTitle, backHref } = usePageTitle()
  const [quickSearch, setQuickSearch] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)

  const handleSignOut = async () => {
    await signOut()
    router.push("/login")
  }

  // Enter → tìm mã đơn hàng trong /orders (trang orders đọc ?q=).
  const handleQuickSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return
    const term = quickSearch.trim()
    if (!term) return
    router.push(`/orders?q=${encodeURIComponent(term)}`)
  }

  const initials = user?.full_name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?"

  // Find page title by matching the longest prefix
  const fallbackTitle = Object.entries(PAGE_TITLES)
    .sort(([a], [b]) => b.length - a.length)
    .find(([prefix]) => pathname.startsWith(prefix))?.[1] || "npp.sale"

  /**
   * Tiêu đề trang thắng tiêu đề nhóm: /receivables/by-rep hiện "Công nợ của
   * tôi" chứ không phải "Quản lý công nợ". Bảng PAGE_TITLES vẫn cần cho các
   * trang chưa dùng PageHeader và cho lần render đầu trước khi effect chạy.
   */
  const pageTitle = pushedTitle ?? fallbackTitle

  // undefined = trang không khai báo nút back → chỗ đó là nút mở menu.
  const showBack = backHref !== undefined

  return (
    <>
    <header className="sticky top-0 z-40 w-full bg-surface/90 backdrop-blur-xl border-b border-outline-variant/60 px-1 lg:px-8 h-[var(--app-bar-h)] flex items-center gap-1">
      {/* Trái: nút back nếu trang khai báo, không thì nút mở menu. Hai nút
          không bao giờ cùng xuất hiện — mobile chỉ đủ chỗ cho một. */}
      {showBack ? (
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden shrink-0"
          onClick={() => (backHref ? router.push(backHref) : router.back())}
          aria-label="Quay lại"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden shrink-0"
          onClick={onMenuClick}
          aria-label="Mở menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
      )}
      <h1 className="flex-1 min-w-0 truncate px-1 text-[17px] font-bold tracking-tight text-on-surface lg:text-headline-md lg:font-semibold">
        {pageTitle}
      </h1>

      <div className="flex items-center gap-0.5 lg:gap-3">
        {/* Tìm kiếm trên mobile: trước đây ô search là `hidden md:block` nên
            NVBH không có cách nào tìm một mã đơn trên điện thoại. */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden shrink-0"
          onClick={() => setSearchOpen(true)}
          aria-label="Tìm đơn hàng"
        >
          <Search className="h-5 w-5" />
        </Button>

        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant h-4 w-4" />
          <input
            type="text"
            placeholder="Tìm mã đơn hàng... ⏎"
            value={quickSearch}
            onChange={(e) => setQuickSearch(e.target.value)}
            onKeyDown={handleQuickSearch}
            className="pl-10 pr-4 py-2 bg-surface-container-lowest border border-outline-variant rounded-lg text-sm placeholder:text-on-surface-variant/60 focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none w-56 focus:w-64 transition-all"
          />
        </div>

        <OfflineIndicator />

        <NotificationBell />

        <div className="hidden sm:block h-6 w-px bg-outline-variant/60 mx-1"></div>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Tài khoản"
              className="flex h-11 items-center gap-2 rounded-lg pl-1 pr-1.5 transition-colors hover:bg-surface-container-low lg:h-auto lg:pr-3 lg:py-1"
            >
              <Avatar className="h-8 w-8 border border-outline-variant/60">
                <AvatarFallback className="text-xs bg-primary text-on-primary font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="hidden lg:block text-left">
                <p className="text-sm font-medium leading-none text-on-surface">{user?.full_name}</p>
                <p className="text-[10px] text-on-surface-variant mt-0.5">
                  {user?.role ? ROLE_LABELS[user.role] : ""}
                </p>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <p className="font-semibold text-on-surface">{user?.full_name}</p>
              <p className="text-xs font-normal text-on-surface-variant mt-0.5">
                {user?.role ? ROLE_LABELS[user.role] : ""}
              </p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="text-error">
              <LogOut className="mr-2 h-4 w-4" />
              Đăng xuất
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
    <MobileSearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  )
}
