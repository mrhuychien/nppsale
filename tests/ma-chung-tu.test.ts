import { describe, it, expect } from "vitest"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { hamDangChay, tachSql } from "./helpers/sql-ham-dang-chay"

/**
 * MÃ CHỨNG TỪ — phiếu trả PT-xxxx, và không mã nào bị cắt khi số chạy qua 9999 (mig 237).
 *
 * ⚠ CHỦ NHÀ 08/10/2026: "Phiếu trả hàng : đánh số bình thường. dùng PT".
 * ⚠ LỖI NGẦM ĐI KÈM: `lpad(số, 4, '0')` của Postgres CẮT chuỗi dài hơn 4 ký tự — lpad('10000', 4, '0') = '1000'.
 *   Hoá đơn / đơn hàng / phiếu nhập thứ 10.000 mang đúng mã của chứng từ số 1.000 → chỉ mục duy nhất (org_id, mã)
 *   từ chối → từ đó không lập được chứng từ nào nữa. Mọi hàm sinh mã đi qua `_so_chung_tu` (đủ 4 chữ số, không cắt).
 */

const HAM = hamDangChay()
const than = (key: string) => {
  const h = HAM.get(key)
  expect(h, `không thấy bản đang chạy của ${key}`).toBeTruthy()
  return h!
}
/** `lpad(…, <số cố định>, …)` — độ rộng cố định là cắt số khi số dài hơn. */
const coLpadCoDinh = (sql: string) => {
  const t = tachSql(sql)
  for (let k = 0; k < t.length; k++) {
    if (t[k].k !== "w" || t[k].v !== "LPAD" || t[k + 1]?.v !== "(") continue
    let sau = 0
    for (let j = k + 1; j < t.length; j++) {
      if (t[j].v === "(") sau++
      else if (t[j].v === ")") {
        sau--
        if (sau === 0) break
      } else if (sau === 1 && t[j].v === ",") {
        // tham số thứ hai bắt đầu ngay sau dấu phẩy đầu tiên ở tầng 1: GREATEST(…) thì không cố định
        return t[j + 1]?.v !== "GREATEST"
      }
    }
  }
  return false
}

describe("mã chứng từ (mig 237)", () => {
  it("phiếu trả đánh số PT- qua _so_chung_tu", () => {
    const h = than("public._ma_phieu_tra(INTEGER)")
    expect(h.file).toBe("237_ma_phieu_tra_pt.sql")
    expect(h.than).toContain("'PT-' || public._so_chung_tu(p_seq)")
  })

  it("_so_chung_tu đủ 4 chữ số, dài hơn thì giữ nguyên", () => {
    const h = than("public._so_chung_tu(INTEGER)")
    expect(h.than).toMatch(/lpad\(COALESCE\(p_n, 0\)::text, GREATEST\(4, length\(COALESCE\(p_n, 0\)::text\)\), '0'\)/)
  })

  it("không hàm sinh mã nào còn lpad độ rộng cố định", () => {
    const sinhMa = [
      "public._ma_phieu_tra(INTEGER)",
      "public._inv_code(INTEGER,INTEGER)",
      "public._order_code(INTEGER,INTEGER)",
      "public.next_purchase_receipt_code(UUID)",
    ]
    for (const key of sinhMa) {
      const h = than(key)
      expect(h.file, `${key} phải là bản mig 237`).toBe("237_ma_phieu_tra_pt.sql")
      expect(coLpadCoDinh(h.than), `${key} còn lpad cố định — số qua 9999 sẽ bị cắt, trùng mã`).toBe(false)
      expect(h.than).toContain("_so_chung_tu(")
    }
  })

  it("bộ nhận lpad cố định bắt đúng câu cũ, không kêu oan câu đã vá", () => {
    expect(coLpadCoDinh("SELECT 'HD-' || lpad(COALESCE(p_seq, 0)::text, 4, '0')")).toBe(true)
    expect(coLpadCoDinh("SELECT lpad(v::text, GREATEST(4, length(v::text)), '0')")).toBe(false)
    expect(coLpadCoDinh("SELECT 'PT-' || public._so_chung_tu(p_seq)")).toBe(false)
  })

  it("đổi mã phiếu cũ tắt riêng trigger ngày trừ doanh số rồi bật lại", () => {
    const mig = readFileSync(resolve(__dirname, "..", "supabase/migrations/237_ma_phieu_tra_pt.sql"), "utf-8")
    const tat = mig.indexOf("ALTER TABLE public.returns DISABLE TRIGGER trg_zz_returns_revenue_date;")
    const doi = mig.indexOf("SET return_code = public._ma_phieu_tra(return_seq)")
    const bat = mig.indexOf("ALTER TABLE public.returns ENABLE TRIGGER trg_zz_returns_revenue_date;")
    expect(tat).toBeGreaterThan(-1)
    expect(doi).toBeGreaterThan(tat)
    expect(bat).toBeGreaterThan(doi)
  })
})

/** Chạy thật trên Postgres thử nếu có (máy CI không có → bỏ qua). */
function hoiDbThu(sql: string): string | null {
  try {
    return execFileSync(
      "psql",
      ["-h", process.env.PG_THU_HOST || "/tmp/pgtest", "-p", process.env.PG_THU_PORT || "55432", "-U", "postgres",
        "-d", process.env.PG_THU_DB || "npp_tong", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }
    ).trim()
  } catch {
    return null
  }
}

const MA_DB = hoiDbThu(
  "SELECT concat_ws('|', public._ma_phieu_tra(7), public._ma_phieu_tra(12345), public._inv_code(9999, 0), " +
    "public._inv_code(10000, 0), public._inv_code(12, 1), public._order_code(10000, 2))"
)

describe.skipIf(!MA_DB)("mã chứng từ trên Postgres thử", () => {
  it("PT-0007 · PT-12345 · HD-9999 · HD-10000 · HD-0012-1 · DH-10000-2", () => {
    expect(MA_DB).toBe("PT-0007|PT-12345|HD-9999|HD-10000|HD-0012-1|DH-10000-2")
  })
})
