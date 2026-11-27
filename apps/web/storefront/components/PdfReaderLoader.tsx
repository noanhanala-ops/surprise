'use client';
import dynamic from 'next/dynamic';
import type { PdfReaderProps } from './PdfReader';

// O PDF.js usa APIs do browser: só é carregado no cliente.
const PdfReader = dynamic(() => import('./PdfReader'), { ssr: false, loading: () => <p className="muted" style={{ padding: 24 }}>A abrir o PDF…</p> });
export default function PdfReaderLoader(p: PdfReaderProps) { return <PdfReader {...p} />; }
