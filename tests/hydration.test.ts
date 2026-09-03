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

/**
 * Bỏ chú thích trước khi kiểm. Cần thiết vì các file này trích lại NGUYÊN
 * VĂN đoạn mã sai để giải thích vì sao đã sửa — không lọc thì test đỏ vì
 * chính lời giải thích của mình. Đã bị đúng như vậy với chuỗi "~28%".
 * Phải bỏ cả chú thích JSX `{/* … *\/}` chứ không chỉ `//`.
 */
function code(s: string): string {
  const noJsx = s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  const noBlock = noJsx.replace(/\/\*[\s\S]*?\*\//g, "")
  return noBlock
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
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

describe("sổ lỗi bàn giao — số bịa và nhãn nói sai", () => {
  /**
   * NPP-23: màn Xuất kho & Gộp đơn từng ghi "giúp giảm ~28% quãng đường
   * nhặt hàng" với 28% là số cứng — không đổi dù gộp 1, 2 hay 3 đơn, và
   * vẫn khẳng định giảm 28% khi chỉ chọn MỘT đơn (không gộp gì cả).
   */
  const STOCK_OUT = TSX.find((t) => t.file === "app/(dashboard)/inventory/stock-out/page.tsx")!

  it("không còn con số ~28% cứng", () => {
    expect(code(STOCK_OUT.src)).not.toContain("~28%")
  })

  it("khối gộp đơn chỉ hiện khi thật sự gộp từ 2 đơn", () => {
    expect(STOCK_OUT.src).toContain("{selectedOrders.length > 1 && (")
  })

  /**
   * NPP-25: ô KPI đếm đơn của khách CÓ TỪ 2 ĐƠN trở lên, nên 3 đơn của 3
   * khách khác nhau cho ra 0 — người dùng đang gộp đơn nhìn thấy 0 và
   * tưởng hệ thống hỏng.
   */
  it("nhãn ô KPI nói đúng cái nó đếm", () => {
    expect(STOCK_OUT.src).toContain("Đơn cùng khách có thể gộp")
    expect(code(STOCK_OUT.src)).not.toMatch(/>\s*Sẵn sàng gộp đơn\s*</)
  })

  /**
   * NPP-16: cột "Số HĐ" từng ưu tiên misa_invoice_id — đó là khoá nội bộ
   * của MISA (mig 011:9), không phải số hoá đơn. Hai dòng đầu bảng in ra
   * UUID, các dòng còn lại trống.
   */
  it("cột Số HĐ không in khoá nội bộ MISA", () => {
    const inv = TSX.find((t) => t.file === "app/(dashboard)/invoices/page.tsx")!
    expect(code(inv.src)).not.toContain("inv.misa_invoice_id || inv.invoice_number")
  })

  /**
   * NPP-15: cột misa_error có sẵn trong DB từ mig 011 nhưng chưa bao giờ
   * được truy vấn, nên hoá đơn "Lỗi" không hiện lý do.
   */
  it("hoá đơn lỗi hiện được lý do", () => {
    const inv = TSX.find((t) => t.file === "app/(dashboard)/invoices/page.tsx")!
    expect(inv.src).toContain("misa_error")
    expect(code(inv.src)).toMatch(/misa_status === "error"/)
  })

  /**
   * NPP-27: tám nhóm route không có trong bảng tiêu đề nên thanh trên cùng
   * ghi "Dashboard" ở cả Lịch sử đi tuyến, Trả hàng NCC, Phiếu thu, Chi phí
   * và toàn bộ nhóm Phân tích.
   */
  it("mọi nhóm route đều có tiêu đề tiếng Việt", () => {
    const header = readFileSync(
      resolve(__dirname, "../src/components/layout/header.tsx"),
      "utf-8"
    )
    for (const r of ["/analytics", "/finance", "/sales", "/purchase-returns",
                     "/notifications", "/operations", "/warehouse", "/setup"]) {
      expect(header, `thiếu tiêu đề cho ${r}`).toContain(`"${r}":`)
    }
    // Mặc định cuối cũng không được là chữ Anh "Dashboard".
    expect(header).not.toContain('|| "Dashboard"')
  })

  /** NPP-28: gõ sai đường dẫn ra màn trắng chữ Anh của Next.js. */
  it("có trang 404 tiếng Việt kèm đường ra", () => {
    const nf = readFileSync(resolve(__dirname, "../src/app/not-found.tsx"), "utf-8")
    expect(nf).toContain("Không tìm thấy trang này")
    expect(nf).toContain('href="/home"')
  })

  /**
   * NPP-24: chân trang màn Xuất kho từng in dải
   *   "[SYS] updated <giờ> · server: wms-edge-01 · merge_code=… · selected=…"
   * `wms-edge-01` là tên máy chủ BỊA, hard-code trong JSX — app chạy trên
   * Vercel, không có máy nào tên vậy. `updated <giờ>` lấy từ
   * useState(new Date()) nên đứng yên khi thao tác, và cũng là một lệch
   * hydration nữa.
   */
  it("không in tên máy chủ bịa ra giao diện", () => {
    expect(code(STOCK_OUT.src)).not.toContain("wms-edge-01")
  })

  it("không còn dải [SYS] và chuỗi kỹ thuật ở chân trang", () => {
    const c = code(STOCK_OUT.src)
    expect(c).not.toContain("[SYS]")
    expect(c).not.toContain("merge_code=")
    expect(c).not.toContain("selected=")
  })

  it("không lộ tên biến nội bộ ra giao diện", () => {
    // Dải chẩn đoán phiếu trả từng in "→ pickList".
    expect(code(STOCK_OUT.src)).not.toContain("→ pickList")
  })
})
