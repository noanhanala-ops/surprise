#!/usr/bin/env bash
# Aplica migrações em ordem lexicográfica. Uso: DATABASE_URL=postgres://... ./migrate.sh [--seed]
set -euo pipefail
: "${DATABASE_URL:?defina DATABASE_URL}"
cd "$(dirname "$0")"
for f in migrations/*.sql; do echo ">> $f"; psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -1 -f "$f"; done
if [[ "${1:-}" == "--seed" ]]; then for f in seeds/*.sql; do echo ">> $f"; psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"; done; fi
