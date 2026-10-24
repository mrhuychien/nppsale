/**
 * Ghép trang mới vào danh sách đang có ("Tải thêm" / "Xem thêm") — không lặp khoá: ai đó vừa ghi xong thì ranh giới
 * trang trên máy chủ đã dịch, dòng cuối trang trước có thể quay lại ở đầu trang sau.
 */
export function ghepTrang<T>(cu: readonly T[], moi: readonly T[], khoa: (x: T) => string = (x) => (x as { id: string }).id): T[] {
  const co = new Set(cu.map(khoa))
  return [...cu, ...moi.filter((x) => !co.has(khoa(x)))]
}
