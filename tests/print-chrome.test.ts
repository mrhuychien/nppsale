import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const BAR = code(read("src/components/dashboard/workflow-resume-bar.tsx"))
const CSS = read("src/app/globals.css")

/**
 * NGƯỜI DÙNG BÁO: thanh "1 việc đang dở" in kèm lên đầu phiếu xuất kho.
 * Rule in chỉ ẩn aside/header/nav/.no-print — thanh này là <div> nên lọt.
 */
describe("Khung ứng dụng không được lọt vào bản in", () => {
  it("globals.css ẩn .no-print khi in", () => {
    const i = CSS.indexOf("@media print {")
    expect(i).toBeGreaterThan(0)
    expect(CSS.slice(i, CSS.indexOf("\n}", i))).toContain(".no-print { display: none !important; }")
  })

  it("thanh việc đang dở mang lớp no-print ngay tại phần tử gốc", () => {
    const i = BAR.indexOf("return (\n    <div className=\"")
    expect(i).toBeGreaterThan(0)
    const root = BAR.slice(i, BAR.indexOf('"', i + 'return (\n    <div className="'.length))
    expect(root).toContain("no-print")
  })
})
