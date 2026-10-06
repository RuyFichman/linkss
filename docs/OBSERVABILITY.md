# Observabilidade mínima

## Sinais

| Sinal | Fonte inicial | Alerta antes do piloto externo |
|---|---|---|
| disponibilidade | `/api/health` por monitor externo | 2 falhas consecutivas |
| erros de aplicação | Sentry server/client | erro crítico ou aumento sustentado |
| Web Vitals | Vercel/telemetria própria | LCP p75 > 2,5 s; CLS p75 > 0,1 |
| banco | Supabase reports | tamanho/egress/storage ≥ 60% da quota |
| jobs | tabela de execuções + alerta | retry esgotado ou atraso acima do SLA |
| webhooks | auditoria/idempotência | assinatura inválida repetida ou fila atrasada |
| certificados/domínios | job de verificação | expiração/falha de emissão |

## Sinais de autenticação e tenancy (Sprint 2)

Logs JSON (`lib/observability/logger.ts`) com `event`, `outcome`, `errorCode` e `correlationId` (cabeçalho `x-correlation-id`, criado no `proxy.ts`). Nunca incluem e-mail, senha, token, cookie ou IP.

| Evento | Significado | Sinal / limiar proposto antes do piloto |
|---|---|---|
| `auth.sign_up` (`outcome`) | cadastro aceito, rate limit ou indisponível | `unavailable` > 2% em 15 min → P1 (Auth/SMTP) |
| `auth.sign_in` (`outcome`) | login ok, credenciais inválidas, e-mail não confirmado | `invalid-credentials` > 5× a média horária → possível credential stuffing; `unavailable` > 2% → P1 |
| `auth.email_link` (`rejected`) | link expirado/reusado/inválido | aumento súbito → e-mails atrasados ou scanner consumindo links (runbook AUTH_ACCESS) |
| `auth.recovery_requested` | pedidos de recuperação | pico por IP → abuso; ativar CAPTCHA |
| `identity.personal_workspace_failed` | falha ao provisionar workspace pessoal | qualquer ocorrência → P1 (bloqueia onboarding) |
| `profile.*` / `workspace.create_agency` (`outcome`) | comandos de página/conta com resultado (`forbidden`, `not_found`, `limit_reached`…) | `forbidden`/`not_found` em rajada para a mesma sessão → tentativa de acesso entre tenants |
| `audit.write_failed` | evento de auth não gravado | qualquer ocorrência sustentada → P2 |

Métrica de funil (produto): cadastro → e-mail confirmado → primeira página criada. A instrumentação de produto (Sprint 6) deve reutilizar esses eventos sem dados pessoais.

## Sinais do renderer público e da publicação (Sprint 3)

| Evento | Significado | Sinal / limiar proposto antes do piloto |
|---|---|---|
| `web_vital` (`name`, `value`, `rating`, `navigationType`, `route=public_page`) | Web Vitals reais dos visitantes (TTFB, FCP, LCP, CLS, INP) via `/api/vitals` | LCP p75 > 2,5 s ou CLS p75 > 0,1 em 24 h → P2 (investigar deploy/regressão) |
| `public_page.resolved` (`state`, `version`, `durationMs`) | regeneração ISR de uma página (não é por visita) | `durationMs` p95 > 1 s → banco lento |
| `public_page.lookup_failed` (`errorCode`, `durationMs`) | RPC pública falhou ou passou do timeout de 4 s | qualquer sequência > 5 em 5 min → P1 (páginas novas com erro; as em cache seguem no ar) |
| `public_page.invalid_document` | snapshot não passou na validação do renderer | qualquer ocorrência → P1 (bug de contrato do documento) |
| `request.error` (`routePath`, `routeType`, `digest`) | erro capturado pelo Next (`instrumentation.ts`); o Next pode chamar o hook mais de uma vez por erro — deduplicar por `digest` | aumento sustentado → P2; em `/[slug]` junto com `lookup_failed` → P1 |
| `publishing.publish` / `.restore` / `.unpublish` (`outcome`, `version`, `durationMs`) | comandos de publicação | `unavailable` > 2% em 15 min → P1; `not_found`/`forbidden` em rajada para a mesma sessão → tentativa entre tenants |

Cabeçalho `x-nextjs-cache` (`HIT`/`STALE`/`MISS`) mostra o comportamento do cache em produção. Runbook: `docs/runbooks/PUBLIC_PAGE.md`.

## Sinais do editor e do autosave (Sprint 4)

Os eventos carregam só resultado, duração e correlation id — nunca conteúdo de bloco, URLs, telefones ou e-mails.

| Evento | Significado | Sinal / limiar proposto antes do piloto |
|---|---|---|
| `editor.save` (`outcome`: `ok`, `conflict`, `validation`, `forbidden`, `not_found`, `unauthenticated`, `unavailable`; `durationMs`) | um salvamento do autosave (um por pausa de ~1 s na digitação ou por ação estrutural) | `unavailable` > 2% em 15 min → P1 (as pessoas veem "Não foi possível salvar"); `durationMs` p95 > 1,5 s → P2; `validation` recorrente → bug de divergência entre UI e banco ou payload forjado (P2, olhar com `editor.save` + sessão); `conflict` em alta → muitas edições simultâneas (produto, não incidente) |
| `editor.load_latest` (`outcome`) | "Carregar a versão mais recente" / "Manter as minhas alterações" leram o rascunho atual | falhas repetidas → P2 |

Falhas de rede no navegador (servidor inacessível) não geram log no servidor: o editor mostra "Sem resposta do servidor. Tentando salvar de novo…" e depois "Não foi possível salvar", mantendo a cópia local. Runbook: `docs/runbooks/EDITOR.md`.

## Sinais de mídia e formulários (Sprint 5)

Os eventos carregam resultado, tamanhos, duração e correlation id — nunca nome ou conteúdo de arquivo, chave Pix ou dados de lead.

| Evento | Significado | Sinal / limiar proposto antes do piloto |
|---|---|---|
| `media.upload` (`outcome`: `ok`, um motivo de recusa — `unsupported`, `too_large`, `animated`, `too_many_pixels`, `too_small`, `bad_aspect`, `undecodable`, `empty` —, `quota`, `rate_limited`, `forbidden`, `not_found`, `unauthenticated`, `unavailable`; `kind`, `receivedBytes`, `storedBytes`, `durationMs`) | um upload recebido em `POST /api/media` | `unavailable` > 2% em 15 min → P1 (Storage fora, segredo de assinatura ausente ou divergente: runbook MEDIA §3); `durationMs` p95 > 3 s → P2; recusas de formato em rajada da mesma sessão → requisições forjadas; `quota` recorrente → conversar sobre plano, não é incidente |
| `media.cleanup` (`outcome`: `ok`, `partial`, `not_configured`, `unauthorized`, `unavailable`; `claimed`, `removedObjects`, `finished`, `failed`) | uma execução do job de limpeza | nenhuma execução `ok` em 48 h → P2 (órfãos acumulam e a cota do projeto enche); `failed` > 0 em duas execuções seguidas → P2; `unauthorized` → alguém chamando a rota sem o segredo |
| `lead.submit` (`outcome`: `ok`, `invalid`, `consent_required`, `rate_limited`, `unavailable`; `hashed`, `durationMs`) | um envio de formulário público | `unavailable` > 2% em 15 min → P1 (clientes perdendo contatos: runbook LEADS §1); `rate_limited` em alta → spam em curso (LEADS §2); `hashed=false` em produção → `VISITOR_HASH_SALT` ausente ou proxy sem IP |
| `lead.delete` / `lead.export` (`outcome`, `count`) | dono apagou ou exportou leads (também em `audit_events`) | `forbidden`/`not_found` em rajada para a mesma sessão → tentativa entre tenants |

Envios bloqueados pelo honeypot respondem `ok` e não são distinguidos no log de propósito (o robô não aprende nada); o volume de spam aparece em `rate_limited`. Capacidade: acompanhar o uso do bucket `media` e o egress no painel do Supabase (limiar de 60% em `docs/SUPABASE_CAPACITY.md`).

## Sinais de analytics do cliente (Sprint 6)

Os eventos carregam resultado e contagens — nunca o payload, o hash do visitante, o referrer, o IP ou o user agent. Owner de todos: founder técnico. Runbook: `docs/runbooks/ANALYTICS.md`.

| Evento | Significado | Sinal / limiar proposto antes do piloto |
|---|---|---|
| `analytics.ingest` com `outcome=ok` (`events`, `accepted`, `duplicate`, `repeat`, `rejected`, `rateLimited`, `hashed`, `durationMs`) | um lote recebido em `POST /api/events` e gravado depois da resposta | `rateLimited` > 20% dos eventos em 15 min → flood numa página ou num endereço (P2, runbook §2); `rejected` em alta logo depois de um deploy → coletor e banco fora de sincronia (P2); `durationMs` p95 > 1 s → banco lento (P2); `hashed=false` em produção → `VISITOR_HASH_SALT` ausente ou proxy sem IP (P2: sem deduplicação de visitas) |
| `analytics.ingest` com `outcome=unavailable` | o banco não respondeu em 2 s ou falhou; o lote foi perdido | > 2% em 15 min → P2 (números ficam abaixo do real; a página pública não é afetada) |
| `analytics.ingest` com `outcome=shedding` | a tabela bruta atingiu o teto de capacidade e **todos** os eventos estão sendo descartados | qualquer ocorrência → P1 (runbook §3) |
| `analytics.ingest` com `outcome=not_configured` / `not_deployed` / `forbidden` | segredo de assinatura ausente; migração não aplicada; segredo diferente entre servidor e Vault | sustentado depois do deploy da Sprint 6 → P1 (nada está sendo contado; runbook §1) |
| `analytics.ingest` com `outcome=automated`, `signed_in`, `app_referrer`, `cross_site`, `invalid`, `empty` | lote descartado antes do banco (robô, pessoa com sessão, visita vinda do app, outra origem, malformado) | informativo; `invalid` ou `cross_site` em rajada → alguém sondando a rota |
| `analytics.maintenance` (`outcome`: `ok`, `partial`, `not_configured`, `unauthorized`, `not_deployed`, `invalid`, `unavailable`; `aggregatedDays`, `aggregateRows`, `purgedEvents`, `pendingDays`, `lastFinalDay`) | uma execução do job diário | nenhuma execução `ok` em 36 h → P2 (o painel avisa "consolidação atrasada"; o bruto cresce); `partial` em dois dias seguidos → backlog (rodar à mão); `purgedEvents = 50000` em dias seguidos → o bruto cresce mais rápido que o purge (P2, capacidade); `unauthorized` → alguém chamando a rota sem o segredo |
| `analytics.export` (`outcome`, `rows`) | exportação CSV (também em `audit_events`) | `not_found`/`forbidden` em rajada para a mesma sessão → tentativa entre tenants |

Atraso de agregação: `lastFinalDay` deve ser o dia anterior depois da execução da madrugada. Capacidade: tamanho de `analytics_events` no painel do Supabase (limiares em `docs/SUPABASE_CAPACITY.md`).

## Sinais de páginas, convites e membros (Sprint 7, parte 1)

Logs estruturados com `correlationId` e `outcome`. **Nunca** contêm e-mail, token, caminho de convite nem conteúdo de página.

| Evento | Quando | `outcome` | O que observar |
|---|---|---|---|
| `profile.archive`, `profile.unarchive` | Arquivar e desarquivar | `ok`, `forbidden`, `not_found`, `not_deployed`, `unavailable` | `forbidden` repetido da mesma conta: interface desatualizada ou tentativa direta |
| `profile.duplicate` | Duplicar | os mesmos, mais `limit_reached`, `slug_taken`, `content_invalid`, `validation` | `content_invalid`: a origem tem bloco que o validador recusa |
| `members.invite` | Criar convite | `ok`, `invalid_email`, `already_member`, `rate_limited`, `limit_reached`, `forbidden`, `not_found`, `not_deployed`, `unavailable` | `rate_limited`: possível abuso; ver runbook de acesso |
| `members.revoke_invitation`, `members.change_role`, `members.remove` | Gestão de membros | `ok`, `left` (a pessoa saiu), `last_owner`, `forbidden`, `not_found`, `unavailable` | `last_owner`: a conta ficaria sem proprietário |
| `members.accept_invitation` | Aceitar convite | `accepted`, `invalid`, `wrong_account`, `already_member`, `limit_reached`, `unavailable` | Pico de `invalid`: links vencidos em circulação ou varredura; pico de `wrong_account`: pessoas entrando com outro e-mail |

Sem alerta novo nesta parte: nenhum desses sinais exige ação imediata. `not_deployed` em produção significa migração da Sprint 7 não aplicada.

## Regras

- Logs estruturados incluem request/correlation ID, módulo, ambiente e resultado.
- Tokens, secrets, senhas, payloads completos de lead e cartão nunca entram em logs.
- Alertas precisam de owner, severidade, runbook e ação esperada.
- Métricas exibidas ao cliente têm reconciliação separada da telemetria interna.
- Sampling só pode reduzir volume depois de preservar erros e eventos de segurança.

## Provisionamento pendente

O health endpoint está implementado. Sentry, uptime monitor e dashboards dependem das contas/credenciais dos ambientes e devem ser provisionados antes da Sprint 10. Até lá, os nomes de variáveis já estão documentados em `.env.example`.
