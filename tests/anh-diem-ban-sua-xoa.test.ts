/**
 * SỬA / CẬP NHẬT LẠI / XOÁ ảnh + vị trí điểm bán — chủ nhà 12/10/2026: "phần cập nhật ảnh kèm định vị cho điểm bán.
 * chưa sửa, cập nhật lại, xoá ảnh + vị trí cũ".
 *   · luật thuần (src/lib/customers/photos.ts): dời vị trí, ảnh nào đã ghim vị trí, đường dẫn file trong kho;
 *   · API xoá file (/api/customers/photo-cleanup): chỉ xoá file của đúng đơn vị, không còn dòng nào trỏ tới;
 *   · màn chụp ảnh: chụp lại = sửa dòng tại chỗ rồi mới xoá file cũ.
 * Bấm thật trên màn hình: e2e/anh-diem-ban-sua-xoa.spec.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  CUSTOMER_PHOTO_BUCKET,
  MANAGE_PHOTO_ROLES,
  MAX_PIN_ACCURACY_M,
  canRepinStore,
  distanceText,
  isStorePinFromPhoto,
  parseOrgPhotoPath,
  photoStoragePath,
  repinQuestion,
} from "@/lib/customers/photos"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")

const ORG = "00000000-0000-4000-8000-0000000000a1"
const ORG_KHAC = "00000000-0000-4000-8000-0000000000a2"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const KHACH_2 = "00000000-0000-4000-8000-0000000000c2"
const URL_GOC = "https://abc.supabase.co/storage/v1/object/public/customer-photos/"

describe("Dời vị trí điểm bán theo chỗ đang đứng (canRepinStore)", () => {
  it("được ĐÈ toạ độ cũ khi người dùng bấm — nói ra dời bao xa", () => {
    const r = canRepinStore({ lat: 20.85, lng: 106.68 }, { lat: 20.851, lng: 106.68, accuracy: 8 })
    expect(r.ok).toBe(true)
    expect(r.movedMeters).toBeGreaterThan(105)
    expect(r.movedMeters).toBeLessThan(117)
  })
  it("điểm bán chưa có toạ độ: ghim được, không có 'dời bao xa'", () => {
    expect(canRepinStore({ lat: null, lng: null }, { lat: 20.85, lng: 106.68, accuracy: 5 })).toEqual({ ok: true, reason: "", movedMeters: null })
  })
  it("không có vị trí máy hoặc sai số quá ngưỡng ghim → không nhận, có lý do", () => {
    expect(canRepinStore({ lat: 20.85, lng: 106.68 }, null)).toMatchObject({ ok: false, reason: "Chưa lấy được vị trí của máy" })
    const r = canRepinStore({ lat: null, lng: null }, { lat: 20.85, lng: 106.68, accuracy: MAX_PIN_ACCURACY_M + 1 })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain(`±${MAX_PIN_ACCURACY_M + 1}m`)
    // Đúng ngưỡng vẫn nhận; máy không báo sai số vẫn nhận (như luật tự ghim).
    expect(canRepinStore({ lat: null, lng: null }, { lat: 20.85, lng: 106.68, accuracy: MAX_PIN_ACCURACY_M }).ok).toBe(true)
    expect(canRepinStore({ lat: null, lng: null }, { lat: 20.85, lng: 106.68 }).ok).toBe(true)
  })
  it("câu hỏi xác nhận: toạ độ mới, sai số, khoảng dời", () => {
    expect(repinQuestion({ lat: 20.851234, lng: 106.681234, accuracy: 7.6 }, 1234)).toBe(
      "Dời điểm bán về chỗ bạn đang đứng: 20.85123, 106.68123 (±8m) — cách vị trí cũ khoảng 1,2 km."
    )
    expect(repinQuestion({ lat: 20.85, lng: 106.68 }, null)).toBe("Ghim điểm bán vào chỗ bạn đang đứng: 20.85000, 106.68000.")
    expect([distanceText(0), distanceText(999.4), distanceText(12_345)]).toEqual(["0m", "999m", "12,3 km"])
  })
})

describe("Ảnh nào đã ghim vị trí điểm bán (isStorePinFromPhoto)", () => {
  it("cùng toạ độ (lệch ≤ 1m) là ảnh đã ghim; lệch vài mét là không", () => {
    expect(isStorePinFromPhoto({ lat: 20.85, lng: 106.68 }, { gps_lat: 20.85, gps_lng: 106.68 })).toBe(true)
    expect(isStorePinFromPhoto({ lat: 20.85, lng: 106.68 }, { gps_lat: 20.850005, gps_lng: 106.68 })).toBe(true)
    expect(isStorePinFromPhoto({ lat: 20.85, lng: 106.68 }, { gps_lat: 20.85005, gps_lng: 106.68 })).toBe(false)
  })
  it("thiếu toạ độ bên nào cũng là không", () => {
    expect(isStorePinFromPhoto({ lat: null, lng: null }, { gps_lat: 20.85, gps_lng: 106.68 })).toBe(false)
    expect(isStorePinFromPhoto({ lat: 20.85, lng: 106.68 }, { gps_lat: null, gps_lng: null })).toBe(false)
  })
  it("cột numeric về dạng chuỗi vẫn so được", () => {
    expect(isStorePinFromPhoto({ lat: "20.85" as unknown as number, lng: 106.68 }, { gps_lat: 20.85, gps_lng: "106.68" as unknown as number })).toBe(true)
  })
})

describe("Đường dẫn file trong kho (photoStoragePath / parseOrgPhotoPath)", () => {
  it("URL công khai → đường dẫn trong kho; bỏ ?query, giải mã %xx", () => {
    expect(photoStoragePath(`${URL_GOC}${ORG}/${KHACH}/1-1700.jpg`)).toBe(`${ORG}/${KHACH}/1-1700.jpg`)
    expect(photoStoragePath(`${URL_GOC}${ORG}/${KHACH}/1-1700.jpg?t=1#x`)).toBe(`${ORG}/${KHACH}/1-1700.jpg`)
    expect(photoStoragePath(`${URL_GOC}${ORG}/${KHACH}/a%20b.jpg`)).toBe(`${ORG}/${KHACH}/a b.jpg`)
  })
  it("URL lạ (kho khác, có '..', rỗng) → null: không đoán, không xoá nhầm", () => {
    expect(photoStoragePath("https://abc.supabase.co/storage/v1/object/public/visit-photos/x/y.jpg")).toBeNull()
    expect(photoStoragePath(`${URL_GOC}${ORG}/../${ORG_KHAC}/1-1.jpg`)).toBeNull()
    expect(photoStoragePath(`${URL_GOC}%2F${ORG}/1.jpg`)).toBeNull()
    expect(photoStoragePath(`${URL_GOC}%E0%A4%A`)).toBeNull()
    expect(photoStoragePath(null)).toBeNull()
    expect(photoStoragePath(URL_GOC)).toBeNull()
  })
  it("chỉ nhận file đúng khuôn app tải lên, của ĐÚNG đơn vị", () => {
    expect(parseOrgPhotoPath(`${ORG}/${KHACH}/2-1700000000000.jpg`, ORG)).toEqual({ customerId: KHACH })
    expect(parseOrgPhotoPath(`${ORG.toUpperCase()}/${KHACH}/2-1.jpg`, ORG)).toEqual({ customerId: KHACH })
    expect(parseOrgPhotoPath(`${ORG_KHAC}/${KHACH}/2-1.jpg`, ORG), "file của đơn vị khác").toBeNull()
    expect(parseOrgPhotoPath(`${ORG}/../${ORG_KHAC}/${KHACH}/2-1.jpg`, ORG)).toBeNull()
    expect(parseOrgPhotoPath(`${ORG}/${KHACH}/x/2-1.jpg`, ORG), "thư mục lạ").toBeNull()
    expect(parseOrgPhotoPath(`${ORG}/${KHACH}/2-1.png`, ORG)).toBeNull()
    expect(parseOrgPhotoPath(`${ORG}/khach/2-1.jpg`, ORG)).toBeNull()
    expect(parseOrgPhotoPath(`/${ORG}/${KHACH}/2-1.jpg`, ORG)).toBeNull()
  })
})

describe("Quyền và kho khớp migration 103", () => {
  const MIG = read("supabase/migrations/103_customer_photos.sql")
  it("vai trò được quản lý ảnh = policy 'Manage customer photos'", () => {
    const i = MIG.indexOf('CREATE POLICY "Manage customer photos"')
    expect(MIG.slice(i, i + 400)).toContain(`public.user_role() IN (${MANAGE_PHOTO_ROLES.map((r) => `'${r}'`).join(", ")})`)
  })
  it("tên kho", () => {
    expect(MIG).toContain(`VALUES ('${CUSTOMER_PHOTO_BUCKET}', '${CUSTOMER_PHOTO_BUCKET}', true)`)
  })
})

/* ── API xoá file ─────────────────────────────────────────────────────────────────────────── */
const st = {
  user: { id: "nv" } as { id: string } | null,
  me: { role: "sales", org_id: ORG } as { role: string; org_id: string | null } | null,
  rows: [] as Array<{ photo_url: string | null }>,
  refErr: null as { message: string } | null,
  /** Ảnh mới của yêu cầu đang chờ duyệt (mig 244). */
  choRows: [] as Array<{ photo_url: string | null }>,
  choErr: null as { message: string; code?: string } | null,
  rmErr: null as { message: string } | null,
}
const goi = { from: [] as string[], eq: [] as unknown[][], in: [] as unknown[][], bucket: [] as string[] }
const remove = vi.fn(async (paths: string[]) => ({ data: paths.map((name) => ({ name })), error: st.rmErr }))
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({
    auth: { getUser: async () => ({ data: { user: st.user } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: st.me, error: null }) }) }) }),
  }),
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) => {
      goi.from.push(t)
      const q = {
        select: () => q,
        eq: (...a: unknown[]) => {
          goi.eq.push([t, ...a])
          return q
        },
        in: async (...a: unknown[]) => {
          goi.in.push([t, ...a])
          return t === "customer_photo_requests" ? { data: st.choRows, error: st.choErr } : { data: st.rows, error: st.refErr }
        },
      }
      return q
    },
    storage: {
      from: (b: string) => {
        goi.bucket.push(b)
        return { remove }
      },
    },
  }),
}))

const goiApi = async (body: unknown) => {
  const { POST } = await import("@/app/api/customers/photo-cleanup/route")
  return POST(new Request("http://x/api/customers/photo-cleanup", { method: "POST", body: JSON.stringify(body) }))
}

describe("POST /api/customers/photo-cleanup", () => {
  const A = `${ORG}/${KHACH}/1-100.jpg`
  const B = `${ORG}/${KHACH}/2-200.jpg`
  const C = `${ORG_KHAC}/${KHACH}/1-300.jpg`
  const D = `${ORG}/../${ORG_KHAC}/${KHACH}/1-400.jpg`
  const E = `${ORG}/${KHACH_2}/3-500.jpg`
  beforeEach(() => {
    st.user = { id: "nv" }
    st.me = { role: "sales", org_id: ORG }
    st.rows = []
    st.refErr = null
    st.choRows = []
    st.choErr = null
    st.rmErr = null
    goi.from = []
    goi.eq = []
    goi.in = []
    goi.bucket = []
    remove.mockClear()
  })

  it("chỉ xoá file của ĐÚNG đơn vị mà KHÔNG còn dòng ảnh nào trỏ tới", async () => {
    st.rows = [{ photo_url: `${URL_GOC}${B}` }, { photo_url: null }]
    const res = await goiApi({ paths: [A, B, C, D, E, 123] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ removed: [A, E], skipped: [B, C, D] })
    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith([A, E])
    expect(goi.bucket).toEqual([CUSTOMER_PHOTO_BUCKET])
    // Tra dòng đang dùng: đúng bảng, đúng đơn vị, đúng các khách có trong đường dẫn — cả ảnh mới của yêu cầu đang chờ.
    expect(goi.from).toEqual(["customer_photos", "customer_photo_requests"])
    expect(goi.eq).toEqual([["customer_photos", "org_id", ORG], ["customer_photo_requests", "org_id", ORG], ["customer_photo_requests", "status", "pending"]])
    expect(goi.in).toEqual([["customer_photos", "customer_id", [KHACH, KHACH_2]], ["customer_photo_requests", "customer_id", [KHACH, KHACH_2]]])
  })

  it("ảnh MỚI của yêu cầu đang chờ duyệt (mig 244) là file đang dùng — không xoá", async () => {
    st.choRows = [{ photo_url: `${URL_GOC}${E}` }]
    const res = await goiApi({ paths: [A, E] })
    expect(await res.json()).toEqual({ removed: [A], skipped: [E] })
    expect(remove).toHaveBeenCalledWith([A])
  })

  it("máy chủ chưa chạy mig 244 (chưa có bảng yêu cầu) → bỏ qua phần ấy, vẫn dọn được; lỗi khác → 500 không xoá", async () => {
    st.choErr = { code: "PGRST205", message: "Could not find the table 'public.customer_photo_requests' in the schema cache" }
    expect(await (await goiApi({ paths: [A] })).json()).toEqual({ removed: [A], skipped: [] })
    remove.mockClear()
    st.choErr = { message: "mất mạng" }
    expect((await goiApi({ paths: [A] })).status).toBe(500)
    expect(remove).not.toHaveBeenCalled()
  })

  it("không có file nào hợp lệ thì không đụng tới kho", async () => {
    const res = await goiApi({ paths: [C, D, "", "abc"] })
    expect(await res.json()).toEqual({ removed: [], skipped: [C, D, "", "abc"] })
    expect(goi.from).toEqual([])
    expect(remove).not.toHaveBeenCalled()
  })

  it("mỗi lần tối đa 10 đường dẫn", async () => {
    const nhieu = Array.from({ length: 12 }, (_, i) => `${ORG}/${KHACH}/1-${i}.jpg`)
    await goiApi({ paths: nhieu })
    expect(remove).toHaveBeenCalledWith(nhieu.slice(0, 10))
  })

  it("tra dòng đang dùng hỏng → 500, KHÔNG liều xoá", async () => {
    st.refErr = { message: "mất mạng" }
    const res = await goiApi({ paths: [A] })
    expect(res.status).toBe(500)
    expect(remove).not.toHaveBeenCalled()
  })

  it("kho báo lỗi khi xoá → 500, không báo đã xoá", async () => {
    st.rmErr = { message: "storage down" }
    const res = await goiApi({ paths: [A] })
    expect(res.status).toBe(500)
    expect((await res.json()).removed).toBeUndefined()
  })

  it("chưa đăng nhập → 401; vai trò không được quản lý ảnh / chưa có đơn vị → 403", async () => {
    st.user = null
    expect((await goiApi({ paths: [A] })).status).toBe(401)
    st.user = { id: "kho" }
    for (const role of ["warehouse", "accountant", "driver"]) {
      st.me = { role, org_id: ORG }
      expect((await goiApi({ paths: [A] })).status, role).toBe(403)
    }
    st.me = { role: "owner", org_id: null }
    expect((await goiApi({ paths: [A] })).status).toBe(403)
    st.me = null
    expect((await goiApi({ paths: [A] })).status).toBe(403)
    expect(remove).not.toHaveBeenCalled()
    for (const role of MANAGE_PHOTO_ROLES) {
      st.me = { role, org_id: ORG }
      expect((await goiApi({ paths: [A] })).status, role).toBe(200)
    }
  })

  it("thân yêu cầu hỏng → không xoá gì, không nổ", async () => {
    const { POST } = await import("@/app/api/customers/photo-cleanup/route")
    const res = await POST(new Request("http://x", { method: "POST", body: "không phải json" }))
    expect(await res.json()).toEqual({ removed: [], skipped: [] })
    expect(remove).not.toHaveBeenCalled()
  })
})

/* ── Màn chụp ảnh ─────────────────────────────────────────────────────────────────────────── */
describe("Màn chụp ảnh: chụp lại / xoá / vị trí", () => {
  const CAP = read("src/components/customers/customer-photo-capture.tsx")
  const handleFile = CAP.slice(CAP.indexOf("const handleFile"), CAP.indexOf("const handleDelete"))
  const handleDelete = CAP.slice(CAP.indexOf("const handleDelete"), CAP.indexOf("const startRepin"))

  it("chụp lại = SỬA dòng tại chỗ (giữ ô), không xoá-rồi-chèn; file cũ chỉ dọn SAU khi ghi xong", () => {
    expect(handleFile).toContain("const o = thay ? thay.slot : slot")
    const sua = handleFile.indexOf('await ghiPhaiTrungDong(supabase.from("customer_photos").update(anh).eq("id", thay.id))')
    const don = handleFile.indexOf("if (thay) cleanupPhotoFiles([photoStoragePath(thay.photo_url)])")
    expect(sua).toBeGreaterThan(0)
    expect(don).toBeGreaterThan(sua)
    expect(handleFile).not.toContain(".delete()")
    // Database không nhận ảnh mới → dọn file vừa tải lên.
    expect(handleFile).toContain("if (orphan) cleanupPhotoFiles([orphan])")
  })

  it("chụp lại tấm đã ghim vị trí → vị trí đi theo ảnh mới (khi số đọc đủ tốt)", () => {
    expect(handleFile).toContain("const pinFromOld = !!thay && isStorePinFromPhoto(store, thay)")
    expect(handleFile).toContain("const followPhoto = pinFromOld && repin.ok")
  })

  it("xoá ảnh: xoá dòng rồi mới dọn file; tấm đã ghim vị trí thì hỏi xoá luôn vị trí", () => {
    const xoa = handleDelete.indexOf('await ghiPhaiTrungDong(supabase.from("customer_photos").delete().eq("id", deleting.id))')
    expect(xoa).toBeGreaterThan(0)
    expect(handleDelete.indexOf("cleanupPhotoFiles([photoStoragePath(deleting.photo_url)])")).toBeGreaterThan(xoa)
    expect(handleDelete).toContain("const clearPin = alsoClearPin && isStorePinFromPhoto(store, deleting)")
    expect(CAP).toContain("Xoá luôn vị trí điểm bán")
  })

  it("trình duyệt KHÔNG tự xoá file trong kho (mig 207 bỏ SELECT → remove im lặng 0 file) — đi qua API", () => {
    expect(CAP).not.toMatch(/\.remove\(/)
    expect(CAP).toContain('fetch("/api/customers/photo-cleanup"')
  })

  it("cập nhật vị trí điểm bán: đọc vị trí MỚI (maximumAge 0) rồi mới hỏi; ghi qua ghiPhaiTrungDong", () => {
    expect(CAP).toContain("maximumAge: fresh ? 0 : 30000")
    expect(CAP).toMatch(/const startRepin = \(\) =>\s+readFix\(\(f\) => \{[\s\S]*?\}, true\)/)
    expect(CAP).toContain('supabase.from("customers").update({ gps_lat: next?.lat ?? null, gps_lng: next?.lng ?? null }).eq("id", customerId)')
    expect(CAP).toContain("onConfirm={() => savePin(null)}")
  })

  it("quyền ở màn = quyền ở database", () => {
    expect(CAP).toContain("const canManage = !!user && MANAGE_PHOTO_ROLES.includes(user.role)")
  })

  it("sửa xong trang tải lại ÊM — không bật khung chờ cả trang (khối ảnh dựng lại, điện thoại nhảy về đầu trang)", () => {
    const PAGE = read("src/app/(dashboard)/customers/[id]/page.tsx")
    expect(PAGE).toContain("if (quiet !== true) setLoading(true)")
    expect(PAGE).toContain("const refreshQuiet = useCallback(() => fetchData(true), [fetchData])")
    expect(PAGE).toMatch(/<CustomerPhotoCapture[\s\S]{0,400}?onChanged=\{refreshQuiet\}/)
  })
})
