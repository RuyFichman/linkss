# Relatório da Sprint 4

**Status:** implementada e verificada no ambiente local (Supabase local, `next dev` e `next start` de produção). Nada foi provisionado nem aplicado em projeto hospedado. O critério AC5 está **parcial**: só existe um proxy interno, sem usuários reais.
**Objetivo:** permitir que a pessoa monte a página por blocos sem código, com autosave honesto, prévia móvel persistente e publicação na mesma ordem e com o mesmo conteúdo da tela
**Data:** 30/09/2026
**Branch:** `feat/sprint-4-block-editor`, criada a partir de `main` depois do merge do PR #6 (confirmação de UX-020, 021, 023 e 025)

## Resultado

Na rota de edição da página (`/app/w/<conta>/paginas/<página>`), a pessoa edita o cabeçalho (nome e apresentação) e uma lista de blocos: **link, texto, redes sociais, WhatsApp e separador**. Com cada bloco ela pode:
- adicionar;
- editar;
- mover (para cima/baixo, para o topo/fim);
- duplicar;
- ocultar ou mostrar;
- excluir, com desfazer por 10 s.

Tudo é salvo automaticamente no rascunho, com status em texto, e "Salvo" só aparece depois que o servidor confirma. Uma prévia ao lado (desktop) ou alternável (celular) usa o mesmo renderer e o mesmo mapeamento da publicação. "Publicar" só fica ativo com tudo salvo e publica a revisão confirmada. A página pública e a prévia mostram exatamente a ordem do editor. Snapshots da Sprint 3 continuam sendo servidos e podem ser restaurados.

## Estado dos gates (§0 do prompt)

- **Gate de usabilidade:** o *override* do founder de 25/09/2026 continua valendo, e as cinco sessões seguem pendentes.
- **UX confirmadas:** UX-020, UX-021, UX-023 e UX-025 (30/09/2026). As demais são provisórias e funcionam como padrão.
- **UX-024:** substituída nesta sprint.
- **Staging:** adiado para depois desta sprint; nada foi provisionado.

## Decisões tomadas

Técnicas (ADR 0008, em inglês; a ADR 0007 foi marcada como complementada por ela):

- **Modelo de blocos:**
  - É uma união discriminada em `profiles.blocks`, com chaves exatas por tipo: `id` (UUID), `type` e `visible`, mais os campos de cada tipo.
  - Os tipos da Sprint 5 entram como novos membros da união, sem reescrever rascunhos.
- **Redes sociais viram bloco:**
  - O bloco `social` carrega os próprios itens, e uma página pode ter mais de um.
  - Uma migração idempotente moveu as redes de `social_links` para um bloco social no topo, sem alterar `draft_revision`. Assim, páginas "em dia" continuam em dia.
  - `social_links` foi **mantida**: não é mais gravada nem foi apagada.
- **Documento publicado na versão 2:**
  - Só `blocks`, sem `visible`, sem blocos ocultos e sem redes vazias, com campos explícitos por tipo.
  - `schema_version` tem padrão 2 e uma `check` exige que bata com o documento.
  - O renderer lê as versões 1 e 2. A versão 1 é convertida: as redes do cabeçalho viram o bloco `legacy-social` no topo.
- **Política de URL única:**
  - `modules/blocks/url-policy.ts` é espelhada em `private.is_allowed_block_url`.
  - Permitidos: https, http (mantido como digitado, com aviso), mailto e tel.
  - `https://` é adicionado em domínio sem protocolo.
  - Recusados: host sem ponto, IPv4, `//host`, caminhos relativos e `user:pass@`.
  - O destino é sempre guardado em ASCII: IDN em punycode e o resto percent-encoded.
  - Links para a própria origem são permitidos como qualquer https, já que não há rota GET com efeito colateral.
- **WhatsApp:**
  - O número é guardado só como dígitos E.164.
  - `wa.me` é montado na renderização e nunca guardado.
- **Salvamento do rascunho inteiro:**
  - Título, bio e blocos vão num único `UPDATE … WHERE draft_revision = esperado`, sob RLS e com a sessão do usuário.
  - O conflito é tipado.
  - Nenhum evento de auditoria por salvamento; a publicação continua auditada.
- **Autosave:**
  - Debounce de 1 s ao digitar; ações estruturais salvam na hora.
  - Uma requisição por vez: chega só o estado mais recente.
  - Retry em 1, 2 e 4 s para falhas transitórias, sem retry para validação, permissão ou sessão.
  - No conflito, para de salvar e guarda a cópia local até a pessoa escolher.
- **Limites técnicos (constantes e SQL):**
  - 100 blocos e 64 KiB serializados.
  - Título de link e texto do botão de WhatsApp: 80; texto: 1.000; mensagem: 500; URL: 2.048.
- **`rel`:** `ugc nofollow noopener noreferrer` em links de usuário. O `noreferrer` foi adicionado a pedido do prompt.
- **Sem dependência nova:** nada de drag-and-drop, biblioteca de estado ou de formulário.

Produto/UX, todas provisórias (`docs/ux/UX_DECISIONS.md`):
- **UX-026:** excluir com desfazer de 10 s; confirmação só para perdas irreversíveis.
- **UX-027:** textos do autosave e Publicar bloqueado até tudo estar salvo.
- **UX-028:** rótulos dos tipos e posição de inserção.
- **UX-029:** reordenar por botões, sem arrastar.
- **UX-030:** http mantido com aviso.
- **UX-031:** redes como bloco posicionável.
- **UX-032:** cabeçalho editado no editor e prévia sem blocos inválidos.

## Critérios de aceite

| # | Critério | Estado | Evidência |
|---|---|---|---|
| AC1 | Ordem do editor = ordem publicada | **verificado** | Editor, prévia e snapshot derivam do mesmo array. Vitest: "editor, preview and snapshot share one order" e `buildDocumentJson`. pgTAP 100: o snapshot mantém a ordem e remove ocultos e redes vazias. No navegador, o separador foi reordenado só pelo teclado e, depois de publicar, `/studio-sprint-quatro` mostrou link, WhatsApp, texto, separador, redes, a mesma ordem do editor. No roteiro AC5 a página pública saiu na ordem de criação |
| AC2 | Falha de salvamento visível, sem falso sucesso | **verificado** | Vitest cobre a máquina de estados: debounce, ausência de sobreposição, edição durante o salvamento, retry, erros sem retry, conflito e estado inválido. No navegador: `fetch` derrubado mostrou "Sem resposta do servidor…" → "Não foi possível salvar" + "Tentar novamente" depois de 4 tentativas, e voltou para "Salvo" após reconectar. Payload recusado → "Não foi possível salvar" com o motivo. Saída com alteração pendente → `beforeunload` bloqueado (e liberado depois de salvo). Conflito → aviso + escolha. O "servidor fora do ar" foi simulado pela falha de `fetch` do Server Action, sem parar o processo |
| AC3 | URLs perigosas e esquemas não permitidos bloqueados | **verificado** | Tabela `url-cases.ts` com 28 casos (ofuscação por maiúsculas, espaço, tab, controle, `%6A`, entidades, `data:`, `intent:`, `//host`, credenciais, bidi, localhost, IP), rodada no Vitest e no pgTAP 100, pela função e pelo trigger, como editor autenticado. Um teste de divergência garante a mesma lista nos dois lados. No navegador: ` JaVaScRiPt:alert(document.cookie)` digitado → erro no campo com `aria-describedby`, bloco fora da prévia, Publicar desativado. Server Action forjada com `javascript:` → `validation`, nada gravado. `rel` conferido no HTML público |
| AC4 | Edição por teclado e em viewport móvel | **verificado** (teclado e larguras) / **parcial** (leitor de tela real) | Só pelo teclado: adicionar → foco no primeiro campo; mover → foco fica no botão (no topo vai para "para baixo") com anúncio "Bloco movido para a posição 1 de 5"; excluir → foco em "Desfazer"; desfazer → foco no bloco restaurado e anúncio. Sem rolagem horizontal em 360, 390, 768 e 1280 px (Chrome headless; um bug encontrado e corrigido, ver abaixo). Nenhum alvo interativo menor que 44 px. Lighthouse no editor: Acessibilidade 100 (mobile e desktop). Não foi testado com NVDA/VoiceOver |
| AC5 | Usuário novo cria e publica 5 blocos em < 10 min | **parcial: proxy interno** | Roteiro automatizado em 390 px: cadastro → confirmação no Mailpit → onboarding → link, WhatsApp, texto, redes e separador → "Salvo" → Publicar → página pública com os 5 blocos. 12 s de máquina, **26 ações** (16 cliques e 10 campos, 195 caracteres). A estimativa conservadora para uma pessoa (3 s por clique e por campo, 35 palavras/min no celular, 30 s para abrir o e-mail) é de **≈ 3 min**. A validação real depende das sessões de `docs/research/USABILITY_TEST_PLAN.md` |

## Entregáveis

| ID | Entrega | Onde revisar |
|---|---|---|
| D1 | ADR 0008 | `docs/adr/0008-block-model-and-editor.md` (ADR 0007 marcada como complementada) |
| D2 | Migração + pgTAP | `supabase/migrations/202609300001_block_editor.sql`; `supabase/tests/database/100-blocks.test.sql` (41 asserções). Tipos regenerados sem mudança, porque as funções novas são privadas |
| D3 | Política de URL e entrada | `apps/web/src/modules/blocks/{url-policy,url-cases,whatsapp,model,validation,limits,social}.ts` e `blocks.test.ts` |
| D4 | UI do editor | `modules/editor/components/{block-editor,block-card,block-fields,use-autosave}.tsx`; rota `app/app/w/[workspaceId]/paginas/[profileId]/page.tsx`; `PublishForm`/`PublishPanel` adaptados; formulários da Sprint 3 removidos |
| D4b | Estado do editor | `modules/editor/draft/{state,autosave,summary}.ts` e `draft.test.ts`; serviço `saveDraft`/`loadDraft` em `modules/profiles/{service,actions,supabase-repository}.ts` |
| D5 | Renderer | `modules/publishing/document.ts` (v1 + v2), `render/public-page-view.tsx` (novos tipos, `data-block-*`, modo não interativo para a prévia), `render/social-icon.tsx` |
| D7 | Documentação | `docs/THREAT_MODEL.md`, `DATA_MAP.md`, `OBSERVABILITY.md`, `ARCHITECTURE.md`, `runbooks/EDITOR.md` (novo), `ux/UX_DECISIONS.md`, `ux/CONTENT_GUIDE.md`, `BACKLOG.md`, `AGENTS.md` §22, este relatório; prompt versionado em `docs/prompts/SPRINT_4_CLAUDE_PROMPT.md` |

## Validação executada

### Navegador (localhost, usuário de teste local)

- **Fluxo pela extensão do Chrome, com eventos reais de teclado e dados verificados no banco:**
  - criar os 5 tipos;
  - normalização ao sair do campo (`https://` adicionado, telefone formatado);
  - reordenar e desfazer;
  - URL maliciosa e Server Action forjada;
  - falha de rede;
  - conflito, com "Manter as minhas alterações" e "Carregar a versão mais recente" (o outro salvamento foi simulado por escrita direta no banco: a segunda aba em segundo plano não recebia foco);
  - publicar;
  - **rollback para um snapshot da versão 1**, inserido como versão retida e restaurado pelo botão "Restaurar": a página pública mostrou o título antigo, o bloco `legacy-social` e o link antigo.
- **Janela do Chrome oculta:** a janela controlada pela extensão estava oculta (`visibilityState: hidden`), como nas Sprints 2 e 3. Por isso as capturas, o roteiro AC5 e as larguras foram feitas com Chrome headless via CDP, em script local no scratchpad e sem dependência nova.
- **Revisão visual:** capturas de página inteira em 360, 390 (editar e pré-visualizar) e 1280 px.

### Bug encontrado e corrigido durante a sprint

- **O problema:** em 360 e 390 px, a viewport de layout crescia para 599 px. Grids com coluna automática deixavam o resumo `truncate` (`nowrap`) de um bloco de texto longo ditar a largura.
- **A correção:** colunas `minmax(0,1fr)` no editor, na lista e nos cartões.
- **A verificação:** medida de novo, `scrollWidth` igual à viewport em todas as larguras.
- **Sem teste unitário:** é layout CSS, sem lógica testável. A verificação fica registrada aqui.

### Desempenho (Lighthouse 12, `next start`, mobile emulado)

O domínio do Kaspersky local foi bloqueado, como na Sprint 3.

| Página | LCP | CLS | Performance | Acessibilidade | Observação |
|---|---|---|---|---|---|
| Pública com 12 blocos mistos (`/carla-nutricao`), 3 execuções | 2,42 / 2,42 / 2,42 s | 0 | 97 | 100 (SEO 100) | Sprint 3, só com links: 2,3–2,4 s. **Folga de ~0,08 s** |
| Editor (sessão real), mobile | 1,5 s | 0 | 100 | 100 | `label-content-name-mismatch` corrigido |
| Editor, desktop | 0,7 s | 0 | 100 | 100 | — |

**JavaScript no cliente:**
- Editor: 165,6 KB transferidos (534 KB descomprimidos, 12 scripts).
- Página pública: 147,7 KB (10 scripts, runtime do Next).
- Custo próprio do editor: **≈ 18 KB comprimidos**.

O Best Practices do editor (0,81–0,82) cai só por causa do script do antivírus injetado via http local.

### Resultado final registrado

```text
npm audit: found 0 vulnerabilities
lint: aprovado (eslint --max-warnings=0)
typecheck: aprovado
test: 13 arquivos, 215 testes aprovados
test:db: 12 arquivos, 272 asserções aprovadas (41 novas em 100-blocks)
supabase db advisors --local: No issues found
build: aprovado, 33 rotas + Proxy
npm run check: aprovado (exit 0)
```

A migração foi aplicada no banco local com `supabase migration up`. **Não rodei `db reset`**, para não apagar as contas locais do teste do founder. A aplicação a partir do zero fica a cargo do job `database` do CI.

## Segurança, privacidade, acessibilidade, performance e operação

- **Segurança:**
  - Nova seção da Sprint 4 em `docs/THREAT_MODEL.md`.
  - Casos negativos testados: 28 URLs maliciosas no TypeScript e no banco; 11 payloads forjados no serviço; Server Action forjada no navegador; chave extra, tipo desconhecido, id duplicado, telefone-URL, controles em texto, limites; revisão desatualizada; outro workspace lendo e escrevendo com `profile_id` forjado; troca de `workspace_id`; `anon` lendo e escrevendo o rascunho; o papel `editor` pode editar e publicar.
  - Nenhuma chave secreta no caminho do editor.
- **Privacidade:**
  - `docs/DATA_MAP.md`: número e mensagem de WhatsApp seguem o ciclo do rascunho e das 10 versões.
  - Os logs `editor.*` não carregam conteúdo.
  - Nenhum subprocessador novo.
- **Acessibilidade:**
  - Botões de mover como alternativa a arrastar (WCAG 2.5.7) e alvos de 44 px.
  - `aria-live` para salvamento e anúncios de reordenar, excluir e restaurar; status em texto.
  - Erros com `aria-describedby`; foco gerenciado; diálogos nativos com retorno de foco e Esc.
  - Prévia sem links focáveis.
  - O rótulo visível faz parte do nome acessível.
- **Performance:** a página pública continua HTML servido do snapshot. A prévia não chama analytics nem navega.
- **Operação:**
  - Sinais `editor.save` e `editor.load_latest` com limiares em `docs/OBSERVABILITY.md`.
  - Runbook `docs/runbooks/EDITOR.md` cobre: alterações não salvas, conflito entre abas, link malicioso publicado, snapshots antigos e rollback da aplicação.

## Pendências, gaps e riscos

- **AC5 sem usuários reais:** só proxy interno. O teste com cinco pessoas continua pendente, e o editor é a tela mais exposta a achados de vocabulário e fluxo.
- **Rollback da aplicação para a Sprint 3** não é suportado sem preparo. O renderer antigo não lê a versão 2, e o formulário antigo regravaria só links. Como nada está implantado, foi aceito. A partir do primeiro deploy, mudanças de formato seguem *expand/contract* (ADR 0008).
- **LCP com folga de ~0,08 s** com 12 blocos (laboratório). Medir em campo assim que houver staging.
- **Phishing por destino https:** a política barra esquemas, não destinos. Denúncia, moderação e lista de bloqueio de domínios são da Sprint 9. Homógrafos só ficam visíveis no editor (punycode), não para o visitante.
- **Navegação "voltar" do navegador dentro do app** com alterações pendentes não é interceptada. O aviso cobre recarregar, fechar e links internos.
- **Leitor de tela real** (NVDA/VoiceOver) não foi usado; a verificação foi por árvore de acessibilidade, Lighthouse e foco.
- **Rascunhos antigos** com links que a política nova recusa (por exemplo host sem ponto) ficam marcados "Precisa de ajuste" e bloqueiam o salvamento até a correção. Esses links somem da página pública na renderização.
- **`social_links` legada:** remover precisa de aprovação.
- **Herdadas:** staging (próximo passo combinado), SMTP, CAPTCHA, rate limit, Sentry e monitor.

## Perguntas para o founder

1. **Desfazer exclusão:** confirma o desfazer de 10 s em vez de confirmar cada exclusão (UX-026)?
2. **Links http:** manter como digitados, com aviso (UX-030), ou forçar https?
3. **Redes sociais:** posicionáveis como bloco, permitindo mais de um bloco (UX-031)?
4. **`noreferrer`:** está bem tirar o referer dos links? O destino deixa de ver que o visitante veio da página; UTM continua funcionando.
5. **Staging:** podemos provisionar agora (Supabase Free + Vercel `*.vercel.app`), como combinado para depois desta sprint?

## Implicações para a Sprint 5

- Imagem, embed, Pix e formulário entram como novos tipos. Mudam juntos: `KEYS`/validador em `modules/blocks/model.ts`, o `case` em `private.validate_profile_draft` e em `private.published_block`, `parseBlock` em `document.ts`, `BlockView` e os dois conjuntos de testes. O tipo de bloco também entra em `BLOCK_TYPES`, `BLOCKS_COPY` e `blockSummary`.
- Embeds e Pix devem reaproveitar a política de URL (allowlist de provedor por cima dela). A imagem precisa do `StorageAdapter` e de dimensões no documento para não causar CLS.
- Os templates podem semear blocos com o mesmo modelo, inclusive `social`.
- O limite de 64 KiB e de 100 blocos vale também para o conteúdo dos templates.
- Os `data-block-id` estáveis já estão no HTML para a Sprint 6.
