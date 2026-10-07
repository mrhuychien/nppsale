#!/usr/bin/env bash
# Never enable xtrace: environment variables contain credentials.
set +x
set -euo pipefail
for name in SUPABASE_DB_URL AGE_PUBLIC_KEY GDRIVE_CLIENT_ID GDRIVE_CLIENT_SECRET GDRIVE_REFRESH_TOKEN GDRIVE_FOLDER_ID; do
  if [[ -z "${!name:-}" ]]; then
    printf '::error::BACKUP_MISSING_SECRET %s\n' "$name"
    exit 1
  fi
done
printf 'Backup configuration present (6 secrets).\n'
