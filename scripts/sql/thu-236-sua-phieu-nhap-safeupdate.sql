-- ====================================================================
-- THỬ MIG 236 — sửa phiếu nhập đã hoàn thành chạy được DƯỚI safeupdate, như lượt gọi API thật trên Supabase.
--   Chủ nhà 08/10/2026: "Sửa phiếu nhập NCC báo lỗi này? UPDATE requires a WHERE clause".
--   Bộ thử 235 chạy bằng psql (vai postgres) KHÔNG nạp safeupdate nên không thấy lỗi. Tệp này nạp safeupdate cho
--   phiên, chứng minh nó đang chặn, rồi chạy lại nguyên bộ 235: 13/13 ĐẠT là sửa được thật qua API.
--
--   Cần safeupdate.so trong Postgres thử (một tệp C nhỏ, cần gói postgresql-server-dev-<bản>):
--     git clone https://github.com/eradman/pg-safeupdate && cd pg-safeupdate && make && sudo make install
--   Chạy (DB thử ở máy, KHÔNG chạy trên Supabase):
--     psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong -f scripts/sql/thu-236-sua-phieu-nhap-safeupdate.sql
-- ====================================================================
\set ON_ERROR_STOP on
\pset pager off
LOAD 'safeupdate';

-- Phiên này phải chặn thật: câu UPDATE trần trên bảng tạm bị từ chối (cardinality_violation, như trên Supabase).
DO $t$
BEGIN
  CREATE TEMP TABLE _thu_safeupdate (a int) ON COMMIT DROP;
  BEGIN
    UPDATE _thu_safeupdate SET a = 1;
    RAISE EXCEPTION 'SAFEUPDATE_CHUA_BAT: UPDATE không WHERE vẫn chạy — phiên này chưa giống lượt gọi API Supabase';
  EXCEPTION WHEN cardinality_violation THEN
    RAISE NOTICE 'safeupdate đang chặn: %', SQLERRM;
  END;
END $t$;

\ir thu-235-sua-phieu-nhap-da-ban.sql
