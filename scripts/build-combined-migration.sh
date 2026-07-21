#!/usr/bin/env bash
# Gộp toàn bộ migration theo thứ tự thành 1 file để cài mới nhanh.
# Chạy lại mỗi khi thêm migration mới:  bash scripts/build-combined-migration.sh
#
# Sinh ra 2 file:
#   supabase/schema_full.sql — schema + RLS, KHÔNG kèm dữ liệu demo.
#     An toàn cho site thương mại: không có tài khoản demo mật khẩu
#     công khai (Demo@123456).
#   supabase/seed_demo.sql   — dữ liệu mẫu + 6 tài khoản demo. CHỈ dùng
#     cho môi trường thử nghiệm, tuyệt đối không chạy trên production.
set -euo pipefail
cd "$(dirname "$0")/.."

SEED_FILE="supabase/migrations/003_seed.sql"
OUT_SCHEMA="supabase/schema_full.sql"
OUT_SEED="supabase/seed_demo.sql"

{
  echo "-- ================================================================"
  echo "-- npp.sale — SCHEMA GỘP (tự sinh, KHÔNG sửa tay)"
  echo "-- Gộp tất cả migration trong supabase/migrations theo thứ tự,"
  echo "-- TRỪ 003_seed (dữ liệu demo — xem supabase/seed_demo.sql)."
  echo "-- Dùng cho CÀI MỚI: dán toàn bộ file này vào Supabase SQL Editor"
  echo "-- và chạy 1 lần trên database TRỐNG."
  echo "-- Sinh lại bằng: bash scripts/build-combined-migration.sh"
  echo "-- ================================================================"
  echo
  for f in $(ls supabase/migrations/*.sql | sort); do
    [ "$f" = "$SEED_FILE" ] && continue
    echo ""
    echo "-- ####################################################################"
    echo "-- # $(basename "$f")"
    echo "-- ####################################################################"
    echo ""
    cat "$f"
    echo ""
  done
} > "$OUT_SCHEMA"

{
  echo "-- ================================================================"
  echo "-- npp.sale — DỮ LIỆU DEMO (tự sinh từ 003_seed.sql)"
  echo "-- 6 tài khoản *@demo.com với mật khẩu công khai Demo@123456."
  echo "-- CHỈ chạy trên môi trường thử nghiệm. KHÔNG chạy trên production."
  echo "-- ================================================================"
  echo
  cat "$SEED_FILE"
} > "$OUT_SEED"

echo "Đã sinh:"
echo "  $OUT_SCHEMA ($(wc -l < "$OUT_SCHEMA") dòng, không kèm seed)"
echo "  $OUT_SEED ($(wc -l < "$OUT_SEED") dòng, demo-only)"
