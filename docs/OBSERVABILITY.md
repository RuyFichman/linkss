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

## Sinais do painel consolidado e dos links de relatório (Sprint 7, parte 2)

| Evento | Campos | Leitura |
|---|---|---|
| `report.read` | `outcome` (`ok`, `unavailable`, `error`), `errorCode` | Leituras do relatório público. `unavailable` é qualquer link que não abre relatório (não se distingue o motivo, de propósito). `error` é o banco sem responder: página 404 genérica para quem abriu, **ação nossa** |
| `reports.create_link`, `reports.revoke_link` | `outcome` | Gestão de links. `not_in_plan` e `too_many_active` são esperados; `not_deployed` em produção é migração não aplicada |
| `analytics.workspace_export` | `outcome`, `rows` | Exportação do consolidado |

Nenhuma linha contém token, caminho de relatório, endereço ou anotação do link. Tentativas em massa aparecem como muitos `report.read` com `unavailable` em pouco tempo e como linhas em `report_lookup_failures` (`select count(*) from public.report_lookup_failures where created_at > now() - interval '10 minutes'`).

Limiares propostos (sem alerta automático até o provisionamento): `report.read` com `error` acima de 1% em 15 minutos → runbook `REPORTS.md`, item 1; mais de 1.000 `unavailable` em 10 minutos → runbook, item 4. Dono: founder; severidade: média (o relatório fica indisponível, as páginas públicas não são afetadas).

## Provisionamento pendente

O health endpoint está implementado. Desde 11/10/2026 existe um monitor externo sem fornecedor novo (seção "Monitor externo e alertas" abaixo), que cobre disponibilidade, jobs, cobrança e filas. Sentry (ou equivalente) e dashboards, necessários para taxa de erro e latência, continuam dependendo de contas e credenciais e de uma decisão do founder. Até lá, os nomes de variáveis já estão documentados em `.env.example`.

## Sinais de cobrança (Sprint 8, parte 1)

Os eventos carregam tópico, desfecho e contagens — nunca o conteúdo de um evento do provedor, uma assinatura, um id do provedor, um valor, um e-mail ou um documento. Owner de todos: founder técnico. Runbook: `docs/runbooks/BILLING.md`. Limiares propostos; sem alerta automático até o provisionamento (Sentry / log drain).

| Evento | Significado | Sinal / limiar proposto e ação |
|---|---|---|
| `billing.webhook` com `outcome` em `applied`, `unchanged`, `duplicate`, `ignored`, `stale` (`topic`, `planChanged`, `durationMs`) | uma entrega processada | informativo. `durationMs` p95 > 5 s → a Stripe pode desistir da entrega (P2: provedor ou banco lentos) |
| `billing.webhook` com `bad_signature`, `missing_signature`, `stale_timestamp`, `too_large`, `malformed` (400) | entrega recusada antes de ler qualquer coisa | `bad_signature` > 3 em 15 min → o segredo do endpoint não é o configurado (P1 se as entregas reais estiverem falhando: runbook §2 e §4). Os demais em rajada → alguém sondando a rota (P3) |
| `billing.webhook` com `unavailable`, `forbidden`, `not_configured`, `not_deployed`, `billing_off` (503) | nada foi gravado; a Stripe vai repetir | qualquer um sustentado por 15 min com cobrança ligada → P1 (clientes pagam e o plano não muda: runbook §2) |
| `billing.webhook` com `price_mismatch`, `conflict`, `customer_mismatch` (nível `error`) | cobrança fora do catálogo; segunda assinatura paga; cliente de outra conta | **cada ocorrência** → P1, ação humana: `conflict` exige reembolso manual (runbook §3); `price_mismatch` exige corrigir o preço na Stripe |
| `billing.webhook` com `topic=dispute` ou `topic=refund` (nível `warn`) | contestação (o plano já caiu) ou reembolso (o plano não muda sozinho) | cada ocorrência → P2: responder à contestação; conferir se o reembolso veio com o cancelamento |
| `billing.webhook` com `unknown_customer`, `expired`, `invalid` | evento de cliente que não é nosso; retrato fora da janela; formato inesperado | `invalid` → P2: o adapter e o banco discordam do formato (mudança de API?) |
| `billing.maintenance` (`outcome`: `ok`, `partial`, `not_configured`, `unauthorized`, `not_deployed`, `unavailable`; `graceExpired`, `holdsReleased`, `planChanges`, `purgedEvents`, `checked`, `corrected`, `failed`, `pending`) | uma execução do job diário | nenhuma execução `ok` em 36 h → P2 (prazos não vencem, cópias não são conferidas); **`corrected` > 0** → um webhook se perdeu (P2: runbook §2); `failed` > 0 em dois dias seguidos → P2; `pending` > 0 sustentado → mais de 50 assinaturas por dia para reler: aumentar o limite; `graceExpired` > 0 → contas perderam o plano hoje (acompanhar, não é incidente) |
| `billing.checkout`, `billing.cancel`, `billing.resume`, `billing.change_plan`, `billing.self_service` (`outcome`) | ações do proprietário | `provider_unavailable` ou `provider_rejected` > 2% em 15 min → P1 (ninguém consegue assinar: runbook §5); `forbidden`/`not_found` em rajada da mesma sessão → tentativa direta por quem não é proprietário; `rate_limited` → possível abuso de checkouts |

Assinaturas entrando no prazo de regularização: `select count(*) from public.billing_subscriptions where status = 'past_due' and grace_expired_at is null;` (acompanhar semanalmente; cada uma é um cliente a ponto de perder o plano e **não há e-mail nosso avisando**). Eventos esperando demais: o dashboard da Stripe mostra entregas pendentes; do nosso lado, `corrected` do job é a medida.

## Sinais de domínio próprio e pixels (Sprint 8, parte 2)

Os eventos carregam o desfecho e, na verificação, a situação e o roteamento — nunca o nome do domínio, o desafio, um identificador de pixel ou o token do provedor. Owner de todos: founder técnico. Runbook: `docs/runbooks/DOMAINS.md`. Limiares propostos; sem alerta automático até o provisionamento (Sentry / log drain). Nenhum destes sinais foi observado fora do stack local.

| Evento | Significado | Sinal / limiar proposto e ação |
|---|---|---|
| `domains.claim` com `outcome` `ok`, `invalid`, `blocked`, `already_set`, `not_in_plan`, `forbidden`, `not_found` | um registro de domínio e por que foi recusado | informativo. `rate_limited` repetido numa conta → alguém testando nomes em série (P3) |
| `domains.verify` com `outcome=ok` (`status`: `active`, `dns_missing`, `in_use`, `not_in_plan`; `routing`: `ok`, `pending`, `conflict`, `none`; `providerFailed`) | uma verificação concluída | `providerFailed=true` em mais de 3 verificações em 15 min → API do provedor fora do ar ou token inválido (P2: runbook §3 e §6). `status=in_use` → duas contas disputando um nome (olhar a trilha, runbook §4) |
| `domains.verify` com `not_configured` | falta o segredo de assinatura ou ele difere do Vault | qualquer ocorrência num ambiente com domínios ligados → P2 (ninguém consegue comprovar: runbook §6) |
| `domains.verify` com `dns_unavailable` | o servidor não conseguiu consultar o DNS | sustentado por 15 min → P2 (runbook §2) |
| `domains.remove` com `detached=false` | a linha foi apagada, mas o domínio continuou anexado no provedor | com provedor configurado → limpar à mão no painel (P3); não abre nenhuma página |
| `public_page.resolved` com `via=domain` (`state`, `durationMs`) | uma regeneração da página num domínio próprio | proporção de `not_found` muito alta → domínios apontando para cá sem linha ativa (clientes antigos, ou alguém varrendo Hosts): candidato a limite na borda |
| `public_page.domain_lookup_failed` (`errorCode`) | o banco não respondeu à leitura por domínio | como `public_page.lookup_failed`: > 1% em 5 min → P1 (o ISR segue servindo a última cópia boa) |
| `pixels.set` com `ok`, `invalid`, `not_in_plan`, `forbidden` | alteração dos códigos de uma página | informativo |

**O que não tem sinal:** o que acontece no navegador do visitante com os pixels (aceite, recusa, carregamento, bloqueio por CSP). Uma violação de CSP só aparece no console do visitante; não há `report-uri` configurado.

## Sinais de limites, CAPTCHA, expurgo e exclusão de conta (Sprint 9, continuação)

Verificados só no stack local (ADR 0018).

| Evento | O que é | Quando agir |
|---|---|---|
| `retention.maintenance` (`outcome`: `ok`, `partial`, `not_configured`, `unauthorized`, `not_deployed`, `unavailable`; contagens por tipo, `removed`, `pendingProfiles`, `pendingWorkspaces`) | uma execução do job diário de expurgo | nenhuma execução `ok` ou `partial` em 36 h → P2 (dados ficando além do prazo; runbook `RETENTION.md`). `partial` por três dias seguidos → P2 (imagens não estão saindo). `removed` muito acima do habitual sem mudança de prazo → P1: conferir antes da próxima execução |
| `privacy.erasure` (`outcome`: `erased` ou o motivo da recusa; `pages`, `hostnames`, `workspaces`) | uma execução de exclusão de conta pelo administrador | `domain_failed`, `media_pending` repetido ou `unavailable` → o operador executa de novo (`ACCOUNT_DELETION.md`). Qualquer `erased` sem dossiê correspondente → P1 (uso indevido da fila) |
| `analytics.ingest`, `report.read`, `lead.submit`, `media.upload` com `outcome=rate_limited` | requisição recusada pelo limite por instância (os três primeiros já existiam para os limites do banco; a origem não é distinguida no log) | pico vindo de poucos endereços → informativo, o limite funcionou. Sustentado e espalhado → flood distribuído: agir no firewall (`RATE_LIMITS.md` §3) |
| `auth.sign_in`, `auth.sign_up`, `auth.recovery_requested`, `auth.confirmation_resent` com `errorCode=captcha_failed` | o Supabase recusou o token do CAPTCHA | casos isolados → robô ou verificação não concluída. **Quase todas as tentativas** → configuração quebrada (chave do site ausente no deploy ou hostname fora do widget): P1, desligar o CAPTCHA no Supabase e corrigir (`ENVIRONMENTS.md`) |

**O que não tem sinal:** `/api/vitals` e a denúncia recusadas pelo limite (respondem em silêncio, de propósito); a regra do firewall da Vercel (o que ela marca ou bloqueia só aparece no painel *Firewall*); o que o Turnstile mostra ao visitante.

## Monitor externo e alertas (Sprint 9, parte 3)

Decisão: ADR 0019. Verificado só no stack local; **em produção o monitor só vigia o que não depende de segredo até o founder concluir os passos de `docs/runbooks/MONITORING.md` §1**.

Até aqui este documento listava limiares que ninguém vigiava. Desde 11/10/2026 existe um mecanismo: o workflow `.github/workflows/monitor.yml` roda de hora em hora, e uma execução com falha faz o GitHub enviar um e-mail ao founder. **Só os sinais da tabela abaixo geram alerta; todos os outros limiares deste documento continuam dependendo de alguém ler os logs.**

| Alerta | Fonte | Severidade | Runbook |
|---|---|---|---|
| a aplicação, a home ou a página pública de teste não respondem | requisições do workflow | P1 | `INCIDENT.md`, `PUBLIC_PAGE.md` |
| o banco não responde (projeto pausado no plano Free, entre outros) | `/api/ops/status` responde 503 `unavailable` | P1 | `MONITORING.md` |
| um job sem execução boa há mais de 36 h | `job_runs`, gravada por cada job | P2 (cobrança: P1 com assinantes) | `JOBS.md` |
| cobrança pedida no ambiente e desligada | `resolveBillingMode` | P1 | `BILLING.md` |
| evento de cobrança preso há mais de 1 h, ou com cliente desconhecido, divergência ou conflito em 24 h | `billing_events` | P2 / P1 | `BILLING.md` |
| denúncia sem análise ou contestação sem resposta há mais de 72 h (uma vez por dia) | filas | P2 | `MODERATION.md` |
| pedido de privacidade aberto há mais de 10 dias (uma vez por dia) | `privacy_requests` | P1 | `ACCOUNT_DELETION.md` |
| página ou conta vencida há mais de 3 dias sem expurgo (uma vez por dia) | `purge_after` | P3 | `RETENTION.md` |

Eventos novos:

| Evento | O que é | Quando agir |
|---|---|---|
| `ops.status` (`outcome`: `ok`, `failing`, `unauthorized`, `not_configured`, `not_deployed`, `unavailable`; `failing` com os nomes das verificações) | uma leitura do monitor | o alerta chega por e-mail; o log serve para ver desde quando falha |
| `moderation.appeal` (`outcome`: `sent`, `invalid`, `forbidden`, `not_found`, `not_suspended`, `already_open`, `limit_reached`, `not_deployed`, `unavailable`) | uma contestação enviada pelo dono de uma página suspensa | `unavailable` repetido → P2: o dono não consegue contestar. Nunca contém o texto |

**Sem alerta, ainda:** taxa de erro e latência do renderer, Web Vitals, picos de `rate_limited`, `unavailable` em uploads, formulários e Auth, webhook que não chega (só aparece como `corrected > 0` no job diário), domínios próprios. Dependem de um serviço que leia os logs, que não foi contratado.
