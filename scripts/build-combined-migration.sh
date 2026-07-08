#!/usr/bin/env bash
# Gộp toàn bộ migration theo thứ tự thành 1 file để cài mới nhanh.
# Chạy lại mỗi khi thêm migration mới:  bash scripts/build-combined-migration.sh
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="supabase/schema_full.sql"
{
  echo "-- ================================================================"
  echo "-- npp.sale — SCHEMA GỘP (tự sinh, KHÔNG sửa tay)"
  echo "-- Gộp tất cả migration trong supabase/migrations theo thứ tự."
  echo "-- Dùng cho CÀI MỚI: dán toàn bộ file này vào Supabase SQL Editor"
  echo "-- và chạy 1 lần trên database TRỐNG."
  echo "-- Sinh lại bằng: bash scripts/build-combined-migration.sh"
  echo "-- ================================================================"
  echo
  for f in $(ls supabase/migrations/*.sql | sort); do
    echo ""
    echo "-- ####################################################################"
    echo "-- # $(basename "$f")"
    echo "-- ####################################################################"
    echo ""
    cat "$f"
    echo ""
  done
} > "$OUT"
echo "Đã sinh $OUT ($(ls supabase/migrations/*.sql | wc -l) migration, $(wc -l < "$OUT") dòng)"
