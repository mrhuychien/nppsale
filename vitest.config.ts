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
  /**
   * ⚠ JSX DỰNG THEO LỐI MỚI, để chốt GỌI THẲNG được một khối giao diện.
   *
   * `tsconfig.json` để `jsx: "preserve"` cho Next.js tự lo; esbuild của
   * vitest khi ấy dựng ra `React.createElement` và cần `React` trong
   * phạm vi — tệp nguồn không import React (Next.js không bắt), nên nổ
   * "React is not defined" NGAY LÚC CHẠY chốt.
   *
   * Cần vì chốt tiền thật sự CHẠY khối `InvoiceMoneySummary` rồi soi
   * cây phần tử trả về, thay vì ghim nguyên văn một dòng mã — thứ vỡ
   * ngay khi mã dời chỗ chứ không vì luật nào sai.
   */
  esbuild: { jsx: "automatic" },
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
