# ADR-0001: Monólito modular com workers independentes

- **Estado:** Aceite
- **Data:** 2026-11-27

## Contexto
Equipa pequena, domínio comercial com forte consistência transaccional (compra → direito). Microserviços acrescentariam consistência eventual, múltiplos deploys e custo de observabilidade desnecessários.

## Decisão
Um único deployable NestJS (`apps/api`) com 14 módulos de domínio e fronteiras explícitas, mais workers separados (`apps/workers/*`) para processamento assíncrono. Módulos comunicam por interfaces públicas e eventos de domínio; nenhum módulo escreve nas tabelas de outro. Fronteiras verificadas em CI (regras de importação).

## Consequências
+ Transacções ACID simples, deploy único, debugging fácil. − Disciplina exigida para manter fronteiras; extracção futura de módulos (ex.: Search, Content) possível porque a comunicação já é por eventos.
