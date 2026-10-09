# Relatório da Sprint 8

**Status:** **em andamento, parte 1 de 2.** A parte 1 (planos, assinatura e cobrança) está implementada e verificada **no ambiente local**. Nada foi aplicado em staging, na Vercel ou num provedor de pagamento; não existe conta no provedor. A parte 2 (domínio próprio e pixels) não foi iniciada.
**Objetivo da sprint:** deixar o MVP comercializável.
**Objetivo desta parte:** o plano de uma conta passa a vir de uma assinatura, e não de um `update` manual.
**Resultado desta parte:** o proprietário de uma conta no plano Gratuito chega a um limite, vê o que cada plano dá e quanto custa em reais, paga mensal ou anual na página do provedor e volta para uma conta com os limites novos, sem ninguém rodar SQL. Quando um pagamento falha, a conta tem 7 dias para regularizar. Ao cancelar ou mudar para um plano menor, a pessoa vê antes, com os números da própria conta, o que deixa de funcionar, e nada do que ela criou é apagado.
**Provedor integrado de verdade?** **Não.** O adapter da Stripe está escrito (a partir da documentação oficial) e roda de ponta a ponta contra um **emulador local** da API da Stripe que vive neste repositório. **Nenhuma linha deste código falou com a Stripe.** O que o emulador prova é que o produto é coerente com a nossa leitura da documentação; não prova que a Stripe se comporta assim.
**Data:** 09/10/2026
**Branch:** `feat/sprint-8-billing`, criada a partir da `main` (`2a3d701`, que já contém o PR #22 do `feat/app-design`). Commits: `3ef0f35` (banco), `7d6cd58` (módulo, rotas e telas), `e8b42ed` (script de ciclo de vida e correções), `a2badc0` (reconciliação do primeiro webhook perdido), `782c4cb` (ADR e documentação) e o commit que inclui este relatório. **Sem push e sem PR.**

## Como a sprint foi executada

O founder dividiu a Sprint 8 em dois prompts e, ao iniciar este, definiu o provedor: **Stripe**. As demais decisões do bloco de gates ficaram nos padrões do prompt (rebaixamento: nada é removido; tolerância: 7 dias) e estão registradas como provisórias.

Ponto de partida conferido antes de qualquer mudança: a `main` local estava parada na Sprint 6 e foi avançada por *fast-forward* até a `origin/main`; `npm run test:db` (18 arquivos, 951 asserções) e `npm run check` (34 arquivos, 943 testes) passaram sem alteração. O Docker Desktop não estava em execução e foi iniciado; os contêineres de outros projetos não foram tocados.

Ordem de trabalho: leitura; ADR; módulos puros; migrações e pgTAP; adapter, webhook e job; telas; pontos de entrada e home; script de ciclo de vida; navegador; documentação; gate final.

## Resultado por entrega

- **D1 — ADR 0014:** provedor, `PaymentsAdapter`, modelo de dados, máquina de estados, caminho único e atestado até o plano, ordem/replay/reparo, mudanças de plano, regras de rebaixamento, modo de cobrança, papéis e a lista para a revisão jurídica e contábil.
- **D2 — Banco:** `plan_prices`, `billing_customers`, `billing_subscriptions`, `billing_events`, `billing_invoices`; `private.apply_billing_snapshot`, `private.billing_sync_plan` (o único comando que escreve `workspaces.plan_id`), `run_billing_maintenance`, as RPCs do proprietário; quatro ações de auditoria.
- **D3 — `modules/billing/`:** catálogo de preços, máquina de estados, tolerância com relógio injetado, impacto do rebaixamento, modo de cobrança, adapter (Stripe por `fetch`, sem SDK, e fake em memória), atestação, serviço, rota do webhook, job diário.
- **D4 — Telas:** *Plano* (plano e situação, três planos, histórico), confirmação de cancelamento e de mudança de plano, retorno do checkout com espera automática, aviso em toda a conta enquanto um pagamento falha.
- **D5 — Pontos de entrada e selo:** link "Ver planos com …" em seis telas de limite, só para o proprietário e só com a venda ligada; o selo segue o plano também em página já publicada.
- **D6 — Home:** só mostra preços e oferece planos pagos com a cobrança real ligada.
- **D7 — Testes e script:** Vitest, pgTAP e `apps/web/scripts/billing-lifecycle.mjs`.
- **D8 — Documentação:** ADR 0014; ADR 0004, 0012 e 0013; arquitetura, ameaças, mapa de dados, observabilidade, runbook `BILLING.md`, ambientes, decisões e conteúdo de UX, aviso de privacidade, README, backlog, este relatório e `AGENTS.md` §22.

## Estado dos gates

- **Gate de usabilidade:** o *override* do founder de 25/09/2026 continua valendo.
- **Provedor:** Stripe, decidido pelo founder em 09/10/2026.
- **UX:** novas **UX-074 a UX-084**, todas provisórias. UX-081 **substitui** a regra "sem botão de compra nas telas de limite" de UX-007, UX-046 e UX-069.
- **Staging, Vercel, Stripe:** nada foi tocado por mim. Nenhuma migração, segredo, variável, webhook ou conta.
- **Cobrança real:** fora de alcance, como previsto.

## Decisões tomadas

Técnicas (ADR 0014):

- **O webhook é só um aviso.** O conteúdo do evento não decide nada: o servidor lê a assinatura na Stripe e grava o que ela diz agora. Isso é o que torna inofensivas as entregas repetidas, atrasadas e fora de ordem.
- **Um só caminho até o plano, atestado por HMAC** com segredo espelhado no Vault (o padrão dos ADR 0009 e 0011), e não a *secret key*: um vazamento permite forjar mudança de plano, mas não lê dado nenhum, e a mesma peça serve para a ação do proprietário sem usar chave de serviço numa ação de usuário.
- **O plano concedido é derivado do valor cobrado** (`plan_prices` é única por intervalo, valor e moeda). Metadado dizendo o plano nunca é lido.
- **Preços enviados *inline*** a partir do catálogo: não há id de preço para configurar por ambiente.
- **Processamento síncrono e limitado no webhook** (200 feito, 400 inválido, 503 tente de novo), em vez de responder antes e trabalhar depois: se o trabalho falha, a Stripe precisa repetir.
- **Reparo diário:** o job relê na Stripe toda assinatura não lida há 20 horas e os clientes que iniciaram checkout nos últimos 3 dias sem assinatura paga registrada.
- **Tolerância de 7 dias**, contada da primeira falha e encerrada pelo job (até um dia depois, a favor do cliente).
- **Upgrade imediato; rebaixamento entre planos pagos e cancelamento ao fim do período pago**, com o banco segurando o plano já pago.
- **Rebaixamento não remove nada e não bloqueia nada além do que é novo** (publicar continua permitido acima do limite).
- **Chargeback encerra o plano na hora; reembolso não muda o plano sozinho.**
- **Plano definido à mão é respeitado:** uma assinatura só tira o plano que ela mesma concedeu.
- **Excluir conta com assinatura em curso é recusado** (`LK102`).
- **Sem dependência nova.** O adapter usa `fetch`.

**Desvio da recomendação do prompt:** ele sugeria um *fake adapter* para o stack local. Um fake dentro da aplicação pediria uma página de checkout falsa e um endpoint de controle, isto é, ganchos de teste em código de produção. Em vez disso o stack local roda o **adapter real** contra um emulador que vive na árvore de testes e num script; a única concessão em produção é `STRIPE_API_BASE_URL`, aceita só em modo de teste e só para endereço de loopback. O fake existe e é usado nos testes de unidade e no teste de contrato.

Produto/UX (`docs/ux/UX_DECISIONS.md`): UX-074 (tela *Plano*), UX-075 (papéis), UX-076 (tolerância e aviso, sem e-mail), UX-077 (rebaixamento), UX-078 (quando cada mudança vale), UX-079 (corte da troca mensal↔anual), UX-080 (retorno do checkout), UX-081 (link nas telas de limite), UX-082 (ambiente de teste e home), UX-083 (plano manual; quem compra o quê; UX-018 mantida), UX-084 (chargeback e reembolso).

### Cortes de escopo

- **Trocar entre mensal e anual numa assinatura em curso** (segundo item da lista de cortes). A tela diz para cancelar e assinar de novo ao fim do período.
- **Teste de contrato contra o sandbox real e fixtures gravadas:** não existem (não há conta). O teste de contrato roda contra o emulador e diz isso.
- Não cortados: histórico de pagamentos guardado, "manter a assinatura" depois de cancelar, mudança da home, adapter real.

## Critérios de aceite

| # | Critério (`PLANO_DE_EXECUCAO.md`) | Estado | Evidência |
|---|---|---|---|
| AC1 | Preços exibidos: R$ 14,90/mês ou R$ 149/ano; R$ 57,90/mês ou R$ 579/ano | **verificado no local** | Um catálogo (`modules/billing/catalog.ts`, derivado de `lib/product.ts`) lido pela tela, pelo checkout e pelos testes. Vitest `billing.test.ts`: valores formatados, economia do anual, teste de divergência contra o seed `plan_prices`. Vitest `service.test.ts` e `adapter.contract.test.ts`: o valor enviado ao provedor é o do catálogo para os quatro preços; a ação não tem como receber valor. Script: a tela mostra os quatro preços; campos `amount`, `unit_amount` e `planId` acrescentados ao formulário são ignorados e o provedor recebe R$ 14,90. **Ressalva:** o provedor aqui é o emulador |
| AC2 | Repetir um webhook não duplica assinatura nem cobrança | **verificado no local** | pgTAP `170-billing` e Vitest `service.test.ts`: o mesmo evento duas vezes e em paralelo deixa uma linha de assinatura, uma mudança de plano e uma entrada de auditoria; observação mais antiga depois da mais nova é `stale` e não desfaz o estado; assinatura inválida, carimbo vencido, cliente desconhecido, conta que não é a do cliente e valor fora do catálogo não mudam nada; checkout iniciado duas vezes abre um só, e uma segunda assinatura paga nunca é gravada como ativa. Script: cada entrega enviada três vezes em paralelo, em ordem invertida e de novo. **Ressalva:** a concorrência real foi exercitada pelo script (HTTP); no pgTAP ela é provada pela chave primária do ledger |
| AC3 | Downgrade preserva dados e comunica quais recursos ficarão bloqueados | **verificado no local** | Função pura `downgradeImpact` com tabela no Vitest (páginas, pessoas e convites, armazenamento, histórico, relatórios, selo). A tela de confirmação renderiza essa lista antes do botão. pgTAP: depois de perder o plano, de rebaixar e de cancelar, a contagem de páginas, membros, convites, links, agregados, mídia e leads é a mesma. Script: Agência → Pro com 3 páginas, 3 pessoas e 1 link ativo; a lista da tela ("2 de 3 páginas ficam acima do limite de 1", pessoas, link) confere com o que aconteceu |
| AC4 | Falha de pagamento tem período de tolerância definido e recuperável | **verificado no local** | Máquina de estados no ADR 0014 e em `subscription.ts`, com tabela Vitest de todos os pares de estados. pgTAP com relógio injetado: plano mantido durante os 7 dias, perdido no fim, recuperado dentro e depois do prazo; o prazo não reinicia a cada tentativa. A área de cobrança e o aviso dizem a situação e a data em palavras (conferido no navegador). **Ressalva:** no script o relógio é avançado editando `grace_until` das linhas do próprio script e rodando o job do produto |
| AC5 (herdado) | Entitlements para Free, Pro e Agência; o selo segue o plano | **verificado no local** | Matriz no ADR 0014; teste de divergência de entitlements verde; lista de recursos da tela gerada dos entitlements. pgTAP: `get_public_page` de uma página **já publicada** troca `show_badge` assim que o plano muda, nos dois sentidos. Vitest `route.test.ts`: o webhook e o job invalidam o cache das páginas da conta. Prazo declarado: na hora quando a mudança chega por webhook, ação ou job; até 60 s (ISR) nos demais casos. **Não medido** numa CDN real |

Os dois critérios restantes da Sprint 8 (domínio próprio, pixels) são da parte 2 e **não foram iniciados**.

## Entregáveis

| Entrega | Onde revisar |
|---|---|
| ADR | `docs/adr/0014-payments-subscriptions-and-webhooks.md` |
| Migrações + pgTAP | `supabase/migrations/202610090001_sprint8_enum_values.sql`, `202610090002_billing.sql`; `supabase/tests/database/170-billing.test.sql` (160 asserções), `010-structure.test.sql` (+5); `apps/web/src/lib/database.types.ts` regenerado |
| Módulo | `apps/web/src/modules/billing/{catalog,subscription,downgrade-impact,mode,marketing,adapter,stripe-adapter,fake-adapter,webhook-signature,attestation,service,read,presentation,server,actions}.ts`, `components/`, `testing/{stripe-emulator,memory-ledger}.ts` |
| Rotas | `app/api/billing/webhook/route.ts`, `app/api/jobs/billing/route.ts`, `app/app/w/[workspaceId]/plano/{page,loading}.tsx`, `…/plano/confirmar/page.tsx`, `…/plano/retorno/page.tsx`; `apps/web/vercel.json` (terceiro cron) |
| Pontos de entrada | `modules/billing/components/upgrade-link.tsx` nas telas de páginas, nova página, duplicar, membros, resultados (página e conta) e relatório; `modules/editor/components/storage-usage.tsx`; aba e aviso em `app/app/w/[workspaceId]/layout.tsx` |
| Home e privacidade | `app/(marketing)/home.tsx`, `HOME_COPY`; `app/(marketing)/privacidade/page.tsx` |
| Textos | `content/pt-BR.ts` (`BILLING_COPY`) |
| Testes | Vitest: `modules/billing/{billing,service,adapter.contract}.test.ts`, `app/api/billing/webhook/route.test.ts`, `app/api/jobs/billing/route.test.ts`, `modules/identity/identity.test.ts` (matriz) |
| Script | `apps/web/scripts/billing-lifecycle.mjs` |
| Documentação | ADR 0014; ADR 0004, 0012, 0013; `docs/{ARCHITECTURE,THREAT_MODEL,DATA_MAP,OBSERVABILITY,ENVIRONMENTS}.md`; `docs/runbooks/BILLING.md`; `docs/ux/{UX_DECISIONS,CONTENT_GUIDE}.md`; `.env.example`; `README.md`; `BACKLOG.md`; `AGENTS.md` §22 |

## Validação executada

### Resultado final registrado

```text
npm audit: 6 high. 5 são os de antes, só em ferramentas de desenvolvimento (eslint-config-next → braces).
           1 é NOVO e de produção: `next` 16.0.0–16.3.7 (estamos em 16.3.6), seis avisos publicados depois da Sprint 7;
           correção: next 16.4.0. npm audit --omit=dev: 1 high. Não foi corrigido nesta branch (ver "Pendências").
lint: aprovado (eslint --max-warnings=0)
typecheck: aprovado
test: 39 arquivos, 1.136 testes aprovados (193 novos, 5 arquivos novos)
test:db: 19 arquivos, 1.116 asserções aprovadas (165 novas: 160 no arquivo 170 e 5 no 010)
supabase db advisors --local: No issues found
build: aprovado, 52 rotas + Proxy (5 novas: /api/billing/webhook, /api/jobs/billing, /app/w/[workspaceId]/plano, …/plano/confirmar, …/plano/retorno)
npm run check: aprovado (exit 0)
billing-lifecycle.mjs: PASS, 124 verificações, 0 falhas; 99 linhas de log de cobrança, nenhuma com id do provedor, segredo, assinatura ou endereço
```

As duas migrações foram aplicadas no banco local com `supabase migration up`. **Não rodei `db reset`.** Durante o trabalho, três funções da segunda migração foram corrigidas depois de aplicada e recriadas no banco local por `create or replace` a partir do próprio arquivo; o arquivo de migração é a fonte e o pgTAP passa contra o banco local nesse estado. **A aplicação das migrações a partir do zero fica a cargo do job `database` do CI, que ainda não rodou com esta branch** (não houve push).

### Script de ciclo de vida (124 verificações, todas aprovadas)

`node scripts/billing-lifecycle.mjs`, build de produção em `127.0.0.1:3100`, Supabase local, emulador em `127.0.0.1:4242`. O script age como uma pessoa sem JavaScript: abre as páginas com sessão real e envia os formulários das Server Actions. Percorre: limite atingido como proprietário, administrador e editor; tela de planos; checkout; endereço de sucesso aberto sem pagar; formulário do proprietário reenviado com cada sessão; pagamento com entregas duplicadas, simultâneas e invertidas; renovação; falha de pagamento, aviso e portal; recuperação; nova falha e fim do prazo pelo job; desistência do provedor; nova assinatura; checkout antigo pago depois (segunda assinatura recusada e cancelada no provedor); upgrade; criação das páginas antes recusadas; rebaixamento com 3 páginas, 3 pessoas e 1 link; cancelamento e fim do período; webhooks forjados, sem assinatura, alterados, repetidos tarde e grandes demais; evento de cliente desconhecido; cliente de outra conta pareado com a assinatura desta; chargeback; chamadas diretas às RPCs e escritas diretas nas tabelas com cada papel; e, por fim, **o mesmo build com a cobrança desligada**.

### Navegador (Chrome, build de produção, emulador)

- Tela *Plano* como proprietário: plano, aviso de ambiente de teste, três planos com os quatro preços e a economia do anual.
- Assinar Pro mensal → página de pagamento do emulador (R$ 14,90 por mês) → a página de retorno, aberta **antes** do pagamento, mostrou a espera; o pagamento foi feito por fora do navegador e a mesma página passou sozinha para "Pagamento confirmado", sem recarregar (o documento era o mesmo).
- Falha de pagamento: aviso no topo com a data e o botão "Atualizar forma de pagamento"; situação "Pagamento pendente" em palavras.
- Confirmação de cancelamento: lista com "Fica acima do limite" e "Deixa de funcionar" em palavras e os números da conta.
- 360, 390, 430, 768 e 1280 px (por iframe) para *Plano* (sem assinatura e com assinatura), confirmação e retorno: sem rolagem horizontal e sem alvo menor que 44 px.
- Uma sessão de QA antiga, de outra conta, abriu a tela *Plano* desta conta e recebeu "Página não encontrada".

**Não feito, marcado como preparado e não verificado:** qualquer coisa contra a Stripe; celular real, Safari e leitor de tela; a aplicação contra um banco **sem** a migração (coberto por testes de unidade do mapeamento `not_deployed`, não exercitado); o diálogo "Manter a assinatura" pelo navegador (a ação é exercitada no Vitest; a tela, não); impressão; a página de planos como administrador e editor no navegador (conferidas por HTTP no script).

### JavaScript da página pública

Soma dos arquivos de cliente que a rota `/[slug]` referencia no manifesto do próprio build: **62.941 bytes em 4 arquivos na `main` e 62.941 bytes em 4 arquivos na branch**, com os mesmos tamanhos por arquivo. Nenhum arquivo do grafo da página pública foi alterado. (É uma comparação entre builds, não uma medição de transferência.)

### Problemas encontrados e corrigidos

- **Checkout reaproveitado:** um novo checkout em menos de 10 minutos depois de uma assinatura encerrada recebia a sessão antiga, porque a chave de idempotência só levava conta, plano e intervalo. Ela agora leva quantas assinaturas a conta já teve. Achado pelo script.
- **Primeiro webhook perdido nunca seria reparado:** o job só relia assinaturas que já tinham linha. Agora também pergunta ao provedor pelos clientes que iniciaram checkout nos últimos 3 dias. Achado ao escrever o runbook; com teste.
- **Cliente de uma conta pareado com a assinatura de outra** era recusado pelo banco como formato inválido; passou a ser recusado no servidor, com desfecho próprio, antes do banco.
- **Duas leituras no mesmo instante:** a segunda era descartada como antiga; "antiga" passou a ser estritamente mais antiga.
- **Depois de cancelar ou mudar de plano** a tela de confirmação se redesenhava para um estado que não se aplicava mais ("esta mudança não está disponível"); a pessoa agora volta para *Plano* com o resultado. Achado no navegador.
- **Selo de situação repetido** ("Gratuito" duas vezes) na tela *Plano*.

## Segurança, privacidade, acessibilidade, performance e operação

- **Segurança:** seção nova em `docs/THREAT_MODEL.md`. Casos negativos testados: webhook forjado, sem assinatura, com corpo alterado, repetido tarde e grande demais; eventos duplicados, simultâneos e fora de ordem; evento de cliente desconhecido e de outra conta; valor fora do catálogo; preço e plano adulterados pelo formulário; endereço de sucesso sem pagamento; checkout iniciado duas vezes e segunda assinatura paga; cada papel (proprietário, administrador, editor, outra conta, `anon`) contra cada ação, pela tela, pelo formulário reenviado e pela RPC direta; escrita direta em cada tabela de cobrança e em `workspaces.plan_id`; retrato sem assinatura do servidor; job sem segredo; link de recibo que não é `https`; `STRIPE_API_BASE_URL` fora de loopback. Nenhuma validação, policy ou regra de lint foi afrouxada.
- **Privacidade:** `docs/DATA_MAP.md`. **Stripe é um subprocessador novo, com tratamento fora do Brasil**, a partir do momento em que a cobrança for ligada. O produto não vê nem guarda cartão, CPF/CNPJ ou endereço. O aviso de privacidade ganhou a seção sobre pagamentos.
- **Acessibilidade:** situação sempre em palavras e com data; cada linha da confirmação começa pelo tipo em texto; alvos de 44 px; foco visível herdado dos componentes; a espera do retorno é uma região `aria-live` e tem um link "Verificar agora" que funciona sem JavaScript. **Leitor de tela real não foi usado.**
- **Performance:** página pública inalterada (acima). O layout da conta ganhou duas consultas por tela para o aviso de pagamento (plano e assinatura), só para proprietário e administrador.
- **Operação:** sinais em `docs/OBSERVABILITY.md`; runbook `docs/runbooks/BILLING.md`; passos de deploy em `docs/ENVIRONMENTS.md`.

## Pendências, gaps e riscos

- **Nada foi verificado contra a Stripe.** É o maior risco desta parte. O emulador e os mapeamentos vêm da documentação lida em 09/10/2026; formatos reais podem divergir. A primeira tarefa depois de o founder abrir a conta de teste é rodar o roteiro de staging e comparar.
- **Sem Pix recorrente:** conta Stripe brasileira aceita Pix só em pagamento avulso. Assinatura será por cartão.
- **`npm audit`: aviso alto novo no `next`** (16.0.0–16.3.7; correção em 16.4.0), incluindo envenenamento de cache de páginas ISR em instalações auto-hospedadas e divulgação por rotas de imagem de metadados. A aplicação usa ISR e tem `/[slug]/opengraph-image`. **Não atualizei o framework dentro desta branch:** é mudança de dependência com risco próprio e merece um PR separado, antes de qualquer usuário externo. Vale conferir o que se aplica à Vercel.
- **Sem e-mail de cobrança.** Quem não abre o produto só sabe de uma falha pelos e-mails da própria Stripe, se o founder os ligar.
- **Reembolso de segunda assinatura paga por engano é manual.**
- **Mudança de preço** não tem plano para assinaturas em curso: o valor antigo viraria `price_mismatch`.
- **Sem limite global nem lista de IPs** na frente do webhook (Sprint 9).
- **Exportação e exclusão de conta** ainda não alcançam as tabelas de cobrança; a exclusão do titular precisará cancelar no provedor antes do expurgo (Sprint 9).
- **Guarda fiscal × exclusão:** hoje os pagamentos guardados são apagados com a conta. Depende da revisão contábil.
- **O job roda uma vez por dia** (plano Hobby): fim de prazo e reparo têm até um dia de atraso, sempre a favor do cliente.
- **Troca mensal↔anual** cortada.
- **Banco local:** ficou o segredo `billing_signing_secret` no Vault local (criado pelo script, nunca impresso). As contas `qa-billing-*@example.test` e as linhas de cobrança delas foram removidas com `--cleanup`; as tabelas de cobrança estão vazias. Continuam os dados de QA das sprints anteriores.
- **Fora do repositório:** nada foi escrito ou apagado além dos arquivos temporários da sessão. No Chrome usei `127.0.0.1:3100`; a sessão que estava aberta nesse endereço (uma conta de QA antiga) foi encerrada para entrar com a conta de teste.
- **Herdadas:** sessões de usabilidade, Auth hospedado em padrões, SMTP, CAPTCHA, LCP/CLS de visitantes reais, conferência da Sprint 7 em staging, revisão jurídica.

## Perguntas para o founder

1. **Pix recorrente** é requisito para a nossa cobrança? Com Stripe, no Brasil, não há.
2. **Tolerância de 7 dias** (UX-076): mantém?
3. **Rebaixamento** (UX-077): nada removido e nada bloqueado além do que é novo, inclusive publicar. Mantém?
4. **Papéis** (UX-075): só o proprietário paga; administrador vê sem agir; editor não vê nada. Mantém?
5. **Chargeback derruba o plano na hora** e **reembolso não muda o plano sozinho** (UX-084). Concorda? Vai para a revisão jurídica.
6. **Qualquer conta pode comprar qualquer plano**, e o limite de 3 contas de agência continua (UX-083). Concorda?
7. **Troca mensal↔anual** (UX-079) ficou cortada. Entra depois?
8. **Home com preços só com cobrança real** (UX-082). Concorda?
9. **Atualizar o Next para 16.4.0** em um PR separado, agora?
10. **E-mails da Stripe** (recibo, falha de pagamento): ligar no dashboard, já que o produto não envia nada?

## Passos de deploy em staging

Ordenados e detalhados em `docs/ENVIRONMENTS.md`, "Passos de deploy da Sprint 8, parte 1". Em resumo: (1) conta Stripe em modo de teste, cartão como forma de pagamento, portal do cliente só para forma de pagamento e faturas; (2) merge do PR; (3) `npx supabase db push` (duas migrações); (4) segredo `billing_signing_secret` no Vault; (5) endpoint de webhook na Stripe apontando para `/api/billing/webhook` em staging, com os oito tipos de evento; (6) quatro variáveis na Vercel (`STRIPE_SECRET_KEY` de teste, `STRIPE_WEBHOOK_SECRET`, `BILLING_SIGNING_SECRET`, `BILLING_MODE=sandbox`) e novo deploy. Em qualquer ordem a aplicação se comporta como antes até o último passo.

**Para cobrança real:** conta Stripe ativada, domínio do produto, endpoint e chave *live*, `BILLING_MODE=live`, projeto Supabase de produção, e a revisão jurídica e contábil.

## Handoff para a parte 2

- **O caminho de mudança de plano não precisa mudar.** Domínio próprio e pixels entram como entitlements (`custom_domain` já existe em `plan_entitlements` e em `lib/product.ts`; pixels precisarão de uma chave nova, em migração própria de enum, com o seed e `lib/product.ts` juntos, senão o teste de divergência falha). Trocar de plano muda o que `private.entitlement_bool` devolve na requisição seguinte; não há cópia por conta.
- **Como uma mudança de entitlement chega a uma página já publicada:** hoje, pelo que é lido a cada requisição (`get_public_page` devolve `show_badge`) mais a invalidação do cache: `private.apply_billing_snapshot` e `run_billing_maintenance` devolvem os endereços das páginas no ar da conta quando o plano muda, e a rota do webhook, o job e as ações chamam `revalidatePublicPage`. **Domínio próprio e pixels devem seguir o mesmo desenho:** decidir em `get_public_page` (ou num leitor equivalente) se o recurso vale agora, em vez de gravá-lo no snapshot publicado; assim a perda do plano desliga o pixel e o domínio sem republicar. Se o domínio próprio tiver cache por host, a lista de endereços devolvida pelo banco precisará incluí-lo.
- **A tela de confirmação precisa de duas linhas novas** em `modules/billing/downgrade-impact.ts` (`custom_domain`, pixels) e em `impactSentence`: o que acontece com o domínio e com os pixels de uma conta que perde o plano. A regra desta parte é "nada é apagado; deixa de funcionar e volta com o plano".
- **A lista de recursos dos planos** (`planFeatureLines`) omite `custom_domain` de propósito, porque o recurso não existe; incluí-lo quando existir. A home também não o menciona.
- **Duplicação de página** não deve copiar domínio nem pixels (ADR 0012), e o relatório do cliente não deve mostrá-los (ADR 0013).
- **Parcial nesta parte:** nada foi verificado contra a Stripe; troca mensal↔anual cortada; atualização do Next pendente.
- **Ponto de partida recomendado:** conferir primeiro a parte 1 em staging com a conta de teste da Stripe (se o founder a tiver aberto), porque a parte 2 depende de contas em planos pagos para ser testada; depois, o ADR do domínio próprio (prova de controle e sequestro) e o dos pixels (consentimento e allowlist).
