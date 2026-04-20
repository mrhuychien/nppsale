import { createClient as createSupabaseClient } from "@supabase/supabase-js"

/**
 * Admin Supabase client with service_role key.
 * SERVER-SIDE ONLY - NEVER import this in client components.
 * Used for admin operations like creating/deleting auth users.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceKey) {
    throw new Error("Thiếu env var SUPABASE_SERVICE_ROLE_KEY hoặc NEXT_PUBLIC_SUPABASE_URL")
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
