# Modelo inicial de ameaças

| Ativo/fluxo | Ameaça | Controle inicial |
|---|---|---|
| Workspaces | acesso entre tenants | RLS, autorização servidor e testes negativos |
| Conta | credential stuffing e enumeração | rate limit, respostas neutras, verificação e MFA futuro |
| Slugs/domínios | sequestro e impersonação | unicidade, prova DNS, histórico e auditoria |
| Editor/embeds | XSS e URL perigosa | allowlist, sanitização e CSP |
| Upload | malware, bomba e custo abusivo | MIME real, tamanho, dimensões, quota e processamento isolado |
| Formulário | spam e coleta indevida | rate limit, honeypot/CAPTCHA adaptativo e consentimento |
| Analytics | fraude, replay e DDoS de eventos | assinatura/contexto, deduplicação, rate limit e filtros |
| Webhooks | spoofing e duplicação | validação de assinatura, timestamp e idempotência |
| Página pública | phishing/conteúdo ilícito | denúncia, moderação, suspensão e resposta rápida |
| Secrets | exposição no bundle/log | separação publicável/secret, redaction e rotação |
| Exclusão | dados órfãos | inventário de stores, job auditável e retenção definida |

## Estado dos controles após a Sprint 2

Legenda: **implementado + verificado** (teste automatizado ou verificação manual registrada), **implementado** (código existe, sem verificação dedicada), **preparado** (modelo/configuração pronta, ativação futura), **pendente**.

| Ameaça | Controle | Estado | Evidência |
|---|---|---|---|
| Acesso entre tenants por URL/payload forjado | RLS por comando, grants por coluna, RPCs que conferem `auth.uid()` e papel; guard no servidor com 404 para não membros | implementado + verificado | `supabase/tests/database/030-tenant-isolation.test.sql`, `040-roles.test.sql`; `modules/profiles/service.test.ts`; ataque manual com sessão real no relatório da Sprint 2 |
| Oráculo de existência via erros | insert forjado responde `42501` antes do erro de limite; RPCs respondem `P0002` para alvos de outros tenants | implementado + verificado | pgTAP 030 (assert "not as limit reached") |
| Escalada de papel / workspace sem dono | matriz owner/admin/editor; trigger "último owner" com lock | implementado + verificado | pgTAP 040 |
| Bypass de plano pelo cliente | `plan_id` sem grant de update; trigger `max_profiles` com lock; limite de 3 contas de agência por pessoa | implementado + verificado | pgTAP 060 e 020 |
| Enumeração de e-mail pela aplicação | mensagens idênticas em cadastro/recuperação, piso de 900 ms, login com erro único | implementado + verificado | `identity.test.ts`; medição no navegador (mesma mensagem) |
| Enumeração de e-mail direto na API do Auth | o endpoint `/auth/v1/recover` do Supabase responde 429 para e-mail existente dentro da janela de 60 s e 200 para inexistente | **risco residual** | medido localmente na Sprint 2; mitigação: CAPTCHA do Supabase Auth (Turnstile) antes do piloto externo |
| Link de verificação/recuperação reutilizado ou antigo | `token_hash` de uso único, expiração de 1 h, estado "link expirado" | implementado + verificado | reuso do link de recuperação redirecionou para "link expirado" |
| Sessão de invasor após recuperação | `signOut({ scope: "global" })` após redefinir senha | implementado + verificado | fluxo manual: nova senha exige novo login |
| Open redirect no login | allowlist de `next` (`/app`, `/redefinir-senha`) | implementado + verificado | `identity.test.ts` (15 entradas maliciosas); `next=https://evil…` virou `/app` no navegador |
| Host header injection em links de e-mail | links usam `NEXT_PUBLIC_APP_URL`, nunca o Host da requisição | implementado | `lib/app-url.ts` |
| CSRF em sign-out e mutações | Server Actions (POST com verificação de origem do Next); sign-out só por POST | implementado | `modules/identity/actions.ts` |
| Força bruta / credential stuffing | rate limits do Supabase Auth (local: 30/5 min por IP) | preparado | `supabase/config.toml`; checklist hospedado em `docs/ENVIRONMENTS.md`; rate limit próprio nas Server Actions fica para a Sprint 9 |
| Sequestro/impersonação de slug | normalização, unicidade global, lista reservada (inclui todas as rotas), retenção de 90 dias | implementado + verificado | pgTAP 050; `slug.test.ts` |
| Adulteração da trilha de auditoria | append-only para `anon`, `authenticated`, `service_role` e até o dono da tabela (update) | implementado + verificado | pgTAP 080 |
| Dados sensíveis em logs/auditoria | allowlist de metadados no banco e na aplicação; logger descarta chaves sensíveis e mascara e-mails | implementado + verificado | pgTAP 080; `audit.test.ts`; logs do servidor sem e-mail na verificação manual |
| Secret key no navegador | somente publishable key em `NEXT_PUBLIC_*`; secret apenas no store server-side da waitlist | implementado | `.env.example`, `lib/supabase/*` |
| MFA para owners | TOTP | pendente | adiado (ADR 0005) |
| Headers de segurança e CSP | — | pendente | Sprint 9 |

## Controles adicionados na Sprint 3 (página pública)

| Ameaça | Controle | Estado | Evidência |
|---|---|---|---|
| Listagem/scraping de todas as páginas pela Data API | `anon` sem privilégio em tabelas; única função anônima é `get_public_page(slug)` por endereço exato; sem sitemap | implementado + verificado | pgTAP 010 (única função anon) e 095 (anon não lê `profiles`, `profile_publications`, `slug_history`) |
| Vazamento de rascunho | renderer lê só o snapshot; não publicada e inexistente dão o mesmo 404; prévia do rascunho só em `/app` | implementado + verificado | pgTAP 090/095; jornada por Server Actions (rascunho editado não aparece até publicar) |
| XSS / esquema perigoso em link | allowlist http/https/mailto/tel validada no app, no banco (`LK040`, também para escrita direta pela API) e de novo no renderer | implementado + verificado | pgTAP 090 (`javascript:` rejeitado); Vitest `draft-content.test.ts`, `publishing.test.ts`; tentativa real pela Data API respondeu `LK040` |
| Ícone de rede social apontando para phishing | host precisa pertencer à rede (inclui subdomínios; rejeita `instagram.com.evil.example`, userinfo e http) | implementado + verificado | pgTAP 090; Vitest (teste de divergência SQL × TS) |
| Publicação por quem não pode / entre tenants | guard no servidor (`profile.publish`) + RPC `security definer` que confere `auth.uid()`, papel e workspace ativo | implementado + verificado | pgTAP 090 (outsider → `P0002`, anon → `42501`, suspenso → `42501`); Vitest; replay do formulário da Ana com a sessão da Bia → "não encontrado" |
| Adulteração de versões publicadas | snapshots imutáveis até para o dono da tabela (update); ponteiro com FK composta | implementado + verificado | pgTAP 090 |
| Publicar algo diferente do revisado (outra aba/colaborador) | `expected_revision` → `LK030` | implementado + verificado | pgTAP 090; jornada (revisão antiga recusada) |
| Página suspensa continuar no ar | `get_public_page` responde `suspended`; cache expira em ≤ 60 s mesmo sem invalidação | implementado + verificado (fallback medido em 30 s) | pgTAP 095; runbook `PUBLIC_PAGE.md` |
| Cache poisoning via Host | URLs absolutas só de `NEXT_PUBLIC_APP_URL`; `metadataBase` fixo | implementado | `lib/app-url.ts`, `app/layout.tsx` |
| Poluição do cache ISR com grafias variantes | redirect 308 no proxy antes do render para maiúsculas/`%` | implementado + verificado | curl: `/Ana-Lima` → 308 sem entrada de cache |
| Abuso do endpoint `/api/vitals` (logs falsos, flood) | allowlist de campos, limite de 1 KB, só same-origin, sempre 204 | implementado; **rate limit pendente** (Sprint 9) | Vitest `web-vitals.test.ts`; curl |
| Flood de endereços inexistentes gerando regenerações ISR | — | **risco residual** | cada endereço novo custa um render + RPC; mitigar com firewall/rate limit da Vercel antes do lançamento aberto |
| Banco lento derrubar páginas | timeout de 4 s; ISR mantém a última cópia boa | implementado + verificado | teste de queda: página em cache seguiu 200 (STALE); nova respondeu 500 em 4 s |
| Phishing/impersonação em páginas publicadas | suspensão por workspace; denúncia e moderação por página | parcial: suspensão existe, **denúncia/moderação pendentes** (Sprint 9) | — |

## Controles adicionados na Sprint 4 (editor por blocos)

| Ameaça | Controle | Estado | Evidência |
|---|---|---|---|
| XSS/esquema perigoso em destino de link (inclusive ofuscado: maiúsculas, espaços, tabs, controles, `%6A`, entidades HTML) | política única `modules/blocks/url-policy.ts` (https, http, mailto, tel; `https://` em domínio puro; sem `//host`, caminho relativo, `user:pass@`, host sem ponto ou IP) espelhada em `private.is_allowed_block_url`; destino armazenado sempre em ASCII imprimível | implementado + verificado | tabela `url-cases.ts` (28 casos) no Vitest e no pgTAP 100 (função e trigger, como editor autenticado sem passar pela UI); teste de divergência SQL × TS; no navegador: `JaVaScRiPt:` digitado → erro no campo; payload de Server Action forjado com `javascript:` → recusado, nada gravado |
| Payload forjado burlando a UI (chaves extras, tipos desconhecidos, ids duplicados, número de WhatsApp como URL) | chaves exatas por tipo, validação estrita no serviço (`validateStoredBlocks`) e de novo no banco (`LK040`) | implementado + verificado | Vitest `service.test.ts` (11 payloads forjados, repositório não chamado); pgTAP 100 |
| WhatsApp usado para levar a outro host | número guardado só como dígitos E.164; `wa.me` montado no render | implementado + verificado | pgTAP 100 (`https://evil.example` como telefone → `LK040`); Vitest |
| Injeção de HTML/script em bloco de texto | texto puro renderizado como nó de texto React; controles recusados | implementado + verificado | página pública mostrou `<script>alert(1)</script>` como texto |
| Payload gigante / DoS de armazenamento | até 100 blocos (check) e 64 KiB serializados (`octet_length(blocks::text)`), limites por campo | implementado + verificado | pgTAP 100; Vitest |
| Homógrafo (host com letras de outro alfabeto imitando marca) | host armazenado e exibido em punycode (`xn--`) no editor, com aviso; a página pública mostra só o texto do botão | **mitigação parcial**: o visitante não vê o destino antes de clicar; depende da moderação | ADR 0008; revisar com denúncia/moderação (Sprint 9) |
| Phishing por links publicados | política de URL bloqueia esquemas perigosos, mas não destinos maliciosos em https | **pendente**: denúncia, moderação e lista de bloqueio de domínios (Sprint 9) | runbook `EDITOR.md` §3 |
| Autosave sobrescrevendo edição de outra pessoa | compare-and-swap em `draft_revision`, conflito explícito, sobrescrever só com confirmação | implementado + verificado | pgTAP 100 (revisão antiga não grava); Vitest (máquina de estados); navegador: conflito → "carregar" e "manter" |
| Links que vazam o referer ou `window.opener` | `rel="ugc nofollow noopener noreferrer"` em todo link de usuário | implementado + verificado | HTML da página pública |

## Controles adicionados na Sprint 5 (mídia, embeds, Pix, formulário e tema)

| Ameaça | Controle | Estado | Evidência |
|---|---|---|---|
| Upload malicioso (SVG com script, HTML com extensão de imagem, arquivo corrompido, polyglot) | formato decidido pelos bytes (JPEG, PNG, WebP), nunca pelo nome ou MIME; o servidor decodifica com `sharp` e grava só o que ele mesmo re-codificou em WebP; bucket aceita apenas `image/webp` | implementado + verificado | Vitest `media.test.ts` (tabela de arquivos); navegador: cada arquivo recusado pela UI e por requisição forjada, bucket e tabela conferidos sem mudança |
| Bomba de descompressão / imagem gigante | dimensões lidas do cabeçalho antes de decodificar (4.096 px por lado, 16,7 MP), `limitInputPixels` no decodificador, corpo de até 4 MiB, 2 MiB por objeto | implementado + verificado | Vitest (cabeçalho PNG 30.000 × 30.000); requisição forjada com PNG real de 9.000 × 9.000 → `too_many_pixels` |
| Imagem animada | WebP animado e APNG recusados pelo cabeçalho e pelo decodificador | implementado + verificado | Vitest; navegador |
| Vazamento de metadados (EXIF, GPS) | toda variante é re-codificada a partir dos pixels; o original não é guardado | implementado + verificado | Vitest: marcador EXIF presente no original e ausente em cada variante |
| Upload direto ao Storage pulando a validação (sessão válida) | única policy de `insert` em `storage.objects`: variante de um asset `pending` do próprio usuário, cujo registro exige assinatura HMAC do servidor (segredo no Vault); sem policy de update/delete/select | implementado + verificado | pgTAP 120; navegador: `POST /storage/v1/object/media/...` com o token do usuário → 403; `register_media_asset` sem assinatura → `LK060` |
| Upload por quem não pode / em página de outro tenant | guard no servidor (`profile.edit_content`) + RPC que confere `auth.uid()`, papel e workspace ativo; origem da requisição conferida (CSRF) | implementado + verificado | Vitest; pgTAP 120; navegador: outra conta → 404, sem sessão → 401, `Origin` de outro site → 403 |
| Esgotar o armazenamento | cota por workspace via entitlement `storage_mb` com lock; 60 uploads por workspace por hora; órfãos saem pelo job de limpeza | implementado + verificado (job **não agendado**) | pgTAP 120 (`LK010`, `LK061`); limpeza executada à mão no ambiente local |
| Bloco de imagem apontando para arquivo de outro tenant ou para uma URL | o validador do rascunho só aceita asset `ready`, do mesmo tipo e **da mesma página**, com as dimensões do próprio asset | implementado + verificado | pgTAP 110 (outro workspace, outra página, pendente, avatar como imagem, URL, dados inline) |
| Imagem sumir de uma versão publicada (ou de um rollback) | nada é apagado quando o rascunho deixa de usar; limpeza só de assets sem referência no rascunho nem nas publicações retidas, com lock da página | implementado + verificado | pgTAP 120; navegador: imagem trocada, versão anterior restaurada e servida, órfão removido, as demais intactas |
| Embed arbitrário / script do usuário | embed é provedor + id (allowlist: YouTube, Vimeo, Spotify); código colado (`<iframe>`, `<script>`) é recusado; o `src` do iframe é montado de constantes + id validado; `sandbox`, `allow` e `referrerpolicy` fixos | implementado + verificado | tabela `embed-cases.ts` (21 casos) no Vitest e no pgTAP 110 (função e trigger, para os 3 provedores); navegador: entradas maliciosas na UI e em Server Action forjada → recusadas |
| Rastreamento do visitante por terceiros ao abrir a página | fachada: nenhum pedido ao provedor antes do clique; YouTube pelo domínio sem cookies; Vimeo com `dnt=1` | implementado + verificado | navegador: zero iframes e zero hosts de provedor antes do clique |
| CSS/fonte arbitrários pelo tema | tema é um conjunto fechado de tokens (duas cores `#rrggbb` + quatro enumerações); nenhuma string armazenada vira estilo | implementado + verificado | Vitest e pgTAP 110 (CSS, URL de fonte, chaves extras recusados) |
| Página ilegível por escolha de cores | cores de texto derivadas do fundo, sempre ≥ 4,5:1 | implementado + verificado | Vitest: grade de cores × 3 estilos de botão, inclusive hover |
| Spam no formulário | honeypot (resposta igual à de sucesso, nada gravado); 5 envios por visitante por página a cada 10 min; 60 por página por hora; corpo ≤ 4 KiB; repetição idêntica em 10 min gravada uma vez | implementado + verificado; **CAPTCHA pendente** | pgTAP 130; navegador: honeypot, sexta tentativa recusada, envio sem JavaScript |
| Envio a formulário não publicado, removido ou de página fora do ar | `submit_form_lead` valida contra o snapshot **no ar** | implementado + verificado | pgTAP 130 (8 casos) |
| Coleta sem consentimento | texto e obrigatoriedade definidos pelo dono; o banco recusa envio sem consentimento obrigatório e guarda texto, versão e horário | implementado + verificado | pgTAP 130; navegador (com e sem JavaScript) |
| Leitura de leads por visitante ou por outro tenant | `anon` sem privilégio em tabelas; RLS por workspace; exclusão e exportação só owner/admin, auditadas | implementado + verificado | pgTAP 130; navegador: outra conta → 404 na lista e na exportação |
| Identificação do visitante pelo limite de taxa | só um HMAC diário do IP (segredo no servidor), apagado em 24 h; IP nunca gravado | implementado + verificado | pgTAP 130 (nenhuma coluna de IP); Vitest `leads.test.ts` |
| Injeção de fórmula na exportação CSV | toda célula entre aspas; valores iniciados por `= + - @` recebem apóstrofo | implementado + verificado | Vitest |
| Fraude/impersonação por chave Pix ou link de pagamento | chave validada por tipo; link só https; a página avisa que o pagamento é no app do banco e pede para conferir o recebedor | **mitigação parcial**: não há verificação de titularidade; depende de denúncia e moderação (Sprint 9) | runbook `MEDIA.md` §1 e `PUBLIC_PAGE.md` §4 |
| Imagem imprópria ou ilegal publicada | — | **pendente**: sem moderação nem denúncia (Sprint 9); hoje a resposta é manual | runbook `MEDIA.md` §1 |
| Flood de uploads ou de envios por muitas contas/IPs | limites por workspace e por página | **risco residual**: rate limit global e firewall são da Sprint 9 | — |

## Controles adicionados na Sprint 6 (analytics do cliente)

Decisão: ADR 0011. É o primeiro caminho de escrita aberto a visitantes anônimos que cresce com o tráfego.

| Ameaça | Controle | Estado | Evidência |
|---|---|---|---|
| Analytics atrasar ou impedir o clique do visitante | links continuam âncoras para o destino real (sem redirecionamento pelo produto); coletor com listeners passivos, sem `preventDefault` e sem `await`; `sendBeacon`/`fetch keepalive` sem esperar resposta; a rota responde 204 antes do banco | implementado + verificado | Vitest `collector.test.ts` (opções do listener, verificação do código-fonte, falhas de transporte); navegador: destino abriu com a rota respondendo 500, pendurada e com a requisição bloqueada |
| Forjar eventos direto na RPC (escolher hash de visitante, país, origem) | lote assinado pelo servidor (HMAC, segredo no Vault); a assinatura é conferida antes de qualquer outra coisa; sem segredo nada é gravado | implementado + verificado | pgTAP 140 (assinatura errada, ausente, reutilizada em outra página, segredo ausente); Vitest (vetor de assinatura igual nos dois lados) |
| Inflar os números de uma página (da própria ou de outro tenant) | limites no banco, contados em eventos gravados: 60 por endereço por página em 10 min, 2.000 por página por hora; o balde de limite ignora o user agent | implementado + verificado; **limite global na frente da rota pendente** (Sprint 9) | pgTAP 140; teste de carga: 3.000 eventos enviados, 2.000 gravados; script de precisão (61º evento do mesmo endereço recusado) |
| Espalhar um flood por muitas páginas a partir de um endereço | contador por endereço em todas as páginas (200 por janela de 10 min, 2.000 por dia), numa tabela que não guarda página | implementado + verificado | pgTAP 140 |
| Encher o banco (DoS de capacidade) | repetição de visita não é gravada; retenção bruta de 7 dias; a ingestão descarta tudo enquanto a tabela bruta tiver cerca de 500 mil eventos (≈ 165 MB) | implementado + verificado; **sender distribuído ainda consegue chegar ao teto** e fazer eventos reais serem descartados até a limpeza | pgTAP 140 (`shedding`); `docs/SUPABASE_CAPACITY.md` |
| Replay / retry contado duas vezes | chave de deduplicação `(página, id do evento)` enquanto o bruto existir; duplicata é ignorada sem erro | implementado + verificado | pgTAP 140 (evento e lote repetidos); script de precisão (40 retries, 0 a mais) |
| Evento para página não publicada, suspensa, excluída ou inexistente | validado contra a publicação **no ar**; resposta única `unavailable` | implementado + verificado | pgTAP 140 |
| Evento para bloco que não está no snapshot, ou de tipo diferente do bloco | o bloco tem de existir na publicação no ar com o tipo do evento | implementado + verificado | pgTAP 140 (16 casos: oculto, só no rascunho, de outra página, tipo trocado, texto arbitrário) |
| Forjar envio de formulário para inflar "resultados" | `form_submit` não é aceito de clientes; só `submit_form_lead` cria, quando grava um lead | implementado + verificado | pgTAP 140; Vitest |
| Ataque de cardinalidade por UTM | valores restritos a `[a-z0-9_.-]`, até 40 caracteres; no máximo 20 combinações distintas por página por dia (acima disso a visita conta sem UTM); só as 20 maiores são lidas | implementado + verificado | pgTAP 140; Vitest |
| Vazamento do referrer (caminho, query string, tokens na URL de origem) | o coletor envia só o host; o servidor classifica em 12 origens e descarta o host; nada além da categoria é gravado | implementado + verificado | Vitest (`ingest`: caminho, query, IP e user agent não chegam ao payload); pgTAP 140 (endereço no lugar da origem é recusado; nenhuma coluna de URL, referrer, IP ou user agent) |
| Injeção de texto arbitrário na base ou no painel | nenhuma coluna de texto livre: enumerações, país de 2 letras, UTM restrito, id de bloco validado contra o snapshot | implementado + verificado | pgTAP 140; restrições `check` |
| Identificar ou seguir um visitante | sem cookie nem armazenamento no navegador; hashes diários com sal do servidor; o hash guardado no evento inclui a página; o contador entre páginas não guarda página; "visitantes únicos" não é exibido | implementado + verificado | Vitest (`visitor hashes`); pgTAP 140 |
| Leitura de eventos ou agregados por visitante ou por outro tenant | nenhum papel de cliente tem privilégio nas tabelas; leitura só por `get_profile_analytics`, que confere a membership e aplica o histórico do plano | implementado + verificado | pgTAP 140 (anon, membro lendo direto, outro workspace → `P0002`); navegador: outra conta recebe "não encontrada" no painel e 404 no CSV |
| Tráfego interno ou automático contado como visita | robôs e prévias de link por user agent, `navigator.webdriver`, sessão do produto no mesmo navegador, visita vinda de `/app`; a prévia e o editor não montam o coletor | implementado + verificado; **limite conhecido:** dono sem sessão, em outro navegador ou num navegador embutido conta; robô com user agent de navegador conta até o limite | Vitest (tabela de user agents; teste de isolamento do coletor); navegador (dono com sessão: descartado; prévia: zero requisições) |
| Injeção de fórmula no CSV | mesmas células da exportação de leads (aspas e apóstrofo); o CSV só tem totais por dia | implementado + verificado | Vitest |
| Chamar o job de agregação/limpeza sem autorização | `CRON_SECRET` em `Authorization`, comparação em tempo constante; a função só é executável pelo `service_role` | implementado + verificado | Vitest `jobs/analytics/route.test.ts`; pgTAP 140 |
| Flood de requisições a `/api/events` (custo de função e de transação) | corpo de até 4 KiB, 10 eventos por lote, resposta sem banco | **risco residual**: sem limite global nem firewall até a Sprint 9 | — |

## Controles adicionados na Sprint 7, parte 1 (páginas, convites e papéis)

Desenho em `docs/adr/0012-multi-page-operations-invitations-and-roles.md`. Verificado no stack local (pgTAP 150, Vitest e navegador).

| Ameaça | Controle | Estado |
|---|---|---|
| Roubo ou encaminhamento do link de convite (o link circula por WhatsApp) | O link só é aceito por uma sessão cujo e-mail **confirmado** é o convidado; outra conta recebe "este convite é para outro e-mail", sem nome da conta nem de quem convidou. Uso único, validade de 7 dias, cancelável | Implementado e testado (pgTAP, navegador) |
| Reuso do link (replay) | A aceitação marca o convite na mesma transação que cria a participação; a segunda tentativa recebe o estado genérico | Implementado e testado |
| Vazamento do token em repouso | Só o SHA-256 é guardado; a criação recebe apenas o hash; `token_hash` não tem `grant` para nenhum papel de cliente; a aceitação recalcula o hash do token apresentado, então um hash lido não serve para aceitar | Implementado e testado (pgTAP 010 e 150) |
| Token em logs | Os logs estruturados registram só o desfecho (`members.invite`, `members.accept_invitation`); o logger descarta chaves `token` e `email`. Conferido no log do servidor durante a verificação: nenhuma ocorrência de token ou endereço | Implementado. **Exposição restante:** o token está no caminho da URL e aparece no log de requisições da hospedagem |
| Token em `Referer` | A tela de convite declara `referrer: no-referrer` e não tem link externo | Implementado (conferido no navegador) |
| Aceitar na conta errada (convite da conta A concedendo acesso à conta B) | A aceitação não recebe a conta como parâmetro: ela vem da linha do convite. O resultado devolve a conta e o teste confere que nenhuma outra participação foi criada | Implementado e testado |
| Escalada por convite | Convite só concede administrador ou editor (constraint + RPC + serviço); nem o proprietário convida outro proprietário. Quem já é membro e abre um convite com papel maior não muda de papel | Implementado e testado |
| Escalada por administrador | `change_member_role` e `remove_workspace_member` (Sprint 2) continuam recusando promover a proprietário, rebaixar ou remover proprietário; o serviço verifica antes e a interface só oferece os papéis permitidos | Implementado e testado |
| Enumeração de convites | Token desconhecido, malformado, expirado, cancelado, já usado, de conta excluída ou suspensa: a mesma linha do banco e a mesma tela. Editor e outras contas não leem `workspace_invitations` | Implementado e testado |
| Enumeração de membros e de contas | `list_workspace_members` responde `P0002` a quem não é membro; e-mails só para proprietário e administrador. Convidar um e-mail que já é membro responde "já faz parte" só a quem administra aquela conta. Convidar um e-mail qualquer não revela se ele tem cadastro | Implementado e testado |
| Sessão aberta de quem foi removido ou rebaixado | Nada é guardado por sessão: a participação é relida a cada Server Action, rota e página, e o RLS a avalia a cada comando. Verificado no navegador: editor removido com a aba aberta → o salvamento seguinte recusado; administrador rebaixado com o diálogo aberto → "sem permissão" | Implementado e testado |
| Convite além do limite do plano | Convites pendentes contam como lugar; o limite é conferido na criação e de novo na aceitação, com a linha da conta travada | Implementado e testado |
| Spam de convites | 20 por conta e 30 por pessoa em 24 h (`LK082`); nenhum e-mail é enviado pelo produto | Implementado e testado. **Pendente:** limite global por IP (Sprint 9) |
| Duplicação como atalho para burlar entitlements | A cópia entra pelo mesmo `insert` de páginas: o gatilho de `max_profiles` vale igual; páginas arquivadas continuam contando; imagens compartilhadas contam uma vez em `storage_mb` | Implementado e testado |
| Conteúdo mutável compartilhado entre original e cópia | Cópia profunda numa transação, com id novo para cada bloco; imagens são imutáveis (trocar cria outro asset) e ficam vivas enquanto alguma das páginas as usa | Implementado e testado (AC2) |
| Cópia publicada com Pix, WhatsApp ou consentimento de outro cliente | Aviso "Revise antes de publicar" no rascunho copiado, listando o que conferir, até a primeira publicação. Não bloqueia | Implementado. **Risco aceito:** depende de a pessoa ler o aviso (UX-052) |
| Busca da lista como vetor de leitura entre contas ou de injeção | A função roda com os privilégios de quem chama (RLS decide); `%`, `_` e `\` são escapados; ordem e filtro vêm de listas fechadas | Implementado e testado com strings hostis |
| Página arquivada continuar no ar ou em cache | A mesma transação tira a página do ar; a ação invalida o cache público pelo caminho já usado por "Tirar do ar"; uma constraint impede página arquivada com versão no ar | Implementado e testado (navegador: 404 logo após arquivar) |

## Requisitos antes do MVP privado

- headers de segurança e CSP;
- RLS em todas as tabelas expostas — **feito para as tabelas da Sprint 2**;
- testes de isolamento por workspace — **feito (pgTAP + Vitest)**;
- rate limits para auth, formulário, upload e ingestão — Auth configurado localmente; formulário e upload têm limites no banco (Sprint 5); a ingestão de analytics tem limites no banco por endereço, por página e de capacidade (Sprint 6); limite global na frente das rotas públicas pendente;
- CAPTCHA no Auth para fechar a enumeração direta pela API;
- trilha para publicação, domínio, papéis e suspensão — papéis/slug/exclusão/publicação/restauração/despublicação feitos; domínio e suspensão pendentes;
- backup e restauração testados;
- processo de denúncia e contato de segurança.

## Controles adicionados na Sprint 7, parte 2 (painel consolidado e links de relatório)

Decisões em `docs/adr/0013-consolidated-analytics-and-report-links.md`. O link de relatório é a primeira superfície em que dado de uma conta é mostrado a quem não tem conta, só com um segredo na URL.

| Ameaça | Controle | Estado |
|---|---|---|
| Vazamento do token pelo cabeçalho `Referer` | `Referrer-Policy: no-referrer` como cabeçalho (também no 404) e como meta; o único link do relatório é o endereço público da própria página, com `rel="noreferrer"`; nenhuma requisição a terceiros | implementado; verificado na resposta real |
| Vazamento pelo log da aplicação | O log registra `report.read` com o desfecho e nunca o token nem o caminho; as ações de criar e cancelar registram só o desfecho (testes de unidade e log real conferido) | implementado |
| Vazamento pelo log de requisições da hospedagem e pelo histórico do navegador | O token fica no caminho da URL. Mitigado por validade obrigatória (até 90 dias), cancelamento imediato e pelo fato de o link abrir só totais de uma página | **risco aceito**, registrado no ADR |
| Vazamento por prévia de link e mensagem encaminhada | Título genérico, sem imagem Open Graph, `noindex`. Quem recebe a mensagem encaminhada abre o relatório: o link **é** a credencial. A agência cancela e cria outro | aceito; a tela de gestão avisa que quem tiver o link vê os resultados |
| Adivinhar um token | 256 bits aleatórios; só o hash é guardado; o hash não abre nada | implementado |
| Tentativas em massa | 20 falhas por cliente em 10 minutos (hash diário do endereço) bloqueiam aquele cliente; no máximo 5.000 falhas gravadas por 10 minutos. Quem chama a RPC direto pode variar a chave | parcial; limite global na frente de `/r/` fica para a Sprint 9 |
| Usar o link depois de cancelado ou expirado por causa de cache | Rota dinâmica, lida a cada requisição; `Cache-Control: private, no-store`; nunca ISR. Verificado: 404 na requisição seguinte ao cancelamento | implementado |
| Ler outra página com o token de uma | A função resolve o token para uma linha e lê só a página dela; parâmetros na URL são ignorados; pgTAP com duas páginas e duas contas | implementado |
| Ler dados internos pelo relatório | Lista fechada de campos montada no banco; pgTAP falha se aparecer um campo a mais; nenhum identificador (teste procura qualquer UUID na resposta), nada do rascunho, nenhum UTM | implementado |
| Usar o relatório para descobrir quais páginas ou links existem | Token desconhecido, malformado, expirado, cancelado, de página excluída, de conta suspensa ou sem o recurso no plano: o mesmo 404 com o mesmo texto | implementado |
| Membro sem permissão criando ou cancelando links | Só proprietário e administrador, na aplicação e nas RPCs; editor recebe `42501`; membro de outra conta recebe "não encontrado" | implementado; chamadas diretas testadas |
| Ler o consolidado de outra conta | `get_workspace_analytics` confere a participação e responde "não encontrada"; `anon` não executa | implementado |
| Negação do relatório por um terceiro | Quem chama a RPC sem chave de cliente divide um balde de 300 falhas; com `VISITOR_HASH_SALT` configurado, visitantes reais não estão nesse balde. Sem o segredo, estariam | parcial; depende do segredo já existente e do limite global da Sprint 9 |
| Relatório aberto contando como visita | A rota não monta o coletor; teste garante que só `/[slug]` o importa; conferido que abrir o relatório não grava evento | implementado |

Pendente: limite global e CAPTCHA (Sprint 9), expurgo agendado de links e contadores (Sprint 9), incluir os links na exportação e na exclusão de conta (Sprint 9), revisão jurídica do texto do relatório.
