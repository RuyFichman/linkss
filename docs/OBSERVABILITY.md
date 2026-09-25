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

## Regras

- Logs estruturados incluem request/correlation ID, módulo, ambiente e resultado.
- Tokens, secrets, senhas, payloads completos de lead e cartão nunca entram em logs.
- Alertas precisam de owner, severidade, runbook e ação esperada.
- Métricas exibidas ao cliente têm reconciliação separada da telemetria interna.
- Sampling só pode reduzir volume depois de preservar erros e eventos de segurança.

## Provisionamento pendente

O health endpoint está implementado. Sentry, uptime monitor e dashboards dependem das contas/credenciais dos ambientes e devem ser provisionados antes da Sprint 10. Até lá, os nomes de variáveis já estão documentados em `.env.example`.
