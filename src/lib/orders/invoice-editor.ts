/**
 * MÀN SOẠN HÓA ĐƠN BÁN — phần tính toán, tách khỏi giao diện.
 *
 * ⚠ VÌ SAO TÁCH RA. Trước đây toàn bộ phép gieo dòng nằm trong
 * `invoice-dialog.tsx`, nên muốn thử phá một phép chia chiết khấu là phải
 * dựng cả một hộp thoại React. Giờ màn soạn là một TRANG (chủ nhà chốt),
 * và trang đó còn thêm được mã hàng ngoài đơn — nhiều phép hơn, càng
 * không nên để chúng lẫn trong JSX.
 *
 * ⚠ MỌI CON SỐ Ở ĐÂY CÒN NẰM TRÊN TRÌNH DUYỆT. Hóa đơn không có trạng
 * thái nháp: một dòng `sales_invoices` là giấy đã in và kho đã trừ. Nên
 * tới khi người dùng bấm nút cuối thì chưa có gì xảy ra ở cơ sở dữ liệu.
 */

import type { InvoiceableLine, InvoiceDraftLine } from "@/lib/orders/post-invoice"
import { conversionFor, unitPriceFor, type PricedProduct } from "@/lib/sell/pricing"
import { viMatchAllWords } from "@/lib/search"
import type { CartLine } from "@/lib/sell/cart"

/** Dòng của hóa đơn ĐANG SỬA, do trang gọi truyền vào. */
export interface ReissueSeedLine {
  orderLineId: string | null
  productId: string
  unitName: string
  quantity: number
  unitPrice: number
  lineDiscount: number
  vatRate: number
  isExchange: boolean
  conversionFactor: number
  productName: string
  sku: string | null
  note: string | null
}

export interface EditorRow extends InvoiceableLine {
  key: string
  qty: number
  price: number
  /**
   * Số lượng mà `lineDiscount` đang tương ứng với.
   *
   * ⚠ KHÔNG PHẢI LÚC NÀO CŨNG LÀ `remainingQty`. Khi lập MỚI, chiết khấu
   * đến từ dòng đơn và ứng với phần còn lại. Khi SỬA, nó đến từ dòng hóa
   * đơn cũ và ứng với đúng số lượng của bản cũ — chia theo `remainingQty`
   * ở ca đó là chia cho một mẫu số lớn hơn, và khoản giảm teo lại sau mỗi
   * lần sửa mà không ai để ý.
   */
  discountBase: number
  /**
   * Dòng do người dùng TỰ THÊM, không có trong đơn gốc.
   *
   * ⚠ KHÔNG SUY RA TỪ `orderLineId === null`. Hàng đem đổi của phiếu trả
   * cũng không có dòng đơn, nhưng nó KHÔNG phải người dùng thêm tay —
   * gộp hai thứ lại là cho phép xoá mất hàng đổi bằng nút "bỏ dòng".
   */
  addedByHand: boolean
  /**
   * Tồn kho đã tra được chưa.
   *
   * ⚠ CHƯA TRA XONG KHÁC VỚI TỒN BẰNG 0. Mã vừa thêm tay chưa kịp hỏi kho
   * mà đã tô vàng "vượt tồn" thì cảnh báo đó kêu oan, và người dùng học
   * được cách bỏ qua màu vàng — đúng lúc nó kêu thật thì không ai nhìn.
   */
  stockKnown: boolean
}

/**
 * Lần xuất MỚI: mặc định xuất hết phần còn lại.
 *
 * ⚠ Việc thường ngày là xuất đủ; bắt gõ tay từng dòng là biến việc
 * thường ngày thành cực hình.
 */
export function seedForNew(lines: InvoiceableLine[]): EditorRow[] {
  return lines.map((l, i) => ({
    ...l,
    key: l.orderLineId ?? l.returnLineId ?? `x${i}`,
    qty: l.remainingQty,
    price: l.unitPrice,
    discountBase: l.remainingQty,
    addedByHand: false,
    stockKnown: true,
  }))
}

/**
 * SỬA một hóa đơn: mở ra với đúng các dòng của bản cũ.
 *
 * ⚠ KHÔNG DÙNG `remainingQty`. Bản cũ chưa bị huỷ nên số lượng của nó
 * vẫn đang nằm trong `invoiced_qty`, tức `remainingQty` đã trừ đi rồi —
 * lấy thẳng là mở ra một hóa đơn trống trơn và người dùng tưởng mất hàng.
 *
 * ⚠ DÒNG CỦA BẢN CŨ KHÔNG CÓ TRONG ĐƠN VẪN PHẢI GIỮ (hàng đem đổi, hoặc
 * mã nhà phân phối thêm tay). Bỏ chúng là lặng lẽ xoá hàng khỏi hóa đơn
 * khi người ta chỉ định sửa một con số.
 */
export function seedForReissue(
  lines: InvoiceableLine[],
  seed: ReissueSeedLine[]
): EditorRow[] {
  const byOrderLine = new Map<string, InvoiceableLine>()
  for (const l of lines) if (l.orderLineId) byOrderLine.set(l.orderLineId, l)

  return seed.map((sd, i) => {
    const info = sd.orderLineId ? byOrderLine.get(sd.orderLineId) : undefined
    return {
      orderLineId: sd.orderLineId,
      returnLineId: null,
      productId: sd.productId,
      productName: info?.productName ?? sd.productName,
      sku: info?.sku ?? sd.sku,
      unitName: sd.unitName,
      conversionFactor: sd.conversionFactor,
      orderedQty: info?.orderedQty ?? sd.quantity,
      invoicedQty: info?.invoicedQty ?? 0,
      // Mốc để so "xuất vượt": phần chưa xuất CỘNG phần bản cũ đang giữ,
      // vì bản cũ sắp được hoàn về.
      remainingQty: (info?.remainingQty ?? 0) + sd.quantity,
      unitPrice: sd.unitPrice,
      listPrice: info?.listPrice ?? 0,
      lineDiscount: sd.lineDiscount,
      vatRate: sd.vatRate,
      availableBase: info?.availableBase ?? 0,
      isExchange: sd.isExchange,
      note: sd.note,
      key: sd.orderLineId ?? `seed${i}`,
      qty: sd.quantity,
      price: sd.unitPrice,
      discountBase: sd.quantity,
      // Dòng của bản cũ không thuộc dòng đơn nào VÀ không phải hàng đổi
      // thì chính là mã đã thêm tay ở lần lập trước — cho xoá tiếp.
      addedByHand: !sd.orderLineId && !sd.isExchange,
      stockKnown: !!info,
    }
  })
}

/**
 * Một mã hàng người dùng thêm tay, không có trong đơn gốc.
 *
 * ⚠ GIÁ LẤY QUA `unitPriceFor`, KHÔNG LẤY `sell_price`. `sell_price` là
 * giá theo ĐƠN VỊ CƠ SỞ; khách bán theo thùng, hoặc khách có bảng giá
 * riêng, thì con số phải khác. Lấy thẳng là bán sai giá cho đúng những
 * khách được ưu đãi nhất.
 *
 * ⚠ `vat_rate` CỦA SẢN PHẨM LÀ TỈ LỆ (0,1), không phải phần trăm (10) —
 * đúng như `sales_invoice_lines.vat_rate`. Nhân 100 ở đây là thu thuế
 * gấp mười.
 */
export function makeAddedRow(
  product: PricedProduct,
  unitName: string,
  priceGroupId: string | null | undefined,
  seq: number
): EditorRow {
  const price = unitPriceFor(product, unitName, priceGroupId)
  return {
    orderLineId: null,
    returnLineId: null,
    productId: product.id,
    productName: product.name,
    sku: product.sku ?? null,
    unitName,
    conversionFactor: conversionFor(product, unitName),
    orderedQty: 0,
    invoicedQty: 0,
    // ⚠ 0 CÓ CHỦ Ý. Mã này không nằm trong đơn nên không có "phần còn
    //   lại" nào cả; cảnh báo "xuất vượt đơn" phải bỏ qua dòng này, nếu
    //   không thì mọi mã thêm tay đều tô vàng.
    remainingQty: 0,
    unitPrice: price,
    listPrice: price,
    lineDiscount: 0,
    vatRate: Number(product.vat_rate ?? 0),
    availableBase: 0,
    isExchange: false,
    note: null,
    key: `add${seq}`,
    qty: 1,
    price,
    discountBase: 0,
    addedByHand: true,
    stockKnown: false,
  }
}

/** Gắn tồn kho vừa tra được vào một dòng thêm tay. */
export function withStock(rows: EditorRow[], key: string, availableBase: number): EditorRow[] {
  return rows.map((r) =>
    r.key === key ? { ...r, availableBase, stockKnown: true } : r
  )
}

/**
 * Đổi các dòng trên màn thành tải trọng gửi cho RPC.
 *
 * ⚠ CHIẾT KHẤU CHỈ ĐỂ GHI NHỚ, và nó là số tiền của CẢ DÒNG — giữ nguyên
 * số của đơn thì dòng xuất một nửa mang khoản giảm của cả đơn. Tính lại
 * theo tỉ lệ phần đang xuất.
 */
export function toDraft(rows: EditorRow[]): InvoiceDraftLine[] {
  return rows.map((r) => ({
    orderLineId: r.orderLineId,
    productId: r.productId,
    unitName: r.unitName,
    conversionFactor: r.conversionFactor,
    quantity: r.qty,
    unitPrice: r.price,
    lineDiscount:
      r.discountBase > 0 && r.lineDiscount > 0
        ? Math.round((r.lineDiscount * r.qty) / r.discountBase)
        : 0,
    vatRate: r.vatRate,
    isExchange: r.isExchange,
    note: r.note,
  }))
}

/**
 * Những dòng xuất NHIỀU HƠN phần còn lại của đơn.
 *
 * ⚠ CHỈ XÉT DÒNG CÓ TRONG ĐƠN. Mã thêm tay không có "phần còn lại", và
 * hàng đem đổi cũng không — kể chúng vào đây là mọi hóa đơn có mã thêm
 * tay đều hiện cảnh báo, tức cảnh báo mất hết ý nghĩa.
 */
export function rowsOverOrdered(rows: EditorRow[]): EditorRow[] {
  return rows.filter((r) => !!r.orderLineId && r.qty > r.remainingQty)
}

/**
 * Lọc sản phẩm theo từ khoá, cho ô thêm mã hàng.
 *
 * ⚠ BỎ DẤU TRƯỚC KHI SO. Người bán gõ "banh" để tìm "Bánh" — bắt gõ đủ
 * dấu trên điện thoại giữa lúc giao hàng là bắt họ bỏ cuộc.
 *
 * ⚠ LOẠI MÃ ĐÃ CÓ TRÊN MÀN. Thêm lần hai thành hai dòng cùng một mã, và
 * `invoiced_qty` của đơn cộng gộp cả hai — người tra sổ không hiểu vì sao
 * một mặt hàng xuất hiện hai lần trong cùng một tờ hóa đơn.
 *
 * ⚠ Ô TRỐNG THÌ XỔ `limit` MÃ ĐẦU, KHÔNG TRẢ VỀ RỖNG. Đây là một luật
 * BỊ ĐẢO NGƯỢC, và nói ra cho rõ: bản cũ cố ý không gợi ý gì khi chưa
 * gõ. Chủ nhà chốt 20/09/2026 "bấm vào là phải xổ list rồi (như khi
 * chọn NCC ấy)", và bốn màn phiếu đã đổi theo — màn hóa đơn này bị bỏ
 * sót vì nó tự vẽ ô tìm riêng thay vì dùng `ProductPicker`. Trần
 * `limit` giữ nguyên tinh thần cũ: đủ để thấy mình đang ở đâu, không
 * đủ để thành một danh sách phải cuộn.
 *
 * ⚠ KHỚP TỪNG TỪ RỜI, KHÔNG KHỚP CẢ CHUỖI. Bản cũ dùng `includes` trên
 * nguyên từ khoá, nên gõ "banh dau" không ra "Bánh đậu xanh" — mà gõ
 * rời rạc, sai thứ tự là cách người bán thật sự gõ. `viMatchAllWords`
 * là phép mà mọi ô tìm hàng khác trong kho mã này đã dùng, và nó soi
 * cả mã vạch.
 */
export function searchAddable(
  products: PricedProduct[],
  term: string,
  alreadyOnScreen: ReadonlySet<string>,
  limit = 20
): PricedProduct[] {
  const out: PricedProduct[] = []
  for (const p of products) {
    if (alreadyOnScreen.has(p.id)) continue
    if (!viMatchAllWords(term, p.name, p.sku, p.barcode)) continue
    out.push(p)
    if (out.length >= limit) break
  }
  return out
}

/**
 * ĐỔI MỘT DÒNG HÓA ĐƠN THÀNH HÌNH DẠNG CỦA GIỎ HÀNG — và ngược lại.
 *
 * ⚠ VÌ SAO CẦN. Chủ nhà chốt 21/09/2026: màn Xuất hàng và Sửa hóa đơn
 * phải "giống hệt màn Sửa đơn hàng". Màn ấy dùng `LineEditSheet`, mà
 * sheet đó nhận `CartLine`. Hai hình dạng gần nhau nhưng KHÔNG bằng
 * nhau, và mấy chỗ lệch đều là chỗ mất tiền nếu ánh xạ ẩu.
 *
 * ⚠ `listPrice` CỦA HAI BÊN KHÁC NGHĨA. Ở giỏ hàng nó là giá bảng THEO
 * ĐƠN VỊ ĐANG BÁN. Ở dòng hóa đơn, `listPrice` là giá bảng theo ĐƠN VỊ
 * CƠ SỞ (xem `InvoiceableLine`) — chỉ để so, không để tính tiền. Bê
 * thẳng sang là sheet báo "giá sửa" cho mọi dòng bán theo thùng.
 * Dùng `unitPrice` (giá ĐANG áp dụng của dòng đơn) làm mốc so.
 *
 * ⚠ CHIẾT KHẤU KHÔNG CÓ CHỖ TRONG `CartLine`, và KHÔNG ĐƯỢC BỎ. Nó nằm
 * lại ở `EditorRow` và chỉ đi qua `toDraft`; sheet không đụng tới. Ánh
 * xạ hai chiều bằng cách GHI ĐÈ trường thay vì dựng một dòng mới, nên
 * `lineDiscount` / `discountBase` / `orderLineId` / `isExchange` không
 * thể rơi mất.
 */
export function rowToCartLine(r: EditorRow): CartLine {
  return {
    productId: r.productId,
    unit: r.unitName,
    qty: r.qty,
    price: r.price,
    /* Mốc so "giá đã sửa" là giá TRÊN ĐƠN, không phải `products.sell_price`. */
    listPrice: r.unitPrice,
    note: r.note ?? "",
    conversion: r.conversionFactor,
    vatRate: r.vatRate,
  }
}

/**
 * Nhận lại phần sheet vừa sửa.
 *
 * ⚠ CHỈ NHẬN NHỮNG TRƯỜNG SHEET THẬT SỰ SỬA. Nhận cả `listPrice` là
 * ghi đè mốc so giá của dòng đơn bằng giá bảng hiện tại — và từ đó
 * cảnh báo "giá lệch so với đơn" thôi kêu, đúng lúc nó cần kêu nhất.
 *
 * ⚠ ĐỔI ĐƠN VỊ THÌ PHẢI ĐỔI CẢ HỆ SỐ QUY ĐỔI. Giữ hệ số cũ là trừ kho
 * sai đúng bằng tỉ lệ quy đổi — 1 thùng trừ 1 hộp.
 */
export function patchRowFromCart(r: EditorRow, patch: Partial<CartLine>): EditorRow {
  const next: EditorRow = { ...r }
  if (patch.qty !== undefined) next.qty = Math.max(0, patch.qty)
  if (patch.price !== undefined) next.price = Math.max(0, patch.price)
  if (patch.vatRate !== undefined) next.vatRate = patch.vatRate
  if (patch.note !== undefined) next.note = patch.note || null
  if (patch.unit !== undefined) {
    next.unitName = patch.unit
    if (patch.conversion !== undefined) next.conversionFactor = patch.conversion
  }
  return next
}
