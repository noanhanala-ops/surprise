import { Global, Module } from '@nestjs/common';
import { EventBus, InProcessEventBus } from './event-bus';
import { OutboxRelay } from './outbox-relay.service';
import { RabbitMqEventBus } from './rabbitmq-event-bus';

/** RABBITMQ_URL definido ⇒ RabbitMQ; senão barramento em processo (dev/testes unitários). */
@Global() @Module({
  providers: [{ provide: EventBus, useFactory: (): EventBus => process.env.RABBITMQ_URL
      ? new RabbitMqEventBus({ url: process.env.RABBITMQ_URL, prefix: process.env.RABBITMQ_PREFIX, maxRetries: Number(process.env.RABBITMQ_MAX_RETRIES ?? 5), retryDelayMs: Number(process.env.RABBITMQ_RETRY_DELAY_MS ?? 5000) })
      : new InProcessEventBus() }, OutboxRelay],
  exports: [EventBus, OutboxRelay],
})
export class EventsModule {}
