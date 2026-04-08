"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "./use-auth"
import { canAccessModule, type Module } from "@/lib/permissions"

export function useRoleGuard(module: Module) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && user && !canAccessModule(user.role, module)) {
      router.replace("/")
    }
  }, [user, loading, module, router])

  return { user, loading, hasAccess: user ? canAccessModule(user.role, module) : false }
}
