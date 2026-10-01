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

## Identidade e tenancy — implementado na Sprint 2

Decisões: `docs/adr/0004-tenancy-and-authorization.md`, `0005-authentication.md`, `0006-database-testing.md`.

```text
Navegador ── proxy.ts (renova sessão, correlation id, /app exige sessão)
   │
   ├─ Server Components / Server Actions / Route Handlers
   │     └─ modules/identity/guard.ts  → requireWorkspaceAccess(identidade, workspaceId, ação)
   │           (membership relida a cada requisição; não membro = 404)
   │
   └─ Supabase (publishable key + cookie do usuário) ── PostgREST ── Postgres
                                                        ├─ RLS por comando + helpers em `private`
                                                        ├─ RPCs estreitas para mutações sensíveis
                                                        └─ triggers: limite de páginas, último owner, slug
```

- **Tabelas:** `user_accounts`, `workspaces` (`personal|agency`), `workspace_memberships` (`owner|admin|editor`), `profiles` (página, draft/published/archived), `plans` + `plan_entitlements`, `reserved_slugs`, `slug_history`, `audit_events`.
- **Autorização em duas camadas:** o servidor decide com a matriz tipada (`modules/identity/permissions.ts`); o banco repete a regra com RLS, grants por coluna e RPCs `security definer` que conferem `auth.uid()` e o papel.
- **Workspace pessoal:** `ensure_personal_workspace()` idempotente, chamado após a verificação de e-mail e pelo layout autenticado (não há trigger em `auth.users`).
- **Entitlements:** `max_profiles` é garantido por trigger com lock do workspace; a aplicação usa `assertEntitlement` e nunca compara nome de plano.
- **Slugs:** normalização idêntica em TypeScript e SQL, unicidade global entre páginas vivas, lista reservada e retenção de 90 dias após troca/exclusão.
- **Módulos:** `identity` (sessão, guard, permissões, ações de auth e workspace), `profiles` (slug, serviço de páginas com portas, repositório Supabase), `entitlements`, `audit` (redação + gravação de eventos de autenticação). Clientes Supabase ficam em `src/lib/supabase/` (`server`, `browser`, `proxy`).
- **Fora da Sprint 2:** snapshots/publicação (entregues na Sprint 3), convites (Sprint 7), cobrança (Sprint 8), purge e exclusão de conta (Sprint 9).

## Publicação e renderer público — implementado na Sprint 3

Decisão: `docs/adr/0007-publishing-and-public-renderer.md`.

```text
Editor (app autenticado) ── Server Actions ── modules/publishing/service.ts (profile.publish)
        │                                        └─ RPCs publish/restore/unpublish (security definer, auditadas)
        │                                               └─ profile_publications (imutável) + profiles.live_publication_id
        └─ revalidatePath(/{slug}, /{slug}/opengraph-image)

Visitante ── CDN/ISR (/[slug], revalidate 60 s) ── get_public_page(slug) [anon, só por slug]
   └─ proxy.ts só para grafias não canônicas (308) ── nunca para páginas canônicas
```

- **Rascunho:** `profiles.title`, `bio`, `avatar_path`, `social_links`, `blocks` (só links na Sprint 3; ver Sprint 4 abaixo) e `draft_revision` (controle otimista). O banco valida formato, esquemas de URL e hosts das redes (`LK040`).
- **Snapshot:** `profile_publications` imutável, versão por página, 10 versões retidas; ponteiro `live_publication_id` com FK composta para a própria página.
- **Estados públicos:** publicada; endereço trocado (307 durante a retenção); suspensa ("indisponível", `noindex`); não publicada e inexistente respondem o mesmo 404.
- **Metadados:** canonical/OG a partir de `NEXT_PUBLIC_APP_URL`; imagem OG gerada por endereço; `robots.txt` sem sitemap.
- **Observabilidade:** `onRequestError`, eventos `public_page.*` e `publishing.*`, Web Vitals em `/api/vitals`.
- **Módulos:** `publishing` (documento, serviço, repositório, cache, renderer, metadados, rota pública); `profiles` ganhou o rascunho de links/redes (`draft-content.ts`). O editor de blocos completo é da Sprint 4.

## Editor por blocos — implementado na Sprint 4

Decisão: `docs/adr/0008-block-model-and-editor.md` (complementa a ADR 0007: documento versão 2 e `rel` com `noreferrer`).

```text
Editor (client) ── estado + reducer (modules/editor/draft) ── autosave (debounce 1 s, fila única, retry)
   │                                                            └─ saveDraftAction → profiles.service.saveDraft
   │                                                                  └─ UPDATE profiles SET title, bio, blocks WHERE draft_revision = esperado (RLS)
   │                                                                        └─ trigger private.validate_profile_draft (LK040)
   └─ prévia = PublicPageView(documentFromDraft(estado)) — mesmo renderer e mesmo mapeamento do snapshot
```

- **Blocos:** `link`, `text`, `social`, `whatsapp`, `divider` em `profiles.blocks`, chaves exatas por tipo; política de URL e regras de campo em `modules/blocks` (fonte TypeScript) espelhadas no SQL e cobertas pela mesma tabela de casos.
- **Rascunho:** título, bio e blocos salvos juntos numa única escrita condicional; conflito tipado; sem evento de auditoria por salvamento (publicação continua auditada). `social_links` deixou de ser gravada (mantida).
- **Snapshot versão 2:** só `blocks` (sem `visible`, sem blocos ocultos nem redes vazias); o renderer lê as versões 1 e 2. `data-block-id`/`data-block-type` ficam no HTML para os cliques da Sprint 6.
- **Módulos:** `blocks` (modelo, validação, URL, WhatsApp, redes), `editor/draft` (reducer, verificação do rascunho, autosave), `editor/components` (UI cliente). `editor/model` segue sendo só do protótipo da Sprint 1.

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
