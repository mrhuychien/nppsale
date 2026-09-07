/**
 * Đọc file công nợ đầu kỳ và LẬP KẾ HOẠCH ghi — thuần, không chạm mạng.
 *
 * Nguyên tắc xuyên suốt file này: KHÔNG ĐOÁN. Ô nào đọc không chắc thì
 * thành dòng LỖI kèm lý do đọc được, chứ không tự chọn một cách hiểu rồi
 * ghi vào sổ tiền. Người ta nhập công nợ đầu kỳ đúng một lần và tin nó;
 * một dòng hiểu sai âm thầm sẽ sống trong sổ nhiều năm.
 */

/** Kết quả đọc một ô số tiền. */
export type AmountResult =
  | { ok: true; value: number }
  | { ok: false; blank: true }
  | { ok: false; blank?: false; reason: string }

/**
 * Đọc số tiền VND.
 *
 * Chấp nhận: số thật của Excel (12400000), chuỗi có dấu phân cách nghìn
 * ("12.400.000", "12,400,000", "12 400 000").
 *
 * TỪ CHỐI phần thập phân. "12.5" trong file có thể là 125 (dấu chấm phân
 * cách nghìn kiểu VN, gõ thiếu) hoặc 12,5 (kiểu Anh). Hệ thống này ghi
 * VND không có số lẻ, nên cả hai cách hiểu đều có thể đúng — mà đoán sai
 * là lệch 10 lần. Trả lỗi để người ta sửa file.
 */
export function parseAmount(raw: unknown): AmountResult {
  if (raw === null || raw === undefined) return { ok: false, blank: true }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { ok: false, reason: "không phải số" }
    if (!Number.isInteger(raw)) {
      return { ok: false, reason: `có phần lẻ (${raw}) — VND không dùng số lẻ` }
    }
    if (raw < 0) return { ok: false, reason: "số âm" }
    return { ok: true, value: raw }
  }
  const s = String(raw).trim()
  if (!s) return { ok: false, blank: true }
  // Dấu phân cách đứng trước 1-2 chữ số cuối = phần thập phân, không phải
  // phân cách nghìn (phân cách nghìn luôn đi với đúng 3 chữ số).
  if (/[.,]\d{1,2}$/.test(s)) {
    return { ok: false, reason: `"${s}" có phần lẻ — VND không dùng số lẻ` }
  }
  const cleaned = s.replace(/[\s .,'’]/g, "")
  if (!/^\d+$/.test(cleaned)) {
    if (/^-/.test(cleaned)) return { ok: false, reason: `"${s}" là số âm` }
    return { ok: false, reason: `không đọc được số từ "${s}"` }
  }
  return { ok: true, value: Number(cleaned) }
}

/** Kết quả đọc một ô ngày. */
export type DateResult =
  | { ok: true; value: string | null }
  | { ok: false; reason: string }

/** Ngày dạng YYYY-MM-DD lấy theo giờ ĐỊA PHƯƠNG của đối tượng Date. */
function ymdLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * Đọc hạn thanh toán.
 *
 * Excel trả về đối tượng Date (khi bật cellDates) — phải lấy phần ngày
 * theo giờ ĐỊA PHƯƠNG. Dùng toISOString() sẽ lùi một ngày với mọi múi giờ
 * dương, và Việt Nam là UTC+7: hạn 01/03 thành 28/02.
 *
 * Chuỗi thì chỉ nhận dd/mm/yyyy và yyyy-mm-dd. KHÔNG nhận mm/dd/yyyy —
 * "03/04/2026" là mồng 3 tháng 4 ở đây và mồng 4 tháng 3 ở Mỹ, không có
 * cách nào biết người gõ định nói gì, nên chốt một quy ước và ghi ra.
 */
export function parseDueDate(raw: unknown): DateResult {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return { ok: false, reason: "ngày không hợp lệ" }
    return { ok: true, value: ymdLocal(raw) }
  }
  const s = String(raw).trim()
  if (!s) return { ok: true, value: null }

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  const vn = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s)
  let y: number, m: number, d: number
  if (iso) {
    y = Number(iso[1]); m = Number(iso[2]); d = Number(iso[3])
  } else if (vn) {
    d = Number(vn[1]); m = Number(vn[2]); y = Number(vn[3])
  } else {
    return { ok: false, reason: `ngày "${s}" không theo dd/mm/yyyy` }
  }
  if (m < 1 || m > 12) return { ok: false, reason: `tháng ${m} không hợp lệ trong "${s}"` }
  // Dựng Date rồi so lại từng phần: bắt được 31/02 mà JS tự đẩy sang 03/03.
  const probe = new Date(y, m - 1, d)
  if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) {
    return { ok: false, reason: `ngày "${s}" không có thật` }
  }
  return { ok: true, value: ymdLocal(probe) }
}

/** Chuẩn hoá khoá dự phòng (SĐT / mã NCC) khi SO SÁNH. */
export function normalizeKey(v: unknown): string {
  return String(v ?? "").trim().toLowerCase().replace(/[\s .\-()]/g, "")
}

/** Chuẩn hoá tên để dò trùng — bỏ dấu, gộp khoảng trắng. */
export function normalizeName(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
}

/** Một dòng đọc từ file, chưa diễn giải. */
export type SourceRow = {
  /** Số dòng trong Excel (tính cả dòng tiêu đề) — để người dùng dò lại. */
  rowNo: number
  id?: unknown
  name?: unknown
  altKey?: unknown
  amount?: unknown
  dueDate?: unknown
  note?: unknown
}

/** Khách hàng / NCC đang có trong hệ thống. */
export type Entity = {
  id: string
  /** Tên hiển thị. */
  label: string
  /** SĐT (khách) hoặc mã (NCC). Có thể rỗng. */
  altKey: string
}

/** Dòng công nợ đầu kỳ ĐANG có trong sổ. */
export type ExistingOpening = {
  /** id của dòng receivables / payables. */
  id: string
  /** customer_id hoặc supplier_id. */
  entityId: string
  amount: number
  paid: number
  dueDate: string | null
  note: string | null
}

export type PlanAction = "create" | "update" | "unchanged" | "delete" | "skip" | "error"

export type PlanRow = {
  rowNo: number
  action: PlanAction
  /** Tên để hiện lên bảng xem trước. */
  label: string
  entityId?: string
  /** id dòng công nợ đang có (update / delete). */
  existingId?: string
  amount?: number
  dueDate?: string | null
  note?: string | null
  /** Giá trị cũ, để bảng xem trước chỉ ra cái gì đổi thành cái gì. */
  before?: { amount: number; dueDate: string | null }
  /** Lý do lỗi hoặc lý do bỏ qua. */
  message?: string
}

export type Plan = {
  rows: PlanRow[]
  counts: Record<PlanAction, number>
  /** Vân tay của phần SẼ GHI. Xem ghi chú ở planFingerprint. */
  fingerprint: string
}

/**
 * Vân tay kế hoạch.
 *
 * Người dùng xem bảng rồi bấm ghi. Giữa hai thao tác đó, file có thể được
 * chọn lại hoặc dữ liệu nền đổi. Vân tay tính trên ĐÚNG những gì sẽ ghi,
 * nên nếu kế hoạch đổi thì chuỗi đổi và nút ghi biết mình đang cầm kế
 * hoạch cũ.
 *
 * FNV-1a: đủ để phát hiện thay đổi ngoài ý muốn, và thuần đồng bộ nên
 * test được. Đây KHÔNG phải hàm băm bảo mật và không dùng cho việc đó.
 */
export function planFingerprint(rows: PlanRow[]): string {
  const material = rows
    .filter((r) => r.action === "create" || r.action === "update" || r.action === "delete")
    .map((r) => `${r.action}|${r.entityId}|${r.amount ?? ""}|${r.dueDate ?? ""}|${(r.note ?? "").trim()}`)
    .sort()
    .join("\n")
  let h = 0x811c9dc5
  for (let i = 0; i < material.length; i++) {
    h ^= material.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, "0")
}

/**
 * Biến các dòng đọc được thành kế hoạch ghi.
 *
 * Khớp theo thứ tự: id → khoá dự phòng (SĐT/mã) → tên. Tên chỉ nhận khi
 * DUY NHẤT một đối tượng mang tên đó; hai khách trùng tên thì thành lỗi
 * chứ không lấy đại cái đầu tiên.
 */
export function buildPlan(
  rows: SourceRow[],
  entities: Entity[],
  existing: ExistingOpening[]
): Plan {
  const byId = new Map(entities.map((e) => [e.id, e]))
  const byKey = new Map<string, Entity[]>()
  const byName = new Map<string, Entity[]>()
  for (const e of entities) {
    const k = normalizeKey(e.altKey)
    if (k) {
      const arr = byKey.get(k)
      if (arr) arr.push(e)
      else byKey.set(k, [e])
    }
    const n = normalizeName(e.label)
    if (n) {
      const arr = byName.get(n)
      if (arr) arr.push(e)
      else byName.set(n, [e])
    }
  }
  const openingByEntity = new Map(existing.map((x) => [x.entityId, x]))
  /** Đối tượng đã bị một dòng trước nhận — chống hai dòng đè lên nhau. */
  const claimed = new Map<string, number>()

  const out: PlanRow[] = []

  for (const r of rows) {
    const rawLabel = String(r.name ?? "").trim()
    const err = (message: string, label = rawLabel || `Dòng ${r.rowNo}`): PlanRow => ({
      rowNo: r.rowNo, action: "error", label, message,
    })

    // --- Khớp đối tượng ------------------------------------------------
    let ent: Entity | undefined
    const idRaw = String(r.id ?? "").trim()
    if (idRaw) {
      ent = byId.get(idRaw)
      if (!ent) {
        out.push(err(`ID "${idRaw}" không có trong hệ thống`))
        continue
      }
    } else {
      const k = normalizeKey(r.altKey)
      if (k) {
        const hits = byKey.get(k) || []
        if (hits.length > 1) {
          out.push(err(`"${String(r.altKey).trim()}" trùng ở ${hits.length} bản ghi — điền cột ID để chỉ đích danh`))
          continue
        }
        ent = hits[0]
      }
      if (!ent && rawLabel) {
        const hits = byName.get(normalizeName(rawLabel)) || []
        if (hits.length > 1) {
          out.push(err(`tên "${rawLabel}" trùng ở ${hits.length} bản ghi — điền cột ID để chỉ đích danh`))
          continue
        }
        ent = hits[0]
      }
      if (!ent) {
        out.push(err("không tìm thấy — thiếu cả ID lẫn khoá dự phòng khớp được"))
        continue
      }
    }

    const label = ent.label
    const dupOf = claimed.get(ent.id)
    if (dupOf !== undefined) {
      out.push(err(`trùng đối tượng với dòng ${dupOf}`, label))
      continue
    }

    // --- Đọc số tiền ----------------------------------------------------
    const amt = parseAmount(r.amount)
    if (!amt.ok && amt.blank) {
      // Bỏ trống là chuyện BÌNH THƯỜNG: xuất ra 500 khách, điền 40.
      out.push({ rowNo: r.rowNo, action: "skip", label, entityId: ent.id, message: "bỏ trống" })
      continue
    }
    if (!amt.ok) {
      out.push(err(amt.reason, label))
      continue
    }

    const due = parseDueDate(r.dueDate)
    if (!due.ok) {
      out.push(err(due.reason, label))
      continue
    }
    const note = String(r.note ?? "").trim() || null
    const current = openingByEntity.get(ent.id)
    claimed.set(ent.id, r.rowNo)

    // --- Số 0 nghĩa là XOÁ dòng đầu kỳ -----------------------------------
    if (amt.value === 0) {
      if (!current) {
        out.push({ rowNo: r.rowNo, action: "skip", label, entityId: ent.id, message: "số 0 mà chưa có công nợ đầu kỳ" })
        continue
      }
      if (current.paid > 0) {
        out.push(err(`đã thu ${current.paid} trên khoản đầu kỳ này — không xoá được`, label))
        continue
      }
      out.push({
        rowNo: r.rowNo, action: "delete", label, entityId: ent.id,
        existingId: current.id,
        before: { amount: current.amount, dueDate: current.dueDate },
      })
      continue
    }

    // --- Tạo mới ---------------------------------------------------------
    if (!current) {
      out.push({
        rowNo: r.rowNo, action: "create", label, entityId: ent.id,
        amount: amt.value, dueDate: due.value, note,
      })
      continue
    }

    // --- Cập nhật / không đổi --------------------------------------------
    // Không cho hạ số nợ xuống dưới số ĐÃ THU: sổ sẽ thành "trả thừa".
    if (amt.value < current.paid) {
      out.push(err(`số mới ${amt.value} nhỏ hơn số đã thu ${current.paid}`, label))
      continue
    }
    const same =
      current.amount === amt.value &&
      (current.dueDate ?? null) === (due.value ?? null) &&
      (current.note ?? null) === note
    out.push({
      rowNo: r.rowNo,
      action: same ? "unchanged" : "update",
      label,
      entityId: ent.id,
      existingId: current.id,
      amount: amt.value,
      dueDate: due.value,
      note,
      before: { amount: current.amount, dueDate: current.dueDate },
    })
  }

  const counts: Record<PlanAction, number> = {
    create: 0, update: 0, unchanged: 0, delete: 0, skip: 0, error: 0,
  }
  for (const r of out) counts[r.action]++

  return { rows: out, counts, fingerprint: planFingerprint(out) }
}
