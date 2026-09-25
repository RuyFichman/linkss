# ADR 0002 — Supabase para Postgres, Auth e RLS

- **Status:** aceito para MVP
- **Data:** 25/09/2026

## Contexto

Precisamos de banco relacional, autenticação, autorização por tenant, migrations e caminho de escala sem operar infraestrutura completa.

## Decisão

Usar Supabase para Postgres e Auth, com RLS como camada adicional de isolamento. Storage pode iniciar no Supabase, mas será acessado por adapter. Free atende desenvolvimento/piloto; produção muda para Pro antes do beta pago.

## Consequências

- Entrega inicial rápida e Postgres portável.
- Limites do Free exigem retenção de eventos e controle de mídia.
- SQL/RLS e backups continuam sendo nossa responsabilidade de engenharia.
- Dependências específicas ficam concentradas em adapters e infraestrutura.
