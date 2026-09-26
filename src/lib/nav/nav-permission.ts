import {
  canAccessFeature,
  canAccessModule,
  hasFeaturePermission,
  hasPermission,
  overrideFor,
  ACTIONS,
  type Action,
  type Module,
  type Role,
} from "@/lib/permissions"

/**
 * MỘT chỗ duy nhất khai: mỗi đường dẫn trong menu cần quyền gì.
 *
 * VÌ SAO PHẢI GOM LẠI
 *   Trước đây có BA danh sách menu tự khai quyền lấy: ngăn kéo bên trái,
 *   lưới Trang chủ, và thanh dưới màn hình. Ba chỗ đã lệch nhau thật:
 *   ngăn kéo kiểm tới TÍNH NĂNG ("payables", "finance.cash_receipts"),
 *   còn lưới Trang chủ chỉ kiểm tới MÔ-ĐUN ("receivables"). Kết quả là
 *   thu hồi quyền "Công nợ NCC" của một vai trò thì ngăn kéo giấu đi,
 *   nhưng ô trên Trang chủ vẫn còn — người dùng bấm vào rồi mới bị chặn.
 *
 *   Nhìn từ phía người dùng thì đó là hai câu trả lời khác nhau cho cùng
 *   một câu hỏi "tôi có được vào đây không". Gom về một bảng thì không
 *   còn chỗ cho hai câu trả lời.
 */
export interface NavPermission {
  module: Module
  /** Khoá tính năng — kiểm TRƯỚC mô-đun, chi tiết hơn mô-đun. */
  feature?: string
  /**
   * Hành động cần có. Bỏ trống nghĩa là "có bất kỳ quyền nào cũng vào
   * được" — đúng cho trang xem. Trang TẠO MỚI phải ghi rõ `create`.
   */
  action?: Action
  /** Luôn hiện, không phụ thuộc quyền: Trang chủ và Trợ giúp. */
  always?: boolean
}

/**
 * ⚠ Khoá là đường dẫn ĐÍCH DANH, không phải tiền tố. `/orders` và `/sell`
 * cần hai quyền khác nhau (xem đơn và tạo đơn), nên so theo tiền tố là mở
 * nhầm.
 */
export const NAV_PERMISSION: Record<string, NavPermission> = {
  // Luôn hiện — không có gì để giấu.
  "/home": { module: "orders", always: true },
  "/help": { module: "settings", always: true },
  /* Phiếu lương của CHÍNH MÌNH (chủ nhà 26/09/2026) — ai cũng có; hàm `my_payslips` (mig 201)
     chỉ trả dòng của người gọi, nên không cần gác thêm. */
  "/luong-cua-toi": { module: "settings", always: true },

  // Bán hàng
  //
  // `/sell` là luồng BÁN HÀNG trên điện thoại (tìm hàng → giỏ → gửi đơn).
  // Nó tạo đơn nên đòi đúng quyền TẠO, không phải quyền xem.
  "/sell": { module: "orders", feature: "orders", action: "create" },
  "/orders": { module: "orders", feature: "orders" },
  "/customers": { module: "customers", feature: "customers" },
  "/customers/routes": { module: "customers", feature: "customers" },
  "/customers/missing-photos": { module: "customers", feature: "customers" },
  "/sales/visits": { module: "customers", feature: "customers.visits" },
  "/promotions": { module: "promotions", feature: "promotions" },

  // Mua hàng
  // ⚠ LẬP PHIẾU ĐÒI QUYỀN TẠO, không phải quyền xem. NVBH được đọc tồn
  // kho để biết còn hàng không — chừng đó không phải là lý do để họ
  // thấy nút lập phiếu nhập hàng của nhà cung cấp. Với phiếu nhập hàng
  // thì còn nặng hơn: hoàn thành một phiếu là cộng kho VÀ ghi công nợ.
  "/purchasing/receipts": { module: "inventory", feature: "purchasing.invoices", action: "create" },
  /**
   * ⚠ CÁC MÀN `/new` PHẢI KHAI `action: "create"`. Không khai thì đường dẫn
   *   động rơi về phép kiểm MÔ-ĐUN (ai đọc được là vào được), và người
   *   không có quyền tạo gõ xong cả phiếu mới bị từ chối lúc lưu — đã đo
   *   từng màn (đợt QA 22/09/2026). Nút "Tạo" ở danh sách vốn đã ẩn; đây
   *   là cửa vào qua URL.
   */
  /* ⚠ `/purchasing/receipts/new` và `/purchase-returns/new` KHÔNG khai ở
     đây: vai được ghi mua hàng (RLS + cổng vai mig 166: chủ, quản lý, kế
     toán, thủ kho) không khớp ma trận `inventory.create` (chỉ chủ + thủ
     kho). Hai màn ấy tự gác bằng `duocGhiMuaHang`. */
  "/suppliers/new": { module: "inventory", action: "create" },
  "/promotions/new": { module: "promotions", feature: "promotions", action: "create" },
  "/commissions/policies/new": { module: "commissions", feature: "commissions", action: "create" },
  "/payables/new": { module: "receivables", feature: "payables", action: "create" },
  "/invoices/new": { module: "invoices", feature: "invoices", action: "create" },
  "/purchasing/invoices": { module: "inventory", feature: "purchasing.invoices" },
  /**
   * ⚠ CHỈ ĐỌC, NÊN CHỈ CẦN QUYỀN XEM. Màn đề xuất đặt hàng không lập
   *   phiếu, không đụng kho, không đụng công nợ — nó trả lời một câu
   *   hỏi rồi đưa người dùng sang màn lập phiếu, và màn ấy tự đòi
   *   quyền `create` của nó.
   */
  "/purchasing/reorder": { module: "inventory", feature: "purchasing.invoices" },
  "/purchase-returns": { module: "inventory", feature: "purchasing.returns" },
  "/suppliers": { module: "inventory", feature: "suppliers" },
  "/payables": { module: "receivables", feature: "payables" },

  // Kho vận
  "/inventory": { module: "inventory", feature: "inventory" },
  /**
   * ⚠ DANH SÁCH PHIẾU CHỈ CẦN QUYỀN XEM. Mục menu "Phiếu kho" trỏ vào
   *   đây; nút "Tạo phiếu" bên trong mới đòi quyền tạo, và nó tự ẩn
   *   theo `hasPermission(role, "inventory", "create")`.
   */
  "/inventory/entries": { module: "inventory", feature: "inventory" },
  /* Soạn hàng — gộp hóa đơn thành đơn tổng, chỉ đọc (chủ nhà 25/09/2026). */
  "/inventory/soan-hang": { module: "inventory", feature: "inventory" },
  // ⚠ PHIẾU NHẬP KHO NẰM Ở NHÓM KHO VẬN TỪ 20/09/2026 (chủ nhà chốt).
  //   Nó không còn là đường nhập hàng từ NCC — đường đó là
  //   `/purchasing/receipts`. Quyền giữ nguyên: nó vẫn cộng kho thật.
  //   Từ 20/09/2026 nó KHÔNG còn là mục menu, chỉ còn là đích của nút
  //   "Tạo phiếu"; khai ở đây để `useRoleGuard` vẫn canh đúng cửa vào.
  "/inventory/stock-in": { module: "inventory", feature: "inventory", action: "create" },
  // Phiếu xuất kho TRỪ kho thật — cùng một mức quyền với phiếu nhập.
  "/inventory/stock-issue": { module: "inventory", feature: "inventory", action: "create" },
  /**
   * ⚠ KIỂM KÊ CŨNG ĐỔI TỒN KHO THẬT — cùng mức quyền với phiếu nhập/xuất,
   *   và trước 22/09/2026 nó bị QUÊN KHAI ở đây.
   *
   *   Không khai thì `useRoleGuard` rơi về phép kiểm mô-đun, mà mọi vai
   *   (kể cả NVBH, kế toán) đều có `inventory.read`. Đã đo bằng
   *   `duocVaoTrang`: cả năm vai đều VÀO được. Người ta đếm xong cả kho
   *   rồi bấm lưu, và chính sách `stock_entries` (chỉ owner + warehouse)
   *   mới từ chối — bấy giờ công đếm đã mất.
   *
   * ⚠ HAI MÀN ANH EM `/inventory/stocktake` VÀ `/inventory/stocktake-check`
   *   KHÔNG KHAI Ở ĐÂY: chúng đã bị CHẶN HẲN qua `LEGACY_V2_HREFS`.
   */
  "/inventory/stocktake-adjust": { module: "inventory", feature: "inventory", action: "create" },
  "/products": { module: "products", feature: "products" },
  "/deliveries": { module: "deliveries", feature: "deliveries" },
  "/returns": { module: "returns", feature: "returns" },

  // Kế toán
  "/receivables": { module: "receivables", feature: "receivables" },
  /**
   * ⚠ THU TIỀN LÀ PHÉP GHI (`create_cash_receipt` đòi `receivables.create`).
   *   Chỉ khai mô-đun thì quản lý — vốn chỉ được ĐỌC công nợ — vẫn thấy
   *   mục "Thu tiền", chọn khoản nợ, gõ số tiền, bấm Xác nhận rồi mới gặp
   *   "FORBIDDEN: bạn không có quyền lập phiếu thu" (đã đo).
   */
  "/receivables/collect": { module: "receivables", feature: "receivables", action: "create" },
  "/receivables/by-customer": { module: "receivables", feature: "receivables.by_customer" },
  "/receivables/by-rep": { module: "receivables", feature: "receivables.by_rep" },
  "/finance/opening-balances": { module: "receivables", feature: "finance.opening_balances" },
  "/finance/cash-receipts": { module: "receivables", feature: "finance.cash_receipts" },
  "/finance/expenses": { module: "settings", feature: "finance.expenses" },
  "/invoices": { module: "invoices", feature: "invoices" },
  // Hóa đơn BÁN đi cùng quyền của đơn hàng, không đi cùng quyền hoá đơn
  // điện tử: người xuất hàng phải xem được thứ mình vừa xuất, còn kế toán
  // HĐĐT thì chưa chắc.
  "/sales-invoices": { module: "orders", feature: "orders" },
  "/settings/einvoice": { module: "settings", feature: "einvoice.config" },

  // Nhân sự
  "/hr": { module: "settings", feature: "hr" },
  "/hr/attendance": { module: "settings", feature: "hr" },
  "/hr/bonus-config": { module: "settings", feature: "hr" },
  "/hr/salary-config": { module: "settings", feature: "hr" },
  "/hr/payroll/runs": { module: "settings", feature: "hr" },
  "/commissions": { module: "commissions", feature: "commissions" },
  "/settings/users": { module: "settings", feature: "settings.users" },
  "/settings/users/new": { module: "settings", feature: "settings.users" },
  "/settings/permissions": { module: "settings", feature: "settings.permissions" },

  // Phân tích
  "/analytics/business/overview": { module: "reports", feature: "analytics.business" },
  "/analytics/products/overview": { module: "reports", feature: "analytics.products" },
  "/analytics/customers/overview": { module: "reports", feature: "analytics.customers" },
  "/analytics/performance/receivables": { module: "reports", feature: "analytics.performance" },

  // Báo cáo tổng hợp — 6 màn mới, chạy song song báo cáo cũ (chủ nhà 26/09/2026).
  "/bao-cao": { module: "reports", feature: "reports.dashboard" },
  "/bao-cao/ban-hang": { module: "reports", feature: "reports.sales" },
  "/bao-cao/cuoi-ngay": { module: "reports", feature: "reports.end_of_day" },
  "/bao-cao/kho": { module: "reports", feature: "reports.inventory" },
  "/bao-cao/cong-no": { module: "receivables", feature: "receivables" },
  "/bao-cao/tai-chinh": { module: "reports", feature: "reports.finance" },

  // Báo cáo
  /* ⚠ Trang gộp /reports có tab Kho / Tài chính / Nhân sự — số liệu TOÀN NPP như Tổng quan, nên
     đi cùng khoá `reports.dashboard`. NVBH (chủ nhà 26/09/2026) vào thẳng /reports/sales. */
  "/reports": { module: "reports", feature: "reports.dashboard" },
  "/dashboard": { module: "reports", feature: "reports.dashboard" },
  "/reports/end-of-day": { module: "reports", feature: "reports.end_of_day" },
  "/reports/sales": { module: "reports", feature: "reports.sales" },
  "/reports/orders": { module: "reports", feature: "reports.orders" },
  "/reports/products": { module: "reports", feature: "reports.products" },
  "/reports/customers": { module: "reports", feature: "reports.customers" },
  "/reports/suppliers": { module: "reports", feature: "reports.suppliers" },
  "/reports/employees": { module: "reports", feature: "reports.employees" },
  "/reports/channels": { module: "reports", feature: "reports.channels" },
  "/reports/finance": { module: "reports", feature: "reports.finance" },

  // Cài đặt
  "/settings": { module: "settings", feature: "settings" },
  "/setup": { module: "settings", feature: "settings.org" },
  "/settings/org": { module: "settings", feature: "settings.org" },
  "/settings/approval-rules": { module: "settings", feature: "settings.approval_rules" },

}

/**
 * CỬA VÀO TRANG KHÔNG PHẢI MỤC MENU — chỉ `useRoleGuard` (`duocVaoTrang`) đọc bảng này.
 * `NAV_PERMISSION` giữ đúng các mục menu / nút (chốt "không khai quyền thừa").
 *
 * ⚠ RÀ 25/09/2026 — chủ nhà: "Rà soát lại bảng phân quyền, bổ sung các phần thiếu". Các
   *   trang dưới đây trước đó KHÔNG khai → `useRoleGuard` rơi về phép kiểm mô-đun: NVBH có
 *   `reports.read` là vào được Lãi lỗ, Giá vốn – lợi nhuận, Bảng cân đối…; có
 *   `inventory.read` là vào được danh sách lô kèm giá vốn.
 */
export const CUA_VAO: Record<string, NavPermission> = {
  "/notifications": { module: "orders", always: true },
  "/sell/cart": { module: "orders", feature: "orders", action: "create" },
  "/sell/customer": { module: "orders", feature: "orders", action: "create" },
  "/sell/done": { module: "orders", feature: "orders", action: "create" },
  "/sell/drafts": { module: "orders", feature: "orders", action: "create" },
  "/sell/returns": { module: "orders", feature: "orders", action: "create" },
  "/sell/scan": { module: "orders", feature: "orders", action: "create" },
  "/sell/terms": { module: "orders", feature: "orders", action: "create" },
  "/customers/new": { module: "customers", feature: "customers", action: "create" },
  "/returns/new": { module: "returns", feature: "returns", action: "create" },
  "/sales/pjp": { module: "customers", feature: "customers.visits" },
  "/commissions/policies": { module: "commissions", feature: "commissions" },
  "/finance/cash-receipts/new": { module: "receivables", feature: "finance.cash_receipts", action: "create" },
  "/receivables/aging": { module: "receivables", feature: "receivables" },
  "/payables/by-supplier": { module: "receivables", feature: "payables" },
  "/purchasing": { module: "inventory", feature: "purchasing.invoices" },
  "/invoices/reconcile": { module: "invoices", feature: "invoices", action: "update" },
  "/warehouse": { module: "inventory", feature: "inventory" },
  "/inventory/batches": { module: "inventory", feature: "inventory.cost" },
  "/inventory/batches/new": { module: "inventory", feature: "inventory", action: "create" },
  "/inventory/adjustments": { module: "inventory", feature: "inventory", action: "create" },
  "/inventory/audit": { module: "inventory", feature: "inventory.cost" },
  "/hr/overview": { module: "settings", feature: "hr" },
  "/hr/payroll": { module: "settings", feature: "hr" },
  "/analytics": { module: "reports", feature: "analytics.business" },
  "/analytics/business/cost-profit": { module: "reports", feature: "analytics.business" },
  "/analytics/customers/categories": { module: "reports", feature: "analytics.customers" },
  "/analytics/products/categories": { module: "reports", feature: "analytics.products" },
  "/analytics/products/stock": { module: "reports", feature: "analytics.products" },
  "/reports/inventory": { module: "reports", feature: "reports.inventory" },
  "/reports/finance/pnl": { module: "reports", feature: "reports.finance" },
  "/reports/finance/cash-flow": { module: "reports", feature: "reports.finance" },
  "/reports/finance/balance-sheet": { module: "reports", feature: "reports.finance" },
}

/**
 * MÀN CON ĐỘNG (`/suppliers/<id>`, `/inventory/batches/<id>`…) kiểm như MỤC CHA.
 *
 * ⚠ Trước 25/09/2026 đường dẫn động rơi về phép kiểm mô-đun: NVBH bị giấu "Nhà cung cấp"
 *   nhưng mở `/suppliers/<id>` vẫn vào (mô-đun `inventory` mở để xem tồn); thẻ kho /
 *   chi tiết lô hiện giá vốn. Tiền tố dài nhất thắng; có dấu `/` cuối để không dính tên lạ.
 */
export const NAV_TIEN_TO: ReadonlyArray<readonly [string, string]> = [
  ["/inventory/batches/", "/inventory/batches"],
  ["/inventory/stock-card/", "/inventory/batches"],
  ["/suppliers/", "/suppliers"],
  ["/purchase-returns/", "/purchase-returns"],
  ["/purchasing/invoices/", "/purchasing/invoices"],
  ["/payables/", "/payables"],
  ["/finance/expenses/", "/finance/expenses"],
  ["/receivables/by-rep/", "/receivables/by-rep"],
  ["/hr/", "/hr"],
  ["/settings/users/", "/settings/users"],
  ["/reports/finance/", "/reports/finance"],
  ["/analytics/business/", "/analytics/business/overview"],
  ["/analytics/products/", "/analytics/products/overview"],
  ["/analytics/customers/", "/analytics/customers/overview"],
  ["/analytics/performance/", "/analytics/performance/receivables"],
]

/** Mục cha của một đường dẫn động (theo `NAV_TIEN_TO`), hoặc null. */
export function mucChaCua(pathname: string): string | null {
  let best: readonly [string, string] | null = null
  for (const x of NAV_TIEN_TO) {
    if (pathname.startsWith(x[0]) && (!best || x[0].length > best[0].length)) best = x
  }
  return best ? best[1] : null
}

/**
 * Có được thấy mục menu trỏ tới `href` không.
 *
 * ⚠ HAI CỬA ĐÓNG SẴN, cố ý:
 *
 *   1. Chưa biết vai trò (đang tải hồ sơ, hoặc tải hỏng) thì trả `false`.
 *      Bản cũ của lưới Trang chủ làm ngược lại — `if (!role) return TILES`
 *      — nên trong lúc chờ, MỌI người đều thấy MỌI thứ, kể cả Phân quyền
 *      và Nhân sự. Đoán rộng khi chưa biết là cách nhanh nhất để lộ một
 *      màn hình không nên lộ.
 *
 *   2. Đường dẫn chưa khai trong bảng cũng trả `false`. Thêm mục menu mà
 *      quên khai quyền thì mục đó BIẾN MẤT chứ không mở toang — và phép
 *      kiểm bắt được ngay, vì nó đối chiếu từng đường dẫn của cả ba menu
 *      với bảng này.
 */
/**
 * Màn của LUỒNG CŨ — soạn hàng, hàng chờ, và giao hàng qua tài xế.
 *
 * ⚠ TỪ 22/09/2026: CHẶN HẲN, KHÔNG CHỈ ẨN. Chủ nhà chốt sau khi rà soát
 * toàn bộ workflow. Trước đó ba màn này chỉ ẩn khỏi menu còn gõ thẳng
 * đường dẫn vẫn vào được, với lý do "dữ liệu là chứng từ, thôi dùng chứ
 * không vứt".
 *
 * ⚠ VÌ SAO ĐỔI: lý do ấy đứng được khi màn chỉ để XEM. Nhưng đã đo trên
 * Postgres 16 và `/inventory/stock-out` KHÔNG chỉ xem — nó ghi, và ghi
 * NỬA CHỪNG. Nó chèn `stock_entries` rồi `swap_stock_movements` xong mới
 * `UPDATE sales_orders SET status = 'picking'`, mà workflow v2 không có
 * trạng thái ấy:
 *
 *     >>> đổi sang picking BỊ CHẶN: Không thể chuyển đơn từ submitted
 *         sang picking
 *
 * Lệnh cuối ném, hai lệnh đầu đã ghi và KHÔNG nằm chung giao dịch — mỗi
 * lần ai đó gõ vào đây rồi bấm là sổ kho thêm một phiếu mồ côi. Một màn
 * chỉ có thể làm hỏng chứ không làm xong thì giữ cửa mở cho nó không còn
 * là giữ lịch sử, mà là giữ một cái bẫy.
 *
 * ⚠ CÁI MẤT, NÓI RÕ RA: từ nay không còn mở lại được phiếu soạn hàng,
 * chuyến giao, biên bản bàn giao bằng đường dẫn. Dữ liệu vẫn nguyên
 * trong cơ sở dữ liệu — cần tra thì tra bằng SQL, hoặc bỏ tên màn ấy
 * khỏi danh sách dưới đây là cửa mở lại ngay.
 *
 * ⚠ ĐÂY LÀ CHẶN Ở LỚP GIAO DIỆN. Chốt chặn thật của dữ liệu vẫn là RLS
 * và các trigger dưới database; danh sách này chỉ giữ người dùng khỏi đi
 * nhầm vào một màn đã hỏng.
 *
 * ⚠ VÌ SAO LÀ MỘT DANH SÁCH RIÊNG chứ không gài bằng quyền: `owner` được
 * `canAccessFeature` trả true VÔ ĐIỀU KIỆN, mà chủ nhà đúng là người dùng
 * chính của những màn này. Gài bằng quyền là không giấu được khỏi đúng
 * người cần giấu.
 *
 * ⚠ HỆ QUẢ CẦN BIẾT: vai trò `driver` chỉ có hai màn, mà `/deliveries` là
 * một trong hai. Ẩn nó đi là tài xế đăng nhập vào không còn việc gì —
 * đúng ý workflow v2 (không còn bước giao qua tài xế), nhưng nếu cần bật
 * lại thì bỏ đúng một dòng dưới đây (mục D12 trong sổ tiến độ).
 */
export const LEGACY_V2_HREFS: ReadonlySet<string> = new Set([
  "/deliveries",
  "/inventory/stock-out",
  "/inventory/pending",
  /*
   * ⚠ HAI MÀN KHO ĐỜI ĐẦU — chặn 22/09/2026, chủ nhà chốt. Không nút nào
   *   dẫn tới, nhưng gõ đường dẫn vẫn vào được, và cả hai ghi phiếu
   *   `posted` mà KHÔNG động vào tồn lô:
   *     /inventory/stocktake       — "xuất X" ghi −X vào thẻ kho, lô không
   *                                  trừ; "nhập" không mã lô thì tồn không cộng.
   *     /inventory/stocktake-check — lưu chênh lệch kiểm kê thẳng `posted`,
   *                                  dòng không gắn lô, không qua duyệt
   *                                  `post_stock_adjustment`.
   *   Thẻ kho và tồn thật lệch nhau mà không ai thấy. Màn thay thế:
   *   stock-in / stock-issue / stocktake-adjust (đi qua RPC).
   *   So khớp có dấu `/` nên `/inventory/stocktake-adjust` KHÔNG bị dính.
   */
  "/inventory/stocktake",
  "/inventory/stocktake-check",
])

/**
 * Đường dẫn này có thuộc một màn của luồng cũ không — KỂ CẢ MÀN CON.
 *
 * ⚠ SO KHỚP THEO TIỀN TỐ, KHÔNG SO BẰNG. Chặn đúng ba đường gốc là bỏ
 *   ngỏ `/deliveries/<id>`, `/deliveries/<id>/settle`,
 *   `/inventory/stock-out/collect/<id>` — mà màn con mới là chỗ có nút
 *   bấm. Và những đường ấy KHÔNG khai trong `NAV_PERMISSION` nên
 *   `useRoleGuard` rơi về phép kiểm mô-đun, tức vào được sẵn.
 *
 * ⚠ PHẢI CÓ DẤU `/` SAU GỐC. `startsWith("/deliveries")` trần còn khớp
 *   cả một đường dẫn tương lai tên `/deliveries-v2`.
 */
export function laManLuongCu(href: string): boolean {
  for (const goc of Array.from(LEGACY_V2_HREFS)) {
    if (href === goc || href.startsWith(goc + "/")) return true
  }
  return false
}

/**
 * Người vai `role` có được VÀO trang `pathname` không — luật đầy đủ của
 * cửa vào, gồm cả đường dẫn ĐỘNG chưa khai trong `NAV_PERMISSION`.
 *
 * ⚠ TÁCH RA KHỎI `useRoleGuard` ĐỂ CHỐT GỌI ĐƯỢC. Trước đây luật này
 *   nằm trong thân hook, nên chốt duy nhất có thể làm là soi xem tệp có
 *   chứa chữ `laManLuongCu(` hay không. Đã đột biến thử: đổi thành
 *   `false && laManLuongCu(...)` — chữ còn nguyên, luật chết, chốt vẫn
 *   XANH. Một chốt soi chữ là một chốt nói dối; luật nào cần canh thì
 *   phải gọi được.
 *
 * ⚠ BA NHÁNH, ĐÚNG THỨ TỰ NÀY:
 *   1. Luồng cũ — chặn, kể cả chủ nhà, kể cả `always`.
 *   2. Đường dẫn CÓ KHAI — theo `canEnterHref` (có xét quyền riêng).
 *   3. Còn lại (đường dẫn động) — theo mô-đun, như cũ.
 */
export function duocVaoTrang(
  role: Role | null | undefined,
  pathname: string | null | undefined,
  module: Module
): boolean {
  if (!role) return false
  const p = pathname ?? ""
  if (laManLuongCu(p)) return false
  if (NAV_PERMISSION[p]) return canEnterHref(role, p)
  if (CUA_VAO[p]) return kiemMuc(role, CUA_VAO[p])
  const cha = mucChaCua(p)
  const mucCha = cha ? NAV_PERMISSION[cha] ?? CUA_VAO[cha] : undefined
  if (mucCha) return kiemMuc(role, mucCha)
  return canAccessModule(role, module)
}

export function canSeeHref(role: Role | null | undefined, href: string): boolean {
  /* Luồng cũ nay bị `canEnterHref` chặn thẳng, nên không cần lọc riêng
     ở đây nữa — ẩn khỏi menu là hệ quả của việc không vào được. */
  return canEnterHref(role, href)
}

/**
 * Có được VÀO XEM trang `href` không.
 *
 * `useRoleGuard` gọi hàm NÀY, không gọi `canSeeHref`.
 */
export function canEnterHref(role: Role | null | undefined, href: string): boolean {
  if (!role) return false
  /**
   * ⚠ LUỒNG CŨ CHẶN TRƯỚC MỌI PHÉP KIỂM QUYỀN, kể cả `always`, kể cả
   *   chủ nhà. `canAccessFeature` trả true vô điều kiện cho `owner`, mà
   *   chủ nhà đúng là người hay gõ thẳng đường dẫn nhất — gài bằng
   *   quyền là không chặn được đúng người cần chặn.
   */
  if (laManLuongCu(href)) return false
  const p = NAV_PERMISSION[href]
  if (!p) return false
  return kiemMuc(role, p)
}

/** Luật của MỘT khai quyền (menu hoặc cửa vào). */
function kiemMuc(role: Role, p: NavPermission): boolean {
  if (p.always) return true

  // ⚠ QUYỀN RIÊNG CỦA NGƯỜI DÙNG ĐÈ LÊN QUYỀN VAI TRÒ, và phải xét TRƯỚC.
  // Quản lý thu hồi một mục của đúng một nhân viên thì mục đó phải biến
  // mất khỏi menu của nhân viên đó — trước đây bảng tuỳ chỉnh được ghi
  // xuống nhưng lúc chạy không ai đọc, nên thu hồi xong không đổi gì.
  const keys = p.feature ? [p.feature, p.module] : [p.module]
  const ov = p.action ? overrideFor(keys, p.action) : viewOverride(keys)
  if (ov !== null) return ov

  if (p.action) {
    return p.feature
      ? hasFeaturePermission(role, p.feature, p.module, p.action)
      : hasPermission(role, p.module, p.action)
  }
  return p.feature
    ? canAccessFeature(role, p.feature, p.module)
    : canAccessModule(role, p.module)
}

/**
 * Tuỳ chỉnh riêng nói gì về việc VÀO XEM một trang.
 *
 * ⚠ VÀO XEM ỨNG VỚI HÀNH ĐỘNG `read`, không phải "mọi hành động". Thu hồi
 * riêng quyền `delete` của một người mà giấu luôn cả mục là lấy mất đường
 * XEM — đúng thứ họ vẫn còn quyền làm.
 *
 * Nhưng CẤP riêng một hành động bất kỳ thì cũng có nghĩa là vào được: cấp
 * quyền `create` mà vẫn giấu mục thì không có đường nào bấm tới.
 */
function viewOverride(keys: string[]): boolean | null {
  const r = overrideFor(keys, "read")
  if (r !== null) return r
  for (const a of ACTIONS) {
    if (overrideFor(keys, a) === true) return true
  }
  return null
}

/** Lọc một danh sách mục menu bất kỳ, miễn là mục có `href`. */
export function filterByPermission<T extends { href: string }>(
  role: Role | null | undefined,
  items: T[]
): T[] {
  return items.filter((i) => canSeeHref(role, i.href))
}

/**
 * Lọc menu theo nhóm.
 *
 * ⚠ Nhóm không còn mục nào thì BỎ luôn cả nhóm. Để lại tiêu đề "MUA HÀNG"
 * rồi trống trơn bên dưới thì người dùng tưởng menu hỏng, chứ không hiểu
 * là mình không có quyền.
 */
export function filterNavGroups<T extends { href: string }, G extends { items: T[] }>(
  role: Role | null | undefined,
  groups: G[]
): G[] {
  return groups
    .map((g) => ({ ...g, items: filterByPermission(role, g.items) }))
    .filter((g) => g.items.length > 0)
}
