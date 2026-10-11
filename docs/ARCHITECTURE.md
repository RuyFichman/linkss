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
| Pagamentos | Stripe atrás do `PaymentsAdapter` (ADR 0014), por `fetch`, sem SDK | trocar de provedor é reescrever um arquivo; Pix recorrente exigiria outro provedor |
| Erros | Sentry antes do piloto externo | traces/amostragem e log drain no plano pago |
| CI/CD | GitHub Actions + previews + staging | proteção de branch e deploy com aprovação em produção |

## Limites entre módulos

- `identity`: usuários, workspaces, memberships e autorização;
- `profiles`: perfis, slugs, temas e configurações;
- `editor`: blocos e estado draft;
- `publishing`: snapshots imutáveis, cache e rollback;
- `analytics`: ingestão, retenção, agregação e consulta (Sprint 6);
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
- **Módulos:** `blocks` (modelo, validação, URL, WhatsApp, redes), `editor/draft` (reducer, verificação do rascunho, autosave), `editor/components` (UI cliente). `editor/model` e `editor/templates` seguem sendo só do protótipo da Sprint 1.

- **Interface mobile (UX-085, 09/10/2026):** a prévia e o formulário alternam a visibilidade sem desmontar o formulário. O ajuste ao teclado é restrito ao editor e não muda o viewport das demais rotas. Nenhuma alteração no reducer, persistência, autenticação ou renderer; revisão em `docs/ux/MOBILE_EDITOR_REVIEW.md`.

## Mídia, tema e novos blocos — implementado na Sprint 5

Decisões: `docs/adr/0009-media-and-storage-adapter.md` e `docs/adr/0010-themes-templates-and-new-blocks.md`.

```text
Editor ── recorte e redução no navegador ── POST /api/media (sessão do usuário, mesma origem)
   │         └─ modules/media: política por bytes → sharp (decodifica, remove metadados, variantes WebP)
   │               ├─ register_media_asset (assinatura HMAC do servidor, cota, limite por hora)  → media_assets (pending)
   │               ├─ StorageAdapter.put (Storage como o usuário; policy: só variantes de um asset pending do próprio usuário)
   │               └─ activate_media_asset (assinatura; objetos conferidos)                       → ready
   └─ rascunho: avatar_path, theme e blocos no mesmo UPDATE condicional (draft_revision)

Visitante ── /[slug] (HTML estático do snapshot) ── <img srcset> direto do bucket público
   └─ formulário: Server Action → submit_form_lead (anon, security definer) → form_leads

Vercel Cron diário ── GET /api/jobs/media-cleanup (CRON_SECRET) ── claim_media_cleanup → StorageAdapter.remove → finish_media_cleanup
```

- **Mídia:** `media_assets` (uma linha por imagem; o id é o prefixo da chave no bucket `media`). O banco só registra o que o servidor assinou; upload direto ao Storage com sessão válida é recusado pela policy. Rascunho e snapshot guardam só o id e as dimensões; a URL é montada na renderização (`modules/media/url.ts`).
- **Ciclo de vida:** uma imagem vive enquanto o rascunho ou uma publicação retida da página a referencia (`private.media_is_referenced`, calculado dos documentos). Órfãos saem pelo job de limpeza; a cota (`storage_mb`) conta só o que está em uso ou tem menos de 24 h.
- **Blocos:** `image`, `embed` (provedor + id; YouTube sem cookies, Vimeo, Spotify; iframe só depois do clique), `pix` (chave validada + botão copiar, link de pagamento opcional) e `form` (campos fixos).
- **Tema:** tokens fechados em `profiles.theme` (`null` = aparência clássica); cores de texto derivadas por contraste em `modules/themes/resolve.ts`; cinco templates em `modules/themes/templates.ts`.
- **Snapshot:** continua na versão 2, só com acréscimos (tema opcional, tipos novos, avatar). Snapshots anteriores renderizam como antes.
- **Leads:** `form_leads` e `form_submission_hits`; envio anônimo validado contra a publicação no ar; leitura por membros, exclusão e exportação auditadas.
- **Módulos:** `media` (política, processamento, atestação, adapter, serviço, limpeza), `themes`, `leads`; `blocks`, `publishing` e `editor` estendidos.

## Analytics do cliente — implementado na Sprint 6

Decisão: `docs/adr/0011-customer-analytics.md`.

```text
Visitante ── /[slug] (HTML estático) ── coletor (só nesta rota; cliques por delegação passiva em data-block-id)
   └─ sendBeacon / fetch keepalive ── POST /api/events ── 204 imediato
                                          └─ after(): filtra robôs e sessão do produto, deriva origem/aparelho/país,
                                             calcula os hashes diários, assina o lote (HMAC)
                                                └─ ingest_analytics_events (anon, security definer; assinatura conferida com o Vault)
                                                      └─ analytics_events (bruto, 7 dias)   analytics_rate_hits (contadores por endereço, sem página)

Formulário ── submit_form_lead ── grava o lead e o evento form_submit na mesma transação

Vercel Cron diário ── GET /api/jobs/analytics (CRON_SECRET) ── run_analytics_maintenance
   └─ agrega os dias ainda não fechados em analytics_daily, fecha os dias encerrados, apaga o bruto com mais de 7 dias

Dono ── /app/w/…/paginas/…/resultados ── get_profile_analytics (membro; aplica o entitlement analytics_days)
   └─ dias fechados vêm de analytics_daily; os ainda abertos (em geral só hoje) são contados do bruto daquela página
```

- **Fora do caminho do visitante:** nenhum link passa pelo produto, nada é aguardado antes da navegação e o coletor nunca chama `preventDefault`. A rota de ingestão responde 204 antes de falar com o banco. A página pública continua estática.
- **Contrato:** nove tipos de evento fechados (`modules/analytics/contract.ts` e o enum `analytics_event_type`). `form_submit` só é criado pelo banco. Nenhum texto livre é guardado: tipos, origem e aparelho são enumerações, o país tem duas letras e os valores de UTM seguem um padrão restrito.
- **Autoridade do banco:** a página tem de estar publicada e ativa, o bloco tem de existir na publicação no ar com o tipo certo, o id do evento só é guardado uma vez por página e os limites são contados em eventos guardados.
- **Limites:** 60 eventos por endereço por página a cada 10 minutos; 200 por janela e 2.000 por dia por endereço em todas as páginas; 2.000 por página por hora; e a ingestão descarta tudo enquanto a tabela bruta estiver com cerca de 500 mil eventos.
- **Tabelas:** `analytics_events`, `analytics_daily` (uma linha por página, dia, dimensão, chave e tipo), `analytics_day_status` (marca d'água da agregação), `analytics_rate_hits` e `analytics_settings` (fuso de relatório, início da contagem e teto de capacidade). Nenhum papel de cliente lê ou escreve nessas tabelas: tudo passa por funções.
- **Fuso:** `America/Sao_Paulo`, guardado em `analytics_settings`; o dia do evento é decidido na gravação.
- **Módulo:** `analytics` (contrato, origem, aparelho e robôs, datas, hashes, atestação, ingestão, coletor, estados e cálculos do painel, CSV, serviço e repositórios).
- **Sprint 7 (implementado, ADR 0013):** o painel consolidado lê `get_workspace_analytics`, que soma `analytics_daily` por `workspace_id` e dia; o link de relatório lê `get_shared_report`, que chama o mesmo núcleo privado do painel da página (`private.profile_analytics`). Detalhes na seção "Painel consolidado e links de relatório".

## Operação de várias páginas, convites e papéis — implementado na Sprint 7, parte 1

Decisões em `docs/adr/0012-multi-page-operations-invitations-and-roles.md`. Verificado no stack local; nada aplicado em staging.

| Peça | Onde | Observação |
|---|---|---|
| Lista de páginas | `list_workspace_profiles` (SQL, `security invoker`) + `modules/profiles/page-list*.ts` + `/app/w/[workspaceId]` | Uma consulta por renderização, qualquer que seja o número de páginas: totais, contagem por situação e a página de itens com estado de publicação. Busca, filtro, ordem e paginação ficam na URL |
| Arquivar / desarquivar | `archive_profile`, `unarchive_profile` + `modules/profiles/{service,actions}.ts` | Arquivar tira do ar na mesma transação e invalida o cache público pelo caminho existente; `/[slug]` continua estático. Rascunho de página arquivada é congelado por RLS |
| Duplicar | `duplicate_profile` + `/app/w/[workspaceId]/paginas/[profileId]/duplicar` | Uma transação; mesma conta; ids de bloco novos; passa pelo gatilho de `max_profiles` e pelo validador de rascunho |
| Imagens compartilhadas | `media_asset_shares`, `private.media_page_references`, `private.media_is_referenced`, `claim_media_cleanup` | A cópia recebe permissão de usar as imagens da origem; a referência continua calculada dos documentos; a limpeza transfere a imagem para a página que ainda a usa quando a dona é expurgada |
| Convites | `workspace_invitations` + RPCs `create_`, `revoke_`, `get_`, `accept_workspace_invitation` + `modules/identity/{invitations,invitation-token,members-service,members-server,member-actions}.ts` | Token de 256 bits mostrado uma vez; só o hash guardado; aceitação exige e-mail confirmado igual ao convidado; pendentes contam como lugar |
| Membros | `list_workspace_members` + `/app/w/[workspaceId]/membros` | Interface para `change_member_role` e `remove_workspace_member`, que existiam desde a Sprint 2 |
| Aceite | `/app/convite/[token]` | Sob `/app`: o proxy leva quem não tem sessão ao login com `next`; nenhuma rota nova na raiz, nada novo em `reserved_slugs` |

Regras que este módulo acrescenta:

1. **A conta de uma ação é a da URL da requisição.** Nenhuma ação lê a conta de cookie, cabeçalho ou "última usada". Ids de página, participação e convite são resolvidos no banco e comparados com a conta da URL.
2. **A matriz de papéis continua em dois lugares** (`modules/identity/permissions.ts` e RPCs/RLS), com Vitest e pgTAP dos dois lados. As ações novas: `profile.archive`, `profile.duplicate`, `members.invite`, `invitations.view`, `invitations.revoke`.
3. **Pendente de convite existe só em `workspace_invitations`.** A participação nasce `active` na aceitação.
4. **Antes da migração** (a `main` chega ao staging primeiro): a lista cai na consulta antiga, sem busca; arquivar, duplicar e membros respondem "ainda não disponível"; o link de convite mostra o estado genérico.

Para a parte 2 (painel consolidado e link de relatório): páginas arquivadas mantêm agregados e `profile_id`; a cópia começa sem histórico; `list_workspace_profiles` já devolve o que a tabela de páginas do consolidado precisa de cada página, menos os números.

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

## Painel consolidado e links de relatório — implementado na Sprint 7, parte 2

Decisões em `docs/adr/0013-consolidated-analytics-and-report-links.md`. Verificado no stack local.

- **Uma definição de cada número.** `get_profile_analytics` manteve assinatura e resposta e passou a delegar para `private.profile_analytics`; o relatório compartilhado chama o mesmo núcleo. Na aplicação, o consolidado (`modules/analytics/workspace.ts`) e o relatório (`modules/reports/shared-report.ts`) usam as funções de `modules/analytics/dashboard.ts` e `dates.ts`. Não há segundo funil nem segundo cálculo de datas.
- **Consolidado:** `get_workspace_analytics(conta, de, até)` devolve, numa chamada, os totais por dia, as origens somadas e uma linha por página (até 200). Dias fechados vêm de `analytics_daily` pelo índice `(workspace_id, day)`; dias ainda abertos vêm dos eventos brutos da conta (`private.analytics_workspace_counts`, índice `(workspace_id, profile_id, occurred_at)`). Páginas excluídas ficam de fora de tudo; página fora do ar e sem eventos no período não vira linha, só entra na contagem de omitidas. Três requisições ao PostgREST por tela, com 1, 10 ou 50 páginas.
- **Links de relatório:** tabela `report_links` (conta, página, hash do token, período de 7, 30 ou 90 dias completos, validade obrigatória de até 90 dias, anotação opcional, quem criou e quem cancelou). RLS: proprietário e administrador leem; ninguém lê `token_hash`; escrita só pelas RPCs `create_report_link` e `revoke_report_link`.
- **Leitura anônima:** `get_shared_report(token, cliente)` é `security definer`, com `search_path` vazio, concedida a `anon`. Devolve `{"status":"unavailable"}` ou a lista fechada de campos do ADR 0013 (nome da conta, nome e endereço públicos da página, período, série diária, origens e blocos com o título publicado). Nenhum identificador, nada do rascunho, nenhum valor de UTM.
- **Rota `/r/[token]`:** dinâmica, lida a cada requisição (sem ISR), sem sessão e sem cookie, com `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer` e `X-Robots-Tag: noindex` aplicados pelo `next.config.ts` também ao 404. Todo token que não abre relatório recebe o mesmo 404. A rota não monta o coletor de visitas.
- **Tentativas:** `report_lookup_failures` guarda um hash diário do endereço (nunca o endereço) por 24 horas; 20 falhas em 10 minutos bloqueiam aquele cliente. É redutor de custo, não fronteira de segurança.
- **Módulos:** `analytics` (consolidado) e `reports` (regras dos links, token, serviço, leitura pública, componentes).
- **Fora desta sprint:** envio de relatório por e-mail, PDF no servidor, relatório de várias páginas, limite global na frente de `/r/` (Sprint 9), expurgo agendado de links terminados (Sprint 9).

## Planos, assinatura e cobrança — implementado na Sprint 8, parte 1

Decisões em `docs/adr/0014-payments-subscriptions-and-webhooks.md`. Verificado no stack local, contra um emulador local da API da Stripe; **nada rodou contra a Stripe** (não existe conta).

```text
Proprietário ── /app/w/…/plano ── Server Action ── modules/billing/service (billing.manage)
   │                                   ├─ begin_billing_checkout / begin_billing_change (RPC: papel, estado, auditoria)
   │                                   ├─ PaymentsAdapter (Stripe): cliente, checkout hospedado, cancelar, mudar plano
   │                                   └─ lê a Stripe de novo ─► snapshot assinado ─► apply_billing_snapshot
   └─ checkout na página da Stripe ── volta para …/plano/retorno (mostra o que o banco diz; não concede nada)

Stripe ── POST /api/billing/webhook ── assinatura sobre o corpo bruto ── "olhe de novo":
              lê a assinatura atual na Stripe ─► snapshot assinado (HMAC, segredo no Vault) ─► apply_billing_snapshot
                                                     └─ ledger por id do evento ─► billing_subscriptions ─► billing_sync_plan ─► workspaces.plan_id

Vercel Cron diário ── GET /api/jobs/billing (CRON_SECRET) ── run_billing_maintenance
   └─ encerra prazos vencidos, aplica plano menor ao fim do período pago, expurga o ledger, relê na Stripe o que não foi lido há um dia
```

- **Um só caminho até o plano.** `private.billing_sync_plan` é o único comando que escreve `workspaces.plan_id`. Ele só é alcançado por um retrato do estado do provedor que o servidor assinou; nenhum papel de cliente escreve cliente, assinatura, evento, fatura ou plano.
- **O webhook é só um aviso.** O conteúdo do evento não decide nada: o servidor lê a assinatura na Stripe e grava o que ela diz agora. Entrega repetida para no ledger (id do evento); leitura mais antiga que a guardada é descartada.
- **O plano vem do valor cobrado.** `plan_prices` é única por (intervalo, valor, moeda); o valor que a Stripe informa identifica o plano. O catálogo em `modules/billing/catalog.ts` (derivado de `lib/product.ts`) é o que vai para a Stripe; um teste de divergência compara os dois.
- **Estados:** sem assinatura, `incomplete`, `active`, `past_due` (com `grace_until`), `ended`. A máquina de estados existe em TypeScript (`subscription.ts`, para as telas) e em SQL (a verdade), com os mesmos casos nos dois testes.
- **Tabelas:** `plan_prices`, `billing_customers`, `billing_subscriptions`, `billing_events` (ledger, sem policy), `billing_invoices`. RLS: proprietário e administrador leem a assinatura; só o proprietário lê pagamentos e o cliente do provedor.
- **Modo de cobrança** (`BILLING_MODE`): `off` (padrão: o produto se comporta como antes), `sandbox` (chave de teste; telas marcadas) e `live` (chave live). Chave que não combina com o modo desliga a cobrança.
- **Selo:** `remove_badge` é lido a cada requisição; quando o plano muda, o banco devolve os endereços das páginas no ar e o servidor invalida o cache delas (o limite, sem isso, é a janela de 60 s do ISR).
- **Módulo:** `billing` (catálogo, máquina de estados, impacto do rebaixamento, modo, adapter + Stripe + fake, atestação, serviço, leitura, apresentação, ações, componentes; `testing/` com o emulador e o ledger em memória, nunca importados pela aplicação).
- **Fora desta parte:** domínio próprio e pixels (parte 2), cobrança real, nota fiscal, e-mails de cobrança, troca mensal↔anual numa assinatura em curso, limite global na frente do webhook (Sprint 9).

## Domínio próprio e pixels — implementado na Sprint 8, parte 2

Decisões em `docs/adr/0016-custom-domains.md` e `docs/adr/0017-pixels-and-consent.md`. Verificado só no stack local (pgTAP, Vitest e `apps/web/scripts/domains-lifecycle.mjs`, contra um resolvedor DNS de teste e um emulador da API da Vercel). **Nada rodou contra a API da Vercel, com um domínio real, nem contra a Meta ou o Google.**

```text
dono da página ── registra o domínio ─► profile_domains (pending, desafio aleatório)
               ── publica TXT em _linkfav.<domínio>
               ── "Verificar" ─► servidor lê o TXT (resolvedores públicos)
                                 ├─ desafio presente ─► DomainsAdapter.ensure (Vercel: anexa ao projeto, lê o roteamento)
                                 └─ assina {domínio, desafios encontrados, roteamento} (HMAC, segredo no Vault)
                                        ─► confirm_profile_domain ─► active | dns_missing | in_use
                                                                     └─ outra página ativa sem prova no DNS ─► lapsed

visitante ── https://<domínio>/ ── rewrite por Host (next.config.ts) ─► /d/<domínio> (ISR)
                                     └─ get_public_page_by_domain ─► linha ativa + plano com custom_domain ─► get_public_page
           ── qualquer outro caminho no domínio ─► 404 (só /_next, /api/events, /api/vitals e o ícone passam)

página pública ── get_public_page.pixels (só com tracking_pixels no plano) ─► aviso de consentimento
                    └─ "Aceitar" ─► carregador do produto ─► fbevents.js / gtag.js (um page view para cada)
```

- **Um domínio por página**, em `profile_domains` (fora do snapshot e fora de `profiles`: a duplicação não copia). Uma página no domínio do produto continua funcionando; o canônico passa a ser o domínio próprio nos dois endereços.
- **Prova de controle por TXT, lida pelo servidor e atestada ao banco.** Registrar não prova nem reserva nada (linhas `pending` não são únicas). Só `confirm_profile_domain`, com assinatura do servidor, torna uma linha `active`; há no máximo uma linha ativa por domínio (índice único parcial).
- **Quem controla o DNS hoje decide.** Uma nova prova só toma um domínio ativo quando o desafio da página anterior não está mais no DNS; aí a linha anterior vira `lapsed` na mesma transação, com auditoria.
- **Roteamento por Host em `next.config.ts`** (`modules/domains/routing.ts`): todo Host que não é do produto (o de `NEXT_PUBLIC_APP_URL` com e sem `www`, `*.vercel.app`, loopback) é domínio próprio. A regra geral vem antes da regra da raiz, porque o Next aplica as regras seguintes sobre o caminho já reescrito. **Um novo endereço do produto precisa ser o host de `NEXT_PUBLIC_APP_URL`**, senão é tratado como domínio de cliente e responde 404.
- **O domínio serve a página e nada mais:** login, app, relatórios, API e outras páginas não respondem num domínio de cliente.
- **Entitlement lido a cada leitura.** `get_public_page_by_domain` exige `custom_domain` no plano; `get_public_page` só devolve `pixels` com `tracking_pixels`. Perder o plano não apaga nada: desliga, e volta com o plano.
- **Cache:** `revalidatePublicPage(slug)` também derruba todas as cópias de `/d/[host]` (ele não conhece o domínio da página). Cada cópia derrubada custa uma leitura no banco na visita seguinte. **Sinal para estreitar:** volume de publicações em que essas regenerações apareçam no p95 do banco ou no custo de função.
- **`DomainsAdapter`** (`ensure`, `inspect`, `detach`) com implementação da Vercel por `fetch` e um fake. O provedor emite o certificado; a aplicação não pede nem guarda certificado. Sem as variáveis do provedor a prova continua valendo e a tela diz que a ativação automática não está disponível.
- **Pixels são identificadores**, nunca scripts: Meta Pixel (10 a 20 dígitos) e Google Analytics 4 (`G-…`). Tag Manager é recusado. O carregador é do produto e só roda depois do aceite do visitante, por página.
- **CSP por rota:** as origens da Meta e do Google só são permitidas em `/[slug]` (padrão que exclui as rotas reservadas) e na raiz de um domínio próprio. O resto do produto mantém a política base.
- **Papéis:** todos os membros veem; proprietário e administrador alteram (`domains.manage`, `pixels.manage`).
- **Módulos:** `domains` (hostname, DNS, adapter + Vercel + fake, configuração, roteamento, serviço, ações, componentes) e `pixels` (modelo, serviço, carregador, ações, componentes). `publishing/render/published-page.tsx` é o que as duas rotas públicas renderizam; o coletor de analytics continua montado só pelas rotas.
- **Fora desta parte:** reverificação agendada, redirecionamento do endereço do produto para o domínio, eventos de conversão nos pixels, registro de consentimento, domínios e pixels na exportação da conta.

## Sprint 9, continuação: limites, CAPTCHA, expurgo e exclusão de conta (ADR 0018)

Verificado só no stack local; nada aplicado em produção.

```text
Visitante ── firewall da Vercel (uma regra de taxa por IP; painel, fora do repositório)
          └─ rota pública ── contador por instância (lib/security/rate-limit.ts) ── limites do banco (por página e visitante)

Formulário de acesso ── CaptchaField (Turnstile, só com NEXT_PUBLIC_TURNSTILE_SITE_KEY) ── Server Action ── Supabase Auth confere o token

Vercel Cron diário 06:00 ── GET /api/jobs/media-cleanup ── remove imagens órfãs e as de páginas vencidas
Vercel Cron diário 07:00 ── GET /api/jobs/retention (CRON_SECRET) ── run_retention_maintenance
                            (prazos vencidos; páginas e contas excluídas há mais de 30 dias, já sem imagens)

Administrador da plataforma ── /app/administracao/privacidade ── eraseAccount (modules/privacy/erasure.ts)
   1. begin_account_erasure   páginas fora do ar e marcadas para expurgo imediato; devolve endereços e domínios
   2. servidor                invalida o cache, desanexa domínios (DomainsAdapter), roda a limpeza de mídia
   3. finish_account_erasure  uma transação: contas da pessoa, convites e lista de espera do e-mail, auth.users; fecha o pedido
```

Invariantes: o contador por instância não é um limite global; a página pública não passa por ele (ficaria fora do cache); uma página só é apagada depois das imagens dela (`media_assets` é `ON DELETE RESTRICT`); a exclusão de conta nunca é automática e cada etapa pode ser repetida.
