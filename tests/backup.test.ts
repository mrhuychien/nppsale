import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { keepSet, dateFromName } from "../scripts/backup/upload-drive"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const WF = read(".github/workflows/backup.yml")
const UP = read("scripts/backup/upload-drive.ts")

const name = (d: string) => `nppsale-${d}.pgc.age`

describe("Xoay vòng bản sao", () => {
  it("đọc được ngày từ tên file", () => {
    expect(dateFromName(name("20260910"))?.toISOString().slice(0, 10)).toBe("2026-09-10")
    expect(dateFromName("linh-tinh.age")).toBeNull()
    expect(dateFromName("nppsale-20261332.pgc.age")?.getUTCMonth()).not.toBe(12)
  })

  it("giữ 7 bản gần nhất", () => {
    const names = Array.from({ length: 20 }, (_, i) => name(`202609${String(i + 1).padStart(2, "0")}`))
    const keep = keepSet(names)
    // 10/09 là mới nhất trong 7 ngày gần nhất tính từ 20/09 ngược lại
    expect(keep.has(name("20260920"))).toBe(true)
    expect(keep.has(name("20260914"))).toBe(true)
  })

  /** Bản Chủ nhật và mùng 1 phải sống lâu hơn 7 ngày. */
  it("giữ bản Chủ nhật và bản mùng 1 ngoài 7 ngày gần nhất", () => {
    const names = [
      name("20260901"), // mùng 1
      name("20260906"), // Chủ nhật
      ...Array.from({ length: 14 }, (_, i) => name(`202609${String(i + 10).padStart(2, "0")}`)),
    ]
    const keep = keepSet(names)
    expect(keep.has(name("20260901")), "mùng 1 phải được giữ").toBe(true)
    expect(keep.has(name("20260906")), "Chủ nhật phải được giữ").toBe(true)
  })

  /**
   * ⚠ Phép xoá chỉ đụng tới thứ NẰM NGOÀI danh sách giữ. Tên lạ không rơi
   * vào nhóm ngày nào, nên nếu không giữ lại thì nó bị xoá — trong khi đó
   * có thể là file người ta cố ý đặt vào thư mục. Thà thừa còn hơn xoá
   * nhầm.
   */
  it("KHÔNG xoá file có tên lạ", () => {
    const keep = keepSet([name("20260910"), "ghi-chu-khoi-phuc.age", "backup-tay.age"])
    expect(keep.has("ghi-chu-khoi-phuc.age")).toBe(true)
    expect(keep.has("backup-tay.age")).toBe(true)
  })

  it("bản cũ ngoài mọi nhóm thì bị loại", () => {
    const names = [
      ...Array.from({ length: 10 }, (_, i) => name(`202609${String(i + 10).padStart(2, "0")}`)),
      name("20250315"), // rất cũ, không phải CN, không phải mùng 1
    ]
    const keep = keepSet(names)
    expect(keep.has(name("20250315"))).toBe(false)
  })

  it("thư mục rỗng không làm hàm nổ", () => {
    expect(keepSet([]).size).toBe(0)
  })

  /**
   * ⚠ PHÉP KIỂM MẠNH NHẤT ở đây: chạy xoay vòng MỖI NGÀY suốt một năm, như
   * ngoài đời. Vài ca tĩnh chỉ soi một khoảnh khắc; cái cần biết là sau
   * nhiều vòng nó có HỘI TỤ không, hay phình dần tới lúc đầy 15 GB của
   * Drive — mà lúc đó Gmail cũng ngừng nhận thư.
   */
  it("chạy 365 ngày liên tiếp thì số bản ổn định, không phình", () => {
    let onDrive: string[] = []
    const sizes: number[] = []
    for (let i = 0; i < 365; i++) {
      const d = new Date(Date.UTC(2026, 0, 1 + i))
      onDrive.push(name(d.toISOString().slice(0, 10).replace(/-/g, "")))
      const keep = keepSet(onDrive)
      onDrive = onDrive.filter((n) => keep.has(n))
      sizes.push(onDrive.length)
    }
    // Trần lý thuyết 7 + 4 + 6 = 17; thực tế thấp hơn vì các nhóm chồng nhau.
    expect(Math.max(...sizes)).toBeLessThanOrEqual(17)
    // Và ổn định ở nửa sau, không còn tăng.
    expect(sizes[364]).toBe(sizes[200])
  })

  /** Bản của HÔM NAY không bao giờ được xoá — đó là bản vừa tạo. */
  it("luôn giữ bản mới nhất", () => {
    const names = Array.from({ length: 40 }, (_, i) =>
      name(new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10).replace(/-/g, ""))
    )
    const newest = names[names.length - 1]
    expect(keepSet(names).has(newest)).toBe(true)
  })
})

describe("Quy trình sao lưu", () => {
  /**
   * ⚠ `pg_dump` chỉ tương thích XUÔI: bản mới dump được server cũ, bản cũ
   * KHÔNG dump được server mới — lỗi "server version mismatch". Dùng bản
   * có sẵn của runner là quả bom hẹn giờ: Supabase nâng Postgres một cái
   * là backup ngừng chạy.
   */
  it("cài pg_dump mới nhất, không dùng bản mặc định của runner", () => {
    expect(WF).toContain("postgresql-client-17")
  })

  /**
   * ⚠ Thiếu schema `auth` thì restore xong KHÔNG AI đăng nhập được — bản
   * sao trông đầy đủ mà thực chất vô dụng, và chỉ biết vào đúng ngày cần.
   */
  it("kết xuất cả public, auth và storage", () => {
    expect(WF).toContain("--schema=public --schema=auth --schema=storage")
  })

  /**
   * ⚠ ĐIỀU QUAN TRỌNG NHẤT: một bản sao chưa từng restore thì không phải
   * bản sao, chỉ là một file. Và việc kiểm phải xảy ra TRƯỚC khi mã hoá —
   * khoá riêng cố ý không có mặt trong CI nên CI không giải mã được.
   */
  it("khôi phục thử TRƯỚC khi mã hoá", () => {
    const restore = WF.indexOf("Khôi phục thử")
    const encrypt = WF.indexOf("name: Mã hoá")
    expect(restore).toBeGreaterThan(0)
    expect(encrypt).toBeGreaterThan(0)
    expect(restore).toBeLessThan(encrypt)
    expect(WF).toContain("image: postgres:16")
  })

  /**
   * Đếm bảng thôi thì một bản `--schema-only` cũng qua. Phải đối chiếu cả
   * số DÒNG mới biết dữ liệu có thật trong đó.
   */
  it("đối chiếu cả số bảng LẪN số dòng", () => {
    expect(WF).toContain("Số bảng lệch")
    expect(WF).toContain("FROM auth.users;")
    expect(WF).toContain("Số người dùng lệch")
  })

  /** Mã hoá bằng khoá CÔNG KHAI — khoá riêng không bao giờ vào CI. */
  it("mã hoá bằng khoá công khai age", () => {
    expect(WF).toContain("age -r \"$AGE_PUBLIC_KEY\"")
    expect(WF).not.toContain("AGE_SECRET_KEY")
    expect(WF).not.toContain("age --decrypt")
  })

  /** Bản thô nằm lại trên runner là một bản sao không mã hoá bị bỏ quên. */
  it("xoá bản thô sau khi mã hoá", () => {
    const enc = WF.slice(WF.indexOf("name: Mã hoá"))
    expect(enc).toContain("rm -f out/dump.pgc")
  })

  /**
   * ⚠ Lỗi im lặng có thể đẩy lên Drive một file RỖNG, và người ta chỉ biết
   * vào ngày cần khôi phục.
   */
  it("kiểm file mã hoá không rỗng và đúng định dạng", () => {
    expect(WF).toContain("age-encryption.org")
    expect(WF).toContain("File mã hoá quá nhỏ")
  })

  /** Xoá trước rồi upload hỏng là có lúc không còn bản nào trên Drive. */
  it("xoay vòng SAU khi tải lên xong", () => {
    const up = UP.indexOf("for (const f of files) {")
    const rot = UP.indexOf("const remote = await listBackups(token)")
    expect(up).toBeGreaterThan(0)
    expect(rot).toBeGreaterThan(up)
  })

  /**
   * `drive.file` chỉ thấy file do chính ứng dụng tạo. Token lộ thì kẻ lấy
   * được cũng không đọc được gì khác trong Drive.
   */
  it("tài liệu hoá scope hẹp, không dùng scope drive toàn quyền", () => {
    expect(UP).toContain("drive.file")
    expect(read("docs/BACKUP.md")).toContain("drive.file")
  })

  /** Hai lượt chồng nhau sẽ upload trùng tên và đếm nhầm lúc xoay vòng. */
  it("chặn hai lượt chạy chồng nhau", () => {
    expect(WF).toContain("group: backup")
    expect(WF).toContain("cancel-in-progress: false")
  })

  /** Một lần treo không được ăn hết hạn mức Actions của tháng. */
  it("có trần thời gian chạy", () => {
    expect(WF).toMatch(/timeout-minutes:\s*\d+/)
  })

  /** Thiếu secret thì phải dừng và NÓI RA, không chạy tiếp rồi tạo file rỗng. */
  it("dừng ngay nếu thiếu secret", () => {
    expect(WF).toContain("Thiếu secret SUPABASE_DB_URL")
    expect(WF).toContain("Thiếu secret AGE_PUBLIC_KEY")
  })
})
