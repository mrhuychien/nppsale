import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  baseQtyOf, validIssueLines, overIssueProducts, issueReasonLabel, friendlyIssueError,
  ISSUE_REASONS, ISSUE_ZONES, destZonesFor, isTransfer,
  type IssueLine,
} from "../src/lib/inventory/stock-issue"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const stripSql = (s: string) =>
  s.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const MIG_RAW = read("supabase/migrations/144_stock_issue.sql")
const MIG = stripSql(MIG_RAW)
/**
 * ⚠ TÌM `$$;` TỪ SAU CHỖ KHAI HÀM. Migration này có một khối
 * `DO $$ … END $$;` ở mục 1, ĐỨNG TRƯỚC hàm — `indexOf("$$;")` không
 * kèm mốc bắt đầu thì bắt phải khối đó, lát cắt rỗng, và MƯỜI chốt
 * dưới đây đỏ vì một lý do không liên quan. Đã gặp thật.
 */
const FN = (() => {
  const i = MIG.indexOf("CREATE OR REPLACE FUNCTION public.post_stock_issue(")
  expect(i, "không tìm thấy hàm post_stock_issue").toBeGreaterThan(-1)
  const j = MIG.indexOf("$$;", i)
  expect(j, "không tìm thấy phần kết thúc thân hàm").toBeGreaterThan(i)
  return MIG.slice(i, j)
})()
/**
 * VÒNG LẤY LÔ THẬT — chỉ phần này mới quyết định kho bị trừ thế nào.
 *
 * ⚠ BA CHỐT DƯỚI ĐÂY TỪNG NÓI DỐI VÌ THIẾU LÁT CẮT NÀY. Hàm có HAI câu
 * đọc `batches`: một để KIỂM đủ hàng, một để TRỪ thật. Mấy điều kiện
 * `warehouse_zone = v_zone`, `status = 'available'`, `qty_on_hand > 0`
 * xuất hiện ở cả hai, nên gỡ chúng khỏi câu TRỪ mà chốt chỉ tìm chuỗi
 * trong cả hàm thì vẫn xanh — trong khi kho đã bị trừ sai. Đã thử phá
 * đúng như vậy và cả ba đều lọt.
 */
const TAKE = (() => {
  const i = FN.indexOf("FOR v_batch IN")
  expect(i, "không tìm thấy vòng lấy lô").toBeGreaterThan(-1)
  const j = FN.indexOf("END LOOP;", i)
  expect(j).toBeGreaterThan(i)
  return FN.slice(i, j)
})()
const PAGE = strip(read("src/app/(dashboard)/inventory/stock-issue/page.tsx"))
const SIDEBAR = strip(read("src/components/layout/sidebar.tsx"))

const line = (o: Partial<IssueLine> = {}): IssueLine => ({
  id: "l1",
  product_id: "p1",
  product_name: "Bánh hình kẹo 160g",
  sku: "SKU1",
  note: "",
  unit_name: "thùng",
  quantity: "5",
  conversion_factor: "12",
  available_units: [],
  base_unit: "hộp",
  on_hand: 100,
  ...o,
})

// =====================================================================

describe("số lượng của phiếu xuất kho", () => {
  it("quy về đơn vị cơ sở", () => {
    expect(baseQtyOf(line())).toBe(60)
    expect(baseQtyOf(line({ unit_name: "hộp", conversion_factor: "1", quantity: "7" }))).toBe(7)
  })

  /**
   * ⚠ KHÔNG ĐỂ ÂM. Ô có `min={0}` nhưng người dùng DÁN được số âm vào;
   * một dòng âm là CỘNG hàng vào kho qua đường xuất kho.
   */
  it("số âm về 0, không thành phép cộng kho", () => {
    expect(baseQtyOf(line({ quantity: "-5" }))).toBe(0)
    expect(baseQtyOf(line({ quantity: "5", conversion_factor: "-2" }))).toBe(0)
  })

  it("ô trống hoặc rác ra 0, không ra NaN", () => {
    for (const bad of ["", "abc", "--", undefined as unknown as string]) {
      expect(Number.isNaN(baseQtyOf(line({ quantity: bad })))).toBe(false)
      expect(Number.isNaN(baseQtyOf(line({ conversion_factor: bad })))).toBe(false)
    }
    expect(baseQtyOf(line({ quantity: "" }))).toBe(0)
  })

  it("bỏ dòng chưa chọn hàng và dòng số lượng 0", () => {
    const out = validIssueLines([
      line({ id: "ok" }),
      line({ id: "chưa chọn", product_id: "" }),
      line({ id: "không số", quantity: "0" }),
    ])
    expect(out.map((l) => l.id)).toEqual(["ok"])
  })
})

/**
 * CẢNH BÁO VƯỢT TỒN PHẢI GOM Y HỆT MÁY CHỦ.
 *
 * ⚠ `post_stock_issue` GOM THEO MẶT HÀNG trước khi kiểm. Màn hình xét
 * từng dòng riêng là nói "đủ" rồi máy chủ trả về lỗi cho cùng một
 * phiếu — người dùng không hiểu vì sao.
 */
describe("cảnh báo vượt tồn gom theo mặt hàng", () => {
  it("hai dòng cùng mã: mỗi dòng vừa, cộng lại thì vượt", () => {
    const over = overIssueProducts([
      line({ id: "a", quantity: "5", conversion_factor: "12", on_hand: 100 }),
      line({ id: "b", quantity: "5", conversion_factor: "12", on_hand: 100 }),
    ])
    expect(over, "không gom hai dòng cùng mã lại").toHaveLength(1)
    expect(over[0].need).toBe(120)
    expect(over[0].onHand).toBe(100)
  })

  it("hai mã khác nhau thì xét riêng", () => {
    const over = overIssueProducts([
      line({ id: "a", product_id: "p1", quantity: "5", conversion_factor: "12", on_hand: 100 }),
      line({ id: "b", product_id: "p2", quantity: "5", conversion_factor: "12", on_hand: 100 }),
    ])
    expect(over).toHaveLength(0)
  })

  it("đủ hàng thì im", () => {
    expect(overIssueProducts([line({ quantity: "1", conversion_factor: "12", on_hand: 100 })])).toEqual([])
  })

  /**
   * ⚠ CHƯA TRA TỒN THÌ KHÔNG KẾT LUẬN. Báo "vượt tồn" khi chưa biết là
   * kêu oan, và người dùng học được cách bỏ qua cảnh báo — rồi lần nó
   * kêu thật thì không ai nhìn.
   */
  it("chưa tra xong tồn thì không kết luận gì", () => {
    expect(overIssueProducts([line({ quantity: "999", on_hand: null })])).toEqual([])
  })
})

describe("nhãn và lỗi", () => {
  it("mọi lý do xuất có nhãn riêng", () => {
    const labels = ISSUE_REASONS.map((r) => r.label)
    expect(new Set(labels).size).toBe(ISSUE_REASONS.length)
    expect(ISSUE_ZONES.map((z) => z.value)).toEqual(["sale", "date"])
  })

  /** ⚠ Mã lạ in nguyên mã; trống thì "chưa xác định", không phải dấu gạch. */
  it("lý do lạ in nguyên mã, trống thì nói là chưa xác định", () => {
    expect(issueReasonLabel("ai_do_them")).toBe("ai_do_them")
    expect(issueReasonLabel(null)).toBe("chưa xác định")
    expect(issueReasonLabel("damaged")).toBe("Hàng hỏng / vỡ")
  })

  it("lỗi của RPC cắt mã, giữ nguyên phần liệt kê", () => {
    expect(friendlyIssueError("KHONG_DU_TON: Bánh — cần 140, kho còn 120.")).toBe(
      "Bánh — cần 140, kho còn 120."
    )
    expect(friendlyIssueError("lỗi mạng")).toBe("lỗi mạng")
  })
})

// =====================================================================

describe("144 — post_stock_issue", () => {
  /**
   * ⚠ GOM THEO MẶT HÀNG TRƯỚC KHI KIỂM. Người dùng lỡ thêm cùng một mã
   * thành hai dòng thì mỗi dòng tự thấy "đủ hàng" trong khi tổng thì
   * không, và kho xuống âm. Đã kiểm trên Postgres: tồn 120, hai dòng 70
   * + 70 bị từ chối đúng.
   */
  it("kiểm đủ hàng theo TỔNG các dòng cùng mã", () => {
    expect(FN).toContain("GROUP BY sel.product_id")
    expect(FN).toContain("SUM(sel.qty_in_base_uom) AS need")
    expect(FN).toContain("KHONG_DU_TON")
  })

  /**
   * ⚠ KIỂM TRỌN VẸN TRƯỚC KHI TRỪ MỘT ĐƠN VỊ NÀO. Trừ dần rồi mới phát
   * hiện thiếu ở mặt hàng thứ năm thì thông báo lỗi chỉ nói được về một
   * mặt hàng.
   */
  it("lượt kiểm đứng TRƯỚC lượt trừ", () => {
    const checkAt = FN.indexOf("IF v_avail < r.need THEN")
    const takeAt = FN.indexOf("UPDATE batches SET qty_on_hand = qty_on_hand - v_take")
    expect(checkAt, "không còn lượt kiểm").toBeGreaterThan(0)
    expect(takeAt, "không còn lượt trừ").toBeGreaterThan(0)
    expect(takeAt, "đang trừ trước khi kiểm").toBeGreaterThan(checkAt)
  })

  /**
   * ⚠ VẾT LẤY LÔ LÀ THỨ LÀM CHO PHIẾU HUỶ ĐƯỢC. `cancel_stock_entry`
   * (migration 139) TỪ CHỐI huỷ phiếu xuất không có vết — chính nó báo
   * "6 phiếu xuất KHÔNG có vết lấy lô" lúc chạy. Phiếu mới mà không ghi
   * vết là đẻ thêm đúng loại phiếu không huỷ được ấy.
   */
  it("ghi vết lấy lô, và gắn vào đúng DÒNG", () => {
    expect(FN).toContain("INSERT INTO stock_line_consumptions")
    // ⚠ Bảng khoá theo `line_id`, KHÔNG theo `entry_id` — gom rồi ghi
    //   vết là không có `line_id` để ghi.
    expect(FN).toContain("(line_id, batch_id, qty_in_base_uom, unit_cost)")
    expect(FN).toContain("sel.id AS line_id")
  })

  /** ⚠ FIFO trong ĐÚNG một zone, và thứ tự phải ỔN ĐỊNH. */
  it("FIFO trong đúng một kho, thứ tự ổn định", () => {
    expect(TAKE, "vòng trừ đang lấy tràn sang kho kia").toContain("AND warehouse_zone = v_zone")
    expect(TAKE).toContain("ORDER BY expires_at NULLS LAST, created_at, id")
    /* ⚠ KHOÁ LÔ TRONG LÚC TRỪ. Không khoá là hai phiếu chạy cùng lúc
       cùng đọc một lô còn 10 rồi cùng trừ 10 — kho xuống −10. */
    expect(TAKE, "vòng trừ không khoá lô").toContain("FOR UPDATE")
  })

  it("chỉ lấy lô còn mở và còn hàng", () => {
    expect(TAKE, "vòng trừ đang lấy cả lô đã đóng")
      .toContain("COALESCE(status, 'available') = 'available'")
    expect(TAKE).toContain("qty_on_hand > 0")
  })

  /** ⚠ Bấm hai lần không được trừ kho hai lần. */
  it("idempotent: phiếu đã ghi sổ thì trả về ngay", () => {
    const guard = FN.slice(FN.indexOf("IF v_status = 'posted'"))
    expect(guard.slice(0, 120)).toContain("RETURN p_entry_id")
  })

  it("chỉ nhận phiếu xuất còn tạm, và phiếu rỗng thì từ chối", () => {
    expect(FN).toContain("SAI_LOAI_PHIEU")
    expect(FN).toContain("PHIEU_KHONG_CON_TAM")
    expect(FN).toContain("PHIEU_KHONG_CO_HANG")
  })

  /**
   * ⚠ CHỐT CHẶN DỰ PHÒNG SAU LƯỢT TRỪ. Lượt một đã kiểm đủ, nhưng một
   * giao dịch khác có thể vừa lấy mất hàng giữa hai lượt. Thà nổ còn
   * hơn ghi sổ một phiếu xuất thiếu trong im lặng.
   */
  it("còn thiếu sau khi trừ thì nổ, không ghi sổ thiếu trong im lặng", () => {
    const tail = FN.slice(FN.indexOf("INSERT INTO stock_line_consumptions"))
    expect(tail).toContain("IF v_need > 0 THEN")
    expect(tail).toContain("RAISE EXCEPTION")
  })

  it("SECURITY DEFINER, khoá search_path, REVOKE rồi mới GRANT", () => {
    expect(FN).toContain("SECURITY DEFINER")
    expect(FN).toContain("SET search_path = public")
    const rev = MIG.indexOf("REVOKE EXECUTE ON FUNCTION public.post_stock_issue(")
    const grant = MIG.indexOf("GRANT EXECUTE ON FUNCTION public.post_stock_issue(")
    expect(rev).toBeGreaterThan(0)
    expect(rev).toBeLessThan(grant)
    expect(MIG).not.toMatch(/GRANT EXECUTE[^\n]*\bTO\b[^\n]*\banon\b/)
  })

  it("kiểm org của người gọi", () => {
    expect(FN).toContain("public.user_org_id()")
    expect(FN).toContain("SAI_DON_VI")
  })

  it("mọi RAISE đều P0001 và mở đầu bằng mã", () => {
    const raises = Array.from(MIG.matchAll(/RAISE EXCEPTION\s*\n?\s*'([^']+)'/g)).map((m) => m[1])
    expect(raises.length).toBeGreaterThan(4)
    for (const r of raises) expect(r, `câu lỗi không mở đầu bằng mã: ${r}`).toMatch(/^[A-Z_]+: /)
    expect(MIG.match(/RAISE EXCEPTION/g)?.length).toBe(MIG.match(/ERRCODE = 'P0001'/g)?.length)
  })

  it("kết thúc bằng NOTIFY để PostgREST nạp lại lược đồ", () => {
    expect(MIG_RAW.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true)
  })
})

// =====================================================================

describe("màn Phiếu xuất kho", () => {
  /**
   * ⚠ MÀN HÌNH KHÔNG TỰ TRỪ KHO. Trừ ở trình duyệt là đúng cái lỗi mà
   * cả module này sinh ra để dọn — không transaction, không FIFO, không
   * vết lấy lô.
   */
  it("không tự trừ kho, chỉ ghi phiếu rồi gọi RPC", () => {
    expect(PAGE).toContain('post_stock_transfer" : "post_stock_issue"')
    expect(PAGE, "đang tự trừ kho từ trình duyệt").not.toMatch(
      /\.from\("batches"\)[\s\S]{0,120}\.update\(/
    )
    expect(PAGE, "đang tự ghi vết lấy lô").not.toContain('.from("stock_line_consumptions")')
  })

  /**
   * ⚠ RLS TỪ CHỐI = 0 DÒNG, HTTP 200, `error` null. Không đếm là một
   * phiếu KHÔNG CÓ DÒNG NÀO được báo "đã lưu".
   */
  it("ghi dòng hàng có select rồi đếm", () => {
    expect(PAGE).toContain('.select("id")')
    expect(PAGE).toContain("ins.length === 0")
    expect(PAGE).toContain("không có quyền")
  })

  /** ⚠ Chưa tra xong thì nói là chưa biết — 0 đọc như "hết hàng". */
  it("chưa tra xong tồn thì hiện dấu ba chấm, không hiện 0", () => {
    expect(PAGE).toContain("on_hand: null")
    expect(PAGE).toContain('l.on_hand === null ? "…"')
  })

  /**
   * ⚠ ĐỔI KHO PHẢI TRA LẠI TỒN CỦA MỌI DÒNG. Giữ số cũ là hiện tồn của
   * kho KIA — người dùng đọc một con số đúng cho một kho họ không còn
   * chọn nữa.
   */
  it("đổi kho thì xoá và tra lại tồn mọi dòng", () => {
    const fn = PAGE.slice(PAGE.indexOf("const changeZone"), PAGE.indexOf("const pickUnit"))
    expect(fn).toContain("on_hand: null")
    expect(fn).toContain("fetchOnHand(l.product_id, z)")
  })

  /** Chỉ tra lô còn mở, đúng zone — khớp với phép lấy lô của RPC. */
  it("tra tồn chỉ đếm lô còn mở trong đúng kho", () => {
    const fn = PAGE.slice(PAGE.indexOf("const fetchOnHand"), PAGE.indexOf("const addProduct"))
    expect(fn).toContain('.eq("warehouse_zone", z)')
    expect(fn).toContain('.eq("status", "available")')
  })

  it("cảnh báo vượt tồn dùng đúng phép gom của máy chủ", () => {
    expect(PAGE).toContain("overIssueProducts(lines)")
    expect(PAGE).toContain("over.length > 0")
  })
})

describe("menu: Phiếu xuất kho ở nhóm Kho vận", () => {
  const group = (name: string) => {
    const i = SIDEBAR.indexOf(`label: "${name}"`)
    expect(i, `không tìm thấy nhóm ${name}`).toBeGreaterThan(-1)
    return SIDEBAR.slice(i, SIDEBAR.indexOf("  {\n    label:", i + 10))
  }

  /**
   * ⚠ KHÔNG CÒN LÀ MỘT MỤC MENU (chủ nhà chốt 20/09/2026: "Bỏ phiếu
   * nhập kho, phiếu xuất kho → Thành Phiếu kho"). Cửa vào nay là nút
   * "Tạo phiếu → Xuất kho" ở màn Phiếu kho.
   *
   * ⚠ NHƯNG CỬA VÀO PHẢI CÓ THẬT. Gỡ mục menu mà quên nút là màn xuất
   * kho lẻ biến mất khỏi ứng dụng — vẫn còn trong mã, không ai tới
   * được. Chốt này đi tìm đúng cái nút ấy.
   */
  it("vào được từ nút Tạo phiếu ở màn Phiếu kho, không còn là mục menu", () => {
    const ENTRIES = readFileSync(
      resolve(__dirname, "..", "src/app/(dashboard)/inventory/entries/page.tsx"),
      "utf-8"
    )
    expect(ENTRIES, "màn Phiếu kho không có nút tạo phiếu xuất kho")
      .toContain('router.push("/inventory/stock-issue")')
    expect(group("Kho vận"), "menu phải gom về một mục Phiếu kho")
      .toContain('href: "/inventory/entries"')
  })

  it("không lạc sang nhóm Mua hàng", () => {
    expect(group("Mua hàng")).not.toContain('href: "/inventory/stock-issue"')
  })
})

// =====================================================================

/**
 * CHUYỂN KHO — PHIẾU XUẤT KHO LÀM LUÔN VIỆC ĐỔI CHỖ GIỮA HAI KHO.
 *
 * ⚠ CHỦ NHÀ CHỐT 20/09/2026: "Tích hợp thêm chuyển kho vào phiếu xuất
 * kho (VD chuyển từ kho hàng bán sang hàng date)".
 */
describe("chuyển kho", () => {
  const MIG148 = readFileSync(
    resolve(__dirname, "..", "supabase/migrations/148_stock_transfer.sql"),
    "utf-8"
  )
  const SQL148 = MIG148.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
  /**
   * ⚠ BỎ CẢ CHÚ THÍCH KHỐI khi cần soi CODE. Bản đầu của chốt
   * "received_at" bắt trúng chính câu chú thích giải thích vì sao KHÔNG
   * đặt `now()` — chốt đọc văn xuôi rồi kết tội đoạn mã đang làm đúng.
   */
  const CODE148 = SQL148.replace(/\/\*[\s\S]*?\*\//g, "")

  /**
   * ⚠ CHUYỂN KHO KHÔNG PHẢI PHIẾU XUẤT. Xuất lẻ làm tổng tồn GIẢM;
   * chuyển kho chỉ ĐỔI CHỖ. Ghi chuyển kho bằng `type = 'export'` là
   * khai mất hàng, và báo cáo hao hụt phình lên bằng đúng lượng hàng
   * vẫn còn nguyên trong kho.
   */
  it("ghi xuống là loại transfer, không phải export", () => {
    expect(PAGE).toContain('type: transfer ? "transfer" : "export"')
    expect(PAGE).toContain("dest_warehouse_zone: transfer ? destZone : null")
  })

  /** ⚠ Hai RPC khác nhau — `post_stock_issue` chỉ TRỪ, không cộng đâu cả. */
  it("gọi đúng RPC theo loại phiếu", () => {
    expect(PAGE).toContain('transfer ? "post_stock_transfer" : "post_stock_issue"')
  })

  /**
   * ⚠ KHÔNG CHO CHỌN KHO ĐÍCH TRÙNG KHO NGUỒN, và luật ấy nằm ở MỘT
   * chỗ (`destZonesFor`). Để người dùng chọn được rồi mới báo lỗi là
   * bắt họ đi một vòng cho một thứ màn hình biết trước.
   */
  it("kho đích không bao giờ trùng kho nguồn", () => {
    expect(destZonesFor("sale").map((z) => z.value)).toEqual(["date"])
    expect(destZonesFor("date").map((z) => z.value)).toEqual(["sale"])
    expect(PAGE).toContain("destZonesFor(zone).map(")
    /* Đổi kho nguồn thì kéo kho đích theo. */
    expect(PAGE).toContain("if (destZone === z) setDestZone(destZonesFor(z)")
  })

  /** ⚠ Ô kho đích chỉ hiện khi chọn Chuyển kho — không thì nó vô nghĩa. */
  it("ô kho đích chỉ hiện với phiếu chuyển kho", () => {
    expect(PAGE).toContain("{transfer && (")
    expect(PAGE).toContain("Chuyển SANG kho *")
  })

  it("nhận ra lý do chuyển kho bằng một hàm, không so chuỗi rải rác", () => {
    expect(isTransfer("transfer")).toBe(true)
    expect(isTransfer("damaged")).toBe(false)
    expect(isTransfer(null)).toBe(false)
    expect(isTransfer(undefined)).toBe(false)
    expect(PAGE, "đang so chuỗi tay thay vì dùng isTransfer")
      .not.toContain('reason === "transfer"')
  })

  // ---- migration 148 -------------------------------------------------

  /**
   * ⚠ LÔ PHẢI GIỮ NGUYÊN HẠN DÙNG VÀ GIÁ VỐN khi sang kho mới.
   * Xuất-rồi-nhập là khai một lô MỚI với hạn do người gõ đặt — FIFO sau
   * đó lấy sai thứ tự, và giá vốn mọi báo cáo lãi lỗ lệch đi.
   */
  it("lô sang kho mới giữ nguyên hạn dùng, giá vốn và ngày nhận", () => {
    expect(SQL148).toContain("v_batch.expires_at")
    expect(SQL148).toContain("v_batch.unit_cost")
    expect(SQL148, "đặt lại received_at là nói dối FIFO")
      .toContain("v_batch.received_at")
    expect(CODE148, "đang đặt received_at = now() cho lô chuyển sang")
      .not.toMatch(/received_at[^,)]*now\(\)/)
  })

  /**
   * ⚠ GỘP LÔ PHẢI KHOÁ CẢ `unit_cost`. Thiếu nó là trộn hai lô mua ở
   * hai giá thành một, và giá vốn của cả cụm sai từ đó trở đi.
   */
  it("gộp vào lô cùng danh tính, khoá gộp có cả giá vốn", () => {
    for (const col of ["batch_code", "expires_at", "unit_cost"]) {
      expect(SQL148, `khoá gộp lô thiếu ${col}`).toContain(`${col} IS NOT DISTINCT FROM`)
    }
  })

  /**
   * ⚠ CÁI BẪY NẶNG NHẤT. Trigger `trg_batches_auto_zone_ins` (mig 028)
   * chạy BEFORE INSERT trên `batches` và tự đẩy mọi lô cận hạn về kho
   * `date`. Một phiếu "chuyển sang kho bán" sẽ lặng lẽ đáp xuống đúng
   * kho date — không lỗi, không cảnh báo. Hàm phải TỪ CHỐI, không lách.
   */
  it("từ chối đưa hàng gần hạn vào kho bán, thay vì lặng lẽ đáp nhầm kho", () => {
    expect(SQL148).toContain("HANG_GAN_HAN")
    expect(SQL148).toContain("date_warehouse_threshold_days")
    /* ⚠ KHÔNG ĐƯỢC LÁCH TRIGGER. Một câu UPDATE warehouse_zone ngay sau
       INSERT là gỡ đúng chốt an toàn mà mig 028 và 138 dựng lên. */
    expect(
      SQL148,
      "đang lách trigger phân kho bằng một câu UPDATE warehouse_zone sau INSERT"
    ).not.toMatch(/UPDATE batches\s+SET warehouse_zone/)
  })

  /** ⚠ Ghi sổ hai lần không được chuyển hàng hai lần. */
  it("idempotent và từ chối phiếu không phải chuyển kho", () => {
    expect(SQL148).toContain("IF v_status = 'posted' THEN")
    expect(SQL148).toContain("SAI_LOAI_PHIEU")
    expect(SQL148).toContain("TRUNG_KHO")
    expect(SQL148).toContain("THIEU_KHO_DICH")
  })

  /** ⚠ Kiểm đủ tồn TRƯỚC khi chuyển một đơn vị nào, và gom theo mặt hàng. */
  it("kiểm đủ tồn trước, gom theo mặt hàng", () => {
    const check = SQL148.slice(
      SQL148.indexOf("GROUP BY sel.product_id"),
      SQL148.indexOf("LƯỢT HAI")
    )
    expect(check).toContain("KHONG_DU_TON")
    expect(check.length, "không tìm thấy lượt kiểm tồn").toBeGreaterThan(50)
  })

  /** ⚠ Vết lấy lô — thứ trả lời được "hàng này đi từ lô nào". */
  it("ghi vết lấy lô", () => {
    expect(SQL148).toContain("INSERT INTO stock_line_consumptions")
  })

  it("dọn quyền và nạp lại lược đồ", () => {
    expect(SQL148).toContain("REVOKE EXECUTE ON FUNCTION public.post_stock_transfer(uuid) FROM PUBLIC")
    expect(SQL148).toContain("GRANT EXECUTE ON FUNCTION public.post_stock_transfer(uuid) TO authenticated")
    expect(SQL148).toContain("NOTIFY pgrst, 'reload schema'")
  })
})
