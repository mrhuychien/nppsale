/**
 * DUYỆT ẢNH + VỊ TRÍ ĐIỂM BÁN (mig 244) và CHECK-IN KHÔNG CHỤP ẢNH — chủ nhà 12/10/2026:
 *   "Khi nhân viên cập nhật ảnh điểm bán và định vị. Chủ NPP đã phê duyệt thì khi thay đổi hoặc xoá ảnh+vị trí cần nhà
 *    phân phối phê duyệt." · "Khi đi tuyến chỉ cần checkin ko cần chụp ảnh".
 * Luật SQL chạy thật trên Postgres: scripts/sql/thu-244-duyet-anh-diem-ban.sql. Bấm thật: e2e/duyet-anh-diem-ban.spec.ts.
 */
import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  canApprovePhotos,
  chuaCoDuyetAnh,
  duyetDiemBan,
  duyetYeuCauAnh,
  huyYeuCauAnh,
  loiDuyetAnh,
  mustRequestChange,
  pendingForPin,
  pendingForSlot,
  requestLabel,
  slotsInUse,
  xinDoiAnh,
  type PhotoRequest,
  type PhotoRequestKind,
} from "@/lib/customers/photo-approval"
import { nextFreeSlot } from "@/lib/customers/photos"
import { canDuyet } from "@/app/(dashboard)/customers/missing-photos/doc-anh"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
const MIG = read("supabase/migrations/244_duyet_anh_diem_ban.sql")
const CAP = read("src/components/customers/customer-photo-capture.tsx")

const yc = (o: Partial<PhotoRequest> & { kind: PhotoRequestKind }): PhotoRequest => ({
  id: o.id ?? `${o.kind}-${o.slot ?? "vt"}`, photo_id: null, slot: null, photo_url: null, taken_at: null, gps_lat: null,
  gps_lng: null, gps_accuracy: null, pin_lat: null, pin_lng: null, requested_by: "nv", requested_at: "2026-10-12T01:00:00Z", ...o,
})

describe("Ai duyệt, ai phải gửi yêu cầu", () => {
  it("quyền duyệt = ô Khách hàng → Duyệt: chủ NPP luôn có; quản lý / kế toán / NVBH mặc định không", () => {
    expect(canApprovePhotos("owner")).toBe(true)
    for (const r of ["manager", "accountant", "sales", "warehouse"] as const) expect(canApprovePhotos(r), r).toBe(false)
    expect(canApprovePhotos(null)).toBe(false)
  })
  it("chỉ khi ĐÃ duyệt mà người làm KHÔNG có quyền duyệt thì mới phải gửi yêu cầu", () => {
    expect(mustRequestChange("2026-10-12T01:00:00Z", false)).toBe(true)
    expect(mustRequestChange("2026-10-12T01:00:00Z", true)).toBe(false)
    expect(mustRequestChange(null, false)).toBe(false)
    expect(mustRequestChange(undefined, false)).toBe(false)
  })
})

describe("Yêu cầu đang chờ", () => {
  it("câu mô tả trùng hàm SQL `_mo_ta_yeu_cau_anh` — thông báo và màn đọc như nhau", () => {
    expect([
      requestLabel("photo_add", 3), requestLabel("photo_replace", 1), requestLabel("photo_delete", 2),
      requestLabel("pin_set", null), requestLabel("pin_clear", null),
    ]).toEqual(["Thêm ảnh 3", "Thay ảnh 1", "Xoá ảnh 2", "Dời vị trí", "Xoá vị trí"])
    for (const [k, v] of [["photo_add", "Thêm ảnh "], ["photo_replace", "Thay ảnh "], ["photo_delete", "Xoá ảnh "],
                          ["pin_set", "Dời vị trí"], ["pin_clear", "Xoá vị trí"]]) {
      expect(MIG).toContain(`WHEN '${k}'`)
      expect(MIG).toMatch(new RegExp(`WHEN '${k}'\\s+THEN '${v}`))
    }
  })
  it("ảnh MỚI đang chờ duyệt giữ ô — ảnh chụp thêm kế tiếp không đè lên", () => {
    const anh = [{ slot: 1 }, { slot: 2 }]
    expect(slotsInUse(anh, [yc({ kind: "photo_add", slot: 3 })])).toEqual([1, 2, 3])
    expect(nextFreeSlot(slotsInUse(anh, [yc({ kind: "photo_add", slot: 3 })]))).toBeNull()
    // Thay / xoá / dời vị trí không chiếm thêm ô — kể cả yêu cầu thay của ảnh đã mất (lỗi thời): ô ấy vẫn chụp thêm được.
    expect(slotsInUse(anh, [yc({ kind: "photo_replace", slot: 1 }), yc({ kind: "photo_delete", slot: 2 }), yc({ kind: "pin_set" })])).toEqual([1, 2])
    expect(slotsInUse([{ slot: 1 }], [yc({ kind: "photo_replace", slot: 2 })])).toEqual([1])
  })
  it("tìm yêu cầu của một ô / của vị trí", () => {
    const ds = [yc({ kind: "photo_replace", slot: 1 }), yc({ kind: "pin_clear" })]
    expect(pendingForSlot(ds, 1)?.kind).toBe("photo_replace")
    expect(pendingForSlot(ds, 2)).toBeNull()
    expect(pendingForPin(ds)?.kind).toBe("pin_clear")
    expect(pendingForPin([yc({ kind: "photo_add", slot: 3 })])).toBeNull()
  })
})

describe("Lỗi máy chủ", () => {
  it("nhận ra máy chủ chưa chạy mig 244 (thiếu bảng / hàm / cột của mig 244), không nhầm lỗi khác", () => {
    expect(chuaCoDuyetAnh({ code: "PGRST205", message: "Could not find the table 'public.customer_photo_requests' in the schema cache" })).toBe(true)
    expect(chuaCoDuyetAnh({ code: "PGRST202", message: "Could not find the function public.xin_doi_anh_diem_ban" })).toBe(true)
    expect(chuaCoDuyetAnh({ code: "42703", message: "column customers.photo_approved_at does not exist" })).toBe(true)
    expect(chuaCoDuyetAnh(new Error("Điểm bán đã duyệt ảnh: column customers.photo_approved_at does not exist"))).toBe(true)
    expect(chuaCoDuyetAnh({ code: "42703", message: "column customers.foo does not exist" })).toBe(false)
    expect(chuaCoDuyetAnh({ code: "P0001", message: "ANH_DA_DUYET: …" })).toBe(false)
    expect(chuaCoDuyetAnh(null)).toBe(false)
  })
  it("câu lỗi: cắt mã đầu câu; chưa có migration thì nói phải chạy 244", () => {
    expect(loiDuyetAnh({ code: "P0001", message: "CHUA_DUYET: Ảnh điểm bán chưa được duyệt — sửa thẳng được." })).toBe(
      "Ảnh điểm bán chưa được duyệt — sửa thẳng được."
    )
    expect(loiDuyetAnh({ code: "PGRST202", message: "Could not find the function" })).toContain("migration 244")
    expect(loiDuyetAnh({ message: "mất mạng" })).toBe("mất mạng")
  })
})

describe("Lời gọi RPC", () => {
  const sb = (data: unknown, error: unknown = null) => {
    const rpc = vi.fn(async () => ({ data, error }))
    return { rpc }
  }
  it("xinDoiAnh: thay ảnh + dời vị trí → đúng tham số; trả file của yêu cầu cũ bị thay", async () => {
    const c = sb({ ids: ["a", "b"], file_bo: ["https://x/old.jpg"] })
    const kq = await xinDoiAnh(c, {
      customerId: "kh",
      photo: { action: "replace", photoId: "p1", url: "https://x/new.jpg", takenAt: "2026-10-12T01:00:00Z", lat: 20.85, lng: 106.68, accuracy: 6 },
      pin: { action: "set", lat: 20.85, lng: 106.68 },
    })
    expect(kq).toEqual({ ids: ["a", "b"], fileBo: ["https://x/old.jpg"] })
    expect(c.rpc).toHaveBeenCalledWith("xin_doi_anh_diem_ban", {
      p_customer_id: "kh", p_photo_action: "replace", p_photo_id: "p1", p_slot: null, p_photo_url: "https://x/new.jpg",
      p_taken_at: "2026-10-12T01:00:00Z", p_gps_lat: 20.85, p_gps_lng: 106.68, p_gps_accuracy: 6,
      p_pin_action: "set", p_pin_lat: 20.85, p_pin_lng: 106.68,
    })
  })
  it("xinDoiAnh: thêm ảnh (ô), xoá ảnh, chỉ xoá vị trí", async () => {
    const c = sb({ ids: ["a"], file_bo: [] })
    await xinDoiAnh(c, { customerId: "kh", photo: { action: "add", slot: 3, url: "u", takenAt: "t", lat: null, lng: null, accuracy: null } })
    expect(c.rpc).toHaveBeenLastCalledWith("xin_doi_anh_diem_ban", expect.objectContaining({
      p_photo_action: "add", p_photo_id: null, p_slot: 3, p_photo_url: "u", p_pin_action: "keep" }))
    await xinDoiAnh(c, { customerId: "kh", photo: { action: "delete", photoId: "p2" }, pin: { action: "clear" } })
    expect(c.rpc).toHaveBeenLastCalledWith("xin_doi_anh_diem_ban", expect.objectContaining({
      p_photo_action: "delete", p_photo_id: "p2", p_slot: null, p_photo_url: null, p_taken_at: null, p_pin_action: "clear", p_pin_lat: null }))
    await xinDoiAnh(c, { customerId: "kh", pin: { action: "clear" } })
    expect(c.rpc).toHaveBeenLastCalledWith("xin_doi_anh_diem_ban", expect.objectContaining({ p_photo_action: "none", p_pin_action: "clear" }))
  })
  it("duyệt / từ chối / rút / duyệt điểm bán: đúng hàm, đúng tham số; lỗi thì NÉM câu đã cắt mã", async () => {
    const c = sb({ xong: 2, bo_qua: 1, file_bo: ["f1", "", 3] })
    expect(await duyetYeuCauAnh(c, ["a", "b"], false, "  Sai chỗ  ")).toEqual({ xong: 2, boQua: 1, fileBo: ["f1"] })
    expect(c.rpc).toHaveBeenLastCalledWith("duyet_yeu_cau_anh_diem_ban", { p_request_ids: ["a", "b"], p_dong_y: false, p_ghi_chu: "Sai chỗ" })
    await duyetYeuCauAnh(c, ["a"], true)
    expect(c.rpc).toHaveBeenLastCalledWith("duyet_yeu_cau_anh_diem_ban", { p_request_ids: ["a"], p_dong_y: true, p_ghi_chu: null })
    await huyYeuCauAnh(c, "a")
    expect(c.rpc).toHaveBeenLastCalledWith("huy_yeu_cau_anh_diem_ban", { p_request_id: "a" })
    await duyetDiemBan(c, "kh", false)
    expect(c.rpc).toHaveBeenLastCalledWith("duyet_anh_diem_ban", { p_customer_id: "kh", p_duyet: false })
    await expect(duyetYeuCauAnh(sb(null, { code: "42501", message: "FORBIDDEN: chỉ chủ NPP…" }), ["a"], true)).rejects.toThrow(/^chỉ chủ NPP…$/)
    await expect(xinDoiAnh(sb(null, { code: "P0001", message: "CHUA_DUYET: chưa duyệt" }), { customerId: "kh", pin: { action: "clear" } })).rejects.toThrow("chưa duyệt")
  })
})

describe("Tab Chờ duyệt (màn Điểm bán cần cập nhật)", () => {
  const r = (id: string, photoCount: number, gps: boolean) => ({ id, photoCount, gps_lat: gps ? 20.8 : null, gps_lng: gps ? 106.6 : null })
  it("chưa duyệt mà đã có ảnh / vị trí, hoặc có yêu cầu đang chờ; trống trơn thì không (thuộc Còn thiếu)", () => {
    const ds = [r("chua-duyet-co-anh", 2, false), r("chua-duyet-co-vt", 0, true), r("trong", 0, false), r("da-duyet", 3, true), r("da-duyet-co-yc", 3, true)]
    const duyet = { approved: new Set(["da-duyet", "da-duyet-co-yc"]), pending: new Map([["da-duyet-co-yc", 2]]) }
    expect(canDuyet(ds, duyet).map((x) => x.id)).toEqual(["chua-duyet-co-anh", "chua-duyet-co-vt", "da-duyet-co-yc"])
  })
  it("chỉ người duyệt thấy tab; máy chủ chưa có bước duyệt thì ẩn tab, không làm hỏng màn", () => {
    const s = read("src/app/(dashboard)/customers/missing-photos/page.tsx")
    expect(s).toContain("if (canApprove) {")
    expect(s).toContain("if (!chuaCoDuyetAnh(err)) setError(errorMessage(err))")
    expect(s).toContain('const tabs: Tab[] = duyet ? ["all", "no_photo", "no_gps", "approval"] : ["all", "no_photo", "no_gps"]')
  })
})

describe("Migration 244", () => {
  it("VÌ SAO trích lời chủ nhà + ngày; thẻ dollar ASCII; NOTIFY + SELECT tóm tắt", () => {
    expect(MIG).toContain("chủ nhà 12/10/2026")
    expect(MIG).toContain("Chủ NPP đã phê duyệt thì khi thay")
    expect(MIG).not.toMatch(/\$\$/)
    expect(MIG).toContain("NOTIFY pgrst, 'reload schema';")
    expect(MIG).toMatch(/SELECT 'mig 244: duyệt ảnh \+ vị trí điểm bán' AS buoc/)
  })
  it("hàm nội bộ SECURITY DEFINER thu quyền của PUBLIC, anon, authenticated (luật mig 166); RPC chỉ cho authenticated", () => {
    for (const f of ["_nguoi_duyet_anh_diem_ban(uuid)", "_bao_tin_anh_diem_ban(uuid, uuid[], text, text, text, jsonb)", "_anh_diem_ban_bi_khoa(uuid)",
                     "_trg_khoa_anh_diem_ban()", "_trg_khoa_vi_tri_diem_ban()", "_trg_bao_anh_dau_cho_duyet()"]) {
      expect(MIG, f).toContain(`REVOKE EXECUTE ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated;`)
    }
    for (const f of ["duyet_anh_diem_ban(uuid, boolean)", "huy_yeu_cau_anh_diem_ban(uuid)", "duyet_yeu_cau_anh_diem_ban(uuid[], boolean, text)"]) {
      expect(MIG, f).toContain(`REVOKE EXECUTE ON FUNCTION public.${f} FROM PUBLIC, anon;`)
      expect(MIG, f).toContain(`GRANT EXECUTE ON FUNCTION public.${f} TO authenticated;`)
    }
  })
  it("bảng yêu cầu: chỉ đọc qua RLS, không ai ghi thẳng (chỉ RPC)", () => {
    expect(MIG).toContain("REVOKE INSERT, UPDATE, DELETE ON public.customer_photo_requests FROM authenticated;")
    expect(MIG).toContain("GRANT SELECT ON public.customer_photo_requests TO authenticated;")
    expect(MIG).not.toMatch(/CREATE POLICY [^;]*ON public\.customer_photo_requests\s+FOR (INSERT|UPDATE|DELETE|ALL)/)
  })
  it("loại thông báo mới giữ đủ các loại cũ (mig 221)", () => {
    const loai = (s: string) => {
      const i = s.lastIndexOf("notifications_type_check CHECK (type IN (")
      return Array.from(s.slice(i, s.indexOf("))", i)).matchAll(/'([a-z_]+)'/g), (m) => m[1])
    }
    const cu = loai(read("supabase/migrations/221_nhac_khach_chua_tuyen.sql"))
    const moi = loai(MIG)
    expect(cu.length).toBeGreaterThan(10)
    for (const t of cu) expect(moi, t).toContain(t)
    expect(moi).toContain("customer_photo_review")
  })
  it("mọi UPDATE / DELETE trong hàm đều có WHERE (safeupdate — mig 236)", () => {
    const than = MIG.split("$fn$").filter((_, i) => i % 2 === 1).join("\n")
    const lenh = than.match(/(\bUPDATE\s+\w+(?:\s+\w+)?\s+SET\b|\bDELETE FROM\s+\w+)[\s\S]*?(;|RETURNING)/g) ?? []
    expect(lenh.length).toBeGreaterThan(8)
    for (const l of lenh) expect(l, l.slice(0, 80)).toMatch(/\bWHERE\b/)
  })
})

describe("Khối ảnh điểm bán", () => {
  const handleFile = CAP.slice(CAP.indexOf("const handleFile"), CAP.indexOf("const handleDelete"))
  const handleDelete = CAP.slice(CAP.indexOf("const handleDelete"), CAP.indexOf("const startRepin"))
  const savePin = CAP.slice(CAP.indexOf("const savePin"), CAP.indexOf("/** Người duyệt đồng ý"))

  it("đã duyệt + không có quyền duyệt → GỬI YÊU CẦU trước khi đụng vào ảnh / toạ độ (không ghi thẳng)", () => {
    expect(CAP).toContain("const requestMode = mustRequestChange(approval?.at, canApprove)")
    const i = handleFile.indexOf("if (requestMode) {")
    expect(i).toBeGreaterThan(0)
    expect(i).toBeLessThan(handleFile.indexOf('await ghiPhaiTrungDong(supabase.from("customer_photos").update(anh).eq("id", thay.id))'))
    expect(handleFile.slice(i, handleFile.indexOf("\n      }\n", i))).toContain("await xinDoiAnh(supabase, {")
    expect(handleFile.slice(i, handleFile.indexOf("\n      }\n", i))).toContain("return")
    const j = handleDelete.indexOf("if (requestMode) {")
    expect(j).toBeGreaterThan(0)
    expect(j).toBeLessThan(handleDelete.indexOf('await ghiPhaiTrungDong(supabase.from("customer_photos").delete()'))
    const k = savePin.indexOf("if (requestMode) {")
    expect(k).toBeGreaterThan(0)
    expect(k).toBeLessThan(savePin.indexOf("await writeStoreGps(next)"))
  })
  it("chụp lại tấm gốc của vị trí khi gửi yêu cầu: vị trí đi theo (cùng luật với khi sửa thẳng)", () => {
    expect(handleFile).toContain("const pinMoi = (pin.pin || followPhoto) && fix ? { action: \"set\" as const, lat: fix.lat, lng: fix.lng } : undefined")
  })
  it("nút Duyệt / Bỏ duyệt / Duyệt tất cả / Từ chối chỉ cho người có quyền duyệt; người gửi rút được yêu cầu của mình", () => {
    expect(CAP).toContain("{canApprove && !approval.at && (photos.length > 0 || hasStore) && (")
    expect(CAP).toContain("{canApprove && approval.at && (")
    expect(CAP).toContain("{canApprove && pending.length > 1 && (")
    expect(CAP).toMatch(/\{canApprove \? \(\s*<>\s*<Button[\s\S]*?Duyệt\s*<\/Button>/)
    expect(CAP).toContain(") : r.requested_by === user?.id ? (")
  })
  it("đọc trạng thái duyệt hỏng vì chưa chạy migration → khối chạy như cũ (không hiện duyệt), không vỡ", () => {
    expect(CAP).toContain("if (!chuaCoDuyetAnh(loiDuyet)) console.error")
    expect(CAP).toContain("setApproval(null)")
    expect(CAP).toContain("{approval && (")
  })
})

describe("Form khách: nút Định vị", () => {
  it("chỉ đặt toạ độ vào form SAU khi database nhận; vị trí đã duyệt thì nói rõ phải gửi duyệt", () => {
    const s = read("src/components/customers/customer-form.tsx")
    const fn = s.slice(s.indexOf("const handleGetGps"), s.indexOf("const handleSubmit"))
    const sua = fn.indexOf('.update({ gps_lat: parseFloat(lat), gps_lng: parseFloat(lng) })')
    const dat = fn.indexOf("setForm((prev) => ({ ...prev, gps_lat: lat, gps_lng: lng }))")
    expect(sua).toBeGreaterThan(0)
    expect(dat).toBeGreaterThan(sua)
    // Ghi được thì mới đặt vào form, ngay trước lời báo "Đã lưu".
    expect(fn).toMatch(/\} else \{\s*setForm\(\(prev\) => \(\{ \.\.\.prev, gps_lat: lat, gps_lng: lng \}\)\)\s*toast\(\{ title: "Đã lưu tọa độ GPS" \}\)/)
    expect(fn).toContain("/VI_TRI_DA_DUYET/.test(error.message)")
  })
  it("lưu SỬA khách không gửi lại toạ độ (nút Định vị đã ghi ngay) — không đè vị trí người duyệt vừa dời", () => {
    const s = read("src/components/customers/customer-form.tsx")
    const fn = s.slice(s.indexOf("const handleSubmit"), s.indexOf("const hasGps"))
    expect(fn).toContain("if (!customer && form.gps_lat && form.gps_lng) {")
    expect(fn.match(/payload\.gps_lat =/g) ?? []).toHaveLength(1)
  })
})

describe("Đi tuyến: check-in không chụp ảnh", () => {
  const D = read("src/components/customers/visit-checkin-dialog.tsx")
  it("hộp check-in không còn ô chụp ảnh, không tải gì lên kho, lượt ghé không ghi photo_url", () => {
    expect(D).toContain("Khi đi tuyến chỉ cần checkin ko cần chụp ảnh")
    expect(D).not.toContain('capture="environment"')
    expect(D).not.toContain("Ảnh cửa hàng")
    expect(D).not.toMatch(/type="file"/)
    expect(D).not.toContain("photo_url")
    expect(D).toContain("check_in_lat: coords?.lat ?? null")
  })
  it("lịch tuyến (PJP) check-in cũng chỉ ghi vị trí", () => {
    const p = read("src/app/(dashboard)/sales/pjp/page.tsx")
    const fn = p.slice(p.indexOf("const handleCheckIn"), p.indexOf("// Check-out"))
    expect(fn).toContain("check_in_lat: position.coords.latitude")
    expect(fn).not.toMatch(/photo|storage/)
  })
})

describe("Loại thông báo customer_photo_review hiện được", () => {
  it("có mặt ở kiểu, chuông và trang thông báo", () => {
    expect(read("src/types/index.ts")).toContain('| "customer_photo_review"')
    expect(read("src/components/layout/notification-bell.tsx")).toContain("customer_photo_review:")
    expect(read("src/app/(dashboard)/notifications/page.tsx")).toContain("customer_photo_review:")
  })
})
