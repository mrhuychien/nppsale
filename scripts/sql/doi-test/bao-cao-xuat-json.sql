-- ĐỘI TEST "BÁO CÁO" — dựng bộ dữ liệu bao-cao-du-lieu.sql rồi in MỘT dòng JSON gồm số của máy chủ
-- (bao_cao_so_ban, dashboard_summary, finance_pnl, top khách, kênh) + danh mục mặt hàng / NV / ids,
-- để tests/doi-bao-cao-cheo.test.ts kiểm chéo: số SQL == số TypeScript tính trên cùng dòng thô == số theo luật.
-- Chạy: psql -h /tmp/pgtest -p 55432 -U postgres -d npp_bao_cao -At -v ON_ERROR_STOP=1 -f scripts/sql/doi-test/bao-cao-xuat-json.sql
\set ON_ERROR_STOP on
\set QUIET on
SET client_min_messages = warning;
SET TIME ZONE 'UTC';
BEGIN;
\ir bao-cao-du-lieu.sql
\pset tuples_only on
\pset format unaligned
SELECT jsonb_build_object(
  'T', pg_temp.hn(),
  'so_ban', bao_cao_so_ban(pg_temp.hn() - 5, pg_temp.hn()),
  'so_ban_P', bao_cao_so_ban(pg_temp.hn() - 40, pg_temp.hn() - 30),
  'ds', (SELECT to_jsonb(d) FROM dashboard_summary(pg_temp.hn() - 5) d),
  'pnl', (SELECT to_jsonb(p) FROM finance_pnl(pg_temp.hn() - 5, pg_temp.hn()) p),
  'top', (SELECT jsonb_agg(to_jsonb(t)) FROM dashboard_top_customers(pg_temp.hn() - 5, 10) t),
  'kenh', (SELECT jsonb_agg(to_jsonb(k)) FROM dashboard_channel_revenue(pg_temp.hn() - 5) k),
  'ids', (SELECT jsonb_object_agg(k, v) FROM ctx),
  'sp', (SELECT jsonb_agg(jsonb_build_object('id', p.id, 'sku', p.sku, 'base_unit', p.base_unit, 'sell_price', p.sell_price,
            'units', (SELECT COALESCE(jsonb_agg(jsonb_build_object('unit_name', u.unit_name, 'conversion', u.conversion)), '[]') FROM product_units u WHERE u.product_id = p.id),
            'price_lists', (SELECT COALESCE(jsonb_agg(jsonb_build_object('unit_name', l.unit_name, 'price', l.price, 'group_id', l.group_id)), '[]') FROM price_lists l WHERE l.product_id = p.id)))
          FROM products p WHERE p.id IN (pg_temp.c('P1'), pg_temp.c('P3'), pg_temp.c('P5'))),
  'kh', (SELECT jsonb_agg(jsonb_build_object('id', id, 'channel', channel)) FROM customers WHERE id IN (pg_temp.c('KH1'), pg_temp.c('KH2'), pg_temp.c('KH3')))
);
ROLLBACK;
