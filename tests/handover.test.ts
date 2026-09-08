import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

const MIGRATIONS = readdirSync(resolve(ROOT, "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort()

describe("File schema gộp phải theo kịp migration", () => {
  /**
   * ⚠ ĐÃ LỆCH THẬT. `supabase/schema_full.sql` là thứ người nhận bàn giao
   * dán vào SQL Editor để cài mới. Nó được sinh bằng
   * scripts/build-combined-migration.sh — nhưng script đó không chạy ở
   * đâu cả: không có trong CI, không có trong `npm run verify`. Đo ngày
   * 08/09/2026: file sinh lần cuối ở commit b7eac29 (03/09), thiếu trọn 5
   * migration 099→103. Ai cài từ nó sẽ nhận một schema thiếu tách RefID,
   * snapshot hoá đơn MISA, bucket ảnh giao hàng, công nợ đầu kỳ và ảnh
   * điểm bán — mà không có gì báo.
   */
  const schemaFull = read("supabase/schema_full.sql")
  const markers = new Set<string>()
  const markerRe = /^-- # ([0-9A-Za-z_]+\.sql)$/gm
  let mk: RegExpExecArray | null
  while ((mk = markerRe.exec(schemaFull)) !== null) markers.add(mk[1])

  it("chứa MỌI migration, trừ seed demo", () => {
    const expected = MIGRATIONS.filter((f) => f !== "003_seed.sql")
    const missing = expected.filter((f) => !markers.has(f))
    expect(missing, `chạy: bash scripts/build-combined-migration.sh`).toEqual([])
  })

  it("không chứa migration đã bị xoá khỏi thư mục", () => {
    expect(Array.from(markers).filter((m) => !MIGRATIONS.includes(m))).toEqual([])
  })

  /**
   * File demo có 6 tài khoản mật khẩu công khai. Lẫn nó vào file schema là
   * mở sẵn 6 đường vào cho bản cài production.
   */
  it("KHÔNG kèm dữ liệu demo", () => {
    expect(markers.has("003_seed.sql")).toBe(false)
    expect(schemaFull).not.toContain("Demo@123456")
  })
})

describe("Cài mới không được phụ thuộc dữ liệu demo", () => {
  /**
   * ⚠ ĐÃ ĐO TRÊN POSTGRES 16 DỰNG TỪ ĐẦU: bỏ 003_seed rồi chạy 102
   * migration còn lại thì 007_hr_module ĐỨT — nó `INSERT … VALUES` với
   * UUID gắn cứng của org demo, mà org đó chỉ tồn tại nếu đã chạy seed.
   * Người cài cho bản bàn giao (đúng ra phải bỏ seed demo) gặp lỗi khoá
   * ngoại và tưởng schema hỏng.
   */
  it("không migration nào INSERT thẳng vào UUID org demo", () => {
    const DEMO_ORG = "a0000000-0000-0000-0000-000000000001"
    const offenders: string[] = []
    for (const f of MIGRATIONS) {
      if (f === "003_seed.sql") continue
      const src = read(`supabase/migrations/${f}`)
      if (!src.includes(DEMO_ORG)) continue
      // Dùng được, MIỄN LÀ có điều kiện org tồn tại (SELECT … WHERE / EXISTS)
      // thay vì VALUES thẳng.
      const usesValues = new RegExp(
        `INSERT INTO[\\s\\S]{0,400}?VALUES[\\s\\S]{0,200}?'${DEMO_ORG}'`
      ).test(src)
      if (usesValues) offenders.push(f)
    }
    expect(offenders, "phải đổi sang SELECT … FROM organizations WHERE id = …").toEqual([])
  })
})

describe("Bộ xoá sạch để bàn giao", () => {
  const reset = read("supabase/reset/05_reset_blank.sql")

  /**
   * ⚠ GỐC RỄ CỦA CẢ VIỆC NÀY. Ba file reset cũ (01/02/04) liệt kê tên bảng
   * BẰNG TAY: schema có 72 bảng, chúng chạm 40 — sót 32, trong đó có cấu
   * hình tài khoản MISA, mã đăng nhập QR của nhân viên, ảnh điểm bán, giá
   * vốn FIFO, phiếu thu, bảng lương. Danh sách viết tay thì cứ thêm bảng
   * mới là lỗi thời thêm, và không có gì báo.
   *
   * File mới lật ngược mặc định: xoá MỌI bảng trừ danh sách giữ lại.
   */
  it("dựng danh sách bảng TỪ SCHEMA, không viết tay", () => {
    expect(reset).toContain("pg_class")
    expect(reset).toContain("nspname = 'public'")
    expect(reset).toContain("EXECUTE 'TRUNCATE TABLE ' || wipe_list")
    // Không được quay lại kiểu liệt kê tay.
    expect(reset).not.toMatch(/TRUNCATE TABLE [a-z_]+ RESTART/)
  })

  /** Chỉ hai bảng này được giữ dòng; mọi bảng khác phải bị xoá. */
  it("danh sách giữ lại đúng bằng users + organizations", () => {
    const m = /relname NOT IN \(([^)]*)\)/.exec(reset)
    expect(m, "không thấy danh sách giữ lại").not.toBeNull()
    const keep: string[] = []
    const keepRe = /'([a-z_]+)'/g
    let kp: RegExpExecArray | null
    while ((kp = keepRe.exec(m![1])) !== null) keep.push(kp[1])
    keep.sort()
    expect(keep).toEqual(["organizations", "users"])
  })

  /**
   * ⚠ CASCADE ở đây là bẫy: khoá ngoại đi TỪ bảng được giữ SANG bảng bị
   * xoá sẽ kéo luôn bảng được giữ đi theo, im lặng — đúng thứ đang cố bảo
   * vệ. Không CASCADE thì trường hợp đó báo lỗi kèm tên bảng.
   */
  it("KHÔNG dùng CASCADE khi truncate", () => {
    expect(reset).not.toMatch(/TRUNCATE[^\n;]*CASCADE/i)
  })

  /** Không tìm thấy owner thì phải dừng TRƯỚC khi xoá bất cứ thứ gì. */
  it("dừng lại nếu không thấy tài khoản giữ lại", () => {
    const guard = reset.indexOf("RAISE EXCEPTION")
    const wipe = reset.indexOf("EXECUTE 'TRUNCATE TABLE ")
    expect(guard).toBeGreaterThan(0)
    expect(guard).toBeLessThan(wipe)
  })

  /**
   * Email nằm ở auth.users, KHÔNG ở public.users (bảng đó chỉ có
   * `username`). File 04 cũ tra `users.email` nên hỏng ngay khi chạy.
   */
  it("tra owner qua auth.users, không qua users.email", () => {
    expect(reset).toContain("JOIN auth.users a ON a.id = u.id")
    expect(reset).not.toMatch(/u\.email/)
  })

  /** Bảng sạch mà ảnh còn thì chưa phải bàn giao sạch. */
  it("xoá cả file trong storage, nhưng giữ bucket", () => {
    expect(reset).toContain("DELETE FROM storage.objects")
    expect(reset).not.toMatch(/DELETE FROM storage\.buckets/)
  })

  /** Tài khoản đăng nhập của nhân viên cũ phải đi. */
  it("xoá tài khoản đăng nhập khác trong auth", () => {
    expect(reset).toContain("DELETE FROM auth.identities WHERE user_id <> keep_user")
    expect(reset).toContain("DELETE FROM auth.users      WHERE id      <> keep_user")
  })

  /**
   * ⚠ `n_live_tup` là số ƯỚC LƯỢNG, chỉ đúng sau ANALYZE. Bản đầu của file
   * này dùng nó và báo "7 bảng còn dòng" khi cả 7 đã sạch — một câu kiểm
   * lại nói sai còn tệ hơn không kiểm.
   */
  it("câu kiểm lại đếm CHÍNH XÁC, không dùng số ước lượng", () => {
    expect(reset).not.toContain("n_live_tup")
    expect(reset).toContain("query_to_xml")
  })
})
