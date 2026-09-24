import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { mocInPhieuTra } from "../src/lib/printing/doc-stamp"
import { savePosReturn, thieuCotNgayTra } from "../src/lib/pos/save"

const read = (p: string) => readFileSync(p, "utf8")
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/^\s*--.*$/gm, "")

/** ⚠ CHỦ NHÀ 24/09/2026: "POS phiếu trả hàng cho phép chọn ngày". */
describe("mig 188: ngày chứng từ phiếu trả", () => {
  const M = code(read("supabase/migrations/188_ngay_tra_hang.sql"))
  it("cột return_date, phiếu cũ lấy ngày của mốc đã gom kỳ", () => {
    expect(M).toContain("ADD COLUMN IF NOT EXISTS return_date date")
    expect(M).toContain("SET return_date = (COALESCE(credited_at, created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date")
  })
  it("credited_at bám ngày chứng từ; trigger nghe cả return_date", () => {
    expect(M).toContain("ELSE (NEW.return_date + time '12:00') AT TIME ZONE 'Asia/Ho_Chi_Minh'")
    expect(M).toContain("ELSIF TG_OP = 'UPDATE' AND NEW.return_date IS DISTINCT FROM OLD.return_date THEN")
    expect(M).toContain("BEFORE INSERT OR UPDATE OF status, return_date ON public.returns")
    expect(M).toContain("NOTIFY pgrst, 'reload schema';")
    expect(read("scripts/sql/kham-so-that.sql")).toContain("Mig 188")
  })
})

type Ghi = { bang: string; kieu: string; body?: Record<string, unknown> }
/** Supabase giả: ghi lại lệnh, tuỳ chọn báo thiếu cột return_date. */
function sbGia(thieuCot: boolean) {
  const ghi: Ghi[] = []
  const tra = (bang: string, kieu: string, body?: Record<string, unknown>) => {
    ghi.push({ bang, kieu, body })
    const loi = thieuCot && body && "return_date" in body
      ? { code: "PGRST204", message: "Could not find the 'return_date' column of 'returns'" }
      : null
    const data = loi ? null : kieu === "select" ? [] : [{ id: "r1" }]
    const q = {
      select: () => q, eq: () => q, limit: () => q, delete: () => { ghi.push({ bang, kieu: "delete" }); return q },
      then: (res: (v: unknown) => void) => res({ data, error: loi }),
    }
    return q
  }
  const sb = {
    from: (bang: string) => ({
      insert: (b: Record<string, unknown>) => tra(bang, "insert", b),
      update: (b: Record<string, unknown>) => tra(bang, "update", b),
      delete: () => tra(bang, "delete"),
      select: () => tra(bang, "select"),
    }),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  }
  return { sb, ghi }
}
const phieu = { returnId: null, orgId: "o", userId: "u", customerId: "c", reason: "damaged", notes: "", lines: [], complete: false, zone: "sale" as const }

describe("lưu phiếu trả kèm ngày", () => {
  it("gửi return_date đã chọn", async () => {
    const { sb, ghi } = sbGia(false)
    await savePosReturn(sb as never, { ...phieu, returnDate: "2026-09-15" })
    expect(ghi.find((g) => g.bang === "returns" && g.kieu === "insert")?.body).toMatchObject({ return_date: "2026-09-15" })
  })
  it("sổ chưa chạy mig 188 → lưu lại không kèm ngày, phiếu vẫn lưu", async () => {
    const { sb, ghi } = sbGia(true)
    await expect(savePosReturn(sb as never, { ...phieu, returnDate: "2026-09-15" })).resolves.toEqual({ returnId: "r1" })
    const chen = ghi.filter((g) => g.bang === "returns" && g.kieu === "insert")
    expect(chen).toHaveLength(2)
    expect(chen[1].body).not.toHaveProperty("return_date")
  })
  it("nhận đúng lỗi thiếu cột, không nuốt lỗi khác", () => {
    expect(thieuCotNgayTra({ code: "PGRST204", message: "Could not find the 'return_date' column" })).toBe(true)
    expect(thieuCotNgayTra({ code: "42703", message: 'column returns.return_date does not exist' })).toBe(true)
    expect(thieuCotNgayTra({ code: "42501", message: "permission denied" })).toBe(false)
    expect(thieuCotNgayTra(null)).toBe(false)
  })
})

describe("màn POS + bản in", () => {
  it("ô Ngày trả sửa được, ngày vào chữ ký thay đổi và vào lệnh lưu", () => {
    const S = code(read("src/components/pos/return-screen.tsx"))
    expect(S).toContain('<SubHeaderDate value={thoiDiem} onChange={setThoiDiem} label="Ngày trả" />')
    expect(S).toContain("returnDate: thoiDiem || homNay(),")
    expect(S).toContain("khach?.id ?? null, lyDo, ghiChu, zone, invoiceId, thoiDiem,")
    expect(S).toContain("setThoiDiem(r.return_date || homNay())")
  })
  it("bản in: cùng ngày lập giữ giờ; nhập bù ngày khác chỉ in ngày đã chọn", () => {
    const cungNgay = mocInPhieuTra("2026-09-15T03:00:00Z", "2026-09-15")
    expect(cungNgay.hasTime).toBe(true)
    const nhapBu = mocInPhieuTra("2026-09-24T03:00:00Z", "2026-09-15")
    expect(nhapBu.hasTime).toBe(false)
    expect(nhapBu.at?.toISOString()).toBe("2026-09-15T05:00:00.000Z")
    expect(mocInPhieuTra("2026-09-24T03:00:00Z", null).hasTime).toBe(true)
  })
})
