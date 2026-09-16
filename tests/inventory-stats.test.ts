import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const PAGE = read("src/app/(dashboard)/inventory/page.tsx")

/**
 * Mã đã bỏ chú thích.
 *
 * Phần giải thích lỗi trong mã có nhắc đúng tên cột hỏng — mà nhắc để
 * người sau khỏi làm lại. Soi cả chú thích thì phép kiểm bắt nhầm lời
 * giải thích và ép phải xoá nó đi, tức là phạt đúng việc nên làm.
 */
const CODE = PAGE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

/** Toàn bộ SQL của dự án — migration + schema gộp. */
const ALL_SQL = readdirSync(resolve(ROOT, "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .map((f) => read(`supabase/migrations/${f}`))
  .join("\n")

describe("Thẻ số liệu kho — cột phải có thật", () => {
  /**
   * ⚠ LỖI GỐC. Truy vấn hỏi cột `batches.avg_price`, một cột không tồn
   * tại trong bất kỳ migration nào. PostgREST trả lỗi, `data` về null, và
   * cả ba thẻ hiện 0 — "Sắp hết hạn 0", "Cần đẩy hàng 0", "Tổng giá trị
   * tồn kho 0đ" — trong khi bảng ngay bên dưới hiện 434 triệu.
   *
   * Zero là con số HỢP LỆ, nên không ai nghi ngờ. Đó là lý do nó sống
   * được lâu.
   */
  it("không hỏi cột avg_price — nó chưa bao giờ tồn tại", () => {
    expect(ALL_SQL).not.toContain("avg_price")
    expect(CODE).not.toContain("avg_price")
  })

  /**
   * ⚠ Chốt chặn chung, không chỉ riêng `avg_price`: mọi cột của `batches`
   * mà trang này hỏi đều phải có trong migration. Gõ sai một tên cột là
   * cả ba thẻ về 0 mà màn hình không báo gì.
   */
  it("mọi cột batches trang này hỏi đều có trong migration", () => {
    const m = /\.from\("batches"\)[\s\S]{0,400}?\.select\(\s*"([^"]+)"/.exec(CODE)
    expect(m, "không tìm thấy truy vấn batches").toBeTruthy()
    const cols = m![1]
      .split(",")
      .map((c) => c.trim().split(":")[0].trim())
      // Bỏ phần join lồng: "product:products(shelf_life_days, brand)".
      .filter((c) => c && !c.includes("(") && !c.includes(")"))
    for (const c of cols) {
      expect(ALL_SQL, `cột batches.${c} không có trong migration nào`).toContain(c)
    }
  })
})

describe("Lỗi không được đi ra như số liệu", () => {
  /**
   * ⚠ ĐÂY MỚI LÀ LỖI THẬT SỰ. Cột sai chỉ là một lần gõ nhầm; cái làm nó
   * sống sót là màn hình biến lỗi thành "0đ". `console.error` không phải
   * là báo cho người dùng — không ai mở Developer Tools để xem kho còn
   * bao nhiêu tiền.
   */
  it("giữ lỗi trong state để màn hình nói ra, không chỉ ghi console", () => {
    expect(PAGE).toContain("setStatsError(")
    expect(PAGE).toContain("const [statsError, setStatsError]")
  })

  it("cả ba thẻ hiện dấu gạch khi hỏng, không hiện 0", () => {
    // Ba thẻ dùng chung một truy vấn, nên hỏng là hỏng cả ba.
    const dashes = PAGE.match(/statsError \? "—"/g) ?? []
    expect(dashes.length).toBe(3)
  })

  /** Dấu gạch nói "không biết"; dải cảnh báo nói vì sao không biết. */
  it("có dải cảnh báo nêu lý do", () => {
    expect(PAGE).toContain("Không đọc được số liệu tồn kho")
    expect(PAGE).toContain("{statsError}")
  })

  /**
   * ⚠ Khi hỏng phải XOÁ số cũ đi. Giữ lại danh sách của lần tải trước là
   * hiện một con số cũ như thể nó vẫn đúng.
   */
  it("hỏng thì bỏ luôn số liệu cũ", () => {
    const branch = PAGE.slice(PAGE.indexOf("if (statsRes.error)"), PAGE.indexOf("} else {"))
    expect(branch).toContain("setStatsBatches([])")
  })
})

describe("Cộng tiền phải cộng đủ", () => {
  /**
   * ⚠ Supabase chặn 1.000 dòng mỗi request và trả 200 KHÔNG kèm lỗi. Quá
   * 1.000 lô là giá trị tồn kho tự nhiên thiếu một khúc mà vẫn trông như
   * số thật — đúng cái bẫy `fetchAllForAggregate` sinh ra để chặn.
   */
  it("dùng fetchAllForAggregate, không gọi select trần", () => {
    expect(PAGE).toContain("fetchAllForAggregate<StatsBatch>")
  })

  /** Chạm trần thì con số THIẾU — phải nói ra ngay trên thẻ. */
  it("chạm trần thì báo là số còn thiếu", () => {
    expect(PAGE).toContain("setStatsTruncated(statsRes.truncated)")
    expect(PAGE).toContain("con số này còn THIẾU")
  })

  /**
   * `unit_cost` LÀ giá vốn bình quân theo đơn vị cơ bản (mig 016). Không
   * có cột nào khác để lùi về — và lùi về một cột không tồn tại thì đúng
   * là chuyện vừa xảy ra.
   */
  it("giá trị tồn tính từ unit_cost", () => {
    expect(PAGE).toContain("(Number(b.qty_on_hand) || 0) * (Number(b.unit_cost) || 0)")
  })
})
