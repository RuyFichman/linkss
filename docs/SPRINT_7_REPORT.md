# Relatório da Sprint 7

> **EM ANDAMENTO — PARTE 1 DE 2.** Este relatório cobre só a primeira metade da sprint (lista de páginas, busca, arquivamento, duplicação, convites, membros e papéis). O painel consolidado, o link de relatório somente leitura, a medição da décima página e o fechamento da sprint são da parte 2, que roda numa sessão nova na mesma branch. **A sprint não está concluída.**

**Status da parte 1:** implementada e verificada no ambiente local (Supabase local, `next start` de produção, Chrome). **Nada foi aplicado em staging**, nada foi enviado ao remoto e nenhum PR foi aberto.
**Objetivo da sprint:** transformar o produto individual em ferramenta de operação (várias páginas, várias pessoas, níveis de acesso) e entregar a segunda metade do diferencial, "operação multi-perfil + prova de resultado".
**Objetivo desta parte:** quem opera uma conta de agência encontra qualquer página rápido, arquiva as que não usa, começa a página de um cliente a partir de outra, traz colegas com o nível certo de acesso e troca de conta sem nunca agir na conta errada.
**Data:** 06/10/2026
**Branch:** `feat/sprint-7-agency`. No início ela estava igual à `main` (`7634102`); o commit de documentação `425c2a5` (branch `docs/sprint-6-staging-applied`, ainda fora da `main`) foi trazido por *fast-forward*, sem rebase. Commits desta parte: `91c7aa9`, `33dbf65`, `214f9b2` e o commit de documentação que inclui este relatório.

## Resultado

- **Lista de páginas** (`/app/w/<conta>`): busca por nome ou endereço, filtro por situação com contagem, ordem (mais recentes ou nome), 20 por tela, uso do plano ("9 de 10 páginas") e as ações que o papel permite. Busca, filtro, ordem e página ficam na URL e funcionam sem JavaScript. Uma consulta por renderização, qualquer que seja o número de páginas.
- **Arquivar e desarquivar:** arquivar tira a página do ar na mesma transação, mantém endereço, versões, resultados e contatos, e congela o rascunho. Desarquivar devolve como rascunho, sem republicar. A confirmação diz o que acontece com o endereço público.
- **Duplicar:** uma transação no banco cria um rascunho novo na mesma conta, com id novo em cada bloco, a aparência, a foto e a apresentação. Imagens não são copiadas: a cópia ganha permissão de usar as da origem e elas contam uma vez na cota. O rascunho copiado mostra "Revise antes de publicar" com os dados de contato e pagamento a conferir.
- **Convites:** proprietário e administrador criam um link (administrador ou editor), que é mostrado uma vez para copiar e enviar. Nenhum e-mail é enviado. Só aceita quem entra com o mesmo e-mail convidado. Validade de 7 dias, uso único, cancelável; convite pendente ocupa lugar no plano.
- **Membros** (`/app/w/<conta>/membros`): pessoas, papéis, convites com validade, convidar, cancelar, alterar papel, remover e sair. `change_member_role` e `remove_workspace_member`, que existiam sem tela desde a Sprint 2, ganharam interface.
- **Aceite** (`/app/convite/<token>`): uma tela para cada estado; link desconhecido, expirado, cancelado ou usado mostra o mesmo texto.

## Estado dos gates (§0 do prompt)

- **Gate de usabilidade:** o *override* do founder de 25/09/2026 continua valendo; as cinco sessões seguem pendentes.
- **UX confirmadas:** UX-020, 021, 023 e 025 e, desde 06/10/2026 (depois da entrega desta parte), **UX-019 e UX-051 a UX-059**. A UX-060 (corte de "lembrar a última conta") e as demais seguem provisórias.
- **Respostas do founder em 06/10/2026**, aplicadas: página arquivada mantém o painel de resultados acessível (**sim**); região (UF) fica para depois; UX-043 a UX-050 seguem provisórias; UX-019 decidida "pela melhor opção para o negócio" (abaixo); a sprint foi dividida em dois prompts.
- **Staging:** não foi tocado. Nenhuma migração aplicada, nenhum segredo criado, nenhuma configuração alterada no Supabase hospedado nem na Vercel.
- **Falha segura:** sem a migração, a lista cai na consulta antiga (sem busca), arquivar, duplicar e *Membros* dizem "ainda não disponível" e o link de convite mostra o estado genérico. Coberto por testes de unidade (`not_deployed`); **não** foi exercitado no navegador contra um banco sem a migração.

## Decisões tomadas

Técnicas (ADR 0012, em inglês; ADR 0004 e 0009 receberam a resolução das notas em aberto):

- **UX-019, páginas arquivadas contam no limite — mantida.** O número de páginas é o que separa os planos; arquivo que não conta viraria guarda ilimitada e gratuita de páginas e de endereços. A lista avisa que arquivadas contam. Para revisar com a cobrança (Sprint 8), se houver demanda por "guardar páginas antigas".
- **Arquivar** usa o mesmo efeito de "Tirar do ar" e a mesma invalidação de cache; `/[slug]` continua estático. Uma constraint nova impede situação e versão no ar de divergirem. Publicar ou restaurar uma página arquivada responde `LK070`.
- **Mídia na duplicação: a regra de referência foi alargada, os objetos não são copiados.** `media_asset_shares` é uma *permissão* (esta página pode usar esta imagem); a referência continua calculada dos documentos. Quando a página dona é expurgada, a limpeza transfere a imagem para a página que ainda a usa. Copiar objetos exigiria a chave de serviço numa ação de usuário ou um segundo upload atestado por imagem, e não caberia numa transação.
- **Convites numa tabela própria** (`workspace_invitations`): pendente existe só ali; a participação nasce `active` na aceitação. `status = 'invited'` não é gravado.
- **Token** de 256 bits; a criação recebe só o hash; a aceitação recebe o token e o banco recalcula o hash, então um hash lido não serve para aceitar; `token_hash` não tem `grant`. O token vai no caminho da URL porque precisa sobreviver ao redirecionamento do login.
- **E-mail igual ao convidado** para aceitar; outra conta recebe um estado próprio ("é para outro e-mail") sem nenhum dado da conta.
- **Cadastro a partir do convite:** o modelo de e-mail de confirmação tem `next=/app` fixo. Para não mexer nos modelos hospedados, o cadastro guarda o caminho do convite num cookie `HttpOnly` de 1 hora restrito a `/auth`, e `/auth/confirm` só o honra se for exatamente um caminho de convite.
- **Lista** por uma função `security invoker`: quem isola as contas é o RLS, quaisquer que sejam os argumentos. Sem índice novo: o índice `(workspace_id, created_at desc)` da Sprint 2 atende. Limite declarado para rever: cerca de 500 páginas numa conta.
- **Sem dependência nova.**

Produto/UX, todas provisórias salvo indicação (`docs/ux/UX_DECISIONS.md`): UX-051 (arquivamento; o acesso aos resultados foi **confirmado**), UX-052 (o que a duplicação copia e o aviso de revisão), UX-053 (7 dias), UX-054 (mesmo e-mail), UX-055 (sem envio de e-mail), UX-056 (pendentes ocupam lugar), UX-057 (convite não concede proprietário), UX-058 (tela Membros por papel), UX-059 (lista e duplicação em tela, desvio do wireframe 7), UX-060 (corte de "lembrar a última conta").

### Cortes de escopo

- **Lembrar a última conta usada em `/app`:** cortado (primeiro item da lista de cortes). `/app` abre a conta pessoal.
- Os demais itens da lista de cortes (filtro por situação, alterar papel pela interface, sair da conta pela interface) **foram entregues**.

## Critérios de aceite

| # | Critério (`PLANO_DE_EXECUCAO.md`) | Estado | Evidência |
|---|---|---|---|
| AC1 | Permissões aplicadas no servidor para cada ação sensível | **verificado para as ações desta parte**; a parte 2 acrescenta as dela e revisa o conjunto | Tabela em ADR 0012 ("AC1"), uma linha por Server Action, leitura e RPC, contra proprietário, administrador, editor, membro de outra conta, não membro e `anon`. Banco: pgTAP `150-agency-operations.test.sql` (cada papel em cada RPC; `anon` em todas) e `010-structure` (nenhuma função nova executável por `anon`; `token_hash` ilegível). Aplicação: Vitest `modules/identity/invitations.test.ts`, `member-actions.test.ts` e `modules/profiles/service.test.ts` (o serviço recusa **antes** de chamar o repositório). Chamada sem a interface: RPCs chamadas direto no pgTAP como cada papel; no navegador, administrador rebaixado no banco com o diálogo de arquivar já aberto → "Você não tem permissão", página intacta, log `profile.archive outcome=forbidden`; editor abrindo `/duplicar` pela URL → aviso de permissão, sem formulário |
| AC2 | Template duplicado não compartilha conteúdo mutável com o original | **verificado** | pgTAP 150: todo id de bloco é novo e distinto; mesmos blocos na mesma ordem; editar a cópia não muda nome, blocos nem revisão do original, e vice-versa; publicar a cópia não acrescenta versão ao original e cada página tem a sua versão no ar; arquivar o original deixa a cópia publicada; excluir o original deixa a cópia salvar e publicar com as imagens; a limpeza não reivindica imagens que a cópia usa e, vencida a retenção do original, as transfere para a cópia e remove só a que ninguém usa; a cópia nasce sem publicações, analytics, leads e histórico de endereço, em rascunho, com endereço e revisão próprios; cópia de cópia, origem arquivada (aceita) e origem excluída (recusada). Vitest: nome e endereço da cópia, validação, limite do plano. Navegador: página com foto, imagem, Pix, formulário e WhatsApp duplicada; cópia publicada; original arquivado e depois excluído; imagens da cópia respondendo 200 na página pública. **Não coberto:** domínio próprio, pixels e links de relatório ainda não existem (Sprint 8 e parte 2); a regra está no ADR para quando existirem |
| AC3 | Convites expiram, podem ser revogados e não concedem acesso à conta errada | **verificado** | pgTAP 150: aceito uma vez e só uma; expirado; cancelado; cancelar duas vezes; substituído por convite novo; token desconhecido, malformado e nulo; os quatro inválidos devolvem **a mesma linha**; outra conta e conta não confirmada → `wrong_account` sem dados; a aceitação não recebe conta e não cria participação em nenhuma outra; quem já é membro mantém o papel (sem escalada) e o convite é fechado; membro removido e convidado de novo volta na mesma linha com o papel novo; limite atingido entre convite e aceite; pendentes ocupam lugar; administrador convidando proprietário e proprietário convidando proprietário (recusados); editor convidando (recusado); conta suspensa; limite de criação; expurgo após 30 dias; o valor guardado é o hash e a trilha não tem endereço nem token. Vitest: normalização, token com fonte aleatória injetada, validade com relógio injetado, um estado de tela por resposta do banco, o serviço nunca manda o token ao criar. Navegador: três contas; aceite como administrador e como editora; conta errada; cancelado, expirado e desconhecido com o mesmo texto; segundo uso do link → inválido. Log do servidor conferido: nenhum token e nenhum e-mail |
| AC4 | Relatório compartilhado não expõe configurações internas nem dados de outros perfis | **não iniciado** | Parte 2 |
| AC5 | Agência cria o décimo perfil sem degradação perceptível | **preparado**, não medido | A lista faz 2 consultas por renderização (lista + entitlements), o fluxo de criar faz o mesmo número de sempre e o de duplicar faz 4 leituras fixas mais a RPC; nenhuma cresce com o número de páginas. Índice de apoio já existente. No navegador, a conta QA ficou com 9 páginas, a décima foi criada por duplicação e a lista foi usada com 10. **A medição cronometrada e o `EXPLAIN` são da parte 2** |

## Entregáveis

| ID | Entrega | Onde revisar |
|---|---|---|
| D1 | ADR 0012 | `docs/adr/0012-multi-page-operations-invitations-and-roles.md` |
| D2 | Migrações + pgTAP | `supabase/migrations/202610060001_sprint7_enum_values.sql`, `202610060002_agency_operations.sql`; `supabase/tests/database/150-agency-operations.test.sql` (173 asserções), `010-structure.test.sql` (+4); `apps/web/src/lib/database.types.ts` regenerado |
| D3 | Módulos puros e Server Actions | `modules/identity/{permissions,invitations,invitation-token,after-confirm,members-service,members-server,member-actions}.ts`; `modules/profiles/{page-list,page-list-server,duplicate-naming,copy-review,service,supabase-repository,errors,actions}.ts`; `lib/supabase/missing-schema.ts` |
| D4 | Interface | `app/app/w/[workspaceId]/page.tsx` (lista), `…/paginas/[profileId]/duplicar/page.tsx`, `…/paginas/[profileId]/page.tsx` (arquivada, aviso de revisão, duplicar/arquivar), `…/membros/{page,loading}.tsx`, `app/app/convite/[token]/page.tsx`, `app/app/w/[workspaceId]/layout.tsx` (Páginas · Membros); componentes `ui/confirm-dialog.tsx`, `modules/profiles/components/{archive-controls,duplicate-profile-form}.tsx`, `modules/identity/components/{invite-member-form,member-role-form,accept-invitation-form}.tsx`; login e cadastro levam o convite adiante; textos em `content/pt-BR.ts` (`APP_COPY.pages/archive/duplicate/manage`, `TEAM_COPY`) |
| D5 | Testes | Vitest: `modules/identity/{identity,invitations,member-actions}.test.ts`, `modules/profiles/{service,page-list}.test.ts`, `app/auth/confirm/route.test.ts`; pgTAP acima |
| D6 | Documentação | ADR 0012, ADR 0004 e 0009 (notas resolvidas), `docs/{ARCHITECTURE,THREAT_MODEL,DATA_MAP,OBSERVABILITY,ENVIRONMENTS}.md`, `docs/runbooks/AUTH_ACCESS.md` (seções 5 e 6), `docs/ux/{UX_DECISIONS,CONTENT_GUIDE}.md`, `README.md`, `BACKLOG.md`, este relatório. `AGENTS.md` §22 **não** foi alterado (fica para o fechamento) |

## Validação executada

### Navegador (Chrome, build de produção em `localhost:3000`, Supabase local, contas `qa-sprint7-*@example.test`)

- **Proprietária:** criou a conta de agência pela interface (o `next` do login foi preservado); lista com 9 páginas, busca "café" → 1 resultado com "Limpar busca e filtros"; duplicou a página com foto, imagem, Pix, formulário e WhatsApp → caiu no rascunho novo com "Cópia criada como rascunho" e "Revise antes de publicar" (WhatsApp, Chave Pix, consentimento); publicou a cópia (o aviso sumiu); arquivou o original publicado pelo diálogo (texto com o endereço) → endereço público passou a responder 404 na hora, editor e publicação saíram da tela, resultados e contatos continuaram abrindo; excluiu o original → as duas imagens da cópia responderam 200 na página pública.
- **Convites:** quatro criados (um com o e-mail em maiúsculas e espaço, normalizado); um cancelado pelo diálogo; um expirado ajustando a linha no banco local. Sem sessão, o link levou ao login com o aviso de convite e o link de cadastro levando o convite. Com outra conta: "Este convite é para outro e-mail", sem dados, `referrer` `no-referrer`, botão para sair e voltar ao convite. Cancelado, expirado, desconhecido e malformado: "Este convite não é válido". Administrador e editora aceitaram; o segundo uso do link do administrador → inválido.
- **Papéis:** a editora viu só Editar e Resultados, sem "Nova página", a tela Membros com nomes e papéis, sem e-mails alheios e só com "Sair desta conta", e `/duplicar` com o aviso de permissão. O administrador viu Duplicar, Arquivar e a gestão de membros.
- **Removida com a aba aberta:** a editora salvou uma alteração ("Salvo"); o administrador a removeu (RPC chamada com a identidade dele); a alteração seguinte na mesma aba → "Não foi possível salvar. Esta página não existe mais ou você perdeu o acesso a ela."; o título no banco não mudou; a URL da conta passou a mostrar "Página não encontrada".
- **Interface desatualizada:** administrador rebaixado a editor no banco com o diálogo de arquivar aberto → "Você não tem permissão para fazer isso nesta conta."; página continuou em rascunho.
- **Lugares:** com 2 pessoas e 3 convites, "5 de 5 lugares"; o formulário dá lugar ao aviso de limite.
- **Larguras:** 360, 390, 768 e 1280 px (360 e 390 num iframe, porque a janela não fica menor que 500 px) para lista, busca vazia, membros, duplicar, editor e convite: sem rolagem horizontal e sem alvo menor que 44 px nas telas novas.
- **Log do servidor:** desfechos de cada ação com `correlationId`; nenhuma ocorrência de token, caminho de convite ou e-mail.

**Não feito no navegador:** cadastro de uma pessoa nova a partir do convite com confirmação de e-mail (coberto por teste de unidade do cookie e da rota); alterar papel e sair da conta pela interface (cobertos por Vitest e pgTAP; a remoção foi feita por RPC); paginação com mais de 20 páginas (o plano local permite 10; coberta por pgTAP e Vitest); a aplicação contra um banco sem a migração; celular real, Safari e leitor de tela; a troca de conta foi conferida pelo seletor listando as duas contas, não por uma sequência de ações em cada uma.

### Problemas encontrados e corrigidos durante esta parte

- **O link do convite sumia quando o convite ocupava o último lugar:** a tela trocava o formulário pelo aviso de limite e o link, que só existe ali, se perdia. O formulário agora continua montado e o link permanece. Verificado de novo no navegador.
- **Convite expirado e depois substituído contava a retenção a partir da substituição:** a regra passou a usar o que acontecer primeiro (término ou validade). Caso no pgTAP.
- **Termo de busca em forma de endereço com hífen nas pontas** (`'; drop table…` virava `-drop-table…`): passa a ser aparado. Caso no Vitest.
- **Aceite registrado em nível `warn`:** corrigido para `info`.

### Resultado final registrado

```text
npm audit: 5 high (só ferramentas de desenvolvimento: eslint-config-next → fast-glob → micromatch → braces); npm audit --omit=dev: found 0 vulnerabilities
lint: aprovado (eslint --max-warnings=0)
typecheck: aprovado
test: 29 arquivos, 863 testes aprovados (173 novos)
test:db: 17 arquivos, 816 asserções aprovadas (177 novas: 173 no arquivo 150 e 4 no 010)
supabase db advisors --local: No issues found
build: aprovado, 44 rotas + Proxy (3 novas: /app/convite/[token], /app/w/[workspaceId]/membros, /app/w/[workspaceId]/paginas/[profileId]/duplicar)
npm run check: aprovado (exit 0)
```

**Sobre o `npm audit`.** O lockfile não tinha mudado desde a Sprint 6 (que registrou 0); dois avisos foram publicados depois. `source-map-js` foi corrigido com `npm audit fix` (1.2.1 → 1.2.2, só o lockfile). O de `braces` não tem correção sem rebaixar `eslint-config-next` para a versão 14, o que quebraria o lint do Next 16: ficou aberto. É negação de serviço em padrões de glob, só alcançável pela ferramenta de lint na máquina de desenvolvimento e no CI; nada disso vai para o servidor nem para o navegador.

As migrações foram aplicadas no banco local com `supabase migration up`. **Não rodei `db reset`.** A função `create_workspace_invitation` mudou depois de aplicada (regra de retenção) e foi recriada no banco local a partir do arquivo; a aplicação a partir do zero fica a cargo do job `database` do CI, que ainda não rodou com esta branch (não houve push).

## Segurança, privacidade, acessibilidade, performance e operação

- **Segurança:** seção nova em `docs/THREAT_MODEL.md`. Casos negativos testados: cada papel, membro de outra conta, não membro e `anon` contra arquivar, desarquivar, duplicar, listar, listar membros, convidar, cancelar, consultar e aceitar convite; convite reusado, expirado, cancelado, substituído, desconhecido, malformado e nulo; conta errada e conta não confirmada; conta suspensa; quem já é membro (sem escalada); limite atingido entre convite e aceite; convidar proprietário; convite e participação de outra conta passados para a ação; strings de busca hostis (`%`, `_`, `\`, aspas, `drop table`, caracteres de controle, 500 caracteres); parâmetros de lista inesperados (`__proto__`, ordem arbitrária, página negativa); duplicar no limite do plano, com endereço em uso, reservado e sem nome; página arquivada publicada, restaurada e editada; cookie de retorno apontando para outro site. Nenhuma validação, policy ou regra de lint foi afrouxada.
- **Privacidade:** `docs/DATA_MAP.md` (o e-mail convidado campo a campo, retenção de 30 dias, quem lê, como exportação e exclusão alcançam). Nenhum subprocessador novo e nenhum e-mail enviado. Um cookie funcional novo, só no cadastro vindo de convite. A base legal é proposta e depende da revisão jurídica.
- **Acessibilidade:** rótulos programáticos em todos os campos; botões repetidos na lista com nome acessível próprio ("Arquivar: Café Ipê"); situação, limite e estado do convite em texto; diálogos devolvem o foco; regiões `role="status"`/`alert`; filtro com `aria-current`; busca com `role="search"`; alvos de 44 px. **Leitor de tela real não foi usado.**
- **Performance:** nenhuma mudança na página pública nem no seu JavaScript. A lista deixou de trazer os blocos de todas as páginas (a consulta antiga trazia) e faz uma consulta só.
- **Operação:** sinais novos em `docs/OBSERVABILITY.md`; runbook `docs/runbooks/AUTH_ACCESS.md` seções 5 ("alguém não consegue aceitar um convite") e 6 ("um membro está com o acesso errado"); passos de deploy e o plano Agência em staging em `docs/ENVIRONMENTS.md`.

## Pendências, gaps e riscos

- **Sprint incompleta:** painel consolidado, link de relatório, medição do AC5 e fechamento (parte 2).
- **Staging:** nada aplicado. Para testar lá é preciso a migração e pôr a conta no plano Agência por SQL (não há cobrança até a Sprint 8).
- **O token do convite fica no caminho da URL** e, portanto, no log de requisições da hospedagem. Mitigado por uso único, 7 dias e exigência do e-mail convidado; registrado no modelo de ameaças.
- **Sem limite global nem CAPTCHA** nas ações de convite (Sprint 9); há só os limites do banco (20 por conta, 30 por pessoa em 24 h).
- **Sem tentativa limitada de tokens por usuário:** inviável adivinhar (256 bits), mas não há contador.
- **Cadastro por convite em outro aparelho:** depois de confirmar o e-mail a pessoa cai no início e precisa abrir o link de novo. Resolver de vez exige levar o `next` no modelo de e-mail do Auth (configuração hospedada).
- **Aviso de revisão da cópia não bloqueia a publicação:** uma cópia pode ir ao ar com Pix ou WhatsApp da origem se a pessoa ignorar o aviso.
- **Página arquivada não pode ser editada** nem ter imagens enviadas; é preciso desarquivar antes. Decisão provisória (UX-051).
- **Rebaixamento de plano:** nada é removido; quem já é membro mantém o acesso e páginas além do limite continuam existindo. Convites e páginas novas são recusados. A Sprint 8 precisa decidir o que comunicar e bloquear.
- **Expurgo de convites** só acontece quando a conta cria outro convite; o expurgo agendado fica para a Sprint 9.
- **`npm audit`:** 5 avisos altos em ferramentas de desenvolvimento, sem correção compatível hoje.
- **Não verificado:** os itens listados em "Não feito no navegador".
- **Banco local com dados de QA** (ver "Handoff").
- **Fora do repositório:** iniciei o Docker Desktop (estava parado) para subir o stack local; contêineres de outros projetos subiram junto por política própria e não foram tocados. No Chrome, **a sessão local do founder em `localhost:3000` foi encerrada** para eu entrar com as contas de QA (basta entrar de novo); nada foi alterado na conta dele.
- **Herdadas:** sessões de usabilidade, Auth hospedado, SMTP, CAPTCHA, LCP/CLS de visitantes reais, primeira execução agendada dos crons.

## Perguntas para o founder

> **Respondidas em 06/10/2026 (depois da entrega da parte 1):** o founder confirmou as perguntas 1 a 6 (UX-019 e UX-051 a UX-059) e as duas escolhas do ADR 0012 (imagens compartilhadas entre original e cópia; token do convite no caminho da URL). Seguem abertas a 7 (lembrar a última conta, UX-060) e a 8 (`npm audit`).
>
> No mesmo dia o founder tentou `npx supabase db push` e recebeu **403** ("Your account does not have the necessary privileges"): a CLI estava logada numa conta que não é a dona do projeto de staging, o caso já descrito no `AGENTS.md` §22. **As migrações da Sprint 7 continuam não aplicadas em staging.**

1. **UX-019:** mantive "arquivadas contam no limite". Confirma? (A alternativa comercial seria vender "páginas arquivadas ilimitadas" como benefício de plano na Sprint 8.)
2. **Página arquivada congelada (UX-051):** não editar nem publicar enquanto arquivada, e desarquivar sem voltar ao ar. Está certo?
3. **Duplicar copia Pix, WhatsApp e consentimento com aviso (UX-052)**, em vez de apagar esses dados na cópia. Concorda?
4. **Convite só para o mesmo e-mail (UX-054) e sem envio de e-mail (UX-055):** aceitável para o piloto?
5. **Validade de 7 dias (UX-053)** e **pendentes ocupando lugar (UX-056):** ok?
6. **Editor vê a tela Membros sem e-mails (UX-058):** ok?
7. **"Lembrar a última conta" (UX-060)** foi cortado. Volta na parte 2, depois, ou não precisa?
8. **`npm audit`:** aceita conviver com o aviso de `braces` (só lint) até o Next publicar a correção?

## Handoff para a parte 2

**Estado da branch.** `feat/sprint-7-agency`, limpa e verde (`npm run check` e `npm run test:db` passam), com os commits desta parte por cima de `425c2a5`. Sem push, sem PR. A `main` não mudou.

**Antes de mexer em qualquer coisa:** `npm run db:start` (o Docker pode estar parado), `npm run test:db` e `npm run check`. Esperado: 816 asserções em 17 arquivos; 863 testes em 29 arquivos; 44 rotas.

**Banco local.** As duas migrações da Sprint 7 já estão aplicadas (`supabase migration list --local`). Use `supabase migration up` para as novas; não rode `db reset`.

**Contas e dados de QA criados no banco local** (domínio `example.test`; senhas não registradas — redefina por SQL se precisar entrar):

- `qa-sprint7-dona@example.test` (proprietária), `qa-sprint7-admin@example.test` (administrador), `qa-sprint7-editora@example.test` (removida da conta; participação `revoked`), `qa-sprint7-outra@example.test` (sem participação).
- Conta de agência **"Agência QA Sete"**, no plano `agency` por SQL, com 9 páginas vivas: `qa7-cafe-ipe-copia` (publicada, com foto e imagem reais, Pix, formulário e WhatsApp) e `qa7-cliente-01` a `-08` (rascunhos). A página `qa7-cafe-ipe` (origem da cópia) está excluída (*soft delete*) e ainda é dona das duas imagens que a cópia usa por `media_asset_shares`.
- Convites na conta: três pendentes (`qa-sprint7-lugar3/4/5@example.test`), deixando a conta com 5 de 5 lugares; um cancelado; um expirado (com hash de token de teste); dois aceitos.
- Os dados de QA das sprints anteriores continuam lá.

**Nada ficou pela metade no código.** O que a parte 2 herda como trabalho:

1. **AC5:** medir (script no repositório, contas `example.test` próprias) lista, consolidado e criação com 1, 10 e, se der, 50 páginas, com `EXPLAIN` de `list_workspace_profiles`. Para 50 páginas é preciso aumentar `max_profiles` localmente.
2. **AC1:** estender a tabela do ADR 0012 com as ações da parte 2 e rever as linhas desta parte contra o código.
3. **Fechamento:** relatório final único, `AGENTS.md` §22, `BACKLOG.md`, passos de deploy completos em `docs/ENVIRONMENTS.md` (a seção da parte 1 já existe).

**O que saber antes de ler agregados por conta:**

- **Páginas arquivadas** têm `status = 'archived'`, `live_publication_id` nulo, e **mantêm** agregados, eventos brutos dentro da retenção e `profile_id`. Elas param de receber eventos (a ingestão exige versão no ar). O painel delas continua acessível por decisão do founder; o consolidado deve incluí-las, rotuladas.
- **Páginas excluídas** (`deleted_at` preenchido) continuam com linhas em `analytics_daily` até o expurgo; `get_profile_analytics` já as recusa. Decida no ADR 0013 se entram no total da conta.
- **Cópias** começam sem histórico: ids de bloco novos e nenhum agregado. `profiles.duplicated_from` aponta a origem, mas não deve ser usado para somar resultados.
- **`list_workspace_profiles`** devolve, numa consulta, id, nome, endereço, situação, foto, datas e "tem alterações não publicadas" de cada página, além das contagens por situação. Serve de base para a tabela de páginas do consolidado; os números vêm de outra função.
- **Papéis:** `analytics.view` e `analytics.export` já são dos três papéis. As ações de link de relatório ainda não existem em `permissions.ts`; acrescente nos dois lados, como nesta parte.
- **Padrões para reaproveitar:** token e hash em `modules/identity/invitation-token.ts`; "uma resposta genérica para todo token inválido" em `private.resolve_invitation`; `ConfirmDialog` em `ui/confirm-dialog.tsx`; `isMissingSchemaError` em `lib/supabase/missing-schema.ts` para a falha segura antes da migração; `r` já está em `reserved_slugs` (confira nos dois lugares).
- **A conta de teste já está no plano Agência**, então tem `shareable_reports` e 90 dias de histórico. Não há tráfego de analytics nessas páginas: gere com `apps/web/scripts/analytics-accuracy.mjs` ou numa janela anônima (sessão do produto no mesmo navegador não conta).

## Passos de deploy em staging (parte 1; a lista final fica para o fechamento)

1. `npx supabase db push` (duas migrações: `202610060001`, `202610060002`).
2. Nenhum segredo e nenhuma variável nova.
3. Merge do PR.
4. Para testar: `update public.workspaces set plan_id = 'agency' where id = '<conta>';` no *SQL Editor*.

Detalhes em `docs/ENVIRONMENTS.md`, "Passos de deploy da Sprint 7".
