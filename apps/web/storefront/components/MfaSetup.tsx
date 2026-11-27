'use client';
import { useActionState, useState } from 'react';
import { EnrollState, mfaConfirmAction, mfaDisableAction, mfaEnrollAction } from '@/lib/actions';

/**
 * Painel de MFA. É o MESMO componente antes e depois de ativar: ao confirmar, a página (servidor) passa a `enabled=true`,
 * mas os códigos de recuperação — que só existem aqui, no estado — têm de continuar visíveis até o utilizador sair da página.
 */
export default function MfaPanel({ enabled }: { enabled: boolean }) {
  const [enroll, setEnroll] = useState<EnrollState | null>(null); const [pending, setPending] = useState(false);
  const [confirm, confirmAction, confirming] = useActionState(mfaConfirmAction, {} as EnrollState);
  const state = confirm.done ? confirm : { ...enroll, ...confirm };
  if (confirm.done) return (
    <div data-testid="mfa-done">
      <p className="alert ok" role="status">MFA ativado. Guarde os códigos de recuperação num local seguro: <strong>só são mostrados agora</strong> e cada um serve uma vez.</p>
      <ul data-testid="recovery-codes" style={{ columns: 2, fontFamily: 'monospace', listStyle: 'none', padding: 0 }}>{confirm.recovery_codes!.map((c) => <li key={c}>{c}</li>)}</ul>
    </div>);
  if (enabled) return (
    <form className="stack" action={mfaDisableAction}>
      <p className="alert ok" data-testid="mfa-on">Ativa. Ao entrar, será pedido um código da sua app autenticadora.</p>
      <label>Para desativar, introduza um código<input name="code" required minLength={6} maxLength={12} autoComplete="one-time-code" /></label>
      <button className="secondary" type="submit">Desativar</button>
    </form>);
  if (!enroll?.secret) return (
    <div>
      {enroll?.error && <p className="alert err" role="alert">{enroll.error}</p>}
      <button disabled={pending} onClick={async () => { setPending(true); setEnroll(await mfaEnrollAction()); setPending(false); }}>Ativar verificação em dois passos</button>
    </div>);
  return (
    <div>
      <ol>
        <li>Abra a sua app autenticadora (Google Authenticator, Microsoft Authenticator, Authy…) e leia o QR code.</li>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <li><img src={enroll.qr} alt="QR code para a app autenticadora" width={220} height={220} /><br /><span className="muted">Ou introduza manualmente: </span><code data-testid="mfa-secret">{enroll.secret}</code></li>
        <li>Introduza o código de 6 dígitos que a app mostra:</li>
      </ol>
      {state.error && <p className="alert err" role="alert">{state.error}</p>}
      <form className="stack" action={confirmAction}>
        <label>Código<input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" /></label>
        <button type="submit" disabled={confirming}>Confirmar e ativar</button>
      </form>
    </div>);
}
