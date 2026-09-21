import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const strip = (s: string) => s.replace(/^\s*--.*$/gm, "")

const M128 = read("supabase/migrations/128_invoice_code_no_date.sql")
const CODE = strip(M128)

/**
 * SỐ HÓA ĐƠN BỎ NGÀY THÁNG: HD-0001, bản lập lại thêm -1, -2, …
 *
 * Chạy thật trên Postgres 16 cho ra đúng chuỗi mong đợi:
 *   HD-0001 · HD-0002 · HD-0003 (đánh lại)
 *   HD-0004 → HD-0004-1 → HD-0004-2 (sửa hai lần)
 *   HD-0005 (tờ kế tiếp — số mới, không nối đuôi)
 */
describe("mã hóa đơn: hai cột đếm, chuỗi mã chỉ là thứ sinh ra", () => {
  /**
   * ⚠ KHÔNG SUY SỐ CHẠY TỪ CHÍNH CHUỖI MÃ. "Lấy max phần số trong
   * invoice_code rồi +1" nghe gọn nhưng mã cũ `HD-260918-0001` đọc ra
   * 260918, và bộ đếm nhảy lên 260919 — mọi hóa đơn sau đó mang số vô
   * nghĩa, không cách nào lùi lại.
   */
  it("đếm bằng cột thật, không bằng cách bóc chuỗi", () => {
    expect(CODE).toContain("ADD COLUMN IF NOT EXISTS invoice_seq int")
    expect(CODE).toContain("ADD COLUMN IF NOT EXISTS reissue_no  int NOT NULL DEFAULT 0")
    // Không có chỗ nào bóc số ra khỏi invoice_code để đếm tiếp.
    expect(CODE).not.toMatch(/substring\(\s*invoice_code/)
    expect(CODE).not.toMatch(/max\(\s*[^)]*invoice_code/)
  })

  /** ⚠ MỘT CHỖ DỰNG MÃ — ghép chuỗi ở nhiều nơi là hai tờ in ra hai số. */
  it("chỉ một hàm dựng mã, và nó sinh đúng mẫu", () => {
    expect(CODE).toContain("CREATE OR REPLACE FUNCTION public._inv_code(p_seq int, p_reissue int)")
    expect(CODE).toContain("'HD-' || lpad(COALESCE(p_seq, 0)::text, 4, '0')")
    expect(CODE).toContain("THEN '-' || p_reissue::text ELSE '' END")
  })

  /**
   * ⚠ `max + 1`, KHÔNG PHẢI `count + 1`. Đếm thì một tờ bị xoá tay là số
   * tiếp theo trùng với một tờ đang sống.
   */
  it("cấp số bằng max+1, và khoá trước khi đếm", () => {
    expect(CODE).toContain("PERFORM pg_advisory_xact_lock(hashtext(p_org::text))")
    expect(CODE).toContain("SELECT COALESCE(max(invoice_seq), 0) + 1 INTO v_n")
    expect(CODE).not.toContain("SELECT count(*) + 1 INTO v_n")
  })

  /** ⚠ Chốt chặn cuối cùng nằm ở cơ sở dữ liệu, không chỉ ở hàm cấp số. */
  it("chỉ mục duy nhất chặn hai tờ cùng số", () => {
    expect(CODE).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_invoices_seq")
    expect(CODE).toContain("ON sales_invoices(org_id, invoice_seq, reissue_no)")
  })

  /**
   * ⚠ SỐ ĐÃ GỬI CƠ QUAN THUẾ KHÔNG ĐƯỢC ĐỔI. Đổi là sổ của mình và sổ
   * của thuế nói hai số khác nhau cho cùng một giao dịch.
   */
  it("dừng việc đánh số lại nếu đã phát hành hoá đơn điện tử", () => {
    expect(CODE).toContain("i.misa_inv_no IS NOT NULL")
    /**
     * ⚠ KIỂM CHÍNH ĐIỀU KIỆN, không chỉ kiểm mã lỗi có mặt. Bản đầu của
     * chốt này NÓI DỐI: đổi `IF v_eiv > 0` thành `IF false` thì khối
     * RAISE vẫn còn nguyên trong file, chuỗi "INV_CODE_ISSUED" vẫn tìm
     * thấy, chốt vẫn xanh — và migration đánh số lại cả những tờ đã gửi
     * cơ quan thuế.
     */
    expect(CODE).toContain("IF v_eiv > 0 THEN")
    expect(CODE).toMatch(/IF v_eiv > 0 THEN\s*\n\s*RAISE EXCEPTION\s*\n\s*'INV_CODE_ISSUED/)
  })

  /**
   * ⚠ "TỜ GỐC" = `replaced_from IS NULL`, không phải `status='posted'`.
   * Một tờ gốc bị huỷ thẳng vẫn phải giữ số của nó, nếu không thì mọi tờ
   * sau nó tụt một số và sổ thủng một lỗ.
   */
  it("đánh số lại theo tờ gốc, kể cả tờ đã huỷ", () => {
    const i = CODE.indexOf("row_number() OVER (")
    expect(i).toBeGreaterThan(0)
    const block = CODE.slice(i, i + 400)
    expect(block).toContain("PARTITION BY org_id")
    expect(block).toContain("ORDER BY invoice_date, created_at, id")
    expect(block).toContain("WHERE replaced_from IS NULL")
    expect(block).not.toContain("status = 'posted'")
  })

  /**
   * ⚠ ĐỆ QUY, KHÔNG PHẢI MỘT PHÉP NỐI. Sửa lần 2 trỏ về bản sửa lần 1,
   * chứ không trỏ thẳng về tờ gốc — nối một tầng là bản thứ hai không tra
   * ra số gốc và nằm lại với `invoice_seq` rỗng.
   */
  it("chuỗi lập lại đi ngược bằng đệ quy", () => {
    expect(CODE).toContain("WITH RECURSIVE chain AS (")
    expect(CODE).toContain("JOIN chain ON c2.replaced_from = chain.id")
    expect(CODE).toContain("SET invoice_seq = chain.root_seq, reissue_no = chain.depth")
  })

  /** ⚠ Sót một dòng `invoice_seq` rỗng là sinh hàng loạt mã `HD-0000`. */
  it("dừng nếu còn hóa đơn không tra được số gốc", () => {
    expect(CODE).toContain("SELECT count(*) INTO v_n FROM sales_invoices WHERE invoice_seq IS NULL")
    // ⚠ Cùng lý do như chốt trên: kiểm ĐIỀU KIỆN, không kiểm mã lỗi.
    expect(CODE).toMatch(/IF v_n > 0 THEN\s*\n\s*RAISE EXCEPTION\s*\n\s*'INV_CODE_ORPHAN/)
  })

  /**
   * ⚠ BẢN LẬP LẠI DÙNG LẠI SỐ CỦA TỜ CŨ. Cấp số mới cho một bản sửa là
   * mất hẳn mối liên hệ giữa hai tờ — người tra sổ nhìn HD-0042 và
   * HD-0087 không thể biết tờ sau thay tờ trước.
   */
  it("post_invoice giữ số gốc khi có reissue_of", () => {
    expect(CODE).toContain("IF (p->>''reissue_of'') IS NOT NULL THEN")
    expect(CODE).toContain("SELECT si0.invoice_seq, si0.reissue_no + 1 INTO v_seq, v_reissue")
    expect(CODE).toContain("v_seq := public._wf2b_next_invoice_seq(o.org_id)")
  })

  it("reissue_invoice truyền reissue_of xuống", () => {
    expect(CODE).toContain("jsonb_set(v_payload, ''{reissue_of}''")
  })

  /**
   * ⚠ VÁ THÂN HÀM, KHÔNG CHÉP LẠI CẢ HÀM — và mỗi chỗ vá phải DỪNG khi
   * không tìm thấy, chứ không âm thầm để nguyên.
   */
  it("mỗi chỗ vá đều dừng khi không khớp hình dạng", () => {
    expect((CODE.match(/INV_CODE_SHAPE/g) ?? []).length).toBeGreaterThanOrEqual(6)
    expect(CODE).toContain("pg_get_functiondef(v_oid)")
    // Lấy oid trước, gọi sau — cùng lý do như mig 126.
    expect((CODE.match(/SELECT pr\.oid INTO v_oid/g) ?? []).length).toBe(2)
  })
})

/**
 * LỖI CÓ SẴN TỪ MIG 125 — `reissue_invoice` chưa từng chạy được.
 *
 * `RETURNS TABLE (invoice_id uuid, …)` biến `invoice_id` thành một BIẾN
 * của hàm; câu hỏi bảng `returns` bằng đúng tên ấy mà không gắn bí danh
 * nên Postgres không biết nên hiểu là biến hay cột:
 *
 *     ERROR: column reference "invoice_id" is ambiguous
 *
 * ⚠ HÀM TẠO RA VẪN SẠCH — lỗi chỉ nổ lúc CHẠY tới câu đó. Nên mig 125 và
 * mọi chốt cấu trúc đều xanh, còn nút "Sửa hóa đơn" hỏng ngay lần bấm
 * đầu tiên. Tìm ra bằng cách chạy thật, không phải bằng đọc mã.
 */
describe("reissue_invoice: hết nhập nhằng invoice_id", () => {
  it("câu gom phiếu trả được gắn bí danh", () => {
    expect(CODE).toContain("FROM returns rr")
    expect(CODE).toContain("WHERE rr.invoice_id = p_invoice_id AND rr.status IN (''draft'', ''submitted'')")
  })

  /**
   * ⚠ GẮN BÍ DANH, KHÔNG ĐỔI TÊN CỘT TRẢ VỀ. Đổi tên cột trả về là đổi
   * hợp đồng của RPC, và mã ứng dụng đang đọc `invoice_id`.
   */
  it("không đổi tên cột trả về của RPC", () => {
    const LIB = read("src/lib/orders/post-invoice.ts")
    expect(LIB).toContain("invoice_id")
    expect(CODE).not.toMatch(/RETURNS TABLE\s*\(\s*out_invoice_id/)
  })
})

// =====================================================================

/**
 * PHẦN ĐẦU CHỨNG TỪ — tên · địa chỉ · điện thoại NPP.
 *
 * ⚠ CHUYỆN ĐÃ XẢY RA: cả hai màn in hỏi
 * `organizations.select("name, address, phone")` — BA CỘT CUỐI KHÔNG
 * TỒN TẠI. Bảng chỉ có `id, name, slug, settings, created_at`; địa chỉ
 * và điện thoại nằm trong `settings` jsonb, đúng như màn `/setup` ghi
 * chúng vào. Câu truy vấn lỗi, lỗi bị nuốt vào `console.error`, và tờ
 * hóa đơn in ra THIẾU HẲN phần đầu — không toast, không màn đỏ, chỉ một
 * tờ giấy thiếu tên công ty đi tới tay khách.
 *
 * ⚠ CÙNG LOẠI VỚI `customers.price_group_id`. Cách chặn duy nhất là đọc
 * ở ĐÚNG MỘT CHỖ và neo chỗ đó vào `schema_full.sql`.
 */
describe("phần đầu chứng từ đọc đúng chỗ", () => {
  const SCHEMA = read("supabase/schema_full.sql")
  const HEADER = read("src/lib/org/header.ts")
  const P_SALES = read("src/app/(dashboard)/sales-invoices/[id]/print/page.tsx")
  const P_EINV = read("src/app/(dashboard)/invoices/[id]/print/page.tsx")

  const orgCols = (() => {
    const i = SCHEMA.indexOf("CREATE TABLE organizations (")
    if (i < 0) throw new Error("không tìm thấy DDL bảng organizations")
    const body = SCHEMA.slice(i, SCHEMA.indexOf("\n);", i))
    return new Set(
      body.split("\n").slice(1)
        .map((l) => l.trim().split(/[\s(]/)[0])
        .filter((w) => /^[a-z_][a-z0-9_]*$/.test(w))
    )
  })()

  it("bảng organizations có settings, KHÔNG có address/phone", () => {
    // Kiểm chính phép cắt DDL trước — cắt hỏng thì mọi chốt dưới vô nghĩa.
    expect(orgCols.size).toBeGreaterThan(3)
    expect(orgCols.has("settings")).toBe(true)
    expect(orgCols.has("address")).toBe(false)
    expect(orgCols.has("phone")).toBe(false)
  })

  it("chỉ một chỗ đọc phần đầu, và nó hỏi settings", () => {
    expect(HEADER).toContain('.select("name, settings")')
  })

  for (const [ten, src] of [
    ["màn in hóa đơn bán", P_SALES],
    ["màn in hoá đơn điện tử", P_EINV],
  ] as const) {
    it(`${ten} dùng loadOrgHeader, không hỏi thẳng cột không có`, () => {
      expect(src).toContain("loadOrgHeader(supabase,")
      expect(src, `${ten} còn hỏi cột không tồn tại`).not.toMatch(
        /from\("organizations"\)[\s\S]{0,200}?select\([^)]*address/
      )
    })
  }

  /**
   * ⚠ CHUỖI RỖNG COI NHƯ CHƯA CÓ. `settings.address = ""` mà trả chuỗi
   * rỗng thì mẫu in ra dòng "Địa chỉ:" cụt lủn — tệ hơn là không in.
   */
  it("giá trị rỗng trả về null, không trả chuỗi rỗng", () => {
    expect(HEADER).toContain('return t === "" ? null : t')
  })
})

/**
 * IN: A5 MẶC ĐỊNH, VÀ TỰ BẬT SAU KHI XUẤT HÀNG.
 */
describe("in hóa đơn", () => {
  const P_SALES = read("src/app/(dashboard)/sales-invoices/[id]/print/page.tsx")
  const BTN = read("src/components/ui/print-button.tsx")
  const EDITOR = read("src/components/orders/invoice-editor.tsx")

  it("hóa đơn bán mặc định khổ A5", () => {
    expect(P_SALES).toContain('<PrintButton label="In hóa đơn" defaultPaper="A5" />')
  })

  /**
   * ⚠ MỘT PHÉP IN, DÙNG CHUNG. Nút In và in tự động mà mỗi bên tự viết
   * thì một ngày nào đó chỉ một trong hai đặt đúng khổ giấy.
   */
  it("nút In và in tự động đi qua cùng một hàm", () => {
    expect(BTN).toContain("export function printWithPaper(size: PaperSize): void")
    expect(BTN).toContain("const print = printWithPaper")
    expect(P_SALES).toContain('printWithPaper("A5")')
  })

  /** ⚠ Đặt data-paper-size rồi để nguyên là mọi lần in sau đều ra A4. */
  it("trả thuộc tính khổ giấy về như cũ sau khi in", () => {
    expect(BTN).toContain("if (previous == null) html.removeAttribute(\"data-paper-size\")")
    expect(BTN).toContain("else html.setAttribute(\"data-paper-size\", previous)")
  })

  it("xuất hàng xong thì sang màn in kèm cờ tự in", () => {
    expect(EDITOR).toContain("/sales-invoices/${r.invoiceId}/print?auto=1")
  })

  /**
   * ⚠ CHỜ DỮ LIỆU XONG MỚI IN, và CHỈ MỘT LẦN. In lúc còn `loading` là
   * in ra một trang toàn khung xương; không gác một lần thì cửa sổ in
   * bật lại sau mỗi lần render và người dùng không thoát ra được.
   */
  it("in tự động chờ dữ liệu và chỉ chạy một lần", () => {
    expect(P_SALES).toContain("if (loading || !inv || printedRef.current) return")
    expect(P_SALES).toContain("printedRef.current = true")
  })

  it("không có cờ auto thì không tự in", () => {
    expect(P_SALES).toContain('if (params.get("auto") !== "1") return')
  })
})

/**
 * CỘT PHƯỜNG — chủ nhà yêu cầu cho CẢ HAI danh sách.
 */
describe("cột Phường", () => {
  it("có trong cấu hình cột của cả hai màn", () => {
    for (const p of [
      "src/app/(dashboard)/orders/list-config.ts",
      "src/app/(dashboard)/sales-invoices/list-config.ts",
    ]) {
      expect(read(p), `${p} thiếu cột Phường`).toContain('{ key: "ward", label: "Phường" }')
    }
  })

  /**
   * ⚠ THIẾU `ward` TRONG CÂU EMBED thì ô Phường hiện "—" cho mọi dòng mà
   * không lỗi nào bắn — cột trông như dữ liệu trống, không như lỗi.
   */
  it("hai câu embed đều hỏi ward", () => {
    for (const p of [
      "src/app/(dashboard)/orders/page.tsx",
      "src/app/(dashboard)/sales-invoices/page.tsx",
    ]) {
      const s = read(p)
      expect(
        (s.match(/\(store_name, phone, channel, ward, address\)/g) ?? []).length,
        `${p}: cả câu thường lẫn câu !inner phải hỏi ward`
      ).toBe(2)
    }
  })

  it("hai bảng đều vẽ ô Phường", () => {
    expect(read("src/components/orders/desktop-order-table.tsx")).toContain('{o.customer?.ward || "—"}')
    expect(read("src/components/sales-invoices/desktop-invoice-table.tsx")).toContain('{r.customer?.ward || "—"}')
  })
})

// =====================================================================

/**
 * XOÁ ĐƠN ĐÃ HUỶ VẪN DÍNH KHOÁ NGOẠI (mig 129).
 *
 * Trigger của 118 dọn phiếu trả bằng một DANH SÁCH LIỆT KÊ ba trạng
 * thái. Một phiếu mang giá trị KHÁC rơi đúng vào kẽ giữa hai nhánh:
 * nhánh chặn chỉ hỏi 'completed', nhánh dọn chỉ hỏi ba giá trị kia.
 * Không ai chặn, không ai dọn, và khoá ngoại nổ kèm một câu tiếng Anh.
 *
 * Chạy thật trên Postgres 16 với đúng tình huống đó:
 *   phiếu trạng thái 'approved' → đơn xoá được, phiếu đi theo
 *   phiếu 'completed'          → vẫn chặn, kèm câu tiếng Việt
 */
describe("xoá đơn: vét hết phiếu trả chưa hoàn thành", () => {
  const M129 = read("supabase/migrations/129_order_delete_sweeps_returns.sql")
  const C = strip(M129)

  /**
   * ⚠ LIỆT KÊ CÁI ĐƯỢC PHÉP, ĐỪNG LIỆT KÊ CÁI PHẢI DỌN. Danh sách chép
   * tay thì mỗi lần thêm một trạng thái là mở lại đúng kẽ hở này.
   */
  it("dọn bằng phần bù của completed, không bằng danh sách", () => {
    expect(C).toContain("WHERE order_id = OLD.id AND status IS DISTINCT FROM 'completed'")
    expect(C).not.toContain("status IN ('draft', 'submitted', 'cancelled')")
  })

  /**
   * ⚠ `IS DISTINCT FROM`, KHÔNG PHẢI `<>`. `NULL <> 'completed'` ra NULL,
   * tức không khớp — một phiếu status rỗng lại lọt qua đúng như cũ.
   */
  it("phiếu status rỗng cũng bị dọn", () => {
    expect(C).not.toMatch(/status\s*<>\s*'completed'/)
    expect(C).toContain("IS DISTINCT FROM 'completed'")
  })

  /** ⚠ Phiếu đã hoàn thành là chứng từ — vẫn phải chặn. */
  it("phiếu đã hoàn thành vẫn chặn, kèm câu tiếng Việt", () => {
    expect(C).toContain("WHERE order_id = OLD.id AND status = 'completed'")
    expect(C).toContain("ĐÃ HOÀN THÀNH (đã trừ công nợ / nhập lại kho)")
    expect(C).toMatch(/IF v_posted > 0 THEN\s*\n\s*RAISE EXCEPTION/)
  })

  /**
   * ⚠ CHỐT CUỐI. Còn dòng nào trỏ vào đơn thì nói ra, thay vì thả cho
   * khoá ngoại ném một câu tiếng Anh mà chủ NPP không làm gì được.
   */
  it("còn phiếu vướng thì nói ra, không để khoá ngoại nổ", () => {
    expect(C).toMatch(/IF v_left > 0 THEN\s*\n\s*RAISE EXCEPTION/)
    expect(C).toContain("phiếu trả hàng đang trỏ vào nó")
  })

  /**
   * ⚠ BẢNG `returns` KHÔNG CÓ CỘT MÃ PHIẾU. Bản đầu của khối chốt cuối
   * hỏi `return_code` — một cột không tồn tại — nên trigger nổ ngay lần
   * xoá đầu tiên, và lỗi mới còn khó hiểu hơn lỗi cũ.
   */
  it("không hỏi cột mã phiếu vốn không tồn tại", () => {
    expect(C).not.toContain("return_code")
    const SCHEMA = read("supabase/schema_full.sql")
    const i = SCHEMA.indexOf("CREATE TABLE returns (")
    expect(i).toBeGreaterThan(0)
    expect(SCHEMA.slice(i, SCHEMA.indexOf("\n);", i))).not.toContain("return_code")
  })
})

/**
 * MÀN SOẠN HÓA ĐƠN: KHÔNG CÒN LÀ MỘT CÁI BẢNG.
 *
 * ⚠ CHỐT CŨ Ở ĐÂY ĐÃ ĐƯỢC THAY, VÀ NÓI RA VÌ SAO. Nó canh việc hai ô
 * nhập trong bảng phải bọc `flex justify-end` để nằm dưới đúng nhãn
 * cột. Chủ nhà chốt 21/09/2026: hai màn Xuất hàng / Sửa hóa đơn phải
 * "giống hệt màn Sửa đơn hàng" — tức là thẻ dòng bấm được, không phải
 * bảng có ô nhập. Không còn cột thì không còn gì để căn.
 *
 * Luật THẬT SỰ quan trọng của bố cục cũ — sửa số lượng và giá mà không
 * phải nhắm vào một ô 24px — nay do `Stepper` và `LineEditSheet` lo, và
 * có chốt riêng ở `tests/wf2b-orders-ui.test.ts`.
 */
describe("màn soạn: dòng hàng là thẻ bấm được, không phải bảng", () => {
  const E = read("src/components/orders/invoice-editor.tsx")

  it("không còn bảng có ô nhập trong ô bảng", () => {
    expect(E, "màn soạn hóa đơn vẫn còn bảng dòng hàng").not.toContain("<table")
    expect(E, "vẫn còn ô nhập nằm trong ô bảng").not.toContain("<td ")
  })

  it("dùng chung ô sửa dòng với màn Sửa đơn hàng", () => {
    expect(E).toContain("<LineEditSheet")
    expect(E).toContain("<Stepper")
  })
})

// =====================================================================

/**
 * NÚT HUỶ ĐƠN TRONG NGĂN XEM NHANH (chủ nhà yêu cầu).
 */
describe("ngăn xem nhanh đơn: nút Huỷ đơn", () => {
  const DRAWER = read("src/components/orders/order-drawer.tsx")
  const LIST = read("src/app/(dashboard)/orders/page.tsx")

  it("có nút Huỷ đơn cạnh nút Sửa đơn", () => {
    expect(DRAWER).toContain("Huỷ đơn")
    const i = DRAWER.indexOf("Sửa đơn")
    const j = DRAWER.indexOf("Huỷ đơn")
    expect(j).toBeGreaterThan(i)
  })

  /**
   * ⚠ CHỈ ĐƠN CHƯA XUẤT. Đơn đã xuất phải đi qua RPC huỷ hóa đơn (hoàn
   * kho theo đúng lô đã lấy, xoá công nợ); một lệnh UPDATE trạng thái từ
   * trình duyệt sẽ để kho thiếu hàng mà sổ nói đã huỷ.
   */
  it("nút chỉ hiện với đơn nháp hoặc phiếu tạm", () => {
    expect(DRAWER).toContain(
      '{canCancel && (order.status === "draft" || order.status === "submitted") && ('
    )
  })

  /**
   * ⚠ MỘT HÀM HUỶ CHO CẢ HAI ĐƯỜNG. Viết lại phép huỷ trong ngăn là hai
   * đường, và chỉ một trong hai đếm số dòng ghi được — tức chỉ một trong
   * hai nhìn thấy khi RLS từ chối.
   */
  it("ngăn và thanh chọn nhiều dùng chung một hàm huỷ", () => {
    expect(LIST).toContain("const cancelOrders = async (ids: string[]) => {")
    expect(LIST).toContain("onCancel={(o) => cancelOrders([o.id])}")
    expect(LIST).toContain("onClick={() => cancelOrders(Array.from(selectedIds))}")
  })

  /** ⚠ Huỷ một đơn thì câu hỏi phải nêu MÃ ĐƠN, không nói "1 đơn hàng". */
  it("hỏi lại kèm mã đơn khi chỉ huỷ một đơn", () => {
    expect(LIST).toContain("`Hủy đơn ${cancellable[0].order_code}? Không thể hoàn tác.`")
  })
})

// =====================================================================

/**
 * SỐ ĐƠN HÀNG: DH-0001, sửa lần n thì thêm -n (mig 130).
 *
 * Chạy thật trên Postgres 16:
 *   DH-0001…DH-0006 (đánh lại) · đơn mới gửi lên "SO-20260918-8595"
 *   → DH-0007 · sửa tiền → DH-0007-1 · sửa ghi chú → DH-0007-2
 *   · gửi duyệt / huỷ / ghi đè mã tay → GIỮ NGUYÊN · đơn kế → DH-0008
 */
describe("mã đơn hàng: cơ sở dữ liệu cấp, không phải trình duyệt", () => {
  const M130 = read("supabase/migrations/130_order_code_no_date.sql")
  const C = strip(M130)

  it("một chỗ dựng mã, đúng mẫu DH-xxxx[-n]", () => {
    expect(C).toContain("CREATE OR REPLACE FUNCTION public._order_code(p_seq int, p_edit int)")
    expect(C).toContain("'DH-' || lpad(COALESCE(p_seq, 0)::text, 4, '0')")
  })

  /**
   * ⚠ `row_number()` TRẢ BIGINT, và Postgres KHÔNG tự ép sang int khi
   * chọn hàm — thiếu `::int` là migration chết ngay câu đầu tiên với
   * `_order_code(bigint, integer) does not exist`.
   */
  it("ép row_number về int trước khi dựng mã", () => {
    expect(C).toContain(")::int AS n")
  })

  /** ⚠ max+1 và khoá trước khi đếm — cùng lý do như mã hóa đơn. */
  it("cấp số bằng max+1, có khoá", () => {
    expect(C).toContain("PERFORM pg_advisory_xact_lock(hashtext('order_seq:' || p_org::text))")
    expect(C).toContain("SELECT COALESCE(max(order_seq), 0) + 1 INTO v_n")
  })

  /**
   * ⚠ TRIGGER GHI ĐÈ MÃ TRÌNH DUYỆT GỬI LÊN. Mã cũ do trình duyệt sinh
   * với bốn chữ số NGẪU NHIÊN, mà `order_code` là UNIQUE toàn bảng — đụng
   * nhau là người bán nhận lỗi unique giữa lúc đứng ở cửa hàng.
   */
  it("đơn mới do trigger cấp số, ghi đè mã gửi lên", () => {
    expect(C).toContain("BEFORE INSERT ON sales_orders")
    expect(C).toContain("NEW.order_code := public._order_code(NEW.order_seq, 0)")
    // Lấy org từ chính dòng đang chèn, không gọi user_org_id().
    expect(C).toContain("public._next_order_seq(NEW.org_id)")
    expect(C).not.toContain("_next_order_seq(public.user_org_id())")
  })

  /**
   * ⚠ ĐẾM Ở LẦN GHI ĐẦU ĐƠN, KHÔNG Ở TỪNG DÒNG HÀNG. Một lần sửa thường
   * xoá hết dòng cũ rồi chèn dòng mới — bám vào `sales_order_lines` thì
   * một lần sửa đếm thành nhiều lần và DH-0042 nhảy lên DH-0042-7.
   */
  it("tăng đuôi ở bảng đơn, không ở bảng dòng hàng", () => {
    expect(C).toContain("BEFORE UPDATE ON sales_orders")
    expect(C).not.toContain("ON sales_order_lines")
  })

  /**
   * ⚠ CHỈ ĐẾM KHI NỘI DUNG THẬT SỰ ĐỔI. Duyệt / huỷ / xuất hàng đều ghi
   * vào `sales_orders` nhưng chỉ đụng `status` — kể chúng là mỗi lần bấm
   * Xuất hàng lại đổi số đơn, và tài xế cầm phiếu in ra không tra được
   * đơn nào cả.
   */
  it("đổi trạng thái KHÔNG làm tăng đuôi", () => {
    const i = C.indexOf("IF NEW.customer_id")
    expect(i).toBeGreaterThan(0)
    const cond = C.slice(i, C.indexOf("THEN", i))
    expect(cond).toContain("NEW.total")
    expect(cond).toContain("NEW.notes")
    expect(cond, "status không được nằm trong điều kiện tăng đuôi").not.toContain("NEW.status")
    expect(cond).not.toContain("approval_reason")
  })

  /** ⚠ `IS DISTINCT FROM` — `NULL <> 'x'` ra NULL nên không khớp. */
  it("so sánh chịu được NULL", () => {
    const i = C.indexOf("IF NEW.customer_id")
    const cond = C.slice(i, C.indexOf("THEN", i))
    expect(cond).not.toMatch(/NEW\.\w+\s*<>/)
    expect((cond.match(/IS DISTINCT FROM/g) ?? []).length).toBeGreaterThanOrEqual(8)
  })

  /** ⚠ Không cho ghi đè mã bằng tay qua PostgREST. */
  it("nhánh không-đổi giữ nguyên mã cũ", () => {
    expect(C).toContain("NEW.order_code := OLD.order_code")
    expect(C).toContain("NEW.order_seq := OLD.order_seq")
  })
})

describe("ứng dụng đọc lại mã thật sau khi ghi", () => {
  const CREATE = read("src/lib/orders/create.ts")
  const SUBMIT = read("src/lib/sell/submit.ts")

  /**
   * ⚠ MÃ TRONG TẢI TRỌNG CHỈ LÀ MÃ TẠM để xếp hàng ngoại tuyến. Trả nó
   * về cho màn "Đặt hàng xong" là in ra một số không có trong sổ, và
   * nhân viên đọc số đó cho khách qua điện thoại.
   */
  it("lệnh ghi lấy về cả order_code", () => {
    /**
     * ⚠ ĐẾM CẢ HAI CHỖ. Bản đầu của chốt này NÓI DỐI: `.select("id,
     * order_code")` có ở hai đường — lệnh chèn và đường chống ghi trùng
     * — nên bỏ cột khỏi lệnh chèn thì `toContain` vẫn tìm thấy ở đường
     * kia và chốt vẫn xanh, trong khi màn "Đặt hàng xong" in ra mã tạm.
     */
    expect((CREATE.match(/\.select\("id, order_code"\)/g) ?? []).length).toBe(2)
    expect(CREATE).toContain("orderCode: insertedRow.order_code")
    // Neo đúng lệnh CHÈN, không chỉ "có ở đâu đó trong file".
    const i = CREATE.indexOf(".insert({")
    expect(i).toBeGreaterThan(0)
    expect(CREATE.slice(i, CREATE.indexOf(".single()", i))).toContain('.select("id, order_code")')
  })

  it("đường chống ghi trùng cũng trả mã thật", () => {
    const i = CREATE.indexOf('.eq("client_request_id"')
    expect(i).toBeGreaterThan(0)
    expect(CREATE.slice(i - 200, i + 400)).toContain("orderCode: row.order_code")
  })

  it("submit trả mã từ dòng đã ghi, không từ tải trọng", () => {
    expect(SUBMIT).toContain("const { orderId, orderCode } = await createOrderRecords(supabase, payload, ctx)")
    expect(SUBMIT).toContain('return { kind: "created", orderCode, orderId, status, reason }')
  })

  /**
   * ⚠ ĐƠN XẾP HÀNG NGOẠI TUYẾN THÌ CHƯA CÓ SỐ THẬT. Nhánh `queued` vẫn
   * trả mã tạm — đúng, vì lúc đó chưa ai cấp số cho nó.
   */
  it("nhánh ngoại tuyến vẫn dùng mã tạm", () => {
    expect(SUBMIT).toContain('return { kind: "queued", orderCode: payload.order.order_code }')
  })
})

// =====================================================================

/**
 * MÀN CHI TIẾT THEO MẪU CHỦ NHÀ CHỐT.
 *
 * Bộ khối dựng chung nằm ở `components/detail/detail-chrome.tsx`. Hai màn
 * chi tiết phải giống nhau tới từng khoảng cách; dựng riêng mỗi bên là
 * chúng trôi xa nhau ngay từ lần sửa thứ hai, và người dùng đi lại giữa
 * hai màn suốt ngày sẽ thấy rõ.
 */
describe("màn chi tiết: bộ khối dựng chung", () => {
  const CHROME = read("src/components/detail/detail-chrome.tsx")
  const INV = read("src/app/(dashboard)/sales-invoices/[id]/page.tsx")

  it("mã chứng từ dùng phông đều nét", () => {
    expect(CHROME).toContain('className="font-mono text-2xl font-bold tracking-tight sm:text-3xl"')
  })

  /**
   * ⚠ CHẤM MÀU KHÔNG PHẢI TRANG TRÍ. Nó phân biệt được khi liếc nhanh,
   * còn nhãn chữ vẫn nói đủ khi in đen trắng.
   */
  it("huy hiệu trạng thái có cả chấm màu lẫn nhãn chữ", () => {
    expect(CHROME).toContain('<span className="h-1.5 w-1.5 rounded-full"')
    expect(CHROME).toContain("{label}")
  })

  /**
   * ⚠ CỘT PHẢI BÁM KHI CUỘN NHƯNG KHÔNG KÉO DÀI THEO CỘT TRÁI. Thẻ tóm
   * tắt cao 2000px là vô nghĩa.
   */
  it("cột phải sticky và self-start", () => {
    expect(CHROME).toContain('className="space-y-5 self-start lg:sticky lg:top-4"')
  })

  /**
   * ⚠ MỐC CHƯA XẢY RA PHẢI NHÌN RA LÀ CHƯA XẢY RA. Vẽ giống mốc đã xong
   * là người đọc tưởng chứng từ đã đi tới đó.
   */
  it("tiến trình phân biệt mốc đã xong / đang chờ / chưa tới", () => {
    expect(CHROME).toContain('s.state === "done" && "bg-primary"')
    expect(CHROME).toContain('s.state === "current" && "bg-primary ring-4 ring-primary/20"')
    expect(CHROME).toContain('s.state === "todo" && "bg-outline-variant"')
  })

  /**
   * ⚠ DÙNG BIẾN MÀU CỦA DỰ ÁN, không chép mã màu từ mẫu. Mẫu vẽ bằng màu
   * tuyệt đối; dự án có bộ biến ngữ nghĩa và có chế độ in. Ngoại lệ duy
   * nhất là tông huy hiệu trạng thái, vốn truyền vào từ nơi gọi.
   */
  it("khối dựng chung không chôn mã màu nền", () => {
    const body = CHROME.replace(/\/\*[\s\S]*?\*\//g, "")
    expect(body).not.toMatch(/background:\s*"#/)
    expect(body).toContain("bg-surface-container-lowest")
  })

  it("màn hóa đơn dùng bộ khối này, không tự dựng lưới", () => {
    expect(INV).toContain("<DetailHero")
    expect(INV).toContain("<DetailColumns")
    expect(INV).toContain("<DetailTimeline steps={timeline} />")
    expect(INV).not.toContain('className="grid gap-4 lg:grid-cols-3"')
  })

  /**
   * ⚠ HÓA ĐƠN ĐÃ HUỶ VÀ CÒN HIỆU LỰC PHẢI KHÁC MÀU. Hai tờ nằm cạnh nhau
   * mà nhìn giống nhau là người tra sổ đọc nhầm tờ.
   */
  it("hai trạng thái hóa đơn mang hai tông khác nhau", () => {
    const i = INV.indexOf("const statusTone = posted")
    expect(i).toBeGreaterThan(0)
    const block = INV.slice(i, i + 220)
    expect(block).toContain("#12b76a")
    expect(block).toContain("#f04438")
  })

  /**
   * ⚠ ĐƯỜNG VỀ PHẢI CÒN. Mẫu vẽ nó ở thanh trên cùng — thanh đó là khung
   * ứng dụng chung, nên ở trang phải giữ một liên kết, nếu không mở hóa
   * đơn từ đâu cũng thành ngõ cụt.
   */
  it("màn hóa đơn vẫn có đường về danh sách", () => {
    expect(INV).toContain('href="/sales-invoices"')
    expect(INV).toContain("← Hóa đơn bán")
  })
})

/**
 * MÀN CHI TIẾT ĐƠN HÀNG cũng theo mẫu đó.
 *
 * ⚠ CHỈ ĐỔI BẢN MÁY TÍNH. Màn này có một bản riêng cho điện thoại
 * (`MobileOrderDetail`) vốn đã theo một mẫu khác chủ nhà chốt trước đó —
 * ghép hai mẫu vào một là hỏng cả hai.
 */
describe("màn chi tiết đơn hàng theo mẫu", () => {
  const ORD = read("src/app/(dashboard)/orders/[id]/page.tsx")

  it("dùng bộ khối chung, bỏ PageHeader cũ", () => {
    expect(ORD).toContain("<DetailHero")
    expect(ORD).toContain("<DetailTimeline steps={heroTimeline} />")
    expect(ORD).not.toContain("<PageHeader")
  })

  /** ⚠ Huy hiệu trạng thái lấy tông từ `orderTone` — một bảng màu, không chép tay. */
  it("tông trạng thái lấy từ orderTone", () => {
    expect(ORD).toContain("<StatusPill label={orderTone(order.status).label} tone={orderTone(order.status)} />")
  })

  /**
   * ⚠ TIẾN TRÌNH KHÔNG BAO GIỜ BỊ GÓI TRONG ĐIỀU KIỆN HIỆN NÚT. Đơn đã
   * xong không còn bước nào để bấm, nhưng tiến trình của nó vẫn là thứ
   * người ta mở đơn ra để tra.
   *
   * Bản cũ kiểm bằng cách so vị trí với thẻ "Thao tác"; thẻ ấy đã bị bỏ
   * (chủ nhà chốt đưa nút lên hàng đầu trang), nên nay kiểm thẳng: khối
   * Tiến trình không nằm trong bất kỳ điều kiện `roleTransitions` nào.
   */
  it("khối tiến trình không bị gói trong điều kiện hiện nút", () => {
    const i = ORD.indexOf('<DetailCard title="Tiến trình"')
    expect(i).toBeGreaterThan(0)
    expect(ORD.slice(Math.max(0, i - 300), i)).not.toContain("roleTransitions")
    expect(ORD.slice(Math.max(0, i - 300), i)).not.toContain("canDelete")
  })

  /**
   * ⚠ ĐƠN HUỶ KHÔNG ĐI HẾT ĐƯỜNG. Vẽ nó như đang chờ bước sau là hứa một
   * việc sẽ không xảy ra.
   */
  it("đơn huỷ có đường tiến trình riêng, ngắn hơn", () => {
    const i = ORD.indexOf('if (st === "cancelled")')
    expect(i).toBeGreaterThan(0)
    expect(ORD.slice(i, i + 400)).toContain('label: "Đã huỷ"')
  })

  /**
   * ⚠ WORKFLOW V2 KHÔNG CÓ NGƯỜI DUYỆT. Chữ "duyệt" trên màn là chỉ NVBH
   * đi ngồi đợi một bước không tồn tại. Chốt ở
   * `orders-mobile-template.test.ts` canh chỗ này và đã bắt được một
   * nhãn "Gửi duyệt" tôi viết nhầm trong khối tiến trình.
   */
  it("mốc gửi đơn không dùng chữ duyệt", () => {
    expect(ORD).toContain('label: "Gửi đơn"')
    expect(ORD).not.toContain("Gửi duyệt")
  })

  it("vẫn có đường về danh sách đơn", () => {
    expect(ORD).toContain("← Đơn hàng")
  })

  /**
   * ⚠ CHỦ NHÀ BÁO: "vào chi tiết đơn hàng cũng phải đầy đủ các nút như
   * màn Xem nhanh". Trước đó mọi hành động nằm trong thẻ "Thao tác" ở cột
   * phải — người mở đơn từ ngăn xem nhanh sang chi tiết thấy nút biến mất
   * và tưởng mình hết quyền.
   */
  it("đầu trang có đủ bộ nút như ngăn xem nhanh", () => {
    const i = ORD.indexOf("const heroActions = (")
    expect(i).toBeGreaterThan(0)
    const block = ORD.slice(i, ORD.indexOf("\n  )", i))
    /**
     * ⚠ KIỂM ĐÚNG CÂU GÁC, không kiểm tên có xuất hiện. Bản đầu của chốt
     * này NÓI DỐI: nó chỉ hỏi chuỗi "invoiceAction" có nằm trong khối
     * không, nên đổi `{invoiceAction && (` thành `{false && invoiceAction
     * && (` vẫn xanh — nút biến mất mà chốt không biết.
     */
    for (const a of ["invoiceAction", "editAction", "reorderAction", "closeAction", "cancelTransition"]) {
      expect(block, `thiếu nút ${a} ở hàng nút đầu trang`).toContain(`{${a} && (`)
    }
    // Không có nhánh nào bị tắt cứng.
    expect(block, "có nút bị tắt cứng bằng false").not.toContain("{false")
    expect(ORD).toContain("actions={heroActions}")
  })

  /**
   * ⚠ HUỶ ĐƠN LẤY TỪ `roleTransitions`, không tự dựng điều kiện. Bảng
   * `STATUS_FLOW` mới là nơi nói đơn ở trạng thái nào thì huỷ được, và nó
   * đã lọc theo vai trò. Tự dựng là hai bộ luật, và một bộ sẽ sai.
   */
  it("nút huỷ lấy điều kiện từ bảng chuyển trạng thái", () => {
    expect(ORD).toContain('const cancelTransition = roleTransitions.find((t) => t.value === "cancelled") ?? null')
  })

  /**
   * THẺ "THAO TÁC" ĐÃ BỊ BỎ — chủ nhà chốt.
   *
   * Chốt cũ giữ nó lại với lý do "nó còn các bước lùi (Rút về nháp) và
   * nút Xoá đơn". Lý do ấy vẫn đúng về NỘI DUNG, chỉ sai về CHỖ ĐỂ: thẻ
   * nằm cuối cột phải, sau khách hàng / thông tin đơn / hoá đơn / tiến
   * trình, nên phải cuộn hết trang mới thấy "Rút về nháp".
   *
   * ⚠ NÊN CHỐT NAY GIỮ ĐÚNG ĐIỀU CŨ MUỐN GIỮ: cả hai nút ấy vẫn còn
   *   đường bấm, chỉ chuyển lên hàng nút đầu trang. Bỏ thẻ mà quên chúng
   *   là mất hẳn đường rút đơn về nháp và đường xoá một đơn nhập nhầm.
   */
  it("bỏ thẻ Thao tác nhưng giữ đủ nút của nó", () => {
    expect(ORD).not.toContain("<CardTitle>Thao tác</CardTitle>")
    const hero = ORD.slice(ORD.indexOf("const heroActions = ("), ORD.indexOf("const creditLimit ="))
    expect(hero).toContain("{backTransitions.map((trans) => {")
    expect(hero).toContain("Xóa đơn hàng")
    expect(hero).toContain("{cancelTransition && (")
  })
})

// =====================================================================

/**
 * TRẢ HÀNG CHUYỂN TỪ KHO VẬN SANG BÁN HÀNG (chủ nhà yêu cầu).
 *
 * ⚠ VÌ SAO ĐÚNG CHỖ: từ v2b phiếu trả gắn vào HÓA ĐƠN chứ không gắn vào
 * đơn. `complete_return` tính lại công nợ theo hóa đơn, và
 * `reissue_invoice` chặn sửa hóa đơn nếu bỏ mất mặt hàng mà phiếu trả
 * đang chờ đòi trả. Để nó ở Kho vận là xếp theo việc CŨ (nhập hàng về
 * kho), trong khi việc thật bây giờ là chỉnh một chứng từ bán.
 */
describe("Trả hàng nằm dưới Hóa đơn bán", () => {
  const NAV = read("src/components/layout/sidebar.tsx")

  const group = (label: string) => {
    const i = NAV.indexOf(`label: "${label}",`)
    expect(i, `không tìm thấy nhóm ${label}`).toBeGreaterThan(-1)
    return NAV.slice(i, NAV.indexOf("\n  },", i))
  }

  it("nằm trong nhóm Bán hàng, không còn ở Kho vận", () => {
    expect(group("Bán hàng")).toContain('href: "/returns"')
    expect(group("Kho vận"), "vẫn còn ở Kho vận").not.toContain('href: "/returns"')
  })

  /** ⚠ Đứng NGAY DƯỚI Hóa đơn bán — nó là chứng từ chỉnh hóa đơn. */
  it("đứng ngay dưới Hóa đơn bán", () => {
    const g = group("Bán hàng")
    const inv = g.indexOf('href: "/sales-invoices"')
    const ret = g.indexOf('href: "/returns"')
    const cus = g.indexOf('href: "/customers"')
    expect(inv).toBeGreaterThan(-1)
    expect(ret).toBeGreaterThan(inv)
    expect(ret).toBeLessThan(cus)
  })

  /** ⚠ Chỉ có MỘT mục Trả hàng — chuyển nhóm mà quên xoá chỗ cũ là hai mục. */
  it("chỉ có một mục Trả hàng trong cả thanh bên", () => {
    expect((NAV.match(/href: "\/returns"/g) ?? []).length).toBe(1)
  })

  /** ⚠ "Trả hàng NCC" là mục KHÁC, ở nhóm Mua hàng — không được đụng tới. */
  it("Trả hàng NCC vẫn ở Mua hàng", () => {
    expect(group("Mua hàng")).toContain('href: "/purchase-returns"')
  })
})

// =====================================================================

/**
 * HAI MÀN CHI TIẾT DỰNG ĐÚNG THEO MẪU — khối khách hàng và bảng dòng
 * hàng, không chỉ mượn khung ngoài.
 */
describe("khối khách hàng theo mẫu", () => {
  const CHROME = read("src/components/detail/detail-chrome.tsx")
  const ORD = read("src/app/(dashboard)/orders/[id]/page.tsx")
  const INV = read("src/app/(dashboard)/sales-invoices/[id]/page.tsx")

  it("có ô chữ cái đầu, tên, liên hệ và các ô số liệu", () => {
    expect(CHROME).toContain("export function DetailCustomerCard(")
    expect(CHROME).toContain('const initial = (name || "?").trim().charAt(0).toUpperCase() || "?"')
  })

  /**
   * ⚠ KẸP THANH VỀ [0,100]. Khách vượt hạn mức cho ra hơn 100% và thanh
   * màu tràn khỏi ô; khách trả dư cho ra số âm và thanh biến mất. Cả hai
   * đều là con số thật — chỉ cách VẼ là phải kẹp.
   */
  it("thanh hạn mức kẹp về 0–100%", () => {
    expect(CHROME).toContain("Math.min(100, Math.max(0, s.bar.pct))")
  })

  /** ⚠ Ô không có số thì không vẽ — nhãn trên ô rỗng đọc như chưa tải xong. */
  it("không vẽ ô khi không có số liệu", () => {
    expect(CHROME).toContain("{stats && stats.length > 0 && (")
  })

  it("cả hai màn đều dùng khối này", () => {
    expect(ORD).toContain("<DetailCustomerCard")
    expect(INV).toContain("<DetailCustomerCard")
  })

  /**
   * ⚠ CHƯA CÓ HẠN MỨC THÌ KHÔNG VẼ THANH. Thanh chạy trên hạn mức bằng 0
   * thì hoặc luôn đầy hoặc chia cho 0 — cả hai đều nói dối.
   */
  it("màn đơn chỉ vẽ ô công nợ khi có hạn mức", () => {
    expect(ORD).toContain("...(creditLimit > 0")
  })

  /**
   * ⚠ CÔNG NỢ LẤY TỪ DÒNG NỢ CỦA ĐƠN, không cộng lại từ tổng đơn. Đơn đã
   * thu một phần thì hai số đó khác nhau, và số đúng là số trong sổ.
   */
  it("công nợ lấy từ dòng nợ, không lấy tổng đơn", () => {
    const i = ORD.indexOf("const customerDebt =")
    expect(i).toBeGreaterThan(0)
    const block = ORD.slice(i, i + 200)
    expect(block).toContain("receivable?.amount")
    expect(block).toContain("receivable?.paid")
    expect(block).not.toContain("order.total")
  })

  /**
   * ⚠ DÒNG PHỤ NÓI ĐỦ PHÉP TÍNH, đúng như mẫu: mã · số lượng × đơn giá.
   * Người đối chiếu không phải nhìn sang ba cột khác để cộng nhẩm.
   */
  it("bảng dòng hàng của hóa đơn có dòng phụ SL × đơn giá", () => {
    expect(INV).toContain("{l.quantity} {l.unit_name} × {formatCurrency(l.unit_price)}")
    expect(INV).toContain('aside={`${lines.length} dòng`}')
  })
})
