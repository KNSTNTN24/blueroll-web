#!/usr/bin/env bash
# Run a SQL file against the live Supabase project via Management API.
# Usage: scripts/sql-api.sh path/to/file.sql
set -euo pipefail
TOKEN="${SUPABASE_ACCESS_TOKEN:?export SUPABASE_ACCESS_TOKEN first}"
FILE="${1:?usage: sql-api.sh file.sql}"
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT
python3 - "$FILE" <<'EOF' > "$TMPFILE"
import json, sys
print(json.dumps({"query": open(sys.argv[1]).read()}))
EOF
curl -sf -X POST \
  "https://api.supabase.com/v1/projects/rszrggreuarvodcqeqrj/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d @"$TMPFILE"
echo
