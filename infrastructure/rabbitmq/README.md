# RabbitMQ
- Topologia criada pela aplicação: exchange `topic` `<prefix>.events`, exchange `direct` `<prefix>.retry`, filas `<prefix>.<consumidor>.<tipo>` (+ `.retry` com TTL) e `<prefix>.dead`.
- Produção: vhost dedicado, utilizador por serviço, TLS, quorum queues (alterar `assertQueue` com `arguments: {'x-queue-type':'quorum'}` quando houver cluster), alarme em `<prefix>.dead` > 0.
- Reprocessar dead-letters: republicar manualmente no exchange `<prefix>.events` após corrigir a causa (os consumidores são idempotentes).
