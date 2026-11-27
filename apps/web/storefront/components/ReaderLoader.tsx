'use client';
import dynamic from 'next/dynamic';
import type { ReaderProps } from './Reader';

// O Readium usa APIs do browser (window/document): só é carregado no cliente.
const Reader = dynamic(() => import('./Reader'), { ssr: false, loading: () => <p className="muted" style={{ padding: 24 }}>A abrir o livro…</p> });
export default function ReaderLoader(p: ReaderProps) { return <Reader {...p} />; }
