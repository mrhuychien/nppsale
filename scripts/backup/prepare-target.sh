#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077
mkdir -p out
# PGURL is used only for SELECT catalog metadata, explicitly read-only.
if ! PGOPTIONS='-c default_transaction_read_only=on' psql -X -v ON_ERROR_STOP=1 \
  "$PGURL" -tA -f scripts/backup/dependency-inventory.sql >out/dependencies.json 2>/dev/null; then
  printf '::error::BACKUP_DEPENDENCY_SOURCE_INVENTORY_FAILED\n'; exit 1
fi
target='postgresql://postgres@localhost:5433/verify'
if ! psql -X -v ON_ERROR_STOP=1 "$target" -tAc \
  "SELECT COALESCE(json_agg(json_build_object('name',name,'version',version)), '[]'::json) FROM pg_available_extension_versions;" \
  >out/available-extensions.json 2>/dev/null; then
  printf '::error::BACKUP_DEPENDENCY_TARGET_INVENTORY_FAILED\n'; exit 1
fi
node scripts/backup/plan-dependencies.mjs
# All write SQL is generated from allowlisted metadata and sent only to the
# hardcoded disposable target. Source URL cannot be used as a write target.
if ! psql -X -v ON_ERROR_STOP=1 "$target" -f out/bootstrap.sql >/dev/null 2>&1; then
  printf '::error::BACKUP_DEPENDENCY_BOOTSTRAP_FAILED\n'; exit 1
fi
rm -f out/bootstrap.sql out/available-extensions.json
printf 'Disposable target prepared using validated catalog dependencies.\n'
