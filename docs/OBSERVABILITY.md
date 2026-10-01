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

## Regras

- Logs estruturados incluem request/correlation ID, módulo, ambiente e resultado.
- Tokens, secrets, senhas, payloads completos de lead e cartão nunca entram em logs.
- Alertas precisam de owner, severidade, runbook e ação esperada.
- Métricas exibidas ao cliente têm reconciliação separada da telemetria interna.
- Sampling só pode reduzir volume depois de preservar erros e eventos de segurança.

## Provisionamento pendente

O health endpoint está implementado. Sentry, uptime monitor e dashboards dependem das contas/credenciais dos ambientes e devem ser provisionados antes da Sprint 10. Até lá, os nomes de variáveis já estão documentados em `.env.example`.
