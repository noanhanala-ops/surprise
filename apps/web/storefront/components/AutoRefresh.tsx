'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/** Re-renderiza a página (servidor) de `interval` em `interval` ms até `max` tentativas. Usado enquanto se espera por um evento assíncrono. */
export default function AutoRefresh({ interval = 1000, max = 60 }: { interval?: number; max?: number }) {
  const router = useRouter(); const [n, setN] = useState(0);
  useEffect(() => {
    if (n >= max) return;
    const t = setTimeout(() => { router.refresh(); setN((x) => x + 1); }, interval); return () => clearTimeout(t);
  }, [n, max, interval, router]);
  return n >= max ? <p className="alert warn">A confirmação está a demorar. Pode fechar esta página: o livro aparece na sua biblioteca assim que o pagamento for confirmado.</p> : null;
}
