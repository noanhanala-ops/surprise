import { Injectable } from '@nestjs/common';

export interface BusEvent { eventId: string; type: string; occurredAt: string; payload: any }
export type Handler = (e: BusEvent) => Promise<void>;

/** O broker está inacessível (infra). O relay NÃO conta isto como falha do evento: tenta de novo mais tarde. */
export class BrokerUnavailableError extends Error {}

/**
 * Porta do broker (ADR-0004). `consumer` identifica a fila do consumidor: dois consumidores do mesmo tipo recebem
 * cada um a sua cópia. Entrega at-least-once ⇒ os handlers têm de ser idempotentes (inbox).
 */
export abstract class EventBus {
  abstract publish(e: BusEvent): Promise<void>;
  abstract subscribe(consumer: string, type: string, handler: Handler): void;
  isReady(): boolean { return true; }
}

@Injectable()
export class InProcessEventBus extends EventBus {
  private handlers = new Map<string, Handler[]>();
  subscribe(_consumer: string, type: string, h: Handler) { this.handlers.set(type, [...(this.handlers.get(type) ?? []), h]); }
  async publish(e: BusEvent) { for (const h of this.handlers.get(e.type) ?? []) await h(e); }
}
