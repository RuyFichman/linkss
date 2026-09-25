# ADR 0003 — snapshots publicados

- **Status:** aceito
- **Data:** 25/09/2026

## Contexto

Páginas públicas precisam ser rápidas e estáveis; o editor precisa salvar rascunhos frequentemente.

## Decisão

Separar draft de versão publicada. A publicação gera snapshot imutável, invalida cache e mantém ao menos a versão anterior para rollback.

## Consequências

- Edição não degrada nem quebra a página ao vivo.
- Renderer faz leitura simples e cacheável.
- Publicação exige job/transação idempotente e política de retenção de versões.
