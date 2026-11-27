# Reutilização de projectos open-source

Licenças **verificadas nos ficheiros LICENSE dos repositórios** (clone raso, 2026-11-27).

| Projecto | Licença | Natureza | Decisão |
|---|---|---|---|
| [readium/ts-toolkit](https://github.com/readium/ts-toolkit) | BSD-3-Clause | Motor de leitura web (navigators EPUB, Preferences/Decorator API) | **Dependência** (leitor web) |
| [readium/go-toolkit](https://github.com/readium/go-toolkit) | BSD-3-Clause | Serve EPUB/CBZ → Web Publication Manifest, positions, streaming de recursos | **Dependência/serviço** (servidor de publicação controlado) |
| [readium/web](https://github.com/readium/web) | BSD-3-Clause | Apenas documentação/gestão do projecto (o código está nos dois toolkits acima) | Referência |
| [bookorbit/bookorbit](https://github.com/bookorbit/bookorbit) | **AGPL-3.0 + termos adicionais** (atribuição obrigatória "Powered by BookOrbit", fonte completa da versão modificada, aviso de "versão modificada") | Servidor self-hosted | **Só referência de UX/funcionalidades. Não copiar código.** |
| [Kareadita/Kavita](https://github.com/Kareadita/Kavita) | **GPL-3.0** (C#/.NET + Angular) | Servidor self-hosted | **Só referência.** |
| [janeczku/calibre-web](https://github.com/janeczku/calibre-web) | **GPL-3.0** (Python/Flask) | Servidor self-hosted | **Só referência.** |
| [X2-Consult/trove](https://github.com/X2-Consult/trove) | **AGPL-3.0** (fork do BookLore; Java + Angular) | Servidor self-hosted | **Só referência.** |

## Conclusão
- Só o **Readium (BSD-3)** pode ser incorporado. É também o que a arquitectura já previa.
- Kavita, Calibre-Web, Trove e BookOrbit são **copyleft forte** (GPL/AGPL). Misturar o seu código com o nosso obrigaria a publicar o código-fonte da plataforma completa (AGPL §13 abrange serviço em rede) — incompatível com um produto comercial proprietário e com a distribuição nas lojas (GPL/AGPL e App Store são problemáticos).
- São também **produtos diferentes**: bibliotecas self-hosted, de um só inquilino, sem comércio, entitlements, marketplace nem royalties. Só têm em comum o domínio "ler livros".
- "Mesclar" faz-se ao nível de **ideias e padrões abertos**, não de código: reimplementamos a partir das especificações públicas (OPDS, EPUB/Readium Web Publication Manifest, KOReader sync protocol, formatos Kobo) e usamos estes projectos como benchmark de UX.

## O que aproveitar de cada um (como inspiração, sem copiar código)
| Funcionalidade | Inspiração | Nossa implementação |
|---|---|---|
| Leitor EPUB/paginação/preferências | Readium ts-toolkit (usar directamente) | `apps/web/reader` |
| Servir EPUB como manifesto + recursos | Readium go-toolkit (usar directamente) | serviço de publicação atrás de autorização por entitlement |
| Catálogo OPDS para apps de leitura | Calibre-Web, Kavita, Trove | feed OPDS 2.0 autenticado (P2), a partir da spec OPDS |
| Metadados automáticos | Calibre-Web, Kavita, Trove | `book-processor` (ISBN, OPF/EPUB, capas) com APIs abertas (Open Library) |
| Estantes, estatísticas de leitura, UX de biblioteca | BookOrbit, Kavita | `reading_lists`, `reading_sessions` já modelados |
| Sync Kobo/KOReader | Trove, BookOrbit | fora do MVP; avaliar protocolos públicos mais tarde |
| Comics (CBZ) | Kavita, Trove | leitor de imagens + go-toolkit (CBZ) |

## Processo
1. Lockfile + SCA + SBOM em CI. Licenças permitidas: MIT, BSD, Apache-2.0, ISC. GPL/AGPL **bloqueia o CI** salvo ADR.
2. Nunca abrir código GPL/AGPL ao copiar-colar; escrever a partir da especificação.
3. Se a decisão for mesmo basear a plataforma num destes (p. ex. Trove), o produto passa a AGPL com código aberto — decisão de negócio que exige ADR e parecer jurídico.
