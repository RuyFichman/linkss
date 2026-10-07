# Relatório da Sprint 7

**Status:** implementada e verificada no ambiente local (Supabase local, `next start` de produção, Chrome). Em staging: as duas migrações da parte 1 foram aplicadas pelo founder em 06/10/2026 (informado por ele; não conferi o projeto hospedado); em 07/10/2026 ele informou que as duas da parte 2 também foram aplicadas (igualmente não conferido), e a branch foi enviada com o PR aberto. A aplicação só chega a staging depois do merge; nada da sprint foi verificado em staging (seção "Passos de deploy").
**Objetivo:** transformar o produto individual em ferramenta de operação (várias páginas, várias pessoas, níveis de acesso) e entregar a segunda metade do diferencial, "operação multi-perfil + prova de resultado".
**Resultado:** quem opera uma conta de agência encontra, arquiva e duplica páginas, traz colegas com o papel certo, vê os resultados de todas as páginas numa tela e entrega ao cliente um link somente leitura, com validade e cancelamento, que mostra os resultados de uma página e nada mais.
**Data:** 06/10/2026
**Branch:** `feat/sprint-7-agency`. Parte 1: `91c7aa9`, `33dbf65`, `214f9b2`, `5be24fb`, `23af1a8`. Parte 2: `e27b292` (banco), `8f0060e` (painel da conta), `6a0de51` (links de relatório), `38db843` e seguinte (script do AC5), e o commit de documentação que inclui este relatório.

## Como a sprint foi executada

A sprint foi dividida pelo founder em dois prompts, executados em duas sessões na mesma branch. A parte 1 entregou lista de páginas, busca, arquivamento, duplicação, convites, membros e papéis (ADR 0012). A parte 2 entregou o painel da conta, os links de relatório, a medição da décima página e este fechamento (ADR 0013). Entre as duas, o founder confirmou UX-019 e UX-051 a UX-059 e as duas escolhas técnicas abertas do ADR 0012, e aplicou as migrações da parte 1 em staging.

No início da parte 2 o estado da branch foi conferido contra o relatório parcial: `npm run test:db` (816 asserções em 17 arquivos) e `npm run check` (863 testes, 44 rotas) passaram sem alteração. **Uma divergência:** o relatório parcial e o bloco de estado do prompt diziam "nada aplicado em staging", e o founder informou ter aplicado as migrações da parte 1; este relatório registra o estado informado.

## Resultado por entrega

**Parte 1**

- **Lista de páginas** (`/app/w/<conta>`): busca por nome ou endereço, filtro por situação com contagem, ordem, 20 por tela, uso do plano e as ações que o papel permite. Tudo na URL, funciona sem JavaScript, uma consulta por tela.
- **Arquivar e desarquivar:** arquivar tira a página do ar na mesma transação, mantém endereço, versões, resultados e contatos, e congela o rascunho. Desarquivar devolve como rascunho.
- **Duplicar:** uma transação cria um rascunho novo com id novo em cada bloco. Imagens são compartilhadas por permissão, não copiadas. O rascunho copiado avisa o que revisar antes de publicar.
- **Convites e membros:** link mostrado uma vez (nenhum e-mail é enviado), válido por 7 dias, uso único, cancelável, aceito só pelo e-mail convidado; pendentes ocupam lugar. Tela *Membros* com alterar papel, remover e sair.

**Parte 2**

- **Resultados da conta** (`/app/w/<conta>/resultados`): totais do período, quantas páginas tiveram atividade, tabela de páginas ordenada por resultados (cartões no celular) com a situação dos dados de cada uma em palavras e link para o painel dela, dia a dia e origens somadas. Mesmos períodos, fuso e "atualizado em" do painel da página. CSV com uma linha por página.
- **Relatório para o cliente:** na tela de resultados de cada página, proprietário e administrador criam um link (últimos 7, 30 ou 90 dias completos; validade de 7, 30 ou 90 dias; anotação opcional), copiam uma vez, veem a lista com a situação em palavras e cancelam com confirmação.
- **`/r/<token>`:** nome da agência, nome e endereço da página, período, frase-resumo, visitas, resultados, taxa, de onde vieram os resultados e as visitas, o que mais foi clicado, dia a dia em gráfico e tabela, como os números são contados, e a data em que o link deixa de funcionar. Todo link que não abre relatório recebe o mesmo 404 com o mesmo texto.
- **Medição do AC5:** script no repositório, aprovado no limiar definido antes de medir.

## Estado dos gates

- **Gate de usabilidade:** o *override* do founder de 25/09/2026 continua valendo; as cinco sessões seguem pendentes.
- **UX confirmadas:** UX-020, 021, 023, 025 (30/09/2026) e UX-019, UX-051 a UX-059 (06/10/2026). **Provisórias:** UX-060 (corte de "lembrar a última conta") e as novas **UX-061 a UX-071**, usadas como padrão.
- **Staging:** nada foi tocado por mim em nenhuma das partes. Nenhuma migração, segredo ou configuração no Supabase hospedado ou na Vercel.
- **Falha segura:** coberta por testes de unidade (`not_deployed`); **não** exercitada no navegador contra um banco sem as migrações.

## Decisões tomadas

Técnicas, parte 1 (ADR 0012): arquivadas contam no limite (UX-019, confirmada); arquivar usa o efeito de "Tirar do ar" e uma constraint impede situação e versão no ar de divergirem; mídia compartilhada entre original e cópia (confirmada); convites em tabela própria; token de 256 bits no caminho da URL (confirmado), só o hash guardado; aceite só pelo e-mail convidado; lista por função `security invoker`; sem dependência nova.

Técnicas, parte 2 (ADR 0013):

- **Uma definição de cada número.** `get_profile_analytics` manteve assinatura e resposta e passou a delegar para um núcleo privado que o relatório também chama. Na aplicação, o painel da conta e o relatório usam as funções do painel da página; `totalsFromCounts` foi extraído para que a linha de uma página na conta e o painel dela não possam divergir.
- **Leitura da conta numa chamada**, com uma segunda função de contagem de dias abertos filtrada por conta. É a única duplicação, justificada por custo (a função existente varreria os dias abertos de todos os clientes uma vez por página) e vigiada por um teste de igualdade.
- **Páginas excluídas ficam fora do total da conta;** arquivadas e fora do ar entram. Só vira linha a página no ar ou com evento no período.
- **Relatório = janela móvel de dias completos** (termina ontem). Sem intervalo fixo de datas.
- **Sem registro de abertura do link.** O "aberto pela última vez" recomendado não foi construído: a prévia de link de um aplicativo de mensagens marcaria o relatório como aberto antes de qualquer pessoa, e a rota hoje não guarda nada sobre quem lê.
- **Lista fechada de campos montada no banco,** sem identificadores, sem UTM, sem aparelhos e países, sem rascunho. Títulos vêm da versão publicada.
- **Rota dinâmica, sem cache, sem cookie, sem terceiros, sem coletor.** Cabeçalhos aplicados pelo `next.config.ts` também ao 404.
- **Limite de tentativas por endereço no banco** (20 falhas em 10 minutos), declarado como redutor de custo, não como fronteira de segurança.
- **Links param de abrir sem `shareable_reports` e são mantidos;** sobrevivem à saída de quem criou; cancelar é permitido mesmo com a conta suspensa.
- **Sem dependência nova, sem segredo novo, sem variável nova.**

Produto/UX, parte 2 (`docs/ux/UX_DECISIONS.md`, todas provisórias): UX-061 (painel da conta como ranking e triagem), UX-062 (quais páginas aparecem), UX-063 (situação dos dados em palavras), UX-064 (dias completos, padrão 30), UX-065 (validade obrigatória, link mostrado uma vez, 5 por página), UX-066 (o que o relatório não mostra), UX-067 (um só texto para link que não abre), UX-068 (papéis), UX-069 (sem o recurso no plano), UX-070 (sem registro de abertura), UX-071 (rodapé de atribuição segue o selo).

### Cortes de escopo

- **Lembrar a última conta usada em `/app`** (parte 1; primeiro item da lista de cortes daquela parte).
- **Data de última abertura do link** (parte 2; item da lista de cortes, cortado por decisão e não por prazo; a anotação do link foi entregue).
- Nenhum outro item da lista de cortes da parte 2 foi cortado: CSV do consolidado, origens no consolidado, ranking de blocos no relatório e a medição com 50 páginas foram entregues.

## Critérios de aceite

| # | Critério (`PLANO_DE_EXECUCAO.md`) | Estado | Evidência (parte que a produziu) |
|---|---|---|---|
| AC1 | Permissões aplicadas no servidor para cada ação sensível | **verificado** | Tabelas "AC1" no ADR 0012 (parte 1) e no ADR 0013 (parte 2), uma linha por tela, Server Action, rota e RPC contra proprietário, administrador, editor, membro de outra conta e `anon`. **Banco:** pgTAP `150-agency-operations` (parte 1) e `160-reports` (parte 2), cada papel em cada RPC; `010-structure`: `anon` executa só quatro funções (página pública, relatório, formulário, ingestão) e nenhum papel lê hash de token. **Aplicação:** Vitest de `identity`, `invitations`, `member-actions`, `profiles/service` (parte 1) e `analytics/workspace`, `reports/reports`, `reports/actions`, rota de exportação (parte 2): o serviço recusa antes de chamar o repositório. **Chamada direta ao servidor (parte 2):** com sessões reais de editora e de membro de outra conta, criar e cancelar link devolveram `42501` e `P0002`, a lista veio vazia, o consolidado de outra conta devolveu `P0002` e `anon` recebeu 401. **Revisão das linhas da parte 1:** os testes foram rodados de novo no fim da sprint e continuam valendo |
| AC2 | Template duplicado não compartilha conteúdo mutável com o original | **verificado** (parte 1; testes rodados de novo na parte 2) | pgTAP 150: ids de bloco novos; editar ou publicar a cópia não muda o original e vice-versa; arquivar ou excluir o original deixa a cópia funcionando com as imagens; a limpeza transfere as imagens para a cópia; a cópia nasce sem publicações, analytics, leads e histórico de endereço. Navegador (parte 1): página com foto, imagem, Pix, formulário e WhatsApp duplicada, cópia publicada, original excluído, imagens da cópia respondendo 200. **Links de relatório não são copiados** (existem só por página; pgTAP 160 cria links por página). **Não coberto:** domínio próprio e pixels ainda não existem (Sprint 8) |
| AC3 | Convites expiram, podem ser revogados e não concedem acesso à conta errada | **verificado** (parte 1; testes rodados de novo na parte 2) | pgTAP 150: aceito uma vez; expirado, cancelado, substituído, desconhecido, malformado e nulo devolvem a mesma linha; outra conta e conta não confirmada → `wrong_account` sem dados; sem escalada para quem já é membro; limite entre convite e aceite; recusa de proprietário por convite; expurgo após 30 dias; trilha sem endereço nem token. Navegador (parte 1): três contas, aceite como administrador e editora, conta errada, link reusado |
| AC4 | Relatório compartilhado não expõe configurações internas nem dados de outros perfis | **verificado no local** (parte 2) | **Lista campo a campo** no ADR 0013 ("What the report contains"). **pgTAP 160:** as chaves da resposta são exatamente a lista (o teste falha com um campo a mais), e o mesmo para cada linha de dia, origem e bloco; nenhuma sequência com formato de UUID em toda a resposta; valores de UTM, título só do rascunho e anotação do link ausentes; o token da página A nunca devolve nada da B, na mesma conta e em outra; desconhecido, malformado, nulo, vazio, hash usado como token, expirado e cancelado devolvem o mesmo `{"status":"unavailable"}`; o link para ao excluir a página, suspender ou excluir a conta e perder `shareable_reports`, e volta quando o recurso volta; continua com página fora do ar ou arquivada (sem o endereço) e depois que quem criou sai. **Vitest:** o modelo de tela é montado só com a lista fechada (campos extras na resposta não aparecem); cabeçalhos da rota fixados em teste e aplicados pelo `next.config.ts`. **Resposta real (build de produção):** `Cache-Control: private, no-store, max-age=0`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet`, sem `Set-Cookie`, também no 404; HTML sem id de conta, página, bloco ou pessoa; o token aparece só como o segmento de rota da própria página; cancelado → 404 na requisição seguinte. **Ressalvas:** não verificado em staging; revisão jurídica do texto pendente |
| AC5 | Agência cria o décimo perfil sem degradação perceptível | **verificado no local** (parte 2) | Limiar escrito antes de medir, no cabeçalho de `apps/web/scripts/agency-scale.mjs`: requisições por tela constantes com o número de páginas; mediana com 10 páginas até 2x a de 1 página e abaixo de 300 ms. Resultado: **PASS** (tabela em "Medição do AC5"). `EXPLAIN` com uso de índice para a lista, o consolidado (dias fechados e abertos) e a busca do link. **Ressalva:** medido em máquina local, com banco local e dados sintéticos; não é medição de campo |

## Entregáveis

| Parte | Entrega | Onde revisar |
|---|---|---|
| 1 | ADR 0012 | `docs/adr/0012-multi-page-operations-invitations-and-roles.md` |
| 1 | Migrações + pgTAP | `supabase/migrations/202610060001_sprint7_enum_values.sql`, `202610060002_agency_operations.sql`; `supabase/tests/database/150-agency-operations.test.sql` |
| 1 | Módulos e telas | `modules/identity/*` (convites, membros), `modules/profiles/*` (lista, arquivar, duplicar), `app/app/w/[workspaceId]/{page,membros,paginas/[profileId]/duplicar}`, `app/app/convite/[token]` |
| 2 | ADR 0013 | `docs/adr/0013-consolidated-analytics-and-report-links.md` |
| 2 | Migrações + pgTAP | `supabase/migrations/202610060003_sprint7_report_enum_values.sql`, `202610060004_consolidated_analytics_and_report_links.sql`; `supabase/tests/database/160-reports.test.sql` (131 asserções), `010-structure.test.sql` (+4); `apps/web/src/lib/database.types.ts` regenerado |
| 2 | Módulos puros e servidor | `modules/analytics/{workspace,workspace-service,dashboard,supabase-repository,server}.ts`; `modules/reports/{links,token,shared-report,service,server,actions,response-headers}.ts`; `modules/identity/permissions.ts` |
| 2 | Painel da conta | `app/app/w/[workspaceId]/resultados/{page,loading}.tsx`, `…/resultados/exportar/route.ts`; navegação em `layout.tsx`; atalho na lista de páginas |
| 2 | Links de relatório | `modules/reports/components/{report-links-section,report-link-form}.tsx` na tela `…/paginas/[profileId]/resultados`; rota pública `app/r/{layout.tsx,[token]/page.tsx,[token]/not-found.tsx}`; cabeçalhos em `next.config.ts` |
| 2 | Textos | `content/pt-BR.ts` (`WORKSPACE_ANALYTICS_COPY`, `REPORTS_COPY`), `content/shared-report.ts` (o que o cliente lê) |
| 2 | Medição | `apps/web/scripts/agency-scale.mjs` |
| 2 | Testes | Vitest: `modules/analytics/workspace.test.ts`, `modules/reports/{reports,actions}.test.ts`, `app/r/[token]/page.test.ts`, `app/app/w/[workspaceId]/resultados/exportar/route.test.ts`, `modules/identity/identity.test.ts` (matriz) |
| 2 | Documentação | ADR 0013; ADR 0011 e 0012 (notas resolvidas); `docs/{ARCHITECTURE,THREAT_MODEL,DATA_MAP,OBSERVABILITY,SUPABASE_CAPACITY,ENVIRONMENTS}.md`; `docs/runbooks/REPORTS.md` (novo); `docs/ux/{UX_DECISIONS,CONTENT_GUIDE}.md`; `README.md`; `BACKLOG.md`; `AGENTS.md` §22; página `/privacidade` |

## Validação executada

### Resultado final registrado

```text
npm audit: 5 high (só ferramentas de desenvolvimento: eslint-config-next → fast-glob → micromatch → braces); npm audit --omit=dev: found 0 vulnerabilities
lint: aprovado (eslint --max-warnings=0)
typecheck: aprovado
test: 34 arquivos, 943 testes aprovados (80 novos na parte 2; 173 na parte 1)
test:db: 18 arquivos, 951 asserções aprovadas (135 novas na parte 2: 131 no arquivo 160 e 4 no 010; 177 na parte 1)
supabase db advisors --local: No issues found
build: aprovado, 47 rotas + Proxy (3 novas na parte 2: /app/w/[workspaceId]/resultados, /app/w/[workspaceId]/resultados/exportar, /r/[token]; 3 na parte 1)
npm run check: aprovado (exit 0)
```

As quatro migrações da sprint foram aplicadas no banco local com `supabase migration up`. **Não rodei `db reset`.** A aplicação a partir do zero fica a cargo do job `database` do CI, que ainda não rodou com esta branch (não houve push).

### Medição do AC5

`node scripts/agency-scale.mjs`, build de produção em `localhost:3100`, Supabase local, 20 renderizações por tela depois de 3 de aquecimento. A conta medida tem páginas publicadas com 89 dias de agregados; uma segunda conta do mesmo tamanho serve de ruído para o planejador. Requisições = chamadas ao PostgREST por renderização, contadas por `pg_stat_statements`.

| Páginas | Tela | Mediana (ms) | p95 (ms) | Requisições | Banco por tela (ms) |
|---:|---|---:|---:|---:|---:|
| 1 | Lista de páginas | 17,7 | 21,5 | 5 | 3,4 |
| 1 | Resultados da conta (30 dias) | 21,2 | 29,1 | 3 | 5,7 |
| 1 | Criar página (5 execuções) | 192,0 | 1.879,7 | 5 | 3,0 |
| 10 | Lista de páginas | 18,5 | 28,9 | 5 | 3,0 |
| 10 | Resultados da conta (30 dias) | 24,7 | 26,9 | 3 | 7,7 |
| 10 | Criar página (5 execuções) | 165,1 | 312,9 | 5 | 2,8 |
| 50 | Lista de páginas | 20,1 | 26,6 | 5 | 3,2 |
| 50 | Resultados da conta (30 dias) | 51,0 | 64,5 | 3 | 29,2 |

Leitura honesta dos números:

- **As requisições não crescem com o número de páginas** em nenhuma tela. O que cresce no painel da conta é o volume agregado (50 páginas × 30 dias = 8.700 linhas, 29 ms de banco), que é inerente à pergunta.
- **A décima criação é da mesma ordem da primeira** (165 ms contra 192 ms de mediana; 2,8 ms contra 3,0 ms de banco). O tempo de "criar página" é o das cinco chamadas que a Server Action faz, **repetidas pelo script** pelo gateway local; não é o tempo da Server Action no navegador. O p95 de 1.880 ms com 1 página é a primeira das cinco execuções (conexão fria), não um efeito do tamanho.
- Uma primeira execução do script, antes de um ajuste no fixture, deu os mesmos padrões (lista 17,9/18,2/19,9 ms; conta 19,7/23,2/48,5 ms; criação 329/291 ms). Nenhuma das duas mostrou crescimento que exigisse correção.
- Com 50 páginas não se mede criação: o plano Agência permite 10. Para a leitura com 50, o script eleva o limite dentro de uma transação e o restaura antes do `commit`.

`EXPLAIN` (53.429 linhas em `analytics_daily`, 26.700 da conta medida): dias fechados → `Index Scan using analytics_daily_workspace_day_idx` (8.700 linhas); dias abertos → `Index Scan using analytics_events_workspace_profile_time_idx`; busca do link → `Index Scan using report_links_token_hash_key`; lista, como membro sob RLS → `Index Scan using profiles_workspace_live_created_idx`.

### Igualdade dos totais entre as três telas

Conferido por script contra o build de produção, com tráfego real enviado a `/api/events` para três páginas (7, 4 e 2 visitas; 3, 1 e 0 cliques no WhatsApp, todos contados), antes e depois de rodar o job de analytics:

| Janela | Painel da conta | Soma dos 50 painéis de página |
|---|---|---|
| Hoje | 163 visitas, 4 resultados | 163 visitas, 4 resultados |
| 7 dias (depois do job) | 13.027 visitas, 1.768 resultados | 13.027 visitas, 1.768 resultados |
| 30 dias | 62.339 visitas, 8.530 resultados | 62.339 visitas, 8.530 resultados |

A tela da conta mostrou esses totais; para as três páginas, o painel de cada uma mostrou o mesmo número da sua linha na conta. **Relatório:** para os mesmos 30 dias completos, a página do relatório mostrou "1.230 visitas e 120 resultados", igual à leitura do painel da página para a mesma janela. (O painel da página, que inclui hoje, mostra 1.206 para "30 dias": são janelas diferentes, e é esperado.) No pgTAP a igualdade é comparada linha a linha, por dia e por tipo.

### Verificação ponta a ponta (script, 79 verificações, todas aprovadas)

Contas `qa-ac5-*@example.test` em `127.0.0.1:3100`: ingestão real; igualdade dos totais; relatório aberto sem sessão, com a sessão de outra conta e com a da proprietária (mesmo conteúdo); cabeçalhos; ausência de cookie, de requisição a terceiros e do coletor; abrir o relatório não grava evento; mudar a URL não alcança a página B; token desconhecido, malformado, com um caractere trocado, hash no lugar do token, expirado (linha ajustada no banco local), cancelado, conta sem `shareable_reports` e conta suspensa → mesmo 404 e mesmo documento; cancelamento vale na requisição seguinte; o link volta quando o recurso volta; editora e membro de outra conta chamando o servidor direto; 20 tentativas erradas bloqueiam o endereço e não outro; CSV (200, anexo, marca de ordem de bytes, fuso, 50 linhas, 17 colunas), recusa de origem cruzada e de quem não é membro; trilha de auditoria; log do servidor sem token e sem caminho de relatório.

### Navegador (Chrome, build de produção)

- Painel da conta com 50 páginas em desktop; em 360, 390, 430 e 768 px (iframe) sem rolagem horizontal e sem alvo menor que 44 px; no celular as linhas viram cartões e a tabela mantém os papéis ARIA.
- Criar link pelo formulário (o link apareceu uma vez, com a validade); o relatório abriu com os números certos; cancelar pelo diálogo (foco dentro do diálogo, texto dizendo que para imediatamente); o relatório passou a responder 404 e a mostrar "Relatório não disponível" no recarregamento seguinte.
- O relatório não pode ser carregado em iframe (`X-Frame-Options: DENY`), como previsto.

**Não feito, marcado como preparado e não verificado:** o relatório em largura de celular (a janela não ficou menor que o desktop e o iframe é bloqueado; a página usa a mesma grade de uma coluna das outras telas); impressão e "salvar como PDF" (as regras `@media print` e `break-inside: avoid` estão na folha de estilo, mas nada foi impresso); o CSV aberto num programa de planilha (conferido só o formato do arquivo); celular real, Safari e leitor de tela; a aplicação contra um banco sem as migrações; e, da parte 1, cadastro novo a partir de convite, alterar papel e sair pela interface.

### Problemas encontrados e corrigidos

Parte 2:

- **Condição `if … case … then` no PL/pgSQL** da leitura do relatório não compilava; reescrita com uma variável (pego ao aplicar a migração numa transação de teste, antes de aplicá-la).
- **Fixture do script do AC5:** o histórico sintético era mais antigo que as páginas, e o relatório respondia, corretamente, "a contagem começou depois deste período". O script passou a retroagir a criação das páginas de teste.
- **Tabela do painel da conta no celular:** ao virar cartões ela perderia a semântica de tabela em alguns navegadores; os papéis ARIA ficaram explícitos.
- **Página `/privacidade`:** dizia que só o dono da página vê os totais; passou a mencionar as pessoas convidadas e o link de relatório.

Parte 1 (já registrados): o link do convite sumia ao ocupar o último lugar; retenção de convite expirado e depois substituído; termo de busca com hífen nas pontas; aceite registrado em nível `warn`.

**Defeitos da parte 1 corrigidos na parte 2:** nenhum foi encontrado.

## Segurança, privacidade, acessibilidade, performance e operação

- **Segurança:** seções novas em `docs/THREAT_MODEL.md` (uma por parte). Casos negativos da parte 2: leitura cruzada entre páginas e entre contas; tokens expirado, cancelado, desconhecido, malformado, nulo, vazio e hash no lugar do token; recurso ausente no plano; cada papel contra cada ação; `anon`; cache depois do cancelamento; token em log e em `Referer`; lista fechada de campos; período, validade e anotação inválidos; limite de links ativos e de criações; inserção, alteração e exclusão diretas na tabela; POST de outra origem na exportação. Nenhuma validação, policy ou regra de lint foi afrouxada.
- **Privacidade:** `docs/DATA_MAP.md` (`report_links` campo a campo; o relatório como divulgação a um terceiro escolhido pela conta; retenção; exportação e exclusão). Nenhum subprocessador novo, nenhum e-mail enviado, nenhum cookie para quem abre um relatório, nenhum registro de quem abriu. O relatório não tem dado de visitante. A base legal é proposta e depende da revisão jurídica.
- **Acessibilidade:** todo número em texto ou tabela; gráfico com descrição; situação em palavras; rótulos programáticos; nomes acessíveis próprios nos botões repetidos ("Ver detalhes de …", "Cancelar link: …"); diálogo com foco; alvos de 44 px nas telas da conta. **Leitor de tela real não foi usado.**
- **Performance:** a página pública não mudou: nenhum arquivo do seu grafo de módulos foi alterado e o JavaScript transferido é de 189.201 bytes (189.200 na Sprint 6). Painel da conta: 3 requisições por tela.
- **Operação:** sinais novos em `docs/OBSERVABILITY.md`; runbook `docs/runbooks/REPORTS.md` ("o link não abre", "derrubar um link agora", "os números não batem", tentativas em massa); `docs/runbooks/AUTH_ACCESS.md` seções 5 e 6 (parte 1); passos de deploy em `docs/ENVIRONMENTS.md`.

## Pendências, gaps e riscos

- **Staging:** a aplicação das quatro migrações (parte 1 em 06/10, parte 2 em 07/10) foi informada pelo founder e não conferida por mim. O PR está aberto e sem merge; nada da sprint foi verificado em staging.
- **O token do relatório fica no caminho da URL** e, portanto, no log de requisições da hospedagem e no histórico do navegador. Mitigado por validade, cancelamento e por abrir só totais de uma página. O mesmo vale para o token do convite.
- **Um link encaminhado é um link compartilhado:** quem recebe abre. É a natureza do recurso; a tela avisa.
- **Sem limite global nem CAPTCHA** na frente de `/r/` e das ações (Sprint 9). O limite por endereço no banco pode ser contornado por quem chama a RPC direto; sem `VISITOR_HASH_SALT`, todos dividiriam um balde.
- **404 do relatório sem JavaScript é uma página em branco** (status e cabeçalhos corretos): o framework renderiza estados de "não encontrado" no cliente. O mesmo acontece com o 404 das páginas públicas na primeira requisição.
- **Expurgo de links e de contadores** só acontece na criação ou na falha seguinte; o agendado fica para a Sprint 9.
- **Relatório sem intervalo fixo de datas** e sem campanha (UTM): decisões provisórias.
- **Rebaixamento de plano:** nada é removido. Páginas além do limite e pessoas além dos lugares continuam; links de relatório param de abrir; um histórico menor encurta os relatórios existentes. A Sprint 8 decide o que comunicar.
- **`npm audit`:** 5 avisos altos em ferramentas de desenvolvimento (`braces`, via `eslint-config-next`), sem correção compatível hoje; nada disso vai para o servidor nem para o navegador.
- **Não verificado:** os itens listados em "Não feito".
- **Banco local:**
  - o job de analytics do próprio produto foi executado algumas vezes no stack local, pela rota `/api/jobs/analytics` (o prompt pedia): marcou como finais os dias 02 a 05/10 e agregou-os; **nenhum evento foi apagado**;
  - ficaram as contas `qa-ac5-escala@example.test`, `qa-ac5-editora@example.test` e `qa-ac5-vizinha@example.test`, as contas "AC5 Escala" e "AC5 Ruído" com 50 páginas cada e cerca de 53 mil linhas sintéticas em `analytics_daily`. `node scripts/agency-scale.mjs --cleanup` (em `apps/web`) remove tudo isso;
  - continuam os dados de QA da parte 1 (`qa-sprint7-*@example.test`, "Agência QA Sete") e das sprints anteriores.
- **Fora do repositório:** nada foi escrito ou apagado fora dele além dos arquivos temporários da sessão. No Chrome usei `127.0.0.1:3100`, que não compartilha cookies com `localhost`: a sessão local do founder não foi tocada nesta parte.
- **Herdadas:** sessões de usabilidade, Auth hospedado em padrões, SMTP, CAPTCHA, LCP/CLS de visitantes reais, primeira execução agendada dos crons com sucesso, revisão jurídica.

## Perguntas para o founder

1. **Relatório termina ontem (UX-064):** só dias completos, sem intervalo fixo. Serve para o piloto, ou as agências vão querer "o mês de setembro"?
2. **Sem "aberto pela última vez" (UX-070):** aceita não saber se o cliente abriu?
3. **O relatório não mostra campanhas (UTM), aparelhos e países (UX-066).** Concorda?
4. **Só proprietário e administrador criam links (UX-068).** Editor deveria poder?
5. **Limites:** 5 links ativos por página, validade máxima de 90 dias, 30 criações por dia por conta. Algum ajuste?
6. **Rebaixamento (UX-069):** links param de abrir e voltam se o plano voltar. É o comportamento que a Sprint 8 deve manter?
7. **Rodapé "Relatório gerado com Projeto LNK" (UX-071)** só aparece em plano sem remoção de selo (hoje, nenhum que tenha relatório). Manter assim?
8. **"Lembrar a última conta" (UX-060)** continua cortado. Volta?
9. **`npm audit`:** aceita conviver com o aviso de `braces` (só lint) até o Next publicar a correção?

## Passos de deploy em staging

1. `npx supabase db push` com a CLI logada na conta dona do projeto: deve listar `202610060003_sprint7_report_enum_values` e `202610060004_consolidated_analytics_and_report_links` (as duas da parte 1 já constam como aplicadas, segundo o founder; se não constarem, elas entram na mesma execução).
2. Nenhum segredo e nenhuma variável nova.
3. Enviar a branch `feat/sprint-7-agency`, abrir o PR e fazer o merge (a `main` publica em staging). O job `database` do CI aplica as 15 migrações do zero: é a primeira vez que isso roda para a Sprint 7.
4. Pôr a conta de teste no plano Agência: `update public.workspaces set plan_id = 'agency' where id = '<conta>';`.
5. Conferir: lista com busca, *Membros*, *Resultados* da conta, criar um link de relatório, abrir numa janela anônima, cancelar e recarregar.

Entre a aplicação chegar e as migrações serem aplicadas (ou o contrário), nada do que existia quebra; os detalhes estão em `docs/ENVIRONMENTS.md`, "Passos de deploy da Sprint 7".

## Implicações para a Sprint 8

- **Quatro entitlements já governam a Sprint 7** e são lidos a cada requisição, sem cópia: `max_profiles` (criar e duplicar), `team_members` (convidar e aceitar; pendentes contam), `shareable_reports` (criar e abrir links) e `analytics_days` (profundidade dos painéis e período máximo de um relatório). Trocar o plano de uma conta muda o comportamento na requisição seguinte, sem migração de dados.
- **Rebaixamento, hoje:** páginas acima do limite continuam existindo e publicadas, só não se cria nem se duplica; pessoas acima dos lugares mantêm o acesso, só não se convida; links de relatório param de abrir e ficam guardados; relatórios e painéis passam a mostrar menos dias. **A Sprint 8 precisa decidir** o que comunicar em cada caso e se algo deve ser bloqueado (por exemplo, impedir publicar com páginas acima do limite).
- **Sem fluxo de upgrade em nenhuma tela:** onde um limite aparece, há uma frase e nenhum botão. A Sprint 8 liga esses pontos ao checkout: aviso de limite de páginas, de lugares, períodos não cobertos e a seção de relatório.
- **Plano Agência por SQL** é provisório e some com a cobrança.
- **Domínio próprio e pixels** não devem ser copiados na duplicação (ADR 0012) nem aparecer no relatório (ADR 0013); o endereço mostrado no relatório vem de `NEXT_PUBLIC_APP_URL` e precisará considerar o domínio próprio.
- **Ponto de partida recomendado:** ADR do provedor de pagamento e o modelo de assinatura que escreve `workspaces.plan_id`; depois, as decisões de rebaixamento acima, que dependem só de texto e de regras já centralizadas nas RPCs.
