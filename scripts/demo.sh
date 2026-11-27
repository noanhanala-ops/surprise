#!/usr/bin/env bash
# Arranca a plataforma em modo DEMONSTRAÇÃO (sandbox): PostgreSQL + API (3001) + loja web (3000) + dados de exemplo.
# Uso:  scripts/demo.sh            (precisa de Node >= 22, Docker e psql)
#       DATABASE_URL=postgres://... scripts/demo.sh   (usa a tua base de dados em vez do Docker)
# Só para ver e experimentar. SANDBOX_MODE liga pagamentos simulados; NÃO usar em produção.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD; RUN="$ROOT/.demo"; mkdir -p "$RUN/storage"

if [[ -z "${DATABASE_URL:-}" ]]; then
  docker compose up -d postgres
  export DATABASE_URL=postgres://drp:drp_dev_only@localhost:5432/drp
  until docker compose exec -T postgres pg_isready -U drp >/dev/null 2>&1; do sleep 1; done
fi

echo ">> dependências e build"
npm ci --no-audit --no-fund
npm run build -w @drp/contracts
npm run build -w @drp/api
npm run build -w @drp/web

echo ">> base de dados"
if [[ "$(psql "$DATABASE_URL" -Atc "select to_regclass('public.users') is not null")" != "t" ]]; then
  database/migrate.sh --seed
else echo "(já migrada)"; fi

export JWT_SECRET="demo-secret-demo-secret-demo-secret-1234" SANDBOX_MODE=true WEB_BASE_URL="${WEB_BASE_URL:-http://localhost:3000}" \
  STORAGE_DIR="$RUN/storage" PORT=3001 RATE_REGISTER_IP=100000 RATE_LOGIN_IP=100000 RATE_LOGIN_FAILS=50 RATE_FORGOT_IP=100000 RATE_FORGOT_EMAIL=100000
trap 'kill $(jobs -p) 2>/dev/null || true' EXIT
node apps/api/dist/main.js >"$RUN/api.log" 2>&1 &
until curl -fs localhost:3001/v1/health >/dev/null; do sleep 1; done

echo ">> dados de demonstração"
(cd apps/api && API_URL=http://localhost:3001 npx ts-node scripts/seed-demo.ts) | tee "$RUN/seed.log"

(cd apps/web/storefront && API_URL=http://localhost:3001 SANDBOX_MODE=true DEFAULT_COUNTRY=MZ npx next start -p 3000 >"$RUN/web.log" 2>&1) &
until curl -fs localhost:3000 >/dev/null; do sleep 1; done
cat <<MSG

============================================================
 Loja:   http://localhost:3000   (no Codespaces: separador PORTAS → abrir a 3000)
 Contas (palavra-passe: demo-password-123): ver o resumo do seed acima ($RUN/seed.log)
 Admin tem MFA: use o segredo TOTP impresso pelo seed (guarde-o).
 Ctrl+C para parar.
============================================================
MSG
wait
