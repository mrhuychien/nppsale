import { describe, it, expect, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { openInNewTab } from "@/components/ui/new-tab-link"

/**
 * NÚT CHỨC NĂNG Ở DANH SÁCH ĐƠN / HÓA ĐƠN — chủ nhà chốt 20/09/2026:
 * "ngoài xem nhanh đơn hàng trong danh sách, khi bấm vào các nút chức
 * năng → mở tab khác, không chuyển trang cùng tab" và "thêm cả xem ghi
 * chú chung vào xem nhanh hoá đơn".
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const LINK = read("src/components/ui/new-tab-link.tsx")
const ORD_DRAWER = read("src/components/orders/order-drawer.tsx")
const INV_DRAWER = read("src/components/sales-invoices/invoice-drawer.tsx")
const ORDERS = read("src/app/(dashboard)/orders/page.tsx")
const REF = read("src/lib/sell/ref-data.ts")
const MIG137 = read("supabase/migrations/137_committed_stock_stable_order.sql")

describe("mở sang tab mới", () => {
  /**
   * ⚠ `rel="noopener noreferrer"` LÀ BẮT BUỘC ĐI KÈM `target="_blank"`.
   * Thiếu nó thì trang mở ra nắm được `window.opener` của trang gốc.
   */
  it("thẻ mở tab mới có đủ target và rel", () => {
    /**
     * ⚠ BỎ CHÚ THÍCH TRƯỚC KHI TÌM. Chính chú thích đầu file cũng viết
     * `target="_blank"` và `rel="noopener noreferrer"` để giải thích vì
     * sao cần chúng — tìm trên cả file thì xoá hẳn hai thuộc tính khỏi
     * thẻ mà chốt vẫn xanh.
     */
    const flat = code(LINK).replace(/\s+/g, " ")
    expect(flat).toContain('target="_blank"')
    expect(flat).toContain('rel="noopener noreferrer"')
    // `<a>` không phải hộp flex như `<button>` — thiếu lớp này là chữ
    // dính lên mép trên của nút thay vì nằm giữa.
    expect(flat).toContain('cn("inline-flex items-center justify-center", className)')
  })

  /**
   * ⚠ MỌI ĐƯỜNG ĐIỀU HƯỚNG TRONG NGĂN XEM NHANH PHẢI ĐI QUA THẺ ẤY.
   * Còn sót một `router.push` là nút đó vẫn nuốt mất chỗ người dùng đang
   * đứng — và vì bốn nút còn lại đã đổi, họ sẽ không ngờ tới.
   */
  it.each([
    ["ngăn đơn hàng", "src/components/orders/order-drawer.tsx"],
    ["ngăn hóa đơn", "src/components/sales-invoices/invoice-drawer.tsx"],
  ])("%s: không còn chuyển trang cùng tab", (_l, rel) => {
    const src = code(read(rel))
    expect(src, "còn sót router.push").not.toContain("router.push")
    expect(src, "còn sót useRouter").not.toContain("useRouter")
    expect(src).toContain("NewTabLink")
  })

  it("ngăn đơn hàng: Sửa đơn và Chi tiết đều là thẻ mở tab mới", () => {
    const flat = ORD_DRAWER.replace(/\s+/g, " ")
    expect(flat).toContain("<NewTabLink href={isSellEditable(order.status) ? `/sell/edit/${order.id}` : `/orders/${order.id}`}")
    expect(flat).toContain("<NewTabLink href={`/orders/${order.id}`}")
  })

  it("ngăn hóa đơn: Sửa, In và Chi tiết đều là thẻ mở tab mới", () => {
    const flat = INV_DRAWER.replace(/\s+/g, " ")
    // ⚠ `/print?auto=1` từ 20/09/2026 — nút In bật thẳng cửa sổ in.
    for (const h of ["/edit`}", "/print?auto=1`}", "<NewTabLink href={`/sales-invoices/${invoice.id}`}"]) {
      expect(flat).toContain(h)
    }
    expect((flat.match(/<NewTabLink/g) ?? []).length).toBe(3)
  })

  /**
   * ⚠ "XUẤT HÀNG" CŨNG LÀ MỘT CÚ ĐIỀU HƯỚNG, không phải một lệnh chạy
   * tại chỗ: nó đi tới màn lập hóa đơn. Bỏ sót nó là nút hay dùng nhất
   * vẫn ném người dùng ra khỏi danh sách.
   */
  it("Xuất hàng ở bảng và ở ngăn đều mở tab mới", () => {
    expect(code(ORDERS)).not.toContain("router.push(`/sales-invoices/new?order=")
    const uses = ORDERS.match(/openInNewTab\(`\/sales-invoices\/new\?order=\$\{o\.id\}`\)/g) ?? []
    expect(uses.length, "phải đổi cả ở bảng máy tính lẫn ở ngăn xem nhanh").toBe(2)
  })
})

describe("chặn cửa sổ bật lên thì vẫn phải đi tiếp", () => {
  /**
   * ⚠ KHÔNG ĐƯỢC IM. `window.open` trả `null` khi trình duyệt chặn;
   * không có nhánh dự phòng thì người dùng bấm nút và KHÔNG CÓ GÌ XẢY
   * RA — họ bấm tiếp mấy lần rồi kết luận app hỏng.
   */
  const g = globalThis as unknown as { window?: unknown }
  afterEach(() => { delete g.window })

  /**
   * ⚠ CỬA SỔ GIẢ PHẢI GHI LẠI CẢ THAM SỐ THỨ BA. Chính tham số ấy là chỗ
   * hỏng: `window.open(..., "noopener")` LUÔN trả `null` theo chuẩn, kể
   * cả khi tab mới mở ra bình thường — và nhánh dự phòng đọc `null` đó
   * thành "bị chặn" rồi chuyển luôn cả tab cũ.
   */
  const stub = (openReturns: unknown) => {
    const calls: Array<[string, string | undefined, string | undefined]> = []
    const w = {
      open: (href: string, target?: string, features?: string) => {
        calls.push([href, target, features])
        return openReturns
      },
      location: { href: "" },
    }
    g.window = w
    return { w, calls }
  }

  it("mở được thì KHÔNG đụng tới địa chỉ tab hiện tại", () => {
    const opened: { opener: unknown } = { opener: {} }
    const { w, calls } = stub(opened)
    openInNewTab("/orders/abc")
    expect(calls.map((c) => c[0])).toEqual(["/orders/abc"])
    expect(w.location.href, "đã mở tab mới mà còn chuyển cả tab cũ").toBe("")
    // Và tab mới không được giữ tay nắm sang tab này.
    expect(opened.opener).toBeNull()
  })

  /**
   * ⚠ KHÔNG TRUYỀN `noopener` QUA THAM SỐ THỨ BA — xem chú thích trên.
   * Đây là chốt trực tiếp cho lỗi người dùng báo 20/09/2026.
   */
  it("không truyền noopener vào window.open", () => {
    const { calls } = stub({ opener: {} })
    openInNewTab("/orders/abc")
    expect(calls[0][1]).toBe("_blank")
    expect(String(calls[0][2] ?? "")).not.toContain("noopener")
  })

  it("bị chặn thì chuyển ngay ở tab hiện tại", () => {
    const { w } = stub(null)
    openInNewTab("/orders/abc")
    expect(w.location.href).toBe("/orders/abc")
  })
})

describe("ghi chú chung trong xem nhanh hóa đơn", () => {
  /**
   * ⚠ ĐỌC KHI MỞ, KHÔNG KÉO SẴN TRONG DANH SÁCH — cùng lý do với dòng
   * hàng: danh sách 50 hóa đơn không cần mang theo 50 đoạn chữ.
   */
  it("đọc cả ghi chú hóa đơn lẫn ghi chú của đơn", () => {
    expect(INV_DRAWER).toContain('.select("notes, order:sales_orders(notes)")')
    expect(INV_DRAWER).toContain(".eq(\"id\", invoiceId)")
  })

  /** ⚠ Dùng chung `noteBlocksOf` với bản in — một luật, không hai. */
  it("bỏ khối rỗng và khử trùng bằng cùng hàm với bản in", () => {
    expect(INV_DRAWER).toContain('from "@/components/printing/sales-invoice"')
    expect(INV_DRAWER).toContain("noteBlocksOf([")
    expect(INV_DRAWER).toContain('{ label: "Ghi chú đơn hàng", text: r.order?.notes }')
    expect(INV_DRAWER).toContain('{ label: "Ghi chú hóa đơn", text: r.notes }')
  })

  /** Và phải thật sự vẽ ra, không chỉ đọc về rồi để đó. */
  it("vẽ từng khối ghi chú ra ngăn", () => {
    const flat = INV_DRAWER.replace(/\s+/g, " ")
    expect(flat).toContain("{notes.map((n) => (")
    expect(flat).toContain("{n.label}:")
  })

  /** Đổi hóa đơn thì phải xoá ghi chú cũ, nếu không tờ này mang lời của tờ kia. */
  it("mở hóa đơn khác thì dọn ghi chú cũ trước", () => {
    const i = INV_DRAWER.indexOf("setReturns([])")
    expect(INV_DRAWER.slice(i, i + 80)).toContain("setNotes([])")
  })
})

describe("đọc tồn kho: chia trang phải có mốc ổn định", () => {
  /**
   * ⚠ ĐÂY LÀ MỘT TRONG HAI CHỖ LÀM "ĐẶT QUÁ SỐ CHO PHÉP" VẪN LỌT.
   * `fetchAllForAggregate` chia trang bằng `range()` và gọi SONG SONG;
   * không có `ORDER BY` thì `OFFSET/LIMIT` vừa lặp vừa bỏ sót dòng. Các
   * dòng này được CỘNG thành tồn kho — lô đếm hai lần là tồn phồng lên,
   * và màn bán hàng cho đặt nhiều hơn số thật sự có.
   */
  it("câu đọc lô hàng có sắp thứ tự cố định", () => {
    // ⚠ Từ 20/09/2026 câu này còn lọc vùng kho (xem tests/sale-zone-only);
    //   mốc chia trang phải sống sót qua thay đổi đó.
    expect(REF).toContain('.order("id").range(from, to)')
    expect(REF, "mốc chia trang phải nằm NGAY TRƯỚC range").toMatch(
      /\.eq\("warehouse_zone", "sale"\)\.order\("id"\)\.range\(from, to\)/
    )
  })

  /** ⚠ Chạm trần là tồn cộng THIẾU — phải nói, như danh mục và khách đã nói. */
  it("chạm trần khi đọc lô hàng thì báo", () => {
    expect(REF).toContain("if (batchRes.truncated) {")
    const i = REF.indexOf("if (batchRes.truncated) {")
    expect(REF.slice(i, i + 250)).toContain("warnings.push(")
  })
})

describe("bản vá 137 — số đã đặt đọc qua nhiều trang", () => {
  /**
   * ⚠ BỎ SÓT MỘT SẢN PHẨM NGHĨA LÀ SỐ "ĐÃ ĐẶT" CỦA NÓ VỀ 0, và màn bán
   * hàng lấy `tồn − 0 = tồn` làm mức cho phép đặt — đúng chuyện chủ nhà
   * báo. `ORDER BY` là thứ duy nhất làm việc chia trang có mốc.
   */
  it("hàm sắp theo product_id", () => {
    expect(MIG137).toContain("ORDER BY x.pid")
  })

  /**
   * ⚠ `DROP FUNCTION` XOÁ LUÔN MỌI GRANT CŨ. Không cấp lại là cả màn bán
   * hàng mất số "đã đặt" và quay về đúng lỗ hổng bản vá này đang bịt.
   */
  it("dựng lại xong thì cấp lại quyền gọi và khoá PUBLIC", () => {
    expect(MIG137).toContain("REVOKE ALL ON FUNCTION public.committed_stock_by_product(uuid) FROM PUBLIC")
    expect(MIG137).toContain("GRANT EXECUTE ON FUNCTION public.committed_stock_by_product(uuid) TO authenticated")
    expect(MIG137.indexOf("DROP FUNCTION")).toBeLessThan(MIG137.indexOf("GRANT EXECUTE"))
  })

  /** Luật chung của kho này: idempotent, có NOTICE, kết bằng nạp lại schema. */
  it("chạy lại được và nạp lại schema", () => {
    expect(MIG137).toContain("DROP FUNCTION IF EXISTS public.committed_stock_by_product(uuid)")
    expect(MIG137).toContain("RAISE NOTICE")
    expect(MIG137.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true)
  })

  /**
   * ⚠ KHÔNG ĐƯỢC ĐỔI PHÉP TÍNH. Bản vá này chỉ thêm thứ tự; đổi thêm gì
   * nữa là một thay đổi nghiệp vụ lẻn vào dưới danh nghĩa sửa kỹ thuật.
   */
  it("phép tính giống hệt bản 136", () => {
    const m136 = read("supabase/migrations/136_committed_stock.sql")
    const body = (s: string) =>
      s.slice(s.indexOf("WITH live_orders AS"), s.indexOf("HAVING SUM(x.qty) > 0"))
    expect(body(MIG137)).toBe(body(m136))
  })
})

describe("xem nhanh hóa đơn: in ngay và huỷ được", () => {
  /**
   * ⚠ `?auto=1` — BẬT THẲNG CỬA SỔ IN (chủ nhà chốt 20/09/2026). Người
   * bấm "In hóa đơn" đã nói rõ họ muốn in; bắt bấm thêm một nút In nữa ở
   * màn sau là tính thuế lên mỗi tờ giấy.
   */
  it("nút In mở màn in ở chế độ tự in", () => {
    expect(INV_DRAWER.replace(/\s+/g, " ")).toContain(
      "<NewTabLink href={`/sales-invoices/${invoice.id}/print?auto=1`}"
    )
  })

  /**
   * ⚠ HUỶ ĐI QUA RPC `cancel_invoice`, KHÔNG UPDATE THẲNG. Huỷ một hóa
   * đơn là hoàn hàng về ĐÚNG các lô đã lấy, xoá công nợ và lùi trạng
   * thái đơn — ba việc trong một giao dịch.
   */
  it("nút Huỷ đơn gọi RPC, không ghi trạng thái thẳng", () => {
    expect(INV_DRAWER).toContain("cancelInvoice(createClient(), invoice.id, cancelReason.trim())")
    expect(code(INV_DRAWER)).not.toContain('update({ status: "cancelled" })')
  })

  /** ⚠ LÝ DO LÀ BẮT BUỘC — sổ huỷ không có lý do thì tra cứu về sau vô nghĩa. */
  it("hỏi lý do trước khi huỷ, qua ConfirmDialog chứ không confirm()", () => {
    expect(INV_DRAWER).toContain("<ConfirmDialog")
    expect(INV_DRAWER).toContain("cancelReason")
    expect(code(INV_DRAWER), "dùng confirm() cho thao tác huỷ").not.toContain("confirm(")
  })

  /** Chỉ hóa đơn ĐÃ XUẤT mới huỷ được, và chỉ người có quyền. */
  it("nút chỉ hiện với hóa đơn đã xuất và người có quyền", () => {
    const i = INV_DRAWER.indexOf("Huỷ đơn")
    expect(INV_DRAWER.slice(i - 400, i)).toContain("canEdit && posted")
  })

  /** ⚠ Huỷ xong danh sách phải đọc lại — trạng thái và tổng tiền đều đổi. */
  it("huỷ xong thì báo cho danh sách đọc lại", () => {
    expect(INV_DRAWER).toContain("onChanged?.()")
    expect(read("src/app/(dashboard)/sales-invoices/page.tsx")).toContain("onChanged={fetchData}")
  })
})

describe("tra soát mã hàng: xuất theo hóa đơn nào, cho ai", () => {
  const CARD = read("src/app/(dashboard)/inventory/stock-card/[productId]/page.tsx")

  /**
   * ⚠ HỎI TỪ PHÍA DÒNG HÓA ĐƠN, KHÔNG HỎI TỪ PHÍA PHIẾU KHO. Hỏi
   * `sales_invoices` theo danh sách `stock_entry_id` là dựng một câu
   * `in(...)` dài bằng số lần xuất của mặt hàng — mặt hàng chạy có hàng
   * nghìn lần, và URL vỡ trước khi truy vấn chạy.
   */
  it("đọc hóa đơn từ dòng hóa đơn của chính mặt hàng", () => {
    expect(CARD).toContain('.from("sales_invoice_lines")')
    expect(CARD).toContain("invoice:sales_invoices!inner(invoice_code, invoice_date, status, stock_entry_id, customer:customers(store_name, billing_name))")
    expect(CARD).toContain('.eq("product_id", productId)')
  })

  /** ⚠ Bảng có thể vượt 1.000 dòng — phải phân trang và có mốc. */
  it("phân trang qua fetchAllForAggregate và có mốc chia trang", () => {
    expect(CARD).toContain("fetchAllForAggregate<InvLineRow>")
    expect(CARD).toContain('.order("id")')
  })

  /** ⚠ Chỉ hóa đơn CÒN HIỆU LỰC. Hóa đơn đã huỷ không nói lên hàng đi đâu. */
  it("bỏ hóa đơn đã huỷ", () => {
    expect(CARD).toContain('inv.status !== "posted"')
  })

  /** Và phải vẽ ra ở cả bảng máy tính lẫn danh sách điện thoại. */
  it("hiện mã hóa đơn, ngày và tên khách ở cả hai khổ màn", () => {
    expect(CARD).toContain("<TableHead>Hóa đơn / Khách</TableHead>")
    const flat = CARD.replace(/\s+/g, " ")
    expect(flat).toContain("{m.invoice_code ? (")
    expect(flat).toContain("{m.invoice_code && (")
    expect(flat).toContain("{m.customer_name ? ` · ${m.customer_name}` : \"\"}")
  })

  /**
   * ⚠ PHIẾU KHÔNG ĐI THEO HÓA ĐƠN (chuyển kho, kiểm kê, trả nhà cung
   * cấp) THÌ ĐỂ GẠCH. Bịa một cái tên vào đó là nói dối về nơi hàng đi.
   */
  it("phiếu không có hóa đơn thì để dấu gạch", () => {
    expect(CARD).toContain("invoice_code: string | null")
    expect(CARD.replace(/\s+/g, " ")).toContain('<span className="text-muted-foreground">—</span>')
  })
})

describe("quay về tab danh sách thì đọc lại", () => {
  /**
   * ⚠ CHỦ NHÀ BÁO 20/09/2026: "tạo hoá đơn xong thì mất luôn đơn hàng
   * chứ không chuyển trạng thái?".
   *
   * ĐƠN KHÔNG MẤT. `post_invoice` gọi `_wf2b_sync_order_status`
   * (mig 125) và đổi trạng thái `submitted` → `completed`; đã kiểm trên
   * Postgres thật: 6 đơn trước, 6 đơn sau, không dòng nào bị xoá. Đơn
   * rời tab "Phiếu tạm" sang tab "Hoàn thành" — đúng thiết kế.
   *
   * ⚠ CÁI SAI LÀ MÀN HÌNH KHÔNG NÓI RA, VÀ NÓI MUỘN. Từ khi nút "Xuất
   * hàng" mở TAB MỚI, tab danh sách không còn bị rời đi và quay lại: nó
   * nằm im với bản chụp cũ, hiện đơn vẫn ở Phiếu tạm như chưa có gì xảy
   * ra, rồi tới lần tải lại tình cờ nào đó thì đơn biến mất không dấu
   * vết. Đọc lại khi người dùng quay về tab là chỗ vá đúng.
   */
  const HOOK = read("src/hooks/use-refresh-on-focus.ts")

  it.each([
    ["đơn hàng", "src/app/(dashboard)/orders/page.tsx"],
    ["hóa đơn", "src/app/(dashboard)/sales-invoices/page.tsx"],
  ])("%s: danh sách đọc lại khi tab sáng lại", (_l, rel) => {
    const src = read(rel)
    expect(src).toContain("useRefreshOnFocus()")
    // Không chỉ khai ra rồi bỏ đó — phải nằm trong mảng phụ thuộc.
    expect((src.match(/focusTick\]/g) ?? []).length,
      "khai focusTick mà không effect nào nghe").toBeGreaterThan(0)
  })

  /** ⚠ Cả ba phép đọc, không chỉ danh sách: số đếm trên thẻ và tổng tiền cũng cũ theo. */
  it("đơn hàng: đọc lại cả danh sách, phép đếm và phép cộng tiền", () => {
    expect((ORDERS_NOW().match(/, focusTick\]\)/g) ?? []).length).toBe(3)
  })

  /**
   * ⚠ `visibilitychange`, KHÔNG `focus`. `focus` bắn cả khi người dùng
   * chỉ bấm vào thanh địa chỉ rồi bấm lại vào trang — mỗi lần là một
   * lượt tải cho một thứ không đổi.
   */
  it("nghe visibilitychange, không nghe focus", () => {
    expect(HOOK).toContain('document.addEventListener("visibilitychange", onChange)')
    expect(code(HOOK)).not.toContain('addEventListener("focus"')
    expect(HOOK).toContain('document.removeEventListener("visibilitychange", onChange)')
  })

  /**
   * ⚠ CHỈ ĐỌC LẠI KHI ĐÃ RỜI ĐI ĐỦ LÂU. Chuyển tab đi rồi về ngay trong
   * một giây là thao tác nhầm, không phải một vòng làm việc — tải lại ở
   * đó chỉ làm danh sách nhấp nháy dưới tay người đang đọc.
   */
  it("bỏ qua lần rời tab quá ngắn", () => {
    expect(HOOK).toContain("Date.now() - hiddenAt >= minAwayMs")
    expect(HOOK).toContain("minAwayMs = 3000")
  })
})

/** Đọc lại tại thời điểm chạy — file đã đổi sau khi module này nạp hằng số. */
function ORDERS_NOW() {
  return read("src/app/(dashboard)/orders/page.tsx")
}
