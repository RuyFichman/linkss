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

**Plano Agência em staging antes da cobrança (Sprint 8).** Toda conta nasce no plano Free (1 página, 1 pessoa, sem relatório compartilhável) e `workspaces.plan_id` não tem interface nem `grant`: só muda por SQL. Para testar várias páginas, convites, 90 dias de histórico e links de relatório, depois de criar a conta da agência pela interface, rode no *SQL Editor* do projeto de staging:

```sql
update public.workspaces set plan_id = 'agency' where id = '<id da conta, o que aparece na URL /app/w/...>';
```

Isso é um passo manual do founder, não uma migração. A Sprint 8 substitui por cobrança.

**Stack local.** `node scripts/agency-scale.mjs` (em `apps/web`, com um `next start -p 3100` rodando) mede lista, consolidado e criação com 1, 10 e 50 páginas e deixa no banco a conta `qa-ac5-escala@example.test`; `--cleanup` remove tudo o que ele criou.

## Checklist de Auth para projetos hospedados (não aplicado)

Configurar em staging e produção **antes** de convidar usuários externos, espelhando `supabase/config.toml`. Nenhuma destas mudanças foi aplicada no projeto hospedado.

| Área | Configuração |
|---|---|
| URLs | Site URL = URL pública do ambiente; Redirect URLs exatas: `<APP_URL>/auth/confirm` (sem curingas em produção) |
| E-mail | Confirmação de e-mail obrigatória; "Secure password change" ligado; frequência mínima de 60 s entre e-mails; OTP/link com validade de 3600 s |
| Senha | Mínimo 8 caracteres, requisito "letters and digits"; ativar proteção contra senhas vazadas quando o plano permitir |
| Templates | Confirmação, recuperação e troca de e-mail com links `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=…` (conteúdo em `supabase/templates/`). Projetos Free com SMTP padrão não permitem customizar templates desde 2026-06-03: **SMTP próprio é pré-requisito** (decisão de provedor + atualização do `DATA_MAP.md`) |
| Rate limits | Sign-in/sign-up e verificações por IP iguais ou mais estritos que o local (30 por 5 min); envio de e-mails conforme o SMTP contratado |
| CAPTCHA | Ativar Turnstile no Auth antes do piloto externo (fecha a enumeração direta por `/auth/v1/recover`) |
| API | Data API expondo apenas `public`; conferir que novas tabelas não são auto-expostas |
| Migrações | Aplicar `supabase/migrations/` em ordem via pipeline, nunca pelo dashboard |
| Segredos | `SUPABASE_SECRET_KEY` apenas no runtime servidor; publishable key em `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |

## Endereço público e domínio (Sprint 3)

`NEXT_PUBLIC_APP_URL` é a única origem pública: canonical, `og:url`, `metadataBase`, `robots.txt`, endereços exibidos no app e links de e-mail. Como é `NEXT_PUBLIC_*`, o valor entra no build; trocar de domínio exige novo deploy.

| Ambiente | Valor |
|---|---|
| local | `http://localhost:3000` (ou a porta usada) |
| preview/staging | `https://linkss-black.vercel.app` até existir domínio |
| produção | domínio comprado (previsto para o próximo mês) |

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
