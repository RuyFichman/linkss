# Runbook — planos, assinatura e cobrança

**Owner:** founder técnico. **Ferramentas:** logs filtrados por `event` (`billing.webhook`, `billing.maintenance`, `billing.checkout`, `billing.cancel`, `billing.resume`, `billing.change_plan`, `billing.self_service`); tabelas `billing_customers`, `billing_subscriptions`, `billing_events`, `billing_invoices`; trilha `audit_events` (`billing.*`); o dashboard da Stripe (eventos, entregas do webhook, assinaturas); `docs/adr/0014-payments-subscriptions-and-webhooks.md`.

Regras gerais:

- **A Stripe é a fonte da verdade do pagamento; as nossas tabelas são uma cópia.** Para saber o que foi cobrado, olhe a Stripe. Para saber o que a conta pode fazer, olhe `workspaces.plan_id`.
- **Nunca edite `workspaces.plan_id` nem `billing_subscriptions` à mão para "consertar" uma conta que tem assinatura.** A próxima leitura da Stripe desfaz a edição, e a trilha de auditoria fica sem a mudança. O conserto é fazer a cópia ser lida de novo (seção 1).
- Plano definido à mão (conta sem assinatura) continua possível e é respeitado: `update public.workspaces set plan_id = 'agency' where id = '<conta>';`. A tela mostra "Definido manualmente". Se a conta assinar depois, a assinatura passa a mandar.
- Nunca peça, guarde ou registre número de cartão, CPF/CNPJ ou comprovante em ticket. O produto não vê esses dados; quem vê é a Stripe.
- O modo de cobrança (`BILLING_MODE`) `off` desliga a venda e o webhook, **não** as assinaturas existentes na Stripe: elas continuam sendo cobradas lá. Para parar cobranças, cancele na Stripe.
- **Nada disto foi executado contra uma conta Stripe real** até a data deste runbook (09/10/2026): os passos que citam o dashboard da Stripe vêm da documentação e devem ser revistos no primeiro uso.

## 1. "O cliente pagou e o plano não mudou"

1. Na Stripe, abra a assinatura do cliente (pelo e-mail usado no checkout) e confirme o **status** (`active`?) e o **valor** (R$ 14,90, R$ 149,00, R$ 57,90 ou R$ 579,00).
2. Veja o que temos:

```sql
select s.status, s.plan_id, s.billing_interval, s.amount_cents, s.current_period_end, s.cancel_at_period_end, s.grace_until, s.observed_at, w.plan_id as plano_da_conta
from public.billing_subscriptions s join public.workspaces w on w.id = s.workspace_id
where s.workspace_id = '<conta>' order by s.created_at desc;

select provider_event_id, reason, outcome, received_at from public.billing_events
where workspace_id = '<conta>' order by received_at desc limit 20;
```

3. Leia o desfecho (`outcome`) mais recente:

| `outcome` | O que quer dizer | O que fazer |
|---|---|---|
| nenhum evento | o webhook não chegou | seção 2 |
| `applied`, `unchanged` | a cópia está em dia | o plano é o esperado? Se a assinatura está `incomplete`, o primeiro pagamento ainda não foi confirmado (a Stripe expira em 23 h) |
| `price_mismatch` | a Stripe está cobrando um valor que não é do catálogo | alguém editou o preço na Stripe, ou o catálogo mudou. **Não conceda o plano à mão**: corrija o preço da assinatura na Stripe e reenvie o evento |
| `conflict` | a conta já tinha uma assinatura paga e pagou uma segunda | a segunda foi cancelada na Stripe automaticamente. **Reembolse a segunda cobrança à mão** (seção 3) |
| `customer_mismatch`, `unknown_customer` | o cliente da Stripe não é o desta conta | assinatura criada fora do produto (no dashboard)? Só assinaturas iniciadas pelo checkout do produto são reconhecidas |
| `stale` | chegou uma leitura mais antiga que a guardada | normal; nada a fazer |

4. Para forçar uma nova leitura **agora**: na Stripe, reenvie o último evento da assinatura (Workbench → Webhooks → entrega → *Reenviar*; a Stripe permite até 15 dias). Um evento já processado responde 200 sem efeito; para forçar de verdade, rode o job (lê de novo toda assinatura não lida há 20 horas e, para contas que iniciaram um checkout nos últimos 3 dias e não têm assinatura paga registrada, pergunta à Stripe pelo cliente):

```bash
curl -X POST https://<host>/api/jobs/billing -H "Authorization: Bearer <CRON_SECRET>"
```

   A resposta traz `checked`, `corrected` e `failed`. `corrected > 0` significa que a cópia estava errada e foi consertada: um webhook se perdeu (seção 2).
5. Enquanto isso, a pessoa vê na tela de retorno "Aguardando a confirmação do pagamento". Nada é cobrado duas vezes por ela recarregar.

## 2. "O webhook está falhando"

Sinais: `billing.webhook` com `outcome` diferente de `applied`/`unchanged`/`duplicate`/`ignored`; entregas com erro no dashboard da Stripe; `billing.maintenance` com `corrected > 0`.

| No log | Causa provável | Ação |
|---|---|---|
| `billing_off` (503) | `BILLING_MODE` é `off`, falta um segredo, ou a chave não combina com o modo (chave de teste em `live`, chave live em `sandbox`) | conferir as cinco variáveis na Vercel e fazer novo deploy |
| `bad_signature` (400) | `STRIPE_WEBHOOK_SECRET` não é o do endpoint que está entregando (endpoint de teste × live; segredo trocado) | copiar o segredo do endpoint certo; seção 4 |
| `missing_signature` em rajada | alguém chamando a rota sem ser a Stripe | nada a consertar; observar o volume (limite global é da Sprint 9) |
| `stale_timestamp` | entrega com mais de 5 minutos, ou relógio | a Stripe reenvia com assinatura nova; se persistir, conferir se há um proxy segurando requisições |
| `forbidden` (503) | `BILLING_SIGNING_SECRET` na Vercel diferente de `billing_signing_secret` no Vault | igualar os dois valores e fazer novo deploy |
| `not_configured` (503) | o segredo não existe no Vault | criar (`docs/ENVIRONMENTS.md`) |
| `not_deployed` (503) | a migração da Sprint 8 não foi aplicada | `supabase db push` |
| `unavailable` (503) | a Stripe ou o banco não responderam | a Stripe reenvia sozinha por até 3 dias; conferir `status.stripe.com` e o Supabase |
| `too_large`, `malformed` (400) | corpo que não é um evento | ninguém a avisar se for isolado |

A Stripe repete as entregas que receberam 5xx; depois de consertar, **não é preciso reenviar à mão**. Para não esperar: rode o job (seção 1, passo 4). Se o endpoint ficou desativado pela Stripe por falhas seguidas, reative-o no dashboard.

## 3. Reembolsar ou cancelar à mão

O produto não reembolsa. Sempre na Stripe.

- **Cancelar para o cliente:** na Stripe, cancele a assinatura (ao fim do período ou imediatamente). O webhook atualiza a conta; no cancelamento imediato o plano volta ao Gratuito na hora. Nenhuma página, pessoa, contato ou imagem é apagada.
- **Reembolsar:** reembolse o pagamento na Stripe **e decida o cancelamento junto**. Um reembolso sozinho não muda o plano (de propósito: um reembolso parcial de cortesia não deve tirar o plano de ninguém). Reembolso total do período em curso → cancele imediatamente na mesma hora.
- **Segunda assinatura paga por engano (`conflict`):** ela já foi cancelada pelo produto. Falta reembolsar: procure pelo cliente na Stripe, ache a cobrança da assinatura cancelada e reembolse integralmente.
- **Chargeback:** o produto cancela a assinatura na Stripe assim que recebe a contestação e a conta volta ao Gratuito. Responda à contestação pelo dashboard. Se o cliente quiser voltar, ele assina de novo.
- **Direito de arrependimento / pedidos de cancelamento por outro canal:** tratar como acima e registrar o pedido. A regra jurídica está pendente de revisão (ADR 0014, lista para os revisores).

Conferência depois de qualquer um desses:

```sql
select action, metadata, created_at from public.audit_events
where workspace_id = '<conta>' and action::text like 'billing.%' order by id desc limit 10;
```

## 4. Trocar o segredo do webhook

1. Na Stripe (Workbench → Webhooks → o endpoint → *Substituir segredo*), escolha manter o segredo antigo ativo por um prazo (até 24 h). Durante esse prazo a Stripe assina cada entrega com os dois, e o produto aceita se qualquer assinatura `v1` conferir.
2. Atualize `STRIPE_WEBHOOK_SECRET` na Vercel (Production e Preview) e faça novo deploy.
3. Confira uma entrega com 200 no dashboard. Se aparecer `bad_signature`, o deploy ainda está com o segredo antigo e o prazo acabou: a Stripe vai repetir as entregas; conserte e espere.

**Trocar `BILLING_SIGNING_SECRET` / `billing_signing_secret`** (o que o servidor usa para assinar o que entrega ao banco): gere o valor novo no Vault (`select vault.update_secret((select id from vault.secrets where name = 'billing_signing_secret'), encode(extensions.gen_random_bytes(32), 'hex'));`), copie para a Vercel e faça novo deploy. Entre um passo e outro o webhook responde 503 (`forbidden`) e a Stripe repete depois: nada se perde. Vazou? Troque na hora; o segredo não lê dado nenhum, mas permite forjar mudança de plano.

**Trocar a chave da Stripe (`STRIPE_SECRET_KEY`):** gere uma nova no dashboard (de preferência restrita a Customers, Checkout Sessions, Subscriptions, Invoices, Charges, Products e Billing Portal), atualize a Vercel, faça deploy e revogue a antiga.

## 5. "A Stripe está fora do ar"

- **O que continua funcionando:** tudo o que não é cobrança. Páginas públicas, editor, resultados. A tela *Plano* abre (lê só o nosso banco) e mostra o plano e os pagamentos guardados.
- **O que falha, com mensagem:** assinar, mudar de plano, cancelar, abrir "forma de pagamento" ("O provedor de pagamento não respondeu. Nada foi cobrado nem alterado.").
- **Webhooks:** a Stripe entrega depois. **Ninguém perde o plano por causa da queda:** o prazo de 7 dias só começa quando a Stripe nos conta que um pagamento falhou.
- **O job** registra `failed > 0` (`partial`). Rode de novo quando a Stripe voltar.
- Não mude `BILLING_MODE` para `off` por causa de uma queda: isso também desliga o webhook.

## 6. O prazo para regularizar (pagamento que falhou)

- Quando a Stripe informa a falha, a assinatura fica `past_due` e `grace_until` = primeira falha + 7 dias. A conta mantém o plano e vê o aviso com a data.
- O job diário (05:00 UTC) tira o plano na primeira execução depois do prazo (`billing.maintenance` com `graceExpired`). A conta volta aos limites do Gratuito; nada é apagado; o aviso muda para "plano suspenso".
- Pagou depois (dentro ou fora do prazo): a Stripe avisa, a assinatura volta a `active` e o plano volta.
- **Dar mais prazo a um cliente:** `update public.billing_subscriptions set grace_until = now() + interval '5 days', grace_expired_at = null where workspace_id = '<conta>' and status = 'past_due';` e, se o plano já tinha sido retirado, rode o job (ele só tira; para devolver antes do pagamento, peça ao cliente para pagar, ou defina o plano à mão **depois** de cancelar a assinatura na Stripe). Registre o motivo.
- O que a Stripe faz com as novas tentativas e ao desistir é configuração do dashboard (*Billing → Revenue recovery*): recomendado deixar as tentativas automáticas ligadas e, ao esgotá-las, **cancelar a assinatura**.

## 7. Conferências rápidas

```sql
-- Assinaturas que não são lidas há mais de dois dias (o job deveria ter lido).
select workspace_id, status, observed_at from public.billing_subscriptions where status <> 'ended' and observed_at < now() - interval '2 days';

-- Contas com plano pago e sem assinatura que o conceda (definidas à mão).
select w.id, w.name, w.plan_id from public.workspaces w
where w.plan_id <> 'free' and w.deleted_at is null
  and not exists (select 1 from public.billing_subscriptions s where s.workspace_id = w.id and s.granted_plan_id is not null);

-- Desfechos do webhook nas últimas 24 horas.
select outcome, count(*) from public.billing_events where received_at > now() - interval '24 hours' group by 1 order by 2 desc;
```

## 8. Ambiente local

`node scripts/billing-lifecycle.mjs` (em `apps/web`) sobe um emulador local da API da Stripe e a aplicação apontada para ele, e percorre o ciclo de vida inteiro; `--serve` deixa os dois no ar para usar no navegador; `--cleanup` remove as contas `qa-billing-*@example.test`. Instruções no cabeçalho do arquivo. O emulador segue a documentação da Stripe, não a Stripe: serve para conferir o produto, não o provedor.
