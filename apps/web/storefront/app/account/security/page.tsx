import { authed } from '@/lib/api';
import MfaPanel from '@/components/MfaSetup';
import { ACCOUNT_TABS, Tabs } from '@/components/PortalChrome';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Segurança da conta' };
export default async function Security({ searchParams }: { searchParams: Promise<{ error?: string; disabled?: string }> }) {
  const q = await searchParams; const me = await authed<{ email: string; mfa_enabled: boolean }>('/users/me', '/account/security');
  return (
    <>
      <h1>A minha conta</h1><Tabs items={ACCOUNT_TABS} current="/account/security" />
      <p className="muted">{me.email}</p>
      {q.error && <p className="alert err" role="alert">{q.error}</p>}
      {q.disabled && <p className="alert ok" role="status">Verificação em dois passos desativada.</p>}
      <h2>Verificação em dois passos (MFA)</h2>
      <MfaPanel enabled={me.mfa_enabled} />
    </>
  );
}
