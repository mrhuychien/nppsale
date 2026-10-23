"use client"

import type { ReactNode } from "react"
import { useRouter } from "next/navigation"
import { LogOut } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useOrg } from "@/hooks/use-org"
import { canSeeHref } from "@/lib/nav/nav-permission"
import { ROLE_LABELS } from "@/lib/constants"
import { MUC_MENU_NGUOI_DUNG } from "@/components/layout/user-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * MENU NGƯỜI DÙNG ĐẦY ĐỦ — tải LƯỜI ở lần bấm đầu (xem `UserMenu`). `moNgay`: mở luôn khi vừa tải xong (lần bấm đầu
 * đã là lần mở).
 */
export function MenuNguoiDungDay({
  children,
  label,
  className,
  moNgay,
}: {
  children: ReactNode
  label: string
  className?: string
  moNgay: boolean
}) {
  const { user, signOut } = useAuth()
  const { org } = useOrg()
  const router = useRouter()
  const muc = MUC_MENU_NGUOI_DUNG.filter((m) => canSeeHref(user?.role, m.href))
  return (
    <DropdownMenu defaultOpen={moNgay}>
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
