import { defineConfig } from "vitest/config"
import path from "path"

/**
 * Kiểm thử đơn vị cho phần logic thuần (tính tiền, quy đổi đơn vị,
 * quy tắc duyệt đơn, phân quyền...). Đây là phần dễ sai mà hậu quả
 * bằng tiền thật, nên được ưu tiên phủ test trước tiên.
 *
 * Chạy:  npm test          (một lần)
 *        npm run test:watch
 *        npm run test:coverage
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/supabase/**", "**/*.d.ts"],
      reporter: ["text", "html"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
