"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

interface DiagnosticResult {
  name: string
  status: "pending" | "success" | "error"
  message?: string
  duration?: number
}

// Build ID changes on every deploy - use to verify latest deployment
const BUILD_VERSION = "v6-getSession-20260416"

export default function DebugPage() {
  const [results, setResults] = useState<DiagnosticResult[]>([])
  const [envInfo, setEnvInfo] = useState<{
    hasUrl: boolean
    urlPrefix: string
    hasKey: boolean
    keyPrefix: string
  }>({ hasUrl: false, urlPrefix: "", hasKey: false, keyPrefix: "" })

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
    setEnvInfo({
      hasUrl: !!url,
      urlPrefix: url.slice(0, 30),
      hasKey: !!key,
      keyPrefix: key.slice(0, 20),
    })

    async function runDiagnostics() {
      const tests: DiagnosticResult[] = [
        { name: "1. Env vars co san", status: "pending" },
        { name: "2. Ping Supabase auth endpoint", status: "pending" },
        { name: "3. Doc session tu local storage", status: "pending" },
        { name: "4. Query bang users (public)", status: "pending" },
        { name: "5. Goi auth.getUser() (co the treo)", status: "pending" },
      ]
      setResults([...tests])

      // Test 1: Env vars
      const t0 = performance.now()
      if (url && key) {
        tests[0] = {
          ...tests[0],
          status: "success",
          message: "Ca 2 env vars deu co",
          duration: performance.now() - t0,
        }
      } else {
        tests[0] = {
          ...tests[0],
          status: "error",
          message: `URL: ${!!url}, KEY: ${!!key}`,
        }
      }
      setResults([...tests])

      // Test 2: Ping Supabase (raw fetch, no supabase-js)
      const t1 = performance.now()
      try {
        const controller = new AbortController()
        const to = setTimeout(() => controller.abort(), 5000)
        const res = await fetch(`${url}/auth/v1/settings`, {
          signal: controller.signal,
          headers: { apikey: key },
        })
        clearTimeout(to)
        tests[1] = {
          ...tests[1],
          status: res.ok ? "success" : "error",
          message: `HTTP ${res.status} ${res.statusText}`,
          duration: performance.now() - t1,
        }
      } catch (err) {
        tests[1] = {
          ...tests[1],
          status: "error",
          message: err instanceof Error ? err.message : String(err),
          duration: performance.now() - t1,
        }
      }
      setResults([...tests])

      // Test 3: getSession
      const t2 = performance.now()
      try {
        const supabase = createClient()
        const { data, error } = await supabase.auth.getSession()
        tests[2] = {
          ...tests[2],
          status: error ? "error" : "success",
          message: error
            ? error.message
            : data.session
              ? `Co session: ${data.session.user.email}`
              : "Khong co session (chua login)",
          duration: performance.now() - t2,
        }
      } catch (err) {
        tests[2] = {
          ...tests[2],
          status: "error",
          message: err instanceof Error ? err.message : String(err),
          duration: performance.now() - t2,
        }
      }
      setResults([...tests])

      // Test 4: Query users table (will fail if not logged in, that's expected)
      const t3 = performance.now()
      try {
        const supabase = createClient()
        const { error } = await supabase.from("users").select("id").limit(1)
        tests[3] = {
          ...tests[3],
          status: error ? "error" : "success",
          message: error ? error.message : "Query thanh cong",
          duration: performance.now() - t3,
        }
      } catch (err) {
        tests[3] = {
          ...tests[3],
          status: "error",
          message: err instanceof Error ? err.message : String(err),
          duration: performance.now() - t3,
        }
      }
      setResults([...tests])

      // Test 5: getUser (this was the hanging one)
      const t4 = performance.now()
      try {
        const supabase = createClient()
        const { data, error } = await supabase.auth.getUser()
        tests[4] = {
          ...tests[4],
          status: error ? "error" : "success",
          message: error
            ? error.message
            : data.user
              ? `User: ${data.user.email}`
              : "Khong co user",
          duration: performance.now() - t4,
        }
      } catch (err) {
        tests[4] = {
          ...tests[4],
          status: "error",
          message: err instanceof Error ? err.message : String(err),
          duration: performance.now() - t4,
        }
      }
      setResults([...tests])
    }

    runDiagnostics()
  }, [])

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-black mb-1">Chan doan he thong</h1>
          <p className="text-sm text-muted-foreground">
            Build: <span className="font-mono">{BUILD_VERSION}</span>
          </p>
        </div>

        {/* Env info */}
        <div className="bg-card rounded-2xl shadow-ambient p-6 space-y-2">
          <h2 className="font-bold mb-2">Environment Variables</h2>
          <div className="text-sm space-y-1 font-mono">
            <div>
              NEXT_PUBLIC_SUPABASE_URL:{" "}
              {envInfo.hasUrl ? (
                <span className="text-green-600">
                  ✓ {envInfo.urlPrefix}...
                </span>
              ) : (
                <span className="text-destructive">✗ MISSING</span>
              )}
            </div>
            <div>
              NEXT_PUBLIC_SUPABASE_ANON_KEY:{" "}
              {envInfo.hasKey ? (
                <span className="text-green-600">
                  ✓ {envInfo.keyPrefix}...
                </span>
              ) : (
                <span className="text-destructive">✗ MISSING</span>
              )}
            </div>
          </div>
        </div>

        {/* Diagnostic tests */}
        <div className="bg-card rounded-2xl shadow-ambient p-6 space-y-3">
          <h2 className="font-bold">Diagnostic tests</h2>
          {results.map((r, i) => (
            <div
              key={i}
              className="flex items-start gap-3 py-2 border-b border-border/40 last:border-0"
            >
              <div className="shrink-0 mt-0.5">
                {r.status === "pending" && (
                  <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                )}
                {r.status === "success" && (
                  <div className="w-5 h-5 bg-green-100 text-green-700 rounded-full flex items-center justify-center text-xs font-black">
                    ✓
                  </div>
                )}
                {r.status === "error" && (
                  <div className="w-5 h-5 bg-destructive/10 text-destructive rounded-full flex items-center justify-center text-xs font-black">
                    ✗
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-sm">{r.name}</p>
                  {r.duration !== undefined && (
                    <span className="text-xs text-muted-foreground font-mono shrink-0">
                      {Math.round(r.duration)}ms
                    </span>
                  )}
                </div>
                {r.message && (
                  <p className="text-xs text-muted-foreground mt-1 break-words">
                    {r.message}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Instructions */}
        <div className="bg-surface-low rounded-2xl p-6 text-sm space-y-2">
          <h3 className="font-bold">Cach doc ket qua</h3>
          <ul className="space-y-1 list-disc list-inside text-muted-foreground">
            <li>Test 1 ✗ → Env vars thieu tren Vercel</li>
            <li>Test 2 ✗ → Supabase URL sai hoac project bi paused</li>
            <li>Test 2 timeout → Supabase khong response</li>
            <li>Test 3 ✗ → Key sai</li>
            <li>Test 4 cham ({">"}3s) → Supabase server cham</li>
            <li>Test 5 cham khac Test 3 → getUser specifically slow</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
