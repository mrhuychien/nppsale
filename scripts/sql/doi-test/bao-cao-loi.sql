-- ====================================================================
-- ĐỘI TEST "BÁO CÁO" — CÁC LỖI ĐÃ XÁC MINH (để NGUYÊN ĐỎ tới khi sửa; sửa xong chạy lại phải ĐẠT hết).
--
-- Chạy: psql -h /tmp/pgtest -p 55432 -U postgres -d npp_bao_cao -v ON_ERROR_STOP=1 -f scripts/sql/doi-test/bao-cao-loi.sql
-- Bộ dữ liệu: bao-cao-du-lieu.sql (xem chú thích đầu tệp đó). Bọc BEGIN … ROLLBACK.
--
-- LỖI 1 — finance_pnl cộng giá vốn của phiếu XUẤT thuộc HĐ đã HUỶ / tờ cũ của HĐ đã SỬA, nhưng không trừ
--   phiếu "Hoàn kho do huỷ hóa đơn …" đi kèm → giá vốn phồng, lãi gộp thấp giả.
--   Luật: CLAUDE.md "Lãi gộp = doanh thu thuần − (giá vốn − giá vốn hàng trả đã nhập kho)"; "Huỷ HĐ" =
--   không còn doanh thu (mig 217) → hàng đã hoàn kho thì cũng không còn giá vốn.
--   Hôm nay xuất kho: H1 406.000 + H2 270.000 + H3 360.000 + H5 tờ mới 56.000 + H6 9.000 + H7 9.000
--   = 1.110.000 hàng THẬT SỰ bán; cộng thêm H4 (huỷ) 27.000 + H5 tờ cũ 70.000 = 1.207.000 là sai 97.000.
--
-- LỖI 2 — finance_pnl lọc phiếu kho theo `p_from::timestamptz` / `(p_to + 1)::timestamptz` = nửa đêm theo
--   múi giờ PHIÊN (Supabase = UTC) = 07:00 sáng giờ VN. Phiếu xuất ghi sổ 00:00–06:59 giờ VN bị xếp sang
--   ngày hôm trước; bao_cao_so_ban (mig 204) lại xếp đúng ngày VN (+07:00) → hai báo cáo lệch giá vốn.
--   Luật: CLAUDE.md "so bằng ngày theo giờ VN (vnDateKey), không so với mốc ISO/UTC".
--
-- LỖI 3 — Huỷ phiếu trả tự lập đã hoàn thành sinh phiếu XUẤT "Đảo phiếu trả …" có unit_cost = 0
--   (cancel_return, mig 191). bao_cao_so_ban.gv (và fetchCogsForRange ở TS) cộng phiếu này như phiếu xuất
--   bán → giá vốn bình quân / đơn vị cơ sở của kỳ bị KÉO XUỐNG → giá vốn hàng bán thấp, lãi gộp Báo cáo
--   tổng hợp cao giả. Bộ dữ liệu: P5 chỉ có MỘT lô giá vốn 9.000, mọi phiếu xuất bán đều 9.000/lon; R3
--   (2 lon) huỷ → đảo 2 lon giá 0 → bình quân 315.000 / 37 = 8.513,5.
--   Luật: CLAUDE.md "Lãi gộp = doanh thu thuần − (giá vốn − giá vốn hàng trả đã nhập kho)"; `unit_cost` là
--   giá mỗi đơn vị cơ sở — hàng bán ra từ lô 9.000 thì giá vốn là 9.000.
-- ====================================================================
\set ON_ERROR_STOP on
\pset pager off
SET client_min_messages = warning;
SET TIME ZONE 'UTC';

GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;

BEGIN;
CREATE TEMP TABLE kq (stt serial, buoc text, ten text, ok boolean, ghi text);
\ir bao-cao-du-lieu.sql
CREATE FUNCTION pg_temp.ghi(b text, t text, ok boolean, g text) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO kq (buoc, ten, ok, ghi) VALUES (b, t, COALESCE(ok, false), g) $f$;

-- ───────── LỖI 3: phiếu đảo của phiếu trả huỷ kéo giá vốn bình quân ─────────
DO $t$ DECLARE j jsonb; T date := pg_temp.hn(); v numeric; BEGIN
  j := bao_cao_so_ban(T, T);
  SELECT (x->>'tien')::numeric / NULLIF((x->>'sl')::numeric, 0) INTO v
    FROM jsonb_array_elements(j->'gv') x WHERE x->>'product_id' = pg_temp.c('P5')::text;
  PERFORM pg_temp.ghi('L3', 'giá vốn bình quân P5 hôm nay (một lô 9.000/lon) = 9.000 — phiếu "Đảo phiếu trả" giá 0 không được kéo xuống',
    v = 9000, format('bình quân %s; gv P5 = %s', round(v, 2),
      (SELECT x::text FROM jsonb_array_elements(j->'gv') x WHERE x->>'product_id' = pg_temp.c('P5')::text)));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('L3', 'NỔ', false, SQLERRM);
END $t$;

-- ───────── LỖI 1: giá vốn của HĐ huỷ / tờ cũ HĐ sửa ─────────
DO $t$ DECLARE p record; T date := pg_temp.hn(); BEGIN
  SELECT * INTO p FROM finance_pnl(T, T);
  -- finance_pnl.cogs = giá vốn xuất − giá vốn hàng trả đã nhập (returns_cogs 227.000).
  PERFORM pg_temp.ghi('L1', 'P&L hôm nay: giá vốn xuất (cogs + returns_cogs) = 1.110.000 — KHÔNG gồm H4 đã huỷ (27.000) và tờ cũ H5 (70.000)',
    p.cogs + p.returns_cogs = 1110000,
    format('giá vốn xuất %s (thừa %s), returns_cogs %s', p.cogs + p.returns_cogs, p.cogs + p.returns_cogs - 1110000, p.returns_cogs));
  PERFORM pg_temp.ghi('L1', 'P&L hôm nay: cogs (thuần) = 1.110.000 − 227.000 = 883.000', p.cogs = 883000, format('cogs %s', p.cogs));
  -- Lãi gộp toàn bộ chứng từ của bộ dữ liệu: thuần 1.204.000 − 883.000 = 321.000.
  SELECT * INTO p FROM finance_pnl(T - 40, T);
  PERFORM pg_temp.ghi('L1', 'P&L [T-40, T]: lãi gộp = thuần 1.204.000 − giá vốn 883.000 = 321.000',
    p.revenue - p.cogs = 321000, format('thuần %s − cogs %s = %s', p.revenue, p.cogs, p.revenue - p.cogs));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('L1', 'NỔ', false, SQLERRM);
END $t$;

-- Đối chứng: chỉ HUỶ một HĐ (không gì khác) thì P&L đổi giá vốn — phải về như chưa từng xuất.
DO $t$ DECLARE c0 numeric; c1 numeric; T date := pg_temp.hn(); BEGIN
  PERFORM pg_temp.tao_don('H9', pg_temp.c('KH2'), pg_temp.c('NVA'), jsonb_build_array(
    jsonb_build_object('p', pg_temp.c('P5'), 'u', 'lon', 'sl', 10, 'gia', 14000)));
  SELECT cogs INTO c0 FROM finance_pnl(T, T);
  PERFORM pg_temp.xuat('H9', T, jsonb_build_array(pg_temp.dl('H9', 1, 10)));
  PERFORM pg_temp.chu();
  PERFORM cancel_invoice(pg_temp.c('H9.hd'), 'khách huỷ');
  SELECT cogs INTO c1 FROM finance_pnl(T, T);
  PERFORM pg_temp.ghi('L1', 'xuất H9 (10 lon P5) rồi huỷ ngay: giá vốn P&L hôm nay KHÔNG đổi (hàng đã hoàn kho, tồn P5 về như cũ)',
    c1 = c0, format('trước %s, sau %s (thừa %s = 10 × 9.000)', c0, c1, c1 - c0));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('L1', 'NỔ', false, SQLERRM);
END $t$;

-- ───────── LỖI 2: mốc ngày của finance_pnl theo UTC ─────────
DO $t$ DECLARE p record; j jsonb; T date := pg_temp.hn(); v_sb numeric; BEGIN
  -- Phiếu xuất của H6 (1 lon P5, giá vốn 9.000) ghi sổ lúc 00:30 giờ VN ngày T-1.
  UPDATE stock_entries SET posted_at = ((T - 1 + time '00:30') AT TIME ZONE 'Asia/Ho_Chi_Minh')
   WHERE id = (SELECT stock_entry_id FROM sales_invoices WHERE id = pg_temp.c('H6.hd'));
  j := bao_cao_so_ban(T - 1, T - 1);
  SELECT COALESCE(sum((x->>'tien')::numeric), 0) INTO v_sb FROM jsonb_array_elements(j->'gv') x;
  SELECT * INTO p FROM finance_pnl(T - 1, T - 1);
  PERFORM pg_temp.ghi('L2', 'phiếu xuất 00:30 giờ VN ngày T-1: P&L ngày T-1 có giá vốn 9.000 (như bao_cao_so_ban cùng ngày)',
    p.cogs + p.returns_cogs = 9000 AND v_sb = 9000,
    format('finance_pnl %s, bao_cao_so_ban %s', p.cogs + p.returns_cogs, v_sb));
  SELECT * INTO p FROM finance_pnl(T - 2, T - 2);
  PERFORM pg_temp.ghi('L2', 'cùng phiếu đó KHÔNG được vào P&L ngày T-2', p.cogs + p.returns_cogs = 0,
    format('finance_pnl ngày T-2: %s', p.cogs + p.returns_cogs));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('L2', 'NỔ', false, SQLERRM);
END $t$;

SELECT stt, buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ten, ghi FROM kq ORDER BY stt;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
