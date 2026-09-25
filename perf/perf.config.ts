import { defineConfig } from "@playwright/test"
/**
 * ĐO HIỆU NĂNG /sell — `npx playwright test -c perf/perf.config.ts`.
 * Bản BUILD production (`next start`), Supabase giả danh mục cỡ thật, điện thoại
 * giả lập: CPU chậm 4×, mạng 4G chậm (1,6 Mbps · 150 ms). Không chạy trong bộ e2e.
 * Cần build trước với cùng biến môi trường (NEXT_PUBLIC_* được nhúng lúc build):
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=… npx next build
 */
const FAKE = 54321
const APP = 3300
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjQxMDI0NDQ4MDB9.eC5MLtApKS5oxLX_e6bEzp2KCQgXT2Ck46pimF_myGg"
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.perf\.ts/,
  timeout: 600_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${APP}`, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  webServer: [
    { command: `node perf/serve-fake-lon.mjs`, url: `http://127.0.0.1:${FAKE}/__log`, env: { FAKE_SUPABASE_PORT: String(FAKE) }, reuseExistingServer: false, cwd: ".." },
    {
      command: `npx next start -p ${APP}`, url: `http://127.0.0.1:${APP}/login`, timeout: 120_000, reuseExistingServer: false, cwd: "..",
      env: { NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${FAKE}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: ANON },
    },
  ],
})
