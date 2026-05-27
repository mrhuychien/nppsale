/**
 * Helper xây URL deep-link tới HĐ trên MISA web (v3).
 *
 * Pattern thực tế (user xác minh ngày 27/05/2026):
 *   https://app3.meinvoice.vn/v3/hoa-don?viewinvoice.id={refId}.companyid={companyId}
 *
 * Lưu ý: subdomain là `app3` (không phải `app`), separator giữa 2 param
 * là `.` chứ không phải `&` — đây là convention nội bộ của MISA.
 */
export function buildMisaInvoiceUrl(refId?: string | null, companyId?: string | number | null): string | null {
  if (!refId || !companyId) return null
  return `https://app3.meinvoice.vn/v3/hoa-don?viewinvoice.id=${encodeURIComponent(refId)}.companyid=${encodeURIComponent(String(companyId))}`
}

/** Fallback page list khi không có refId/companyId (vẫn truy cập được). */
export const MISA_LIST_URL = "https://app3.meinvoice.vn/v3/hoa-don"
