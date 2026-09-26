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

## Regras

- Logs estruturados incluem request/correlation ID, módulo, ambiente e resultado.
- Tokens, secrets, senhas, payloads completos de lead e cartão nunca entram em logs.
- Alertas precisam de owner, severidade, runbook e ação esperada.
- Métricas exibidas ao cliente têm reconciliação separada da telemetria interna.
- Sampling só pode reduzir volume depois de preservar erros e eventos de segurança.

## Provisionamento pendente

O health endpoint está implementado. Sentry, uptime monitor e dashboards dependem das contas/credenciais dos ambientes e devem ser provisionados antes da Sprint 10. Até lá, os nomes de variáveis já estão documentados em `.env.example`.
