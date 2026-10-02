# Relatório da Sprint 5

**Status:** implementada e verificada no ambiente local (Supabase local com Storage, `next dev` e `next start` de produção). **Nada foi aplicado em staging**: as migrações, o segredo do Vault e as variáveis da Vercel desta sprint estão pendentes (passos em `docs/ENVIRONMENTS.md`). O critério AC1 está **parcial** na parte de desempenho: no método de laboratório usado na Sprint 4, a página com imagens ficou acima de 2,5 s de LCP.
**Objetivo:** permitir que a pessoa personalize a página com foto, imagens, vídeo/música, Pix, formulário, tema e modelos, sem perder desempenho, segurança nem conteúdo
**Data:** 01/10/2026
**Branch:** `feat/sprint-5-media-personalization`, criada a partir de `main` (`2c53578`). Sem push e sem PR: aguardam aprovação.

## Resultado

No editor (`/app/w/<conta>/paginas/<página>`), a pessoa agora pode:

- enviar a **foto da página** e **imagens** em blocos, com recorte (mouse, toque e teclado), texto alternativo e progresso em texto;
- adicionar os blocos **Vídeo ou música** (YouTube, Vimeo, Spotify), **Pix** (chave + copiar + link de pagamento opcional) e **Formulário** (nome, e-mail, telefone, mensagem, consentimento configurável);
- mudar a **aparência** (cor de fundo, cor e estilo dos botões, cantos, espaçamento, fonte) com as cores de texto derivadas automaticamente para manter contraste;
- aplicar um de **cinco modelos** sem alterar o conteúdo, com desfazer;
- ver o **uso de armazenamento** da conta e os **contatos recebidos** pelos formulários (lista, exportação CSV e exclusão).

Tudo é salvo pelo mesmo autosave do rascunho e publicado no mesmo snapshot. A página pública serve imagens WebP em três larguras direto do bucket, só carrega o player de terceiros depois do toque, e o formulário funciona sem JavaScript. Páginas publicadas antes desta sprint continuam renderizando igual.

## Estado dos gates (§0 do prompt)

- **Gate de usabilidade:** o *override* do founder de 25/09/2026 continua valendo; as cinco sessões seguem pendentes.
- **UX confirmadas:** UX-020, 021, 023 e 025. As demais, inclusive as novas **UX-033 a UX-042**, são provisórias e foram usadas como padrão.
- **Staging:** existe (Supabase Free + Vercel), mas não foi tocado nesta sprint. O Auth hospedado continua com as configurações padrão.

## Decisões tomadas

Técnicas (ADR 0009 e ADR 0010, em inglês; ADR 0007 e 0008 receberam referência cruzada):

- **Entrega de imagem sem serviço de transformação:**
  - O plano Free do Supabase não transforma imagens, então as variantes são geradas pela aplicação no upload.
  - Imagem de bloco: 448, 896 e 1344 px de largura (1x, 2x e 3x da coluna de 448 px). Avatar: 96, 192 e 288 px. Tudo WebP, qualidade 80.
  - O original não é guardado. A largura 448 substituiu a 416 inicial quando a medição no desktop mostrou a coluna com 448 px.
- **Pipeline de upload:**
  - O navegador recorta e reduz (canvas, até 2.048 px) só para economizar banda; **o servidor não confia nisso**.
  - `POST /api/media` decide o formato pelos bytes, lê as dimensões do cabeçalho antes de decodificar, decodifica com `sharp`, re-codifica e grava só o que ele mesmo produziu.
  - `sharp` é a única dependência nova (já vinha transitivamente com o Next; agora é declarada).
- **Storage sob a sessão do usuário, com atestação:**
  - O servidor assina (HMAC) o registro do asset. O banco confere a assinatura com o segredo no Vault.
  - A única policy de `insert` em `storage.objects` aceita só as variantes de um asset pendente do próprio usuário. Não há policy de update, delete ou select.
  - Upload direto ao Storage com sessão válida é recusado. Nenhuma chave secreta no caminho do usuário.
- **`StorageAdapter`:** interface estreita (`put`, `remove`, `exists`) com implementação Supabase e uma em memória para testes. A URL pública vem de `NEXT_PUBLIC_MEDIA_BASE_URL` (ou do Supabase), o que deixa a troca para R2 como configuração + cópia.
- **Ciclo de vida por referência calculada:** uma imagem vive enquanto o rascunho ou uma das versões publicadas retidas a usa. Nada é apagado ao trocar a imagem. Um job (`POST /api/jobs/media-cleanup`, com `CRON_SECRET` e a chave secreta, fora do caminho do usuário) remove órfãos depois de 24 h, de forma idempotente.
- **Cota como entitlement:** `storage_mb` (Free 20, Pro 100, Agência 500), sem comparar nome de plano; 60 uploads por workspace por hora.
- **Documento publicado continua na versão 2:** só acréscimos (tema opcional, quatro tipos de bloco, avatar como id de mídia). Snapshots antigos não mudam; o renderer da Sprint 4 ignora o que não conhece.
- **Embed = provedor + id:** nunca HTML. O `src` do iframe é montado de constantes; `sandbox`, `allow` e `referrerpolicy` são fixos; YouTube usa o domínio sem cookies e Vimeo `dnt=1`; o iframe só existe depois do clique.
- **Tema = tokens fechados:** duas cores `#rrggbb` e quatro enumerações. Nenhuma string do usuário vira CSS. Fontes Poppins e Lora são arquivos do próprio repositório (licença OFL incluída), carregados só pela página que as usa.
- **Leads:** RPC anônima `submit_form_lead`, validada contra o snapshot no ar; limite por visitante (HMAC diário do IP, nunca o IP) e por página; consentimento guardado com texto, versão e horário; retenção de 90 dias.

Produto/UX, todas provisórias (`docs/ux/UX_DECISIONS.md`):

- **UX-033:** fluxo de envio com recorte e texto alternativo pedido em toda imagem.
- **UX-034:** formatos e limites de imagem; cotas por plano.
- **UX-035:** trocar imagem não apaga nada na hora.
- **UX-036:** a pessoa escolhe duas cores; a cor do texto é derivada.
- **UX-037:** cinco modelos; aplicar muda só a aparência; exemplos só em página vazia e por escolha.
- **UX-038:** vídeo/música por link colado, com carregamento no toque e aviso de privacidade.
- **UX-039:** Pix como chave + copiar, sem QR.
- **UX-040:** formulário de campos fixos com consentimento configurável.
- **UX-041:** contatos por página, 90 dias, sem aviso por e-mail.
- **UX-042:** aparência abaixo da lista de blocos.

### Cortes de escopo (todos da lista de cortes do prompt)

- **Pix "copia e cola" (BR Code) e QR code:** precisariam de nome e cidade do recebedor e de um codificador de QR. Ficou a chave com botão de copiar.
- **Imagem de fundo no tema.**
- **Aviso por e-mail de novo contato:** depende do SMTP ainda não escolhido.

## Critérios de aceite

| # | Critério | Estado | Evidência |
|---|---|---|---|
| AC1 | Imagens entregues em tamanho e formato adequados ao dispositivo | **verificado** (variantes, marcação e bytes) / **parcial** (LCP de laboratório) | Variantes documentadas na ADR 0009. `<img>` com `width`/`height`, `srcset` (448w, 896w, 1344w), `sizes`, WebP e `loading="lazy"` nos blocos (o avatar e uma imagem que seja o primeiro bloco carregam sem lazy; esta com `fetchpriority="high"`). Navegador, build de produção: **360 px @1x → 448.webp** (94 KB no total da página: avatar + 3 imagens); **360 px @3x → 1344.webp** (469 KB); **390 px @2x → 896.webp** (265 KB); **1280 px @1x → 448.webp** (94 KB); **1280 px @2x → 896.webp** (265 KB). Lighthouse na página com avatar + 3 imagens + 1 embed: CLS 0 em todas as execuções; LCP de 1,68 a 2,00 s com limitação aplicada, mas **2,95 a 3,62 s no método simulado** (o da Sprint 4), contra 2,27 s da página da Sprint 4 no mesmo dia. Detalhes em "Desempenho". Medição de campo em staging pendente |
| AC2 | Arquivos inválidos ou grandes demais não são guardados | **verificado** | Um módulo de política (`modules/media/policy.ts`) com tabela no Vitest: extensão de imagem com bytes errados, SVG, HTML disfarçado, WebP animado e APNG, bomba de pixels (cabeçalho de 30.000 × 30.000), arquivo vazio, acima do limite, proporção extrema, pequeno demais; cota e limite por hora no serviço e no pgTAP 120 (`LK010`, `LK061`). No navegador, cada arquivo foi recusado **pela UI** (mensagem específica, zero requisições) e **por requisição forjada** a `/api/media` (422/413); depois de cada recusa, contagem de `media_assets` e de objetos do bucket inalterada. Upload direto ao Storage com o token do usuário → 403 (RLS); `register_media_asset` com assinatura forjada → `LK060` |
| AC3 | Trocar de modelo não apaga blocos nem configurações essenciais | **verificado** | `applyTemplate` é função pura; Vitest prova, para os cinco modelos, que blocos, ordem, visibilidade, título, bio, avatar e endereço ficam idênticos, e que os exemplos só entram em página sem blocos. Desfazer testado no reducer. No navegador: página com blocos mistos → cada um dos cinco modelos aplicado → publicado → conteúdo da página pública idêntico; "Desfazer" devolve a aparência anterior |
| AC4 | Embeds arbitrários e scripts do usuário não executam | **verificado** | `modules/blocks/embed.ts` com a tabela `embed-cases.ts` (21 casos: `<iframe>` e `<script>` colados, host desconhecido, host parecido, `javascript:`/`data:`, URL válida com parâmetros extras ou redirecionamento, id com caracteres inválidos), rodada no Vitest e no pgTAP 110 pela função e pelo trigger; HTML em todos os campos de texto é renderizado como texto. O renderer monta o `src` de provedor + id. No navegador: entradas maliciosas recusadas na UI; Server Action forjada → `validation`, revisão inalterada; nenhum script de entrada do usuário executou; zero pedidos ao provedor antes do clique; iframe com `sandbox`, `allow` e `referrerpolicy="strict-origin-when-cross-origin"` conforme a ADR 0010 |
| AC5 | Formulário com prevenção básica de spam e consentimento configurável | **verificado** | Honeypot e limites no banco (funcionam sem JavaScript): Vitest `leads.test.ts` e pgTAP 130 (68 asserções). O dono define o texto e se o consentimento é obrigatório; envio sem consentimento obrigatório é recusado **pelo banco**; o lead guarda texto, versão e horário do consentimento; `anon` envia e nunca lê; outro workspace não lê, não apaga e não exporta. No navegador: envio com JavaScript, **sem JavaScript**, sem consentimento, com honeypot (resposta de sucesso, nada gravado) e sexta tentativa recusada pelo limite |

## Entregáveis

| ID | Entrega | Onde revisar |
|---|---|---|
| D1 | ADR 0009 e ADR 0010 | `docs/adr/0009-media-and-storage-adapter.md`, `docs/adr/0010-themes-templates-and-new-blocks.md` |
| D2 | Migrações + pgTAP | `supabase/migrations/202610010001_sprint5_enum_values.sql`, `202610010002_media_themes_forms.sql`; `supabase/tests/database/{110-new-blocks,120-media,130-leads}.test.sql` (72 + 62 + 68 asserções), `010` e `060` atualizados; `supabase/config.toml` (Storage ligado); tipos regenerados |
| D3 | Módulos de política | `apps/web/src/modules/media/{policy,process,attestation,url,references}.ts`; `modules/blocks/{embed,embed-cases,pix,form}.ts`; `modules/themes/{contrast,tokens,resolve,templates,apply-template,fonts}.ts`; `modules/leads/{submission,visitor-hash}.ts` |
| D3b | Adapter, serviço e limpeza | `modules/media/storage/{adapter,memory-adapter,supabase-adapter}.ts`, `modules/media/{service,cleanup,supabase-repository}.ts`; rotas `app/api/media/route.ts` e `app/api/jobs/media-cleanup/route.ts` |
| D4 | UI do editor | `modules/editor/components/{crop-dialog,image-uploader,appearance-panel,storage-usage,block-fields,block-editor}.tsx`; contatos em `app/app/w/[workspaceId]/paginas/[profileId]/contatos/` |
| D5 | Renderer | `modules/publishing/document.ts`, `render/{public-page-view,embed-facade,pix-copy-button,lead-form}.tsx`; textos do visitante em `content/public-page.ts` |
| D6 | Testes | Vitest: `media.test.ts`, `cleanup.test.ts`, `themes.test.ts`, `new-blocks.test.ts`, `leads.test.ts`, `publishing/sprint5.test.ts`; pgTAP acima |
| D7 | Documentação | `docs/{ARCHITECTURE,THREAT_MODEL,DATA_MAP,SUPABASE_CAPACITY,OBSERVABILITY,ENVIRONMENTS}.md`, `docs/runbooks/{MEDIA,LEADS}.md` (novos), `docs/ux/{UX_DECISIONS,CONTENT_GUIDE,DESIGN_TOKENS}.md`, `BACKLOG.md`, `README.md`, `AGENTS.md` §22, este relatório; `.github/workflows/ci.yml` (o job `database` passa a subir o Storage) |

## Validação executada

### Navegador (localhost, contas de teste locais)

Feita com Chrome headless via CDP (scripts no scratchpad, sem dependência nova), nas larguras 360, 390, 768 e 1280 px, com duas contas de teste em workspaces diferentes:

- enviar foto e imagem com recorte **só pelo teclado**, publicar e conferir a variante servida por viewport;
- cada arquivo do AC2 pela UI e por requisição forjada, com conferência do bucket e das tabelas depois;
- trocar uma imagem, publicar, **restaurar a versão anterior**: a imagem antiga continua sendo servida (200); a limpeza removeu só o asset sem referência e rodar de novo não removeu mais nada;
- entradas maliciosas de embed na UI e como Server Action forjada;
- os cinco modelos numa página com conteúdo; desfazer;
- formulário com e sem JavaScript, sem consentimento, com honeypot e acima do limite;
- contatos: lista, exportação CSV, exclusão e eventos de auditoria; a outra conta recebe 404 na lista e na exportação;
- cópia da chave Pix; fachada do embed virando iframe só depois do clique;
- sem rolagem horizontal em nenhuma das quatro larguras, no editor e na página pública;
- páginas publicadas antes da Sprint 5 (`carla-nutricao`, `studio-sprint-quatro`) renderizando como antes.

### Problemas encontrados e corrigidos durante a verificação

- **Variante errada no desktop:** a coluna tem 448 px, e a largura 416 forçava a variante seguinte. Larguras trocadas para 448/896/1344 no TypeScript, no SQL, nos testes e na ADR.
- **Estilo dos botões e do cartão de embed:** regras globais sem camada (`a { color: inherit }`, `button { font: inherit }`) venciam as classes utilitárias. Corrigido com as classes `.page-button` e `.page-surface`.
- **Foco depois do recorte** não voltava ao botão de envio; **consentimento** era desmarcado quando um campo dava erro; o resultado do envio sem JavaScript não recebia foco. Os três corrigidos.
- **Todo o texto do produto ia para o navegador do visitante** (+20 KB de JavaScript): os textos da página pública foram separados em `content/public-page.ts`.
- **Aparência no topo do editor** empurrava os blocos para fora da tela no celular: movida para baixo da lista (UX-042).

### Desempenho (Lighthouse 12, `next start`, mobile emulado)

Página de teste: avatar + 3 imagens (16:9, 4:3 e 1:1, peso de foto) + 1 embed + Pix + formulário + link, texto, WhatsApp, separador e redes. O domínio do Kaspersky local foi bloqueado, como nas sprints anteriores. CLS foi **0 em todas as execuções**; Acessibilidade 100 e SEO 100.

| Página | LCP, limitação simulada (método da Sprint 4), 3 execuções | LCP, limitação aplicada, 5 execuções (mediana) |
|---|---|---|
| Sprint 4 (`/carla-nutricao`, 12 blocos, sem mídia) | 2,27 / 2,21 / 2,27 s | 1,56 s |
| Sprint 5, aparência clássica, imagens abaixo da dobra | 2,57 / 3,03 / 2,95 s | 1,68 s |
| Sprint 5, fonte Lora, imagens abaixo da dobra | 2,88 / 3,28 / 3,26 s | 1,73 s |
| Sprint 5, fonte Lora, imagem como primeiro bloco | 3,62 / 3,02 / 3,70 s | 2,00 s |

Leitura honesta:

- No método da Sprint 4 (2,42 s naquela sprint; 2,27 s hoje), a página com mídia **passa de 2,5 s**. Com a limitação aplicada de verdade pelo navegador, fica abaixo de 2,0 s, com custo de 0,1 a 0,45 s sobre a página sem mídia.
- Os dois números são de laboratório em `localhost`. A meta do projeto é LCP p75 de campo ≤ 2,5 s, e **não há medição de campo**: fica pendente em staging.
- Uma imagem como primeiro bloco é o pior caso (ela vira o LCP), mesmo já sendo carregada com prioridade alta e sem lazy loading. Se o campo confirmar o problema, as opções são `preload` da imagem no `<head>` e uma variante menor para a primeira dobra.

**Bytes:**

- Por variante (imagens com peso de foto): 16:9 → 22 / 60 / 106 KB; 4:3 → 28 / 79 / 137 KB; 1:1 → 39 / 108 / 193 KB (448 / 896 / 1344 px). Avatar: 6 / 18 / 33 KB (96 / 192 / 288 px). Pior caso (ruído puro): até 871 KB por imagem somando as três variantes.
- Por visita à página de teste: 94 KB de imagens em tela 1x, 265 KB em 2x, 469 KB em 3x. Fonte Lora: 37 KB (as fontes padrão e clássica não baixam nada).

**JavaScript no cliente:**

- Página pública: **148,5 KB** transferidos (Sprint 4: 147,7 KB).
- Editor: **187,7 KB** (Sprint 4: 165,6 KB), +22 KB por recorte, envio, aparência, modelos e os quatro tipos de bloco.

### Resultado final registrado

```text
npm audit: found 0 vulnerabilities
lint: aprovado (eslint --max-warnings=0)
typecheck: aprovado
test: 19 arquivos, 402 testes aprovados
test:db: 15 arquivos, 479 asserções aprovadas (207 novas)
supabase db advisors --local: No issues found
build: aprovado, 37 rotas + Proxy
npm run check: aprovado (exit 0)
```

As migrações foram aplicadas no banco local com `supabase migration up`. **Não rodei `db reset`**, para não apagar as contas locais do founder; a aplicação a partir do zero fica a cargo do job `database` do CI. Esse job foi alterado para subir o Storage e **ainda não rodou** com a mudança (não houve push).

## Segurança, privacidade, acessibilidade, performance e operação

- **Segurança:**
  - Nova seção da Sprint 5 em `docs/THREAT_MODEL.md`, com estado e evidência por ameaça.
  - Casos negativos testados: arquivos maliciosos (tabela do AC2) pela UI e forjados; upload direto ao Storage; registro com assinatura forjada; upload sem sessão (401), de outra conta (404) e com `Origin` de outro site (403); bloco de imagem apontando para asset de outro workspace, de outra página, pendente, de outro tipo, para URL ou para dados inline; 21 entradas de embed no TypeScript e no banco; CSS, URL de fonte e chaves extras no tema; chaves Pix inválidas por tipo e link de pagamento não https; envio a formulário não publicado, oculto ou de página fora do ar; envio sem consentimento; honeypot; limites; `anon` e outro workspace lendo, apagando e exportando leads; papel editor tentando apagar ou exportar; injeção de fórmula no CSV; job de limpeza sem segredo ou com segredo errado.
  - Nenhuma validação, policy ou regra de lint foi afrouxada para passar teste.
- **Privacidade:**
  - `docs/DATA_MAP.md`: imagens (EXIF e GPS removidos; original não guardado), chave Pix, leads (o dono da página é o controlador; o produto, operador), hash do visitante e auditoria.
  - Nenhum subprocessador novo. YouTube, Vimeo e Spotify só recebem dados do visitante depois do clique; isso precisa entrar na política de privacidade.
  - Logs sem nome de arquivo, conteúdo, chave Pix ou dados de lead.
- **Acessibilidade:**
  - Recorte operável por teclado, com valores anunciados; texto alternativo pedido em toda imagem, com opção explícita de imagem decorativa.
  - Progresso e erros em texto, com `aria-live` e `aria-describedby`; foco gerenciado no recorte, no envio e no resultado do formulário.
  - Contraste de texto e de botão garantido por cálculo para qualquer par de cores.
  - Lighthouse: Acessibilidade 100 na página pública. **Leitor de tela real não foi usado.**
- **Performance:** ver "Desempenho". A página pública continua HTML estático do snapshot; as imagens vêm direto do bucket, sem passar pela aplicação.
- **Operação:**
  - Sinais `media.upload`, `media.cleanup`, `lead.submit`, `lead.delete` e `lead.export` com limiares propostos em `docs/OBSERVABILITY.md`.
  - Runbooks novos: `docs/runbooks/MEDIA.md` (imagem imprópria, envio falhando, cota, segredo de assinatura, limpeza, rollback) e `docs/runbooks/LEADS.md` (contatos não chegam, spam, pedido de titular, acesso indevido).
  - Capacidade medida em `docs/SUPABASE_CAPACITY.md`.

## Pendências, gaps e riscos

- **Nada desta sprint está em staging.** O código lê `profiles.theme`: a migração precisa ser aplicada **antes** do merge em `main`, que publica automaticamente. Passos em `docs/ENVIRONMENTS.md`.
- **LCP de laboratório acima de 2,5 s** no método simulado para páginas com imagens. Sem medição de campo.
- **Limpeza de órfãos sem agendador.** Mecanismo decidido depois da sprint (02/10/2026): Vercel Cron diário. Falta implementar o `GET` autenticado na rota e o `vercel.json`. Até lá, órfãos se acumulam no projeto (não na cota do cliente depois de 24 h).
- **Sem moderação de imagens** nem denúncia (Sprint 9). O bucket é público: tirar a página do ar não tira o arquivo; a remoção é manual (runbook).
- **Pix sem verificação de titularidade:** a mitigação é o aviso ao visitante e a futura moderação.
- **Formulário sem CAPTCHA** e sem limite global por IP. O limite por página (60 por hora) também recusa visitantes legítimos durante um ataque.
- **Purge de leads e de hashes não agendado:** leads vencidos somem da leitura na hora, mas só são apagados no envio seguinte à página.
- **Imagem Open Graph** ainda não usa o tema nem a foto da página.
- **Safari antigo:** quando o canvas não gera WebP, o navegador envia JPEG e a transparência é achatada antes de o servidor re-codificar.
- **Rollback da aplicação para a Sprint 4:** a página pública continua funcionando, mas o editor antigo descarta os blocos novos ao salvar.
- **Leitor de tela real** (NVDA/VoiceOver) não foi usado.
- **Banco local com dados de QA:** duas contas `qa-sprint5*@example.test` e a página `studio-sprint-cinco` ficaram no banco local, com algumas imagens de teste.
- **Herdadas:** sessões de usabilidade, Auth hospedado, SMTP, CAPTCHA do Auth, rate limit global, Sentry e monitor.

## Perguntas para o founder

1. **Staging:** posso aplicar as duas migrações em staging (`supabase db push`), criar o segredo no Vault e as três variáveis na Vercel, e só então abrir o PR?
2. **Cotas e limites (UX-034):** 20 / 100 / 500 MB por plano e imagens de até 15 MB, sem GIF e HEIC?
3. **Pix sem QR (UX-039):** aceitável para o MVP, ou o "copia e cola" com QR volta como prioridade?
4. **Leads (UX-041):** 90 dias de retenção, exclusão e exportação só para owner e admin, sem aviso por e-mail por enquanto?
5. **Cor do texto derivada (UX-036):** confirma que a pessoa não escolhe a cor do texto?
6. **Agendador da limpeza:** ~~GitHub Actions agendado ou `pg_cron` no Supabase?~~ **Decidido em 02/10/2026: Vercel Cron, diário** (ADR 0009). Implementação pendente.
7. **Embeds (UX-038):** os três provedores bastam para o piloto?

## Implicações para a Sprint 6

- Os eventos de valor novos já têm ponto de coleta no HTML: `data-block-id` e `data-block-type` em imagem, embed (carregar), Pix (copiar, abrir link) e formulário (envio). A taxonomia da Sprint 6 deve incluí-los.
- O formulário já grava o lead no banco; "envio de formulário" como ação de valor pode ser contado a partir do evento, sem ler `form_leads`.
- O hash diário do visitante (`modules/leads/visitor-hash.ts`) é um precedente para deduplicar visitas sem guardar IP; a Sprint 6 deve decidir se reutiliza o mesmo segredo ou um próprio.
- A ingestão de eventos precisa do mesmo cuidado de não bloquear a navegação: o clique no embed e a cópia do Pix não podem esperar a rede.
- Rate limit global e CAPTCHA continuam fora; a ingestão da Sprint 6 vai precisar do seu próprio limite.
- Antes de começar: aplicar a Sprint 5 em staging e medir LCP de campo numa página com imagens.
