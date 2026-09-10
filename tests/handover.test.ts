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

  /**
   * ⚠ LỖI ĐÃ TRẢ GIÁ TRÊN PRODUCTION. Bản đầu có `DELETE FROM
   * storage.objects` và chạy trót lọt trên Postgres tạm dùng để kiểm — vì
   * bảng đó do chính bộ kiểm tự tạo, không có trigger của Supabase. Trên
   * production thì:
   *   ERROR 42501: Direct deletion from storage tables is not allowed.
   *                Use the Storage API instead.
   * Trigger storage.protect_delete() chặn để tránh xoá dòng mà file thật
   * vẫn nằm lại trên S3.
   *
   * Nay việc dọn Storage nằm ở scripts/reset-storage.ts, và SQL chỉ CHẶN
   * nếu chưa dọn.
   */
  it("KHÔNG xoá thẳng storage bằng SQL", () => {
    expect(reset).not.toMatch(/DELETE FROM storage\./)
    expect(reset).not.toMatch(/TRUNCATE[^\n;]*storage\./)
  })

  /**
   * Chặn phải nằm TRƯỚC mọi thao tác xoá. Thứ tự ngược lại là bẫy: xoá
   * sạch bảng rồi mới biết không dọn được ảnh — lúc đó ảnh mặt tiền cửa
   * hàng và chữ ký người nhận vẫn còn, mà đường lần tới chúng thì mất.
   */
  it("chặn ngay từ đầu nếu Storage chưa dọn", () => {
    const check = reset.indexOf("FROM storage.objects")
    const wipe = reset.indexOf("EXECUTE 'TRUNCATE TABLE ")
    expect(check).toBeGreaterThan(0)
    expect(check).toBeLessThan(wipe)
    expect(reset).toContain("scripts/reset-storage.ts")
  })

  /**
   * ⚠ BẾ TẮC THẬT TRÊN PRODUCTION. Supabase tự tạo file RỖNG
   * `.emptyFolderPlaceholder` khi người dùng tạo thư mục trong Dashboard,
   * và ẨN nó khỏi giao diện. Bản đầu đếm cả nó: chốt chặn báo "còn 1
   * file", người chạy vào Dashboard xoá thì KHÔNG THẤY gì để xoá.
   *
   * Chặn bằng một thứ mà giao diện không cho gỡ là chặn chết. Nó cũng
   * không chứa dữ liệu gì, nên không thuộc thứ cần chặn.
   */
  it("không chặn vì thư mục rỗng Supabase tự tạo", () => {
    const guard = reset.slice(
      reset.indexOf("SELECT count(*) INTO files_left"),
      reset.indexOf("RAISE EXCEPTION")
    )
    expect(guard).toContain("NOT LIKE '%.emptyFolderPlaceholder'")
  })

  /** Nhưng vẫn phải NÓI RA, không im lặng bỏ qua. */
  it("vẫn báo số thư mục rỗng còn sót", () => {
    expect(reset).toMatch(/RAISE NOTICE[\s\S]{0,120}emptyFolderPlaceholder/)
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

  /** Hai chế độ: giữ 1 chủ, hoặc trắng tinh 0 org / 0 người. */
  it("có cờ chọn chế độ, mặc định là GIỮ chủ", () => {
    expect(reset).toMatch(/keep_owner\s+boolean\s*:=\s*true;/)
  })

  /**
   * ⚠ BẪY NULL. Ở chế độ trắng tinh, keep_user là NULL — mà
   * `WHERE id <> NULL` cho ra NULL chứ KHÔNG phải TRUE, tức là xoá 0
   * dòng. Dùng chung một câu cho cả hai chế độ thì lệnh chạy êm ru và
   * toàn bộ người dùng cũ vẫn còn nguyên: đúng thứ đang cần xoá.
   * Bốn lệnh xoá theo người phải nằm trong nhánh IF keep_owner.
   */
  it("chế độ trắng tinh xoá không điều kiện, không so với NULL", () => {
    const body = reset.slice(reset.indexOf("EXECUTE 'TRUNCATE TABLE "))
    for (const stmt of [
      "DELETE FROM public.users;",
      "DELETE FROM public.organizations;",
      "DELETE FROM auth.identities;",
      "DELETE FROM auth.users;",
    ]) {
      expect(body, `thiếu nhánh trắng tinh: ${stmt}`).toContain(stmt)
    }
    // Và nhánh giữ-chủ vẫn phải lọc theo đúng người.
    expect(body).toContain("WHERE id <> keep_user")
    expect(body).toContain("WHERE user_id <> keep_user")
  })

  /** Trắng tinh xong thì phải có đường dựng lại, nếu không là khoá chết. */
  it("chỉ ra đường dựng lại sau khi xoá trắng", () => {
    expect(reset).toContain("bootstrap_owner.sql")
  })

  /**
   * ⚠ GIỮ ORG LẠI LÀ GIỮ LUÔN DANH TÍNH NPP CŨ. `organizations.name` là
   * tên công ty, và `settings` chứa mã số thuế, địa chỉ, điện thoại,
   * email. Bàn giao mà để nguyên thì người nhận mở app thấy thông tin của
   * người khác — và mọi phiếu in ra mang thông tin đó.
   */
  it("tẩy tên công ty, MST, địa chỉ của NPP cũ", () => {
    expect(reset).toMatch(/scrub_identity\s+boolean\s*:=\s*true;/)
    const block = reset.slice(reset.indexOf("IF keep_owner AND scrub_identity"))
    expect(block).toContain("UPDATE public.organizations")
    expect(block).toContain("name           = new_org_name")
    expect(block).toContain("slug           = new_org_slug")
    // settings chứa MST/địa chỉ/SĐT — phải xoá cả cụm, không sửa lẻ.
    expect(block).toContain("settings       = '{}'::jsonb")
  })

  /**
   * Xoá `setup_completed_at` thì banner hướng dẫn hiện lại và chủ mới
   * được dẫn qua /setup. Không xoá thì họ không bao giờ thấy màn đó, và
   * thông tin công ty cũ nằm im trong hoá đơn.
   */
  it("xoá cờ setup để chủ mới được dẫn qua màn cài đặt", () => {
    const banner = read("src/components/setup/setup-banner.tsx")
    expect(banner).toContain("setup_completed_at")
    // Cờ nằm trong settings, nên xoá sạch settings là xoá luôn cờ.
    expect(reset).toContain("setup_completed_at")
  })

  /** Hồ sơ cá nhân của chủ cũ cũng là danh tính. */
  it("xoá tên / SĐT / username của chủ cũ", () => {
    const block = reset.slice(reset.indexOf("IF keep_owner AND scrub_identity"))
    expect(block).toContain("UPDATE public.users")
    expect(block).toContain("full_name = new_owner_name")
    expect(block).toContain("phone     = NULL")
    expect(block).toContain("username  = NULL")
  })

  /**
   * ⚠ VẾ NGƯỢC LẠI, quan trọng không kém: email + mật khẩu ở auth.users
   * là ĐƯỜNG ĐĂNG NHẬP đang cần giữ. Tẩy nhầm nó là khoá luôn tài khoản
   * vừa cố tình giữ lại.
   */
  it("KHÔNG đụng vào email/mật khẩu đăng nhập", () => {
    const block = reset.slice(reset.indexOf("IF keep_owner AND scrub_identity"))
    expect(block).not.toMatch(/UPDATE auth\.users/)
    expect(block).not.toMatch(/encrypted_password/)
  })
})

describe("Cài mới trên project trống — bootstrap", () => {
  const boot = read("supabase/bootstrap_owner.sql")
  const install = read("supabase/INSTALL.md")

  /**
   * ⚠ LỖ KHOÁ NGOÀI. Cài xong schema_full.sql thì có đủ 72 bảng nhưng
   * KHÔNG org nào, KHÔNG người dùng nào — và dự án không có trigger nào
   * trên auth.users, nên tạo tài khoản ở Dashboard cũng không sinh dòng
   * trong public.users. Thiếu bootstrap thì đăng nhập xong app đá về
   * /login mãi vì user_org_id() trả NULL.
   */
  it("không có trigger nào tự tạo public.users từ auth.users", () => {
    const withTrigger = MIGRATIONS.filter((f) =>
      /CREATE\s+TRIGGER[\s\S]{0,200}?ON\s+auth\.users/i.test(read(`supabase/migrations/${f}`))
    )
    // Nếu về sau thêm trigger đó thì bootstrap_owner.sql thành thừa —
    // test này đỏ để nhắc xem lại, chứ không phải để cấm.
    expect(withTrigger, "có trigger rồi thì sửa lại INSTALL.md bước 4").toEqual([])
  })

  /** Chạy nhầm trên DB đang hoạt động sẽ đẻ org thứ hai, vô hình vì RLS. */
  it("chặn trước khi tạo: DB đã có người, hoặc chưa có tài khoản đăng nhập", () => {
    expect(boot).toContain("IF EXISTS (SELECT 1 FROM public.users)")
    expect(boot).toContain("FROM auth.users WHERE lower(email) = lower(owner_email)")
    const firstInsert = boot.indexOf("INSERT INTO public.organizations")
    expect(boot.indexOf("RAISE EXCEPTION")).toBeLessThan(firstInsert)
    expect(boot.lastIndexOf("RAISE EXCEPTION")).toBeLessThan(firstInsert)
  })

  /** users.id PHẢI dùng chung id với auth.users — đó là cách RLS nối phiên. */
  it("chủ NPP dùng chung id với tài khoản đăng nhập", () => {
    expect(boot).toContain("INSERT INTO public.users (id, org_id, full_name, role, is_active)")
    expect(boot).toContain("VALUES (owner_id, new_org")
    expect(boot).toContain("'owner'")
  })

  /** Không chép nội dung 03 vào đây — hai bản sao là hai cơ hội để lệch. */
  it("không chép lại phần seed cấu hình mặc định", () => {
    expect(boot).not.toContain("INSERT INTO sales_routes")
    expect(boot).not.toContain("INSERT INTO expense_categories")
    expect(boot).toContain("03_reseed_defaults.sql")
  })

  /**
   * ⚠ Tài liệu ghi số đo được (72 bảng / 167 policy / 3 bucket). Số đó
   * trôi theo migration mới mà không ai sửa thì người cài tưởng mình cài
   * hỏng. Buộc nó khớp với schema_full.sql hiện tại.
   */
  it("số trong INSTALL.md khớp schema_full.sql", () => {
    const schemaFull = read("supabase/schema_full.sql")
    const count = (re: RegExp) => (schemaFull.match(re) || []).length
    const buckets = new Set<string>()
    const bRe = /INSERT INTO storage\.buckets[\s\S]{0,200}?VALUES\s*\(\s*'([a-z0-9-]+)'/gi
    let bm: RegExpExecArray | null
    while ((bm = bRe.exec(schemaFull)) !== null) buckets.add(bm[1])

    // Bảng: đếm CREATE TABLE trong schema gộp.
    const tables = count(/^CREATE TABLE (IF NOT EXISTS )?(public\.)?[a-z_]+/gim)
    expect(install, `INSTALL.md phải ghi ${tables} bảng`).toContain(`| **${tables}** |`)
    expect(install, `INSTALL.md phải ghi ${buckets.size} bucket`).toContain(`**${buckets.size}** (`)
    for (const b of Array.from(buckets)) expect(install, `thiếu bucket ${b}`).toContain(b)
  })

  /** Seed demo có 6 tài khoản mật khẩu công khai. */
  it("INSTALL.md cảnh báo KHÔNG chạy seed demo", () => {
    expect(install).toContain("seed_demo.sql")
    expect(install).toContain("Demo@123456")
    expect(install).toMatch(/KHÔNG chạy[\s\S]{0,40}seed_demo/)
  })

  /** Service role key lọt vào NEXT_PUBLIC_* là mở toang database. */
  it("INSTALL.md liệt kê đủ biến môi trường app thật sự đọc", () => {
    for (const v of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "NEXT_PUBLIC_APP_URL",
      "EINVOICE_ENC_KEY",
      "CRON_SECRET",
    ]) {
      expect(install, `INSTALL.md thiếu ${v}`).toContain(v)
    }
    expect(install).toMatch(/CHỈ server/)
  })

  /** Lịch trong tài liệu phải là lịch thật trong vercel.json. */
  it("lịch cron trong INSTALL.md khớp vercel.json", () => {
    const crons = (JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] }).crons
    expect(crons).toHaveLength(1)
    expect(install).toContain(crons[0].path)
    expect(install).toContain(crons[0].schedule)
  })
})

describe("Script dọn Storage", () => {
  const st = read("scripts/reset-storage.ts")

  /** Thao tác hàng loạt không hoàn tác được thì phải XEM TRƯỚC. */
  it("mặc định chỉ xem trước, phải có --yes mới xoá", () => {
    expect(st).toContain('process.argv.includes("--yes")')
    const removeAt = st.indexOf(".remove(chunk)")
    expect(removeAt).toBeGreaterThan(0)
    // Lệnh xoá phải nằm sau một cửa chặn CONFIRM.
    expect(st.slice(0, removeAt)).toContain("if (!CONFIRM")
  })

  /**
   * ⚠ Storage list KHÔNG đệ quy và có phân trang. Không đi vào thư mục con
   * thì ảnh nằm trong org/<id>/… không bao giờ được liệt kê — script báo
   * "đã sạch" trong khi ảnh còn nguyên.
   */
  it("đi hết thư mục con và hết trang", () => {
    expect(st).toContain("listAll(bucket, path)")
    expect(st).toContain("entry.id === null")
    expect(st).toContain("offset")
  })

  /** Đếm lại từ đầu, không tin biến đếm của chính mình. */
  it("kiểm lại sau khi xoá và báo lỗi nếu còn sót", () => {
    expect(st).toContain("left > 0")
    expect(st).toMatch(/process\.exit\(1\)/)
  })

  /** service_role bỏ qua RLS — nhầm sang anon là script im lặng không xoá gì. */
  it("dùng service role key, không dùng anon", () => {
    expect(st).toContain("SUPABASE_SERVICE_ROLE_KEY")
    expect(st).not.toContain("ANON_KEY")
  })
})
