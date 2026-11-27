# Reutilização de projectos open-source

| Projecto | Uso | Licença (verificar na versão fixada) | Decisão |
|---|---|---|---|
| Readium (Web/Kotlin/Swift, LCP) | Motor de leitura EPUB/PDF nativo; LCP em produção só após certificação EDRLab | BSD-3 (toolkits) | **Dependência** |
| PDF.js | PDF na web (adaptador separado do Readium Web) | Apache-2.0 | **Dependência** |
| NestJS | Backend modular | MIT | **Dependência** |
| OpenSearch | Pesquisa/indexação | Apache-2.0 | **Dependência** (serviço gerido) |
| BookOrbit | Referência de UX de biblioteca/leitor | AGPL-3.0 + termos adicionais; API não estável | **Só referência** — não copiar código, não depender |

## Processo
1. Fixar versões por lockfile; SCA + gerador de SBOM em CI.
2. Lista de licenças permitidas: MIT, BSD, Apache-2.0, ISC. Copyleft forte (GPL/AGPL) **bloqueia o CI** salvo ADR.
3. Se os repositórios do utilizador forem integrados, listar aqui licença e decisão **antes** de copiar código.

> Pendente: o pedido original refere "projectos do GitHub a aproveitar" sem os identificar para além dos acima. Indicar os repositórios concretos para análise de licença/encaixe.
