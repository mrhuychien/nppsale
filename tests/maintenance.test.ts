import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  MAINTENANCE_ALLOWED_PREFIXES,
  MAINTENANCE_BYPASS_COOKIE,
  isMaintenanceAllowed,
  isMaintenanceMode,
  shouldBlockForMaintenance,
} from "../src/lib/maintenance"

/**
 * CHẾ ĐỘ BẢO TRÌ.
 *
 * ⚠ Nó chặn mọi lần TẢI TRANG MỚI, không chặn một tab đang mở sẵn — mã
 * trong tab đó nói thẳng với Supabase qua PostgREST, không đi qua máy chủ
 * Next.js. Chốt ở đây canh phần làm được; phần không làm được nằm ở
 * `docs/bao-tri.md` và trong chú thích đầu `src/lib/maintenance.ts`.
 */
const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

describe("Đọc cờ bật/tắt", () => {
  it.each(["1", "true", "TRUE", "on", " on "])("bật với %o", (v) => {
    expect(isMaintenanceMode(v)).toBe(true)
  })

  /**
   * ⚠ CHỖ NÀY LÀ CÁI BẪY. `Boolean("false")` ra `true` vì đó là chuỗi
   * khác rỗng — đặt `MAINTENANCE_MODE=false` để TẮT hoá ra BẬT, và không
   * có cách nào tắt ngoài việc xoá hẳn biến rồi deploy lại. Đúng lúc
   * hoảng nhất thì không tắt được.
   */
  it.each(["false", "0", "off", "no", "", "  "])("tắt với %o", (v) => {
    expect(isMaintenanceMode(v)).toBe(false)
  })

  it("không đặt biến thì tắt", () => {
    expect(isMaintenanceMode(undefined)).toBe(false)
  })
})

describe("Đường vẫn mở khi đang đóng cửa", () => {
  /**
   * ⚠ KHÔNG CHO `/maintenance` QUA thì nó tự chuyển hướng vào chính mình
   * — vòng lặp vô hạn, và người dùng thấy trang lỗi của trình duyệt chứ
   * không thấy lời nhắn nào.
   */
  it("chính trang bảo trì đi qua được", () => {
    expect(isMaintenanceAllowed("/maintenance")).toBe(true)
  })

  /**
   * ⚠ TRANG CHẨN ĐOÁN PHẢI SỐNG SÓT MỌI CHẾ ĐỘ. Nó là chỗ duy nhất xem
   * được cấu hình khi mọi thứ khác hỏng; khoá nó lại là tự bịt mắt mình
   * đúng lúc cần nhìn nhất.
   */
  it("trang chẩn đoán đi qua được, kể cả đường con", () => {
    expect(isMaintenanceAllowed("/debug")).toBe(true)
    expect(isMaintenanceAllowed("/debug/env")).toBe(true)
  })

  /**
   * ⚠ SO KHỚP THEO ĐOẠN ĐƯỜNG, KHÔNG PHẢI THEO TIỀN TỐ CHUỖI. Dùng
   * `startsWith("/debug")` trần trụi thì `/debugging-orders` cũng lọt —
   * một đường dẫn hoàn toàn khác bỗng dưng mở toang.
   */
  it("đường chỉ TRÙNG TIỀN TỐ chuỗi thì không lọt", () => {
    expect(isMaintenanceAllowed("/debugging-orders")).toBe(false)
    expect(isMaintenanceAllowed("/maintenance-report")).toBe(false)
  })

  it.each(["/", "/orders", "/sell", "/sales-invoices/abc", "/login"])(
    "%s bị chặn",
    (p) => {
      expect(isMaintenanceAllowed(p)).toBe(false)
    }
  )

  /** Danh sách ngắn có chủ ý — mỗi đường mở thêm là một đường lọt. */
  it("danh sách mở chỉ có đúng hai đường", () => {
    expect([...MAINTENANCE_ALLOWED_PREFIXES]).toEqual(["/maintenance", "/debug"])
  })
})

describe("Quyết định cuối", () => {
  const ask = (over: Partial<Parameters<typeof shouldBlockForMaintenance>[0]> = {}) =>
    shouldBlockForMaintenance({
      pathname: "/orders",
      hasBypassCookie: false,
      envValue: "1",
      ...over,
    })

  it("đang bảo trì thì chặn", () => {
    expect(ask()).toBe(true)
  })

  it("không bảo trì thì cho qua hết", () => {
    expect(ask({ envValue: "0" })).toBe(false)
    expect(ask({ envValue: undefined })).toBe(false)
  })

  /**
   * Cookie mở đường cho người đang chạy migration tự kiểm trước khi mở
   * cửa lại. ⚠ KHÔNG phải một lớp bảo mật — vào rồi vẫn phải đăng nhập
   * và vẫn bị RLS chặn như mọi người.
   */
  it("có cookie mở đường thì đi qua", () => {
    expect(ask({ hasBypassCookie: true })).toBe(false)
  })

  /** Cờ tắt là cho qua hết, có cookie hay không cũng vậy. */
  it("cờ tắt thì cookie không còn ý nghĩa gì", () => {
    expect(ask({ envValue: "off", hasBypassCookie: false })).toBe(false)
    expect(ask({ envValue: "off", hasBypassCookie: true })).toBe(false)
  })

  /**
   * ⚠ CHỐT NÀY BỊ THIẾU Ở BẢN ĐẦU, VÀ THỬ PHÁ BẮT ĐƯỢC. Mọi chốt trên
   * đều hỏi với đường `/orders`, nên `shouldBlockForMaintenance` có thể
   * bỏ qua HẲN danh sách đường mở (`return true` trần trụi) mà cả bộ vẫn
   * xanh. Khi đó `/maintenance` tự chặn chính nó: middleware rewrite vào
   * nó, nó lại bị chặn, và người dùng thấy trang lỗi của trình duyệt chứ
   * không thấy lời nhắn nào.
   *
   * Danh sách đường mở được kiểm riêng ở khối trên, nhưng kiểm riêng
   * không đủ — phải kiểm nó CÓ ĐƯỢC ĐẤU DÂY vào quyết định cuối không.
   */
  it.each([...MAINTENANCE_ALLOWED_PREFIXES])(
    "%s không bị chặn dù đang bảo trì",
    (p) => {
      expect(ask({ pathname: p })).toBe(false)
    }
  )

  it("đường con của đường mở cũng đi qua được", () => {
    expect(ask({ pathname: "/debug/env" })).toBe(false)
  })
})

describe("Middleware nối đúng chỗ", () => {
  const MW = read("src/middleware.ts").replace(/^\s*(\/\/|\*|\/\*).*$/gm, "")

  /**
   * ⚠ CHẶN TRƯỚC KHI GỌI SUPABASE. `updateSession` làm mới phiên — một
   * lượt đi mạng. Trong lúc chạy migration thì đó vừa là tải thừa, vừa là
   * một chỗ nữa có thể timeout rồi đẩy người dùng về `/login` thay vì về
   * trang bảo trì.
   */
  it("kiểm bảo trì trước khi gọi updateSession", () => {
    const a = MW.indexOf("shouldBlockForMaintenance({")
    const b = MW.indexOf("await updateSession(request)")
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
  })

  /**
   * ⚠ REWRITE, KHÔNG REDIRECT. Redirect đổi địa chỉ trên thanh URL; người
   * dùng bookmark nhầm `/maintenance` rồi sau này mở lại vào đúng trang
   * đó dù đã mở cửa từ lâu.
   */
  it("dùng rewrite chứ không redirect", () => {
    expect(MW).toContain('NextResponse.rewrite(new URL("/maintenance", request.url)')
    expect(MW).not.toContain("NextResponse.redirect")
  })

  /**
   * ⚠ TRẢ 503, KHÔNG TRẢ 200. Trả 200 là nói với Google và với mọi công
   * cụ theo dõi rằng đây là nội dung thật của trang đó.
   */
  it("trả mã 503 kèm Retry-After", () => {
    expect(MW).toContain("status: 503")
    expect(MW).toContain('"Retry-After"')
  })

  it("đọc đúng tên cookie mở đường", () => {
    expect(MW).toContain("request.cookies.get(MAINTENANCE_BYPASS_COOKIE)")
    expect(MAINTENANCE_BYPASS_COOKIE).toBe("npp_maintenance_bypass")
  })
})

describe("Trang bảo trì tự đứng được một mình", () => {
  const PAGE = read("src/app/maintenance/page.tsx")

  /**
   * ⚠ KHÔNG GỌI SUPABASE, KHÔNG DÙNG HOOK. Trang này phải hiện được đúng
   * lúc cơ sở dữ liệu đang bị migration chiếm — thêm một truy vấn vào đây
   * là mở đường cho cảnh "trang bảo trì cũng lỗi".
   */
  it("không chạm vào cơ sở dữ liệu hay trạng thái phía trình duyệt", () => {
    for (const bad of ["createClient", "useAuth", "useEffect", "useState", "use client"]) {
      expect(PAGE, `trang bảo trì còn dùng ${bad}`).not.toContain(bad)
    }
  })

  it("tĩnh hoàn toàn", () => {
    expect(PAGE).toContain('export const dynamic = "force-static"')
  })

  /** Nói rõ dữ liệu vẫn còn — đó là câu người dùng cần nghe nhất. */
  it("trấn an về dữ liệu và chỉ đường liên hệ", () => {
    expect(PAGE).toContain("vẫn nguyên vẹn")
    expect(PAGE).toContain("gọi trực tiếp cho nhà phân phối")
  })
})
