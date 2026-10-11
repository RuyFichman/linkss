# Ambientes e entrega

## Ambientes

| Ambiente | Aplicação | Dados | Uso |
|---|---|---|---|
| local | Next.js local | Supabase local ou projeto descartável | desenvolvimento e testes |
| preview | deploy por pull request | staging, sem dados pessoais reais | revisão visual/funcional |
| staging | URL estável | projeto Supabase Free | QA, migrações e demos |
| production | URL pública | projeto separado; Pro antes do beta pago | clientes reais |

O limite de dois projetos Free permite staging e uma produção inicial privada. Desenvolvimento local não consome projeto hospedado. Produção será promovida para Pro antes de depender de receita.

## Pipeline

1. Branch curta e pull request.
2. CI executa lint, typecheck, testes e build.
3. Preview deploy usa variáveis do ambiente de preview.
4. Merge em `main` promove staging automaticamente.
5. Produção exige aprovação manual até o processo provar estabilidade.
6. Migração de banco roda separadamente e antes do código que depende dela.

## Segredos

- Somente chaves publicáveis usam prefixo `NEXT_PUBLIC_`.
- Secret/service key existe apenas no runtime servidor.
- Ambientes nunca compartilham secrets ou webhooks.
- `.env.example` documenta nomes, não valores.
- Cobrança (Sprint 8): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` e `BILLING_SIGNING_SECRET` são só do servidor; staging usa chave e endpoint de **teste**, produção usa os **live**, e os dois nunca se misturam (uma chave que não combina com `BILLING_MODE` desliga a cobrança).
- Rotação obrigatória após vazamento ou saída de colaborador.

## Rollback

- Aplicação: promover o último deploy saudável.
- Banco: migrações expansivas e compatíveis; correções via nova migração.
- Publicação: snapshot anterior por perfil.
- Feature arriscada: flag/entitlement desligável sem novo deploy quando necessário.

## Supabase local (Sprint 2)

- Requisitos: Docker em execução. A CLI é devDependency fixada (`supabase@2.118.0`).
- `npm run db:start` sobe Postgres 17, Auth, PostgREST, Storage, Studio e Mailpit; `npm run db:stop` encerra.
- `npm run db:reset` reaplica `supabase/migrations/` e `supabase/seed.sql` (sem dados pessoais).
- `npm run test:db` executa os testes pgTAP; `npm run db:types` regenera `apps/web/src/lib/database.types.ts`.
- `apps/web/.env.local` recebe `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` a partir de `npx supabase status`.
- E-mails locais aparecem no Mailpit em `http://127.0.0.1:54324`.
- Tabelas nunca são expostas implicitamente (`auto_expose_new_tables = false`); cada migração faz `REVOKE`/`GRANT` explícitos.

### Mídia no stack local (Sprint 5)

- O Storage local está ligado em `supabase/config.toml`; o bucket `media` e a policy vêm das migrações.
- Uploads precisam do mesmo segredo no servidor e no banco: `MEDIA_SIGNING_SECRET` em `apps/web/.env.local` e o segredo `media_signing_secret` no Vault local (`select vault.create_secret('<valor>', 'media_signing_secret');`). Sem isso o upload responde "indisponível". O Vault não é recriado por migração nem pelo seed (é segredo).
- `VISITOR_HASH_SALT` (limite de envios por visitante), `CRON_SECRET` e `SUPABASE_SECRET_KEY` (job de limpeza) também ficam só no `.env.local`.
- Não existe transformação de imagem no plano Free nem no stack local: as variantes são geradas pela aplicação no upload (ADR 0009).

## Supabase hospedado: staging (2026-10-01)

- Um projeto Supabase no plano Free é o banco de staging; produção será um projeto separado. O ref do projeto não fica neste repositório (que é público): está no dashboard do Supabase e no link local da CLI.
- As sete migrações até `202609300001_block_editor` foram aplicadas com `supabase db push` em 2026-10-01. O schema hospedado foi comparado com o local (funções, policies, índices, triggers, colunas e grants iguais). Não há dados de usuários.
- Para aplicar migrações novas: `npx supabase login` na conta dona do projeto (em terminal interativo), `npx supabase link --project-ref <ref>` e `npx supabase db push`. As versões no histórico remoto precisam ser as dos arquivos em `supabase/migrations/`; aplicar por outra via (dashboard, SQL avulso) cria versões divergentes.
- **Pendente:** o checklist de Auth abaixo. Cadastro, login e publicação ainda não foram exercitados contra este banco.
- Com o SMTP padrão do plano Free, o Auth só envia e-mail para endereços de membros da organização no Supabase e com limite baixo por hora. Serve para o founder testar o cadastro; não serve para usuários externos.

## Vercel: staging (2026-10-01)

- URL: `https://linkss-black.vercel.app`. A branch de produção do projeto na Vercel é `main`, então todo merge em `main` publica em staging. Produção será outro projeto.
- Configuração do projeto: Root Directory `apps/web` (a instalação roda na raiz do monorepo), preset Next.js, Node.js 24.x, comandos de build e install padrão.
- Variáveis de ambiente (Production; Preview precisa das mesmas para previews de PR funcionarem): `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (Sensitive) e `WAITLIST_STORE=supabase`. As demais do `.env.example` ainda não são lidas pelo código.
- `NEXT_PUBLIC_APP_URL` precisa ser a URL completa, com `https://` e sem barra final. Sem o protocolo o build falha com `ERR_INVALID_URL` em `metadataBase`. O valor entra no build: depois de mudar, é preciso novo deploy.
- Um projeto recém-conectado não tem deploy para refazer. O primeiro sai de um commit novo em `main` ou de Deployments → Create Deployment → `main`.
- Conferido em 2026-10-01: `/api/health`, landing, `/entrar` e `/cadastro` com 200; endereço inexistente com 404; `robots.txt` com o host de staging.
- Migração de banco continua separada e vem antes: aplicar no Supabase hospedado antes de mergear em `main` o código que depende dela.

## Passos de deploy da Sprint 5 (todos feitos em 02/10/2026)

A ordem importa: o código da Sprint 5 lê a coluna `profiles.theme`, então **a migração vem antes do merge em `main`** (o merge publica em staging).

1. **Feito em 02/10/2026**, depois do merge do PR #10. Como o merge publicou o código antes da migração, o staging ficou algumas horas com o código novo sobre o schema antigo, sem usuários. `npx supabase db push` com a CLI ligada ao projeto: aplica `202610010001_sprint5_enum_values` e `202610010002_media_themes_forms` (tabelas de mídia e leads, bucket público `media`, policy do Storage, validador do rascunho). A aplicação da Sprint 4 continua funcionando sobre esse schema.
2. **Feito em 02/10/2026**: o valor foi gerado dentro do banco com `encode(extensions.gen_random_bytes(32), 'hex')` e não saiu dele. Para copiá-lo para a Vercel, use o SQL Editor: `select decrypted_secret from vault.decrypted_secrets where name = 'media_signing_secret';`. Procedimento original: gerar um segredo aleatório de 64 caracteres hexadecimais e guardá-lo no Vault do projeto, pelo SQL Editor: `select vault.create_secret('<segredo>', 'media_signing_secret');`. É configuração secreta, não schema: por isso não está em migração.
3. **Feito em 02/10/2026 pelo founder.** Na Vercel (Production e Preview): `MEDIA_SIGNING_SECRET` com **o mesmo valor** (Sensitive); `VISITOR_HASH_SALT` (outro valor aleatório, 32+ caracteres, Sensitive); `CRON_SECRET` (outro valor aleatório, 32+ caracteres, Sensitive). `SUPABASE_SECRET_KEY` já existe e passa a ser usada também pelo job de limpeza.
4. **Feito** (PR #10, 02/10/2026; mergeado antes do passo 1). Mergear e aguardar o deploy.
5. **Feito em 02/10/2026 pelo founder:** cadastro, confirmação, foto e 3 imagens, formulário e Pix publicados, página aberta no celular, contato enviado e visto em Contatos. Conferir: enviar um avatar no editor, publicar, abrir a página; `curl -X POST https://<host>/api/jobs/media-cleanup -H "Authorization: Bearer <CRON_SECRET>"` deve responder `{"ok":true,...}`.
6. Agendamento da limpeza: **Vercel Cron diário** (ADR 0009), declarado em `apps/web/vercel.json` (`0 6 * * *`, 06:00 UTC). A Vercel chama a rota com `GET` e envia `Authorization: Bearer <CRON_SECRET>`. O plano Hobby só permite execução diária, com horário aproximado dentro da hora. Ele vale a partir do deploy em `main`. Para conferir, veja *Vercel → Settings → Cron Jobs* e o log `media.cleanup` do dia seguinte.

Rollback da aplicação para a Sprint 4 depois da migração: suportado para a página pública (blocos novos e tema são ignorados, a página não quebra). O editor antigo descarta os blocos novos do rascunho ao salvar (ADR 0010).

## Passos de deploy da Sprint 6 (aplicados em staging até 06/10/2026)

Os passos abaixo foram aplicados em staging: o PR foi mergeado em 02/10/2026 e, em 06/10/2026, o job manual respondeu `ok` e o founder relatou visita e clique aparecendo em *Resultados*. Falta conferir a primeira execução agendada do cron com sucesso. Eles continuam valendo para produção. A CLI do Supabase precisa estar logada na conta dona do projeto: com outra conta, o `db push` responde 403. A ordem importa, mas o código falha de modo seguro em qualquer ordem: sem a migração ou sem o segredo, a página pública abre normalmente, os eventos são descartados (`analytics.ingest` com `not_deployed` ou `not_configured`), o painel mostra "Resultados ainda não disponíveis" e o job responde 503 `not_deployed`.

1. **Migrações:** `npx supabase db push` com a CLI ligada ao projeto de staging. Aplica `202610020001_sprint6_enum_values` e `202610020002_customer_analytics` (tabelas de analytics, funções, e a nova versão de `submit_form_lead`, que tem a mesma assinatura e as mesmas respostas). A aplicação da Sprint 5 continua funcionando sobre esse schema. A data de aplicação vira o "início da contagem" que o painel mostra.
2. **Segredo no Vault:** gerar um valor aleatório de 64 caracteres hexadecimais dentro do banco e guardá-lo, pelo SQL Editor: `select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'analytics_signing_secret');`. Para copiá-lo para a Vercel: `select decrypted_secret from vault.decrypted_secrets where name = 'analytics_signing_secret';`. É configuração secreta, não schema: por isso não está em migração.
3. **Variável na Vercel** (Production e Preview): `ANALYTICS_SIGNING_SECRET` com **o mesmo valor** (Sensitive). `VISITOR_HASH_SALT`, `CRON_SECRET` e `SUPABASE_SECRET_KEY` já existem e são reutilizadas.
4. **Merge do PR** em `main` (publica em staging) e aguardar o deploy. O deploy também registra o segundo Vercel Cron declarado em `apps/web/vercel.json`: `GET /api/jobs/analytics` todo dia às 04:00 UTC (01:00 em Brasília; no plano Hobby, em algum minuto dessa hora). O plano Hobby permite até 100 crons por projeto, cada um no máximo uma vez por dia (conferido na documentação da Vercel em 02/10/2026).
5. **Conferir:**
   - abrir uma página publicada numa guia anônima do celular, tocar num botão, e ver os números em *Resultados* da página (entram em segundos);
   - `curl -X POST https://<host>/api/jobs/analytics -H "Authorization: Bearer <CRON_SECRET>"` deve responder `{"ok":true,...}`;
   - no dia seguinte, o log `analytics.maintenance` com `outcome=ok` e `lastFinalDay` igual ao dia anterior; em *Vercel → Settings → Cron Jobs* devem aparecer os dois crons;
   - o país das visitas deve aparecer (cabeçalho `x-vercel-ip-country`; no stack local é sempre "não identificado").

Rollback da aplicação para a Sprint 5 depois da migração: suportado. O código antigo não conhece as tabelas novas; o formulário continua gravando leads (e o banco continua gravando o evento `form_submit`, que ninguém lê). Os crons vêm do `vercel.json` do deploy ativo, então o cron de analytics sai junto com o rollback; enquanto ele não roda, o bruto não é apagado (a agregação e o purge retomam do ponto em que pararam no próximo deploy da Sprint 6).

Stack local: `ANALYTICS_SIGNING_SECRET` em `apps/web/.env.local` e o mesmo valor no Vault local (`select vault.create_secret('<valor>', 'analytics_signing_secret');`). Sem `x-forwarded-for` (o `next start` local não tem proxy), o hash do visitante fica ausente: toda visita conta e todos dividem um limite por página. O teste de precisão (`apps/web/scripts/analytics-accuracy.mjs`) envia o cabeçalho ele mesmo.

## Passos de deploy da Sprint 7

Estado em 06/10/2026: o founder informou que as duas migrações da parte 1 (`202610060001`, `202610060002`) foram aplicadas em staging. Em 07/10/2026 ele informou que as duas da parte 2 (`202610060003`, `202610060004`) também foram aplicadas (informado por ele; não conferido a partir deste repositório), e a branch `feat/sprint-7-agency` foi enviada com o PR aberto. Faltam o merge (passo 3) e a conferência (passo 4).

Ordem recomendada:

1. `npx supabase db push` com a CLI logada na conta dona do projeto de staging (outra conta recebe 403). Deve listar `202610060003_sprint7_report_enum_values` e `202610060004_consolidated_analytics_and_report_links`. Só acrescentam objetos; a única função existente que muda é `get_profile_analytics`, substituída por uma versão que devolve a mesma resposta.
2. Nenhum segredo novo e nenhuma variável nova na Vercel. O limite de tentativas do relatório reutiliza `VISITOR_HASH_SALT`, que já existe.
3. Enviar a branch e abrir o PR; depois do merge a `main` publica em staging.
4. Conferir: `/app/w/<conta>/resultados` abre; na tela de resultados de uma página aparece "Relatório para o cliente"; um link criado abre em janela anônima e deixa de abrir depois de cancelado.

**Ordem inversa também é segura.** Se a aplicação chegar antes das migrações da parte 2: o painel de cada página continua como na Sprint 6, o painel da conta diz "Resultados ainda não disponíveis", a seção de relatório diz que o recurso ainda não está disponível neste ambiente e `/r/<token>` mostra "Relatório não disponível". Se chegar antes das da parte 1, vale o que a parte 1 documentou: lista sem busca, e arquivar, duplicar e *Membros* respondendo "ainda não disponível".

**Rollback da aplicação para a Sprint 6 depois das migrações:** suportado. O código antigo não conhece as tabelas e funções novas e continua lendo `get_profile_analytics` com a mesma assinatura. Links de relatório já criados deixam de abrir (a rota some) e voltam a abrir quando a aplicação voltar.

**Plano de uma conta em staging.** Toda conta nasce no plano Free. Desde a Sprint 8 (parte 1) o plano muda por assinatura (seção "Passos de deploy da Sprint 8, parte 1"). **Enquanto a cobrança não estiver ligada no ambiente**, ou para uma conta de teste que não deve passar por checkout, o plano ainda pode ser definido à mão no *SQL Editor*:

```sql
update public.workspaces set plan_id = 'agency' where id = '<id da conta, o que aparece na URL /app/w/...>';
```

Uma conta assim aparece na tela *Plano* como "Definido manualmente" e não é tocada pelo job de cobrança. **Não faça isso numa conta que tem assinatura:** a próxima leitura da Stripe desfaz a mudança (`docs/runbooks/BILLING.md`).

**Stack local.** `node scripts/agency-scale.mjs` (em `apps/web`, com um `next start -p 3100` rodando) mede lista, consolidado e criação com 1, 10 e 50 páginas e deixa no banco a conta `qa-ac5-escala@example.test`; `--cleanup` remove tudo o que ele criou.

## Ambientes desde 10/10/2026: um só, e é produção

Por decisão do founder em 10/10/2026, o projeto Supabase hospedado que este arquivo e os relatórios chamam de **"staging" é o banco de produção**, e continua no **plano Free**. `https://linkfav.com` (com e sem `www`) e `https://linkss-black.vercel.app` servem o mesmo deploy da Vercel contra esse banco. **Não existe ambiente de staging.** Onde as seções abaixo dizem "staging", leia "produção".

Consequências para quem opera:

- **Antes de cada `npx supabase db push`:** CI verde (job `database`), `npm run db:backup` e `npm run db:restore-check` no backup recém-feito (`docs/runbooks/BACKUP.md`). O plano Free não tem backup gerenciado.
- **Nada de SQL de teste ou exploratório no SQL Editor.** Testes vão no banco local.
- **Contas de teste** em produção usam e-mails do próprio founder e são removidas depois; as contas `qa-*@example.test` existem só no banco local.
- **A cobrança está em modo de teste (`BILLING_MODE=sandbox`)** neste mesmo ambiente: qualquer pessoa que assinar hoje passa pelo checkout de teste da Stripe e não paga. Antes de convidar gente de fora, decidir entre desligar (`off`) e ir para `live`.

**Estado conferido em 10/10/2026:** PR #29 mergeado; as sete migrações de `202610090001` a `202610100002` aplicadas pelo founder; cobrança funcionando contra a área restrita da Stripe (assinar, recibo, mudar de plano, portal, cancelar e desfazer, relatados pelo founder; três entregas de webhook com 200). **Pendente de confirmação:** Site URL e Redirect URL do Auth apontando para `https://linkfav.com` (em 10/10 ainda apontavam para `linkss-black.vercel.app`). **Ainda não feito:** primeiro backup de produção; teste de domínio próprio e de pixels.

## Passos de deploy da Sprint 8, parte 1 (cobrança em modo de teste)

**Aplicado pelo founder em 10/10/2026, no ambiente que hoje é a produção** (os seis passos; cobrança em `sandbox`). O roteiro de conferência abaixo foi percorrido até o cancelamento, com o resultado esperado; **não foram exercitados** o passo 6 (falha de pagamento) e o passo 8 (job). Os passos ficam registrados para repetição e para o momento de ir para `live`. Eles descrevem a Stripe em **modo de teste (sandbox)**. Cobrança real fica fora até a revisão jurídica e contábil (ADR 0014).

A ordem recomendada é esta, mas **qualquer ordem é segura**: enquanto faltar a migração, um segredo ou o modo, a aplicação se comporta como antes (sem botão de compra, telas de limite com a frase de sempre, nenhum erro). A coluna da direita diz o que a aplicação faz depois de cada passo.

| # | Passo | Depois dele |
|---|---|---|
| 1 | **Conta Stripe** (sandbox). Criar a conta, ficar no modo de teste. Em *Settings → Payment methods*, deixar **cartão**. (Pix em assinatura não existe para conta brasileira: ADR 0014.) Em *Billing → Revenue recovery*, deixar as novas tentativas automáticas ligadas e, ao esgotá-las, **cancelar a assinatura**. Em *Billing → Customer portal*, ativar o portal permitindo **só** atualizar a forma de pagamento e ver faturas (desligar "trocar de plano" e "cancelar": isso é feito na tela do produto) | nada muda |
| 2 | **Merge do PR** em `main` (publica em staging). O deploy registra o terceiro Vercel Cron: `GET /api/jobs/billing`, todo dia às 05:00 UTC | a tela *Plano* aparece para proprietário e administrador e diz que a área ainda não está disponível; o job responde 503 `not_deployed`; o resto é igual |
| 3 | **Migrações:** `npx supabase db push` com a CLI logada na conta dona do projeto. Deve listar `202610090001_sprint8_enum_values` e `202610090002_billing`. Só acrescentam objetos; a única função existente que muda é `soft_delete_workspace` (passa a recusar conta com assinatura em curso) | a tela *Plano* mostra o plano e os três planos com preço e diz "Os planos pagos ainda não estão à venda"; o job responde `ok` |
| 4 | **Segredo no Vault**, pelo SQL Editor: `select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'billing_signing_secret');`. Para copiar: `select decrypted_secret from vault.decrypted_secrets where name = 'billing_signing_secret';` | nada muda |
| 5 | **Webhook na Stripe** (Workbench → Webhooks → *Criar destino de evento*, formato **Snapshot**): URL `https://linkss-black.vercel.app/api/billing/webhook`; eventos `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.dispute.created`, `charge.refunded`. Copiar o segredo `whsec_…` | a Stripe começa a entregar; a rota responde 503 (cobrança desligada) e a Stripe repete depois |
| 6 | **Variáveis na Vercel** (Production e Preview, todas *Sensitive*): `STRIPE_SECRET_KEY` (chave **de teste**, de preferência restrita), `STRIPE_WEBHOOK_SECRET` (do passo 5), `BILLING_SIGNING_SECRET` (**o mesmo valor** do passo 4), `BILLING_MODE=sandbox`. **Não** definir `STRIPE_API_BASE_URL`. Novo deploy | a tela *Plano* mostra "Ambiente de teste" e os botões de assinar para o proprietário; as telas de limite ganham o link "Ver planos…" para o proprietário; a home continua dizendo "em breve" |

**Conferência de ponta a ponta em staging (o founder roda):**

1. Com uma conta no plano Gratuito e uma página criada, abrir *Páginas*: aparece o limite e o link "Ver planos com mais páginas".
2. Em *Plano*: os quatro preços (R$ 14,90, R$ 149,00, R$ 57,90, R$ 579,00) e o aviso de ambiente de teste.
3. **Assinar Pro mensal** → página da Stripe em português, valor R$ 14,90 → pagar com o cartão de teste `4242 4242 4242 4242` → voltar → "Pagamento confirmado". Em *Plano*: "Plano Pro, cobrança mensal. Próxima cobrança: R$ 14,90 em …" e o pagamento no histórico com "Ver recibo".
4. No dashboard da Stripe, a entrega do webhook com 200. No SQL Editor: `select outcome, count(*) from public.billing_events group by 1;`.
5. **Mudar para o Agência** (confirmação → mudar): o plano muda na hora; criar a segunda página.
6. **Falha de pagamento:** na Stripe, trocar o cartão do cliente pelo cartão de teste que falha (`4000 0000 0000 0341`) e avançar a assinatura com um *test clock*, ou esperar a renovação. A conta mostra o aviso com a data. *(Não verificado: depende de como o sandbox real se comporta.)*
7. **Cancelar** pela tela: a confirmação lista o que fica acima do limite; depois, "Assinatura cancelada… continua valendo até …".
8. `curl -X POST https://linkss-black.vercel.app/api/jobs/billing -H "Authorization: Bearer <CRON_SECRET>"` deve responder `{"ok":true,…}` com `failed: 0`.
9. **Comparar com o emulador:** qualquer diferença entre o que a Stripe real fez e o que este roteiro esperava é um achado para corrigir no adapter (`apps/web/src/modules/billing/stripe-adapter.ts`) e no emulador.

**Rollback da aplicação para antes da Sprint 8 depois das migrações:** suportado. O código antigo não conhece as tabelas novas. Assinaturas já criadas na Stripe continuam sendo cobradas lá e os webhooks falham (404) até a aplicação voltar; ao voltar, o job diário põe as cópias em dia. `soft_delete_workspace` continua recusando conta com assinatura em curso, que o código antigo mostra como erro genérico.

**Para cobrança real (não fazer agora):** conta Stripe ativada (dados do negócio; o que a Stripe pede para conta brasileira não foi confirmado), domínio do produto em `NEXT_PUBLIC_APP_URL` (https), um endpoint de webhook **live** com o seu próprio segredo, chave **live**, `BILLING_MODE=live`, projeto Supabase de produção com as migrações e o segredo no Vault, e a revisão jurídica e contábil da lista do ADR 0014. Com `live`, a home passa a mostrar os preços (o valor entra no build: novo deploy).

**Stack local.** `node scripts/billing-lifecycle.mjs` em `apps/web` (depois de `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100 npm run build --workspace=@lnk/web`) sobe o emulador e a aplicação e percorre o ciclo de vida; `--serve` deixa no ar para o navegador; `--cleanup` remove as contas `qa-billing-*@example.test`. Ele cria o segredo `billing_signing_secret` no Vault local se não existir. Detalhes no cabeçalho do arquivo.

## Passos de deploy da Sprint 9 (aceite, privacidade, denúncias, headers)

**Passos 1 e 2 aplicados em 10/10/2026** (merge e migrações, em produção). O passo 3 (segredo de denúncias) foi orientado e não está confirmado; os passos 4 e 5 não foram feitos. Verificado só no stack local. Qualquer ordem é segura: sem as migrações, `/app` funciona como antes, `/termos` e `/cookies` dizem que o texto está em revisão, `/privacidade` mostra o aviso provisório, *Meus dados* mostra históricos vazios e os botões de exportar e pedir respondem que não está disponível; sem o segredo, `/denunciar` diz que o canal está indisponível e a página pública continua no ar.

| # | Passo | Depois dele |
|---|---|---|
| 1 | **Merge do PR** em `main` (publica em staging). Todas as respostas passam a levar CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` e `Permissions-Policy`; o Next sobe para 16.4.0 | conferir no navegador a página pública (imagens e embed depois do clique), o editor (upload e corte de imagem) e o login: uma violação aparece no console como "Content Security Policy" |
| 2 | **Migrações:** `npx supabase db push`. Deve listar `202610090003_sprint9_audit_actions`, `202610090004_legal_privacy` e `202610090005_moderation`. Só acrescentam objetos, mais a coluna `profiles.moderation_status` (padrão `active`); mudam duas funções existentes: `get_public_page` (página suspensa responde `suspended`) e `private.lock_profile_for_publishing` (página suspensa não publica) | *Meus dados* exporta e registra pedidos; nenhum texto jurídico fica ativo |
| 3 | **Segredo no Vault**, pelo SQL Editor: `select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'moderation_signing_secret');` e, na Vercel, `MODERATION_SIGNING_SECRET` com **o mesmo valor** (*Sensitive*). Novo deploy | `/denunciar` passa a gravar denúncias |
| 4 | **Administrador da plataforma**, pelo SQL Editor: `insert into public.platform_admins (user_id) select id from auth.users where email = '<e-mail>';` | essa pessoa abre `/app/administracao/denuncias` e `/app/administracao/privacidade`; para todas as outras as duas rotas respondem 404 |
| 5 | **Textos jurídicos: só depois da revisão do advogado.** Inserir Termos e Aviso de Privacidade aprovados em `legal_documents` por uma migração nova e ativar **os dois na mesma transação** (`status = 'active'`, `activated_at = now()`) | toda pessoa com sessão é levada a `/aceite` antes de usar `/app`. Com só um dos dois ativo ninguém é levado a `/aceite` (a tela registra os dois juntos), então o aceite não é pedido até o outro ser ativado |

**Rollback da aplicação para antes da Sprint 9 depois das migrações:** suportado. O código antigo não conhece as tabelas novas; uma página suspensa continua fora do ar, porque a decisão está em `get_public_page`.

**Stack local.** A denúncia precisa de `MODERATION_SIGNING_SECRET` em `apps/web/.env.local` e do mesmo valor no Vault local, como os outros segredos de assinatura.

## Passos de deploy da Sprint 9, continuação (limites, CAPTCHA, expurgo e exclusão de conta)

**Nada disto foi aplicado em produção.** Verificado só no stack local (ADR 0018). São quatro blocos independentes; dentro do bloco B a ordem importa.

**A. Código (merge do PR).** Sem nenhum outro passo, a aplicação se comporta como antes, com uma diferença: os limites por instância da tabela em `docs/runbooks/RATE_LIMITS.md` já valem. O cron novo (`/api/jobs/retention`, 07:00 UTC) responde 503 `not_deployed` até a migração.

**B. CAPTCHA (Turnstile). A ordem importa: se o passo 3 vier antes do 2, ninguém consegue entrar.**

| # | Passo | Depois dele |
|---|---|---|
| 1 | **Cloudflare** (conta gratuita; o DNS do domínio não precisa ir para lá): *Turnstile* → *Add widget* → nome `Linkfav`, hostnames `linkfav.com` e `www.linkfav.com`, modo *Managed*. Anote a *Site Key* e a *Secret Key* | nada muda |
| 2 | **Vercel:** variável `NEXT_PUBLIC_TURNSTILE_SITE_KEY` com a *Site Key* (não é segredo; Production e Preview). **Novo deploy** (é valor de build). Abra `/entrar`: a verificação aparece acima do botão | o formulário passa a enviar o token; o Supabase ainda o ignora |
| 3 | **Supabase:** *Authentication* → *Attack Protection* → *Enable Captcha protection*, provedor *Turnstile*, cole a *Secret Key* | cadastro, login, reenvio de confirmação e recuperação de senha passam a exigir o token |
| 4 | **Conferir** numa janela anônima: entrar com a conta de teste; pedir recuperação de senha; criar uma conta nova | tudo funciona como antes |

**Se algo der errado no passo 4** (mensagem "Não foi possível concluir a verificação de segurança" para todo mundo): desligue o CAPTCHA no Supabase (passo 3), que tem efeito imediato, e só depois investigue. Causas comuns: a *Site Key* não chegou ao deploy (faltou o novo deploy), ou o hostname do widget não inclui o endereço em uso (`linkss-black.vercel.app` não está na lista, de propósito).

**C. Migrações (expurgo e exclusão de conta).**

| # | Passo | Depois dele |
|---|---|---|
| 1 | **Backup feito e conferido** (`docs/runbooks/BACKUP.md`). Este é o primeiro deploy que **apaga dados sozinho** | — |
| 2 | `npx supabase db push`. Deve listar `202610110001_sprint9_retention_enum_values` e `202610110002_retention_and_account_erasure`. Só acrescentam funções; nenhuma tabela muda | o job das 07:00 UTC passa a rodar; a fila de privacidade ganha o quadro *Executar a exclusão* nos pedidos em análise |
| 3 | **Conferir o job à mão:** `curl -s -X POST https://linkfav.com/api/jobs/retention -H "Authorization: Bearer $CRON_SECRET"` | resposta `{"ok":true,...}` com as contagens; no primeiro dia ele apaga tudo o que já passou do prazo (`docs/runbooks/RETENTION.md`) |

**Rollback da aplicação depois da migração:** suportado. O código antigo não chama as funções novas; o cron some com o `vercel.json` antigo. **O que o job já apagou não volta** sem restaurar um backup.

**D. Regra do firewall da Vercel.** Passo a passo em `docs/runbooks/RATE_LIMITS.md` §1 (uma regra, começando em *Log*).

**Stack local.** Nenhuma variável nova é necessária: sem `NEXT_PUBLIC_TURNSTILE_SITE_KEY` não há widget, e o Auth local fica com o CAPTCHA desligado. O ensaio da exclusão é `node scripts/account-erasure.mjs` em `apps/web` (`docs/runbooks/ACCOUNT_DELETION.md`).

## Passos de deploy da Sprint 9, parte 3 (aviso de suspensão, contestação e monitor)

**Nada disto foi aplicado em produção.** Verificado só no stack local (ADR 0019). Qualquer ordem é segura: sem a migração, o aviso não aparece, a tela de contestação diz que não está disponível, os jobs seguem rodando (só não gravam a execução) e o monitor acusa `not_deployed`.

| # | Passo | Depois dele |
|---|---|---|
| 1 | **Merge do PR** | o workflow *Monitor* começa a rodar de hora em hora e confere que o site e a home respondem; sem o segredo, o último passo só emite um aviso |
| 2 | **Backup feito e conferido**, depois `npx supabase db push`. Deve listar `202610110003_sprint9_appeal_enum_values` e `202610110004_suspension_notice_and_ops_status`. Cria três tabelas que nenhum papel de cliente lê e troca uma função (`set_profile_moderation`, mesmo contrato) | uma página suspensa passa a mostrar o aviso à conta, com a tela de contestação; a fila de denúncias ganha a seção de contestações; cada job grava a própria execução |
| 3 | **Segredo do monitor:** gerar com `openssl rand -hex 32` (**não** reutilizar o `CRON_SECRET`); na Vercel, `OPS_STATUS_SECRET` (*Sensitive*) e novo deploy; no GitHub, *Settings* → *Secrets and variables* → *Actions* → secret `OPS_STATUS_SECRET` com o mesmo valor | `GET /api/ops/status` passa a responder; o monitor passa a vigiar jobs, cobrança e filas |
| 4 | **Conferir:** *Actions* → *Monitor* → *Run workflow* | execução verde, com a lista das onze verificações no log |
| 5 | Opcional: variável `MONITOR_PUBLIC_PAGE` no GitHub com o endereço de uma página publicada de teste | o monitor passa a exercitar a página pública |

**Na primeira execução depois do passo 3**, as verificações diárias podem falhar por causa de filas antigas (por exemplo, um pedido de privacidade de teste aberto há mais de 10 dias). É o comportamento esperado: resolva ou encerre o item.

**Rollback da aplicação depois da migração:** suportado. O código antigo chama `set_profile_moderation` com os mesmos argumentos (a suspensão continua sendo registrada) e não conhece as funções novas; o aviso some, e as contestações já enviadas ficam guardadas.

**Stack local.** Nada novo é obrigatório. O ensaio é `node scripts/moderation-appeal.mjs` em `apps/web`; para cobrir a rota de status, suba a aplicação com `OPS_STATUS_SECRET` e passe o mesmo valor ao script.

## Passos de deploy da Sprint 8, parte 2 (domínio próprio e pixels)

**Passos 1 e 2 aplicados em 10/10/2026** (PR #29 mergeado e migrações em produção); o passo 3 aparenta estar feito (a tela *Plano* lista domínio próprio, o que só acontece com o segredo no ambiente); o passo 4 depende da decisão sobre o plano da Vercel. **A conferência de ponta a ponta abaixo ainda não foi feita.** Verificado só no stack local, contra um resolvedor DNS de teste e um emulador da API da Vercel. Qualquer ordem é segura: sem a migração, a aba *Página* do editor diz que domínio e pixels ainda não estão disponíveis e a página pública funciona como antes; sem o segredo, ninguém consegue comprovar um domínio; sem as variáveis da Vercel, a comprovação funciona e a tela diz que a ativação automática não está disponível.

| # | Passo | Depois dele |
|---|---|---|
| 1 | **Merge do PR** em `main` (publica em staging). Todo Host que não seja o de `NEXT_PUBLIC_APP_URL` (com ou sem `www`), um endereço `*.vercel.app` ou local passa a ser tratado como domínio de cliente. **Conferir antes:** `NEXT_PUBLIC_APP_URL` do ambiente é o endereço pelo qual as pessoas entram (`https://linkfav.com`) | o produto abre normalmente em `linkfav.com`, `www.linkfav.com` e `linkss-black.vercel.app`; páginas publicadas passam a receber a política de segurança com as origens da Meta e do Google (nada é carregado sem pixel configurado e aceite) |
| 2 | **Migrações:** `npx supabase db push`. Deve listar `202610100001_sprint8_part2_enum_values` e `202610100002_custom_domains_and_pixels`. Acrescentam duas tabelas, quatro RPCs e a leitura por domínio; **recriam** `get_public_page` com duas colunas a mais (a função é apagada e criada na mesma transação) e reservam o endereço `d` | as seções *Domínio próprio* e *Meta Pixel e Google Analytics* aparecem na aba *Página*; pixels já funcionam em contas com plano pago; registrar um domínio funciona, verificar responde "não disponível" |
| 3 | **Segredo no Vault**, pelo SQL Editor: `select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'domains_signing_secret');`. Para copiar: `select decrypted_secret from vault.decrypted_secrets where name = 'domains_signing_secret';`. Na Vercel, `DOMAINS_SIGNING_SECRET` com **o mesmo valor** (*Sensitive*). Novo deploy | a verificação passa a ler o DNS e a comprovar; a tela diz que a ativação automática não está disponível |
| 4 | **Token da Vercel** (decisão do founder, ver abaixo): criar um token de acesso com escopo no time/conta do projeto; variáveis `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID` (em *Project Settings → General*) e, se o projeto for de um time, `VERCEL_TEAM_ID` (todas *Sensitive*). **Não** definir `VERCEL_API_BASE_URL` nem `DOMAINS_DNS_RESOLVER`. Novo deploy | um domínio comprovado é anexado ao projeto e a tela mostra o registro (CNAME ou A) que a Vercel recomenda; o certificado é emitido pela Vercel quando o DNS aponta para ela |

**Antes do passo 4, decidir:** o plano Hobby da Vercel é para uso não comercial e limita domínios por projeto. Vender domínio próprio pede o plano pago da Vercel (serviço pago novo). Sem o passo 4, cada domínio comprovado pode ser acrescentado à mão em *Project → Domains*.

**Conferência de ponta a ponta em staging (o founder roda; precisa de um domínio de teste que você controle):**

1. Pôr a conta de teste num plano pago (assinatura de teste, ou o `update` manual descrito acima).
2. Editor da página → aba *Página* (ou `…/paginas/<id>?aba=pagina`) → *Domínio próprio* → digitar um subdomínio seu, por exemplo `teste.seudominio.com.br`.
3. Criar o registro TXT mostrado (`_linkfav.teste.seudominio.com.br`) no painel de DNS; tocar em **Verificar**. Antes da propagação a tela diz que não encontrou; depois, "Controle comprovado".
4. Criar o registro CNAME (ou A) que a tela mostrar; **Verificar de novo** até "Domínio no ar". Abrir `https://teste.seudominio.com.br`: é a página publicada, com cadeado.
5. No mesmo domínio, abrir `/entrar` e `/app`: 404. Abrir a página no endereço do produto e ver, no código-fonte, o `canonical` com o domínio próprio.
6. Com uma segunda conta paga, registrar o mesmo domínio: com os dois registros TXT no DNS, "já está em uso"; apagando o TXT da primeira conta e verificando, o domínio muda de página e a primeira conta vê "Perdido".
7. Remover o domínio: 404 em até um minuto; em *Project → Domains* na Vercel ele some.
8. *Meta Pixel e Google Analytics*: salvar um ID de teste de cada; abrir a página publicada em janela anônima: aparece o aviso; com o painel de rede aberto, **nenhuma** requisição a `facebook` ou `google` antes de **Aceitar**; depois de aceitar, `fbevents.js` e `gtag/js` carregam sem erro de "Content Security Policy" no console, e a visita aparece em *Test Events* (Meta) e *Tempo real* (Google). **Este passo nunca foi executado:** qualquer bloqueio no console é um achado.
9. Tentar salvar `GTM-XXXXXXX`: recusado.
10. **Comparar com o emulador:** qualquer diferença entre o que a Vercel fez e o que este roteiro esperava é um achado para corrigir em `apps/web/src/modules/domains/vercel-adapter.ts`.

**Rollback da aplicação para antes desta parte depois das migrações:** suportado. O código antigo ignora as duas colunas novas de `get_public_page` e não conhece as tabelas; domínios de clientes passam a abrir a home do produto (o código antigo não tem a regra por Host) e os pixels deixam de carregar.

**Stack local.** `node scripts/domains-lifecycle.mjs` em `apps/web` (depois de `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100 npm run build --workspace=@lnk/web`) sobe o resolvedor DNS de teste, o emulador e a aplicação e percorre o ciclo de vida (77 verificações); `--serve` deixa no ar para o navegador; `--cleanup` remove as contas `qa-domains-*@example.test`. Ele cria o segredo `domains_signing_secret` no Vault local se não existir.

## Checklist de Auth para projetos hospedados (não aplicado)

Configurar em staging e produção **antes** de convidar usuários externos, espelhando `supabase/config.toml`. Nenhuma destas mudanças foi aplicada no projeto hospedado.

| Área | Configuração |
|---|---|
| URLs | Site URL = URL pública do ambiente; Redirect URLs exatas: `<APP_URL>/auth/confirm` (sem curingas em produção) |
| E-mail | Confirmação de e-mail obrigatória; "Secure password change" ligado; frequência mínima de 60 s entre e-mails; OTP/link com validade de 3600 s |
| Senha | Mínimo 8 caracteres, requisito "letters and digits"; ativar proteção contra senhas vazadas quando o plano permitir |
| Templates | Confirmação, recuperação e troca de e-mail com links `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=…` (conteúdo em `supabase/templates/`). Projetos Free com SMTP padrão não permitem customizar templates desde 2026-06-03: **SMTP próprio é pré-requisito** (decisão de provedor + atualização do `DATA_MAP.md`) |
| Rate limits | Sign-in/sign-up e verificações por IP iguais ou mais estritos que o local (30 por 5 min); envio de e-mails conforme o SMTP contratado |
| CAPTCHA | Ativar Turnstile no Auth antes do piloto externo (fecha a enumeração direta por `/auth/v1/recover`). **Só depois** de a chave do site estar no deploy: passos em "Passos de deploy da Sprint 9, continuação", bloco B |
| API | Data API expondo apenas `public`; conferir que novas tabelas não são auto-expostas |
| Migrações | Aplicar `supabase/migrations/` em ordem via pipeline, nunca pelo dashboard |
| Segredos | `SUPABASE_SECRET_KEY` apenas no runtime servidor; publishable key em `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |

## Endereço público e domínio (Sprint 3)

`NEXT_PUBLIC_APP_URL` é a única origem pública: canonical, `og:url`, `metadataBase`, `robots.txt`, endereços exibidos no app e links de e-mail. Como é `NEXT_PUBLIC_*`, o valor entra no build; trocar de domínio exige novo deploy.

| Ambiente | Valor |
|---|---|
| local | `http://localhost:3000` (ou a porta usada) |
| preview/staging | `https://linkss-black.vercel.app` |
| produção | `https://linkfav.com` (domínio escolhido em 10/10/2026). Em 10/10/2026 `linkfav.com` e `www.linkfav.com` respondiam com a aplicação e o `robots.txt` já saía com `https://linkfav.com` (conferido por HTTP a partir deste repositório); o deploy `linkss-black.vercel.app` responde com o mesmo valor, ou seja, hoje há um só ambiente hospedado. Site URL e Redirect URLs do Auth não foram conferidos |

Checklist ao comprar o domínio:

1. Apontar DNS para a Vercel e aguardar o certificado.
2. Atualizar `NEXT_PUBLIC_APP_URL` em produção e fazer novo deploy.
3. Atualizar Site URL e Redirect URLs do Auth (`<APP_URL>/auth/confirm`).
4. Conferir `view-source` de uma página publicada (canonical e `og:url` com o domínio novo) e `robots.txt`.
5. Prévias antigas no WhatsApp/Instagram ficam no cache deles; não há como forçar atualização.

## Cache das páginas públicas

- `/[slug]` e `/[slug]/opengraph-image` usam ISR sob demanda (`revalidate = 60`). A publicação invalida os caminhos na hora; os 60 s são só o fallback.
- Na Vercel o cache é compartilhado entre instâncias. Self-hosting com várias instâncias exige `cacheHandler` compartilhado.
- O cache de arquivos do `next start` local não diferencia maiúsculas no Windows/macOS; o proxy redireciona grafias não canônicas antes do cache.
- Para verificar localmente: `npm run build && npx next start` e observar `x-nextjs-cache`; `NEXT_PRIVATE_DEBUG_CACHE=1` detalha hits/misses.

## Passos de deploy das lacunas das Sprints 8 e 9 (11/10/2026)

**Nada disto foi aplicado em produção.** Verificado só no stack local.

| # | Passo | Depois dele |
|---|---|---|
| 1 | **Merge do PR** | a página pública declara a cor do tema ao navegador e pede a primeira imagem antes; o webhook passa a registrar por que a cobrança está desligada; o quinto cron (`/api/jobs/domains`, 08:00 UTC) responde 503 `not_deployed` até a migração |
| 2 | **Backup conferido** e `npx supabase db push`. Deve listar `202610110005_export_and_domain_recheck` (depende das migrações `202610110003` e `202610110004`, aplicadas antes ou junto). Acrescenta duas colunas com padrão, funções e um gatilho; troca `export_workspace_data` pela mesma função com quatro chaves a mais | a exportação da conta inclui domínios, pixels, suspensões e contestações; a reverificação diária começa a contar |
| 3 | Conferir: `curl -s -X POST https://linkfav.com/api/jobs/domains -H "Authorization: Bearer $CRON_SECRET"` | `{"ok":true,"checked":0,...}` enquanto não houver domínio ativo |

**Ordem com os outros pendentes:** o monitor acusa `job:domains` se o código estiver no ar sem esta migração por mais de 36 horas depois de `OPS_STATUS_SECRET` existir. Aplique as três migrações de 11/10 juntas.

**Rollback da aplicação depois da migração:** suportado; o código antigo não lê as colunas novas.
