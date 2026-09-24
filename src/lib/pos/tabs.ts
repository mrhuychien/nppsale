/**
 * TAB CHỨNG TỪ — phần quy tắc thuần, tách khỏi React để có chốt chạy thật.
 *
 * ⚠ SPEC CHỐT 21/09/2026 §3. Tab thay cơ chế MỘT GIỎ TOÀN CỤC, và câu
 * chốt quan trọng nhất là: "Xoá màn hỏi Thay giỏ / Giữ giỏ".
 *
 * ⚠ MỞ MỘT CHỨNG TỪ ĐÃ CÓ TAB THÌ NHẢY VỀ TAB ĐÓ, KHÔNG MỞ TAB MỚI.
 * Hai tab cho cùng một tờ chứng từ là hai bản nháp khác nhau của cùng
 * một tờ; người dùng sửa ở tab này, lưu ở tab kia, và phần sửa biến mất
 * mà không có lỗi nào. Khoá so trùng là `docType + docId`.
 *
 * ⚠ CHỨNG TỪ MỚI (`docId === null`) KHÔNG BAO GIỜ TRÙNG NHAU. Hai đơn
 * mới là hai đơn khác nhau cho hai khách khác nhau — gộp chúng lại là
 * mất một đơn.
 */

export type PosDocType = "SO" | "INV" | "RET" | "PUR" | "PRET"

export interface PosTab {
  key: string
  docType: PosDocType
  /** `null` = chứng từ chưa lưu lần nào. */
  docId: string | null
  /** `DH-0154` hoặc `Đơn mới 1`. */
  label: string
  dirty: boolean
  /**
   * Số dòng hàng của chứng từ — bản thiết kế chủ nhà đưa vẽ con số này
   * ngay cạnh nhãn tab.
   *
   * ⚠ NÓ TRẢ LỜI MỘT CÂU HỎI THẬT: mở bốn tab thì tab nào còn rỗng.
   *   Không có nó, người bán phải bấm vào từng tab để biết.
   */
  count: number
}

/** Tối đa 8 tab — spec §3 mục 3. */
export const POS_TAB_MAX = 8

/** Chấm màu đầu tab — spec §3 mục 5. */
export const POS_DOT: Record<PosDocType, string> = {
  SO: "#2563eb",
  INV: "#22c55e",
  RET: "#f59e0b",
  PUR: "#2563eb",
  PRET: "#f59e0b",
}

export const POS_DOC_LABEL: Record<PosDocType, string> = {
  SO: "Đơn đặt hàng",
  INV: "Hóa đơn bán",
  RET: "Phiếu trả hàng",
  PUR: "Phiếu nhập hàng",
  PRET: "Phiếu trả NCC",
}

/** Đường dẫn của một tab — một chỗ duy nhất biết bảng tuyến đường. */
export function posHref(t: Pick<PosTab, "docType" | "docId">): string {
  const goc: Record<PosDocType, string> = {
    SO: "/pos/don-hang",
    INV: "/pos/hoa-don",
    RET: "/pos/tra-hang",
    PUR: "/pos/nhap-hang",
    PRET: "/pos/tra-ncc",
  }
  return `${goc[t.docType]}/${t.docId ?? "moi"}`
}

/**
 * Trang IN của một chứng từ đã lưu — dùng mẫu in của phần đang chạy.
 *
 * ⚠ `null` = CHƯA CÓ MẪU IN cho loại này. Màn POS không có mẫu in
 * riêng (spec §9 tab "In phiếu" để trống), và `window.print()` cả màn
 * POS là in ra một trang toàn nút bấm. Loại nào phần đang chạy đã có
 * trang in thì dẫn tới đó; loại nào chưa có thì nút mờ và nói vì sao.
 */
export function posPrintHref(docType: PosDocType, docId: string): string | null {
  switch (docType) {
    /* Trang in RIÊNG của POS (`app/in/*`, 24/09/2026) — cùng mẫu phiếu với
       phần quản lý, không kèm khung dashboard. */
    case "SO": return `/in/don-hang/${docId}`
    case "INV": return `/in/hoa-don/${docId}`
    /* Mẫu in phiếu trả có từ 24/09/2026 (`ReturnSlip`). */
    case "RET": return `/in/tra-hang/${docId}`
    default: return null
  }
}

/**
 * Đọc ngược một đường dẫn `/pos/...` ra (loại, mã) — phép nghịch đảo
 * của `posHref`.
 *
 * ⚠ VÌ SAO CẦN: bộ tab và URL là HAI nguồn sự thật, và bản đầu chỉ
 * viết theo một chiều (tab → URL). Người dùng dán thẳng
 * `/pos/hoa-don/<id>` từ màn Xem nhanh, hoặc màn lập đơn `replace` URL
 * sang mã thật sau khi lưu — cả hai đều làm URL đi trước mà tab đứng
 * yên: tab vẫn ghi "Đơn mới 1" trong khi màn đang hiện DH-0154, và mở
 * DH-0154 lần nữa là ra tab thứ hai của cùng một tờ.
 *
 * `/pos/don-hang/<id>/sua` cũng về cùng một tab với `/pos/don-hang/<id>`
 * — sửa và xem là hai màn của MỘT chứng từ.
 */
export function parsePosPath(pathname: string): { docType: PosDocType; docId: string | null } | null {
  const m = /^\/pos\/(don-hang|hoa-don|tra-hang|nhap-hang|tra-ncc)\/([^/?#]+)/.exec(pathname)
  if (!m) return null
  const loai: Record<string, PosDocType> = {
    "don-hang": "SO",
    "hoa-don": "INV",
    "tra-hang": "RET",
    "nhap-hang": "PUR",
    "tra-ncc": "PRET",
  }
  return { docType: loai[m[1]], docId: m[2] === "moi" ? null : m[2] }
}

export interface OpenResult {
  tabs: PosTab[]
  /** Tab sẽ được kích hoạt. */
  activeKey: string
  /**
   * Chuyện cần nói với người dùng, hoặc `null`.
   *
   * ⚠ NHẢY VỀ TAB CŨ PHẢI NÓI RA. Người dùng bấm "mở DH-0154" rồi thấy
   *   màn hình đổi nội dung — không có một câu nào thì họ tưởng vừa mở
   *   tab mới và nháp cũ đã mất.
   */
  notice: string | null
  /** `true` = không mở được vì đã chạm trần tab. */
  refused: boolean
}

/**
 * Mở một chứng từ vào bộ tab.
 *
 * ⚠ KHÔNG TỰ ĐÓNG TAB NÀO ĐỂ LẤY CHỖ. Đóng giúp là vứt nháp của người
 * khác; chạm trần thì nói ra và để người dùng chọn đóng cái nào.
 */
export function openTab(
  tabs: readonly PosTab[],
  doc: { docType: PosDocType; docId: string | null; label: string },
  /** Khoá cho tab mới — nơi gọi cấp, để hàm này thuần. */
  newKey: string
): OpenResult {
  if (doc.docId !== null) {
    const cu = tabs.find((t) => t.docType === doc.docType && t.docId === doc.docId)
    if (cu) {
      const viTri = tabs.indexOf(cu) + 1
      return {
        tabs: [...tabs],
        activeKey: cu.key,
        notice: `${cu.label} đang mở ở tab ${viTri} — đã chuyển tới tab đó. Nháp trong tab được giữ nguyên.`,
        refused: false,
      }
    }
  }

  if (tabs.length >= POS_TAB_MAX) {
    return {
      tabs: [...tabs],
      activeKey: tabs[tabs.length - 1]?.key ?? "",
      notice: "Đóng bớt tab để mở thêm",
      refused: true,
    }
  }

  const moi: PosTab = { key: newKey, docType: doc.docType, docId: doc.docId, label: doc.label, dirty: false, count: 0 }
  return { tabs: [...tabs, moi], activeKey: newKey, notice: null, refused: false }
}

/**
 * Đóng một tab, trả về bộ tab mới và tab kế tiếp cần kích hoạt.
 *
 * ⚠ ĐÓNG TAB ĐANG ĐỨNG THÌ NHẢY SANG TAB BÊN TRÁI. Nhảy về đầu danh
 * sách là ném người dùng đi xa chỗ họ đang làm; bên trái là chỗ gần
 * nhất và đoán được.
 */
export function closeTab(
  tabs: readonly PosTab[],
  key: string,
  activeKey: string
): { tabs: PosTab[]; activeKey: string } {
  const i = tabs.findIndex((t) => t.key === key)
  if (i < 0) return { tabs: [...tabs], activeKey }
  const conLai = tabs.filter((t) => t.key !== key)
  if (key !== activeKey) return { tabs: conLai, activeKey }
  const keTiep = conLai[Math.max(0, i - 1)]
  return { tabs: conLai, activeKey: keTiep?.key ?? "" }
}

/**
 * Tên mặc định cho một chứng từ mới: `Đơn mới 1`, `Đơn mới 2`…
 *
 * ⚠ ĐÁNH SỐ THEO SỐ TAB MỚI ĐANG MỞ CÙNG LOẠI, không theo tổng số tab.
 * Ba đơn mới cạnh một hóa đơn thì vẫn là "Đơn mới 1/2/3" — đánh theo
 * tổng thì người dùng thấy "Đơn mới 4" mà chỉ có ba đơn.
 */
export function nextNewLabel(tabs: readonly PosTab[], docType: PosDocType): string {
  const ten: Record<PosDocType, string> = {
    SO: "Đơn mới",
    INV: "Hóa đơn mới",
    RET: "Phiếu trả mới",
    PUR: "Phiếu nhập mới",
    PRET: "Trả NCC mới",
  }
  const n = tabs.filter((t) => t.docType === docType && t.docId === null).length + 1
  return `${ten[docType]} ${n}`
}
