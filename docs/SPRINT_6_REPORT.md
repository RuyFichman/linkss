# Relatório da Sprint 6

**Status:** implementada e verificada no ambiente local (Supabase local, `next start` de produção, Chrome). **Nada foi aplicado em staging**: as duas migrações, o segredo do Vault e a variável da Vercel desta sprint estão pendentes (passos em `docs/ENVIRONMENTS.md`). O país das visitas e a primeira execução do cron só podem ser conferidos lá.
**Objetivo:** o dono de uma página publicada abre um painel e vê, por período, visitas, resultados, origens e blocos usados, com números deduplicados, filtrados, coerentes no fuso e honestos sobre lacunas, coletados sem atrasar nem bloquear nenhum visitante
**Data:** 02/10/2026
**Branch:** `feat/sprint-6-analytics`, criada a partir de `origin/main` (`d898123`, que já continha a branch `docs/staging-field-measurements`). Sem push e sem PR: aguardam aprovação.

## Resultado

- **Página pública:** um coletor pequeno (1.176 bytes comprimidos) registra a abertura da página e os cliques em link, redes sociais, WhatsApp, vídeo ou música, Pix (copiar e link de pagamento) e no selo. O envio de formulário é registrado pelo banco, junto com o lead. Os links continuam sendo âncoras para o destino real; nada espera a rede.
- **Ingestão:** `POST /api/events` responde 204 antes de falar com o banco, descarta robôs, prévias de link, pessoas com sessão do produto e requisições de outra origem, deriva origem, aparelho e país, e assina o lote. O banco confere a assinatura, a página publicada, o bloco na publicação no ar, a duplicidade e os limites.
- **Agregação:** um job diário (`/api/jobs/analytics`) consolida os dias encerrados e apaga o bruto com mais de 7 dias. O painel não espera o job: os dias ainda abertos são contados do bruto daquela página.
- **Painel** (`/app/w/<conta>/paginas/<página>/resultados`): períodos Hoje, 7, 30 e 90 dias conforme o plano; visitas, resultados, resultados a cada 100 visitas, cliques em links; caminho até o resultado; gráfico e tabela dia a dia; blocos mais usados; origens; aparelhos; países; campanhas UTM; exportação CSV; "Como contamos".
- **Honestidade dos números:** cinco situações sem números têm texto próprio, e os dias anteriores ao início da contagem aparecem como "sem dado", nunca como zero.

## Estado dos gates (§0 do prompt)

- **Gate de usabilidade:** o *override* do founder de 25/09/2026 continua valendo; as cinco sessões seguem pendentes.
- **UX confirmadas:** UX-020, 021, 023 e 025. As demais, inclusive as novas **UX-043 a UX-050**, são provisórias e foram usadas como padrão.
- **Staging:** não foi tocado. Nenhuma migração aplicada, nenhum segredo criado, nenhuma configuração alterada no Supabase hospedado nem na Vercel. O `apps/web/vercel.json` ganhou um segundo cron, que só passa a valer quando o PR for mergeado.
- **Falha segura:** sem a migração ou sem o segredo, a página pública abre, os eventos são descartados, o painel mostra "Resultados ainda não disponíveis" e o job responde 503. Verificado no navegador e por testes.

## Decisões tomadas

Técnicas (ADR 0011, em inglês; ADR 0007, 0008 e 0010 receberam referência cruzada):

- **Contrato de eventos, versão 1:** nove tipos fechados. São **resultado**: clique no WhatsApp, cópia da chave Pix, clique no link de pagamento e envio de formulário. Clique em link, em rede social e carregamento de vídeo/música são contados à parte. Clique em imagem ficou fora porque o bloco de imagem não tem link.
- **Formulário contado no banco:** `submit_form_lead` grava o evento na mesma transação do lead. O coletor não envia esse tipo e a RPC de ingestão o recusa. Funciona sem JavaScript e não há contagem dupla.
- **RPC anônima atestada:** o servidor assina o lote (HMAC com `ANALYTICS_SIGNING_SECRET`; o banco confere com o Vault), como no upload de mídia. Sem isso, quem tem a chave publicável poderia chamar a RPC e escolher o hash do visitante, o país e a origem. Nenhuma chave secreta no caminho do visitante.
- **Visita:** uma abertura por visitante a cada 30 minutos; repetições não são gravadas. "Visitantes únicos" não é exibido.
- **Hashes diários** com `VISITOR_HASH_SALT` (reutilizado, com prefixo próprio): metade depende de página + endereço (limite), metade de página + endereço + user agent (regra de visita). Um terceiro, só do endereço, alimenta um contador entre páginas que não guarda página. Nenhum cookie nem armazenamento no navegador.
- **Dimensões:** origem em 12 categorias (o host do referrer é classificado e descartado), UTM restrito e com teto de 20 combinações por página por dia, aparelho em 4 classes, país pelo cabeçalho da hospedagem.
- **Tráfego filtrado é descartado**, não guardado com marca: robôs e prévias por user agent, `navigator.webdriver`, sessão do produto no mesmo navegador (sem consulta ao banco), visita vinda de `/app`. A prévia e o editor não montam o coletor.
- **Armazenamento:** tabela bruta com `DELETE` simples (sem particionamento) e uma tabela única de agregados por dimensão. Nenhum papel de cliente lê as tabelas; a leitura é por `get_profile_analytics`, que aplica o entitlement `analytics_days` (sem comparar nome de plano).
- **Fuso:** `America/Sao_Paulo` para todas as páginas, guardado em `analytics_settings`. "Últimos N dias" termina hoje e inclui hoje.
- **Agendador:** Vercel Cron diário (o plano Hobby permite 100 crons por projeto, uma vez por dia cada; conferido em 02/10/2026).
- **Sem dependência nova:** gráficos em SVG no servidor, datas com `Intl`, classificação de user agent e de origem em funções pequenas com tabela de casos.

**Mudança de desenho durante a sprint.** A medição do tamanho das linhas mostrou duas falhas do primeiro desenho, corrigidas antes de seguir (commit `90f24a4`):

- o hash único (endereço + user agent) deixava um remetente abrir um balde de limite novo, e uma visita nova, trocando o user agent; e um endereço podia espalhar um flood por muitas páginas. Agora o limite é por endereço, existe o contador entre páginas e a ingestão descarta tudo quando a tabela bruta chega a cerca de 500 mil eventos;
- guardar agregados por 400 dias custaria ≈ 2,5 MB por página ativa. Ficaram 100 dias (o maior histórico que algum plano mostra é 90).

Produto/UX, todas provisórias (`docs/ux/UX_DECISIONS.md`): UX-043 (o que é resultado), UX-044 (regra de visita, sem "únicos"), UX-045 (períodos e fuso), UX-046 (tela por página; períodos fora do plano visíveis com o motivo), UX-047 ("a cada 100 visitas" em vez de percentual), UX-048 (um texto por situação sem números), UX-049 (o que não entra na conta e "Como contamos"), UX-050 (CSV para todos os papéis; retenção).

### Cortes de escopo

- **Região (UF):** primeiro item da lista de cortes. Só o país é guardado.
- Os demais itens da lista (aparelhos, detalhe de campanha UTM, "Hoje", CSV) **foram entregues**.

## Critérios de aceite

| # | Critério | Estado | Evidência |
|---|---|---|---|
| AC1 | Analytics nunca impede a abertura do destino clicado | **verificado** | Navegador (Chrome, build de produção): com a rota respondendo **500**, clique real no link → destino aberto; nenhum clique com `defaultPrevented` em link, WhatsApp, rede social e link de pagamento; com a rota **pendurada** (nunca responde), clique real no link, e cliques em WhatsApp e rede social → destinos abertos; com a requisição **recusada pelo cliente** (`sendBeacon` falso e `fetch` rejeitado), vídeo carregado em 1 ms, botão de copiar respondeu, link de pagamento aberto, zero erros e zero rejeições não tratadas na página. Vitest `collector.test.ts`: listeners `passive` e `capture`; o código do coletor não contém `preventDefault`, `stopPropagation` nem `await`; falha de transporte, `fetch` que lança e endpoint que nunca responde não lançam nada. A página é HTML estático com âncoras para o destino real (teste de marcação). **Ressalvas:** os cliques em WhatsApp e rede social foram disparados por `element.click()`, porque a automação não entregou o clique do mouse nesses dois links; a página com JavaScript desligado não foi reaberta no navegador nesta sprint (o comportamento vem da Sprint 5 e a marcação não mudou) |
| AC2 | Eventos duplicados por retry têm deduplicação definida | **verificado** | ADR 0011: chave `(página, id do evento)`, janela igual à retenção do bruto, duplicata ignorada sem erro. Vitest: uma falha de rede é repetida uma vez com os mesmos ids, e uma resposta do servidor nunca é repetida. pgTAP 140: mesmo evento e mesmo lote enviados duas vezes ficam guardados uma vez; id repetido dentro do lote; job rodado duas vezes gera linhas idênticas (impressão digital da tabela). Teste de precisão: 40 retries, 0 a mais. Navegador: duas recargas → `repeat`, 1 visita |
| AC3 | O painel distingue "sem dados" de "zero" | **verificado** | Função pura `dashboardState` com tabela no Vitest (12 casos) e `aggregationIsDelayed` (6 casos); cada estado tem texto próprio (teste). Navegador: "Resultados ainda não disponíveis" (segredo ausente), "Página ainda não publicada", "Sem dados ainda", "Nenhuma visita neste período", aviso "consolidação diária atrasada" e, por dia, "sem dado / Sem contagem: antes do início" na tabela e faixa listrada no gráfico. O estado "período inteiro anterior ao início da contagem" só foi exercitado em teste: os períodos da tela sempre terminam hoje |
| AC4 | Fuso e janela de datas coerentes | **verificado** (testes) | ADR 0011 define dia, hoje e "últimos N dias"; o painel e o CSV mostram o fuso. Vitest e pgTAP nos mesmos instantes: 23:59 e 00:01 em São Paulo caem em dias diferentes; 23:59 e 00:01 UTC caem no mesmo dia; a agregação separa os dois lados da meia-noite local. Totais do período = soma dos dias (Vitest e pgTAP). O serviço usa o dia de relatório, não a data UTC (teste à 01:30 UTC). **Não** houve verificação no navegador na virada do dia (não há como mover o relógio) |
| AC5 | Totais agregados dentro de 5% do conjunto válido | **verificado** | `apps/web/scripts/analytics-accuracy.mjs` pelo caminho real (HTTP → rota → RPC → job): 15 métricas, diferença **0,0%** em todas. Tabela em "Teste de precisão" |
| AC6 | Nenhum dado pessoal de visitante exibido sem base e propósito | **verificado** (técnico) / **pendente** (revisão jurídica) | `docs/DATA_MAP.md` lista cada campo com finalidade, base proposta e retenção. pgTAP 140: `anon` não lê eventos, agregados, marca d'água nem configurações; membro não lê as tabelas direto; outro workspace recebe `P0002`; nenhuma coluna de IP, user agent, referrer ou URL. Painel e CSV só têm totais (teste do CSV; leitura do painel). Vitest: caminho, query string, IP e user agent do referrer não chegam ao payload assinado; pgTAP: endereço no lugar da origem é recusado. A base legal (legítimo interesse do controlador) é **proposta**, a confirmar na revisão jurídica antes de usuários externos |

## Entregáveis

| ID | Entrega | Onde revisar |
|---|---|---|
| D1 | ADR 0011 | `docs/adr/0011-customer-analytics.md` |
| D2 | Migrações + pgTAP | `supabase/migrations/202610020001_sprint6_enum_values.sql`, `202610020002_customer_analytics.sql`; `supabase/tests/database/140-analytics.test.sql` (154 asserções), `010-structure.test.sql` atualizado; tipos regenerados |
| D3 | Módulos puros | `apps/web/src/modules/analytics/{contract,sources,device,dates,dashboard,csv,visitor-hash,attestation,ingest}.ts` |
| D4 | Coleta | `modules/analytics/collector.ts`, `components/public-page-analytics.tsx`; montado só em `app/[slug]/page.tsx`; `data-analytics="badge"` no selo |
| D5 | Ingestão e job | `app/api/events/route.ts`, `modules/analytics/ingest-server.ts`; `app/api/jobs/analytics/route.ts`, `modules/analytics/maintenance-server.ts`; `apps/web/vercel.json` |
| D6 | Painel e CSV | `app/app/w/[workspaceId]/paginas/[profileId]/resultados/{page,loading}.tsx`, `resultados/exportar/route.ts`; `modules/analytics/{service,supabase-repository,server,block-labels}.ts`, `components/charts.tsx`; textos em `content/pt-BR.ts` (`ANALYTICS_COPY`); link na tela da página |
| D7 | Testes | Vitest: `modules/analytics/{analytics,dashboard,collector}.test.ts`, `app/api/events/route.test.ts`, `app/api/jobs/analytics/route.test.ts`; pgTAP acima; teste de precisão `apps/web/scripts/analytics-accuracy.mjs` |
| D8 | Documentação | `docs/{ARCHITECTURE,THREAT_MODEL,DATA_MAP,SUPABASE_CAPACITY,OBSERVABILITY,ENVIRONMENTS}.md`, `docs/runbooks/ANALYTICS.md` (novo), `docs/ux/{UX_DECISIONS,CONTENT_GUIDE}.md`, página `/privacidade`, `.env.example`, `BACKLOG.md`, `README.md`, `AGENTS.md` §22, este relatório |

## Validação executada

### Teste de precisão (AC5)

`node scripts/analytics-accuracy.mjs --burst`, contra `next start` e o Supabase local. O script cria uma página de teste publicada com todos os tipos de bloco e envia, pelo caminho real:

- **válidos:** 120 visitantes (endereços diferentes), uma visita cada, com quatro origens e dois aparelhos; 94 ações em seis tipos de bloco; 7 envios de formulário;
- **não válidos:** 40 retries idênticos; 20 recargas dentro dos 30 minutos; 25 lotes de robôs e prévias de link (50 eventos); 15 lotes de tráfego interno (sessão do produto e visita vinda do editor); 15 requisições malformadas, forjadas ou de outra origem (JSON inválido, versão desconhecida, id malformado, tipo desconhecido, `form_submit` forjado, bloco inexistente, bloco oculto, tipo trocado, página inexistente, tipo de conteúdo errado, 5 de outra origem); 3 envios de formulário repetidos;
- **limitado:** um endereço envia 1 visita e 60 cliques; o limite por endereço guarda 60 eventos (1 visita + 59 cliques), que entram no esperado;
- **fora da janela:** 15 visitas com data de ontem (únicas linhas inseridas direto no banco, porque o horário de um evento é sempre o da chegada).

| Métrica (hoje) | Esperado válido | Agregado | Diferença |
|---|---:|---:|---:|
| Visitas | 121 | 121 | 0,0% |
| Cliques em link | 99 | 99 | 0,0% |
| Cliques no WhatsApp | 25 | 25 | 0,0% |
| Cópias da chave Pix | 10 | 10 | 0,0% |
| Cliques no link de pagamento | 5 | 5 | 0,0% |
| Cliques em redes sociais | 8 | 8 | 0,0% |
| Vídeos/músicas carregados | 6 | 6 | 0,0% |
| Envios de formulário | 7 | 7 | 0,0% |
| Origem Instagram | 60 | 60 | 0,0% |
| Origem direta | 31 | 31 | 0,0% |
| Origem Google | 20 | 20 | 0,0% |
| Origem WhatsApp (por UTM) | 10 | 10 | 0,0% |
| Aparelho celular | 91 | 91 | 0,0% |
| Aparelho computador | 30 | 30 | 0,0% |
| UTM `whatsapp / status / outubro` | 10 | 10 | 0,0% |

As 15 visitas de ontem foram agregadas em ontem e nenhuma em hoje. Rodar o job de novo deu linhas idênticas.

Uma primeira execução deu 120 visitas e 70 cliques em link (0,8% e 1,4%). Causa: a rota grava depois de responder, então as gravações de requisições consecutivas do mesmo endereço não chegam em ordem; no endereço que estourava o limite, a visita chegou depois dos cliques e foi a recusada. Não é erro de contagem (o total guardado era o mesmo), mas mostra que, **sob limite, a ordem do que é descartado não é garantida**. O script passou a esperar cada gravação nesse trecho.

### Desempenho da ingestão (local)

| Medição | Resultado |
|---|---|
| 336 requisições, 8 em paralelo | p50 15–17 ms; p95 26–36 ms; máximo 46–78 ms; todas 204 |
| Rajada: 300 lotes de 10 eventos de 300 endereços, 50 em paralelo (≈ 450 req/s) | p50 100–109 ms; p95 110–125 ms; máximo 128–203 ms; todas 204 |
| Banco na rajada | terminou de gravar 2,5–4 s depois da última resposta; guardou **exatamente 2.000** dos 3.000 eventos (limite por página por hora) |
| Página pública durante e depois | HTTP 200 |

### Página pública: JavaScript e Lighthouse

Mesmo método antes e depois (build de produção, `next start`, página `studio-sprint-cinco` da Sprint 5 com foto, 3 imagens, vídeo, Pix, formulário e os demais blocos; soma dos `<script src>` com gzip):

| | Sem o coletor | Com o coletor |
|---|---:|---:|
| JavaScript transferido | 188.024 bytes | 189.200 bytes (**+1.176**) |

O orçamento da ADR era 3 KB. (A Sprint 5 registrou 148,5 KB com outro método de medição; os dois números acima usam o mesmo.)

Lighthouse 13.5.0, celular, limitação simulada, script do antivírus bloqueado, 9 execuções de cada:

| | LCP (9 execuções, ordenado) | Mediana | CLS |
|---|---|---:|---:|
| Sem o coletor | 2,51 · 2,51 · 2,51 · 2,73 · 2,88 · 3,28 · 3,32 · 3,33 · 3,34 s | 2,88 s | 0 |
| Com o coletor | 2,51 · 2,51 · 2,51 · 2,51 · 2,87 · 3,27 · 3,28 · 3,32 · 3,33 s | 2,87 s | 0 |

Leitura honesta:

- As duas distribuições são iguais e bimodais (FCP de 1,39 s ou 1,67 s de uma execução para outra): **não há efeito mensurável do coletor**, e a variação é da máquina.
- Sob o Lighthouse o coletor **não envia nada** (`navigator.webdriver`), então essa medição cobre o custo do código, não o da requisição. Num navegador real o beacon sai depois da hidratação.
- Os valores absolutos continuam acima de 2,5 s nesta máquina, como no relatório da Sprint 5; a medição de campo em staging segue pendente e não mudou com esta sprint.

### Navegador (Chrome, build de produção, `127.0.0.1` atrás de um proxy local que acrescenta o endereço do cliente)

- Página com todos os tipos de bloco: abrir e usar cada um → `page_view`, `link_click`, `social_click`, `whatsapp_click`, `pix_copy`, `pix_pay_click`, `embed_load`, `badge_click` e, pelo formulário, `form_submit`, cada um com o bloco certo; origem Instagram (por `utm_source`), aparelho computador, UTM normalizado (`Sprint 6` → `sprint-6`); país "não identificado" (sem cabeçalho no ambiente local).
- Duas recargas: `repeat`, continua 1 visita.
- Sem cookie e sem `localStorage`/`sessionStorage` na página pública.
- Os três modos de falha do AC1 (acima).
- Dono com sessão abrindo a própria página: lote descartado (`signed_in`). Prévia do rascunho: 5 cliques, **zero** requisições a `/api/`.
- Painel com os dados acima; os cinco estados sem números e o aviso de atraso (AC3); exportação CSV (8 linhas, fuso em cada linha, dias anteriores com células vazias) e evento de auditoria `analytics.exported`.
- Outra conta: painel → "Página não encontrada"; CSV → 404.
- Painel em 360, 430, 768 e 1280 px: sem rolagem horizontal e sem alvo de toque menor que 44 px.
- Job: sem segredo → 401; com segredo → `ok`.
- Requisição forjada (curl) para a página de outro workspace dentro do limite é contada como evento anônimo comum; acima do limite, descartada; para página não publicada, bloco fora do snapshot e tipo trocado, rejeitada (teste de precisão e pgTAP).

**Não feito no navegador:** a virada do dia no fuso de relatório (coberta por testes); abrir o CSV numa planilha (só o conteúdo foi conferido); celular real, Safari e navegadores embutidos; leitor de tela.

### Problemas encontrados e corrigidos durante a sprint

- **Limite contornável trocando o user agent** e **flood espalhado por várias páginas**: ver "Mudança de desenho". Testes de regressão no pgTAP 140 e no Vitest.
- **Lote sem endereço respondia `unavailable` em vez de `invalid`** (comparação com `null` no SQL): corrigido, com caso no pgTAP.
- **Barras do caminho até o resultado** ficavam todas cheias quando havia mais cliques que visitas: passaram a ser proporcionais ao maior dos três valores.
- **E-mails do teste de precisão colidiam com os de um teste pgTAP** no banco local: o script passou a usar endereços próprios.

### Resultado final registrado

```text
npm audit: found 0 vulnerabilities
lint: aprovado (eslint --max-warnings=0)
typecheck: aprovado
test: 26 arquivos, 690 testes aprovados (288 novos)
test:db: 16 arquivos, 639 asserções aprovadas (160 novas)
supabase db advisors --local: No issues found
build: aprovado, 41 rotas + Proxy (4 novas)
npm run check: aprovado (exit 0)
```

Tamanho medido: 329 bytes por evento bruto e 241 bytes por linha de agregado, com índices (`docs/SUPABASE_CAPACITY.md`).

As migrações foram aplicadas no banco local com `supabase migration up`. **Não rodei `db reset`.** Como a segunda migração mudou durante a sprint, eu a desfiz no banco local (removendo só os objetos de analytics, que tinham apenas dados de teste) e a reapliquei a partir do arquivo; a aplicação a partir do zero fica a cargo do job `database` do CI, que ainda não rodou com esta branch (não houve push).

## Segurança, privacidade, acessibilidade, performance e operação

- **Segurança:** nova seção da Sprint 6 em `docs/THREAT_MODEL.md`. Casos negativos testados: assinatura errada, ausente e reutilizada em outra página; segredo ausente; evento e lote repetidos; tipo desconhecido, `form_submit` forjado, id malformado, bloco inexistente, oculto, só no rascunho, de outra página e de tipo trocado; payload grande demais, JSON inválido, versão desconhecida; página não publicada, suspensa, excluída, inexistente e reservada; limite por endereço (inclusive trocando o user agent), entre páginas, diário, por página e o teto de capacidade; teto de combinações de UTM; origem, país e UTM hostis; `anon`, membro lendo direto, outro workspace e papel editor; job sem segredo, com segredo errado e chamado por membro; robôs, prévias de link, sessão do produto e visita vinda do app; fórmula no CSV. Nenhuma validação, policy ou regra de lint foi afrouxada para passar teste.
- **Privacidade:** `docs/DATA_MAP.md` (campo a campo, papéis de controlador e operador, o que nunca é guardado, como exportação e exclusão alcançam os dados). A página `/privacidade` descreve a contagem de visitas. Nenhum subprocessador novo. Nenhum cookie ou identificador no navegador do visitante. A base legal é proposta e precisa de revisão jurídica.
- **Acessibilidade:** todos os números do painel estão em texto ou em tabela (`caption`, `scope`); o gráfico tem `role="img"` com descrição e a tabela dos dias logo abaixo; nenhum estado depende só de cor (textos, "Aviso:", faixa listrada com legenda); alvos de 44 px; a linha de contexto do período é uma região `aria-live`; navegação de período com `aria-current`. **Leitor de tela real não foi usado.**
- **Performance:** ver "Página pública". A página continua HTML estático; a rota de ingestão não bloqueia a resposta.
- **Operação:** sinais `analytics.ingest`, `analytics.maintenance` e `analytics.export` com limiares e owner em `docs/OBSERVABILITY.md`; runbook `docs/runbooks/ANALYTICS.md` (números pararam, números inflados, tabela crescendo, re-agregar um dia, rotação de segredos, pedido de titular, rollback).

## Pendências, gaps e riscos

- **Staging:** nada aplicado. O país das visitas (cabeçalho da Vercel) e o cron só foram exercitados por teste de unidade e chamada manual local.
- **Sem limite global nem firewall na frente de `/api/events`** (Sprint 9). Um remetente distribuído consegue inflar uma página até 48 mil eventos por dia e, com muitos endereços, levar a tabela bruta ao teto; nesse ponto **eventos reais também são descartados** até a limpeza.
- **Limite por endereço pode ser baixo para páginas populares atrás de CGNAT** (várias pessoas com o mesmo endereço de operadora na mesma página em 10 minutos dividem 60 eventos). É o primeiro valor a rever com tráfego real.
- **Sob limite, não há garantia de qual evento é descartado** (a visita pode ser a recusada, e os cliques não).
- **Perda de eventos em navegadores embutidos** (Instagram, TikTok, WhatsApp) não foi medida; é subcontagem documentada.
- **O dono sem sessão** (outro navegador, navegador embutido) é contado. **Robô com user agent de navegador** é contado até bater nos limites.
- **Sem fila:** se o banco não responde em 2 s, o lote se perde (registrado como `unavailable`).
- **Selo (`badge_click`)** é guardado e agregado, mas não há tela: a leitura para a UX-025 é por SQL.
- **Região (UF)** cortada.
- **CSV não foi aberto numa planilha**; **celular real, Safari e leitor de tela** não foram usados.
- **Base legal e aviso de privacidade** são provisórios.
- **Banco local com dados de QA:** conta `qa-analytics-accuracy@example.test` e página `precisao-analytics` (criadas pelo script); página `qa-sprint6-rascunho` (publicada, com data de criação alterada para simular atraso) na conta `qa-sprint5-outro@example.test`; as senhas das duas contas `qa-sprint5*` foram redefinidas para os testes; um contato de teste na página `studio-sprint-cinco`; `analytics_settings.collection_started_at` foi ajustado para hoje às 12:00 UTC. `apps/web/.env.local` ganhou `ANALYTICS_SIGNING_SECRET` e o Vault local ganhou `analytics_signing_secret`.
- **Fora do repositório:** iniciei o Docker Desktop (estava parado) para subir o stack local; os contêineres de outros projetos não foram tocados.
- **`docs/prompts/SPRINT_6_CLAUDE_PROMPT.md`** estava sem versionamento no início e continua assim (não é um arquivo desta entrega).
- **Correção de documento herdada:** o `AGENTS.md` §22 dizia que a página não declarava `preconnect` para a origem da mídia; ela declara desde a Sprint 5 (`preconnect(origin)` no renderer). O texto foi corrigido; `preload` continua não existindo.
- **Herdadas:** sessões de usabilidade, Auth hospedado, SMTP, CAPTCHA, Sentry e monitor, LCP/CLS de visitantes reais.

## Perguntas para o founder

1. **Staging:** posso aplicar as duas migrações (`supabase db push`), criar o segredo no Vault e a variável na Vercel, e só então abrir o PR? (A ordem inversa também é segura: sem eles, nada é contado e nada quebra.)
2. **O que é resultado (UX-043):** WhatsApp, Pix e formulário, com cliques em link à parte? Ou um link (agenda, loja) deveria poder contar como resultado?
3. **Regra de visita (UX-044):** 30 minutos, e não mostrar "visitantes únicos"?
4. **"A cada 100 visitas" (UX-047)** em vez de "taxa de conversão": comunica bem?
5. **Tráfego interno (UX-049):** descartar quem está com a conta aberta no mesmo navegador, sabendo que o dono vai precisar de uma guia anônima para "ver contar"?
6. **Retenção (UX-050):** 7 dias de registros detalhados e 100 dias de totais (Free vê 7; Pro e Agência, 90)?
7. **Limites:** 60 eventos por endereço por página em 10 minutos e 2.000 por página por hora parecem adequados para o piloto?
8. **CSV:** todos os papéis podem exportar (são só totais)?
9. **Região (UF):** volta na Sprint 7 ou depois?

## Passos de deploy em staging (para o founder, nesta ordem)

Detalhes e comandos em `docs/ENVIRONMENTS.md`, "Passos de deploy da Sprint 6".

1. `npx supabase db push` (duas migrações).
2. Criar o segredo `analytics_signing_secret` no Vault (gerado dentro do banco).
3. Criar `ANALYTICS_SIGNING_SECRET` na Vercel (Production e Preview) com o mesmo valor.
4. Mergear o PR (publica em staging e registra o cron das 04:00 UTC).
5. Conferir: visita e clique numa guia anônima do celular aparecem em *Resultados*; o país aparece; `POST /api/jobs/analytics` responde `ok`; no dia seguinte, log `analytics.maintenance` com `outcome=ok`.

## Implicações para a Sprint 7

- **Painel consolidado:** somar `analytics_daily` por `workspace_id` e dia (o índice `(workspace_id, day)` já existe). Precisa de uma função de leitura por workspace, nos moldes de `get_profile_analytics`, que continue aplicando o entitlement de histórico; os dias ainda abertos podem ser lidos do bruto do mesmo jeito.
- **Link de relatório somente leitura:** a mesma leitura por página, autorizada por um token (hash, expiração, revogação) em vez da sessão. O relatório não deve expor ids de bloco de páginas de terceiros nem dados de outras páginas; a função atual já devolve só agregados da página pedida.
- **Duplicação de página:** os ids de bloco mudam na cópia, então a cópia começa sem histórico (coerente com a UX-008).
- **Arquivamento:** página arquivada continua com os agregados; decidir se o painel dela fica acessível.
- **Convites e papéis:** `analytics.view` e `analytics.export` já estão na matriz para os três papéis.
- **Ponto de partida recomendado:** aplicar a Sprint 6 em staging e deixar alguns dias de dados reais acumularem antes de desenhar o consolidado; depois, lista e busca de páginas, convites e papéis, e só então o consolidado e o link de relatório sobre os agregados que já existem.
