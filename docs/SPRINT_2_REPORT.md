# Relatório da Sprint 2

**Status:** implementada e verificada no ambiente local (Supabase local + navegador); nada provisionado ou aplicado em projeto hospedado
**Objetivo:** fundação segura de identidade, workspaces e modelo multi-tenant para pessoas e equipes
**Data:** 25/09/2026
**Branch:** `feat/sprint-2-identity-tenancy`, criada a partir de `feat/sprint-1-prototype` porque a Sprint 1 ainda não foi mesclada em `main`

## Resultado

Uma pessoa consegue se cadastrar, confirmar o e-mail, entrar, recuperar o acesso, receber automaticamente um workspace pessoal, criar uma página básica em rascunho (nome, endereço, bio e iniciais no lugar do avatar), editar, trocar o endereço, excluir e navegar pela área autenticada, inclusive criando uma conta de agência. O isolamento entre tenants é imposto no servidor e no banco e está provado por 163 asserções pgTAP, testes de autorização no servidor e um ataque manual com sessão real.

O gate de usabilidade da Sprint 1 **não** foi cumprido: a Sprint 2 começou por decisão explícita do founder (abaixo). Staging, SMTP hospedado e demonstração em staging continuam pendentes.

## Decisão de gate

```text
USABILITY_GATE: (b) FOUNDER OVERRIDE — iniciar a Sprint 2; o teste com cinco pessoas acontece depois.
  Decidido em: 25/09/2026, pelo founder.
  Motivo: construir a fundação de identidade/tenancy agora e rodar as sessões de usabilidade depois.
  Risco: achados estruturais podem exigir retrabalho de onboarding e vocabulário.
  Mitigação: textos/ordem do onboarding isolados em apps/web/src/content/pt-BR.ts e componentes de
  apresentação; schema com vocabulário neutro (workspace, profile, membership).
UX_DECISIONS confirmadas/alteradas: nenhuma.
```

Registrado também em `docs/ux/UX_DECISIONS.md` e em `AGENTS.md` §22.

## Decisões tomadas

Técnicas (ADRs em inglês):

- **ADR 0004 — tenancy e autorização:** tabelas, matriz owner/admin/editor, helpers RLS em schema `private` (`security definer`, `stable`, `search_path = ''`), RPCs estreitas para mutações sensíveis com auditoria na mesma transação, soft delete, entitlements tipados e contrato de SQLSTATEs.
- **Workspace pessoal por função idempotente**, não por trigger em `auth.users`: o cadastro nunca falha por causa do nosso schema e cadastros não confirmados não criam linhas de tenant. Falha → estado "Não foi possível preparar sua conta" com nova tentativa automática.
- **ADR 0005 — autenticação:** e-mail + senha, confirmação obrigatória, links `token_hash` em `/auth/confirm` (com fallback `code`), sessão por cookie com `@supabase/ssr`, identidade via `getClaims()`, allowlist de `next`, respostas neutras com piso de 900 ms, sign-out POST, encerramento global de sessões após redefinir senha. OAuth e MFA adiados.
- **ADR 0006 — testes de banco:** Supabase CLI fixada como devDependency, pgTAP via `supabase test db`, job de CI separado; `npm run check` continua sem Docker.
- Tabelas nunca são expostas implicitamente (`auto_expose_new_tables = false`), alinhado à mudança do Supabase de 2026-10-30.

Produto/UX (provisórias — founder confirmar): UX-013 a UX-019 em `docs/ux/UX_DECISIONS.md` (cadastro com confirmação obrigatória; onboarding mínimo; retenção de 90 dias para endereços; 30 dias para páginas excluídas; editor sem criar páginas/trocar endereço; máximo de 3 contas de agência por pessoa; páginas arquivadas contam no limite).

## Critérios de aceite

| # | Critério | Estado | Evidência |
|---|---|---|---|
| AC1 | Usuário não acessa dados de outro workspace manipulando URL ou payload | **verificado** | pgTAP `030-tenant-isolation` (35 asserções: leituras, escritas com `workspace_id` forjado, RPCs em alvos alheios, anon), `040-roles` (31: matriz de papéis, último owner, suspensão); Vitest `profiles/service.test.ts` e guard em `identity.test.ts` (id forjado → `not_found` sem tocar o repositório); navegador: URL do workspace/página de outro tenant → 404 neutro; ataque com sessão real contra a Data API: 15 payloads forjados, todos rejeitados (`42501`, `P0002`, `LK010`) e dados da outra conta intactos |
| AC2 | Slugs inválidos, reservados e duplicados rejeitados com mensagem clara | **verificado** | pgTAP `050-slugs` (24: formato, tamanho, reservados, duplicado com caixa/acento, retenção, troca, auditoria); Vitest `profiles/slug.test.ts` (paridade de normalização, mensagens, drift da lista reservada, todas as rotas reservadas); navegador: "Entrar" → "Este endereço é reservado…", disponibilidade em tempo real |
| AC3 | Recuperação expira e não revela se um e-mail existe | **verificado na aplicação; risco residual na API do Auth** | `otp_expiry = 3600` e uso único em `supabase/config.toml`; link reutilizado → "Link expirado ou inválido" no navegador; Vitest de respostas neutras e piso de tempo; navegador: mesma mensagem para e-mail existente e inexistente (cadastro e recuperação). **Porém** o endpoint público `/auth/v1/recover` do Supabase responde 429 para e-mail existente dentro da janela de 60 s e 200 para inexistente — mitigação: CAPTCHA do Auth antes do piloto (backlog) |
| AC4 | Exclusão lógica e política de retenção representadas no modelo | **verificado** | `deleted_at` + `purge_after` (check de par) em `user_accounts`, `workspaces`, `profiles`; RLS oculta linhas excluídas; pgTAP `070-soft-delete` (14); retenção e purge documentados em `docs/DATA_MAP.md` (job agendado só na Sprint 9 — **preparado**) |
| AC5 | Testes cobrem isolamento entre tenants e principais fluxos de autenticação | **verificado** | 9 arquivos / 163 asserções pgTAP; 9 arquivos / 92 testes Vitest; jornada completa no navegador (seção Validação) |
| — | Demonstração em staging (DoD do plano) | **não iniciado** | staging não provisionado; exige aprovação do founder |

## Entregáveis

| ID | Entrega | Onde revisar |
|---|---|---|
| D1 | ADRs 0004–0006 | `docs/adr/0004-tenancy-and-authorization.md`, `0005-authentication.md`, `0006-database-testing.md` |
| D2 | Migrações forward-only | `supabase/migrations/202609250002_identity_tenancy.sql`, `202609250003_profiles_and_slugs.sql`, `202609250004_waitlist_grants.sql`; tipos gerados em `apps/web/src/lib/database.types.ts` |
| D3 | Testes pgTAP + CI | `supabase/tests/database/*.test.sql`; `npm run test:db`; job `database` em `.github/workflows/ci.yml` |
| D4 | Autenticação | `apps/web/src/app/(auth)/*`, `apps/web/src/app/auth/confirm/route.ts`, `apps/web/src/proxy.ts`, `apps/web/src/modules/identity/actions.ts`, `apps/web/src/lib/supabase/*`, `supabase/config.toml`, `supabase/templates/*` |
| D5 | App autenticado e onboarding | `apps/web/src/app/app/**` (`/app`, `/app/comecar`, `/app/w/[workspaceId]`, `…/paginas/nova`, `…/paginas/[profileId]`, `/app/contas/nova`) |
| D6 | Módulos de domínio + Vitest | `apps/web/src/modules/identity`, `profiles`, `entitlements`, `audit`; `apps/web/src/lib/observability/logger.ts` |
| D7 | Documentação | `docs/ARCHITECTURE.md`, `DATA_MAP.md`, `THREAT_MODEL.md`, `ENVIRONMENTS.md`, `OBSERVABILITY.md`, `runbooks/AUTH_ACCESS.md`, `ux/CONTENT_GUIDE.md`, `ux/UX_DECISIONS.md`, `README.md`, `.env.example`, `BACKLOG.md`, `AGENTS.md` |

Modelo entregue: `user_accounts`, `workspaces`, `workspace_memberships`, `profiles`, `plans`, `plan_entitlements` (Free/Pro/Agência espelhando `product.ts`), `reserved_slugs`, `slug_history`, `audit_events`. RPCs: `ensure_personal_workspace`, `create_agency_workspace`, `soft_delete_workspace`, `change_member_role`, `remove_workspace_member`, `record_auth_event`, `check_slug_availability`, `change_profile_slug`, `soft_delete_profile`.

## Validação executada

### Resultado final registrado

```text
npm audit:      found 0 vulnerabilities
lint:           aprovado (eslint . --max-warnings=0)
typecheck:      aprovado (tsc --noEmit)
Vitest:         9 arquivos, 92 testes aprovados
pgTAP:          9 arquivos, 163 asserções aprovadas (Result: PASS)
advisors:       0 avisos de nível warn (security + performance)
build:          aprovado; 27 rotas (10 estáticas, 17 dinâmicas) + Proxy
tipos gerados:  sem diferença em relação ao schema local
```

### Inventário de testes

| Arquivo | Qtde | Cobre |
|---|---:|---|
| `000-setup-test-helpers` | 1 | instala helpers de teste |
| `010-structure` | 17 | tabelas, RLS em todo `public`, nenhum privilégio de `anon`, `search_path` fixo, RPCs fechadas para anon, catálogo de planos |
| `020-personal-workspace` | 14 | idempotência, e-mail não confirmado, conta de agência, limite de 3 |
| `030-tenant-isolation` | 35 | leituras/escritas/RPCs entre tenants, oráculo de limite, anon |
| `040-roles` | 31 | matriz de papéis, último owner, saída, workspace suspenso |
| `050-slugs` | 24 | normalização, formato, reservados, duplicados, retenção, auditoria |
| `060-entitlements` | 11 | Free = 1 página, arquivadas contam, upgrade só pelo servidor, Agência = 10 |
| `070-soft-delete` | 14 | ocultação por RLS, `purge_after`, histórico de slug, auditoria, conta excluída |
| `080-audit` | 16 | allowlist de metadados, append-only para authenticated/service_role/dono, anon |
| Vitest `identity.test.ts` | 42 | matriz, allowlist de redirect, validação, respostas neutras, piso de tempo, guard, nome da agência |
| Vitest `profiles/service.test.ts` | 13 | autorização dos comandos de página no servidor, limites, erros de slug, mapeamento SQLSTATE |
| Vitest `profiles/slug.test.ts` | 9 | normalização (paridade SQL), mensagens, drift da lista reservada, rotas reservadas |
| Vitest `entitlements.test.ts` | 5 | drift seed × `product.ts`, resolução fail-closed, assert sem nome de plano |
| Vitest `audit.test.ts` | 5 | redação de auditoria e logs |
| Vitest (Sprints 0–1: produto, editor, waitlist, métricas) | 18 | editor, waitlist, métricas, produto |

### Jornada no navegador (Supabase local + `next start`)

Cadastro com validação por campo e foco no primeiro erro → cadastro válido (mensagem neutra) → mesmo e-mail de novo (mesma mensagem, 1,29 s vs 1,21 s) → e-mail no Mailpit com link `token_hash` → confirmação → workspace pessoal criado → onboarding (endereço sugerido a partir do nome, "Entrar" rejeitado como reservado, disponibilidade verificada no servidor) → página criada como rascunho → lista com "1 de 1 página" e aviso de limite → configurações → troca de endereço com diálogo de aviso → sair → recuperar acesso (mesma mensagem para e-mail existente e inexistente) → link de recuperação → senhas diferentes (erro ligado por `aria-describedby`, foco) → nova senha (todas as sessões encerradas) → link reutilizado ("Link expirado ou inválido") → senha antiga ("E-mail ou senha incorretos.") → nova senha com `next=https://evil.example/app` (entrou em `/app`) → conta da agência criada (seletor, papel "Proprietário", estado vazio).

Ataque manual entre contas: URL do workspace e da página de outra pessoa → 404 neutro; 15 payloads forjados com a sessão real contra a Data API (ler, inserir com `workspace_id` alheio, atualizar, mover página, trocar slug direto, RPCs de slug/exclusão, auto-convite, upgrade de plano, segunda página no Free, forjar/apagar auditoria) → todos rejeitados, dados da outra conta intactos. Trilha registrou exatamente os eventos esperados (`auth.sign_in`, `auth.sign_out`, `auth.password_reset_completed`, `workspace.created`, `profile.slug_changed`) e os logs do servidor não continham e-mails.

Responsivo: sem overflow horizontal em 20 verificações das rotas de auth e 30 das rotas autenticadas (360, 390, 430, 768 e 1280 px, medidas por iframe). Diálogo fecha com Esc e devolve o foco ao gatilho.

Limitações da verificação: a janela automatizada do Chrome estava oculta (`visibilityState: hidden`), o que atrasou a hidratação e impediu redimensionar a janela; por isso os campos foram preenchidos por eventos DOM e a largura foi medida com iframes. Não houve teste com leitor de tela nem com pessoas.

### Defeitos encontrados e corrigidos durante a sprint

- Oráculo de existência: insert forjado em workspace alheio cheio respondia "limite atingido" (triggers rodam antes do `WITH CHECK`); agora autoriza primeiro e responde `42501`.
- Chamada repetida de `ensure_personal_workspace` batia no limite de assentos (triggers disparam antes do `ON CONFLICT`).
- Check constraint chamando função do schema `private` falhava com o papel do usuário.
- **Bug latente da Sprint 1:** sem exposição implícita, o `service_role` não tinha `INSERT` em `waitlist_signups`; corrigido por migração de grants (e `anon`/`authenticated` perderam privilégios residuais).
- Diálogos nativos não centralizavam por causa do reset do Tailwind (afeta também o protótipo).
- Logger descartava `errorCode` por casar com a chave sensível `code`.

## Segurança, privacidade, acessibilidade, performance e operação

- **Segurança:** ver `docs/THREAT_MODEL.md` (implementado × pendente). Secret key não é usada em nenhum caminho de usuário; o browser recebe só a publishable key.
- **Privacidade:** novos stores, finalidades e retenção em `docs/DATA_MAP.md`; auditoria sem e-mail/token/IP. Nenhum subprocessador novo.
- **Acessibilidade:** labels programáticos, erros com `aria-describedby`, foco no primeiro erro, `role="status"`/`alert`, foco visível, alvos ≥ 44 px, diálogos nativos com retorno de foco, estados não dependem só de cor. Sem teste assistivo humano.
- **Performance:** proxy só roda em rotas que precisam de sessão (marketing, protótipo, health e futuras páginas públicas ficam livres); listagens limitadas; consultas de RLS usam índice `(user_id, status, workspace_id)`.
- **Operação:** eventos e limiares em `docs/OBSERVABILITY.md`; runbook `docs/runbooks/AUTH_ACCESS.md`.

## Pendências, gaps e riscos

- **Teste de usabilidade com cinco pessoas não executado** (gate da Sprint 1, adiado pelo founder). Pode mudar onboarding e vocabulário.
- **Staging não provisionado**; migrações e configurações de Auth não aplicadas em projeto hospedado (requer aprovação).
- **SMTP hospedado:** projetos Free com SMTP padrão não aceitam templates customizados; o fluxo `token_hash` exige SMTP próprio (decisão de fornecedor pendente).
- **Enumeração pela API do Auth** (`/auth/v1/recover` 429 × 200): residual até ativar CAPTCHA.
- **Piso de tempo de 900 ms** calibrado localmente (envio real ≈ 230 ms no Mailpit); medir a latência do SMTP real em staging.
- **Links de e-mail por GET** podem ser consumidos por scanners corporativos; mitigação documentada na ADR 0005.
- Sem rate limit próprio nas Server Actions (limites do Auth cobrem login/cadastro/e-mails); previsto para a Sprint 9.
- MFA e login social adiados.
- Convites, lista de membros e troca de papel sem interface (modelo e RPCs prontos para a Sprint 7).
- `profile.published` definido e **preparado**; emitido só na Sprint 3.
- Job de purge **preparado** (documentado, não agendado).
- `docs/prompts/SPRINT_2_CLAUDE_PROMPT.md` permanece não rastreado, como no início da sprint.

## Perguntas para o founder

1. Confirma 90 dias de proteção para endereços liberados e 30 dias de recuperação para páginas excluídas?
2. Editor deve poder criar páginas em contas de agência (hoje não, porque consome o limite pago)?
3. Limite de 3 contas de agência por pessoa e "arquivadas contam no limite" estão adequados até a cobrança?
4. Aprova provisionar staging (Supabase + Vercel) e escolher o SMTP (Resend é o candidato) para os e-mails de autenticação?
5. Ativamos CAPTCHA (Turnstile) no cadastro/recuperação antes do piloto externo?
6. Quando serão as cinco sessões de usabilidade? Os achados podem reordenar o onboarding antes da Sprint 4.

## Implicações para a Sprint 3

- Publicar deve ser uma RPC/job que exige `profile.publish` (owner/admin/editor), grava snapshot imutável, atualiza `status`/`published_at` e emite `profile.published` na mesma transação.
- O renderer público lerá snapshots por `slug` sem sessão: criar uma superfície própria (tabela/visão de snapshots publicada) com política `anon` explícita — as tabelas de tenant continuam sem nenhum acesso `anon`.
- A retenção de slugs já protege endereços publicados que mudarem; o renderer deve responder 404/"endereço mudou" conforme decisão de UX.
- Workspace suspenso já bloqueia escrita; o renderer precisa decidir o estado "perfil suspenso".
- Adicionar ao `reserved_slugs` (nova migração + lista TS) qualquer rota nova de nível superior; o teste falha se esquecer.

## Resultado do último check registrado

```text
npm audit: 0 vulnerabilities
lint: aprovado, 0 warnings
typecheck: aprovado
test: 9 arquivos, 92 testes aprovados
test:db: 9 arquivos, 163 asserções aprovadas
build: aprovado, 27 rotas + Proxy
```
