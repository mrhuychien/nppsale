/**
 * Chủ nhà 23/11/2026 (ảnh Ghé thăm "Chị Nga 81": check-in 20.916420, 106.341170 — "Cách điểm bán 75.82 km"; ghim Google
 * Maps 20.848420, 106.678727 Lê Chân — "1 giờ 20 phút"): "Kiểm tra tại sao toạ độ vị trí trên google maps và trên app lại
 * lệch nhau?". Luật: `@/lib/customers/vi-tri`. Bấm thật: e2e/vi-tri-check-in.spec.ts.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { haversineMeters, type Fix } from "@/lib/customers/photos"
import {
  CHECK_IN_DUNG_M,
  CHECK_IN_XA_M,
  CHO_VI_TRI_MS,
  LoiViTri,
  SAI_SO_TOI_DA_M,
  cauHoiCheckIn,
  cauLoiViTri,
  cauSaiSo,
  cauSaiSoLon,
  danhGiaCheckIn,
  docViTriTotNhat,
  linkBanDo,
  saiSoLon,
  toaDoText,
} from "@/lib/customers/vi-tri"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")

/** Bản giả `navigator.geolocation`: giữ hàm gọi lại để bài tự bắn từng lần đọc / lỗi. */
function geoGia() {
  let ok: PositionCallback | null = null
  let loi: PositionErrorCallback | null | undefined = null
  const tat: number[] = []
  const tuyChon: Array<PositionOptions | undefined> = []
  const geo = {
    watchPosition: vi.fn((o: PositionCallback, l?: PositionErrorCallback | null, t?: PositionOptions) => {
      ok = o
      loi = l
      tuyChon.push(t)
      return 7
    }),
    clearWatch: vi.fn((id: number) => { tat.push(id) }),
  }
  const doc = (lat: number, lng: number, accuracy: number) =>
    ok!({ coords: { latitude: lat, longitude: lng, accuracy } } as GeolocationPosition)
  const hong = (code: number, message = "x") => loi?.({ code, message } as GeolocationPositionError)
  return { geo, doc, hong, tat, tuyChon }
}

afterEach(() => { vi.useRealTimers() })

describe("đọc vị trí: theo dõi vài giây, lấy lần sai số nhỏ nhất (docViTriTotNhat)", () => {
  it("GPS bắt sóng dần: báo từng lần TỐT HƠN, đạt ≤ 30 m thì dừng ngay và tắt theo dõi; bật GPS chính xác, không lấy số cũ", async () => {
    const g = geoGia()
    const thay: Fix[] = []
    const p = docViTriTotNhat(g.geo, { onDoc: (f) => thay.push(f) })
    g.doc(20.9, 106.3, 1500)
    g.doc(20.91, 106.31, 2500) // tệ hơn — bỏ
    g.doc(20.85, 106.68, 60)
    g.doc(20.8501, 106.6801, 12)
    await expect(p).resolves.toEqual({ lat: 20.8501, lng: 106.6801, accuracy: 12 })
    expect(thay.map((f) => f.accuracy)).toEqual([1500, 60, 12])
    expect(g.tat).toEqual([7])
    expect(g.tuyChon[0]).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 })
  })
  it("hết giờ mà chưa đạt: trả lần tốt nhất đã có (không phải lần cuối)", async () => {
    vi.useFakeTimers()
    const g = geoGia()
    const p = docViTriTotNhat(g.geo)
    g.doc(20.9, 106.3, 900)
    g.doc(20.95, 106.35, 2000)
    vi.advanceTimersByTime(CHO_VI_TRI_MS)
    await expect(p).resolves.toEqual({ lat: 20.9, lng: 106.3, accuracy: 900 })
    expect(g.tat).toEqual([7])
  })
  it("lỗi khi chưa đọc được lần nào → ném câu tiếng Việt theo mã; lỗi sau khi đã có số thì giữ số", async () => {
    const g1 = geoGia()
    const p1 = docViTriTotNhat(g1.geo)
    g1.hong(1, "User denied Geolocation")
    await expect(p1).rejects.toBeInstanceOf(LoiViTri)
    await expect(p1).rejects.toThrow("Chưa cho phép lấy vị trí")

    vi.useFakeTimers()
    const g2 = geoGia()
    const p2 = docViTriTotNhat(g2.geo)
    g2.doc(20.85, 106.68, 80)
    g2.hong(3)
    vi.advanceTimersByTime(CHO_VI_TRI_MS)
    await expect(p2).resolves.toMatchObject({ accuracy: 80 })
  })
  it("không có lần đọc nào tới hết giờ → hết giờ; máy không có định vị → báo không hỗ trợ", async () => {
    vi.useFakeTimers()
    const g = geoGia()
    const p = docViTriTotNhat(g.geo)
    vi.advanceTimersByTime(CHO_VI_TRI_MS)
    await expect(p).rejects.toThrow("Chờ vị trí quá lâu")
    await expect(docViTriTotNhat(null)).rejects.toThrow("Máy không hỗ trợ định vị.")
  })
  it("huỷ (đóng hộp) → tắt theo dõi; lần đọc tới sau đó không báo nữa", async () => {
    const g = geoGia()
    const ac = new AbortController()
    const onDoc = vi.fn()
    const p = docViTriTotNhat(g.geo, { signal: ac.signal, onDoc })
    ac.abort()
    await expect(p).rejects.toThrow("Đã huỷ")
    expect(g.tat).toEqual([7])
    g.doc(20.85, 106.68, 5)
    expect(onDoc).not.toHaveBeenCalled()
  })
  it("máy gọi lại NGAY trong watchPosition (chưa có id) vẫn tắt được theo dõi", async () => {
    const tat: number[] = []
    const geo = {
      watchPosition: (o: PositionCallback) => {
        o({ coords: { latitude: 1, longitude: 2, accuracy: 5 } } as GeolocationPosition)
        return 42
      },
      clearWatch: (id: number) => { tat.push(id) },
    }
    await expect(docViTriTotNhat(geo)).resolves.toEqual({ lat: 1, lng: 2, accuracy: 5 })
    expect(tat).toEqual([42])
  })
})

describe("đối chiếu check-in với vị trí điểm bán đang lưu (danhGiaCheckIn)", () => {
  const CHECK_IN = { lat: 20.91642, lng: 106.34117 }
  const GHIM_GOOGLE = { lat: 20.84842, lng: 106.678727 }
  it("ảnh chủ nhà: chỗ check-in cách ghim Google ~35,9 km — 75,82 km là tới vị trí ĐANG LƯU khác ghim ấy", () => {
    const m = haversineMeters(CHECK_IN.lat, CHECK_IN.lng, GHIM_GOOGLE.lat, GHIM_GOOGLE.lng)
    expect(Math.round(m / 100) / 10).toBe(35.9)
    const dg = danhGiaCheckIn({ ...CHECK_IN, accuracy: 15 }, GHIM_GOOGLE)
    expect(dg).toMatchObject({ loai: "xa", saiSoM: 15 })
    expect(cauHoiCheckIn(dg)).toBe("Bạn đang cách điểm bán 35,9 km (vị trí đọc sai số ±15m) — vẫn ghi nhận?")
  })
  it("đúng / gần / xa theo khoảng cách khi lần đọc đủ tin; chưa lưu vị trí thì không đối chiếu", () => {
    const S = { lat: 20.85, lng: 106.68 }
    expect(danhGiaCheckIn({ lat: 20.85, lng: 106.68, accuracy: 8 }, S)).toEqual({ loai: "dung", cachM: 0, saiSoM: 8 })
    expect(danhGiaCheckIn({ lat: 20.8508, lng: 106.68, accuracy: 8 }, S).loai).toBe("dung") // ~89 m
    expect(danhGiaCheckIn({ lat: 20.8509, lng: 106.68, accuracy: 8 }, S).loai).toBe("gan") // ~100,1 m
    expect(danhGiaCheckIn({ lat: 20.8525, lng: 106.68, accuracy: 8 }, S).loai).toBe("gan") // ~278 m
    expect(danhGiaCheckIn({ lat: 20.8546, lng: 106.68, accuracy: 8 }, S).loai).toBe("xa") // ~512 m
    expect(danhGiaCheckIn({ lat: 20.85, lng: 106.68, accuracy: null }, S).loai).toBe("dung")
    expect(danhGiaCheckIn({ lat: 20.85, lng: 106.68, accuracy: 8 }, null)).toEqual({ loai: "chua-luu" })
    expect(danhGiaCheckIn({ lat: 20.85, lng: 106.68, accuracy: 8 }, { lat: null, lng: 106.68 })).toEqual({ loai: "chua-luu" })
    expect(cauHoiCheckIn({ loai: "dung", cachM: 3, saiSoM: 8 })).toBeNull()
    expect(cauHoiCheckIn({ loai: "gan", cachM: 300, saiSoM: 8 })).toBeNull()
    expect(cauHoiCheckIn({ loai: "chua-luu" })).toBeNull()
  })
  it("sai số lớn: không nói 'đúng điểm bán'; chỉ nói 'xa' khi xa hơn cả sai số", () => {
    const S = { lat: 20.85, lng: 106.68 }
    // Đứng NGAY cửa hàng mà máy chỉ đọc được ±2,5 km — chưa nói được gì.
    const tai = danhGiaCheckIn({ lat: 20.85, lng: 106.68, accuracy: 2500 }, S)
    expect(tai.loai).toBe("chua-ro")
    expect(cauHoiCheckIn(tai)).toBe(
      "Vị trí đọc được sai số ±2,5 km nên chưa biết bạn có đang ở điểm bán không (cách vị trí điểm bán đã lưu 0m) — vẫn ghi nhận?"
    )
    // Máy tính định vị theo IP (±40 km) cách 35,9 km: vẫn chưa rõ.
    expect(danhGiaCheckIn({ lat: 20.91642, lng: 106.34117, accuracy: 40_000 }, S).loai).toBe("chua-ro")
    // ±25 km mà cách 75 km → chắc chắn xa.
    expect(danhGiaCheckIn({ lat: 20.85, lng: 107.4, accuracy: 25_000 }, S).loai).toBe("xa")
    // Đúng ngưỡng: ±100 m vẫn tin được, ±101 m thì không.
    expect(danhGiaCheckIn({ lat: 20.85, lng: 106.68, accuracy: SAI_SO_TOI_DA_M }, S).loai).toBe("dung")
    expect(danhGiaCheckIn({ lat: 20.85, lng: 106.68, accuracy: SAI_SO_TOI_DA_M + 1 }, S).loai).toBe("chua-ro")
    expect([CHECK_IN_DUNG_M, CHECK_IN_XA_M, SAI_SO_TOI_DA_M]).toEqual([100, 500, 100])
  })
})

describe("câu chữ", () => {
  it("lỗi định vị nói tiếng Việt theo mã (trình duyệt báo tiếng Anh)", () => {
    expect(cauLoiViTri({ code: 1, message: "User denied Geolocation" })).toMatch(/^Chưa cho phép lấy vị trí/)
    expect(cauLoiViTri({ code: 2 })).toMatch(/^Máy chưa xác định được vị trí/)
    expect(cauLoiViTri({ code: 3 })).toMatch(/^Chờ vị trí quá lâu/)
    expect(cauLoiViTri({ code: 0 })).toBe("Máy không hỗ trợ định vị.")
    expect(cauLoiViTri(null)).toBe("Không lấy được vị trí.")
  })
  it("sai số / toạ độ / bản đồ", () => {
    expect(cauSaiSo(8)).toBe("±8m")
    expect(cauSaiSo(2500)).toBe("±2,5 km")
    expect(cauSaiSo(null)).toBe("")
    expect(toaDoText({ lat: 20.91642, lng: 106.34117, accuracy: 25 })).toBe("20.916420, 106.341170 (±25m)")
    expect(toaDoText({ lat: 20.91642, lng: 106.34117, accuracy: null })).toBe("20.916420, 106.341170")
    expect(linkBanDo(20.85, 106.68)).toBe("https://www.google.com/maps?q=20.85,106.68")
    expect(saiSoLon({ lat: 0, lng: 0, accuracy: 101 })).toBe(true)
    expect(saiSoLon({ lat: 0, lng: 0, accuracy: 100 })).toBe(false)
    expect(saiSoLon({ lat: 0, lng: 0, accuracy: null })).toBe(false)
    expect(cauSaiSoLon(25_000)).toContain("sai số ±25,0 km")
    expect(cauSaiSoLon(25_000)).toContain("Máy tính định vị theo mạng")
  })
})

describe("mọi chỗ ghi toạ độ đi qua một luật", () => {
  it("không còn đọc vị trí bằng getCurrentPosition ngoài khối Ảnh điểm bán (đã chặn sai số riêng)", () => {
    const tep: string[] = []
    const duyet = (d: string) => {
      for (const t of readdirSync(d)) {
        const p = join(d, t)
        if (statSync(p).isDirectory()) duyet(p)
        else if (/\.(ts|tsx)$/.test(t) && readFileSync(p, "utf-8").includes("getCurrentPosition(")) tep.push(p.replace(/\\/g, "/"))
      }
    }
    duyet(resolve(__dirname, "..", "src"))
    expect(tep.map((p) => p.slice(p.indexOf("src/")))).toEqual(["src/components/customers/customer-photo-capture.tsx"])
  })
  it("Ghé thăm: đọc bằng docViTriTotNhat, hiện sai số + vị trí điểm bán đang lưu, ngày ghé theo giờ VN", () => {
    const f = read("src/components/customers/visit-checkin-dialog.tsx")
    expect(f).toContain("docViTriTotNhat(")
    expect(f).toContain("danhGiaCheckIn(fix, customerCoords)")
    expect(f).toContain("cauHoiCheckIn(danhGia)")
    expect(f).toContain("Điểm bán đã lưu:")
    expect(f).toContain("visit_date: vnDateKey(now)")
    expect(f).not.toContain("toISOString().slice(0, 10)")
  })
  it("Check-in đi tuyến: GPS chính xác qua docViTriTotNhat, ngày theo giờ VN", () => {
    const f = read("src/app/(dashboard)/sales/pjp/page.tsx")
    expect(f).toContain("docViTriTotNhat(navigator.geolocation)")
    expect(f).toContain("visit_date: vnDateKey(now)")
    expect(f).not.toContain("toISOString().slice(0, 10)")
  })
  it("nút Định vị (form khách, tạo nhanh điện thoại): chặn sai số qua canRepinStore; sửa khách thì hỏi trước khi ghi", () => {
    const form = read("src/components/customers/customer-form.tsx")
    expect(form).toContain("const r = canRepinStore(customer ? daLuu : { lat: null, lng: null }, fix)")
    expect(form).toContain("setHoiGhim({ fix, movedMeters: r.movedMeters })")
    expect(form).toContain("repinQuestion(hoiGhim.fix, hoiGhim.movedMeters)")
    // Ghi vị trí điểm bán chỉ ở MỘT chỗ — sau khi người dùng đồng ý.
    expect(form.match(/\.update\(\{ gps_lat/g)).toHaveLength(1)
    expect(form.indexOf(".update({ gps_lat")).toBeGreaterThan(form.indexOf("const ghiViTriDiemBan"))
    const nhanh = read("src/components/customers/tao-khach-dien-thoai.tsx")
    expect(nhanh).toContain("const r = canRepinStore({ lat: null, lng: null }, fix)")
    expect(nhanh).toContain("if (r.ok) setGps(fix)")
  })
})
