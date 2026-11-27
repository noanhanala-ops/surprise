# @drp/api — NestJS (monólito modular)

## Configuração (variáveis de ambiente)
| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | sim | PostgreSQL |
| `JWT_SECRET` | sim | ≥ 32 caracteres |
| `RABBITMQ_URL` | não | Se definida usa RabbitMQ; senão barramento em processo (só dev/testes). `RABBITMQ_PREFIX`, `RABBITMQ_MAX_RETRIES` (5), `RABBITMQ_RETRY_DELAY_MS` (5000) |
| `S3_BUCKET` | não | Se definida usa S3/R2/MinIO com **upload directo por URL pré-assinada**; senão disco local (`STORAGE_DIR`). `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT` (o que o cliente vê), `S3_REGION`, `S3_FORCE_PATH_STYLE`; credenciais via `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` |
| `OUTBOX_POLL_MS` | não | Intervalo do relay do outbox (500; `0` desliga) |
| `FAKE_PROVIDER_SECRET` | dev | Fornecedor simulado; **desligado em `NODE_ENV=production`** |

## Testes
```bash
npm run build -w @drp/contracts
npm test -w @drp/api                    # 57 e2e (PostgreSQL; sem RabbitMQ/S3)
# com serviços reais (falha se faltarem variáveis):
RABBITMQ_URL=amqp://guest:guest@localhost:5672 S3_ENDPOINT=http://localhost:9000 \
AWS_ACCESS_KEY_ID=drp AWS_SECRET_ACCESS_KEY=drp_dev_only npm run test:infra -w @drp/api   # 14 testes
```

## Garantias de entrega de eventos (RabbitMQ)
- Publicação com confirmação do broker; só então o evento sai do outbox.
- Broker em baixo ⇒ eventos ficam no outbox **sem gastar tentativas** nem ir para dead-letter.
- Uma fila durável por (consumidor, tipo). Falha do handler ⇒ fila `.retry` (atraso) ⇒ reentrega; após `maxRetries` ⇒ `<prefix>.dead`.
- Entrega **at-least-once**: todos os consumidores são idempotentes (inbox + constraints).
- Cada processo declara as filas dos seus consumidores no arranque; `publish()` espera por isso (mensagens sem fila seriam descartadas pelo broker). Um tipo de evento sem consumidor é descartado por desenho.
