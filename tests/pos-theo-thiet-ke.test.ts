import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * MÀN ĐƠN HÀNG `/pos` BÁM ĐÚNG BẢN THIẾT KẾ CHỦ NHÀ ĐƯA.
 *
 * ⚠ BỘ CHỐT NÀY SINH RA TỪ MỘT LẦN TÔI TỰ QUYẾT. Chủ nhà đưa một bản
 * thiết kế và bảo làm theo; tôi làm phần lớn nhưng tự đổi vài chỗ —
 * giữ thanh tiêu đề ngang thay vì khối tiêu đề trong cột trái, giữ
 * `F3` thay vì `F2`, bỏ huy hiệu trên header, bỏ số đếm trên tab, tách
 * mã hàng và đơn vị thành hai cột riêng, dựng cột phải bằng các thẻ rời
 * trên nền xám thay vì một mặt trắng liền. Chủ nhà phải nhắc:
 *
 *     "Mày chẳng tôn trọng thiết kế của tao gì cả? Đề nghị tôn trọng
 *      tuyệt đối thiết kế tao đưa."
 *
 * ⚠ NÊN MỖI CHỐT Ở ĐÂY GHIM MỘT CON SỐ / MỘT CHỮ CÓ THẬT TRONG BẢN VẼ.
 * Đây là chỗ HIẾM HOI mà ghim chính tả là đúng việc: thứ cần canh
 * chính là "màn hình còn giống bản vẽ không", và bản vẽ là một tài
 * liệu cố định. Đổi bản vẽ thì sửa chốt — nhưng phải là một QUYẾT ĐỊNH,
 * không phải một lần trôi đi lúc nào không hay.
 */

const ROOT = resolve(__dirname, "..")
const doc = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
/** Bỏ chú thích — chốt không được khớp phải chính câu giải thích. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const DON = code(doc("src/components/pos/order-screen.tsx"))
const BAR = code(doc("src/components/pos/pos-top-bar.tsx"))
const TAB = code(doc("src/components/pos/doc-tabs.tsx"))

describe("thanh trên cùng", () => {
  /** ⚠ Bản vẽ: ô vuông xanh bo 9px, chữ "N", rồi tên màn. */
  it("có ô logo xanh và tên màn đúng chữ bản vẽ", () => {
    expect(BAR, "mất ô logo").toMatch(/rounded-\[9px\] bg-\[var\(--pos-primary\)\]/)
    expect(BAR, "tên màn không đúng bản vẽ").toContain("POS bán hàng")
  })

  /**
   * ⚠ HUY HIỆU CẠNH TÊN MÀN. Bản vẽ vẽ một viên thuốc xanh nhạt
   * ("Kho Q.8 · Quầy 01"). Sổ này không có khái niệm "quầy" nên chỗ ấy
   * để tên đơn vị — nhưng VIÊN THUỐC thì phải còn, nếu không thanh trên
   * cùng trống hẳn một mảng so với bản vẽ.
   */
  it("có huy hiệu nền xanh nhạt cạnh tên màn", () => {
    /**
     * ⚠ NEO VÀO CHÍNH NỘI DUNG HUY HIỆU, KHÔNG VÀO BỘ CLASS. Bản đầu của
     * chốt này soi cặp `bg-primary-soft … text-primary-deep` — và AVATAR
     * người dùng ở cuối thanh dùng đúng cặp ấy. Thử phá bằng cách xoá
     * sạch class của huy hiệu: chốt VẪN XANH, vì nó đang đọc avatar.
     */
    const i = BAR.indexOf("{org.name}")
    expect(i, "huy hiệu không còn hiện tên đơn vị").toBeGreaterThan(-1)
    const khoi = BAR.slice(Math.max(0, i - 400), i)
    expect(khoi, "huy hiệu không còn là viên thuốc nền xanh nhạt").toMatch(
      /rounded-full bg-\[var\(--pos-primary-soft\)\]/
    )
    expect(khoi, "chữ trong huy hiệu không phải xanh đậm").toContain("text-[var(--pos-primary-deep)]")
  })

  /** ⚠ Bản vẽ: tab là viên thuốc bo tròn, có viền, KÈM SỐ ĐẾM. */
  it("tab là viên thuốc có viền và có số đếm dòng", () => {
    expect(TAB, "tab không còn là viên thuốc có viền").toMatch(/rounded-full border-\[1\.5px\]/)
    expect(TAB, "tab mất số đếm dòng").toMatch(/\{t\.count\}/)
  })

  /** ⚠ Bản vẽ: nút "+" tròn, viền NÉT ĐỨT. */
  it("nút mở chứng từ mới là vòng tròn nét đứt", () => {
    expect(TAB, "nút + không còn nét đứt").toMatch(/rounded-full border-\[1\.5px\] border-dashed/)
  })
})

describe("cột trái — khối tiêu đề", () => {
  /**
   * ⚠ TIÊU ĐỀ NẰM TRONG CỘT TRÁI, KHÔNG PHẢI MỘT THANH NGANG CẢ MÀN.
   * Bản vẽ đặt `<h1>` 22px bên trong `<section>` cột trái. Bản trước
   * của tôi dùng `DocSubHeader` — một thanh chạy hết bề ngang phía trên
   * hai cột — và đó là một trong những chỗ chủ nhà đếm được.
   */
  it("màn đơn không còn dùng thanh tiêu đề ngang", () => {
    expect(/<DocSubHeader/.test(DON), "thanh tiêu đề ngang quay lại màn đơn").toBe(false)
  })

  /** ⚠ Bản vẽ: `font-size:22px; font-weight:800; letter-spacing:-.3px`. */
  it("tiêu đề đúng cỡ 22px, đậm 800, giãn chữ -0.3px", () => {
    expect(DON, "cỡ tiêu đề lệch bản vẽ").toMatch(
      /text-\[22px\] font-extrabold tracking-\[-0\.3px\]/
    )
  })

  /** ⚠ Bản vẽ: `Đơn hàng · {{ lineCount }} dòng`, phần đếm 15px đậm 700. */
  it("tiêu đề kèm số dòng, cỡ 15px", () => {
    const i = DON.indexOf("text-[22px] font-extrabold")
    const khoi = DON.slice(i, i + 700)
    expect(khoi, "tiêu đề mất phần đếm số dòng").toMatch(/text-\[15px\] font-bold/)
    expect(khoi, "không đếm số dòng thật").toMatch(/\{lines\.length\}/)
    expect(khoi, "mất chữ 'dòng'").toContain("dòng")
  })

  /** ⚠ Bản vẽ: hai nút cạnh tiêu đề, đúng hai chữ này. */
  it("có đủ hai nút 'Thêm sản phẩm (F2)' và 'Xoá tất cả'", () => {
    expect(DON, "mất nút thêm sản phẩm của bản vẽ").toContain("Thêm sản phẩm (F2)")
    expect(DON, "mất nút xoá tất cả của bản vẽ").toContain("Xoá tất cả")
  })
})

describe("cột trái — bảng dòng hàng", () => {
  /**
   * ⚠ ĐÚNG TÁM CỘT VỚI ĐÚNG BỀ RỘNG CỦA BẢN VẼ:
   *     34px · minmax(170px,1fr) · 100px · 108px · 128px · 74px · 120px · 34px
   * Bản trước của tôi là CHÍN cột (tách "Mã hàng" và "ĐVT" ra riêng) và
   * bề rộng khác hẳn.
   */
  it("bề rộng cột đúng bản vẽ", () => {
    for (const w of ['"34px"', '"minmax(170px,1fr)"', '"100px"', '"108px"', '"128px"', '"74px"', '"120px"']) {
      expect(DON, `thiếu cột bề rộng ${w}`).toContain(`w: ${w}`)
    }
  })

  /** ⚠ Và cột tên mang đúng nhãn ghép của bản vẽ. */
  it("cột tên mang nhãn 'Sản phẩm / đơn vị'", () => {
    expect(DON, "nhãn cột tên lệch bản vẽ").toContain('label: "Sản phẩm / đơn vị"')
    expect(/label: "Mã hàng"/.test(DON), "cột mã hàng riêng quay lại").toBe(false)
    expect(/label: "ĐVT"/.test(DON), "cột đơn vị riêng quay lại").toBe(false)
  })

  /**
   * ⚠ ĐƠN VỊ LÀ DẢI CHIP, KHÔNG PHẢI `<select>`. Bản vẽ vẽ các nút nhỏ
   * nằm trong một nền lõm, nút đang chọn có nền trắng + bóng.
   */
  it("đơn vị là dải chip bấm được, không phải select", () => {
    expect(DON, "mất dải chip đơn vị").toMatch(/aria-pressed=\{dang\}/)
    expect(DON, "chip đang chọn không có nền trắng + bóng").toMatch(
      /bg-white text-\[var\(--pos-ink\)\] shadow-/
    )
  })

  /** ⚠ Dòng cao tối thiểu 70px — bản vẽ ghi `min-height:70px`. */
  it("dòng hàng cao tối thiểu 70px", () => {
    expect(DON, "chiều cao dòng lệch bản vẽ").toMatch(/min-h-\[70px\]/)
  })

  /**
   * ⚠ CHÂN BẢNG CÓ ĐỦ HAI VẾ. Bản vẽ ghi nguyên văn dòng gợi ý phím, và
   * một con số "Tiền hàng" 18px đậm 800 ở mép phải.
   */
  it("chân bảng có gợi ý phím và tiền hàng", () => {
    expect(DON, "mất dòng gợi ý phím của bản vẽ").toContain(
      "Enter thêm dòng · F6 lưu nháp · F9 gửi đơn"
    )
    expect(DON, "mất con số tiền hàng ở chân bảng").toMatch(
      /Tiền hàng[\s\S]{0,400}text-\[18px\] font-extrabold/
    )
  })
})

describe("những khối chủ nhà bảo bỏ", () => {
  /**
   * ⚠ ĐÚNG MỘT NÚT "THÊM SẢN PHẨM", KHÔNG HAI. Bản trước của tôi để lại
   * một HÀNG CÔNG CỤ ("Dòng hàng · N" + nút thêm) ngay trên bảng, bên
   * dưới khối tiêu đề vốn ĐÃ có "· N dòng" và đúng cái nút ấy. Chủ nhà
   * khoanh đỏ cả hai nửa của hàng đó (22/09/2026).
   *
   * Đây là lần thứ HAI cùng một lỗi: đợt 9 chủ nhà đã đếm được hai ô
   * thêm hàng và bắt bỏ một. Chốt này để không có lần thứ ba.
   */
  it("cột trái chỉ có một nút thêm sản phẩm", () => {
    expect(
      DON.split("Thêm sản phẩm").length - 1,
      "cột trái lại có hai chỗ thêm sản phẩm"
    ).toBe(1)
    expect(
      /Dòng hàng <span className="n">/.test(DON),
      "hàng công cụ trùng đã quay lại — khối tiêu đề vốn đã đếm số dòng"
    ).toBe(false)
  })

  /**
   * ⚠ MÀN ĐẶT HÀNG KHÔNG THU TIỀN. Chủ nhà khoanh đỏ cả khối thanh toán
   * (22/09/2026), và bản thiết kế cũng không vẽ nó: tổng tiền kết thúc
   * ở "Khách cần trả" rồi tới hai nút.
   *
   * ⚠ VÀ KHỐI ẤY CHƯA TỪNG ĐI XUỐNG SỔ. `traTien` / `pay` không có mặt
   * trong tải trọng `savePosOrder` — chúng chỉ đổi con số trên màn. Tức
   * người bán gõ "khách đưa 500.000" rồi lưu, và sổ không ghi đồng nào.
   * Gỡ đi là bỏ một lời hứa suông, không phải bỏ một chức năng.
   */
  it("màn đơn không còn khối thanh toán", () => {
    for (const chu of ["Khách thanh toán", "Tính vào công nợ", "Nợ sau đơn này"]) {
      expect(DON.includes(chu), `khối thanh toán quay lại: "${chu}"`).toBe(false)
    }
    expect(/PaymentButtons|CashChips/.test(DON), "nút chọn hình thức trả quay lại").toBe(false)
    expect(/traTien/.test(DON), "ô tiền khách đưa quay lại").toBe(false)
  })

  /**
   * ⚠ VÀ TỔNG TIỀN KẾT THÚC ĐÚNG CHỖ BẢN VẼ ĐỂ: "Khách cần trả" rồi tới
   * hàng nút. Không có con số nào chen giữa.
   */
  it("sau tổng tiền là tới hàng nút, không chen gì", () => {
    const i = DON.indexOf("<TotalsHero")
    expect(i, "mất khối tổng tiền").toBeGreaterThan(-1)
    const j = DON.indexOf("<PanelActions", i)
    expect(j, "mất hàng nút").toBeGreaterThan(i)
    const giua = DON.slice(i, j)
    expect(/<MoneyRow|PaymentButtons|CashChips/.test(giua), "có khối chen giữa tổng tiền và hàng nút")
      .toBe(false)
  })
})

describe("khối Hàng đổi trả kèm đơn", () => {
  /** ⚠ Bản vẽ: một thẻ RIÊNG dưới bảng bán, thu gọn được. */
  it("là thẻ riêng, thu gọn được, đúng tiêu đề bản vẽ", () => {
    expect(DON, "mất tiêu đề khối của bản vẽ").toContain("Hàng đổi trả kèm đơn")
    expect(DON, "khối không thu gọn được").toMatch(/moKhoiTra/)
  })

  /** ⚠ Bản vẽ: bảy cột với đúng bề rộng này. */
  it("bảng hàng trả đúng bảy cột của bản vẽ", () => {
    expect(DON, "bề rộng cột bảng hàng trả lệch bản vẽ").toContain(
      '"minmax(170px,1fr) 140px 100px 108px 112px 120px 34px"'
    )
    for (const nhan of ["Lý do", "Xử lý", "Trừ đơn"]) {
      expect(DON, `mất cột "${nhan}" của bản vẽ`).toContain(nhan)
    }
  })

  /**
   * ⚠ CHẾ ĐỘ THÊM HÀNG TRẢ — bản vẽ dựng đúng cơ chế hai giỏ một ô tìm:
   * bấm "+ Thêm hàng trả" thì mã chọn từ khung bên phải rơi vào danh
   * sách TRẢ, và có dải xanh nói ra điều đó.
   *
   * ⚠ GÕ NHẦM GIỎ LÀ LỆCH CHIỀU TIỀN — một món khách MUA bị ghi thành
   * một món khách TRẢ. Nên chốt canh cả ba vế: có chế độ, chế độ ĐỔI
   * đích của việc chọn, và chế độ HIỆN RA.
   */
  it("có chế độ thêm hàng trả, và nó đổi đích của ô tìm", () => {
    expect(DON, "không có chế độ thêm hàng trả").toMatch(/moThemTra/)
    const i = DON.indexOf("const chonHang")
    expect(i, "không thấy việc chọn mã").toBeGreaterThan(-1)
    const khoi = DON.slice(i, i + 700)
    expect(khoi, "việc chọn không đọc chế độ — mọi mã rơi vào giỏ bán")
      .toMatch(/if \(!moThemTra\)/)
    expect(khoi, "chế độ bật mà không thêm vào giỏ trả").toMatch(/setRetLines/)
    expect(DON, "chế độ đang bật không hiện ra").toContain("chế độ thêm hàng trả")
  })

  /** ⚠ Bản vẽ: mỗi dòng có nút Trả / Đổi, và chân khối ghi "Trừ vào đơn". */
  it("mỗi dòng chọn Trả hoặc Đổi, chân khối ghi Trừ vào đơn", () => {
    expect(DON, "mất nút Trả/Đổi theo dòng").toMatch(/isExchange: o\.doi/)
    expect(DON, "mất chân khối của bản vẽ").toContain("Trừ vào đơn")
    expect(DON, "mất câu nhắc dòng Đổi không trừ tiền").toContain("không trừ tiền")
  })

  /**
   * ⚠ LÝ DO THEO TỪNG DÒNG, VÀ NÓ PHẢI ĐI XUỐNG SỔ. Bản vẽ vẽ ô chọn
   * riêng trên mỗi dòng; sổ trước đây chỉ có lý do cho cả phiếu nên
   * mig 159 thêm `return_lines.reason`. Vẽ ô mà không lưu là màn hình
   * nói dối: đặt hai lý do khác nhau, lưu xong mở lại thấy một.
   */
  it("lý do theo dòng được ghi xuống sổ", () => {
    expect(DON, "ô lý do không ghi vào dòng").toMatch(/sua\(\{ reason: e\.target\.value \}\)/)
    const save = code(doc("src/lib/pos/save.ts"))
    expect(save, "lý do dòng không đi vào giỏ trả").toMatch(/reason: l\.reason/)
    const create = code(doc("src/lib/orders/create.ts"))
    expect(create, "lý do dòng không đi xuống bảng return_lines").toMatch(/reason: l\.reason/)
    const mig = doc("supabase/migrations/159_return_line_reason.sql")
    expect(mig, "cột lý do theo dòng chưa có trong sổ").toMatch(
      /ADD COLUMN IF NOT EXISTS reason text/
    )
  })

  /**
   * ⚠ LÝ DO CỦA CẢ PHIẾU KHÔNG ĐƯỢC GHIM CỨNG. `returns.reason` là con
   * số các báo cáo đọc; để nguyên "damaged" là mọi phiếu trong sổ mang
   * một lý do chưa ai chọn.
   */
  it("lý do của cả phiếu lấy từ dòng, không ghim cứng", () => {
    const i = DON.indexOf("returnReason:")
    expect(i, "không thấy chỗ gửi lý do phiếu").toBeGreaterThan(-1)
    expect(DON.slice(i, i + 200), "lý do phiếu vẫn ghim cứng").toMatch(
      /retLines\.find\(/
    )
  })
})

describe("ba chỗ chủ nhà chỉ ra 22/09/2026", () => {
  /**
   * ⚠ GHI CHÚ TỪNG DÒNG HÀNG BÁN. Bản vẽ có ô này trên MỌI dòng, không
   * chỉ dòng trả; tôi chỉ làm cho dòng trả. Nó là chỗ duy nhất ghi được
   * câu đi theo ĐÚNG một mặt hàng ("giao chiều", "lấy lô mới").
   *
   * ⚠ VÀ NÓ PHẢI ĐI XUỐNG SỔ. Một ô ghi chú không lưu là đúng kiểu hỏng
   * của khối thanh toán vừa bị gỡ: người dùng gõ vào, lưu, rồi mất.
   */
  it("dòng hàng bán có ô ghi chú, và ghi chú đi xuống sổ", () => {
    const i = DON.indexOf('placeholder="Ghi chú dòng…"')
    expect(i, "dòng hàng bán không có ô ghi chú").toBeGreaterThan(-1)
    expect(DON.slice(Math.max(0, i - 400), i), "ô ghi chú không ghi vào dòng")
      .toMatch(/patchLine\(l\.key, \{ note: e\.target\.value \}\)/)
    const save = code(doc("src/lib/pos/save.ts"))
    expect(save, "ghi chú dòng không vào giỏ").toMatch(/note: l\.note/)
    /**
     * ⚠ CẮT ĐÚNG KHỐI CHÈN DÒNG BÁN. `create.ts` có HAI chỗ viết y hệt
     * `...(l.note ? { note: l.note } : {})` — một cho `sales_order_lines`,
     * một cho `return_lines`. Bản đầu của chốt này soi cả tệp, và một
     * đột biến gỡ hẳn chỗ dòng BÁN vẫn LỌT vì chỗ dòng TRẢ còn nguyên.
     */
    const create = code(doc("src/lib/orders/create.ts"))
    const j = create.indexOf('from("sales_order_lines").insert')
    expect(j, "không thấy chỗ chèn dòng đơn").toBeGreaterThan(-1)
    const khoiDong = create.slice(Math.max(0, j - 900), j)
    expect(khoiDong, "ghi chú dòng không xuống sales_order_lines")
      .toMatch(/\.\.\.\(l\.note \? \{ note: l\.note \} : \{\}\)/)
  })

  /**
   * ⚠ Ô TÌM Ở LẠI, VÀ CÓ ĐƯỜNG ĐÓNG. Chủ nhà: *"khi bấm thêm sản phẩm
   * vào dòng nó không tự mất đi mà luôn ở đó. khi xong có nút đóng/xong"*.
   * Người bán quét một loạt mã liên tiếp; dải đóng sau mỗi lần quét là
   * mỗi mã phải mở lại ô một lần.
   */
  it("ô tìm ở lại sau khi thêm, có nút Đóng và nút Xong", () => {
    const box = code(doc("src/components/pos/product-search-box.tsx"))
    expect(box, "ô tìm của /pos không bật chế độ ở lại").toMatch(/persistent/)
    expect(/closeOnPick/.test(box), "ô tìm lại tự đóng sau khi thêm").toBe(false)
    const picker = code(doc("src/components/ui/product-picker.tsx"))
    expect(picker, "chế độ ở lại bị bật mặc định cho mọi màn").toMatch(/persistent = false/)
    expect(picker, "mất nút đóng trong ô tìm").toContain("▲ Đóng")
    expect(picker, "mất nút Xong ở chân dải gợi ý").toContain("Xong")
  })

  /**
   * ⚠ HAI NÚT CUỐI TRANG THEO `/sell`: Lưu nháp và Gửi đơn. Chi tiết
   * và lý do ở `tests/pos-cau-truc.test.ts` — ở đây chỉ canh hai cái
   * nhãn, vì chúng là thứ chủ nhà khoanh trên ảnh.
   */
  it("hai nút cuối trang là Lưu nháp và Gửi đơn", () => {
    const hang = DON.slice(DON.indexOf("<PanelActions>"), DON.indexOf("</PanelActions>"))
    expect(hang, "mất nút Lưu nháp").toContain("Lưu nháp (F6)")
    expect(hang, "mất nút Gửi đơn").toContain("Gửi đơn (F9)")
    expect(
      hang.split("<PanelButton").length - 1,
      "hàng nút cuối trang không còn đúng hai nút"
    ).toBe(2)
  })
})

describe("cột phải", () => {
  /**
   * ⚠ MỘT MẶT TRẮNG LIỀN CÓ VIỀN TRÁI, không phải các thẻ rời trôi trên
   * nền xám. Bản vẽ: `<aside>` `border-left:1px solid #e5e8ee;
   * background:#fff`, chia hàng bằng `grid-template-rows`.
   */
  it("là một aside trắng có viền trái, chia bằng lưới hàng", () => {
    expect(DON, "cột phải không còn là một mặt trắng liền").toMatch(
      /<aside className="grid[^"]*border-l border-\[var\(--pos-line\)\] bg-white"/
    )
    expect(DON, "cột phải không chia hàng bằng lưới").toMatch(/grid-rows-\[/)
  })

  /** ⚠ Bề rộng 420px — bản vẽ ghi `grid-template-columns:minmax(0,1fr) 420px`. */
  it("rộng đúng 420px", () => {
    expect(DON, "bề rộng cột phải lệch bản vẽ").toMatch(/w-\[420px\]/)
  })

  /**
   * ⚠ BA KHỐI BẢN VẼ VẼ MÀ BẢN TRƯỚC CỦA TÔI KHÔNG CÓ: cảnh báo vượt
   * hạn mức, ô gán NVBH, và nhãn in hoa của nó.
   */
  it("có cảnh báo vượt hạn mức và ô gán NVBH", () => {
    expect(DON, "mất cảnh báo vượt hạn mức").toContain("vượt hạn mức")
    expect(DON, "mất ô gán đơn cho NVBH").toContain("Gán đơn cho NVBH")
    expect(DON, "nhãn NVBH không phải chữ in hoa nhỏ như bản vẽ").toMatch(
      /text-\[11px\] font-extrabold uppercase tracking-\[0\.06em\]/
    )
  })
})

describe("phím tắt đúng bản vẽ", () => {
  /**
   * ⚠ BẢN VẼ GHI BỘ PHÍM Ở BA CHỖ: nút "Thêm sản phẩm (F2)", nút "Lưu
   * nháp (F6)", và dòng chân bảng "F6 lưu nháp · F9 gửi đơn". Bản trước
   * của tôi giữ `F3` và để `F9` mang nghĩa cũ ("thêm dòng hàng đổi") —
   * tức màn hình nói một đằng, phím làm một nẻo.
   */
  it("F2 thêm sản phẩm, F6 lưu nháp, F9 gửi đơn", () => {
    const i = DON.indexOf("usePosKeys({")
    expect(i, "màn đơn không đăng ký phím tắt").toBeGreaterThan(-1)
    const khoi = DON.slice(i, DON.indexOf("})", i))
    expect(khoi, "F2 không đưa tiêu điểm về ô tìm").toMatch(/F2: focusPosPicker/)
    expect(khoi, "F6 không lưu nháp").toMatch(/F6: \(\) => \{[^}]*luuDon\(true\)/)
    expect(khoi, "F9 không gửi đơn").toMatch(/F9: \(\) => \{[\s\S]*?luuDon\(false\)/)
  })

  /**
   * ⚠ PHÍM KHÔNG ĐƯỢC LÀ ĐƯỜNG TẮT BỎ QUA PHÉP CHẶN. `F9` gửi cả tờ
   * đơn; ai quen tay bấm nó để "thêm dòng hàng đổi" như trước sẽ gửi
   * nhầm. Nên nó phải kiểm đủ điều kiện y như cái nút.
   */
  it("F9 kiểm đủ điều kiện trước khi gửi", () => {
    const i = DON.indexOf("F9: () =>")
    const khoi = DON.slice(i, i + 260)
    for (const dk of ["dangLuu", "lines.length === 0", "!khach", "coGiaXau"]) {
      expect(khoi, `F9 bỏ qua phép chặn \`${dk}\``).toContain(dk)
    }
  })

  /** ⚠ Và bộ phím phải khai đủ ở `lib/pos/keys` — thiếu là `PosShell` nuốt. */
  it("F2 và F6 được khai trong bộ phím của khung", () => {
    const keys = code(doc("src/lib/pos/keys.ts"))
    expect(keys, "khung không nhận F2").toMatch(/"F2"/)
    expect(keys, "khung không nhận F6").toMatch(/"F6"/)
  })
})
