/**
 * Tìm kiếm tiếng Việt — bỏ dấu, không phân biệt hoa thường.
 *
 * VÌ SAO CẦN
 * Nhân viên bán hàng đứng trong cửa hàng, gõ một tay trên bàn phím điện
 * thoại, gõ KHÔNG DẤU. Trước đây mọi ô tìm kiếm trong app đều so bằng
 * `a.toLowerCase().includes(q.toLowerCase())`, nên gõ "bach hoa xanh"
 * không ra "Bách Hoá Xanh" — thao tác đầu tiên của mỗi đơn hàng đã tắc.
 *
 * Hai chi tiết dễ bỏ sót:
 *
 *  1. `normalize("NFD")` tách được dấu thanh khỏi nguyên âm (á → a + ́ )
 *     nhưng KHÔNG tách được đ/Đ — chữ đ là một ký tự riêng, không phải
 *     d + dấu. Phải thay tay, nếu không "hang dong" vẫn không ra "hàng đông".
 *
 *  2. Trường số điện thoại từng so bằng `phone.includes(q)` với `q` đã
 *     lowercase còn `phone` thì chưa. Mã như "09DEMO000008" vì thế không
 *     bao giờ khớp. Chuẩn hoá CẢ HAI VẾ mới đúng.
 *
 * THUẬT TOÁN CHUNG (chủ nhà 27/09/2026: "tìm kiếm chính xác, linh hoạt hơn,
 * tìm kiếm được không dấu … thuật toán tìm kiếm nào tối ưu nhất hiện nay thì
 * sử dụng") — cùng một luật ở trình duyệt (tệp này) và máy chủ (`khoa_tim()`,
 * mig 205):
 *
 *  · CHUẨN HOÁ: bỏ dấu (NFD + đ→d), chữ thường, dấu câu thành chỗ ngắt từ.
 *  · MỖI TỪ GÕ PHẢI CÓ MẶT (token-AND), ở trường nào, thứ tự nào cũng được:
 *    "hop sua" ra "Sữa hộp".
 *  · MÃ / SỐ ĐIỆN THOẠI GÕ LIỀN hay có dấu cách, gạch, chấm đều ra: khoá tìm
 *    giữ thêm bản VIẾT LIỀN của mỗi trường ("DH-0123" → "dh0123", SĐT
 *    "0912 345 678" → "0912345678") và bản BỎ SỐ 0 ĐẦU ("dh123").
 *  · XẾP HẠNG: trùng khớp cả mã/SĐT/tên → đầu mã → đầu từ → chứa ở đâu đó;
 *    KHÔNG có kết quả khớp nào thì gợi ý GẦN ĐÚNG theo khoảng
 *    cách sửa chữ (gõ sai một chữ vẫn ra), như Meilisearch / Typesense.
 */

/** Bỏ dấu, hạ chữ thường, gộp khoảng trắng. Dùng cho cả chuỗi tìm lẫn dữ liệu. */
export function viNormalize(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value)
    .normalize("NFD")
    // Dải U+0300–U+036F là các dấu thanh đã tách ra sau NFD.
    .replace(/[̀-ͯ]/g, "")
    // đ/Đ không phải d + dấu nên NFD không đụng tới.
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Chuỗi tìm đã chuẩn hoá có xuất hiện trong giá trị không.
 *
 * ⚠ CHỈ CÒN CHO CÁC PHÉP SO MỘT TRƯỜNG (lọc nâng cao "có chứa"). Ô tìm thì
 *   dùng `viMatchAllWords` / `timXepHang` — chốt tests/tim-chung.test.ts giữ
 *   không màn nào lọc bằng hàm này nữa.
 */
export function viIncludes(value: unknown, normalizedNeedle: string): boolean {
  if (!normalizedNeedle) return true
  return viNormalize(value).includes(normalizedNeedle)
}

/** Khớp khi BẤT KỲ trường nào chứa nguyên chuỗi tìm. Xem `viIncludes`. */
export function viMatch(normalizedQuery: string, ...values: unknown[]): boolean {
  if (!normalizedQuery) return true
  return values.some((v) => viIncludes(v, normalizedQuery))
}

/* ------------------------------------------------------------------ */
/*  KHOÁ TÌM — phải trùng từng ký tự với `public.khoa_tim()` (mig 205)  */
/* ------------------------------------------------------------------ */

/** Chỗ ngắt từ sau khi chuẩn hoá: mọi thứ không phải a-z, 0-9. */
const NGAT_TU = /[^a-z0-9]+/

/** Bỏ số 0 đứng đầu một dãy số: "0123" → "123", "sp0012" → "sp12", "000" → "0". */
export function boSo0Dau(tu: string): string {
  return tu.replace(/(^|[a-z])0+(?=[0-9])/g, "$1")
}

function tachTu(chuan: string): string[] {
  return chuan.split(NGAT_TU).filter(Boolean)
}

/**
 * Khoá tìm của MỘT giá trị: các từ (cách nhau một dấu cách), rồi bản viết
 * liền nếu có từ hai từ, rồi bản viết liền đã bỏ số 0 đầu nếu khác.
 *
 *   "DH-0123"       → "dh 0123 dh0123 dh123"
 *   "0912 345 678"  → "0912 345 678 0912345678 912345678"
 *   "Sữa hộp"       → "sua hop suahop"
 *
 * ⚠ LUẬT NÀY CÓ BẢN SAO Ở SQL (`public.khoa_tim`, mig 205) VÀ Ở MÁY CHỦ GIẢ
 *   (e2e/fake-supabase.mjs). Sửa một chỗ là sửa cả ba — chốt
 *   tests/tim-chung.test.ts so ba bên trên cùng bộ mẫu.
 */
export function viValueKey(value: unknown): string {
  const tu = tachTu(viNormalize(value))
  if (tu.length === 0) return ""
  const lien = tu.join("")
  const out = [tu.join(" ")]
  if (tu.length > 1) out.push(lien)
  const lien0 = tu.map(boSo0Dau).join("")
  if (lien0 !== lien) out.push(lien0)
  return out.join(" ")
}

/**
 * CHỈ MỤC TÌM KIẾM — chuẩn hoá MỘT LẦN, so NHIỀU LẦN.
 *
 * ⚠ VÌ SAO PHẢI TÁCH RA. `viMatchAllWords` chuẩn hoá lại từng trường của
 * từng dòng ở MỖI lần gọi. Màn bán hàng gọi nó cho 1.700 sản phẩm × 3
 * trường ở MỖI PHÍM GÕ: 5.100 lần `normalize("NFD")` + 4 regex + lowercase
 * cho một ký tự người dùng vừa bấm. Trên điện thoại Android tầm trung đó
 * là 15–40 ms mỗi phím — ô tìm kiếm "nuốt" chữ và danh sách nhảy giật.
 *
 * Cách đúng: chuẩn hoá mỗi dòng ĐÚNG MỘT LẦN khi danh mục về
 * (`viSearchKey`), giữ chuỗi đó cạnh dòng, rồi mỗi phím gõ chỉ còn
 * `includes` trên chuỗi có sẵn (`viMatchKey`). Kết quả PHẢI y hệt
 * `viMatchAllWords` — có chốt kiểm thử so hai đường với nhau.
 */

/**
 * Các từ của chuỗi tìm, đã chuẩn hoá. Rỗng nghĩa là "khớp tất cả".
 *
 * ⚠ MỖI TỪ GÕ ĐƯỢC VIẾT LIỀN: "HD-0123" → "hd0123", "Q.8" → "q8",
 *   "0912.345.678" → "0912345678". Khoá tìm có sẵn bản viết liền của mỗi
 *   trường nên từ gõ ấy vẫn khớp, dù dữ liệu ghi có gạch hay không.
 */
export function viQueryWords(rawQuery: string): string[] {
  const out: string[] = []
  for (const w of viNormalize(rawQuery).split(" ")) {
    const t = tachTu(w).join("")
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

/** Một chuỗi chuẩn hoá cho cả bộ trường của một dòng — tính một lần. */
export function viSearchKey(...values: unknown[]): string {
  let out = ""
  for (const v of values) {
    const k = viValueKey(v)
    if (k) out = out ? `${out} ${k}` : k
  }
  return out
}

/** Mọi từ đều xuất hiện trong khoá. `words` rỗng thì khớp. */
export function viMatchKey(key: string, words: string[]): boolean {
  for (let i = 0; i < words.length; i++) {
    if (!key.includes(words[i])) return false
  }
  return true
}

/**
 * Tách chuỗi tìm thành nhiều từ, mỗi từ phải khớp ở ĐÂU ĐÓ trong bộ
 * trường. Cho phép gõ "xanh q8" ra "Bách Hoá Xanh Q.8" — thứ tự từ không
 * quan trọng, và từ có thể nằm ở các trường khác nhau.
 *
 * Dùng cho ô tìm lọc danh sách (bảng) — thứ tự dòng giữ nguyên theo cột
 * người dùng đang sắp. Ô CHỌN (gợi ý, dropdown) thì dùng `timXepHang`.
 */
export function viMatchAllWords(rawQuery: string, ...values: unknown[]): boolean {
  const words = viQueryWords(rawQuery)
  if (!words.length) return true
  return viMatchKey(viSearchKey(...values), words)
}

/* ------------------------------------------------------------------ */
/*  XẾP HẠNG + GẦN ĐÚNG                                                 */
/* ------------------------------------------------------------------ */

/** Một trường đã chuẩn hoá để chấm điểm. */
interface TruongChuan {
  tu: string[]
  tu0: string[]
  lien: string
  lien0: string
}

/** Chỉ mục của một dòng: khoá phẳng để lọc + từng trường để xếp hạng. */
export interface MucTim {
  khoa: string
  truong: TruongChuan[]
}

export function taoMucTim(...values: unknown[]): MucTim {
  const truong: TruongChuan[] = []
  for (const v of values) {
    const tu = tachTu(viNormalize(v))
    const tu0 = tu.map(boSo0Dau)
    truong.push({ tu, tu0, lien: tu.join(""), lien0: tu0.join("") })
  }
  return { khoa: viSearchKey(...values), truong }
}

/** Bậc điểm — càng lớn càng lên đầu. */
export const BAC_TIM = {
  TRUNG_KHOP: 500, // cả mã / SĐT / tên trùng đúng chữ gõ
  DAU_MA: 400, // mã / SĐT / tên BẮT ĐẦU bằng chữ gõ
  DAU_TU_CUNG_TRUONG: 300, // mọi từ gõ đều là đầu một từ trong CÙNG một trường
  DAU_TU: 200, // mọi từ gõ đều là đầu một từ (ở các trường khác nhau)
  CHUA: 100, // mọi từ gõ đều có mặt ở đâu đó
  GAN_DUNG: 50, // gõ sai chữ — gợi ý gần đúng
} as const

const laDauTu = (t: string, f: TruongChuan) => {
  const t0 = boSo0Dau(t)
  for (let i = 0; i < f.tu.length; i++) {
    if (f.tu[i].startsWith(t) || f.tu0[i].startsWith(t0)) return true
  }
  // Từ gõ viết liền qua nhiều từ của trường ("dh0123" với "dh 0123").
  return f.lien.startsWith(t) || f.lien0.startsWith(t0)
}

/**
 * Điểm của một dòng ĐÃ khớp (mọi từ có trong khoá). 0 = không khớp.
 * Trường ĐẦU TIÊN quan trọng nhất (truyền mã / tên trước, ghi chú sau):
 * cùng bậc thì trường đứng trước thắng.
 */
export function diemTim(muc: MucTim, words: string[]): number {
  if (!words.length) return 0
  if (!viMatchKey(muc.khoa, words)) return 0
  const q = words.join("")
  const q0 = boSo0Dau(q)
  let best: number = BAC_TIM.CHUA
  const phat = (i: number) => Math.min(i, 9) * 10
  for (let i = 0; i < muc.truong.length; i++) {
    const f = muc.truong[i]
    if (!f.lien) continue
    let d = 0
    if (f.lien === q || f.lien0 === q0) d = BAC_TIM.TRUNG_KHOP
    else if (f.lien.startsWith(q) || f.lien0.startsWith(q0)) d = BAC_TIM.DAU_MA
    else if (words.every((t) => laDauTu(t, f))) d = BAC_TIM.DAU_TU_CUNG_TRUONG
    if (d) best = Math.max(best, d - phat(i))
  }
  if (best === BAC_TIM.CHUA && words.every((t) => muc.truong.some((f) => laDauTu(t, f)))) {
    best = BAC_TIM.DAU_TU
  }
  return best
}

/**
 * Khoảng cách sửa chữ (Damerau–Levenshtein bản OSA: thêm, bớt, thay, đảo
 * hai chữ liền nhau). Dừng sớm khi đã vượt `tran`.
 */
export function khoangCachSua(a: string, b: string, tran = 3): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > tran) return tran + 1
  const m = a.length
  const n = b.length
  let truoc2: number[] = []
  let truoc: number[] = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const hang = [i]
    let nhoNhat = i
    for (let j = 1; j <= n; j++) {
      const doi = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(truoc[j] + 1, hang[j - 1] + 1, truoc[j - 1] + doi)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, truoc2[j - 2] + 1)
      }
      hang.push(v)
      if (v < nhoNhat) nhoNhat = v
    }
    if (nhoNhat > tran) return tran + 1
    truoc2 = truoc
    truoc = hang
  }
  return truoc[n]
}

/**
 * Số chữ được gõ sai cho một từ — như Meilisearch: từ ngắn phải đúng, từ
 * 5–8 chữ được sai 1, từ 9 chữ trở lên được sai 2.
 *
 * ⚠ TỪ TIẾNG VIỆT NGẮN, VÀ HAI TỪ NGẮN HAY CHỈ LỆCH MỘT CHỮ ("banh" / "xanh",
 *   "mam" / "man"). Cho sai 1 từ 4 chữ là gõ "banh" ra "Kem đậu xanh" — gợi
 *   ý rác. Nên từ dưới 5 chữ phải đúng, và chữ ĐẦU luôn phải đúng.
 *
 * ⚠ TỪ CÓ CHỮ SỐ KHÔNG ĐƯỢC SAI. Mã đơn "0123" gần đúng "0124" là đưa
 *   nhầm đơn — mã, SĐT, số lượng phải khớp thật.
 */
export function soChuDuocSai(t: string): number {
  if (/[0-9]/.test(t)) return 0
  if (t.length >= 9) return 2
  if (t.length >= 5) return 1
  return 0
}

/** Từ gõ `t` có "gần đúng" một từ nào của dòng không (so cả đầu từ khi đang gõ dở). */
function ganDungTu(t: string, muc: MucTim): boolean {
  const tran = soChuDuocSai(t)
  if (muc.khoa.includes(t)) return true
  if (tran === 0) return false
  for (const f of muc.truong) {
    for (const w of f.tu) {
      if (w[0] !== t[0]) continue
      if (Math.abs(w.length - t.length) <= tran && khoangCachSua(t, w, tran) <= tran) return true
      // Đang gõ dở một từ dài: so với đoạn đầu của từ.
      if (w.length > t.length) {
        for (let l = t.length - 1; l <= t.length + 1; l++) {
          if (l > 0 && l < w.length && khoangCachSua(t, w.slice(0, l), tran) <= tran) return true
        }
      }
    }
  }
  return false
}

export interface TuyChonTim {
  /** Số dòng tối đa trả về (vẫn đếm đủ số khớp). */
  gioiHan?: number
  /** Có gợi ý gần đúng khi quá ít kết quả không. Mặc định CÓ. */
  ganDung?: boolean
  /**
   * Ít hơn số này kết quả khớp thật thì mới gợi ý gần đúng. Mặc định 1 — chỉ
   * khi KHÔNG có gì khớp: đã có dòng khớp thật mà vẫn chêm gợi ý là rác.
   */
  ganDungKhiDuoi?: number
  /** Thứ tự phụ khi cùng điểm (vd tồn kho). Mặc định giữ thứ tự gốc. */
  soPhu?: (a: number, b: number) => number
  /**
   * Nhớ chỉ mục theo MẢNG `items` (cùng mảng, cùng nhãn → không chuẩn hoá lại).
   * Dùng cho danh mục lớn lọc ở mỗi phím gõ — xem chú thích `viSearchKey`.
   */
  nho?: string
}

const boNhoChiMuc = new WeakMap<object, Map<string, MucTim[]>>()

/** Chỉ mục của cả danh sách — nhớ theo mảng khi có `nho`. */
export function chiMucTim<T>(items: readonly T[], truong: (item: T) => unknown[], nho?: string): MucTim[] {
  if (!nho) return items.map((it) => taoMucTim(...truong(it)))
  let theoNhan = boNhoChiMuc.get(items)
  if (!theoNhan) {
    theoNhan = new Map()
    boNhoChiMuc.set(items, theoNhan)
  }
  let muc = theoNhan.get(nho)
  if (!muc) {
    muc = items.map((it) => taoMucTim(...truong(it)))
    theoNhan.set(nho, muc)
  }
  return muc
}

export interface KetQuaTim<T> {
  ketQua: T[]
  /** Số dòng KHỚP THẬT (không tính gợi ý gần đúng). */
  soKhop: number
  /** Số dòng gợi ý gần đúng đã thêm ở cuối `ketQua`. */
  ganDung: number
}

/**
 * LỌC + XẾP HẠNG trên chỉ mục có sẵn (danh mục lớn: dựng `taoMucTim` một lần).
 * Chuỗi tìm rỗng thì giữ nguyên thứ tự gốc.
 */
export function locXepHang<T>(
  items: readonly T[],
  muc: readonly MucTim[],
  rawQuery: string,
  opt: TuyChonTim = {}
): KetQuaTim<T> {
  const gioiHan = opt.gioiHan ?? Infinity
  const words = viQueryWords(rawQuery)
  if (!words.length) {
    return { ketQua: items.slice(0, gioiHan), soKhop: items.length, ganDung: 0 }
  }
  const khop: Array<{ i: number; d: number }> = []
  for (let i = 0; i < items.length; i++) {
    const d = diemTim(muc[i], words)
    if (d) khop.push({ i, d })
  }
  const so = (a: { i: number; d: number }, b: { i: number; d: number }) =>
    b.d - a.d || (opt.soPhu ? opt.soPhu(a.i, b.i) : 0) || a.i - b.i
  khop.sort(so)
  const ketQua = khop.slice(0, gioiHan).map((k) => items[k.i])
  let ganDung = 0
  const duoi = opt.ganDungKhiDuoi ?? 1
  if (opt.ganDung !== false && khop.length < duoi && ketQua.length < gioiHan && words.some((t) => soChuDuocSai(t) > 0)) {
    const da = new Set(khop.map((k) => k.i))
    const them: Array<{ i: number; d: number }> = []
    for (let i = 0; i < items.length; i++) {
      if (da.has(i)) continue
      if (words.every((t) => ganDungTu(t, muc[i]))) them.push({ i, d: BAC_TIM.GAN_DUNG })
    }
    them.sort(so)
    for (const k of them) {
      if (ketQua.length >= gioiHan) break
      ketQua.push(items[k.i])
      ganDung++
    }
  }
  return { ketQua, soKhop: khop.length, ganDung }
}

/**
 * LỌC + XẾP HẠNG cho danh sách nhỏ (dựng chỉ mục tại chỗ).
 *
 *   timXepHang(khach, q, (c) => [c.phone, c.store_name, c.owner_name], { gioiHan: 30 })
 *
 * `truong` trả các trường theo THỨ TỰ QUAN TRỌNG (mã/SĐT/tên trước).
 */
export function timXepHang<T>(
  items: readonly T[],
  rawQuery: string,
  truong: (item: T) => unknown[],
  opt: TuyChonTim = {}
): KetQuaTim<T> {
  if (!viQueryWords(rawQuery).length) {
    const gioiHan = opt.gioiHan ?? Infinity
    return { ketQua: items.slice(0, gioiHan), soKhop: items.length, ganDung: 0 }
  }
  return locXepHang(items, chiMucTim(items, truong, opt.nho), rawQuery, opt)
}
