import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { resolve, join } from "node:path"
import { formatDate, formatDateTime, VN_TZ } from "@/lib/utils"

/**
 * Chặn nhóm lỗi MOB-13 quay lại: React #418/#423 (HTML server không khớp
 * HTML client).
 *
 * Next.js dựng HTML ở server rồi khớp lại ở trình duyệt. Bất cứ thứ gì
 * KHÁC NHAU giữa hai lần chạy đều làm React bỏ toàn bộ HTML server và
 * render lại, kèm một lỗi trong console. Ba nguồn thường gặp:
 *
 *   1. `new Date()` — hai thời điểm khác nhau, trên hai múi giờ khác nhau
 *      (Vercel chạy UTC, điện thoại ở UTC+7).
 *   2. `toLocaleDateString` không đặt timeZone — lấy múi giờ máy đang chạy.
 *   3. `Math.random()`.
 *
 * Nằm trong `hidden`/`print:block` cũng không thoát: CSS ẩn đi nhưng nút
 * vẫn có trong DOM nên vẫn phải khớp.
 */

const SRC = resolve(__dirname, "../src")

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith(".tsx")) out.push(p)
  }
  return out
}

const TSX = walk(SRC).map((f) => ({ file: f.slice(SRC.length + 1), src: readFileSync(f, "utf-8") }))

/** Bỏ dòng chú thích — các file này trích lại nguyên văn đoạn mã sai. */
function code(s: string): string {
  return s
    .split("\n")
    .filter((l) => {
      const t = l.trimStart()
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*")
    })
    .join("\n")
}

describe("định dạng ngày phải ghim múi giờ Việt Nam", () => {
  /**
   * Không ghim thì cùng một mốc timestamptz ra hai ngày khác nhau ở server
   * và ở điện thoại. Đây vừa là lệch hydration, vừa là SAI NGÀY: đơn tạo
   * lúc 02:00 giờ Việt Nam ngày 21/04 là 19:00 UTC ngày 20/04.
   */
  it("formatDate đọc mốc buổi đêm ra đúng ngày Việt Nam", () => {
    // 19:00 UTC ngày 20/04 = 02:00 giờ VN ngày 21/04.
    expect(formatDate("2026-04-20T19:00:00Z")).toBe("21/04/2026")
  })

  it("formatDate không bị múi giờ máy chạy test làm lệch", () => {
    // 23:30 giờ VN ngày 21/04 vẫn phải là 21/04, không nhảy sang 22/04.
    expect(formatDate("2026-04-21T16:30:00Z")).toBe("21/04/2026")
  })

  it("formatDateTime cũng ghim cùng múi giờ", () => {
    expect(formatDateTime("2026-04-20T19:00:00Z")).toContain("21/04/2026")
    expect(formatDateTime("2026-04-20T19:00:00Z")).toContain("02:00")
  })

  it("cột ngày trần (không giờ) không bị lùi một ngày", () => {
    // `new Date("2026-04-20")` là 00:00 UTC; đọc theo giờ VN là 07:00 cùng
    // ngày nên vẫn 20/04. Nếu ai đổi sang múi giờ âm thì test này đỏ.
    expect(formatDate("2026-04-20")).toBe("20/04/2026")
  })

  it("hằng số múi giờ là Asia/Ho_Chi_Minh", () => {
    expect(VN_TZ).toBe("Asia/Ho_Chi_Minh")
  })
})

describe("không lấy thời điểm hiện tại trong lúc render", () => {
  /**
   * `new Date()` ngay trong JSX là lệch hydration chắc chắn 100%: hai lần
   * chạy là hai thời điểm khác nhau.
   */
  it("không có new Date() nào nằm trực tiếp trong JSX", () => {
    const bad: string[] = []
    for (const { file, src } of TSX) {
      const c = code(src)
      // `{new Date()` trong JSX. Trong hàm xử lý sự kiện thì không sao, nên
      // chỉ bắt trường hợp đưa thẳng ra chuỗi hiển thị.
      const re = /\{new Date\(\)\.toLocale|\{new Date\(\)\.getFullYear/g
      if (re.test(c)) bad.push(file)
    }
    expect(bad, `các file này lấy giờ hiện tại trong lúc render: ${bad.join(", ")}`).toEqual([])
  })

  it("có hook dùng chung cho dấu thời gian trên bản in", () => {
    const hook = readFileSync(resolve(__dirname, "../src/hooks/use-client-now.ts"), "utf-8")
    expect(hook).toContain("useEffect")
    // Phải trả rỗng ở lần render đầu để hai phía giống nhau.
    expect(hook).toContain('useState("")')
    expect(hook).toContain("VN_TZ")
  })

  it("cả ba khung báo cáo đều dùng hook đó, không tự gọi new Date()", () => {
    for (const f of [
      "components/analytics/report-frame.tsx",
      "components/analytics/report-shell.tsx",
      "app/(dashboard)/reports/finance/page.tsx",
    ]) {
      const hit = TSX.find((t) => t.file === f)
      expect(hit, `không tìm thấy ${f}`).toBeTruthy()
      expect(code(hit!.src), `${f} chưa dùng useClientNow`).toContain("useClientNow")
    }
  })
})

describe("không dựng số liệu hiển thị bằng Math.random()", () => {
  /**
   * Thẻ "Xu hướng tồn kho" ở /reports/inventory từng vẽ cột bằng
   *     stats.totalItems * (0.6 + Math.random() * 0.5)
   * dưới tiêu đề "Tổng tồn kho theo 6 tháng gần nhất" kèm chú giải "Tổng
   * đơn vị tồn" — người xem tin đó là số thật và có thể kết luận về xu
   * hướng tồn kho từ số bịa. Cột còn đổi mỗi lần render.
   *
   * Math.random() hợp lệ khi sinh mã phiếu (trong hàm xử lý sự kiện, không
   * đưa ra màn hình), nên chỉ chặn các trang báo cáo.
   */
  it("các trang báo cáo không dùng Math.random()", () => {
    const bad: string[] = []
    for (const { file, src } of TSX) {
      if (!file.includes("/reports/") && !file.includes("analytics/")) continue
      if (code(src).includes("Math.random()")) bad.push(file)
    }
    expect(bad, `trang báo cáo dùng số ngẫu nhiên: ${bad.join(", ")}`).toEqual([])
  })

  it("biểu đồ xu hướng tồn kho nói thật là chưa có dữ liệu", () => {
    const f = TSX.find((t) => t.file === "app/(dashboard)/reports/inventory/page.tsx")!
    expect(f.src).toContain("Chưa theo dõi được xu hướng tồn kho")
    // Và không còn hứa "6 tháng gần nhất" khi không dựng được.
    expect(code(f.src)).not.toContain("Tổng tồn kho theo 6 tháng gần nhất")
  })
})
