# Arquitetura de referência

## Escolha

Monólito modular em Next.js e TypeScript, implantado inicialmente na Vercel, com Supabase para Postgres, Auth e Row Level Security. O desenho otimiza velocidade de entrega sem fechar caminhos de escala.

## Componentes

```text
Visitante ── CDN/edge ── Renderer público ── snapshot publicado
                                  │
                                  └── ingestão assíncrona de eventos

Usuário ── Aplicação autenticada ── Supabase Auth
                    │             └─ Postgres + RLS
                    ├── mídia via StorageAdapter
                    ├── cobrança via PaymentsAdapter
                    └── e-mail via MailAdapter

Eventos brutos ── retenção curta ── agregados diários ── dashboard
```

## Stack recomendada

| Camada | Escolha inicial | Caminho de escala |
|---|---|---|
| Web | Next.js 16, React 19, TypeScript | renderer e dashboard podem ser separados quando houver evidência |
| UI | Tailwind CSS + componentes próprios acessíveis | extrair design system após padrões estabilizarem |
| Banco | Supabase Postgres | upgrade de compute/disco, índices, réplicas e pool antes de trocar de banco |
| Auth | Supabase Auth | 50 mil MAU no Free; RLS continua sendo a barreira de tenant |
| Mídia | Supabase Storage atrás de `StorageAdapter` no MVP | Cloudflare R2/Images quando storage ou egress justificar |
| Página pública | Next.js com snapshot publicado e cache | CDN/edge; invalidação por publicação, não por edição |
| Analytics do cliente | eventos append-only, retenção curta e agregados no Postgres | ClickHouse/Tinybird/BigQuery para eventos brutos em volume |
| Analytics do produto | eventos próprios ou PostHog com minimização | manter separado dos números exibidos ao cliente |
| Jobs | outbox no Postgres + worker agendado | fila dedicada quando throughput/retries exigirem |
| E-mail | adapter; Resend é candidato inicial | trocar provedor sem alterar domínio |
| Pagamentos | `PaymentsAdapter`; decisão adiada até spike | provedor brasileiro/Stripe conforme recorrência e conciliação |
| Erros | Sentry antes do piloto externo | traces/amostragem e log drain no plano pago |
| CI/CD | GitHub Actions + previews + staging | proteção de branch e deploy com aprovação em produção |

## Limites entre módulos

- `identity`: usuários, workspaces, memberships e autorização;
- `profiles`: perfis, slugs, temas e configurações;
- `editor`: blocos e estado draft;
- `publishing`: snapshots imutáveis, cache e rollback;
- `analytics`: ingestão, retenção, agregação e consulta;
- `billing`: planos, entitlements, assinatura e webhooks;
- `media`: upload, validação, transformação e remoção;
- `trust`: denúncia, moderação, suspensão e auditoria.

Módulos podem compartilhar o mesmo deploy e banco, mas não devem editar as tabelas uns dos outros sem uma interface de domínio.

## Regras de escala

1. Não consultar blocos editáveis para cada page view; servir snapshot publicado.
2. Não escrever analytics no caminho crítico do clique.
3. Não armazenar imagens como base64 no Postgres.
4. Não manter evento bruto indefinidamente no banco transacional.
5. Não expor `service_role`/secret key ao navegador.
6. Toda tabela de tenant usa `workspace_id`, índices compatíveis e RLS.
7. Webhooks e jobs são idempotentes.
8. Migrações são forward-only e compatíveis com rollback da aplicação.

## Sinais para extrair serviços

- analytics domina CPU/I/O ou retenção passa de dezenas de milhões de eventos;
- renderer precisa de escala e ciclo de deploy independentes;
- processamento de mídia cria filas/latência relevantes;
- jobs exigem garantias que a outbox simples não entrega.

Até esses sinais existirem, manter o monólito reduz custo operacional e acelera o aprendizado.
