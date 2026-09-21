import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve, join } from "node:path"

/**
 * MIGRATION SAU KHÔNG ĐƯỢC ÂM THẦM XOÁ MIẾNG VÁ CỦA MIGRATION TRƯỚC.
 *
 * ⚠ CHỦ NHÀ BÁO 21/09/2026: "tại sao sửa hoá đơn lại ra 1 số hoá đơn
 * mới chứ ko phải bản cập nhật dạng -1 -2 như cũ".
 *
 * CHUYỆN ĐÃ XẢY RA. Migration 128 VÁ CHUỖI thân hàm `reissue_invoice`
 * đang chạy (`pg_get_functiondef` rồi `replace`) để chèn hai thứ:
 * câu gắn `reissue_of` (giữ số gốc HD-0042-1) và bí danh `rr` (tránh
 * lỗi `invoice_id is ambiguous`). Miếng vá ấy KHÔNG NẰM TRONG TỆP NÀO
 * — nó chỉ tồn tại trong cơ sở dữ liệu.
 *
 * Migration 149 viết lại `reissue_invoice` bằng `CREATE OR REPLACE`,
 * chép thân hàm từ MIGRATION 125 — bản có TRƯỚC khi 128 vá. Lệnh ấy
 * ghi đè cả hàm, và cả hai miếng vá biến mất không một tiếng động.
 * Hàm tạo ra vẫn SẠCH về cú pháp nên mọi chốt đều xanh; thứ mất đi chỉ
 * lộ ra khi chủ nhà nhìn số hóa đơn.
 *
 * ⚠ LUẬT: chép thân hàm từ một migration CŨ là xoá mọi miếng vá sau
 * nó. Muốn viết lại cả hàm thì phải chép từ bản ĐANG CHẠY. Kho mã này
 * đã có luật "soi bản ĐANG CHẠY" cho chốt kiểm thử — chốt này mang nó
 * sang cho chính migration.
 */

const MIG = resolve(__dirname, "..", "supabase/migrations")
const files = () => readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()

/**
 * Bỏ chú thích SQL trước khi soi.
 *
 * ⚠ ĐÃ THỬ PHÁ VÀ CHỐT NÓI DỐI. Bản đầu soi nguyên văn cả tệp; xoá hẳn
 * câu `jsonb_set(v_payload, '{reissue_of}', …)` khỏi thân hàm mà chốt
 * VẪN XANH — vì chuỗi `{reissue_of}` còn nằm trong khối chú thích giải
 * thích miếng vá. Chốt đọc phải lời văn của chính nó, không đọc mã.
 * Cùng cái bẫy đã gặp ở migration 148.
 */
const boChuThich = (s: string) =>
  s.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")

/**
 * THÂN HÀM `CREATE OR REPLACE` — không lấy cả tệp.
 *
 * ⚠ BỎ CHÚ THÍCH THÔI CHƯA ĐỦ, và lần thử phá thứ hai chứng minh điều
 * đó. Migration 151 có một khối `DO $$` ở cuối TỰ KIỂM bản đang chạy,
 * và nó nhắc lại đúng những chuỗi dấu hiệu ấy bằng MÃ THẬT
 * (`IF position('{reissue_of}' IN v_src)`). Soi cả tệp thì xoá câu
 * lệnh khỏi thân hàm mà chốt vẫn xanh vì đọc phải khối tự kiểm.
 *
 * Chỉ thân hàm mới là thứ chạy khi người dùng bấm nút.
 */
function thanHam(src: string, fn: string): string {
  const i = src.search(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\s*\\(`))
  if (i < 0) return ""
  const j = src.indexOf("$$;", i)
  return j < 0 ? src.slice(i) : src.slice(i, j)
}

/** Hàm nào bị VÁ CHUỖI, ở migration nào. */
function hamBiVa(): Map<string, string> {
  const out = new Map<string, string>()
  for (const f of files()) {
    const src = readFileSync(join(MIG, f), "utf-8")
    if (!src.includes("pg_get_functiondef")) continue
    for (const m of Array.from(
      src.matchAll(/proname = '(\w+)'/g)
    )) {
      if (!out.has(m[1])) out.set(m[1], f)
    }
  }
  return out
}

/** Migration nào viết lại hẳn một hàm bằng `CREATE OR REPLACE`. */
function vietLaiHan(fn: string): string[] {
  const out: string[] = []
  for (const f of files()) {
    const src = readFileSync(join(MIG, f), "utf-8")
    if (new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\s*\\(`).test(src)) out.push(f)
  }
  return out
}

/**
 * Dấu hiệu bắt buộc phải còn, cho mỗi hàm từng bị vá chuỗi.
 *
 * ⚠ GHI TAY, CÓ CHỦ Ý. Không có cách nào máy móc đọc ra "miếng vá này
 * chèn cái gì" từ một chuỗi `replace()` nhiều tầng. Nên chốt đòi người
 * viết migration sau phải NÓI RA mình đã giữ lại những gì — và nếu
 * thêm một hàm bị vá mới mà quên khai ở đây thì chốt cuối cùng đỏ.
 */
const DAU_HIEU: Record<string, Array<{ chuoi: string; vi_sao: string }>> = {
  reissue_invoice: [
    {
      chuoi: "{reissue_of}",
      vi_sao:
        "mig 128 — không có thì bản sửa được cấp SỐ MỚI thay vì HD-xxxx-n, " +
        "mất hẳn mối liên hệ với tờ gốc",
    },
    {
      chuoi: "rr.invoice_id = p_invoice_id",
      vi_sao:
        "mig 128 mục 6.2 — không có bí danh thì lỗi `column reference " +
        "invoice_id is ambiguous` ngay giữa giao dịch",
    },
  ],
  post_invoice: [
    {
      chuoi: "reissue_of",
      vi_sao: "mig 128 — dùng lại invoice_seq của tờ cũ thay vì cấp số mới",
    },
    {
      chuoi: "UPDATE returns ret",
      vi_sao: "mig 131 — bí danh `ret`, và gắn lại phiếu trả mồ côi",
    },
  ],
}

describe("migration sau giữ nguyên miếng vá của migration trước", () => {
  it("bản viết lại CUỐI CÙNG của mỗi hàm bị vá vẫn còn đủ dấu hiệu", () => {
    const bad: string[] = []
    for (const [fn, dauHieu] of Object.entries(DAU_HIEU)) {
      const vaTai = hamBiVa().get(fn)
      const vietLai = vietLaiHan(fn).filter((f) => !vaTai || f > vaTai)
      if (vietLai.length === 0) continue
      /* ⚠ SOI BẢN CUỐI — nó là bản có hiệu lực. */
      const cuoi = vietLai[vietLai.length - 1]
      const src = boChuThich(thanHam(readFileSync(join(MIG, cuoi), "utf-8"), fn))
      for (const d of dauHieu) {
        if (!src.includes(d.chuoi)) {
          bad.push(`${cuoi} viết lại ${fn}() nhưng mất "${d.chuoi}" — ${d.vi_sao}`)
        }
      }
    }
    expect(
      bad,
      "một migration viết lại cả hàm bằng thân hàm CŨ, xoá mất miếng vá " +
        "của migration sau nó. Hàm vẫn sạch cú pháp nên không gì đỏ lên, " +
        "và lỗi chỉ lộ ra khi người dùng nhìn thấy:\n  " + bad.join("\n  ")
    ).toEqual([])
  })

  /**
   * ⚠ THÊM MỘT HÀM BỊ VÁ MỚI THÌ PHẢI KHAI DẤU HIỆU. Không có ràng
   * buộc này thì chốt trên chỉ canh đúng hai hàm đang liệt kê, và hàm
   * thứ ba bị vá sẽ lọt y như `reissue_invoice` vừa lọt.
   */
  it("mọi hàm bị vá chuỗi rồi viết lại đều đã khai dấu hiệu", () => {
    const thieu: string[] = []
    for (const [fn, vaTai] of Array.from(hamBiVa().entries())) {
      const vietLai = vietLaiHan(fn).filter((f) => f > vaTai)
      if (vietLai.length === 0) continue
      if (!DAU_HIEU[fn]) {
        thieu.push(`${fn}() bị vá ở ${vaTai}, rồi viết lại ở ${vietLai.join(", ")}`)
      }
    }
    expect(
      thieu,
      "hàm bị vá chuỗi rồi bị viết lại mà chưa khai dấu hiệu ở DAU_HIEU — " +
        "khai vào, kèm lý do vì sao mất nó là hỏng:\n  " + thieu.join("\n  ")
    ).toEqual([])
  })

  /** ⚠ Phép quét phải còn nhìn thấy — nếu không nó xanh vì mù. */
  it("phép quét còn nhận ra hàm bị vá và hàm bị viết lại", () => {
    const va = hamBiVa()
    expect(va.has("reissue_invoice"), "không còn thấy mig 128 vá reissue_invoice").toBe(true)
    expect(
      vietLaiHan("reissue_invoice").length,
      "không còn thấy migration nào viết lại reissue_invoice"
    ).toBeGreaterThan(0)
  })
})
