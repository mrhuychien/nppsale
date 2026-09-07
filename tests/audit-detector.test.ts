import { describe, it, expect } from "vitest"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Máy dò truy vấn chưa kiểm lỗi (scripts/audit-unchecked-db.py) là cổng
 * chặn merge, nhưng bản thân nó thì chưa từng có test — và đã trả giá:
 *
 *   Nó báo nhầm 35 chỗ (mã có kiểm lỗi đầy đủ, chỉ là viết theo hình dạng
 *   `fetchAllForAggregate((from, to) => supabase…)` mà nó không hiểu). CI
 *   đỏ liên tục 30 commit, không ai còn nhìn nữa, và 3 lỗi THẬT nằm lẫn
 *   trong đống báo nhầm đó cũng trôi qua luôn.
 *
 * Nới lỏng máy dò cho hết báo nhầm là rất dễ — và nới quá tay thì nó im
 * lặng với cả lỗi thật, tức là tệ hơn không có. Hai file mồi dưới đây giữ
 * cả hai đầu: mã ĐÃ kiểm phải im, mã CHƯA kiểm phải kêu.
 */
const ROOT = resolve(__dirname, "..")
const PROBES = "tests/fixtures/audit-probes"

type Finding = { file: string; line: number; op: string; code: string }

function audit(target: string): Finding[] {
  const out = execFileSync(
    "python3",
    [resolve(ROOT, "scripts/audit-unchecked-db.py"), "--json", target],
    { cwd: ROOT, encoding: "utf-8" }
  )
  return JSON.parse(out) as Finding[]
}

/** Tên bảng trong `.from("…")` của một cảnh báo. */
const tableOf = (f: Finding) => /\.from\(\s*["']([^"']+)/.exec(f.code)?.[1] ?? f.code

describe("Máy dò truy vấn chưa kiểm lỗi", () => {
  const findings = audit(PROBES)
  const flagged = new Set(findings.map(tableOf))

  /**
   * ⚠ Vế BÁO NHẦM. Mỗi hình dạng ở đây là cách viết có thật trong dự án và
   * đều CÓ kiểm lỗi. Một cái lọt vào danh sách là cổng bắt đầu kêu oan —
   * lần trước chuyện đó đã đủ để cả cái cổng bị bỏ mặc.
   */
  it("im lặng với mọi hình dạng ĐÃ kiểm lỗi", () => {
    // `endsWith("checked.ts")` khớp luôn cả unchecked.ts — phải so tên file.
    const noise = findings.filter((f) => f.file.split("/").pop() === "checked.ts")
    expect(noise.map((f) => `${f.file}:${f.line} ${f.code}`)).toEqual([])
  })

  /**
   * ⚠ Vế BỎ LỌT. Mỗi mồi là bản sinh đôi của một hình dạng ở trên, chỉ khác
   * đúng chỗ kiểm lỗi bị bỏ.
   */
  it("bắt được TẤT CẢ hình dạng CHƯA kiểm lỗi", () => {
    const expected = [
      "probe_wrapped_bad", // đối số của hàm bọc
      "probe_all_bad_a", // phần tử Promise.all
      "probe_all_bad_b", // phần tử Promise.all, có object nhiều dòng
      "probe_then_bad", // handler .then
      "probe_json_error_key_bad", // có khoá JSON trùng tên ngay dưới
      "probe_neighbour_bad_a", // đứng dưới một câu lệnh đã kiểm
      "probe_neighbour_bad_b",
      "probe_wrapper_json_key_bad", // trong Promise.all, dưới là khoá JSON
      "probe_write_bad", // GHI: update
      "probe_insert_bad", // GHI: insert
    ]
    for (const t of expected) {
      expect(flagged.has(t), `bỏ lọt mồi ${t}`).toBe(true)
    }
  })

  /** Ghi sai mức nguy hiểm thì thứ tự ưu tiên sửa cũng sai theo. */
  it("phân đúng GHI (mất dữ liệu) và ĐỌC (rỗng im lặng)", () => {
    const byTable = new Map(findings.map((f) => [tableOf(f), f.op]))
    expect(byTable.get("probe_write_bad")).toBe("ghi")
    expect(byTable.get("probe_insert_bad")).toBe("ghi")
    expect(byTable.get("probe_wrapped_bad")).toBe("doc")
    expect(byTable.get("probe_then_bad")).toBe("doc")
  })

  /**
   * `// audit-ok:` là lối thoát CÓ CHỦ Ý và phải kèm lý do. Không có lý do
   * thì nó chỉ là cách tắt cảnh báo cho tiện — máy dò vẫn phải kêu.
   */
  it("audit-ok phải kèm lý do mới được bỏ qua", () => {
    expect(flagged.has("probe_auditok"), "audit-ok có lý do vẫn bị kêu").toBe(false)
    expect(flagged.has("probe_auditok_noreason"), "audit-ok trống mà được tha").toBe(true)
  })
})

describe("Cổng CI và cổng chạy tay phải là MỘT", () => {
  /**
   * ⚠ ĐÂY LÀ GỐC RỄ CỦA CẢ CHUYỆN NÀY. `npm run verify` thiếu đúng bước
   * đang đỏ, nên chạy ở máy thấy xanh mà CI thì đỏ suốt 30 commit. Cổng
   * nào chạy tay không tới được thì sớm muộn cũng bị bỏ quên.
   */
  it("npm run verify chạy đủ mọi bước của workflow", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"))
    const verify: string = pkg.scripts.verify
    const wf = readFileSync(resolve(ROOT, ".github/workflows/verify.yml"), "utf-8")

    // Mọi dòng `run:` của workflow, trừ phần cài đặt phụ thuộc.
    const steps: string[] = []
    const re = /^\s*run:\s*(.+)$/gm
    let m: RegExpExecArray | null
    while ((m = re.exec(wf)) !== null) {
      const cmd = m[1].trim()
      if (cmd !== "npm ci") steps.push(cmd)
    }

    expect(steps.length).toBeGreaterThan(0)
    for (const cmd of steps) {
      expect(verify.includes(cmd), `verify thiếu bước CI: ${cmd}`).toBe(true)
    }
  })
})
