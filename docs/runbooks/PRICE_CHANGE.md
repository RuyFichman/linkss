# Runbook — mudança de preço com assinaturas em curso

**Owner:** founder. **Decisão:** ADR 0014 (adendo de 13/10/2026). **Runbook da cobrança:** `BILLING.md`.

**Estado em 13/10/2026:** o mecanismo existe e foi verificado só no stack local (pgTAP `230-pilot-readiness`, com um preço aposentado dentro de uma transação de teste). **Nenhum preço foi mudado até hoje, em nenhum ambiente, A migração `202610130001` foi aplicada em produção em 14/10/2026.** O passo 6 (levar assinantes antigos ao preço novo) **não tem código**: é um procedimento manual que depende de decisão do founder, de revisão jurídica e de um canal de aviso.

## O que acontece com quem já assina

Um preço que deixa de ser vendido **não é apagado**: fica em `plan_prices` com `retired_at` preenchido. Quem assinou por ele:

- continua com o plano e **continua pagando o valor antigo**, sem prazo;
- vê na tela *Plano* o valor que de fato paga;
- se mudar de plano ou passar para o anual, passa a pagar o **preço à venda** do destino;
- se cancelar e assinar de novo, assina pelo preço à venda.

Quem assina depois da mudança paga o preço novo. Enquanto isso valer, não há nada a fazer por assinante.

## Antes de mudar

1. **Escolha um valor que nunca foi usado por outro plano no mesmo período.** O banco recusa (`plan_prices_charge_key`): o plano concedido é descoberto pelo valor cobrado, então um mesmo valor mensal não pode ser de dois planos, nem que um deles esteja aposentado. Consulte o que já existe:

   ```sql
   select plan_id, billing_interval, amount_cents, retired_at from public.plan_prices order by billing_interval, amount_cents;
   ```

2. Confira a ordem dos planos depois da mudança: o plano Agência precisa continuar mais caro por mês que o Pro, porque é o preço mensal à venda que decide o que é subir e o que é descer de plano.
3. Revise o que promete o preço atual: a home, `/precos`, a central de ajuda e as minutas em `docs/legal/` (os termos precisam dizer como um reajuste é avisado; **pendente de revisão jurídica**).

## Como mudar (exemplo: Pro mensal de R$ 14,90 para R$ 19,90)

Tudo no mesmo PR:

1. **Migração nova** (nunca edite uma migração já aplicada):

   ```sql
   update public.plan_prices set retired_at = now()
   where plan_id = 'pro' and billing_interval = 'month' and retired_at is null;
   insert into public.plan_prices (plan_id, billing_interval, amount_cents, currency) values
     ('pro', 'month', 1990, 'BRL');
   ```

   Mantenha o formato `('<plano>', '<período>', <centavos>, '<moeda>')`: o teste de divergência lê as migrações por ele.

2. **`apps/web/src/lib/product.ts`:** o preço novo em `monthlyPriceInCents`.
3. **`apps/web/src/modules/billing/catalog.ts`:** o preço antigo entra em `RETIRED_PRICES`:

   ```ts
   export const RETIRED_PRICES: readonly PlanPrice[] = [
     { planId: "pro", interval: "month", amountCents: 1490, currency: "BRL" },
   ];
   ```

4. Ajuste os testes que citam o valor antigo (o catálogo em `billing.test.ts`, a contagem de preços à venda em pgTAP `170-billing`, os valores em `scripts/billing-lifecycle.mjs`) e rode `npm run check` e `npm run test:db`. O teste de divergência falha se um valor inserido por qualquer migração não estiver nem no catálogo nem em `RETIRED_PRICES`.

## Ordem do deploy

**Migração primeiro, deploy depois**, com backup conferido antes (`BACKUP.md`):

| Momento | Checkout novo | Mudança de plano | Assinatura antiga |
|---|---|---|---|
| Antes de tudo | preço antigo | preço antigo | plano mantido |
| Migração aplicada, aplicação antiga no ar | cobra o preço antigo, que o banco ainda reconhece (aposentado): **o plano é concedido** | **recusada** ("não foi possível concluir agora"), porque banco e aplicação discordam do valor; nada é cobrado | plano mantido |
| Deploy feito | preço novo | preço novo | plano mantido |

A ordem inversa é a perigosa: com a aplicação nova e o banco antigo, um checkout cobraria um valor que o banco não conhece, o plano não seria concedido (`price_mismatch`) e o cliente teria pago sem receber. Se isso acontecer, aplique a migração e reenvie o evento na Stripe (`BILLING.md` §1): a leitura seguinte concede o plano.

Faça a mudança fora do horário de uso e deixe a janela entre os dois passos em minutos.

## Depois

1. Abra a tela *Plano* numa conta sem assinatura e confira o valor novo; em `/precos` e na home também (as duas são estáticas: só mudam com o deploy).
2. Faça um checkout no modo em que a produção estiver e confira que o plano foi concedido.
3. Confira que ninguém perdeu o plano:

   ```sql
   select status, plan_id, billing_interval, amount_cents, count(*)
   from public.billing_subscriptions where status in ('active', 'past_due') group by 1, 2, 3, 4 order by 2, 3, 4;
   select count(*) from public.billing_events where outcome = 'price_mismatch' and received_at > now() - interval '1 day';
   ```

   A segunda consulta precisa dar zero. O monitor também acusa (`billing:mismatches`, `MONITORING.md`).

## 6. Levar os assinantes antigos ao preço novo (manual; não construído)

Só com decisão do founder. Não faça sem:

- **aviso prévio** a cada assinante, pelo prazo que os termos disserem (o produto não envia e-mail: use o e-mail da cobrança, que está na Stripe);
- **revisão jurídica** do reajuste em contrato de consumo com renovação automática;
- direito de cancelar antes da data, sem cobrança do valor novo.

Na data, para cada assinatura, no painel da Stripe: *Subscriptions* → assinatura → *Update subscription* → trocar o preço pelo valor novo, **sem cobrança proporcional**, valendo na próxima renovação. O webhook traz a mudança: o valor novo é um preço à venda do mesmo plano, então o plano não muda. Confira com a primeira consulta de "Depois".

Quando nenhuma assinatura ativa usar mais um valor aposentado, a linha pode continuar em `plan_prices` e em `RETIRED_PRICES`: ela não custa nada e explica o histórico das faturas. Não a apague.

## O que este procedimento não cobre

- **Mudar o que um plano inclui** (limites, recursos): é `plan_entitlements`, outra migração, e vale para todos os assinantes do plano na hora, antigos ou novos.
- **Criar ou extinguir um plano:** um plano novo precisa de linha em `plans`, `plan_entitlements`, `plan_prices` e `lib/product.ts`; extinguir um plano com assinantes não tem desenho.
- **Preços por região ou em outra moeda:** o catálogo é só em reais (`currency = 'BRL'` é uma restrição da tabela).
- **Cupom, desconto de fundador, período de teste:** não existem no produto.
