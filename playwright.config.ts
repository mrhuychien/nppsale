import { defineConfig } from "@playwright/test"

/**
 * CHỐT BẤM MÀN HÌNH — `npm run e2e`.
 *
 * App Next chạy THẬT (`next dev`), Chromium bấm THẬT; phía máy chủ là
 * Supabase giả trong bộ nhớ (e2e/fake-supabase.mjs — vì sao giả, đọc đầu
 * tệp ấy). Chốt đọc tải trọng app gửi đi qua GET /__log của máy chủ giả.
 */
const FAKE = 54321
const APP = 3100
// Khoá anon ký bằng bí mật giả của máy chủ giả — không phải khoá thật nào.
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjQxMDI0NDQ4MDB9.eC5MLtApKS5oxLX_e6bEzp2KCQgXT2Ck46pimF_myGg"

export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${APP}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: `node e2e/serve-fake.mjs`,
      url: `http://127.0.0.1:${FAKE}/__log`,
      env: { FAKE_SUPABASE_PORT: String(FAKE) },
      reuseExistingServer: false,
    },
    {
      command: `npx next dev -p ${APP}`,
      url: `http://127.0.0.1:${APP}/login`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${FAKE}`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
        SUPABASE_SERVICE_ROLE_KEY: ANON,
      },
    },
  ],
})
