import { Injectable, NotFoundException } from '@nestjs/common';
import type { PaymentProvider } from '@drp/contracts';
import { FakeProvider } from './fake.provider';

/** Registo de adaptadores. Novos fornecedores (M-Pesa, cartões...) entram aqui sem tocar em Commerce/Entitlements. */
@Injectable()
export class ProviderRegistry {
  private map = new Map<string, PaymentProvider>();
  // Explícito: o fornecedor simulado nunca é activado por omissão.
  constructor(fake: FakeProvider) { if (process.env.SANDBOX_MODE === 'true') this.map.set(fake.code, fake); }
  get(code: string): PaymentProvider { const p = this.map.get(code); if (!p) throw new NotFoundException(`Fornecedor desconhecido: ${code}`); return p; }
  list() { return [...this.map.keys()]; }
}
