#!/usr/bin/env bash
# Live-safe SQLite backup (VACUUM INTO works while the server holds the WAL).
# Installed to cron by setup.sh: daily 03:30, keeps 14 days.
set -euo pipefail

APP_DIR=/opt/rooster
DB="$APP_DIR/server/data/rooster.db"
OUT="$APP_DIR/backups/rooster-$(date +%Y%m%d-%H%M%S).db"

node --experimental-sqlite -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[1], { readOnly: true });
db.exec(\"VACUUM INTO '\" + process.argv[2].replace(/'/g, \"''\") + \"'\");
db.close();
" "$DB" "$OUT"

find "$APP_DIR/backups" -name 'rooster-*.db' -mtime +14 -delete
echo "$(date -Is) backup ok -> $OUT ($(stat -c%s "$OUT") bytes)"