"use client"

import Link from "@/components/ui/link"
import { ArrowRight, PencilRuler } from "lucide-react"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { duocVaoTrang } from "@/lib/nav/nav-permission"
import { BAO_CAO_TONG_HOP } from "@/lib/nav/bao-cao-tong-hop"
import type { Module } from "@/lib/permissions"

/**
 * Màn "Báo cáo tổng hợp" dùng TẠM trong lúc chờ thiết kế (chủ nhà 26/09/2026): nói màn này trả
 * lời câu hỏi gì, và dẫn tới các báo cáo cũ đang trả lời câu hỏi đó (chỉ những báo cáo người
 * xem có quyền).
 */
export function BaoCaoTam({ href, module }: { href: string; module: Module }) {
  const { user, loading } = useRoleGuard(module)
  const man = BAO_CAO_TONG_HOP.find((m) => m.href === href)
  if (loading || !man) return <Skeleton className="h-64" />
  // `duocVaoTrang` (không phải `canSeeHref`): vài báo cáo cũ không phải mục menu mà là cửa vào
  // (`CUA_VAO`, ví dụ /reports/inventory) — `canSeeHref` sẽ giấu nhầm.
  const cu = man.cu.filter((c) => duocVaoTrang(user?.role, c.href, "reports"))
  return (
    <div className="space-y-4" data-testid="bao-cao-tam">
      <PageHeader title={man.label} description={man.cauHoi} />
      <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        <PencilRuler className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Màn này đang được thiết kế lại. Trong lúc chờ, dùng các báo cáo hiện có bên dưới — chúng trả
          lời cùng câu hỏi.
        </p>
      </div>
      {cu.length === 0 ? (
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          Bạn chưa có quyền xem báo cáo nào của mục này.
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {cu.map((c) => (
            <li key={c.href}>
              <Link href={c.href} className="flex items-center justify-between gap-3 px-4 py-3 text-sm font-medium hover:bg-muted/40">
                {c.label}
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
