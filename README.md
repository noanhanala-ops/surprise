# cellforensics

Ferramenta forense (somente leitura) que extrai e normaliza **células/antenas de telefonia móvel
observadas por um aparelho**, a partir de uma extração **já adquirida e autorizada** (pasta de
filesystem, backup, bugreport). Não acessa aparelhos, redes nem a operadora.

## Uso

```bash
python -m cellforensics /caminho/da/extracao -o saida/            # csv + json + html
python -m cellforensics bugreport.zip --format csv
python -m cellforensics /extracao --towerdb opencellid.csv        # coordenadas estimadas
python -m unittest discover -s tests                              # testes
```

Saída: `cells.csv` (planilha), `cells.json` (com hashes SHA-256 das fontes, para o laudo) e
`report.html` (resumo por célula, linha do tempo, fontes).

## Artefatos suportados

| Plataforma | Artefato | Horário |
|---|---|---|
| Android | `CellIdentity*` em bugreport/dumpsys (`.txt`, `.zip`) | snapshot da captura |
| Android | linhas de logcat de rádio com `CellIdentity*` | do próprio log (requer ano do cabeçalho `== dumpstate:`) |
| iOS | tabelas `*CellLocation` em `consolidated.db` / `cache_encrypted*.db` (locationd) | época Cocoa → UTC |

Não implementado ainda: `cache.cell` do Google Play Services, `knowledgeC`/`Biome`, Wi-Fi.

## Limitações (importante para o laudo)

- Uma célula indica **área de cobertura**, não a posição exata do aparelho.
- Coordenadas vêm do cache do aparelho (`device_cache`) ou do OpenCelliD (`towerdb`) e são estimativas.
- Bugreport/dumpsys mostra só o estado no momento da captura.
- Formatos de tabelas variam por versão de SO; validar com extração real e ferramenta de referência.
- Cruzar sempre com o extrato de ERBs da operadora (ordem judicial).
