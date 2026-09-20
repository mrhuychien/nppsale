-- ====================================================================
-- DÒ PHIẾU TRẢ NCC BỊ CỘNG TRẢ THIẾU KHI HUỶ (lỗi sửa ở migration 147)
-- ====================================================================
--
-- MỤC ĐÍCH: trả lời dứt điểm "cơ sở dữ liệu thật có phiếu nào dính
-- không?" — TRƯỚC khi chạy migration 147, và chạy lại sau cũng được.
--
-- CÁCH DÙNG: dán toàn bộ tệp vào Supabase → SQL Editor → Run.
-- CHỈ ĐỌC. Không UPDATE, không INSERT, không DELETE, không đụng tồn kho.
--
-- LỖI LÀ GÌ
--   `cancel_supplier_return` (migration 143) cộng hàng về kho bằng
--   `UPDATE batches … FROM stock_entry_lines …`. Postgres chỉ dùng MỘT
--   dòng nguồn khi câu ấy khớp cùng một dòng đích nhiều lần; phần còn
--   lại bị bỏ IM LẶNG. Nên phiếu trả nào lấy NHIỀU LẦN từ CÙNG một lô
--   (hai dòng cùng mặt hàng trên một phiếu) thì lúc huỷ chỉ được cộng
--   trả về một phần.
--
-- ĐỌC KẾT QUẢ
--   Cột `ket_luan` nói thẳng từng dòng:
--     · "ĐÃ HUỶ — KHO ĐANG HỤT"  → hàng đã mất thật, cần phiếu nhập kho
--       điều chỉnh. Cột `hut_it_nhat` là số đơn vị CƠ SỞ bị hụt.
--     · "CÒN HIỆU LỰC — KHO ĐANG ĐÚNG" → chưa mất gì. Sau khi chạy
--       migration 147 thì huỷ phiếu này cũng sẽ đúng.
--   Không có dòng nào = không phiếu nào dính, không phải làm gì thêm.
--
-- ⚠ `hut_it_nhat` LÀ CẬN DƯỚI, KHÔNG PHẢI SỐ CHÍNH XÁC. Postgres chọn
--   MỘT dòng nguồn BẤT KỲ, không phải dòng lớn nhất, và nó không ghi
--   lại đã chọn dòng nào. `SUM - MAX` là trường hợp may nhất (nó chọn
--   trúng dòng lớn nhất); thực tế có thể hụt NHIỀU HƠN. Không chắc thì
--   nói là không chắc — đừng lấy con số này đi ghi sổ.
--
-- ⚠ CHỈ PHIẾU TRẢ NCC. `cancel_purchase_invoice` (phiếu nhập hàng) đặt
--   `qty_on_hand = 0` — phép GÁN, khớp nhiều dòng nguồn vẫn ra đúng một
--   kết quả — nên không dính lỗi này.
-- ====================================================================

WITH lo_lay_nhieu_lan AS (
  -- Mỗi (phiếu xuất kho, lô) bị ghi nhiều hơn một dòng lấy hàng.
  SELECT
    sel.entry_id,
    sel.batch_id,
    COUNT(*)                                                     AS so_dong,
    SUM(sel.qty_in_base_uom)                                     AS da_lay,
    SUM(sel.qty_in_base_uom) - MAX(sel.qty_in_base_uom)          AS hut_it_nhat
  FROM stock_entry_lines sel
  WHERE sel.batch_id IS NOT NULL
  GROUP BY sel.entry_id, sel.batch_id
  HAVING COUNT(*) > 1
)
SELECT
  CASE sr.status
    WHEN 'cancelled' THEN 'ĐÃ HUỶ — KHO ĐANG HỤT'
    ELSE                  'CÒN HIỆU LỰC — KHO ĐANG ĐÚNG'
  END                                              AS ket_luan,
  COALESCE(sr.return_code, '(chưa có mã)')         AS ma_phieu,
  sr.id                                            AS phieu_id,
  sr.return_date                                   AS ngay_tra,
  s.name                                           AS nha_cung_cap,
  COUNT(DISTINCT x.batch_id)                       AS so_lo_dinh,
  SUM(x.da_lay)                                    AS da_lay_tu_cac_lo_do,
  -- Chỉ phiếu ĐÃ HUỶ mới thật sự hụt; phiếu còn hiệu lực thì kho vẫn đúng.
  CASE WHEN sr.status = 'cancelled' THEN SUM(x.hut_it_nhat) ELSE 0 END
                                                   AS hut_it_nhat,
  string_agg(DISTINCT p.name, ' · ' ORDER BY p.name) AS mat_hang
FROM supplier_returns sr
JOIN lo_lay_nhieu_lan x  ON x.entry_id  = sr.stock_entry_id
JOIN batches          b  ON b.id        = x.batch_id
JOIN products         p  ON p.id        = b.product_id
LEFT JOIN suppliers   s  ON s.id        = sr.supplier_id
WHERE sr.stock_entry_id IS NOT NULL
GROUP BY sr.id, sr.return_code, sr.return_date, sr.status, s.name
-- Phiếu đã hụt thật xếp lên đầu, hụt nhiều nhất trước.
ORDER BY (sr.status = 'cancelled') DESC, 8 DESC, sr.return_date DESC;
