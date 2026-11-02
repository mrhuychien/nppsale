import { describe, it, expect, vi } from "vitest"
import { createRequire } from "node:module"
import { veKhung, modulEan13 } from "../e2e/camera-gia.mjs"
import {
  KHONG_HO_TRO_CAMERA,
  O_NGAM,
  RANG_BUOC_CAMERA,
  TRAN_RONG_GIAI,
  batNetLienTuc,
  cauLoiCamera,
  coAnhGiai,
  moCamera,
  tatCamera,
  vungCat,
} from "@/lib/quet/camera"
import { boGiaiMay, boGiaiTuZxing, chonMaLonNhat, layZxing, taoBoGiai, type BoGiai } from "@/lib/quet/bo-giai"

/**
 * CHỦ NHÀ 02/11/2026: "phần tạo sản phẩm mới trên điện thoại mã vạch chưa quét được".
 * Bộ quét nay tự mở camera (khung lớn, lấy nét liên tục), cắt đúng ô ngắm ở độ phân giải GỐC rồi mới giải mã.
 */

const loi = (name: string, message = "") => Object.assign(new Error(message), { name })

describe("vùng cắt dưới ô ngắm (video object-fit: cover)", () => {
  it("khung dọc 1080×1920 (điện thoại) trong khung xem 4:3: cắt ở độ phân giải GỐC, không thu về cỡ CSS", () => {
    const v = vungCat(1080, 1920, 350, 263)
    // Phần hiện ra: 1080 × 812 điểm ảnh gốc (cắt bớt trên dưới); ô ngắm 86% × 42% của phần ấy.
    expect(v.sw).toBe(Math.round(1080 * O_NGAM.rong))
    expect(v.sh).toBe(Math.round(((263 * 1080) / 350) * O_NGAM.cao))
    expect(v.sx).toBe(Math.round((1080 - v.sw) / 2))
    expect(v.sy).toBe(Math.round((1920 - v.sh) / 2))
    // Bản cũ giải trên ô 280×150 điểm ảnh CSS — ở đây gấp ~3,3 lần bề ngang.
    expect(v.sw).toBeGreaterThan(280 * 3)
  })

  it("khung ngang 640×480 trong khung xem cùng tỉ lệ: ô ngắm giữa khung, đúng tỉ lệ", () => {
    expect(vungCat(640, 480, 320, 240)).toEqual({ sx: 45, sy: 139, sw: 550, sh: 202 })
  })

  it("khung xem chưa đo được (0) → coi như cùng tỉ lệ khung hình; video chưa có khung → vùng rỗng", () => {
    expect(vungCat(640, 480, 0, 0)).toEqual(vungCat(640, 480, 640, 480))
    expect(vungCat(0, 0, 320, 240)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 })
  })

  it("vùng cắt không bao giờ vượt khung hình", () => {
    for (const [vw, vh, cw, ch] of [[1920, 1080, 350, 263], [480, 640, 1000, 100], [1080, 1080, 10, 1000]]) {
      const v = vungCat(vw, vh, cw, ch, { rong: 1, cao: 1 })
      expect(v.sx).toBeGreaterThanOrEqual(0)
      expect(v.sy).toBeGreaterThanOrEqual(0)
      expect(v.sx + v.sw).toBeLessThanOrEqual(vw)
      expect(v.sy + v.sh).toBeLessThanOrEqual(vh)
    }
  })

  it("cỡ ảnh giải: giữ nguyên tới trần, rộng hơn thì thu đúng tỉ lệ", () => {
    expect(coAnhGiai(929, 341)).toEqual({ w: 929, h: 341 })
    expect(coAnhGiai(1650, 500)).toEqual({ w: TRAN_RONG_GIAI, h: Math.round((500 * TRAN_RONG_GIAI) / 1650) })
  })
})

describe("mở / tắt camera", () => {
  const luongGia = () => ({ getTracks: () => [], getVideoTracks: () => [] }) as unknown as MediaStream

  it("xin camera SAU + khung 1920×1080 trước (mặc định trình duyệt là 640×480 — mã ở 10–15 cm không đủ điểm ảnh)", async () => {
    const getUserMedia = vi.fn(async () => luongGia())
    await moCamera({ getUserMedia })
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(getUserMedia.mock.calls[0]).toEqual([RANG_BUOC_CAMERA[0]])
    expect(RANG_BUOC_CAMERA[0]).toMatchObject({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } })
  })

  it("máy không đáp được ràng buộc → lùi bước lần lượt; bị từ chối quyền → dừng ngay, không hỏi quyền lần nữa", async () => {
    const lui = vi.fn().mockRejectedValueOnce(loi("OverconstrainedError")).mockResolvedValueOnce(luongGia())
    await moCamera({ getUserMedia: lui })
    expect(lui).toHaveBeenCalledTimes(2)
    expect(lui.mock.calls[1]).toEqual([RANG_BUOC_CAMERA[1]])

    const tuChoi = vi.fn().mockRejectedValue(loi("NotAllowedError"))
    await expect(moCamera({ getUserMedia: tuChoi })).rejects.toMatchObject({ name: "NotAllowedError" })
    expect(tuChoi).toHaveBeenCalledTimes(1)

    const hetCach = vi.fn().mockRejectedValue(loi("OverconstrainedError"))
    await expect(moCamera({ getUserMedia: hetCach })).rejects.toMatchObject({ name: "OverconstrainedError" })
    expect(hetCach).toHaveBeenCalledTimes(RANG_BUOC_CAMERA.length)
  })

  it("trình duyệt không có getUserMedia (trang http / trình duyệt cũ) → lỗi riêng có câu tiếng Việt", async () => {
    await expect(moCamera(undefined)).rejects.toMatchObject({ name: KHONG_HO_TRO_CAMERA })
    expect(cauLoiCamera(loi(KHONG_HO_TRO_CAMERA))).toMatch(/https/)
  })

  it("tắt camera: dừng MỌI track, không ném kể cả khi track đã hỏng; null cũng được", () => {
    const a = { stop: vi.fn() }
    const b = { stop: vi.fn(() => { throw new Error("đã dừng") }) }
    const c = { stop: vi.fn() }
    expect(() => tatCamera({ getTracks: () => [a, b, c] } as unknown as MediaStream)).not.toThrow()
    expect(a.stop).toHaveBeenCalled()
    expect(c.stop).toHaveBeenCalled()
    expect(() => tatCamera(null)).not.toThrow()
  })

  it("lấy nét liên tục chỉ khi máy cho; máy không cho / áp ràng buộc hỏng → false, không ném", async () => {
    const applyConstraints = vi.fn(async () => {})
    const coNet = { getVideoTracks: () => [{ getCapabilities: () => ({ focusMode: ["manual", "continuous"] }), applyConstraints }] } as unknown as MediaStream
    expect(await batNetLienTuc(coNet)).toBe(true)
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ focusMode: "continuous" }] })
    const khongNet = { getVideoTracks: () => [{ getCapabilities: () => ({}), applyConstraints }] } as unknown as MediaStream
    expect(await batNetLienTuc(khongNet)).toBe(false)
    const hong = { getVideoTracks: () => [{ getCapabilities: () => ({ focusMode: ["continuous"] }), applyConstraints: async () => { throw loi("OverconstrainedError") } }] } as unknown as MediaStream
    expect(await batNetLienTuc(hong)).toBe(false)
    expect(await batNetLienTuc({ getVideoTracks: () => [] } as unknown as MediaStream)).toBe(false)
  })

  it("lỗi camera nói rõ vì sao (bản cũ lặng lẽ nhảy sang Nhập tay)", () => {
    expect(cauLoiCamera(loi("NotAllowedError"))).toMatch(/Chưa được phép dùng camera/)
    expect(cauLoiCamera(loi("NotFoundError"))).toMatch(/Không tìm thấy camera/)
    expect(cauLoiCamera(loi("NotReadableError"))).toMatch(/ứng dụng khác/)
    expect(cauLoiCamera(loi("ChunkLoadError"))).toMatch(/Không tải được bộ đọc mã/)
    expect(cauLoiCamera(new Error("Loading chunk 123 failed."))).toMatch(/Không tải được bộ đọc mã/)
    expect(cauLoiCamera(new Error("lạ quá"))).toBe("Không mở được camera: lạ quá")
    expect(cauLoiCamera(null)).toBe("Không mở được camera — dùng Nhập tay.")
  })
})

describe("bộ giải mã", () => {
  it("nhiều mã trong ô ngắm → lấy mã to nhất; không có mã → null", () => {
    expect(chonMaLonNhat([
      { rawValue: "NHO", boundingBox: { width: 10, height: 5 } },
      { rawValue: "TO", boundingBox: { width: 100, height: 40 } },
      { rawValue: "", boundingBox: { width: 999, height: 999 } },
    ])).toBe("TO")
    expect(chonMaLonNhat([])).toBeNull()
    expect(chonMaLonNhat(undefined)).toBeNull()
  })

  it("bộ đọc sẵn của máy: dùng khi đọc được EAN-13; thiếu EAN-13 / hỏng / không có → null (sang ZXing)", async () => {
    const detect = vi.fn(async () => [{ rawValue: "8934567138161", boundingBox: { width: 1, height: 1 } }])
    class May {
      static getSupportedFormats = async () => ["qr_code", "ean_13", "code_128", "aztec"]
      constructor(public tuyChon: { formats: string[] }) {}
      detect = detect
    }
    const may = await boGiaiMay(May)
    expect(may?.ten).toBe("may")
    expect(await may!.giai({} as HTMLCanvasElement)).toBe("8934567138161")

    class ChiQr { static getSupportedFormats = async () => ["qr_code"]; detect = detect }
    expect(await boGiaiMay(ChiQr)).toBeNull()
    class Hong { static getSupportedFormats = async () => { throw new Error("không có dịch vụ") }; detect = detect }
    expect(await boGiaiMay(Hong)).toBeNull()
    expect(await boGiaiMay(undefined)).toBeNull()
  })

  it("bộ đọc sẵn hỏng GIỮA CHỪNG (Android thiếu dịch vụ Google) → chuyển hẳn sang ZXing", async () => {
    const mayHong: BoGiai = { ten: "may", giai: vi.fn(async () => { throw new Error("Barcode detection service unavailable") }) }
    const zx: BoGiai = { ten: "zxing", giai: vi.fn(async () => "MA-ZX") }
    const napZx = vi.fn(async () => zx)
    const bg = await taoBoGiai(Promise.resolve(mayHong), napZx)
    expect(bg.ten).toBe("may")
    expect(await bg.giai({} as HTMLCanvasElement)).toBe("MA-ZX")
    expect(bg.ten).toBe("zxing")
    expect(await bg.giai({} as HTMLCanvasElement)).toBe("MA-ZX")
    expect(mayHong.giai).toHaveBeenCalledTimes(1)
    expect(napZx).toHaveBeenCalledTimes(1)
    // Không có bộ đọc sẵn → ZXing ngay từ đầu.
    const thang = await taoBoGiai(Promise.resolve(null), napZx)
    expect(thang.ten).toBe("zxing")
  })

  it("ZXing qua đúng đường app dùng (ảnh canvas → bộ giải): mã nhỏ trên nền tối đọc được — bộ giải TỰ vá ZXing", () => {
    const require = createRequire(import.meta.url)
    const duong = require.resolve("html5-qrcode/third_party/zxing-js.umd.js")
    delete require.cache[duong]
    const zx = layZxing({ default: require(duong) }) // `import()` của gói CommonJS: lớp nằm trong `default`
    const w = 929
    const h = 341
    const Y = veKhung({ w, h, modul: modulEan13("8934567138161"), tiLe: 0.35, sigma: 1.1, nhieu: 6 })
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < Y.length; i++) rgba.set([Y[i], Y[i], Y[i], 255], i * 4)
    const anh = { width: w, height: h, getContext: () => ({ getImageData: () => ({ data: rgba, width: w, height: h }) }) } as unknown as HTMLCanvasElement
    const bg = boGiaiTuZxing(zx)
    expect(bg.ten).toBe("zxing")
    return expect(bg.giai(anh)).resolves.toBe("8934567138161")
  })
})
