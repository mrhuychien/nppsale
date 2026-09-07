import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import {
  MAX_PHOTOS,
  MAX_PIN_ACCURACY_M,
  FAR_WARN_METERS,
  REMINDER_COOLDOWN_DAYS,
  nextFreeSlot,
  haversineMeters,
  shouldPinCustomer,
  farFromStore,
  planReminders,
  reminderText,
  type ReminderCandidate,
} from "../src/lib/customers/photos"
import { stampLines, MAX_EDGE } from "../src/lib/images/prepare"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
/** Quét theo dòng — xem ghi chú ở tests/mobile-actions-lines.test.ts. */
const strip = (s: string) => {
  const out: string[] = []
  let inBlock = false
  for (const line of s.split("\n")) {
    const t = line.trim()
    if (inBlock) { if (t.includes("*/")) inBlock = false; continue }
    if (t.startsWith("{/*") || t.startsWith("/*")) { if (!t.includes("*/")) inBlock = true; continue }
    if (t.startsWith("*") || t.startsWith("//")) continue
    out.push(line)
  }
  return out.join("\n")
}
function migration(namePart: string): string {
  const dir = resolve(ROOT, "supabase/migrations")
  const hit = readdirSync(dir).filter((f) => f.includes(namePart)).sort().pop()
  if (!hit) throw new Error(`không tìm thấy migration chứa "${namePart}"`)
  return readFileSync(resolve(dir, hit), "utf-8")
}

// =====================================================================
describe("Ô ảnh", () => {
  it("lấy ô trống đầu tiên, tối đa 3", () => {
    expect(nextFreeSlot([])).toBe(1)
    expect(nextFreeSlot([1])).toBe(2)
    expect(nextFreeSlot([1, 2])).toBe(3)
    expect(nextFreeSlot([1, 2, 3])).toBeNull()
  })

  /**
   * ⚠ Lấy `max + 1` thì sau vài lần thay ảnh sẽ hết ô trong khi điểm bán
   * mới có 2 tấm — xoá ảnh 2 rồi chụp lại phải quay về ô 2.
   */
  it("lấp lại ô ĐÃ XOÁ, không nhảy lên ô kế tiếp", () => {
    expect(nextFreeSlot([1, 3])).toBe(2)
    expect(nextFreeSlot([2, 3])).toBe(1)
  })

  it("khớp trần với migration", () => {
    expect(MAX_PHOTOS).toBe(3)
    expect(migration("103_customer_photos")).toContain("slot BETWEEN 1 AND 3")
  })
})

// =====================================================================
describe("Khoảng cách", () => {
  it("cùng một điểm thì bằng 0", () => {
    expect(haversineMeters(20.85, 106.68, 20.85, 106.68)).toBeCloseTo(0, 6)
  })

  /** ~111km cho 1 độ vĩ tuyến — mốc kiểm tra đơn vị là MÉT, không phải km. */
  it("một độ vĩ tuyến ≈ 111km, trả về mét", () => {
    const d = haversineMeters(20, 106, 21, 106)
    expect(d).toBeGreaterThan(110_000)
    expect(d).toBeLessThan(112_000)
  })
})

// =====================================================================
describe("Ghim vị trí điểm bán", () => {
  /**
   * ⚠ Đè lên toạ độ đã có là DỜI điểm bán đi chỗ khác mà không ai biết —
   * NVBH chụp lại ảnh khi đang đứng đầu ngõ là đủ để phá.
   */
  it("KHÔNG ghim đè khi điểm bán đã có toạ độ", () => {
    const r = shouldPinCustomer({ lat: 20.85, lng: 106.68 }, { lat: 21, lng: 107, accuracy: 5 })
    expect(r.pin).toBe(false)
    expect(r.reason).toContain("đã có toạ độ")
  })

  it("ghim khi điểm bán chưa có toạ độ và sai số chấp nhận được", () => {
    expect(shouldPinCustomer({ lat: null, lng: null }, { lat: 20.85, lng: 106.68, accuracy: 12 }).pin).toBe(true)
  })

  /** ⚠ Sai số 500m chỉ ra cái phường, không chỉ ra cửa hàng. */
  it("không ghim khi sai số quá lớn", () => {
    const r = shouldPinCustomer({ lat: null, lng: null }, { lat: 20.85, lng: 106.68, accuracy: MAX_PIN_ACCURACY_M + 1 })
    expect(r.pin).toBe(false)
    expect(r.reason).toContain("sai số")
  })

  it("không có vị trí thì không ghim", () => {
    expect(shouldPinCustomer({ lat: null, lng: null }, null).pin).toBe(false)
  })

  /** Sai số không rõ (máy không báo) vẫn ghim — có còn hơn không. */
  it("máy không báo sai số thì vẫn ghim", () => {
    expect(shouldPinCustomer({ lat: null, lng: null }, { lat: 20.85, lng: 106.68 }).pin).toBe(true)
  })
})

describe("Cảnh báo chụp xa điểm bán", () => {
  it("gần thì không cảnh báo", () => {
    expect(farFromStore({ lat: 20.85, lng: 106.68 }, { lat: 20.8501, lng: 106.6801 })).toBeNull()
  })

  it("xa quá ngưỡng thì trả số mét", () => {
    const d = farFromStore({ lat: 20.85, lng: 106.68 }, { lat: 20.86, lng: 106.68 })
    expect(d).not.toBeNull()
    expect(d!).toBeGreaterThan(FAR_WARN_METERS)
  })

  /** Chưa ghim điểm bán thì không có gì để so — đừng bịa cảnh báo. */
  it("điểm bán chưa có toạ độ thì không cảnh báo", () => {
    expect(farFromStore({ lat: null, lng: null }, { lat: 20.85, lng: 106.68 })).toBeNull()
  })
})

// =====================================================================
const cand = (o: Partial<ReminderCandidate> & { id: string }): ReminderCandidate => ({
  storeName: o.id, photoCount: 0, hasGps: false, reminderSentAt: null, repId: "r1", ...o,
})
const NOW = Date.parse("2026-09-07T08:00:00Z")

describe("Chọn điểm bán để nhắc", () => {
  it("đủ ảnh VÀ có vị trí thì thôi", () => {
    const p = planReminders([cand({ id: "a", photoCount: 3, hasGps: true })], NOW)
    expect(p.byRep).toHaveLength(0)
  })

  /**
   * ⚠ Ảnh không kèm vị trí thì không dẫn được ai tới đó; vị trí không có
   * ảnh thì tới nơi không biết mặt tiền nào. Thiếu MỘT trong hai là nhắc.
   */
  it("thiếu ảnh HOẶC thiếu vị trí đều nhắc", () => {
    const p = planReminders(
      [cand({ id: "khong-anh", photoCount: 0, hasGps: true }),
       cand({ id: "khong-gps", photoCount: 2, hasGps: false })],
      NOW
    )
    expect(p.byRep[0].customers.map((c) => c.id).sort()).toEqual(["khong-anh", "khong-gps"])
  })

  /** Một tấm kèm vị trí đã dùng được — không ép cho đủ 3. */
  it("một ảnh kèm vị trí là đủ, không nhắc nữa", () => {
    const p = planReminders([cand({ id: "a", photoCount: 1, hasGps: true })], NOW)
    expect(p.byRep).toHaveLength(0)
  })

  /**
   * ⚠ 80 điểm bán mới = 80 thông báo thì người ta tắt chuông. Gộp theo
   * NVBH để còn một thông báo đọc được.
   */
  it("gộp theo NVBH, mỗi người một nhóm", () => {
    const p = planReminders(
      [cand({ id: "a", repId: "r1" }), cand({ id: "b", repId: "r1" }), cand({ id: "c", repId: "r2" })],
      NOW
    )
    expect(p.byRep).toHaveLength(2)
    expect(p.byRep.find((g) => g.repId === "r1")!.customers).toHaveLength(2)
  })

  /** Không ai phụ trách thì không nhắc ai được — tách ra để báo cáo. */
  it("điểm bán chưa có người phụ trách tách riêng, không mất tăm", () => {
    const p = planReminders([cand({ id: "a", repId: null })], NOW)
    expect(p.byRep).toHaveLength(0)
    expect(p.unassigned.map((c) => c.id)).toEqual(["a"])
  })

  /** ⚠ Nhắc lại mỗi ngày là cách nhanh nhất để bị bỏ qua. */
  it("đã nhắc trong 7 ngày thì bỏ qua lượt này", () => {
    const recent = new Date(NOW - 2 * 86_400_000).toISOString()
    const p = planReminders([cand({ id: "a", reminderSentAt: recent })], NOW)
    expect(p.byRep).toHaveLength(0)
    expect(p.cooledDown).toBe(1)
  })

  it("quá hạn hạ nhiệt thì nhắc lại", () => {
    const old = new Date(NOW - (REMINDER_COOLDOWN_DAYS + 1) * 86_400_000).toISOString()
    const p = planReminders([cand({ id: "a", reminderSentAt: old })], NOW)
    expect(p.byRep[0].customers).toHaveLength(1)
  })

  /**
   * ⚠ Một ô dữ liệu hỏng không được làm điểm bán im lặng vĩnh viễn —
   * thà nhắc thừa một lần.
   */
  it("mốc thời gian hỏng thì coi như chưa nhắc", () => {
    const p = planReminders([cand({ id: "a", reminderSentAt: "hôm qua" })], NOW)
    expect(p.byRep[0].customers).toHaveLength(1)
  })
})

describe("Nội dung nhắc", () => {
  it("nêu tên 3 điểm đầu rồi gộp phần còn lại", () => {
    const t = reminderText([1, 2, 3, 4, 5].map((i) => cand({ id: `c${i}`, storeName: `Quán ${i}` })))
    expect(t.title).toContain("5 điểm bán")
    expect(t.body).toContain("Quán 1, Quán 2, Quán 3")
    expect(t.body).toContain("và 2 điểm nữa")
  })

  it("ít hơn 3 điểm thì không có đuôi thừa", () => {
    const t = reminderText([cand({ id: "c1", storeName: "Quán 1" })])
    expect(t.body).not.toContain("điểm nữa")
  })
})

// =====================================================================
describe("Dấu đóng trên ảnh", () => {
  const at = new Date(2026, 8, 7, 14, 5)

  it("có tên điểm bán, ngày giờ và toạ độ", () => {
    const l = stampLines({ takenAt: at, lat: 20.851234, lng: 106.681234, accuracy: 8, title: "Tạp hoá Cô Ba" })
    expect(l[0]).toBe("Tạp hoá Cô Ba")
    expect(l[1]).toBe("07/09/2026 14:05")
    expect(l[2]).toContain("20.851234, 106.681234")
    expect(l[2]).toContain("±8m")
  })

  /**
   * ⚠ Ảnh không có vị trí trông y hệt ảnh có, nếu để trống. Người duyệt
   * sau này không phân biệt được.
   */
  it("thiếu toạ độ thì NÓI RA trên ảnh", () => {
    const l = stampLines({ takenAt: at })
    expect(l.join(" ")).toContain("Không có vị trí")
  })

  it("giờ có số 0 đứng đầu, không phải 7/9/2026 4:5", () => {
    const l = stampLines({ takenAt: new Date(2026, 0, 3, 4, 5) })
    expect(l[0]).toBe("03/01/2026 04:05")
  })
})

// =====================================================================
describe("Migration 103", () => {
  const MIG = migration("103_customer_photos")

  /** ⚠ Đếm-rồi-chèn là hai bước; hai người bấm cùng lúc lọt ảnh thứ tư. */
  it("ép trần 3 ảnh bằng ràng buộc khai báo, không bằng trigger đếm", () => {
    expect(MIG).toContain("slot BETWEEN 1 AND 3")
    expect(MIG).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_photos_slot")
    expect(MIG).not.toMatch(/CREATE (OR REPLACE )?FUNCTION.*count/i)
  })

  /** Xoá khách thì ảnh phải đi theo, không để lại rác trỏ vào hư không. */
  it("ảnh xoá theo khách", () => {
    const i = MIG.indexOf("customer_id uuid NOT NULL REFERENCES customers")
    expect(MIG.slice(i, i + 120)).toContain("ON DELETE CASCADE")
  })

  /**
   * ⚠ Tên ràng buộc CHECK do Postgres tự sinh; đoán sai thì DROP âm thầm
   * không làm gì và loại thông báo mới vẫn bị chặn.
   */
  it("tra tên ràng buộc trong pg_constraint, không đoán", () => {
    expect(MIG).toContain("FROM pg_constraint con")
    expect(MIG).toContain("pg_get_constraintdef(con.oid) ILIKE")
    expect(MIG).toContain("'customer_photo_missing'")
  })

  /** Toạ độ cho phép NULL: máy tắt định vị vẫn phải nộp được ảnh. */
  it("toạ độ được phép trống, thời gian chụp thì không", () => {
    expect(MIG).toMatch(/taken_at timestamptz NOT NULL/)
    expect(MIG).toMatch(/gps_lat numeric,/)
  })

  /** Ảnh điểm bán chụp mờ là chuyện thường — phải thay được. */
  /**
   * ⚠ Guard `policyname = 'X'` phải khớp tên ở `CREATE POLICY "X"`. Lệch
   * nhau thì guard không bao giờ thấy policy đã tồn tại, và lần chạy thứ
   * hai vỡ vì "policy already exists" — migration hết idempotent.
   */
  it("tên policy trong guard khớp tên lúc tạo", () => {
    // matchAll + spread cần downlevelIteration (tsconfig chưa bật) —
    // dùng vòng exec cho khỏi phụ thuộc cấu hình biên dịch.
    const all = (re: RegExp) => {
      const out: string[] = []
      let m: RegExpExecArray | null
      while ((m = re.exec(MIG)) !== null) out.push(m[1])
      return out
    }
    const created = all(/CREATE POLICY "([^"]+)" ON storage\.objects/g)
    const guarded = all(/policyname = '([^']+)'/g)
    expect(created.length, "không thấy CREATE POLICY nào cho storage").toBeGreaterThan(0)
    expect(created.sort()).toEqual(guarded.sort())
  })

  it("bucket ảnh điểm bán CÓ quyền xoá", () => {
    // Soi cả CÂU LỆNH, không chỉ cái tên: đổi tên policy thành
    // "customer_photos_delete_disabled" vẫn chứa chuỗi "customer_photos_
    // delete" nên assert theo tên trần vẫn xanh khi quyền đã tắt (đã đo).
    expect(MIG).toContain('CREATE POLICY "customer_photos_delete" ON storage.objects')
    expect(MIG).toContain("FOR DELETE TO authenticated")
    expect(MIG).toContain("(split_part(name, '/', 1))::uuid = public.user_org_id()")
  })
})

// =====================================================================
describe("Màn chụp ảnh", () => {
  const CAP = strip(read("src/components/customers/customer-photo-capture.tsx"))

  /** ⚠ Bắt bấm thêm nút là một lý do để NVBH bỏ qua vị trí. */
  it("lấy vị trí TỰ ĐỘNG khi mở, không chờ bấm", () => {
    expect(CAP).toContain("useEffect(() => { readFix() }, [readFix])")
    expect(CAP).toContain("enableHighAccuracy: true")
  })

  /** ⚠ Không lấy được vị trí mà chặn luôn thì mất cả tấm ảnh. */
  it("không có vị trí vẫn chụp và lưu được", () => {
    expect(CAP).toContain("gps_lat: fix?.lat ?? null")
    const i = CAP.indexOf("const handleFile")
    const fn = CAP.slice(i, CAP.indexOf("const handleDelete"))
    expect(fn).not.toMatch(/if \(!fix\)[\s\S]{0,80}return/)
  })

  /**
   * ⚠ Gọi new Date() hai lần thì dấu trên ảnh và cột taken_at lệch nhau
   * vài giây, về sau không biết cái nào đúng.
   */
  it("một mốc thời gian dùng cho cả dấu ảnh lẫn cột taken_at", () => {
    expect(CAP).toContain("const takenAt = new Date()")
    expect(CAP).toContain("taken_at: takenAt.toISOString()")
    expect(CAP).toContain("takenAt,")
    const i = CAP.indexOf("const handleFile")
    const fn = CAP.slice(i, CAP.indexOf("const handleDelete"))
    expect(fn.match(/new Date\(\)/g)?.length).toBe(1)
  })

  it("ghim vị trí điểm bán qua shouldPinCustomer, không tự viết luật", () => {
    expect(CAP).toContain("shouldPinCustomer(storeGps, fix)")
    expect(CAP).toContain("if (pin.pin && fix) {")
  })

  /** Nói trước điều sẽ xảy ra — ghim vị trí là thay đổi dữ liệu khách. */
  it("báo trước rằng ảnh này sẽ ghim vị trí", () => {
    expect(CAP).toContain("sẽ ghim luôn vị trí hiện tại")
  })

  it("mở thẳng camera sau và nén ảnh trước khi tải", () => {
    expect(CAP).toContain('capture="environment"')
    expect(CAP).toContain("await prepareImage(file, {")
    expect(MAX_EDGE).toBeLessThanOrEqual(1600)
  })
})

// =====================================================================
describe("Cron nhắc nhở", () => {
  const CRON = strip(read("src/app/api/customers/photo-reminders/route.ts"))

  /** ⚠ Route dùng admin client (bỏ qua RLS) — bí mật là hàng rào duy nhất. */
  it("xác thực bằng CRON_SECRET, không dùng phiên người dùng", () => {
    expect(CRON).toContain("requireCronSecret(req)")
    expect(CRON).toContain("if (denied) return denied")
    expect(CRON).not.toContain("createClient()")
  })

  /** ⚠ Admin client bỏ qua RLS: quên lọc org là rò dữ liệu sang NPP khác. */
  it("mọi truy vấn tự lọc org_id", () => {
    const i = CRON.indexOf("for (const org of")
    const body = CRON.slice(i)
    expect(body.match(/\.eq\("org_id", org\.id\)/g)?.length).toBeGreaterThanOrEqual(3)
  })

  /**
   * ⚠ Đóng dấu đã nhắc khi thông báo hỏng thì điểm bán im lặng thêm 7
   * ngày vì một thông báo chưa từng tới tay ai.
   */
  it("thông báo hỏng thì KHÔNG đóng dấu đã nhắc", () => {
    const i = CRON.indexOf("if (nErr) {")
    expect(i).toBeGreaterThan(0)
    const block = CRON.slice(i, CRON.indexOf("report.notified_reps++", i))
    expect(block).toContain("continue")
  })

  it("một mốc thời gian cho cả lượt chạy", () => {
    expect(CRON).toContain("const now = Date.now()")
    expect(CRON.match(/Date\.now\(\)/g)?.length).toBe(1)
  })

  /** Chạm trần mà im lặng thì nửa số điểm bán không bao giờ được nhắc. */
  it("nói ra khi chạm trần", () => {
    expect(CRON).toContain("hit_cap")
    expect(CRON).toContain("report.unassigned +=")
  })

  it("đã đăng ký lịch chạy", () => {
    const vercel = JSON.parse(read("vercel.json")) as { crons: Array<{ path: string; schedule: string }> }
    const hit = vercel.crons.find((c) => c.path === "/api/customers/photo-reminders")
    expect(hit, "chưa khai báo cron trong vercel.json").toBeTruthy()
  })
})

// =====================================================================
describe("Màn danh sách còn thiếu", () => {
  const PAGE = strip(read("src/app/(dashboard)/customers/missing-photos/page.tsx"))

  /**
   * ⚠ Nút chỉ đường trỏ vào toạ độ rỗng là dẫn người ta đi lạc. Chưa
   * ghim thì đi theo ĐỊA CHỈ, và nói rõ là theo địa chỉ.
   */
  it("chỉ đường theo toạ độ khi có, theo địa chỉ khi chưa ghim", () => {
    expect(PAGE).toContain("{!noGps ? (")
    expect(PAGE).toContain("destination=${r.gps_lat},${r.gps_lng}")
    expect(PAGE).toContain("destination=${encodeURIComponent(r.address)}")
    expect(PAGE).toContain("Không có địa chỉ")
  })

  /** Địa chỉ Việt Nam có dấu và dấu phẩy — không encode là link hỏng. */
  it("encode địa chỉ trước khi nhét vào URL", () => {
    expect(PAGE).toContain("encodeURIComponent(r.address)")
  })

  it("lọc đúng: thiếu ảnh HOẶC thiếu toạ độ", () => {
    expect(PAGE).toContain("c.photoCount === 0 || c.gps_lat == null || c.gps_lng == null")
  })

  it("nói ra khi chạm trần nạp", () => {
    expect(PAGE).toContain("setTruncated(customers.length >= CAP)")
    expect(PAGE).toContain("chạm trần")
  })

  /** Thông báo phải dẫn tới đúng màn này, không dẫn vào hư không. */
  it("thông báo trỏ đúng đường dẫn màn này", () => {
    const CRON = read("src/app/api/customers/photo-reminders/route.ts")
    expect(CRON).toContain('link_url: "/customers/missing-photos"')
  })
})

// =====================================================================
describe("Loại thông báo mới hiện được", () => {
  /**
   * ⚠ Thêm loại vào DB mà quên map icon thì thông báo hiện ra trống
   * trơn — hoặc component nổ vì đọc thuộc tính của undefined.
   */
  it("có mặt ở cả chuông và trang thông báo", () => {
    expect(read("src/components/layout/notification-bell.tsx")).toContain("customer_photo_missing:")
    expect(read("src/app/(dashboard)/notifications/page.tsx")).toContain("customer_photo_missing:")
    expect(read("src/types/index.ts")).toContain('| "customer_photo_missing"')
  })
})
