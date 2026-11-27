# ADR-0007: Protecção de conteúdo por plataforma; sem promessa de DRM absoluto

- **Estado:** Aceite
- **Data:** 2026-11-27

## Contexto
Readium LCP não é DRM seguro no browser e requer certificação EDRLab em produção.

## Decisão
Nativo: Readium LCP (após certificação). Web: sessões curtas, URLs assinadas de curta duração, servidor de publicação controlado e watermarking (`distribution_watermarks`, pseudonimizado, sem PII). URL assinada é autorização temporária, não DRM. Não se promete protecção contra captura de ecrã.

## Consequências
+ Posição honesta e implementável. − Pirataria residual aceite e mitigada por rastreabilidade.
