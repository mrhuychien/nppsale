import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { explainPostError, warningsFor } from "../src/lib/inventory/post-export"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const MIG = read("supabase/migrations/107_fifo_one_ledger.sql")
const ENTRY = read("src/app/(dashboard)/inventory/entries/[id]/page.tsx")
const LIST = read("src/app/(dashboard)/inventory/entries/page.tsx")
const STOCK_IN = read("src/app/(dashboard)/inventory/stock-in/page.tsx")
const PLAN = read("src/lib/products/opening-stock-plan.ts")

/**
 * Hành vi thật của RPC đã được dựng lại và đo trên PostgreSQL 16 với dữ
 * liệu trồng sẵn (hai lô: lô cũ hạn xa giá 5.000, lô mới hạn gần giá
 * 7.000; xuất 150):
 *
 *   FIFO   → ăn hết lô CŨ trước, giá vốn 850.000 — đúng
 *   FEFO   → ăn lô MỚI trước,    giá vốn 950.000 — sai thứ tự đã chốt
 *   bấm 2 lần → lần hai posted = false, tồn không đổi
 *   thiếu tồn → chặn, tồn giữ nguyên, phiếu vẫn nháp
 *
 * Bộ test dưới đây không chạy được PostgreSQL, nên nó giữ những TÍNH
 * CHẤT mà phép đo ấy phụ thuộc vào. Sửa một trong số đó là con số đo
 * được sẽ khác.
 */
describe("FIFO — một sổ kho duy nhất", () => {
  /**
   * ⚠ TÍNH CHẤT QUAN TRỌNG NHẤT. Đổi cột sắp xếp là đổi hẳn nghiệp vụ:
   * `expires_at` cho ra FEFO, `created_at` cho ra "thứ tự gõ máy" — và
   * với phiếu tồn đầu kỳ ghi lùi ngày thì `created_at` xếp hàng cũ nhất
   * xuống CUỐI, tức FIFO chạy ngược.
   */
  it("xếp lô theo received_at, không phải hạn dùng hay lúc tạo dòng", () => {
    expect(MIG).toContain("ORDER BY received_at ASC, created_at ASC, id ASC")
  })

  /**
   * ⚠ Hai lô cùng mốc mà không có khoá phụ thì Postgres tự chọn thứ tự,
   * và mỗi lần chạy một khác — giá vốn của cùng một phiếu sẽ nhảy.
   */
  it("có khoá phụ để hai lô cùng mốc vẫn có thứ tự cố định", () => {
    const order = MIG.slice(MIG.indexOf("ORDER BY received_at"))
    expect(order.slice(0, 60)).toContain("created_at ASC, id ASC")
  })

  /** ⚠ Không khoá thì hai lượt xuất song song cùng thấy một lô còn hàng. */
  it("khoá lô khi trừ", () => {
    expect(MIG).toContain("FOR UPDATE")
  })

  /**
   * ⚠ Khoá phiếu TRƯỚC khi đọc trạng thái. Đọc rồi mới khoá thì hai lượt
   * chạy song song đều thấy 'draft' và cùng đi tiếp — trừ tồn hai lần.
   */
  it("khoá phiếu trước khi đọc trạng thái", () => {
    const head = MIG.slice(MIG.indexOf("SELECT org_id, status, type"))
    const lock = head.indexOf("FOR UPDATE")
    const check = head.indexOf("IF v_status <> 'draft'")
    expect(lock).toBeGreaterThan(0)
    expect(check).toBeGreaterThan(lock)
  })

  /**
   * ⚠ Lá chắn chống trừ hai lần. Bấm lại là chuyện bình thường (mạng
   * chập, hai người cùng duyệt) — phải trả về "không làm gì", không phải
   * báo lỗi, và tuyệt đối không trừ thêm.
   */
  it("phiếu đã ghi sổ thì không trừ lại", () => {
    expect(MIG).toContain("IF v_status <> 'draft' THEN")
    expect(MIG).toContain("RETURN QUERY SELECT false, 0::numeric, 0::numeric, 0;")
  })

  /** Gọi nhầm vào phiếu nhập thì phải chặn, không âm thầm trừ tồn. */
  it("chặn phiếu không phải phiếu xuất", () => {
    expect(MIG).toContain("NOT_AN_EXPORT")
  })

  /** Phiếu của đơn vị khác thì không đụng tới được. */
  it("chặn phiếu khác đơn vị", () => {
    expect(MIG).toContain("ORG_MISMATCH")
  })

  /**
   * ⚠ Thiếu tồn mà vẫn ghi sổ là làm tồn kho ÂM. Mặc định phải chặn; chỉ
   * đơn vị bật cho phép bán âm mới đi tiếp, và khi đó phải trả về thiếu
   * bao nhiêu chứ không im lặng.
   */
  it("thiếu tồn thì chặn, trừ khi đơn vị cho phép bán âm", () => {
    expect(MIG).toContain("INSUFFICIENT_STOCK")
    expect(MIG).toContain("IF NOT v_allow_oversell THEN")
    expect(MIG).toContain("v_short := v_short + v_remaining")
  })

  /**
   * Cái giá phải trả của FIFO: lô cận hạn có thể nằm lại trong kho, vì lô
   * nhập sau đôi khi có hạn gần hơn lô nhập trước. Không tự đổi thứ tự —
   * thứ tự là việc của người quyết — nhưng phải ĐẾM và nói ra.
   */
  it("đếm số lần bỏ qua lô cận hạn hơn", () => {
    expect(MIG).toContain("v_near := v_near + 1")
    expect(MIG).toContain("near_expiry_skipped")
  })

  /** Giá vốn là bình quân theo lượng lấy từ từng lô, không phải giá lô đầu. */
  it("giá vốn tính bình quân theo lượng thực lấy", () => {
    expect(MIG).toContain("v_cost_sum / v_qty_taken")
  })
})

describe("Sổ thứ hai đã được gỡ", () => {
  /**
   * ⚠ Trước mig 107 có HAI sổ kho: `batches.qty_on_hand` (sổ thật) và
   * `fifo_layers` (chỉ một nhánh ghi, không ai đọc trong mã ứng dụng).
   * View giá trị tồn lại ưu tiên đọc sổ thứ hai — nên đúng những sản phẩm
   * từng đi qua nhánh bàn giao sẽ báo theo cuốn sổ không ai cập nhật.
   */
  it("bỏ bảng và hàm của sổ thứ hai", () => {
    expect(MIG).toContain("DROP TABLE IF EXISTS fifo_layers")
    expect(MIG).toContain("DROP TABLE IF EXISTS fifo_consumptions")
    expect(MIG).toContain("DROP FUNCTION IF EXISTS fifo_consume")
  })

  /** Bỏ bảng mà quên gỡ lệnh ghi là RPC bàn giao nổ lúc tài xế về kho. */
  it("RPC bàn giao thôi ghi sổ thứ hai", () => {
    const fn = MIG.slice(MIG.indexOf("CREATE OR REPLACE FUNCTION confirm_driver_handover"))
    expect(fn).not.toContain("INSERT INTO fifo_layers")
    // Và vẫn phải cộng vào sổ thật.
    expect(fn).toContain("SET qty_on_hand = qty_on_hand + r.qty_in_base_uom")
  })

  /** Không còn mã ứng dụng nào trỏ vào sổ cũ. */
  it("mã ứng dụng không còn nhắc tới fifo_layers", () => {
    expect(existsSync(resolve(ROOT, "src/lib/inventory/fifo.ts"))).toBe(false)
    expect(ENTRY).not.toContain("fifo_layers")
    expect(LIST).not.toContain("fifo_layers")
  })

  /** View giá trị tồn giờ đọc thẳng batches — một chỗ để sai, không phải hai. */
  it("view giá trị tồn đọc thẳng batches", () => {
    // Cắt đúng câu CREATE VIEW. Cắt tới cuối file thì nuốt cả lệnh
    // DROP TABLE fifo_layers ở dưới và phép kiểm thành vô nghĩa.
    const from = MIG.indexOf("CREATE VIEW v_stock_balance_by_zone")
    const view = MIG.slice(from, MIG.indexOf("ALTER VIEW v_stock_balance_by_zone", from))
    expect(view).toContain("FROM batches b")
    expect(view).not.toContain("fifo_layers")
  })

  /**
   * ⚠ Mig 092 bật security_invoker để RLS vẫn áp dụng. DROP + CREATE làm
   * mất thuộc tính đó — bỏ quên là mở toàn bộ số liệu tồn kho cho mọi vai
   * trò mà không có lỗi nào báo ra.
   */
  it("đặt lại security_invoker sau khi dựng lại view", () => {
    expect(MIG).toContain("ALTER VIEW v_stock_balance_by_zone SET (security_invoker = true)")
  })

  /**
   * ⚠ Postgres từ chối ALTER COLUMN TYPE khi còn view đọc cột đó. Phải gỡ
   * view TRƯỚC. (Đúng lỗi migration này vấp lần chạy đầu trên Postgres 16.)
   */
  it("gỡ view trước khi đổi kiểu cột", () => {
    const drop = MIG.indexOf("DROP VIEW IF EXISTS v_stock_balance_by_zone")
    const alter = MIG.indexOf("ALTER COLUMN qty_on_hand TYPE")
    expect(drop).toBeGreaterThan(0)
    expect(drop).toBeLessThan(alter)
  })
})

describe("received_at — khoá thứ tự FIFO", () => {
  /**
   * ⚠ `created_at` là lúc TẠO DÒNG. Phiếu tồn đầu kỳ ghi lùi ngày (chốt
   * sổ 31/12) tạo dòng hôm nay, nên xếp theo created_at thì hàng cũ nhất
   * nằm SAU hàng nhập tuần này — FIFO lấy ngược, và hàng cũ nhất nằm lại
   * trong kho mãi mãi.
   */
  it("bù dữ liệu cũ từ ngày ghi sổ của phiếu nhập, không phải created_at", () => {
    const backfill = MIG.slice(MIG.indexOf("UPDATE batches b"))
    expect(backfill).toContain("SELECT MIN(se.posted_at)")
    expect(backfill).toContain("se.type = 'import'")
  })

  /**
   * ⚠ Lô không có chỗ đứng trong hàng đợi sẽ bị bỏ qua vĩnh viễn và nằm
   * lại trong kho mà không ai hiểu vì sao.
   */
  it("không cho phép rỗng", () => {
    expect(MIG).toContain("ALTER COLUMN received_at SET NOT NULL")
    expect(MIG).toContain("ALTER COLUMN received_at SET DEFAULT now()")
  })

  /** Màn nhập kho và phiếu tồn đầu kỳ đều phải đóng mốc này. */
  it("hai chỗ tạo lô đều ghi received_at", () => {
    expect(STOCK_IN).toContain("received_at: postedAt")
    expect(PLAN).toContain("received_at: postedAt")
  })

  /**
   * ⚠ Phiếu và lô phải dùng CÙNG một mốc. Tính hai lần thì lệch vài mili
   * giây — đủ để thứ tự FIFO không khớp ngày ghi trên phiếu.
   */
  it("phiếu và lô dùng chung một mốc", () => {
    expect(STOCK_IN).toContain("const postedAt = postedAtFor(entryDate, new Date())")
    expect(STOCK_IN).toContain("posted_at: postedAt,")
    expect(PLAN).toContain("const postedAt = postedAtFor(opts.entryDate, opts.now)")
    expect(PLAN).toContain("posted_at: postedAt,")
  })

  /** Số lượng lô phải là numeric: FIFO cắt lô làm đôi, phần dư có thể lẻ. */
  it("số lượng lô là numeric, không phải integer", () => {
    expect(MIG).toContain("ALTER COLUMN qty_on_hand TYPE numeric(18, 6)")
    expect(MIG).toContain("ALTER COLUMN qty_initial TYPE numeric(18, 6)")
  })
})

describe("Mọi nút ghi sổ phiếu xuất đều trừ tồn", () => {
  /**
   * ⚠ SỔ LỖI NPP-01. Trước đây tồn kho chỉ bị trừ ở ĐÚNG MỘT nút ("Tự
   * giao hàng"). Duyệt phiếu ở danh sách chỉ đổi trạng thái — đơn giao
   * qua tài xế đạt "đã giao" mà tồn kho giữ nguyên, giá vốn không được
   * ghi, lãi gộp ra 100%.
   */
  it("nút tự giao hàng gọi RPC", () => {
    expect(ENTRY).toContain("postStockExport(supabase, entry.id)")
  })

  it("duyệt một phiếu ở danh sách cũng gọi RPC", () => {
    const fn = LIST.slice(LIST.indexOf("const handleApprove"), LIST.indexOf("const handleCancel"))
    expect(fn).toContain('e.type === "export"')
    expect(fn).toContain("postStockExport(supabase, e.id)")
  })

  it("duyệt hàng loạt cũng gọi RPC cho phiếu xuất", () => {
    const fn = LIST.slice(LIST.indexOf("const approveBulk"), LIST.indexOf("const cancelBulk"))
    expect(fn).toContain("postStockExport(supabase, id)")
    // Từng phiếu một giao dịch riêng: một phiếu thiếu tồn không kéo đổ cả lô.
    expect(fn).toContain("for (const id of exportIds)")
  })

  /**
   * ⚠ Báo "đã duyệt 5 phiếu" trong khi 2 phiếu trượt là để người ta tưởng
   * hàng đã trừ khỏi kho.
   */
  it("duyệt hàng loạt không nuốt phiếu trượt", () => {
    const fn = LIST.slice(LIST.indexOf("const approveBulk"), LIST.indexOf("const cancelBulk"))
    expect(fn).toContain("failures.push")
    expect(fn).toContain("okCount}/${ids.length}")
  })

  /** Không còn chỗ nào trừ tồn bằng lệnh update rời từ trình duyệt. */
  it("màn phiếu xuất không tự trừ batches nữa", () => {
    expect(ENTRY).not.toContain('.from("batches")')
    expect(ENTRY).not.toContain('status: "posted"')
  })
})

describe("Dịch lỗi cho người dùng", () => {
  it("nói rõ thiếu tồn", () => {
    expect(
      explainPostError('INSUFFICIENT_STOCK: thiếu 150 đơn vị của "Coca 330ml" — ghi sổ...')
    ).toContain("Không đủ tồn: thiếu 150")
  })

  /**
   * ⚠ Mã đã deploy mà migration chưa chạy thì lỗi Postgres trả về là
   * "function does not exist" — người dùng đọc sẽ tưởng phiếu hỏng.
   */
  it("nói đúng việc cần làm khi chưa chạy migration", () => {
    const m = explainPostError('function public.post_stock_export(uuid) does not exist')
    expect(m).toContain("migration 107")
    expect(m).toContain("db push")
  })

  /**
   * ⚠ Lỗi không nhận ra thì trả NGUYÊN VĂN. Nuốt thành một câu chung
   * chung là người dùng đi sửa nhầm chỗ.
   */
  it("lỗi lạ giữ nguyên văn", () => {
    expect(explainPostError("deadlock detected")).toBe("deadlock detected")
  })

  it("ghi sổ sạch thì không có cảnh báo nào", () => {
    expect(warningsFor({ posted: true, totalCost: 100, shortQty: 0, nearExpirySkipped: 0 })).toBeNull()
  })

  it("bán âm và bỏ qua lô cận hạn đều được nói ra", () => {
    const w = warningsFor({ posted: true, totalCost: 0, shortQty: 12, nearExpirySkipped: 3 })!
    expect(w).toContain("Thiếu 12")
    expect(w).toContain("3 lượt")
  })
})
