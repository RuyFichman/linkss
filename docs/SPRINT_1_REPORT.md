# Relatório da Sprint 1

**Status:** implementação e QA técnico concluídos; gate humano preparado e pendente
**Objetivo:** definir e tornar testáveis os fluxos críticos antes do schema e editor de produção
**Data:** 25/09/2026

## Resultado

As jornadas individual e de agência foram definidas, prototipadas e conectadas ponta a ponta. O protótipo mantém estado somente no navegador, simula falhas sem falso sucesso e captura o tempo até a primeira publicação. Landing, variantes de mensagem, lista de espera server-side, kit de pesquisa, linguagem e design tokens também estão implementados.

O gate técnico da sprint está atendido. Os critérios “5/5 publicam sem instrução” e “4/5 em menos de 10 minutos” dependem de pessoas reais e não foram executados; estão classificados como **preparado**, não atendido. O schema multi-tenant da Sprint 2 deve aguardar esse teste e a decisão sobre achados estruturais.

## Decisões tomadas

- “Página” é o termo principal de interface; “perfil” permanece no domínio técnico.
- “Resultado” representa a ação de valor na linguagem do usuário.
- Workspace aparece como “Pessoal” ou pelo nome da “conta da agência”.
- Template aplicado a página vazia adiciona blocos seed; com conteúdo existente altera apenas o tema e nunca apaga blocos.
- Duplicação cria cópia profunda de blocos/tema e não copia analytics, domínio, pixels ou relatórios.
- Ausência de resultado alerta, mas não bloqueia publicação; slug inválido ou ausência de bloco visível bloqueiam.
- Free mostra o limite de 7 dias e explica 30/90 dias sem hard sell ou checkout falso.
- Relatórios são somente leitura, limitados a uma página/período e têm expiração/revogação explícitas.
- Waitlist usa store em memória somente em desenvolvimento/teste; produção falha de modo visível sem Supabase configurado.
- Todas as decisões de vocabulário e comportamento ainda não validadas estão marcadas como provisórias em `docs/ux/UX_DECISIONS.md`.

## Critérios de aceite

| Critério | Estado | Evidência |
|---|---|---|
| Cinco pessoas publicam sem instrução verbal | preparado | protótipo self-service, roteiro, reset, instrumentação e tabela de resultados existem; nenhuma sessão humana foi realizada |
| Pelo menos quatro concluem em menos de 10 minutos | preparado | orçamento J1 de 9 minutos; `session_started` → `publish_succeeded` calculado e exportado no debug; precisa de 5 sessões reais |
| Estados vazio, erro, salvando, salvo, preview e publicado | atendido | componentes e telas; debug força erro/lentidão de save, erro de publish e estados de analytics; erro de save verificado no navegador |
| Mensagem não afirma exclusividade para agências | atendido | landing neutra + variantes `/agencias` e `/profissionais`; revisão de copy e guia de conteúdo |
| Jornadas J1/J2 definidas antes do schema | atendido | `docs/ux/JOURNEYS.md` e `docs/ux/WIREFRAMES.md` |
| Interface responsiva sem overflow horizontal | atendido no QA disponível | inspeção em iframe com viewport efetivo de 373 px e 751 px: `scrollWidth === clientWidth`; desktop 1917 px também sem overflow |
| Acessibilidade estrutural do protótipo | atendido tecnicamente | labels, `aria-describedby`, `aria-live`, foco visível, dialogs nativos com retorno de foco, ordem por botões, alvos ≥44 px, reduced motion; teste assistivo humano ainda recomendado |
| Design tokens e contraste AA | atendido | `globals.css`, `/proto/tokens`, razões sRGB documentadas; menor CTA de template 4,86:1 |
| Modelo e funções graduáveis testados | atendido | reducer/undo, URLs, WhatsApp, slug, templates, deep copy e aplicação sem perda em Vitest |
| Landing e waitlist prontas no repositório | atendido localmente | `/`, `/agencias`, `/profissionais`, `/privacidade`, server action, adapter, migração e data map; deploy/migração não executados |
| Qualidade automatizada | atendido | último `npm run check`: lint 0 warnings, typecheck, 18 testes, build e 14 rotas listadas |
| Demonstração em staging | não atendido | Vercel/Supabase/staging ainda não provisionados; pendência externa herdada da Sprint 0 |

## Entregáveis

| ID | Entrega | Evidência principal |
|---|---|---|
| D1 | Jornadas individual e agência | `docs/ux/JOURNEYS.md` |
| D2 | Wireframes mobile/desktop | `docs/ux/WIREFRAMES.md` |
| D3 | Protótipo clicável responsivo | `apps/web/src/app/proto/`, `apps/web/src/prototype/` |
| D4 | Tokens e componentes acessíveis | `apps/web/src/app/globals.css`, `apps/web/src/ui/`, `docs/ux/DESIGN_TOKENS.md` |
| D5 | Cinco templates tipados | `apps/web/src/modules/editor/templates/index.ts` |
| D6 | Linguagem de produto | `docs/ux/CONTENT_GUIDE.md`, `apps/web/src/content/pt-BR.ts` |
| D7 | Landing e waitlist | `apps/web/src/app/(marketing)/`, `apps/web/src/modules/waitlist/`, migração Supabase |
| D8 | Kit de pesquisa | `docs/research/INTERVIEW_SCRIPT.md`, `docs/research/USABILITY_TEST_PLAN.md` |
| D9 | Report, decisões, backlog e README | este relatório, `docs/ux/UX_DECISIONS.md`, `BACKLOG.md`, `README.md` |

## Validação executada

- `npm run check` em cinco gates da implementação e novamente antes deste relatório.
- Resultado técnico mais recente antes do relatório: ESLint com zero warnings; TypeScript sem erro; 4 arquivos/18 testes Vitest aprovados; build Next.js concluído.
- QA visual em navegador local nas rotas `/`, `/proto`, workspace e editor.
- Viewports efetivos: 373 px (iframe de 390 com scrollbar), 751 px (iframe de 768) e 1917 px desktop; sem overflow horizontal nos três.
- Árvore de acessibilidade conferida no índice, workspace e editor; controles têm nomes programáticos.
- Estado `Salvando…` → erro real do protótipo verificado com debug; a UI apresentou “Não foi possível salvar — tentar novamente” e registrou `error_shown`.
- Console não apresentou erro/hydration warning. Um aviso Next sobre smooth scrolling foi corrigido com `data-scroll-behavior="smooth"`.
- Contrastes foram recalculados por fórmula WCAG sRGB; o tema de evento foi escurecido de rosa para `#C21870`, elevando o CTA para 5,74:1.

## Segurança, privacidade e operação

- URLs perigosas `javascript:`, `data:`, `vbscript:` e `file:` são bloqueadas no modelo.
- Renderer usa apenas dados tipados e tokens do tema; não aceita JavaScript do usuário.
- Dados de protótipo e instrumentação ficam em `localStorage`; não há analytics de terceiros.
- Waitlist valida no servidor, usa honeypot + tempo mínimo e devolve a mesma resposta para e-mail duplicado.
- Consentimento LGPD começa desmarcado; PII nunca é escrita em logs pelo fluxo criado.
- Migração habilita RLS sem políticas anon/authenticated; apenas secret server-side deve escrever.
- Migração não foi executada e aviso de privacidade é explicitamente provisório.

## Implicações para a Sprint 2+

### Workspace e membership

- `workspace`: `id`, `name`, `kind` (`personal|agency`), `plan_id`, `profile_limit`, timestamps e estado.
- `membership`: `workspace_id`, `user_id`, `role` (`owner|admin|editor`), convite/aceite/expiração/revogação e audit trail.
- Todo perfil pertence explicitamente a um workspace; troca de contexto nunca altera autorização.

### Profile e publicação

- `profile`: `id`, `workspace_id`, `title`, `bio`, `slug`, `status` (`draft|published|pending|archived`), `plan/entitlements`, `published_at`, timestamps.
- “Pendente” significa draft divergente do snapshot publicado, não falha de save.
- Slug: lowercase, acentos removidos, hífens, 3–40 caracteres, unicidade normalizada e lista reservada versionada (`admin`, `api`, `app`, `login`, `logout`, `proto`, `p`, `r`, `suporte`, `privacidade`, `agencias`, `profissionais`).

### Blocos e tema

- Tipos: `link`, `text`, `social`, `whatsapp`, `pix`, `form`, `image`, `video`, `separator`.
- Campos comuns: `id`, `profile_id`, `type`, `position`, `visible`, `value_action`, conteúdo tipado e timestamps.
- URL normalizada e validada antes de persistir; WhatsApp armazena telefone canônico e mensagem separada.
- Pix armazena tipo/chave/link externo; nunca status de pagamento interno.
- Tema: `page_bg`, `page_text`, `page_muted`, font stacks permitidos, `button_bg`, `button_text`, `button_style`, `button_radius`, template de origem opcional.

### Template e duplicação

- `template`: identificador, nome, caso de uso, tema e blocos seed versionados.
- Aplicar em página com conteúdo preserva blocos; comportamento deve virar comando explícito.
- Duplicação é transação de cópia profunda com novos IDs; não replica métricas, domains, pixels ou report links.

### Relatório e analytics

- `report_link`: token com hash seguro, `workspace_id`, `profile_id`, período, `expires_at`, `revoked_at`, `created_by`, timestamps e escopo somente leitura.
- Consultas nunca retornam outros perfis ou configurações internas.
- Analytics precisa representar separadamente “nunca teve dado” e “zero no período”.
- Taxonomia inicial já contém eventos de ativação/publicação e `report_link_created`; eventos devem ganhar schema/versionamento na Sprint 6.

### Planos e entitlements

- UI requer limites de perfis, janela de analytics, badge da plataforma, domínio/pixels, equipe, templates e relatório compartilhável.
- Implementar entitlements explícitos; não condicionar regras pelo nome textual do plano.

## Perguntas para o founder

1. “Resultado” é o termo que devemos levar aos cinco testes ou quer uma variante A/B com “conversão”?
2. “Conta da agência” comunica melhor que “espaço” para o contexto multi-workspace?
3. Em página com conteúdo, template deve alterar apenas o tema (decisão atual) ou oferecer mesclagem opcional de blocos?
4. Relatórios devem expirar por padrão em 30, 60 ou 90 dias?
5. O link de agenda marcado pelo dono deve contar como resultado por padrão, como o modelo provisório sugere?
6. Os cinco templates cobrem a variedade desejada para o primeiro teste ou algum deve ser substituído?
7. A landing deve permanecer com codinome visível no primeiro piloto ou usar domínio/mensagem sem nome até a pesquisa de marca?

## Pendências, gaps e riscos

- Teste com cinco pessoas não executado; é a principal pendência e o gate estrutural antes da Sprint 2.
- Entrevistas e recrutamento foram preparados, não realizados.
- Landing não foi implantada; Supabase não foi provisionado e a migração não foi aplicada.
- Auth, publicação, analytics, upload, cobrança, domínio e pixels são simulações ou estão fora do escopo desta sprint.
- Aviso de privacidade requer revisão jurídica, canal real e definição de operadores antes de coleta externa.
- Componentes foram conferidos por árvore de acessibilidade e teclado estrutural, mas ainda precisam de teste com leitor de tela e usuários.
- A escolha livre de cores será problema da Sprint 5: templates padrão são AA, mas o seletor do protótipo não corrige contraste automaticamente.
- `localStorage` não representa concorrência, conflito de edição ou persistência real; não deve orientar decisões de backend além dos estados observados.

## Gate e próximo passo

Executar cinco sessões de `docs/research/USABILITY_TEST_PLAN.md`. Corrigir qualquer S3 e achados estruturais recorrentes; então confirmar/alterar as decisões provisórias e liberar o schema da Sprint 2.

## Resultado do último check registrado

```text
lint: aprovado, 0 warnings
typecheck: aprovado
test: 4 arquivos, 18 testes aprovados
build: aprovado, 14 rotas compiladas/listadas
```
