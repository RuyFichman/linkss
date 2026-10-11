# Relatório da Sprint 9 — segurança, LGPD, abuso e prontidão operacional

**Data:** 09/10/2026. **Branch:** `codex/sprint-9-private-mvp`, criada de `4a09b21` (o conteúdo da PR #25, já em `main`). **Estado: sprint parcial; o gate do MVP privado não está liberado.**

A sprint foi feita em duas sessões. A primeira (Codex) escreveu o código, as migrações, o teste de banco e as minutas, e parou sem acesso ao banco local: as migrações nunca tinham sido aplicadas. A segunda (Claude Code) aplicou as migrações no stack local, corrigiu o que os testes de banco revelaram, regenerou os tipos, conferiu no navegador e reescreveu este relatório, que antes citava documentos que não tinham sido alterados.

Nada foi aplicado em staging ou produção: nenhuma migração, segredo, configuração de borda ou texto jurídico.

## Objetivo e resultado

O objetivo de `PLANO_DE_EXECUCAO.md` é transformar o produto funcional em um MVP privado operável. Esta entrega põe no repositório: aceite versionado, exportação JSON, pedidos auditáveis de acesso e de exclusão, denúncia pública, fila de moderação com suspensão e reativação por página, headers de segurança com CSP, leitura limitada do corpo nos endpoints anônimos, a atualização do Next para 16.4.0 e as minutas jurídicas para revisão.

**Não foram feitos:** backup e restauração, runbooks novos, alertas, limites globais na borda, QA em Edge e em celular, revisão de acessibilidade, seed/demo e documentação de suporte. A exclusão de conta é só um pedido registrado: a execução é manual e não tem procedimento escrito.

## Decisões

- **ADR 0015.** Textos jurídicos ficam em `legal_documents`, com uma versão ativa por tipo, corpo imutável depois de ativado e SHA-256 calculado pelo Postgres. Nenhuma minuta entra no seed nem é ativada por migração desta sprint. Termos e Aviso de Privacidade ativos exigem aceite explícito de quem tem sessão; uma versão nova exige novo aceite. A política de cookies é só informativa. Ativar apenas um dos dois textos bloqueia a área autenticada até o operador corrigir.
- **Exportação pessoal separada da exportação da conta.** Só o proprietário baixa o JSON da conta (rascunhos, publicações, leads, agregados, convites, links de relatório, cobrança). Hashes de visitante, hashes de token e arquivos de mídia ficam fora. Limite de 8 MiB por download.
- **Exclusão é pedido, não expurgo.** Assinatura em curso ou outras pessoas numa conta que a pessoa administra põem o pedido em `needs_action`. A fila administrativa registra cada transição e não deixa concluir uma exclusão enquanto a linha de `auth.users` existir. Nenhum prazo legal de guarda foi inventado.
- **Denúncia anônima com resposta neutra.** Página inexistente, denúncia repetida e limite atingido recebem a mesma confirmação. O banco só aceita denúncia assinada pelo servidor (HMAC conferido contra o Vault). Limites: 3 por endereço e 30 por página a cada 24 horas.
- **Administrador da plataforma fora da aplicação.** `platform_admins` é preenchida por SQL; nenhum papel de conta suspende ou reativa página.
- **Filas administrativas só por RPC** (decisão da segunda sessão). `moderation_reports` não tem leitura por nenhum papel de cliente, e `privacy_requests` só mostra as linhas da própria pessoa. Assim nenhum papel de cliente precisa executar funções do schema `private`, e as regras de `010-structure` continuam valendo.
- **CSP com `unsafe-inline`** para scripts e estilos, porque o App Router emite scripts inline e o tema usa estilos inline. Uma política com nonce tornaria dinâmica a página pública em cache e precisa de desenho próprio. O CSP atual bloqueia objetos, frames fora da lista de embeds, atributos de evento e envio de formulário para outra origem; não é defesa completa contra XSS.

## Correções feitas na segunda sessão

| Problema encontrado | Correção |
|---|---|
| `202610090004_legal_privacy` não aplicava: a coluna gerada `body_sha256` chamava `convert_to`, que não é imutável (`42P17`) | função `private.text_sha256` marcada `immutable`, usada pela coluna |
| `anon` recebia `select` em `legal_documents`, contra a regra "anon não tem privilégio de tabela em `public`" | concessão removida; visitante lê o texto ativo pela RPC `get_legal_status` |
| quatro funções novas de `private` ficavam executáveis por `authenticated` e três por `anon` | `revoke` explícito; as políticas deixaram de chamar `private.is_platform_admin` |
| o teste 180 esperava `LK115` de uma usuária que nem tem permissão de escrita na tabela, e lia a fila direto da tabela como administrador | o teste passa a provar a imutabilidade como operador e usa as RPCs da fila |
| `010-structure` não conhecia as duas RPCs anônimas novas | lista atualizada: `get_legal_status` e `submit_moderation_report` |
| chamadas de RPC com `as never` porque os tipos não existiam | tipos regenerados (`npm run db:types`) e casts removidos |

## Critérios de aceite

| Critério | Estado | Evidência e pendência |
|---|---|---|
| Termos, Privacidade e Cookies com aceite versionado | **Implementado e verificado no banco local; textos não aprovados** | `docs/legal/`, migração `202610090004`, `/aceite`, `/termos`, `/privacidade`, `/cookies`; pgTAP 180 (aceite, repetição, hash errado, versão nova, histórico, outra conta). A tela `/aceite` não foi exercitada no navegador. Nenhuma versão ativa. |
| Exportação e exclusão percorrem todos os stores ou registram exceção | **Parcial** | exportação e pedidos verificados por pgTAP 180 (outra conta, editor, anônimo, repetição). Inventário por store em `docs/DATA_MAP.md`. Faltam: execução da exclusão, exportação dos arquivos de mídia, retenções aprovadas. As telas não foram exercitadas no navegador com sessão. |
| Rate limits, enumeração, CSRF/XSS/SQLi, autorização/RLS, headers/CSP | **Parcial** | headers e CSP em todas as respostas (Vitest `security.test.ts`; conferidos por `curl` e no Chrome). Leitura limitada em `/api/events` e `/api/vitals`. Revisão transversal em `docs/THREAT_MODEL.md`. **Sem limite global na borda**, sem CAPTCHA. |
| Nenhuma vulnerabilidade crítica/alta conhecida | **Não atendido** | `npm audit --omit=dev`: zero. `npm audit` completo: 5 avisos altos na cadeia de desenvolvimento `eslint-config-next → braces`, sem correção publicada. |
| Denúncia, fila, investigação, suspensão e reativação auditadas | **Implementado e verificado localmente** | pgTAP 180 (sem assinatura, página inexistente, repetida, dono tentando suspender, suspensão, reativação). Uma denúncia enviada pelo Chrome chegou à tabela e à auditoria. A fila administrativa não foi exercitada no navegador. Faltam aviso ao dono e contestação. |
| Backup restaurado em ambiente isolado | **Não iniciado** | nenhum procedimento escrito, nenhuma restauração feita. |
| Runbooks de renderer, jobs e webhooks; alertas com responsável, limiar e ação | **Não iniciado** | nenhum arquivo em `docs/runbooks/` nem `docs/OBSERVABILITY.md` mudou nesta sprint. |
| Smoke em Chrome, Edge e Safari móvel; acessibilidade prioritária | **Não atendido** | só Chrome de desktop, sem sessão: página pública, `/denunciar`, `/termos`, `/cookies`, `/privacidade`, `/entrar`. Edge, celular e leitor de tela não testados. |
| Seed/demo e documentação de suporte | **Não iniciado** | `supabase/seed.sql` não mudou. |

## Entregáveis para revisão

| Área | Arquivos / rotas |
|---|---|
| Jurídico | `docs/legal/{TERMOS_DE_USO_MINUTA,AVISO_DE_PRIVACIDADE_MINUTA,COOKIES_MINUTA,REVISAO_JURIDICA}.md`; `/termos`, `/privacidade`, `/cookies` |
| Aceite e privacidade | `apps/web/src/modules/legal/`, `apps/web/src/modules/privacy/`, `/aceite`, `/app/conta/dados`, `/app/administracao/privacidade`; migrações `202610090003` e `202610090004` |
| Moderação | `apps/web/src/modules/moderation/`, `/denunciar`, `/app/administracao/denuncias`; migração `202610090005` |
| Segurança | `apps/web/next.config.ts`, `apps/web/src/lib/security/`, `apps/web/src/lib/same-origin.ts`, `/api/events`, `/api/vitals`, `docs/THREAT_MODEL.md` |
| Dados e deploy | `docs/DATA_MAP.md` (stores novos e inventário de exportação/exclusão), `docs/ENVIRONMENTS.md` ("Passos de deploy da Sprint 9"), `docs/adr/0015-legal-privacy-and-moderation.md` |
| Testes | `supabase/tests/database/180-sprint9-privacy-moderation.test.sql`, `010-structure.test.sql`, `security.test.ts`, `moderation/contract.test.ts` |

## Verificação realizada (09/10/2026, stack local)

- `npm run check`: **passou**. Lint sem avisos; TypeScript sem erros; Vitest **1.144 testes em 41 arquivos**; build de produção concluído com as rotas novas.
- `npx supabase test db`: **1.156 asserções em 20 arquivos, todas aprovadas**, com as três migrações aplicadas por `supabase migration up`. O arquivo 180 tem 40 asserções.
- `npx supabase db lint --level warning`: um aviso, anterior a esta sprint (`private.billing_text_is_timestamp`, da Sprint 8).
- Build de produção servido em `localhost:3100`: as dez rotas novas e alteradas responderam (200, ou 307 para o login nas que pedem sessão); os cinco headers presentes na página pública, que manteve `s-maxage=60`.
- Chrome de desktop: a página pública `precisao-analytics` renderizou e hidratou, sem violação de CSP no console. Uma denúncia enviada por `/denunciar` foi gravada com hash de endereço e evento de auditoria. A linha de teste e o segredo temporário do Vault local foram removidos depois.
- **Não verificado em 09/10:** o carregamento do embed depois do clique sob o CSP; as telas com sessão; o editor e o upload de imagem sob o CSP; qualquer coisa em staging. Os três primeiros foram cobertos na estabilização abaixo.

## Estabilização (10/10/2026, stack local, depois do merge do PR #26)

Revisão do código da sprint e verificação em navegador (Chrome via Playwright, build de produção em `localhost:3100`, contas descartáveis `qa-s9-*@example.test`, removidas ao final). Defeitos encontrados e corrigidos:

- **Horários no fuso do servidor.** *Meus dados* e as duas filas usavam `toLocaleString` sem fuso; na Vercel sairiam em UTC, três horas à frente. Passaram a usar `formatDateTime` (horário de São Paulo).
- **Publicar página suspensa pedia para tentar de novo.** O erro `LK113` caía em "Não foi possível publicar agora". Agora o dono lê que a página foi suspensa pela moderação.
- **Denúncia recusada aparecia como recebida.** Uma resposta `invalid` do banco (carga recusada, relógio fora da janela de 5 minutos) levava à confirmação. Agora só `received` confirma; o resto mostra canal indisponível.
- **Um só texto jurídico ativo travava `/app`.** O portão exigia aceite com apenas Termos ou apenas Privacidade ativo, mas `/aceite` só registra os dois juntos. O portão (`modules/legal/gate.ts`, com teste) agora fecha apenas com os dois ativos.

Verificado no navegador, 27 verificações aprovadas: `/app` sem redirecionar para `/aceite` (nenhum texto ativo); *Meus dados* a 390 px sem rolagem horizontal; download do JSON pessoal (sem campo de credencial) e do JSON da conta; pedidos de acesso e de exclusão no histórico, sem duplicar e sem apagar nada; filas vistas pelo administrador da plataforma e tela de "não encontrada" para conta comum; suspensão pela fila, estado suspenso na página pública logo depois, mensagem ao dono ao publicar e reativação; página pública com o player do YouTube aberto pelo clique, sem violação de CSP. A regressão do editor móvel (`scripts/editor-mobile.mjs`, 45 verificações, inclui envio de imagem) passou sob o CSP.

- `npm run check`: **passou**; Vitest **1.148 testes em 42 arquivos**.
- **Continua não verificado:** `/aceite` com textos ativos (ativá-los no banco local prenderia as contas de teste do fundador; o fluxo tem só pgTAP); envio de denúncia pelo formulário nesta rodada (a denúncia da fila foi inserida por SQL; o envio foi verificado em 09/10); Vimeo e Spotify; Edge, celular real e staging.
- **Observações sem correção:** as filas respondem 200 com a tela de "não encontrada" para quem não é administrador (o `loading.tsx` de `/app` inicia a resposta antes), sem expor dados; sem `VISITOR_HASH_SALT` ou sem endereço do visitante, todas as denúncias compartilham o limite de 3 por dia; se a consulta dos textos jurídicos falhar por outro motivo que não a migração ausente, `/app` mostra erro em vez de abrir sem checar o aceite.

## Segurança, privacidade, acessibilidade, desempenho e operação

- **Risco de regressão do CSP.** Ele vale para todas as páginas e só foi conferido em parte. O primeiro passo de deploy em `docs/ENVIRONMENTS.md` é conferir página pública, editor e login no navegador.
- **`/privacidade` deixou de ser estática:** consulta o banco a cada visita para saber se há texto ativo. Sem a migração, mostra o aviso provisório; com o banco fora do ar, responde erro.
- **Página suspensa:** `get_public_page` responde `suspended` e a publicação é recusada. O envio de formulário e a ingestão de eventos por chamada direta à RPC não consultam `moderation_status`.
- **Limite por endereço da denúncia:** sem cabeçalho de endereço, todas as denúncias caem no mesmo hash `direct` e dividem o limite de 3 por dia.
- **Exportação grande:** a conta que passar de 8 MiB recebe 413 e depende do pedido manual, que não tem procedimento.
- **Acessibilidade:** os formulários novos têm rótulos e mensagens com `role`; não houve inspeção por teclado nem por leitor de tela.
- **Desempenho:** nenhuma medição nova de LCP ou CLS. A página pública ganhou um link de rodapé "Denunciar esta página".

## Lacunas e continuação recomendada

1. Conferir o CSP em staging depois do merge (página pública com embed, editor com upload, login) e seguir os passos de deploy.
2. Exercitar com sessão `/aceite`, *Meus dados* e as duas filas, em Chrome, Edge e um celular.
3. Escrever e ensaiar a execução da exclusão de conta, store a store, e o pacote de mídia.
4. Backup e restauração em ambiente isolado; runbooks de renderer, jobs e webhooks; alertas.
5. Limites globais na borda, CAPTCHA e expurgos agendados (leads, convites, links de relatório, denúncias, pedidos).
6. Aviso ao dono da página suspensa e canal de contestação.
7. Revisão do advogado sobre as minutas e a pauta em `docs/legal/REVISAO_JURIDICA.md`; só então ativar os textos.

## Backlog

`BACKLOG.md`: os cinco P0 da Sprint 9 seguem abertos, com as partes concluídas marcadas abaixo de cada um. A atualização do Next para 16.4.0 (item da Sprint 8) foi marcada como feita.

## Adendo de 10/10/2026 — backup e restauração

O founder decidiu manter o banco de produção no plano Free do Supabase, que não tem backup gerenciado. Para o que dá para fazer nessa condição:

- `scripts/db-backup.mjs` (`npm run db:backup`): backup lógico de papéis, estrutura, dados de `public`, `auth` e `storage`, histórico de migrações e arquivos do bucket `media`, com manifesto (linhas por tabela e SHA-256).
- `scripts/db-restore-check.mjs` (`npm run db:restore-check`): sobe uma instância descartável, restaura o backup como numa restauração real e compara com o manifesto.
- Runbook `docs/runbooks/BACKUP.md`, com o roteiro de restauração num projeto novo e os riscos do plano Free.

**Verificado:** com o banco local, backup de 70 tabelas (57.605 linhas) e 36 de 36 arquivos de mídia; restauração com todas as verificações aprovadas (estrutura e linhas sem erro, 70 tabelas com as contagens do manifesto, histórico de migrações, leitura de uma página publicada, RLS ligada em todas as tabelas de `public`).

**Não feito:** nenhum backup de produção (a CLI estava logada em conta sem acesso ao projeto: 403); restauração num projeto hospedado; recarga de mídia; agendamento; local da cópia externa. O item P0 de backup **continua aberto** no backlog.

## Adendo de 11/10/2026 — limites, CAPTCHA, expurgo agendado e exclusão de conta

**Branch:** `feat/sprint-9-hardening`. **Decisão:** ADR 0018. **Estado: implementado e verificado só no stack local. Nada foi configurado ou aplicado em produção** (sem regra de firewall, CAPTCHA desligado no Supabase, migração não aplicada, nenhuma conta real excluída). A sprint continua parcial.

### Objetivo e resultado

O founder pediu os quatro primeiros itens da lista de continuação: limites de requisição na borda, CAPTCHA no cadastro e no login, expurgos agendados e o procedimento de exclusão de conta. Os quatro têm código, testes e runbook. Dois deles só passam a valer depois de passos do founder em painéis (firewall da Vercel; Cloudflare e Supabase para o CAPTCHA).

### Decisões

- **Limite de borda = uma regra no firewall da Vercel, fora do repositório.** O plano Hobby permite uma única regra de limite de taxa; ela não pode ser escrita no código. O que o código ganhou é uma segunda camada, por instância e na memória, que **não é um limite global**. Alternativas recusadas (Redis/KV, limite no Postgres) no ADR 0018.
- **A página pública não tem limite na aplicação**, para continuar em cache; depende só do firewall.
- **Turnstile**, escolhido pelo founder em 11/10/2026, conferido pelo Supabase Auth. A aplicação só mostra o widget e repassa o token. Sem a chave do site no ambiente, nada muda.
- **Um job diário de expurgo** (07:00 UTC), em vez de expurgo "na próxima escrita". Passa a remover também páginas e contas excluídas há mais de 30 dias, o que estava documentado desde a Sprint 2 e nunca tinha sido feito.
- **Exclusão de conta executada pelo administrador**, em duas etapas no banco com a limpeza de cache, domínio e imagens no meio; nunca automática.
- **Provisórias, aguardando o founder e a revisão jurídica:** denúncias guardadas por 180 dias depois da decisão; pedidos de privacidade encerrados guardados por 5 anos; limite de 300 requisições por minuto por endereço na regra do firewall; os seis limites por rota da aplicação; o texto de resposta ao titular.

### Critérios de aceite deste adendo

| Critério | Estado | Evidência |
|---|---|---|
| Limite na frente de `/api/events`, `/api/vitals`, `/api/media`, `/r/` e do envio de formulário | **parcial**: camada por instância implementada e testada; **regra global não configurada** | Vitest `rate-limit.test.ts`; `docs/runbooks/RATE_LIMITS.md` |
| Limite na frente da página pública | **não feito no código** (decisão); depende da regra do firewall | ADR 0018 |
| CAPTCHA no cadastro, login, reenvio e recuperação | **preparado**: código implementado e testado; **desligado**, e o widget nunca foi renderizado num navegador (não há chave) | Vitest `captcha.test.ts` |
| Expurgo agendado de contatos, convites, links, denúncias e pedidos | **implementado e verificado localmente**; não aplicado em produção | pgTAP `200-retention-erasure`; script (rota chamada com e sem o segredo) |
| Procedimento de exclusão escrito e ensaiado, incluindo mídia | **implementado e ensaiado localmente** com arquivos reais no bucket local; nunca em produção, nunca com domínio na Vercel nem assinatura na Stripe | `docs/runbooks/ACCOUNT_DELETION.md`; `apps/web/scripts/account-erasure.mjs` (18 verificações) |

### Entregáveis

- Limites: `apps/web/src/lib/security/rate-limit.ts`, aplicado em `api/events`, `api/vitals`, `api/media`, `r/[token]`, `modules/leads/actions.ts` e `modules/moderation/actions.ts`.
- CAPTCHA: `modules/identity/captcha.ts`, `components/captcha-field.tsx`, os três formulários, `auth-outcomes.ts`, `lib/security/response-headers.ts`, `next.config.ts`, `.env.example` (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`).
- Expurgo: migrações `202610110001` e `202610110002`; `modules/privacy/retention*.ts`; rota `/api/jobs/retention`; quarto cron em `apps/web/vercel.json`.
- Exclusão: funções `begin_account_erasure` e `finish_account_erasure`; `modules/privacy/erasure*.ts`; quadro *Executar a exclusão* em `/app/administracao/privacidade`.
- Documentos: ADR 0018; runbooks `RATE_LIMITS.md`, `RETENTION.md`, `ACCOUNT_DELETION.md`; seções novas em `ENVIRONMENTS.md` (passos de deploy), `DATA_MAP.md`, `THREAT_MODEL.md` e `OBSERVABILITY.md`.

### Verificação (11/10/2026, stack local)

- `npm run check`: lint sem avisos, typecheck, **1.258 testes Vitest (48 arquivos)** e build aprovados.
- `npm run test:db`: **1.318 asserções pgTAP (22 arquivos)** aprovadas; o arquivo novo tem 56.
- `npm audit --omit=dev`: 0 vulnerabilidades.
- `node scripts/account-erasure.mjs` (build de produção, Chrome, contas descartáveis): **18 verificações aprovadas**. Cobre: a fila oferece a exclusão só para o pedido em análise; palavra de confirmação errada não muda nada; depois da execução, conta, contas, páginas, contatos, links, convites, linhas de mídia e **arquivos do bucket** sumiram; pedido concluído com a referência; duas entradas na auditoria; endereços reservados; página pública em 404; **conta, página, contato e arquivo de um terceiro intactos**; job de expurgo recusa sem segredo, roda com ele e apaga só o contato vencido.
- Casos negativos no pgTAP: `anon`, sessão comum e o próprio titular não executam nada; o papel de serviço não executa a exclusão nem apaga histórico de pedido; pedido fora de análise ou de outro tipo (`LK122`); assinatura em curso (`LK123`); outro membro (`LK124`); imagem pendente (`LK125`); referência curta (`22023`); pedido já concluído; conta em que a pessoa é só membro fica intacta; linha dentro do prazo fica.

### Implicações

- **Privacidade:** primeiro deploy que **apaga dados sozinho**; novo subprocessador (Cloudflare) quando o CAPTCHA for ligado. `DATA_MAP.md` atualizado.
- **Operação:** quarto cron; novo modo de falha (imagens que não saem atrasam o expurgo de páginas); a ordem de ativação do CAPTCHA importa (chave do site antes de ligar no Supabase, ou ninguém entra).
- **Acessibilidade:** o widget do Turnstile é de terceiro e não foi avaliado com leitor de tela; o grupo tem rótulo próprio.
- **Desempenho:** nenhuma mudança nas páginas públicas. As quatro telas de acesso passam a carregar um script de terceiro quando o CAPTCHA estiver ligado (não medido).
- **Dados locais:** o ensaio rodou o job de expurgo no banco local e removeu de fato 9 contadores de formulário e 22 de relatório vencidos (dados de teste antigos), além do contato criado pelo próprio ensaio.

### Lacunas e o que ficou de fora

- **Nada verificado em produção.** A regra do firewall, o widget do Turnstile e o CAPTCHA no Supabase são passos do founder (`ENVIRONMENTS.md`).
- **O widget nunca foi visto num navegador**: sem chave não há o que renderizar. A integração segue a documentação do Turnstile e do Supabase; o primeiro teste real é o passo B4.
- A exclusão nunca rodou contra a API da Vercel (desanexar domínio) nem com assinatura na Stripe.
- Sem CAPTCHA no formulário público e na denúncia; sem limite na borda para Server Actions do painel e para o webhook de cobrança.
- Não há transferência de propriedade de uma conta com outros membros, nem aviso por e-mail ao titular.
- Exportação dos arquivos de mídia, e domínios e pixels na exportação da conta, continuam pendentes.
- Itens 6 e 7 da lista de continuação original (aviso ao dono de página suspensa; revisão jurídica) e o QA de celular e acessibilidade não foram tocados.

### Próximo passo recomendado

Aplicar os passos de deploy na ordem A → C → B → D depois do primeiro backup de produção conferido; em seguida o SMTP próprio (Resend, escolhido pelo founder em 11/10/2026, ainda não contratado) e o checklist do Auth hospedado.

## Adendo de 11/10/2026, parte 3 — aviso de suspensão, contestação, runbooks e alertas

**Branch:** `feat/moderation-notice-and-monitoring`, criada de `main` depois do merge do PR #33. **Decisão:** ADR 0019. **Estado: implementado e verificado só no stack local. Nada aplicado em produção** (migrações `202610110003` e `202610110004` pendentes; o segredo do monitor não existe; o workflow nunca rodou contra a produção). A sprint continua parcial.

### Objetivo e resultado

O founder pediu os itens 5 e 6 da lista: avisar o dono de uma página suspensa e dar um canal de contestação; e runbooks e alertas para renderer, jobs e webhooks. Os dois têm código, testes e runbook. O "aviso" é dentro do produto, porque não existe envio de e-mail; os "alertas" são um workflow agendado no GitHub cujo fracasso vira e-mail, porque nenhum serviço de monitoramento foi contratado.

### Decisões

- **Aviso em todas as telas da conta**, para todos os membros, com link para o motivo e a contestação. **Sem e-mail** até existir SMTP.
- **O dono vê o motivo em categoria** (a da denúncia de origem, ou "regras de uso"), **nunca a justificativa do administrador**.
- **Contestação só por proprietário e administrador**; uma por vez, três por suspensão; a resposta do administrador é escrita para o dono e aceitar reativa a página.
- **Alerta = execução do workflow com falha → e-mail do GitHub.** Sem fornecedor novo. Duas severidades: o que está quebrado agora falha de hora em hora; trabalho esperando por uma pessoa só falha uma vez por dia.
- **Segredo próprio para o monitor** (`OPS_STATUS_SECRET`), diferente do `CRON_SECRET`: o monitor só lê.
- **Provisórias, aguardando o founder:** limite de três contestações; prazo de 72 horas para denúncias e contestações e de 10 dias para pedidos de privacidade antes do alerta; 36 horas sem execução boa para acusar um job; a redação do aviso e das categorias.

### Critérios de aceite deste adendo

| Critério | Estado | Evidência |
|---|---|---|
| O dono é avisado quando a página é suspensa | **parcial**: aviso no produto implementado e verificado localmente; **sem e-mail** | pgTAP `210-appeals-ops`; `scripts/moderation-appeal.mjs` |
| Existe um canal de contestação | **implementado e verificado localmente** | idem; Vitest `appeals.test.ts` |
| Runbook do renderer | **já existia** (`PUBLIC_PAGE.md`); ganhou a ligação com os alertas e com a moderação | `docs/runbooks/PUBLIC_PAGE.md` |
| Runbook dos jobs | **escrito** | `docs/runbooks/JOBS.md` |
| Runbook dos webhooks | **já existia** (`BILLING.md` §2); ganhou a ligação com os alertas | `docs/runbooks/BILLING.md` |
| Alertas para jobs | **preparado**: implementado e testado; não ligado em produção | Vitest `ops/status/route.test.ts`; pgTAP; `docs/runbooks/MONITORING.md` |
| Alertas para webhooks | **parcial**: acusa cobrança desligada por configuração e eventos presos ou divergentes; **não acusa um webhook que não chegou** | idem |
| Alertas para o renderer | **parcial**: acusa site, home e uma página pública fora do ar; **não mede taxa de erro nem latência** | `.github/workflows/monitor.yml` |

### Entregáveis

- Suspensão e contestação: migrações `202610110003` e `202610110004` (tabelas `moderation_suspensions` e `moderation_appeals`; funções `get_page_moderation`, `submit_moderation_appeal`, `decide_moderation_appeal`, `list_moderation_appeals`; `set_profile_moderation` passa a registrar a suspensão); `modules/moderation/appeals*.ts` e componentes; tela `/app/w/<conta>/paginas/<página>/moderacao`; aviso no layout da conta; seção de contestações em `/app/administracao/denuncias`; permissões `moderation.view` e `moderation.appeal`.
- Monitor: tabela `job_runs` e funções `record_job_run` e `get_ops_status`; `modules/ops/status*.ts`; rota `GET /api/ops/status`; os quatro jobs gravam a própria execução; `.github/workflows/monitor.yml`; `OPS_STATUS_SECRET` em `.env.example`.
- Documentos: ADR 0019; runbooks novos `MONITORING.md`, `JOBS.md` e `MODERATION.md`; seções novas em `ENVIRONMENTS.md`, `OBSERVABILITY.md`, `THREAT_MODEL.md` e `DATA_MAP.md`.

### Verificação (11/10/2026, stack local)

- `npm run check`: lint sem avisos, typecheck, **1.277 testes Vitest (50 arquivos)** e build aprovados.
- `npm run test:db`: **1.369 asserções pgTAP (23 arquivos)** aprovadas; o arquivo novo tem 51.
- `node scripts/moderation-appeal.mjs` (build de produção, Chrome, contas descartáveis, 390 px para o dono e o editor): **20 verificações aprovadas**. Cobre: sem aviso quando nada está suspenso; aviso com o nome da página em duas telas da conta, cabendo no celular; a justificativa do administrador não aparece; a tela mostra a categoria; mensagem curta recusada com o motivo e sem gravar; depois do envio o formulário dá lugar ao estado de espera; o editor vê o aviso, não o formulário nem o texto; uma pessoa de fora da conta não vê nada; o administrador lê e aceita na fila; a página volta, o aviso some; quatro entradas na auditoria; a rota de status recusa sem segredo, responde com as onze verificações e não cita endereço nem página.
- Casos negativos no pgTAP: `anon` e outra conta (`42501`, `P0002`); editor contestando (`42501`); página não suspensa (`LK126`); segunda contestação em espera (`LK127`); quarta contestação (`LK128`); mensagem curta, longa ou com caractere de controle (`22023`); dono decidindo a própria contestação; decisão revertida (`LK129`); sessão comum lendo o status ou gravando execução de job; job desconhecido.

### Implicações

- **Privacidade:** `moderation_appeals` guarda texto livre de um membro da conta; sem expurgo próprio (sai com a página). O log do workflow é público, por isso a rota de status não devolve dado pessoal (testado).
- **Operação:** primeiro mecanismo de alerta do produto. Um job passa a fazer uma chamada a mais ao banco; o layout da conta, uma leitura a mais por requisição.
- **Acessibilidade:** o aviso é um `role="alert"` com texto e link de 44 px; o formulário usa os campos rotulados do produto. Não testado com leitor de tela.
- **Desempenho:** nenhuma mudança nas páginas públicas.

### Lacunas e o que ficou de fora

- **Nada verificado em produção.** O workflow do monitor é YAML nunca executado: o primeiro teste real é o passo 4 de `ENVIRONMENTS.md`.
- **Sem e-mail** ao dono na suspensão ou na resposta.
- **Sem alerta** para taxa de erro e latência do renderer, Web Vitals, picos de limite, uploads, formulários, Auth e webhook que não chega. Dependem de um serviço que leia logs.
- Suspensão de conta inteira continua sem aviso e sem contestação.
- Suspensões encerradas e contestações não têm expurgo próprio nem entram na exportação da conta.
- Não há segunda pessoa para julgar uma contestação.
- QA de celular e acessibilidade das telas da Sprint 9, e a revisão jurídica, continuam pendentes.

### Próximo passo recomendado

Aplicar os passos de deploy (backup, migrações, segredo do monitor) junto com os da continuação anterior; depois o SMTP próprio, que também destrava o e-mail de aviso de suspensão.

## Adendo de 11/10/2026 — lacunas das Sprints 8 e 9

**Branch:** `feat/sprint-8-9-gaps`, criada de `main` depois do merge do PR #34. **Estado: implementado e verificado só no stack local. Nada aplicado em produção** (migração `202610110005` pendente).

### Objetivo e resultado

O founder pediu, da lista de pendências, "os que você consegue fazer". Oito itens foram feitos; três não, com o motivo abaixo.

| Item | Estado | Evidência |
|---|---|---|
| QA de celular e acessibilidade das telas da Sprint 9, incluindo `/aceite` com textos ativos | **parcial**: passagem automática aprovada; falta aparelho real, outros navegadores, leitor de tela e teclado | `apps/web/scripts/mobile-a11y.mjs`, 28 verificações, 12 telas em 390 e 320 px |
| Domínios e pixels na exportação da conta | **implementado e verificado localmente**, com suspensões e contestações | pgTAP `220-export-domain-recheck` |
| Reverificação agendada de domínios | **implementado e verificado localmente**; nunca contra DNS real nem contra a Vercel | pgTAP `220`; Vitest `recheck.test.ts` e `jobs/domains/route.test.ts` |
| Caminho "Aceitar" dos pixels num navegador | **verificado localmente** com as bibliotecas reais e identificadores de ninguém; sem violação de CSP. Falta um evento chegar numa conta real | `scripts/mobile-a11y.mjs` |
| Versão da API da Stripe no webhook | **registrado como aceito** (o evento é só um aviso; nenhum valor é lido dele) | adendo no ADR 0014 |
| Motivo no log quando a cobrança se desliga | **implementado** | `api/billing/webhook/route.ts`; também no monitor (`billing:mode`) |
| Cor do tema na barra do navegador das páginas públicas | **implementado e verificado localmente** em Chrome; **não conferido no Safari do iPhone**, que é onde o problema foi visto | Vitest `page-hints.test.ts`; script (tema escuro) |
| `preload` da imagem principal | **implementado**; **ganho de LCP não medido** | Vitest `page-hints.test.ts` |
| Troca entre mensal e anual numa assinatura em andamento | **não feito**: é funcionalidade nova, e a regra de cobrança proporcional na Stripe precisa de decisão do founder e de teste contra a Stripe | — |
| E-mail de novo contato; QR code do Pix; imagem de fundo no tema | **não feito**: o e-mail depende do SMTP (escolhido, não contratado); os outros dois são funcionalidades cortadas da Sprint 5 que mudam o formato do documento publicado e pedem decisão de escopo | — |
| Remover `profiles.social_links` | **não feito**: migração destrutiva, depende de aprovação do founder | — |

### Decisões

- **Reverificação:** sete dias seguidos sem o registro de comprovação desligam o domínio; dia sem resposta do DNS não conta; o aviso é só na tela (sem e-mail). **O prazo de sete dias é provisório.**
- **Cor do navegador:** além de `theme-color`, a cor da página vira o fundo do documento, porque é dele que o Safari tira a cor das barras e da área de rolagem elástica.
- **QA automático:** caixa de seleção de `/aceite` e a de consentimento do formulário público passaram de 13 e 20 px para 24 px (tamanho mínimo de alvo da WCAG 2.2). Foi o único achado.
- **Versão da API da Stripe:** nada muda; ao recriar o destino para o modo real, escolher a versão do adaptador.

### Verificação (11/10/2026, stack local)

- `npm run check`: lint sem avisos, typecheck, **1.296 testes Vitest (53 arquivos)** e build aprovados.
- `npm run test:db`: **1.405 asserções pgTAP (24 arquivos)** aprovadas; o arquivo novo tem 36.
- `node scripts/mobile-a11y.mjs`: **28 verificações, nenhuma pendência**. Em cada tela, a 390 e a 320 px: sem rolagem horizontal, campos de texto com 16 px ou mais, controles com 24 px ou mais, nenhuma violação séria ou crítica das regras WCAG 2.2 A/AA do axe-core. Telas: `/aceite` (com dois textos ativos de teste, removidos no fim), *Meus dados*, lista de páginas, tela de suspensão, as duas filas do administrador, as quatro telas de acesso, `/denunciar`, página suspensa e página publicada com o aviso de consentimento.
- Casos negativos no pgTAP: assinatura errada, atestado velho e malformado; confirmação reapresentada como reverificação e o contrário; domínio inexistente, de nome diferente e não ativo; seis ausências não desligam; domínio de outra conta intocado; dono e sessão comum não gravam reverificação; outra conta não exporta.

### Implicações

- **Operação:** quinto cron; o monitor passa a ter doze verificações. Aplicar esta migração junto com as outras duas de 11/10, ou o monitor acusa `job:domains`.
- **Clientes:** depois da migração, um cliente que tenha apagado o registro TXT perde o domínio em sete dias. Hoje nenhum cliente tem domínio.
- **Dados locais:** o ensaio deixou seis pedidos de privacidade de contas descartáveis no banco local, que quebraram um teste de banco; foram removidos e a limpeza do script foi corrigida.

### Lacunas

- Nada em produção. Safari do iPhone não conferido para a cor da barra. LCP não medido depois do `preload`.
- QA em aparelho real, outros navegadores, leitor de tela e teclado continua pendente.
- Sem e-mail ao dono quando a comprovação do domínio some.
