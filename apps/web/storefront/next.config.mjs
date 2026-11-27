const API_URL = process.env.API_URL ?? 'http://localhost:3001';

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  poweredByHeader: false,
  // O leitor carrega o EPUB do MESMO origin da app (sem CORS e sem expor a API): o token vai no caminho.
  async rewrites() { return [{ source: '/v1/read/:path*', destination: `${API_URL}/v1/read/:path*` }, { source: '/v1/covers/:id', destination: `${API_URL}/v1/covers/:id` },
      // upload em modo "proxy" (dev): o browser envia para o mesmo origin; em produção (S3) vai directo ao bucket por URL pré-assinada
      { source: '/v1/uploads/:token', destination: `${API_URL}/v1/uploads/:token` }]; },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'no-referrer' }, // o token de leitura vai no URL: nunca em Referer
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ] }];
  },
};
