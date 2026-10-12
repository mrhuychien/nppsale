/**
 * DUYỆT ẢNH + VỊ TRÍ ĐIỂM BÁN (mig 244) — chủ nhà 12/10/2026: "Khi nhân viên cập nhật ảnh điểm bán và định vị. Chủ
 * NPP đã phê duyệt thì khi thay đổi hoặc xoá ảnh+vị trí cần nhà phân phối phê duyệt."
 *
 * - Chưa duyệt: NVBH sửa thẳng như cũ. Người duyệt bấm "Duyệt ảnh + vị trí" → khoá.
 * - Đã duyệt: người KHÔNG có quyền duyệt đổi / xoá → GỬI YÊU CẦU (`xin_doi_anh_diem_ban`), chưa đổi gì; người duyệt
 *   đồng ý / từ chối (`duyet_yeu_cau_anh_diem_ban`). Database tự chặn ghi thẳng (trigger mig 244).
 * - Người duyệt = quyền `customers.approve`: chủ NPP luôn có; ai khác do chủ NPP cấp ở Phân quyền.
 * Mọi RPC trả `file_bo` — URL ảnh không còn dùng — để màn gọi /api/customers/photo-cleanup xoá file.
 */
import type { CoRpc } from "@/lib/db/co-rpc"
import { hasPermission, type Role } from "@/lib/permissions"

export type PhotoRequestKind = "photo_add" | "photo_replace" | "photo_delete" | "pin_set" | "pin_clear"

export type PhotoRequest = {
  id: string
  kind: PhotoRequestKind
  photo_id: string | null
  slot: number | null
  photo_url: string | null
  taken_at: string | null
  gps_lat: number | null
  gps_lng: number | null
  gps_accuracy: number | null
  pin_lat: number | null
  pin_lng: number | null
  requested_by: string | null
  requested_at: string
  requester?: { full_name?: string | null } | null
}

/** Cột đọc yêu cầu đang chờ — một chỗ cho khối ảnh và màn Chờ duyệt. */
export const PHOTO_REQUEST_COLUMNS =
  "id, kind, photo_id, slot, photo_url, taken_at, gps_lat, gps_lng, gps_accuracy, pin_lat, pin_lng, requested_by, requested_at, requester:users!customer_photo_requests_requested_by_fkey(full_name)"

/** Người này duyệt được ảnh điểm bán không (ô Khách hàng → Duyệt; chủ NPP luôn được). */
export function canApprovePhotos(role: Role | null | undefined): boolean {
  return !!role && hasPermission(role, "customers", "approve")
}

/** Đã duyệt mà người này không có quyền duyệt → thay đổi phải GỬI YÊU CẦU, không ghi thẳng. */
export function mustRequestChange(approvedAt: string | null | undefined, canApprove: boolean): boolean {
  return !!approvedAt && !canApprove
}

/** Câu ngắn cho một yêu cầu — trùng `_mo_ta_yeu_cau_anh` (mig 244), thông báo và màn đọc như nhau. */
export function requestLabel(kind: PhotoRequestKind, slot: number | null | undefined): string {
  switch (kind) {
    case "photo_add":
      return `Thêm ảnh ${slot ?? ""}`.trim()
    case "photo_replace":
      return `Thay ảnh ${slot ?? ""}`.trim()
    case "photo_delete":
      return `Xoá ảnh ${slot ?? ""}`.trim()
    case "pin_set":
      return "Dời vị trí"
    case "pin_clear":
      return "Xoá vị trí"
  }
}

/** Ô ảnh đã dùng: ảnh đang có + ảnh MỚI đang chờ duyệt — ảnh chụp thêm kế tiếp không đè lên ô đang chờ. */
export function slotsInUse(photos: Array<{ slot: number }>, pending: Array<Pick<PhotoRequest, "kind" | "slot">>): number[] {
  const out = new Set(photos.map((p) => p.slot))
  for (const r of pending) if (r.kind === "photo_add" && r.slot != null) out.add(r.slot)
  return Array.from(out).sort((a, b) => a - b)
}

/** Yêu cầu đang chờ của một ô ảnh / của vị trí (mỗi chỗ chỉ một — chỉ mục duy nhất ở mig 244). */
export function pendingForSlot(pending: PhotoRequest[], slot: number): PhotoRequest | null {
  return pending.find((r) => r.kind.startsWith("photo_") && r.slot === slot) ?? null
}
export function pendingForPin(pending: PhotoRequest[]): PhotoRequest | null {
  return pending.find((r) => r.kind === "pin_set" || r.kind === "pin_clear") ?? null
}

/** Máy chủ chưa chạy mig 244 (thiếu bảng / cột / hàm duyệt ảnh). */
export function chuaCoDuyetAnh(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as { code?: string; message?: string }
  const m = String(e.message ?? "").toLowerCase()
  const lienQuan = /customer_photo_requests|photo_approved|duyet_anh_diem_ban|xin_doi_anh_diem_ban|yeu_cau_anh_diem_ban/.test(m)
  // Thiếu bảng / hàm: chỉ có thể là chưa chạy migration. Thiếu cột: chỉ khi đúng cột của mig 244.
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(String(e.code ?? ""))) return true
  if (["42703", "PGRST204"].includes(String(e.code ?? ""))) return lienQuan
  return lienQuan && (m.includes("does not exist") || m.includes("schema cache") || m.includes("could not find"))
}

/** Câu lỗi sang tiếng người: cắt mã ở đầu (`ANH_DA_DUYET: …`); máy chủ chưa có thì nói phải chạy migration. */
export function loiDuyetAnh(err: unknown): string {
  if (chuaCoDuyetAnh(err)) return "Máy chủ chưa có bước duyệt ảnh điểm bán — cần chạy migration 244 trên Supabase."
  const msg = String((err as { message?: string } | null)?.message ?? err ?? "").trim()
  const m = /^[A-Z_]+:\s*([\s\S]+)$/.exec(msg)
  return m ? m[1] : msg || "Lỗi không xác định"
}

function fileBo(data: unknown): string[] {
  const v = (data as { file_bo?: unknown } | null)?.file_bo
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : []
}

export type XinDoiAnh = {
  customerId: string
  photo?:
    | { action: "add"; slot: number; url: string; takenAt: string; lat: number | null; lng: number | null; accuracy: number | null }
    | { action: "replace"; photoId: string; url: string; takenAt: string; lat: number | null; lng: number | null; accuracy: number | null }
    | { action: "delete"; photoId: string }
  pin?: { action: "set"; lat: number; lng: number } | { action: "clear" }
}

/** NV gửi yêu cầu đổi (điểm bán đã duyệt). Trả file ảnh của yêu cầu cũ bị thay để dọn. */
export async function xinDoiAnh(sb: CoRpc, input: XinDoiAnh): Promise<{ ids: string[]; fileBo: string[] }> {
  const p = input.photo
  const { data, error } = await sb.rpc("xin_doi_anh_diem_ban", {
    p_customer_id: input.customerId,
    p_photo_action: p?.action ?? "none",
    p_photo_id: p && p.action !== "add" ? p.photoId : null,
    p_slot: p?.action === "add" ? p.slot : null,
    p_photo_url: p && p.action !== "delete" ? p.url : null,
    p_taken_at: p && p.action !== "delete" ? p.takenAt : null,
    p_gps_lat: p && p.action !== "delete" ? p.lat : null,
    p_gps_lng: p && p.action !== "delete" ? p.lng : null,
    p_gps_accuracy: p && p.action !== "delete" ? p.accuracy : null,
    p_pin_action: input.pin?.action ?? "keep",
    p_pin_lat: input.pin?.action === "set" ? input.pin.lat : null,
    p_pin_lng: input.pin?.action === "set" ? input.pin.lng : null,
  })
  if (error) throw new Error(loiDuyetAnh(error))
  const ids = (data as { ids?: unknown } | null)?.ids
  return { ids: Array.isArray(ids) ? ids.map(String) : [], fileBo: fileBo(data) }
}

/** Người duyệt đồng ý / từ chối một hay nhiều yêu cầu. */
export async function duyetYeuCauAnh(
  sb: CoRpc,
  ids: string[],
  dongY: boolean,
  ghiChu?: string | null
): Promise<{ xong: number; boQua: number; fileBo: string[] }> {
  const { data, error } = await sb.rpc("duyet_yeu_cau_anh_diem_ban", {
    p_request_ids: ids,
    p_dong_y: dongY,
    p_ghi_chu: ghiChu?.trim() || null,
  })
  if (error) throw new Error(loiDuyetAnh(error))
  const d = data as { xong?: number; bo_qua?: number } | null
  return { xong: Number(d?.xong ?? 0), boQua: Number(d?.bo_qua ?? 0), fileBo: fileBo(data) }
}

/** Người gửi rút yêu cầu (người duyệt cũng bỏ được). */
export async function huyYeuCauAnh(sb: CoRpc, id: string): Promise<{ fileBo: string[] }> {
  const { data, error } = await sb.rpc("huy_yeu_cau_anh_diem_ban", { p_request_id: id })
  if (error) throw new Error(loiDuyetAnh(error))
  return { fileBo: fileBo(data) }
}

/** Duyệt (khoá) / bỏ duyệt bộ ảnh + vị trí của điểm bán. Bỏ duyệt huỷ các yêu cầu đang chờ. */
export async function duyetDiemBan(sb: CoRpc, customerId: string, duyet: boolean): Promise<{ fileBo: string[] }> {
  const { data, error } = await sb.rpc("duyet_anh_diem_ban", { p_customer_id: customerId, p_duyet: duyet })
  if (error) throw new Error(loiDuyetAnh(error))
  return { fileBo: fileBo(data) }
}
