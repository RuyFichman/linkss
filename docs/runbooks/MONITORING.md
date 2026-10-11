# Runbook — monitor e alertas

**Owner:** founder técnico. **Decisão:** ADR 0019. **Estado em 11/10/2026:** código pronto e verificado no stack local. **Em produção o monitor ainda não vigia nada além de "o site responde":** falta aplicar a migração e criar o segredo (§1). O workflow nunca rodou contra a produção.

## Como funciona

O workflow `.github/workflows/monitor.yml` roda no GitHub de hora em hora e faz quatro leituras em `https://linkfav.com`. **Se uma falha, o GitHub manda um e-mail para quem alterou o agendamento por último: esse e-mail é o alerta.** O título é "Run failed: Monitor". Abra o link, veja qual passo ficou vermelho e use a tabela abaixo.

Uma vez por dia (09:43 de Brasília) ele também conta trabalho esperando por uma pessoa (filas).

**Limites:** o GitHub pode atrasar ou pular execuções e **desliga workflows agendados depois de 60 dias sem atividade no repositório** (ele avisa por e-mail antes; basta reativar em *Actions*). O alerta é um e-mail para uma pessoa. Não é um plantão.

## 1. Ligar (uma vez)

1. Aplicar as migrações `202610110003` e `202610110004` (`docs/ENVIRONMENTS.md`).
2. Gerar um segredo de 64 caracteres (`openssl rand -hex 32`). **Não reutilizar o `CRON_SECRET`.**
3. **Vercel:** variável `OPS_STATUS_SECRET` (*Sensitive*, Production). Novo deploy.
4. **GitHub:** repositório → *Settings* → *Secrets and variables* → *Actions* → *New repository secret* → nome `OPS_STATUS_SECRET`, o mesmo valor.
5. Opcional: em *Variables*, `MONITOR_PUBLIC_PAGE` com o endereço de uma página publicada mantida para isso (por exemplo `/teste`). Sem ela, o monitor não exercita a página pública.
6. *Actions* → *Monitor* → *Run workflow*. Deve ficar verde. No log do último passo aparece a lista de verificações.
7. Conferir em *Settings* → *Notifications* da sua conta do GitHub que "Actions: failed workflows" envia e-mail.

Sem o passo 4, o último passo do workflow só emite um aviso e passa: **jobs, cobrança e filas não estão sendo vigiados**.

## 2. Alertas e resposta

Severidades: **P1** = clientes afetados agora, agir no mesmo dia; **P2** = agir em até dois dias úteis; **P3** = fila de trabalho.

| Passo que falhou / verificação | O que significa | Sev. | O que fazer |
|---|---|---|---|
| *The application answers* | `linkfav.com/api/health` não respondeu | P1 | Vercel → *Deployments*: o último deploy falhou? Reverter para o anterior (*Promote*). Conferir o status da Vercel. `INCIDENT.md` |
| *The home page renders* | a aplicação responde mas a home não | P1 | idem; ver os logs do deploy |
| *A published page renders* | a página pública de teste não abriu | P1 | `PUBLIC_PAGE.md` §3. Se a home abre e esta não, suspeite do banco (próxima linha) |
| *Jobs, billing and queues* com HTTP 503 e `"error":"unavailable"` | **o banco não respondeu.** No plano Free, a causa mais provável é o projeto **pausado** | P1 | Supabase → o projeto → *Restore/Resume*. Depois rodar os jobs à mão (`JOBS.md`) |
| idem, `"error":"not_configured"` | `OPS_STATUS_SECRET` ou `SUPABASE_SECRET_KEY` sumiu do deploy | P2 | repor a variável na Vercel e fazer novo deploy |
| idem, `"error":"not_deployed"` | a migração `202610110004` não está aplicada | P2 | `supabase db push` |
| HTTP 401 | o segredo do GitHub e o da Vercel não são iguais | P2 | refazer os passos 3 e 4 com o mesmo valor |
| `job:analytics`, `job:billing`, `job:domains`, `job:media-cleanup`, `job:retention` | o job não tem uma execução boa há mais de 36 h | P2 (cobrança: P1 se houver assinantes) | `JOBS.md` |
| `billing:mode` | a cobrança foi pedida no ambiente e está desligada; o detalhe diz o motivo (`key_mode_mismatch`, `missing_webhook_secret`...) | P1 | `BILLING.md` §2: corrigir a variável indicada e fazer novo deploy |
| `billing:stuck_events` | um evento da Stripe ficou em processamento por mais de 1 h | P2 | `BILLING.md` §1; o job diário relê a assinatura |
| `billing:mismatches` | chegou evento de cliente desconhecido, com divergência ou conflito nas últimas 24 h | P1 | `BILLING.md` §1 e §7: alguém pode ter pago e não recebido o plano |
| `queue:moderation_reports` (diário) | denúncia sem análise há mais de 72 h | P2 | `MODERATION.md` |
| `queue:moderation_appeals` (diário) | contestação sem resposta há mais de 72 h | P2 | `MODERATION.md` §3 |
| `queue:privacy_requests` (diário) | pedido de privacidade aberto há mais de 10 dias (a LGPD dá 15 dias para a resposta completa a um pedido de acesso; confirmar os prazos na revisão jurídica) | P1 | `ACCOUNT_DELETION.md` |
| `retention:backlog` (diário) | página ou conta vencida há mais de 3 dias que não saiu | P3 | `RETENTION.md` |

Enquanto a causa não for resolvida, o e-mail se repete a cada execução (de hora em hora para o que é crítico). Para silenciar durante um conserto longo: *Actions* → *Monitor* → *Disable workflow*, e **reativar depois**.

## 3. Conferir à mão

```bash
curl -s https://linkfav.com/api/ops/status?attention=1 -H "Authorization: Bearer $OPS_STATUS_SECRET"
```

A resposta lista as doze verificações com `ok`, um detalhe curto e o runbook. Não contém e-mail, endereço de página nem segredo.

## 4. O que o monitor não vê

- Taxa de erro e lentidão da página pública, e Web Vitals: só nos logs da Vercel (`PUBLIC_PAGE.md` §6), que duram pouco no plano atual.
- Picos de `rate_limited` e ataques em curso (`RATE_LIMITS.md`).
- Um webhook da Stripe que não chegou: só aparece quando o job diário corrige (log `billing.maintenance` com `corrected > 0`).
- Domínios próprios de clientes.
- E-mails do Auth que não chegam.

Um serviço de monitoramento pago cobriria os dois primeiros; é uma decisão do founder ainda não tomada.
