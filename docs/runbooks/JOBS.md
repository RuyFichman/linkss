# Runbook — jobs agendados

**Owner:** founder técnico. **Onde ficam:** `apps/web/vercel.json` (Vercel Cron) e `apps/web/src/app/api/jobs/`. **Alerta:** verificações `job:*` do monitor (`MONITORING.md`).

## Os quatro jobs

| Job | Horário (UTC) | O que faz | Log | Runbook do assunto |
|---|---|---|---|---|
| `/api/jobs/analytics` | 04:00 | agrega as visitas do dia anterior e apaga eventos e agregados vencidos | `analytics.maintenance` | `ANALYTICS.md` |
| `/api/jobs/billing` | 05:00 | encerra prazos de pagamento vencidos, aplica mudanças de plano agendadas e relê na Stripe assinaturas não lidas há um dia | `billing.maintenance` | `BILLING.md` |
| `/api/jobs/media-cleanup` | 06:00 | apaga imagens que nenhuma página usa e as de páginas excluídas há mais de 30 dias | `media.cleanup` | `MEDIA.md` |
| `/api/jobs/retention` | 07:00 | apaga o que passou do prazo de retenção e as páginas e contas excluídas | `retention.maintenance` | `RETENTION.md` |

A ordem importa em um ponto: o expurgo (07:00) só remove uma página depois que a limpeza de mídia (06:00) apagou as imagens dela.

Todos aceitam `GET` (é como o cron chama) e `POST`, exigem `Authorization: Bearer <CRON_SECRET>`, podem ser repetidos sem dano e gravam a própria execução em `job_runs` (lida pelo monitor). No plano Hobby da Vercel o cron roda uma vez por dia, em algum momento dentro da hora marcada.

## Rodar à mão

O segredo vem do ambiente; nunca cole o valor em chat, issue ou histórico do terminal.

```bash
curl -s -X POST https://linkfav.com/api/jobs/retention -H "Authorization: Bearer $CRON_SECRET"
```

Troque `retention` por `analytics`, `billing` ou `media-cleanup`. Resposta `{"ok":true,...}` com as contagens.

## Alerta `job:<nome>`: sem execução boa há mais de 36 horas

1. **O cron está cadastrado?** Vercel → projeto → *Settings* → *Cron Jobs*: os quatro devem aparecer. Eles vêm do `vercel.json` do deploy em produção; um rollback para um deploy antigo pode tirar um deles.
2. **O que o job respondeu?** Vercel → *Logs*, filtrar pelo evento da tabela acima e ler `outcome`:

| `outcome` | Causa | Correção |
|---|---|---|
| `unauthorized` (401) | `CRON_SECRET` foi trocado na Vercel sem novo deploy, ou não é o valor que a Vercel envia | definir `CRON_SECRET` (32+ caracteres) e fazer novo deploy; a Vercel envia sozinha o valor dessa variável |
| `not_configured` (503) | falta `CRON_SECRET` ou `SUPABASE_SECRET_KEY` (cobrança: também as variáveis da Stripe) | repor a variável; novo deploy |
| `not_deployed` (503) | a migração do job não foi aplicada | `supabase db push` |
| `unavailable` (503) | o banco não respondeu ou a função falhou | ver se o projeto Supabase está pausado (`MONITORING.md`); depois rodar à mão |
| `partial` | o job rodou e deixou trabalho para a próxima execução | normal por um dia. Conta como execução boa, exceto na limpeza de mídia quando arquivos não puderam ser removidos |
| nenhum log | o cron não disparou | passo 1; rodar à mão |

3. **Rodar à mão** e conferir que o alerta some na execução seguinte do monitor.

## O que acontece enquanto um job está parado

| Job parado | Efeito para o cliente | Urgência |
|---|---|---|
| analytics | o painel de resultados mostra "contagem em andamento" e os eventos brutos passam de 7 dias; acima do teto de capacidade a coleta para | P2; P1 depois de 3 dias |
| billing | uma assinatura com pagamento falho não perde o plano no prazo; um webhook perdido não é corrigido | P2; P1 se houver assinantes |
| media-cleanup | o uso de armazenamento só cresce (limite de 1 GB no plano Free); páginas excluídas não podem ser expurgadas | P3 |
| retention | dados pessoais ficam além do prazo prometido | P2 |

## Depois de uma pausa longa

Rodar à mão nesta ordem: `analytics`, `billing`, `media-cleanup`, `retention`. Analytics e expurgo são limitados por execução: repita até `pendingDays`, `pendingProfiles` e `pendingWorkspaces` chegarem a zero.

## Quinto job: reverificação de domínios (desde 11/10/2026)

| Job | Horário (UTC) | O que faz | Log | Runbook do assunto |
|---|---|---|---|---|
| `/api/jobs/domains` | 08:00 | lê de novo o registro de comprovação de cada domínio próprio ativo; sete dias seguidos sem ele desligam o domínio | `domains.recheck` | `DOMAINS.md` |

Vale tudo o que este runbook diz dos outros quatro: mesmo segredo, mesma forma de rodar à mão, mesmo alerta (`job:domains`). Parado, o efeito é só que um domínio abandonado continua abrindo a página: P3.
