"use client"

import type { ReactNode } from "react"
import { useRouter } from "next/navigation"
import { Home, Wallet, BarChart3, Settings, HelpCircle, LogOut } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useOrg } from "@/hooks/use-org"
import { canSeeHref } from "@/lib/nav/nav-permission"
import { ROLE_LABELS } from "@/lib/constants"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/** Các mục của menu người dùng — mục nào không có quyền thì ẩn (`canSeeHref`). */
export const MUC_MENU_NGUOI_DUNG = [
  { href: "/home", label: "Trang chủ", icon: Home },
  { href: "/luong-cua-toi", label: "Phiếu lương của tôi", icon: Wallet },
  { href: "/dashboard", label: "Tổng quan", icon: BarChart3 },
  { href: "/settings", label: "Cài đặt", icon: Settings },
  { href: "/help", label: "Trợ giúp", icon: HelpCircle },
] as const

/** Chữ viết tắt cho ảnh đại diện: "Nguyễn Thị Hiền" → "NH". */
export function chuVietTat(ten: string | null | undefined): string {
  const w = String(ten ?? "").trim().split(/\s+/).filter(Boolean)
  if (w.length === 0) return "U"
  return ((w[0][0] ?? "") + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase()
}

/**
 * MENU NGƯỜI DÙNG — chủ nhà 26/09/2026: "bấm vào icon và tên người dùng phải ra menu người
 * dùng". Một chỗ cho mọi nơi hiện ảnh đại diện / tên (thanh trên, trang chủ, đầu trang xanh
 * của Đơn hàng / Khách hàng): tên + vai, các lối đi nhanh theo quyền, Đăng xuất.
 * `children` là phần bấm được (ảnh đại diện, kèm tên nếu có).
 */
export function UserMenu({ children, label = "Tài khoản", className }: { children: ReactNode; label?: string; className?: string }) {
  const { user, signOut } = useAuth()
  const { org } = useOrg()
  const router = useRouter()
  const muc = MUC_MENU_NGUOI_DUNG.filter((m) => canSeeHref(user?.role, m.href))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={label} className={className}>
          {children}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" data-testid="menu-nguoi-dung">
        <DropdownMenuLabel>
          <p className="font-semibold">{user?.full_name || "Người dùng"}</p>
          <p className="mt-0.5 text-xs font-normal text-muted-foreground">
            {[user?.role ? ROLE_LABELS[user.role] ?? user.role : "", org?.name].filter(Boolean).join(" · ")}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {muc.map((m) => (
          <DropdownMenuItem key={m.href} onClick={() => router.push(m.href)}>
            <m.icon className="mr-2 h-4 w-4" />
            {m.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            await signOut()
            router.push("/login")
          }}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Đăng xuất
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
