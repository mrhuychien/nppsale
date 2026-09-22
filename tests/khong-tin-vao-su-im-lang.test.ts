import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { resolve, join } from "node:path"
import { ghiPhaiTrungDong, GHI_BI_TU_CHOI } from "../src/lib/db/must-write"

/**
 * KHÔNG TIN VÀO SỰ IM LẶNG CỦA DATABASE.
 *
 * ⚠ RLS TỪ CHỐI = 0 DÒNG, HTTP 200, `error` NULL. Chính sách RLS không
 *   ném lỗi — nó LỌC. Nên đoạn mã điển hình
 *
 *     const { error } = await sb.from("x").delete().eq("id", id)
 *     if (error) throw error
 *     toast({ title: "Đã xoá" })
 *
 *   báo cho người dùng rằng việc đã xong, trong khi không có gì xảy ra.
 *
 * ⚠ ĐÃ ĐO TRÊN POSTGRES 16 THẬT (22/09/2026):
 *     · NVBH xoá khách hàng:     DELETE trả về 0 dòng, KHÔNG ném lỗi
 *     · CHỦ NPP xoá công nợ thường: 0 dòng, không lỗi, công nợ còn nguyên
 *
 * ⚠ `.throwOnError()` KHÔNG CỨU ĐƯỢC. Nó chỉ ném khi có `error`; 0 dòng
 *   thì vẫn đi qua êm ru. Vài chỗ trong repo từng dựa vào nó.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

describe("ghiPhaiTrungDong — hàm chạy thật", () => {
  const ok = (rows: unknown) => ({ select: async () => ({ data: rows, error: null }) })

  it("đụng được ít nhất một dòng thì đi tiếp", async () => {
    await expect(ghiPhaiTrungDong(ok([{ id: "a" }]))).resolves.toBeUndefined()
  })

  /** ⚠ ĐÂY LÀ CẢ LÝ DO HÀM NÀY TỒN TẠI. */
  it("0 dòng + không lỗi vẫn phải NÉM", async () => {
    await expect(ghiPhaiTrungDong(ok([]))).rejects.toThrow(GHI_BI_TU_CHOI)
  })

  /** PostgREST có lúc trả `null` thay vì mảng rỗng. */
  it("data null cũng là từ chối", async () => {
    await expect(ghiPhaiTrungDong(ok(null))).rejects.toThrow()
  })

  it("lỗi thật thì ném nguyên lỗi ấy, không nuốt", async () => {
    const loi = { code: "23503", message: "still referenced" }
    await expect(
      ghiPhaiTrungDong({ select: async () => ({ data: null, error: loi }) })
    ).rejects.toBe(loi)
  })

  /**
   * ⚠ KHÔNG ĐƯỢC XIN ĐÍCH DANH CỘT `id`, và đây là một lỗi tôi đã gây ra
   *   rồi mới thấy. Bản đầu xin `.select("id")`, PostgREST dựng
   *   `RETURNING id`, và hai bảng trong repo KHÔNG có cột ấy:
   *   `user_permission_overrides` (khoá chính `user_id, permission_key`)
   *   và `user_suppliers` (khoá chính `user_id, supplier_id`).
   *
   *   Đo trên Postgres 16 bằng đúng câu lệnh mã sinh ra:
   *     ERROR: column "id" does not exist
   *
   *   Nặng hơn lỗi nó đi sửa: ở màn Phân quyền phần cấp/thu quyền đã
   *   `upsert` xong mới tới lệnh xoá, nên mỗi lần lưu có "trả về theo
   *   vai trò" là ném GIỮA CHỪNG với một nửa đã ghi.
   *
   * ⚠ CHỐT NÀY GỌI HÀM THẬT VÀ XEM NÓ XIN GÌ, không đọc chữ trong tệp.
   *   Đọc chữ thì một đột biến đổi hằng số ở chỗ khác vẫn đi lọt.
   */
  it("xin về MỌI cột, không xin đích danh `id`", async () => {
    const daXin: string[] = []
    await ghiPhaiTrungDong({
      select: async (cols: string) => {
        daXin.push(cols)
        return { data: [{ user_id: "u", permission_key: "k" }], error: null }
      },
    })
    expect(daXin, "gọi `select` nhiều hơn một lần").toHaveLength(1)
    expect(
      daXin[0],
      "xin đích danh một cột — bảng nào không có cột ấy sẽ ném 42703 SAU khi phần ghi trước đã commit"
    ).toBe("*")
  })

  it("nhận câu riêng khi chỗ gọi muốn nói rõ hơn", async () => {
    await expect(ghiPhaiTrungDong(ok([]), "Không xoá được phiếu này")).rejects.toThrow(
      "Không xoá được phiếu này"
    )
  })
})

/**
 * ⚠ QUÉT CẢ CÂY MÃ, KHÔNG LIỆT KÊ TAY MỘT DANH SÁCH TỆP. Chốt liệt kê
 *   tay thì tệp thứ 27 ra đời là nó không biết — mà đó đúng là cách 26
 *   chỗ này tích lại.
 */
function moiTepNguon(dir: string, out: string[] = []): string[] {
  for (const ten of readdirSync(dir)) {
    const p = join(dir, ten)
    if (statSync(p).isDirectory()) moiTepNguon(p, out)
    else if (/\.tsx?$/.test(ten)) out.push(p)
  }
  return out
}

/**
 * Lệnh xoá mà 0 dòng LÀ BÌNH THƯỜNG — dọn theo cha rồi chèn lại, hoặc
 * xoá hàng loạt theo điều kiện. Ở đó "không có gì để xoá" là một kết
 * quả hợp lệ, ép kiểm là dựng ra lỗi giả.
 *
 * ⚠ DANH SÁCH NÀY LÀ MIỄN TRỪ CÓ TÊN, không phải một cái rổ. Thêm vào
 *   đây phải kèm lý do, và lý do phải là "0 dòng có thể đúng", không
 *   phải "chốt đang đỏ".
 */
const MIEN_TRU: Array<[string, string]> = [
  ["src/lib/purchasing/save-receipt.ts", "dọn sạch dòng của hóa đơn/phiếu trả rồi chèn lại — phiếu chưa có dòng nào là bình thường"],
  ["src/app/(dashboard)/sales/pjp/page.tsx", "dọn lộ trình của một ngày rồi chèn lại — ngày chưa có lộ trình là bình thường"],
  ["src/components/settings/permission-matrix.tsx", "nút Reset xoá mọi tuỳ chỉnh của một người — người chưa có tuỳ chỉnh nào là bình thường"],
  ["src/app/(dashboard)/notifications/page.tsx", "nút Xoá hết đã đọc — không có thông báo đã đọc nào là bình thường"],
  ["src/app/api/admin/users/[id]/qr/route.ts", "chạy bằng khoá service role nên RLS không lọc; 0 dòng nghĩa là chưa từng cấp QR"],
]

describe("mọi lệnh xoá đều kiểm xem có trúng dòng nào không", () => {
  const TEP = moiTepNguon(resolve(ROOT, "src"))

  it("không chỗ nào xoá xong mà không nhìn lại", () => {
    const pham: string[] = []
    for (const p of TEP) {
      const rel = p.slice(ROOT.length + 1)
      const s = code(readFileSync(p, "utf-8"))
      for (const m of Array.from(s.matchAll(/\.delete\(\)/g))) {
        const sau = s.slice(m.index, m.index + 300)
        // Đi qua `ghiPhaiTrungDong(...)` hoặc tự `.select()` rồi kiểm.
        const truoc = s.slice(Math.max(0, m.index - 200), m.index)
        if (truoc.includes("ghiPhaiTrungDong(") || sau.includes(".select(")) continue
        if (MIEN_TRU.some(([t]) => rel === t)) continue
        pham.push(rel)
      }
    }
    expect(
      Array.from(new Set(pham)),
      "xoá xong không kiểm trúng mấy dòng — RLS từ chối sẽ báo THÀNH CÔNG"
    ).toEqual([])
  })

  /**
   * ⚠ MIỄN TRỪ PHẢI CÒN LÝ DO THẬT. Một tệp được miễn trừ mà nay không
   *   còn lệnh xoá nào là miễn trừ chết — để đó thì lần sau ai thêm một
   *   lệnh xoá vào đúng tệp ấy sẽ được cho qua miễn phí.
   */
  it("mọi miễn trừ đều còn trỏ vào một lệnh xoá có thật", () => {
    for (const [t, lyDo] of MIEN_TRU) {
      expect(read(t), `${t} không còn lệnh xoá nào — bỏ miễn trừ đi`).toContain(".delete()")
      expect(lyDo.length, `${t}: miễn trừ không có lý do`).toBeGreaterThan(20)
    }
  })

  /** ⚠ `.throwOnError()` KHÔNG ném khi 0 dòng — đừng ai tưởng nó đủ. */
  it("không lệnh xoá nào còn chỉ dựa vào .throwOnError()", () => {
    const pham: string[] = []
    for (const p of TEP) {
      const s = code(readFileSync(p, "utf-8"))
      for (const m of Array.from(s.matchAll(/\.delete\(\)/g))) {
        const sau = s.slice(m.index, m.index + 300)
        if (sau.includes(".throwOnError()") && !sau.includes(".select(")) {
          pham.push(p.slice(ROOT.length + 1))
        }
      }
    }
    expect(
      Array.from(new Set(pham)),
      ".throwOnError() chỉ ném khi CÓ lỗi; RLS từ chối thì 0 dòng và không lỗi"
    ).toEqual([])
  })
})

describe("xoá công nợ — màn hình gài đúng theo chính sách database", () => {
  const MAN = code(read("src/app/(dashboard)/receivables/[id]/page.tsx"))
  const MIG = read("supabase/migrations/102_opening_balances.sql")

  /**
   * ⚠ DATABASE CHỈ CHO XOÁ SỐ DƯ ĐẦU KỲ. Đây là NGUỒN của luật; chốt
   *   đọc nó ra để nếu ai nới chính sách thì chốt dưới cũng phải đổi
   *   theo chứ không đứng một mình nói một luật đã chết.
   */
  it("chính sách database vẫn chỉ cho xoá công nợ đầu kỳ", () => {
    const i = MIG.indexOf('CREATE POLICY "Accountant can delete opening receivables"')
    expect(i, "không còn chính sách xoá công nợ — chốt đang soi chỗ trống").toBeGreaterThan(-1)
    const khoi = MIG.slice(i, MIG.indexOf(";", i))
    expect(khoi, "chính sách thôi đòi opening_balance").toContain("opening_balance")
  })

  /** ⚠ Màn hình phải ĐỌC được cột ấy thì mới gài theo nó được. */
  it("màn hình nạp cột opening_balance", () => {
    expect(MAN, "không nạp opening_balance — màn hình không thể biết để mà gài").toMatch(
      /\.select\("[^"]*opening_balance/
    )
  })

  /**
   * ⚠ NÚT XOÁ KHÔNG ĐƯỢC RỘNG HƠN CHÍNH SÁCH. Rộng hơn thì chủ NPP bấm,
   *   database lọc mất, app báo "Đã xóa công nợ" và đẩy về danh sách —
   *   công nợ vẫn nằm đó. Đã đo trên Postgres 16.
   */
  it("nút Xoá chỉ hiện cho công nợ đầu kỳ", () => {
    const i = MAN.indexOf("const canDelete")
    expect(i, "không còn phép gài nút Xoá").toBeGreaterThan(-1)
    const gai = MAN.slice(i, MAN.indexOf("\n\n", i))
    expect(gai, "nút Xoá không hỏi công nợ này có phải số dư đầu kỳ không").toMatch(
      /opening_balance|laSoDuDauKy/
    )
    expect(gai, "nút Xoá thôi loại trừ công nợ đã thu một phần").toContain("paid === 0")
  })

  /**
   * ⚠ ẨN NÚT MÀ IM LẶNG CŨNG LÀ MỘT LỖI KHÁC. Chủ NPP đi tìm nút Xoá,
   *   không thấy, và không có gì nói vì sao — họ sẽ nghĩ màn hình hỏng.
   */
  it("nói ra vì sao không xoá được, và lối đi tiếp", () => {
    expect(MAN, "ẩn nút mà không giải thích").toContain("sinh từ hóa đơn")
    expect(MAN, "không chỉ đường nào đi tiếp").toMatch(/huỷ tờ hóa đơn|huỷ hóa đơn/)
  })
})
