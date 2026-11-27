import { Global, Module } from '@nestjs/common';
import { EventBus, InProcessEventBus } from './event-bus';
import { OutboxRelay } from './outbox-relay.service';
@Global() @Module({ providers: [{ provide: EventBus, useClass: InProcessEventBus }, OutboxRelay], exports: [EventBus, OutboxRelay] })
export class EventsModule {}
