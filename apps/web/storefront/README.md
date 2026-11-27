# @drp/web — loja, conta e leitor (Next.js 16)

BFF: o browser nunca vê tokens. Login/registo/compra são *server actions*; a sessão vive em cookies `httpOnly; SameSite=Lax`
(`drp_at` 15 min, `drp_rt` 30 d, rotação). O JS do browser só fala com `/api/bff/*` (lista de permissões fechada, mutações exigem `X-Requested-With: drp`).
O EPUB e as capas são servidos pelo mesmo origin através de *rewrites* (`/v1/read/*`, `/v1/covers/*`) — sem CORS e sem expor a API.

## Configuração
| Variável | Descrição |
|---|---|
| `API_URL` | URL da API (servidor→servidor), ex.: `http://localhost:3001` |
| `DEFAULT_COUNTRY` | País assumido sem `CF-IPCountry` (dev) |
| `SANDBOX_MODE` | `true` ⇒ botão "simular pagamento" e verificação de e-mail automática. **Nunca em produção** (a API recusa arrancar assim). |

## Correr localmente
```bash
# API (com SANDBOX_MODE=true) e seed de demonstração
npm run build -w @drp/contracts && npm run build -w @drp/api
cd apps/api && DATABASE_URL=… JWT_SECRET=… SANDBOX_MODE=true PORT=3001 node dist/main.js &
DATABASE_URL=… API_URL=http://localhost:3001 npm run seed:demo -w @drp/api
# Web
cd apps/web/storefront && API_URL=http://localhost:3001 SANDBOX_MODE=true npm run build && API_URL=http://localhost:3001 SANDBOX_MODE=true npm start
# E2E no browser (Chromium + Playwright). Subir os limites de rate limit da API (muitos registos do mesmo IP) e ter psql + DATABASE_URL
RATE_REGISTER_IP=100000 RATE_LOGIN_IP=100000 RATE_LOGIN_FAILS=50 (na API) ; DATABASE_URL=… npm run e2e:web
```

## Notas
- Os pacotes `@readium/*` declaram `engines: node >=24` (aviso do npm em Node 22; são bibliotecas de browser e compilam normalmente).
- Pendente: i18n (só pt-PT), CSP com *nonce*, capas na biblioteca, escolha de método de pagamento real.
