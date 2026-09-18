import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const CSS = read("src/app/globals.css")
const SHELL = code(read("src/components/layout/dashboard-shell.tsx"))

/**
 * NGƯỜI DÙNG BÁO: thanh "1 việc đang dở" in kèm lên đầu phiếu xuất kho.
 * Rule in chỉ ẩn aside/header/nav/.no-print — thanh đó là <div> nên lọt.
 *
 * ⚠ THANH ĐÓ ĐÃ GỠ HẲN (chủ nhà yêu cầu), nên chốt về nó không còn chỗ
 * bám. Nhưng `.no-print` thì PHẢI Ở LẠI: nó là thứ duy nhất chặn mọi
 * khối khung ứng dụng khác lọt vào bản in, và chốt dưới đây là cái giữ
 * cho nó không bị dọn nhầm cùng thanh kia.
 */
describe("Khung ứng dụng không được lọt vào bản in", () => {
  it("globals.css ẩn .no-print khi in", () => {
    const i = CSS.indexOf("@media print {")
    expect(i).toBeGreaterThan(0)
    expect(CSS.slice(i, CSS.indexOf("\n}", i))).toContain(".no-print { display: none !important; }")
  })

  it("khung dashboard không mount lại thanh việc đang dở", () => {
    expect(SHELL).not.toContain("WorkflowResumeBar")
  })
})
