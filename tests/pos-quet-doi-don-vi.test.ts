import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve, join } from "node:path"

/**
 * ⚠ CHỐT QUÉT: MỌI CHỖ ĐỔI ĐƠN VỊ CỦA MỘT DÒNG POS PHẢI ĐI QUA HÀM DÙNG CHUNG
 *   (`doiDonVi*` trong src/lib/pos/units.ts). Chủ nhà chốt 23/09/2026.
 *
 * Vì sao có chốt này: năm màn POS mỗi màn tự viết phần đổi đơn vị. Một màn
 * làm đúng (dòng bán tra lại bảng giá), bốn chỗ khác chỉ đổi NHÃN — giá
 * giữ nguyên, khoản trừ / giá vốn sai đúng bằng hệ số. Chủ nhà báo một
 * chỗ, rà ra thêm bốn. Chốt quét cả thư mục để màn thứ sáu viết sau này
 * cũng không lọt.
 *
 * Hai luật:
 *   1. CẤM ghi thẳng đơn vị: một lệnh vá dòng (`patch…(`, `sua(`,
 *      `set…Lines(`) mà đối tượng mở đầu bằng `unit:` — đó là đổi nhãn.
 *   2. MỌI ô chọn đơn vị (select `value={l.unit}`, `<PosUnitSelect`) và mọi
 *      chip đơn vị (onClick có `u.unit_name`) phải gọi `doiDonVi…(`.
 */

export interface ViPham { tep: string; dong: number; luat: 1 | 2; trich: string }

const soDong = (s: string, i: number) => s.slice(0, i).split("\n").length

/** Đoạn thân handler bắt đầu từ `{` ở vị trí `i`, cân ngoặc. */
function thanNgoac(s: string, i: number): string {
  let sau = 0
  for (let k = i; k < s.length; k++) {
    if (s[k] === "{") sau++
    else if (s[k] === "}" && --sau === 0) return s.slice(i, k + 1)
  }
  return s.slice(i)
}

export function quetDoiDonVi(tep: string, s: string): ViPham[] {
  const out: ViPham[] = []

  // Luật 1 — lệnh vá dòng mà đối tượng mở đầu bằng `unit:`.
  const cam = /\b(patch\w*|sua|set\w*Lines)\(\s*(?:[\w.]+,\s*)?(?:\([^()]*=>\s*[^{]*)?\{\s*(?:\.\.\.[\w.]+,\s*)?unit\s*:/g
  for (const m of Array.from(s.matchAll(cam))) {
    out.push({ tep, dong: soDong(s, m.index!), luat: 1, trich: m[0] })
  }
  // Trải một dòng CÓ SẴN rồi ghi đè `unit:` ngay sau — cũng là đổi nhãn.
  for (const m of Array.from(s.matchAll(/\{\s*\.\.\.(?:x|l|d|dong|line|cu)\s*,\s*unit\s*:/g))) {
    if (out.some((v) => v.dong === soDong(s, m.index!))) continue
    out.push({ tep, dong: soDong(s, m.index!), luat: 1, trich: m[0] })
  }

  // Luật 2 — ô chọn / chip đơn vị phải gọi phép đổi dùng chung.
  const oChon: number[] = []
  for (const m of Array.from(s.matchAll(/<PosUnitSelect\b/g))) oChon.push(m.index!)
  /* Nút đơn vị bấm-nhảy (24/09/2026) — cùng luật: onChange phải gọi phép đổi dùng chung. */
  for (const m of Array.from(s.matchAll(/<UnitCycleButton\b/g))) oChon.push(m.index!)
  for (const m of Array.from(s.matchAll(/<select\b/g))) {
    const the = s.slice(m.index!, s.indexOf(">", m.index!) + 1)
    if (/value=\{l\.unit\}/.test(the)) oChon.push(m.index!)
  }
  for (const i of oChon) {
    const j = s.indexOf("onChange={", i)
    const than = j < 0 ? "" : thanNgoac(s, j + "onChange=".length)
    /* Ngoại lệ có chủ ý: dòng trả CÓ SẴN ở màn hóa đơn chỉ gửi đơn vị mới (`setTraDv`) —
       máy chủ tự quy giá theo hệ số (mig 181), trình duyệt không được tự tính. */
    if (!/\bdoiDonVi\w*\(/.test(than) && !/\bsetTraDv\(/.test(than) && !/unitPriceFor\(/.test(than)) {
      out.push({ tep, dong: soDong(s, i), luat: 2, trich: than.slice(0, 80) || "(không có onChange)" })
    }
  }
  for (const m of Array.from(s.matchAll(/onClick=\{/g))) {
    const than = thanNgoac(s, m.index! + "onClick=".length)
    if (/\bu\.unit_name\b/.test(than) && !/\bdoiDonVi\w*\(/.test(than)) {
      out.push({ tep, dong: soDong(s, m.index!), luat: 2, trich: than.slice(0, 80) })
    }
  }
  return out
}

const GOC = resolve(__dirname, "..")
function tepTsx(thuMuc: string): string[] {
  return readdirSync(resolve(GOC, thuMuc), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? tepTsx(join(thuMuc, d.name)) : d.name.endsWith(".tsx") ? [join(thuMuc, d.name)] : []
  )
}

describe("máy quét tự kiểm — bắt được đúng mấy lỗi đã gặp", () => {
  it.each([
    ["chip hàng trả chỉ đổi nhãn (lỗi chủ nhà báo)", `onClick={() => sua({ unit: u.unit_name })}`],
    ["select nhập hàng chỉ đổi nhãn", `<select value={l.unit} onChange={(e) => patchLine(l.key, { unit: e.target.value })}>`],
    ["setLines ghi thẳng đơn vị", `setLines((c) => c.map((x) => ({ ...x, unit: "thùng" })))`],
    ["ô PosUnitSelect không gọi phép đổi", `<PosUnitSelect value={l.unit} onChange={(u) => patch(l.key, { price: 1 })} />`],
  ])("%s → báo vi phạm", (_ten, mau) => {
    expect(quetDoiDonVi("mau.tsx", mau).length).toBeGreaterThan(0)
  })

  it("nút bấm-nhảy không gọi phép đổi → báo vi phạm", () => {
    expect(quetDoiDonVi("mau.tsx", `<UnitCycleButton units={ds} value={l.unit} label="x" onChange={(u) => patch(l.key, { price: 1 })} />`).length).toBeGreaterThan(0)
  })

  it.each([
    ["nút bấm-nhảy gọi doiDonVi", `<UnitCycleButton units={ds} value={l.unit} label="x" onChange={(u) => doiDonVi(l, u)} />`],
    ["chip gọi doiDonVi", `onClick={() => doiDonVi(l, u.unit_name)}`],
    ["select gọi doiDonViTheoHeSo", `<select value={l.unit} onChange={(e) => patchLine(l.key, doiDonViTheoHeSo(l, e.target.value))}>`],
    ["giảm giá cũng có khoá `unit` nhưng không phải đơn vị tính", `patchLine(l.key, { discount: { value: 0, unit: "vnd" } })`],
    ["dựng dòng mới", `setLines((cu) => [...cu, { key: newKey(), productId: p.id, unit: p.base_unit }])`],
  ])("%s → không báo", (_ten, mau) => {
    expect(quetDoiDonVi("mau.tsx", mau)).toEqual([])
  })
})

describe("mọi màn POS đổi đơn vị qua hàm dùng chung", () => {
  const tep = tepTsx("src/components/pos")

  it("quét được các màn có ô đơn vị (không quét hụt thư mục)", () => {
    const coODonVi = tep.filter((f) => /value=\{l\.unit\}|<PosUnitSelect|u\.unit_name[,)]|<UnitCycleButton\b/.test(readFileSync(resolve(GOC, f), "utf-8")))
    expect(coODonVi.map((f) => f.split("/").pop()).sort()).toEqual(
      /* Từ 24/09/2026 màn hóa đơn cũng dùng `UnitCycleButton` — vào diện quét. */
      ["invoice-screen.tsx", "order-screen.tsx", "purchase-screen.tsx", "return-screen.tsx"]
    )
  })

  it("không màn nào đổi nhãn đơn vị mà bỏ qua giá", () => {
    const vp = tep.flatMap((f) => quetDoiDonVi(f, readFileSync(resolve(GOC, f), "utf-8")))
    expect(vp.map((v) => `${v.tep}:${v.dong} luật ${v.luat} — ${v.trich}`)).toEqual([])
  })
})
