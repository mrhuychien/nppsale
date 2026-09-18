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
 * MÀN SOẠN HÓA ĐƠN: hai cột nhập phải nằm dưới đúng nhãn của chúng.
 */
describe("màn soạn: ô nhập căn phải theo tiêu đề cột", () => {
  const E = read("src/components/orders/invoice-editor.tsx")

  /**
   * ⚠ `text-right` TRÊN Ô BẢNG CHỈ CĂN CHỮ, không căn phần tử con. Ô
   * nhập có bề rộng cố định (w-24 / w-32) nên nó nằm im bên trái trong
   * khi tiêu đề cột căn phải — nhìn ra là hai cột lệch hẳn khỏi nhãn.
   */
  it("ô SL xuất và Đơn giá được bọc flex justify-end", () => {
    expect((E.match(/<div className="flex justify-end">/g) ?? []).length).toBe(2)
    expect(E).not.toContain('<td className="px-3 py-2 text-right">\n                          <Input')
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
