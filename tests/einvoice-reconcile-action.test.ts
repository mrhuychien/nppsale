import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Thao tác tay trên màn hình đối soát: nối / gỡ nối / dựng hoá đơn.
 *
 * Route cần Supabase + MISA thật nên đây là test đọc mã. Chúng chặn được
 * việc gỡ mất một chốt chặn; chúng không thay được một lần chạy thật.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const strip = (s: string) =>
  s.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")

const ACTION = read("src/app/api/einvoice/reconcile-action/route.ts")
const CODE = strip(ACTION)
const PAGE = read("src/app/(dashboard)/invoices/reconcile/page.tsx")
const PAGE_CODE = strip(PAGE)

function diagnostic(namePart: string): string {
  const dir = resolve(ROOT, "supabase/diagnostics")
  const hit = readdirSync(dir).find((f) => f.includes(namePart))
  if (!hit) throw new Error(`không tìm thấy file chẩn đoán chứa "${namePart}"`)
  return readFileSync(resolve(dir, hit), "utf-8")
}

/** Cắt thân một hàm theo tên, tới `\n}` ở cột 0. */
function fnBody(src: string, name: string): string {
  const i = src.indexOf(`function ${name}(`)
  if (i < 0) throw new Error(`không thấy hàm ${name}`)
  const end = src.indexOf("\n}", i)
  return src.slice(i, end < 0 ? undefined : end)
}

describe("⚠ quyền — admin client bỏ qua RLS nên phải TỰ kiểm", () => {
  /**
   * Route này ghi bằng admin client (cần đọc chéo bảng và giải mã cấu
   * hình), mà admin client bỏ qua RLS. Không tự kiểm vai trò là mở cho
   * mọi người đăng nhập sửa đối soát hoá đơn thuế.
   */
  it("kiểm vai trò owner/accountant/manager", () => {
    expect(CODE).toContain('["owner", "accountant", "manager"].includes(profile.role)')
  })

  /** Người bấm — không phải cron — nên phải là phiên đăng nhập. */
  it("xác thực bằng phiên người dùng, không phải CRON_SECRET", () => {
    expect(CODE).toContain("createServerSupabaseClient")
    expect(CODE).toContain("auth.getUser")
    expect(CODE).not.toContain("CRON_SECRET")
  })

  /** Mọi truy vấn phải chặn theo org — admin client không tự chặn. */
  it("snapshot và hoá đơn đều lọc theo org_id", () => {
    expect(CODE).toMatch(/from\("misa_invoice_snapshots"\)[\s\S]{0,200}?\.eq\("org_id", orgId\)/)
    expect(CODE).toMatch(/from\("invoices"\)[\s\S]{0,200}?\.eq\("org_id", orgId\)/)
  })
})

describe("⚠ chốt tay phải sống sót qua mọi lượt quét", () => {
  /**
   * Vòng khớp tự động bỏ qua `match_method = 'manual'`. Nếu thao tác tay
   * KHÔNG đặt cờ đó thì lượt kéo kế tiếp ghi đè lên, lặng lẽ — công của
   * người bị xoá mỗi đêm.
   */
  it("nối tay và dựng hoá đơn đều đặt match_method = 'manual'", () => {
    expect(fnBody(CODE, "link")).toContain('match_method: "manual"')
    expect(fnBody(CODE, "createFromSnapshot")).toContain('match_method: "manual"')
  })

  /** Gỡ nối phải TRẢ về null để vòng tự động nhận lại dòng này. */
  it("gỡ nối xoá cờ manual", () => {
    const body = fnBody(CODE, "unlink")
    expect(body).toContain("match_method: null")
    expect(body).toContain("invoice_id: null")
  })
})

describe("⚠ nối tay — ba chốt chặn", () => {
  const body = fnBody(CODE, "link")

  it("hoá đơn phải cùng org", () => {
    expect(body).toContain('.eq("org_id", orgId)')
  })

  /**
   * ⚠ Hai hoá đơn MISA cùng trỏ về một hoá đơn trong sổ = một lần bán bị
   * kê hai lần. Phải CHẶN, và phải nói rõ tờ nào đang giữ.
   */
  it("chặn khi hoá đơn đã bị snapshot khác chiếm, và nêu tên tờ đó", () => {
    expect(body).toContain('.eq("invoice_id", invoiceId)')
    expect(body).toContain('.neq("id", snap.id)')
    expect(body).toContain("409")
    expect(body).toMatch(/taken\.inv_series/)
  })

  /**
   * Lệch số là CẢNH BÁO chứ không chặn — hoá đơn thay thế mang số mới nên
   * lệch có thể đúng. Nhưng KHÔNG được im: phải ghi vào ghi chú và nâng
   * lên "cần review".
   */
  it("lệch số/ký hiệu thì cảnh báo, không nuốt", () => {
    expect(body).toContain("warnings.push")
    expect(body).toMatch(/match_status: warnings\.length \? "needs_review" : "matched"/)
  })

  /** So qua bản chuẩn hoá — '00012345' và '12345' là cùng một số. */
  it("so số qua bản chuẩn hoá, không so thẳng chuỗi", () => {
    expect(body).toContain("sameInvNo(inv.misa_inv_no, snapNo)")
    expect(body).toContain("sameSeries(inv.misa_inv_series, snapSeries)")
  })

  it("giao diện hiện cảnh báo chứ không báo 'Xong'", () => {
    expect(PAGE_CODE).toContain("data.warnings")
    expect(PAGE_CODE).toContain("có điểm cần xem lại")
  })
})

describe("⚠ dựng hoá đơn từ snapshot 'chỉ có trên MISA'", () => {
  const body = fnBody(CODE, "createFromSnapshot")

  /**
   * ⚠ Endpoint DANH SÁCH không tách thuế (trả 0.0). Dựng hoá đơn từ số
   * liệu đó là ghi sổ với thuế = 0. Phải lấy từ endpoint CHI TIẾT.
   */
  it("lấy tiền từ endpoint chi tiết, không từ snapshot", () => {
    expect(body).toContain("getInvoiceByRefId(misaConfig, refId)")
    expect(body).toContain("readSnapshot(raw)")
  })

  /** Không lấy được chi tiết thì DỪNG, không dựng nửa vời. */
  it("MISA không trả chi tiết ⇒ KHÔNG dựng", () => {
    expect(body).toMatch(/if \(!raw\)/)
    expect(body).toContain("KHÔNG dựng hoá đơn với số liệu thiếu")
    expect(body).toMatch(/if \(detail\.totalAmount == null\)/)
  })

  /**
   * Giả định nghiệp vụ 1: không đoán đơn hàng. Máy không biết hoá đơn
   * phát hành thẳng trên MISA thuộc đơn nào — gắn bừa là gắn sai.
   */
  it("không gắn đơn hàng, và nói rõ trong ghi chú", () => {
    expect(body).toContain("order_id: null")
    expect(body).toContain("chưa gắn đơn hàng")
  })

  /**
   * Giả định nghiệp vụ 2: kỳ ghi nhận theo NGÀY PHÁT HÀNH trên MISA, không
   * phải hôm nay. Đây là ngày quyết định kỳ thuế.
   */
  it("kỳ ghi nhận theo InvDate của MISA", () => {
    expect(body).toMatch(/issued_at: invDate \? `\$\{invDate\}T00:00:00\+07:00`/)
    expect(body).toContain("theo ngày phát hành trên MISA")
  })

  it("không dựng đè lên dòng đã nối", () => {
    expect(body).toMatch(/if \(snap\.invoice_id\)/)
    expect(body).toContain("409")
  })

  /**
   * ⚠ Chỉ mục duy nhất (org, ký hiệu, số) là chốt chặn cuối. Trả nguyên
   * lỗi Postgres cho người dùng là vô nghĩa — phải dịch thành việc họ cần
   * làm.
   */
  it("trùng số thì chỉ đường sang 'nối tay', không xả lỗi DB", () => {
    expect(body).toContain("uq_invoices_misa_inv_no")
    expect(body).toContain("Nối tay")
  })

  /**
   * ⚠ Hoá đơn ĐÃ tạo mà cập nhật dòng đối soát hỏng: im lặng ở đây là để
   * người bấm lại và tạo hoá đơn TRÙNG.
   */
  it("tạo xong nhưng nối hỏng ⇒ nói rõ đừng bấm lại", () => {
    expect(body).toMatch(/if \(linkErr\)/)
    expect(body).toContain("ĐỪNG bấm lại")
    expect(body).toContain("invoice_id: created.id")
  })

  /** Trạng thái MISA suy bằng module dùng chung, không tự viết lại. */
  it("dùng deriveState chứ không tự suy trạng thái", () => {
    expect(body).toContain("deriveState({")
    expect(CODE).not.toMatch(/publishStatus >= 1/)
  })
})

describe("giao diện đối soát — thao tác hiện đúng chỗ", () => {
  it("chỉ rổ 'chỉ có trên MISA' mới có nút dựng hoá đơn", () => {
    expect(PAGE_CODE).toMatch(/r\.match_status === "misa_only" &&[\s\S]{0,500}?Dựng hoá đơn/)
  })

  it("dòng đã nối thì hiện gỡ nối, chưa nối thì hiện nối tay", () => {
    expect(PAGE_CODE).toMatch(/r\.invoice_id \?[\s\S]{0,400}?Gỡ nối/)
    expect(PAGE_CODE).toContain("Nối tay")
  })

  /** Dựng hoá đơn là tạo dữ liệu kế toán — phải hỏi lại, nêu rõ giả định. */
  it("dựng hoá đơn có hộp xác nhận nêu hai giả định", () => {
    const i = PAGE_CODE.indexOf('title="Dựng hoá đơn trong sổ"')
    expect(i).toBeGreaterThan(0)
    const dlg = PAGE_CODE.slice(i, i + 900)
    expect(dlg).toContain("CHƯA gắn đơn hàng")
    expect(dlg).toContain("không phải hôm nay")
  })
})

describe("chẩn đoán enum chưa biết nghĩa", () => {
  const DIAG = diagnostic("einvoice_unknown_enums")

  /**
   * Mã không đoán khi gặp giá trị lạ — nó ghi giá trị thô vào ghi chú.
   * Nhưng nếu không ai đọc những ghi chú ấy thì cái chưa biết vẫn mãi
   * chưa biết. File này là đường để đo.
   */
  it("bắt đúng giá trị NGOÀI tập đã xác minh", () => {
    expect(DIAG).toContain("NOT IN (1, 3, 4, 7, 8)")
    expect(DIAG).toContain("NOT IN (0, 3)")
  })

  it("in kèm hoá đơn mẫu để mở trên MISA đối chiếu", () => {
    expect(DIAG).toContain("hoa_don_mau")
    expect(DIAG).toContain("ref_id_mau")
  })

  /** Manh mối mạnh nhất cho PublishStatus lạ: có kèm mã CQT hay không. */
  it("đếm số tờ có mã CQT cho mỗi PublishStatus lạ", () => {
    expect(DIAG).toContain("FILTER (WHERE s.invoice_code IS NOT NULL)")
  })

  /** Tên field huỷ đã xác minh, nhưng vẫn phải đo lại trên tài khoản này. */
  it("đo xem field huỷ nào thật sự kích hoạt", () => {
    expect(DIAG).toContain("IsInvoiceDeleted")
    expect(DIAG).toContain("field_da_kich_hoat")
  })

  it("chỉ đọc — không có lệnh ghi nào", () => {
    expect(DIAG).not.toMatch(/\b(UPDATE|DELETE|INSERT|ALTER|DROP|TRUNCATE)\b/)
  })
})
