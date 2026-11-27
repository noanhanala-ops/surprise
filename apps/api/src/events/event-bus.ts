import { Injectable } from '@nestjs/common';

export interface BusEvent { eventId: string; type: string; occurredAt: string; payload: any }
export type Handler = (e: BusEvent) => Promise<void>;

/** Porta do broker. Dev/testes: em processo. Produção: adaptador RabbitMQ com a mesma interface (ADR-0004). */
export abstract class EventBus {
  abstract publish(e: BusEvent): Promise<void>;
  abstract subscribe(type: string, handler: Handler): void;
}

@Injectable()
export class InProcessEventBus extends EventBus {
  private handlers = new Map<string, Handler[]>();
  subscribe(type: string, h: Handler) { this.handlers.set(type, [...(this.handlers.get(type) ?? []), h]); }
  async publish(e: BusEvent) { for (const h of this.handlers.get(e.type) ?? []) await h(e); }
}
