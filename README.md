# Linkfav

Plataforma brasileira de conversão mobile orientada a páginas profissionais, resultados compreensíveis e operação multi-perfil. O nome Linkfav e o domínio `linkfav.com` foram escolhidos pelo fundador em 10/10/2026; `Projeto LNK` era o codinome anterior e permanece em documentos históricos e identificadores internos.

## Requisitos e execução

- Node.js 24
- npm 11+
- Docker (somente para o Supabase local e os testes de banco)

```bash
npm install
npm run db:start                 # Supabase local: Postgres, Auth, PostgREST, Storage, Studio, Mailpit
copy .env.example apps\web\.env.local
npm run dev
```

Em shells Unix use `cp .env.example apps/web/.env.local`. Preencha `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` com `API_URL` e `PUBLISHABLE_KEY` de `npx supabase status`.

A aplicação fica em `http://localhost:3000`; health check em `/api/health`.

### E-mail local

Os e-mails de confirmação e recuperação não saem da máquina: abra o Mailpit em `http://127.0.0.1:54324`. Os links apontam para `http://localhost:3000/auth/confirm` e expiram em 1 hora. Use endereços `@example.test` para contas de teste.

### Banco de dados

```bash
npm run db:reset    # reaplica supabase/migrations e supabase/seed.sql
npm run test:db     # testes pgTAP (isolamento entre tenants, papéis, slugs, entitlements, auditoria)
npm run db:types    # regenera apps/web/src/lib/database.types.ts
npm run db:stop
```

Migrações nunca são aplicadas em projetos hospedados por este fluxo; veja `docs/ENVIRONMENTS.md`.

### Imagens e formulários no ambiente local (Sprint 5)

O envio de imagens precisa do mesmo segredo na aplicação e no banco. Em `apps/web/.env.local`, preencha `MEDIA_SIGNING_SECRET` (64 caracteres hexadecimais), `VISITOR_HASH_SALT` e, para testar a limpeza, `CRON_SECRET` e `SUPABASE_SECRET_KEY`. No banco local, uma vez:

```sql
select vault.create_secret('<mesmo valor de MEDIA_SIGNING_SECRET>', 'media_signing_secret');
```

Sem isso o editor mostra o envio como indisponível; o restante funciona. Detalhes e passos para o ambiente hospedado em `docs/ENVIRONMENTS.md`.

### Resultados (analytics) no ambiente local (Sprint 6)

A contagem precisa do mesmo segredo na aplicação e no banco: `ANALYTICS_SIGNING_SECRET` (64 caracteres hexadecimais) em `apps/web/.env.local` e, no banco local, uma vez:

```sql
select vault.create_secret('<mesmo valor de ANALYTICS_SIGNING_SECRET>', 'analytics_signing_secret');
```

Sem isso as páginas públicas funcionam, os eventos são descartados e o painel mostra "Resultados ainda não disponíveis". Quem está com a conta aberta no mesmo navegador não é contado: teste numa guia anônima. O teste de precisão (AC5) roda contra um `next start` local: `node scripts/analytics-accuracy.mjs` em `apps/web` (instruções no cabeçalho do arquivo).

## Rotas da Sprint 8 (parte 1: planos e cobrança)

- `/app/w/[workspaceId]/plano` — plano atual e situação da assinatura, os três planos com preços mensal e anual, histórico de pagamentos (proprietário), assinar, mudar de plano, cancelar e manter. Administrador vê o plano sem ações; editor não vê a tela.
- `/app/w/[workspaceId]/plano/confirmar` — o passo antes de cancelar ou mudar de plano: lista, com os números da conta, o que continua, o que fica acima do limite e o que deixa de funcionar.
- `/app/w/[workspaceId]/plano/retorno` — volta do checkout: mostra o que o banco diz e espera sozinha pela confirmação do provedor.
- `/api/billing/webhook` — recebe os eventos do provedor de pagamento (assinatura conferida sobre o corpo bruto; 200, 400 ou 503).
- `/api/jobs/billing` — job diário de cobrança (`GET` pelo Vercel Cron às 05:00 UTC ou `POST` à mão, com `Authorization: Bearer <CRON_SECRET>`): encerra prazos vencidos e relê no provedor o que não foi lido há um dia.

Nenhuma rota nova de nível superior. A cobrança fica **desligada** (`BILLING_MODE=off`, o padrão) até existirem a conta no provedor e os segredos: sem isso a tela *Plano* mostra o plano e os preços e não oferece nada. Decisões em `docs/adr/0014-payments-subscriptions-and-webhooks.md`; operação em `docs/runbooks/BILLING.md`.

### Cobrança no ambiente local

Não existe sandbox que chame `localhost`, então o ambiente local usa um emulador da API da Stripe que mora no repositório:

```bash
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100 npm run build --workspace=@lnk/web
cd apps/web
node scripts/billing-lifecycle.mjs            # sobe emulador + aplicação, percorre o ciclo de vida inteiro e sai
node scripts/billing-lifecycle.mjs --serve    # deixa os dois no ar para usar no navegador (imprime as contas de teste)
node scripts/billing-lifecycle.mjs --cleanup  # remove as contas qa-billing-*@example.test
```

O script cria, se não existir, o segredo `billing_signing_secret` no Vault local e inicia a aplicação com as variáveis de cobrança; não é preciso mexer no `.env.local`. O emulador segue a documentação da Stripe, não a Stripe.

## Rotas da Sprint 7

- `/app/w/[workspaceId]` — lista de páginas com busca por nome ou endereço, filtro por situação, ordem e paginação na URL (`?q=`, `?situacao=`, `?ordem=`, `?pagina=`), uso do plano e as ações Editar, Resultados, Duplicar e Arquivar conforme o papel.
- `/app/w/[workspaceId]/paginas/[profileId]/duplicar` — cria uma cópia em rascunho (nome e endereço próprios) na mesma conta.
- `/app/w/[workspaceId]/membros` — pessoas com acesso e papéis; proprietário e administrador convidam (o link é copiado por quem convida; não há envio de e-mail), cancelam convites, mudam papéis e removem.
- `/app/convite/[token]` — aceite de convite; exige sessão com o mesmo e-mail convidado.
- `/app/w/[workspaceId]/resultados` — resultados da conta: totais, páginas ordenadas por resultados, dia a dia e origens; `/resultados/exportar` baixa o CSV com uma linha por página.
- `/app/w/[workspaceId]/paginas/[profileId]/resultados` — ganhou a seção "Relatório para o cliente": proprietário e administrador criam um link (período, validade, anotação), copiam uma vez e cancelam.
- `/r/[token]` — relatório somente leitura de uma página, sem conta; todo link que não abre relatório recebe o mesmo 404.

Para testar localmente com mais de uma página e mais de uma pessoa, coloque a conta no plano Agência: `update public.workspaces set plan_id = 'agency' where id = '<id da conta>';` (um plano definido assim aparece na tela *Plano* como "Definido manualmente"; o caminho normal, desde a Sprint 8, é a assinatura). Links de relatório e 90 dias de histórico também dependem desse plano. Decisões em `docs/adr/0012-multi-page-operations-invitations-and-roles.md` e `docs/adr/0013-consolidated-analytics-and-report-links.md`. A medição da décima página roda contra um `next start` local: `node scripts/agency-scale.mjs` em `apps/web` (instruções no cabeçalho; `--cleanup` remove o que ele cria).

## Rotas da Sprint 6

- `/app/w/[workspaceId]/paginas/[profileId]/resultados` — resultados da página por período (hoje, 7, 30 e 90 dias conforme o plano): visitas, resultados, caminho até o resultado, dia a dia, blocos, origens, aparelhos, países e campanhas; `/resultados/exportar` baixa o CSV dos totais por dia.
- `/api/events` — recebe os eventos das páginas públicas (sempre 204, sem corpo).
- `/api/jobs/analytics` — job diário de agregação e limpeza (`GET` pelo Vercel Cron às 04:00 UTC ou `POST` à mão, com `Authorization: Bearer <CRON_SECRET>`; `?day=AAAA-MM-DD` re-agrega um dia).
- `/<endereço>` — a página pública agora envia visitas e cliques; continua estática e funciona com scripts bloqueados.

Nenhuma rota nova de nível superior.

## Rotas da Sprint 5

- `/app/w/[workspaceId]/paginas/[profileId]` — o editor ganhou foto da página (envio com recorte), blocos Imagem, Vídeo ou música, Pix e Formulário, o painel Aparência (cores, estilo, fonte), cinco modelos e o uso de armazenamento.
- `/app/w/[workspaceId]/paginas/[profileId]/contatos` — contatos recebidos pelos formulários (lista, exclusão); `/contatos/exportar` baixa o CSV (owner e admin).
- `/api/media` — recebe o envio de imagem do editor (sessão do usuário, mesma origem).
- `/api/ops/status` — situação operacional lida pelo monitor externo (`GET` com `Authorization: Bearer <OPS_STATUS_SECRET>`; `docs/runbooks/MONITORING.md`).
- `/api/jobs/retention` — job diário de expurgo (`GET` pelo Vercel Cron às 07:00 UTC ou `POST` à mão, com `Authorization: Bearer <CRON_SECRET>`): apaga o que passou do prazo de retenção (`docs/runbooks/RETENTION.md`).
- `/api/jobs/media-cleanup` — job administrativo de limpeza de imagens órfãs (`GET` pelo Vercel Cron diário ou `POST` à mão, sempre com `Authorization: Bearer <CRON_SECRET>`).
- `/<endereço>` — a página pública renderiza tema, foto, imagens responsivas, cartão de vídeo/música com carregamento no toque, Pix com copiar e formulário (funciona sem JavaScript).

Nenhuma rota nova de nível superior (`/api` e `/app` já eram reservadas).

## Rotas da Sprint 4

- `/app/w/[workspaceId]/paginas/[profileId]` — editor por blocos (link, texto, redes sociais, WhatsApp, separador) com autosave, desfazer, prévia móvel ao lado e publicação; abaixo, versões publicadas, endereço e exclusão. Nenhuma rota nova de nível superior.

## Rotas da Sprint 3

- `/<endereço>` — página pública publicada (ISR). Grafias não canônicas redirecionam (308); endereço trocado redireciona (307) durante a retenção; não publicada ou inexistente → 404; workspace suspenso → "Página indisponível".
- `/<endereço>/opengraph-image` — imagem de prévia (1200×630).
- `/app/w/[workspaceId]/paginas/[profileId]` — agora com publicação, versões, redes sociais e links; `/previa` mostra o rascunho com o renderer público.
- `/api/vitals` — recebe Web Vitals das páginas públicas.
- `/robots.txt`.

A origem pública (canonical/OG) vem de `NEXT_PUBLIC_APP_URL`. Para testar o cache como em produção: `npm run build` e `npx next start` em `apps/web`.

## Rotas da Sprint 2

- `/cadastro`, `/entrar`, `/confirmar-email`, `/recuperar-acesso`, `/redefinir-senha` — autenticação em pt-BR.
- `/auth/confirm` — valida links de e-mail (`token_hash`).
- `/app` — área autenticada: redireciona para o onboarding ou para a conta pessoal.
- `/app/comecar` — criação da primeira página.
- `/app/w/[workspaceId]` — páginas da conta, uso do plano e criação.
- `/app/w/[workspaceId]/paginas/nova` e `/app/w/[workspaceId]/paginas/[profileId]` — nova página e configurações (conteúdo, endereço, exclusão).
- `/app/contas/nova` — criar conta da agência.

Todas as rotas de nível superior são reservadas como slugs (teste automatizado).

## Rotas da Sprint 1

### Marketing e pesquisa

- `/` — landing neutra e lista do piloto.
- `/agencias` — variante para agência/social media.
- `/profissionais` — variante para profissionais e pequenos negócios.
- `/privacidade` — aviso provisório da lista.

### Protótipo

- `/proto` — cenários, reset e entradas J1/J2.
- `/proto/cadastro` — cadastro simulado.
- `/proto/onboarding` — objetivo, template e endereço.
- `/proto/editor/[profileId]` — editor, preview e publicação simulada.
- `/proto/p/[slug]` — página pública simulada.
- `/proto/analytics/[profileId]` — resultados mockados.
- `/proto/w/agencia-aurora/perfis` — operação multi-perfil.
- `/proto/r/[token]` — relatório somente leitura.
- `/proto/tokens` — tokens e estados dos componentes.

Todas as rotas `/proto` são `noindex, nofollow`, mostram o selo **Protótipo** e persistem somente em `localStorage` sob `lnk-proto:v1`. A landing não contém link para o protótipo.

## Painel de depuração

Abra qualquer rota do protótipo com `?debug=1` ou pressione `Alt+Shift+D`. O painel pode forçar erro/lentidão de salvamento, erro de publicação e estados de analytics; também mostra a timeline e copia JSON da sessão.

## Sessão de usabilidade

1. Abra `/proto` em um perfil de navegador dedicado.
2. Clique **Reiniciar protótipo**.
3. Mantenha o debug oculto do participante.
4. Aplique T1 e, para agências, T2 de `docs/research/USABILITY_TEST_PLAN.md` sem instrução verbal.
5. Abra o debug ao final e copie a timeline JSON.

Os cinco testes humanos ainda não foram executados; portanto, os gates de 5/5 publicarem e 4/5 em menos de 10 minutos permanecem preparados, não atendidos.

## Lista de espera

Em desenvolvimento/teste, `WAITLIST_STORE=memory`. Para uso real, configure `WAITLIST_STORE=supabase`, `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SECRET_KEY`, e aplique de forma controlada a migração em `supabase/migrations/`. Se storage não estiver configurado em produção, o formulário falha de modo visível e nunca mostra falso sucesso.

## Qualidade

```bash
npm run check     # lint (0 warnings) + typecheck + Vitest + build — não precisa de Docker
npm run test:db   # pgTAP no Supabase local — precisa de Docker
```

O CI roda os dois em jobs separados (`quality` e `database`).

## Estrutura

```text
apps/web/src/app/(marketing)/  landing e privacidade
apps/web/src/app/proto/        rotas descartáveis do protótipo
apps/web/src/prototype/        store local, cenários e instrumentação
apps/web/src/ui/               componentes acessíveis que graduam
apps/web/src/app/(auth)/       autenticação
apps/web/src/app/app/          área autenticada
apps/web/src/modules/          identity, profiles, blocks, editor, publishing, media, themes, leads, analytics, reports, billing, entitlements, audit, waitlist
apps/web/src/lib/supabase/     clientes Supabase (server, browser, proxy)
docs/ux/                       jornadas, wireframes, tokens e decisões
docs/research/                 entrevistas e teste de usabilidade
supabase/migrations/           migrações versionadas (aplicadas só no stack local)
supabase/tests/database/       testes pgTAP
```

## Documentos principais

- `AGENTS.md` e `CLAUDE.md`
- `PLANO_DE_NEGOCIO.md`
- `PLANO_DE_EXECUCAO.md`
- `docs/ARCHITECTURE.md`
- `docs/SPRINT_0_REPORT.md`
- `docs/SPRINT_1_REPORT.md`
- `docs/SPRINT_2_REPORT.md`
- `docs/SPRINT_3_REPORT.md`
