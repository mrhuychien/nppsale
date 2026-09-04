import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { normalizeInvNo, normalizeSeries, sameInvNo, sameSeries } from "@/lib/misa/normalize"

/**
 * §1 — Tách RefID khỏi số hoá đơn MISA (mig 099).
 *
 * `invoices.misa_invoice_id` từng kiêm hai vai: publish ghi RefID (GUID),
 * refresh ghi InvNo ĐÈ LÊN. Mất khoá là mất đường hỏi lại MISA — không bao
 * giờ biết hoá đơn bị huỷ hay bị thay thế sau đó.
 *
 * Phần lớn test dưới đây đọc mã nguồn chứ không chạy route (route cần
 * Supabase + MISA thật). Chúng chặn được lỗi cũ quay lại; chúng không thay
 * được một lần chạy thật trên môi trường staging.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

/** Bỏ chú thích, để không tự bắt lỗi trên đoạn văn giải thích lỗi cũ. */
function code(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
}

/**
 * Lấy nội dung mọi object truyền vào `.update({...})` — tức những gì THẬT
 * SỰ được ghi xuống DB. Khớp ngoặc nhọn để không cắt nhầm giữa chừng.
 */
function updatePayloads(src: string): string[] {
  const out: string[] = []
  const re = /\.update\(\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    let depth = 1
    let i = m.index + m[0].length
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "{") depth++
      else if (src[i] === "}") depth--
    }
    out.push(src.slice(m.index, i))
  }
  return out
}

const PUBLISH = read("src/app/api/einvoice/publish/route.ts")
const REFRESH = read("src/app/api/einvoice/refresh-status/route.ts")
const CLIENT = read("src/lib/misa/client.ts")
const SYNC = read("src/app/api/einvoice/sync/route.ts")
/**
 * §2 chuyển phần suy trạng thái + dựng `updates` từ trong route ra module
 * dùng chung `apply.ts` (để refresh và vòng quét không kết luận khác nhau).
 * Các chốt dưới đây vì thế soi apply.ts — nhưng vẫn kiểm CẢ HAI route để
 * chắc không ai lén ghi thẳng vào cột khoá.
 */
const APPLY = read("src/lib/misa/apply.ts")
const STATUS = read("src/lib/misa/status.ts")

/** Migration 099 — tìm theo tên, không theo số cố định (migration chỉ thêm). */
function migration(namePart: string): string {
  const dir = resolve(ROOT, "supabase/migrations")
  const hit = readdirSync(dir).filter((f) => f.includes(namePart)).sort().pop()
  if (!hit) throw new Error(`không tìm thấy migration chứa "${namePart}"`)
  return readFileSync(resolve(dir, hit), "utf-8")
}
const MIG = migration("einvoice_refid_split")

describe("⚠ khoá nối phải BẤT BIẾN — refresh không được ghi đè RefID", () => {
  /**
   * Đây là chốt trung tâm của cả §1. `refresh` ghi vào `misa_inv_no`; chạm
   * vào `misa_ref_id` là tái lập đúng con bug đã sửa.
   */
  it("không đường nào ngoài publish GHI vào misa_ref_id", () => {
    for (const [name, src] of [["refresh", REFRESH], ["sync", SYNC], ["apply", APPLY]] as const) {
      const c = code(src)
      // Chỉ soi VIỆC GHI, không soi việc đọc: `const refId = invoice.misa_ref_id`
      // và khai báo kiểu đều hợp lệ và phải còn.
      for (const payload of updatePayloads(c)) {
        expect(payload, `${name} ghi misa_ref_id trong .update()`).not.toContain("misa_ref_id")
        expect(payload, `${name} ghi cột cũ trong .update()`).not.toContain("misa_invoice_id")
      }
      expect(c, `${name} gán updates.misa_ref_id`).not.toMatch(/updates\.misa_ref_id\s*=/)
      expect(c, `${name} gán updates.misa_invoice_id`).not.toMatch(/updates\.misa_invoice_id\s*=/)
    }
    // Và chốt ngược: publish thì PHẢI ghi.
    expect(updatePayloads(code(PUBLISH)).join("\n")).toContain("misa_ref_id")
  })

  it("số hoá đơn ghi vào đúng cột của nó", () => {
    expect(code(APPLY)).toContain("updates.misa_inv_no = snap.invNo")
  })

  it("chỉ publish ghi misa_ref_id", () => {
    expect(code(PUBLISH)).toContain("misa_ref_id: sentRefId")
    // Nguồn sự thật là payload mình GỬI ĐI, không phải response MISA trả về
    // (response nhồi "<Chưa cấp số>" vào field InvNo).
    expect(code(PUBLISH)).toContain("payload[0]?.RefID")
  })

  /**
   * ⚠ Hỏi MISA bằng TransactionID là ĐOÁN. MISA trả rỗng, route báo "MISA
   * không trả về dữ liệu HD.", và người dùng đi soi nhầm chỗ. Chú thích cũ
   * ở refresh đã viết đúng điều này trong khi dòng code ngay dưới làm ngược
   * lại — nên test phải soi CODE, không soi chú thích.
   */
  it("refresh tra cứu CHỈ bằng RefID, không lùi về lookup_code", () => {
    const c = code(REFRESH)
    expect(c).toContain("const refId = invoice.misa_ref_id")
    expect(c).not.toMatch(/refId\s*=\s*[^\n]*misa_lookup_code/)
  })

  /**
   * Mất RefID và chưa từng đẩy MISA là HAI ca khác nhau, cách xử lý khác
   * nhau: một ca cần gán tay/phát hành lại, ca kia chỉ cần bấm đẩy.
   */
  it("phân biệt 'mất RefID' với 'chưa đẩy lên MISA'", () => {
    const c = code(REFRESH)
    expect(c).toMatch(/if \(invoice\.misa_inv_no\)/)
    expect(c).toContain("MẤT RefID")
    expect(c).toContain("einvoice_lost_refid.sql")
  })
})

describe("⚠ vá ở chỗ DÙNG thay vì chỗ gây ra — uuidRe phải biến mất", () => {
  /**
   * Hai chỗ từng phải `uuidRe.test(misa_invoice_id)` để đoán cột đó đang giữ
   * vai nào. Còn regex ấy nghĩa là còn chỗ nào đó vẫn coi một cột là hai
   * khoá.
   */
  it("không còn file nào đoán vai của cột bằng regex UUID", () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const p = resolve(dir, name.name)
        if (name.isDirectory()) walk(p)
        else if (/\.tsx?$/.test(name.name)) {
          const src = code(readFileSync(p, "utf-8"))
          if (/uuidRe/.test(src)) offenders.push(p.replace(ROOT + "/", ""))
        }
      }
    }
    walk(resolve(ROOT, "src"))
    expect(offenders).toEqual([])
  })

  it("chốt idempotency của publish hỏi thẳng misa_ref_id", () => {
    expect(code(PUBLISH)).toContain("invoice.misa_lookup_code || invoice.misa_ref_id")
  })
})

describe("⚠ cùng kiểu lẫn khoá ở einvoice_logs — inv_no không được nhận GUID", () => {
  /**
   * `client.ts` từng pick("InvNo","invNo","InvoiceNumber","RefID","refID") —
   * khi MISA chưa cấp số thì `inv_no` nhận GUID, và
   * `einvoice_logs.misa_inv_no` lưu GUID thay vì số hoá đơn.
   */
  it("invNo không lùi về RefID", () => {
    const c = code(CLIENT)
    const i = c.indexOf("invNo: pick(")
    expect(i).toBeGreaterThan(0)
    const call = c.slice(i, c.indexOf(")", i))
    expect(call).not.toMatch(/RefID|refID/)
  })

  it("RefID vẫn được trích, chỉ là vào trường riêng", () => {
    expect(code(CLIENT)).toMatch(/refId: pick\("RefID", "refID"\)/)
  })

  /**
   * MISA echo lại RefID VẪN LÀ dữ liệu hoá đơn. Trước đây nó lọt vào phép
   * kiểm "rỗng" qua biến invNo; tách ra mà quên kể tên refId thì hoá đơn đẩy
   * thành công nhưng chưa cấp số bị báo "MISA trả success nhưng không có dữ
   * liệu hoá đơn" — tức chặn nhầm một ca hoàn toàn bình thường.
   */
  it("phép kiểm 'rỗng' có tính cả refId", () => {
    const c = code(CLIENT)
    const i = c.indexOf("const isEmpty")
    expect(i).toBeGreaterThan(0)
    expect(c.slice(i, c.indexOf("if (isEmpty)", i))).toContain("!refId")
  })
})

describe("⚠ không đè số người gán tay — và cũng không im lặng", () => {
  it("misa_no_locked chặn ghi đè", () => {
    const c = code(APPLY)
    const i = c.indexOf("if (book.misa_no_locked)")
    expect(i).toBeGreaterThan(0)
    // Nhánh khoá KHÔNG được chứa lệnh ghi số.
    const branch = c.slice(i, c.indexOf("} else {", i))
    expect(branch).not.toContain("updates.misa_inv_no =")
  })

  it("lệch số thì ghi ghi chú nói rõ hai bên, không nuốt", () => {
    const c = code(APPLY)
    expect(c).toMatch(/Sổ ghi số \$\{[^}]+\}, MISA cấp số \$\{[^}]+\}/)
  })

  /**
   * ⚠ So thẳng chuỗi thì '00012345' khác '12345' → mọi tờ khớp đều bị gắn
   * lệch. Rổ cảnh báo đầy báo động giả thì không ai nhìn cả cảnh báo thật.
   */
  it("so số hoá đơn qua bản chuẩn hoá, không so thẳng chuỗi", () => {
    expect(code(APPLY)).toContain("invNoConflict(book.misa_inv_no, snap.invNo)")
    expect(code(STATUS)).toContain("return !sameInvNo(bookInvNo, misaInvNo)")
    expect(code(APPLY)).not.toMatch(/book\.misa_inv_no\s*!==\s*snap\.invNo/)
  })
})

describe("⚠ đừng gán null đè lên cột đang có giá trị tốt", () => {
  /**
   * MISA có lúc trả thiếu TransactionID (hoá đơn "chờ cấp mã"); ghi null vào
   * đó là xoá trắng mã tra cứu đang đúng ở lượt quét sau.
   */
  it("chỉ đưa vào updates những khoá có giá trị", () => {
    const c = code(APPLY)
    expect(c).toContain("if (snap.transactionId) updates.misa_lookup_code = snap.transactionId")
    expect(c).not.toMatch(/updates\.misa_lookup_code\s*=\s*snap\.transactionId\s*\|\|/)
  })

  /** Luôn cập nhật thời điểm quét, kể cả khi chưa có số. */
  it("luôn ghi misa_last_checked_at", () => {
    const c = code(APPLY)
    const i = c.indexOf("updates.misa_last_checked_at")
    expect(i).toBeGreaterThan(0)
    // Không nằm trong nhánh if nào — phải ở ngay thân hàm.
    const line = c.slice(c.lastIndexOf("\n", i) + 1, i)
    expect(line.trim()).toBe("")
  })
})

describe("⚠ '<Chưa cấp số>' là chỗ giữ chỗ, không phải số hoá đơn", () => {
  it("vẫn loại chuỗi bắt đầu bằng '<'", () => {
    expect(code(STATUS)).toContain('t.startsWith("<")')
  })

  it("backfill của migration cũng bỏ qua rác đó", () => {
    expect(MIG).toContain("misa_invoice_id NOT LIKE '<%'")
  })
})

describe("migration 099 — backfill và ràng buộc", () => {
  it("backfill chép RefID còn nguyên sang cột mới", () => {
    expect(MIG).toMatch(/SET misa_ref_id = misa_invoice_id/)
    expect(MIG).toMatch(/misa_invoice_id ~\* v_uuid_re/)
  })

  /**
   * ⚠ Dòng mất khoá phải được ĐẾM và ĐÁNH DẤU. Dọn im lặng thì không ai
   * biết là bao nhiêu tờ, nên không ai đi phát hành lại.
   */
  it("đếm và báo ra số dòng mất khoá", () => {
    expect(MIG).toContain("GET DIAGNOSTICS v_lost = ROW_COUNT")
    expect(MIG).toMatch(/RAISE NOTICE[^;]*MẤT RefID/)
    // Dấu vết còn lại trong dữ liệu, không chỉ trong log migration.
    expect(MIG).toMatch(/misa_note = COALESCE\(misa_note/)
  })

  /**
   * ⚠ Chạy lại migration không được nối thêm ghi chú lần nữa. Đã đo: thiếu
   * điều kiện `misa_inv_no IS NULL` thì lần 2 vẫn báo "2 hoá đơn MẤT RefID"
   * và misa_note dài gấp đôi.
   */
  it("backfill idempotent", () => {
    const i = MIG.indexOf("SET misa_inv_no = misa_invoice_id")
    expect(i).toBeGreaterThan(0)
    const where = MIG.slice(i, MIG.indexOf(";", i))
    expect(where).toContain("misa_inv_no IS NULL")
  })

  /**
   * ⚠ Ràng buộc CHECK gốc nằm ở mig 011, thêm KÈM cột bằng
   * `ADD COLUMN IF NOT EXISTS ... CHECK (...)`. Cột có sẵn từ trước thì cả
   * câu bị bỏ qua — CHECK bao gồm. Nên không được đoán tên, cũng không được
   * cho rằng nó tồn tại.
   */
  it("tra tên ràng buộc cũ trong catalog thay vì đoán", () => {
    expect(MIG).toContain("FROM pg_constraint con")
    expect(MIG).toContain("pg_get_constraintdef(con.oid) ILIKE '%misa_status%'")
    expect(MIG).not.toMatch(/DROP CONSTRAINT invoices_misa_status_check\b/)
  })

  it("CHECK mới nhận đủ trạng thái §2 cần", () => {
    for (const s of ["waiting_code", "replaced", "cancelled", "amount_mismatch"]) {
      expect(MIG, `CHECK thiếu ${s}`).toContain(`'${s}'`)
    }
  })

  /**
   * ⚠ Hai hoá đơn cùng số là lỗi phải chặn ở tầng DB. Partial để hoá đơn
   * chưa cấp số (NULL) không bị ràng buộc; COALESCE để ký hiệu NULL không
   * làm rỗng cả khoá (NULL trong unique index là "khác nhau hết").
   */
  it("unique số hoá đơn: partial, có ký hiệu, chịu được ký hiệu NULL", () => {
    const i = MIG.indexOf("uq_invoices_misa_inv_no")
    expect(i).toBeGreaterThan(0)
    const idx = MIG.slice(i, MIG.indexOf(";", i))
    expect(idx).toContain("WHERE misa_inv_no IS NOT NULL")
    expect(idx).toContain("COALESCE(misa_inv_series, '')")
    expect(idx).toContain("org_id")
  })

  /** Cột cũ chưa drop: còn mã đọc nó, và drop là thao tác không lùi được. */
  it("không drop cột cũ trong cùng migration", () => {
    expect(MIG).not.toMatch(/DROP COLUMN\s+.*misa_invoice_id/i)
  })
})

describe("chuẩn hoá số / ký hiệu — chuẩn hoá khi SO, giữ nguyên khi LƯU", () => {
  it("bỏ số 0 ở đầu số hoá đơn", () => {
    expect(normalizeInvNo("00000123")).toBe("123")
    expect(normalizeInvNo(" 123 ")).toBe("123")
    expect(sameInvNo("00000123", "123")).toBe(true)
  })

  /** '000' phải ra '0', không phải chuỗi rỗng. */
  it("chuỗi toàn số 0 không biến thành rỗng", () => {
    expect(normalizeInvNo("000")).toBe("0")
    expect(sameInvNo("000", "0")).toBe(true)
  })

  it("bỏ chữ số ĐẦU của ký hiệu, giữ chữ số bên trong", () => {
    expect(normalizeSeries("1C25MHG")).toBe("C25MHG")
    expect(normalizeSeries("c25mhg")).toBe("C25MHG")
    expect(sameSeries("1C25MHG", "C25MHG")).toBe(true)
    // '25' là năm, nằm giữa — không được đụng tới.
    expect(normalizeSeries("1C25MHG")).toContain("25")
  })

  /** Hai số khác nhau thật thì vẫn phải khác nhau. */
  it("không gộp nhầm hai số khác nhau", () => {
    expect(sameInvNo("123", "1234")).toBe(false)
    expect(sameInvNo("00012345", "12346")).toBe(false)
    expect(sameSeries("1C25MHG", "1C24MHG")).toBe(false)
  })

  /**
   * Không có số thì KHÔNG kết luận được là trùng. Trả true ở đây nghĩa là
   * hai hoá đơn chưa cấp số bị coi là cùng một tờ.
   */
  it("rỗng không bằng rỗng", () => {
    expect(sameInvNo(null, null)).toBe(false)
    expect(sameInvNo("", "")).toBe(false)
    expect(sameInvNo("123", null)).toBe(false)
    expect(sameSeries(undefined, undefined)).toBe(false)
  })
})
