# Relatório da Sprint 3

**Status:** implementada e verificada no ambiente local (Supabase local + `next start` de produção); nada provisionado ou aplicado em projeto hospedado, e o domínio público ainda não foi comprado
**Objetivo:** colocar a primeira página real no ar: renderer público por endereço, snapshot de publicação, invalidação de cache, rollback, metadados e estados de erro
**Data:** 26/09/2026
**Branch:** `feat/sprint-3-public-renderer`, criada a partir de `main` depois do merge das Sprints 1 e 2 (PRs #3 e #4)

## Resultado

Uma pessoa edita o rascunho da página (nome, apresentação, redes sociais e links), vê a prévia, publica, abre a página pública em `/<endereço>`, restaura uma versão anterior e tira a página do ar. A página pública é HTML servido de um snapshot imutável e cacheado (ISR). A publicação invalida o cache na hora; editar o rascunho não afeta o que está no ar. Endereços inexistentes e não publicados respondem 404; workspaces suspensos mostram "Página indisponível"; endereços trocados redirecionam durante a retenção. A página funciona com todo o JavaScript bloqueado.

Tudo foi validado localmente. Como o domínio só será comprado no próximo mês, a origem pública vem de `NEXT_PUBLIC_APP_URL`: a verificação usou `http://localhost:3100`, e trocar para o domínio é configuração + novo deploy (checklist em `docs/ENVIRONMENTS.md`).

## Decisões tomadas

Técnicas (ADR 0007, em inglês):

- **Rascunho como documento em `profiles`** (`social_links`, `blocks` jsonb + `draft_revision` com controle otimista). O banco valida formato, esquemas de URL e hosts das redes mesmo em escrita direta pela Data API (`LK040`).
- **Snapshots imutáveis** em `profile_publications`, com ponteiro `profiles.live_publication_id` (FK composta impede apontar para snapshot de outra página) e 10 versões retidas (*provisório*).
- **RPCs auditadas:** `publish_profile` (idempotente; recusa revisão desatualizada com `LK030`), `restore_profile_publication` (rollback sem mexer no rascunho), `unpublish_profile`. Autorização no servidor antes (`profile.publish`) e de novo no banco.
- **Superfície anônima mínima:** `anon` continua sem privilégio em tabelas; a única função anônima é `get_public_page(slug)`, por endereço exato (não permite listar páginas).
- **ISR sob demanda** em `/[slug]` e `/[slug]/opengraph-image` (`revalidate = 60` só como fallback), `revalidatePath` em publicar/restaurar/tirar do ar/trocar endereço/excluir, timeout de 4 s na consulta pública.
- **Redirect canônico no `proxy`** apenas para segmentos com maiúscula ou `%`: variantes de grafia nunca entram no cache e páginas canônicas nunca executam o proxy.
- **Observabilidade sem novo fornecedor:** `onRequestError` (template da rota, nunca o caminho), eventos `public_page.*` e `publishing.*`, Web Vitals próprios em `/api/vitals` com allowlist de campos.

Produto/UX (provisórias, founder confirmar): UX-020 a UX-025 em `docs/ux/UX_DECISIONS.md`. São elas: redirect do endereço antigo durante a retenção; não publicada = mesmo 404; "indisponível" para suspensas; publicação explícita com rollback de 10 versões; editor mínimo de links/redes até a Sprint 4; selo "Criado com Projeto LNK" pelo entitlement `remove_badge`. Formato do endereço: **raiz do domínio** (`dominio/endereco`), decidido pelo founder em 26/09/2026.

## Critérios de aceite

| # | Critério | Estado | Evidência |
|---|---|---|---|
| AC1 | Alterações em draft não afetam a página até a publicação | **verificado** | pgTAP `090` (edição após publicar não muda o snapshot) e `095` (anon recebe o snapshot, não o rascunho); jornada pelas Server Actions reais: bio alterada no rascunho → página pública com a bio antiga e painel "Publicar alterações" |
| AC2 | Publicar torna a versão nova visível em até 30 segundos | **verificado localmente**; **em CDN real: pendente** (sem ambiente hospedado) | Server Action de publicar → versão nova servida em ~0,5 s (primeiro ciclo de consulta; ação em 0,06–0,08 s); fallback sem invalidação (publicação direta pela RPC) apareceu em 30 s, limite teórico 60 s |
| AC3 | Rollback restaura a última versão publicada funcional | **verificado** | pgTAP `090` (restaura v1, ponteiro, rascunho intacto, auditoria); jornada: "Restaurar a versão 1" → página pública voltou à v1 em ~0,5 s |
| AC4 | Meta em teste controlado: LCP ≤ 2,5 s e CLS ≤ 0,1 em mobile | **verificado em laboratório (local)**; dados de campo pendentes | Lighthouse 12 mobile (Moto G emulado, 4G lento, CPU 4×), 3 execuções: LCP 2,3 / 2,4 / 2,3 s, CLS 0, Performance 97–98, Acessibilidade 100, SEO 100. **Folga pequena** (≈ 0,1–0,2 s). Primeira medição deu LCP 3,5 s porque o antivírus Kaspersky desta máquina injeta um script bloqueante de 184 KB em toda página HTTP; as medições válidas bloquearam só esse domínio |
| AC5 | HTML principal utilizável mesmo se o script de analytics falhar | **verificado** | Lighthouse com os 10 scripts da aplicação e `/api/vitals` bloqueados: página completa (cabeçalho, ícones, links, selo), LCP 1,4 s, CLS 0; links são `<a href>` simples no HTML servido |
| — | Rota pública por slug | **verificado** | `app/[slug]/page.tsx`; curl e Lighthouse em `/ana-lima` |
| — | Snapshot de publicação e invalidação de cache | **verificado** | pgTAP `090`; `x-nextjs-cache` HIT → MISS após publicar |
| — | Cabeçalho com avatar, nome, bio e ícones sociais | **verificado** (avatar = iniciais até o upload da Sprint 5) | captura sem JS; `public-page-view.tsx` |
| — | Bloco de link básico | **verificado** | pgTAP (validação), jornada (adicionar, editar, remover, ordenar), página pública |
| — | Título, descrição, canonical e preview Open Graph | **verificado localmente**; prévia real em WhatsApp/Instagram **pendente** (esses apps não acessam `localhost`) | HTML: `<title>`, `description`, `canonical`, `og:*`, `twitter:card`, `robots index`; imagem OG 1200×630 gerada com acentos corretos |
| — | Página 404, perfil suspenso e conteúdo não publicado | **verificado** | pgTAP `095` (todos os estados); curl: inexistente/não publicado → 404, grafia variante → 308, `favicon.ico` → 404 sem consulta |
| — | Instrumentação de performance e erros do renderer | **implementado + verificado localmente**; Sentry e dashboards **pendentes** | beacons reais do Lighthouse registrados como `web_vital`; queda simulada do banco gerou `public_page.lookup_failed` + `request.error` |

## Entregáveis

| ID | Entrega | Onde revisar |
|---|---|---|
| D1 | ADR 0007 | `docs/adr/0007-publishing-and-public-renderer.md` |
| D2 | Migrações | `supabase/migrations/202609260001_publication_audit_actions.sql`, `202609260002_publishing.sql`; tipos em `apps/web/src/lib/database.types.ts` |
| D3 | Testes de banco | `supabase/tests/database/090-publishing.test.sql`, `095-public-page.test.sql`, `010-structure.test.sql` atualizado |
| D4 | Renderer público | `apps/web/src/app/[slug]/page.tsx`, `opengraph-image.tsx`, `error.tsx`; `app/not-found.tsx`, `app/robots.ts`, `app/icon.svg`; `modules/publishing/render/*` |
| D5 | Publicação | `modules/publishing/{service,supabase-repository,actions,cache,server,public-page,document,metadata,route-slug,social}.ts`; painel `modules/publishing/components/*` |
| D6 | Rascunho | `modules/profiles/draft-content.ts`, comandos em `profiles/service.ts`/`actions.ts`, formulários `social-links-form.tsx`, `link-*.tsx`; prévia em `/app/w/[workspaceId]/paginas/[profileId]/previa` |
| D7 | Observabilidade | `apps/web/src/instrumentation.ts`, `app/api/vitals/route.ts`, `lib/observability/web-vitals.ts`, `modules/publishing/components/web-vitals-reporter.tsx` |
| D8 | Documentação | `docs/ARCHITECTURE.md`, `DATA_MAP.md`, `THREAT_MODEL.md`, `OBSERVABILITY.md`, `ENVIRONMENTS.md`, `runbooks/PUBLIC_PAGE.md`, `ux/UX_DECISIONS.md`, `BACKLOG.md`, `README.md`, `AGENTS.md` |

## Validação executada

### Resultado final registrado

```text
npm audit:      found 0 vulnerabilities
lint:           aprovado (eslint . --max-warnings=0)
typecheck:      aprovado (tsc --noEmit)
Vitest:         12 arquivos, 127 testes aprovados
pgTAP:          11 arquivos, 231 asserções aprovadas (Result: PASS, banco recém-resetado)
advisors:       nenhum problema (security + performance, nível warn)
build:          aprovado; 33 rotas (12 estáticas, 2 ISR, 19 dinâmicas) + Proxy
tipos gerados:  regenerados; iguais ao schema local
```

### Novos testes

| Arquivo | Qtde | Cobre |
|---|---:|---|
| pgTAP `090-publishing` | 43 | validação do rascunho no banco (esquemas, hosts, userinfo, chaves extras, ids duplicados, `@` no caminho), colunas não graváveis, publicar como editor, idempotência, snapshot sem blocos ocultos e sem ids de tenant, rascunho não vaza, `LK030`, imutabilidade (inclusive para o dono da tabela), FK composta, tentativas entre tenants, rollback, despublicar idempotente, retenção de 10 versões, auditoria, workspace suspenso, anon |
| pgTAP `095-public-page` | 22 | todos os estados (`published`, `moved`, `unpublished`, `suspended`, `not_found`), normalização, selo por entitlement, anon sem leitura de tabelas, despublicada/suspensa/excluída não redirecionam, fim da retenção |
| pgTAP `010-structure` | +3 | nova tabela, novas RPCs fechadas para anon, `get_public_page` é a única função anônima e é `stable security definer` |
| Vitest `publishing.test.ts` | 22 | divergência hosts SQL × TS, normalização de redes, documento publicado (descarta links perigosos), prévia = documento do banco, slug da rota, estados, metadados/canonical, autorização do serviço, mapeamento de erros, estado exibido |
| Vitest `draft-content.test.ts` | 10 | validação de links (`tel:` normalizado, `javascript:` rejeitado), formulário de redes, leitores tolerantes, comandos de rascunho (autorização, id desconhecido, conflito) |
| Vitest `web-vitals.test.ts` | 3 | allowlist do payload e descarte de campos extras |

O teste de rotas reservadas passou a ignorar segmentos dinâmicos (`[slug]` é o próprio renderer).

### Jornada ponta a ponta (Server Actions reais + renderer)

Servidor de produção (`next build && next start`, porta 3100, `NEXT_PUBLIC_APP_URL=http://localhost:3100`) contra o Supabase local. Login e criação da página pela interface. As ações seguintes enviaram os formulários reais das Server Actions como um navegador sem JavaScript (campos `$ACTION_*` renderizados pelo React), com o cookie de sessão SSR da Ana:

1. rascunho editado → página pública inalterada, painel "Publicar alterações";
2. publicar com revisão antiga → "O rascunho mudou desde que você abriu esta tela…";
3. publicar → "Página publicada (versão 6)…", visível em ~0,5 s;
4. restaurar v1 → visível em ~0,5 s;
5. rede social com host falso → "Este link não é do Instagram…"; link `javascript:` → "Este tipo de endereço não é permitido."; link válido adicionado;
6. Bia reenviando o formulário de publicação da Ana com a própria sessão → "Não encontramos este item…" e página intacta;
7. tirar do ar → 404 em ~0,5 s;
8. publicar de novo → versão nova no ar.

Também pela Data API, com a sessão real: `javascript:` → `LK040`; alterar `status` diretamente → `42501`; publicar duas vezes → segunda chamada `created: false`.

Telas autenticadas auditadas com Lighthouse (cookie de sessão real, JavaScript ativo): configurações e prévia com **Acessibilidade 100**; capturas de página inteira em 412 px revisadas (estados, versões com horário de São Paulo, formulários, prévia).

Resiliência (gateway do Supabase local pausado): página já em cache seguiu respondendo 200 (`STALE`, 5 ms); página nova respondeu 500 com a tela de erro em 4,05 s (antes da correção, ficava pendurada mais de 20 s); logs `public_page.lookup_failed` e `request.error` com template da rota; recuperação automática ao religar.

Logs: nenhum e-mail no log do servidor; `web_vital` sem URL mesmo quando o payload enviado continha `url` com token.

### Limitações da verificação

- A janela do Chrome controlada pela extensão estava oculta (`visibilityState: hidden`), como na Sprint 2. O Chrome congelou a aba e os cliques interativos não puderam ser observados. Por isso: login e criação da página foram feitos por eventos DOM; as ações seguintes, por envio sem JavaScript dos formulários reais; a interface com JavaScript foi verificada por Lighthouse headless (acessibilidade + capturas). **Não foram observados manualmente:** estado de carregamento dos botões, abertura/foco dos diálogos "Tirar do ar" e de edição de link, e o reset do formulário após adicionar link.
- Medições locais, sem CDN. O critério de 30 s em CDN real e as Web Vitals de campo (p75) dependem de staging.
- Sem teste com leitor de tela nem com pessoas.
- No Windows/macOS, o cache de arquivos do `next start` não diferencia maiúsculas: `/Ana-Lima` chegou a ser servido pela entrada de `/ana-lima`. O redirect no proxy eliminou o caso; na Vercel (Linux) o problema não existe.
- O banco local foi resetado depois da jornada: o teste `030` da Sprint 2 usa o endereço `ana-lima`, que a jornada tinha ocupado. O CI parte sempre de banco limpo.

### Defeitos encontrados e corrigidos durante a sprint

- Gatilho de validação sem `security definer` não conseguia chamar funções do schema `private` (`42501`).
- Regex de URL social proibia `@` em todo o endereço, o que quebraria `tiktok.com/@perfil`; agora só é proibido na parte de host.
- Consulta pública sem timeout deixava visitantes esperando mais de 20 s com o banco fora; agora falha em 4 s.
- Variantes de grafia viravam entradas de cache e, no Windows, colidiam com a canônica; redirect movido para o proxy.
- Faltavam `metadataBase` (aviso do Next) e ícone (404 de `favicon.ico` em toda visita).
- Link oculto aparecia no editor sem indicação; agora tem o selo "Oculto: não aparece na página".
- Texto desatualizado da Sprint 2 dizia que a publicação "chega na próxima etapa".

## Segurança, privacidade, acessibilidade, performance e operação

- **Segurança:** controles e evidências em `docs/THREAT_MODEL.md` (seção Sprint 3). Nenhuma chave secreta é usada: o renderer usa a publishable key como `anon`, e os comandos usam a sessão do usuário.
- **Privacidade:** `docs/DATA_MAP.md` (snapshots, cache, logs). Nenhum subprocessador novo. Prévias já geradas por apps de terceiros ficam fora do nosso controle (mencionar na política de privacidade).
- **Acessibilidade:** landmarks (`main`, `nav` "Redes sociais"/"Links"), nome acessível nos ícones sociais, alvos ≥ 44 px, estados por texto (não só cor), `aria-describedby` nos formulários, Lighthouse 100 nas telas públicas e autenticadas auditadas.
- **Performance:** uma RPC por regeneração, não por visita; página sem cookies, cacheável na CDN; ~174 KB transferidos no total, dos quais o JavaScript é o runtime do Next (a página não depende dele).
- **Operação:** sinais e limiares em `docs/OBSERVABILITY.md`; runbook `docs/runbooks/PUBLIC_PAGE.md` (publicação que não aparece, rollback, erro 500, denúncia de phishing, Web Vitals).

## Pendências, gaps e riscos

- **Staging/Vercel não provisionados:** o critério de 30 s em CDN real, a prévia OG em WhatsApp/Instagram e as Web Vitals de campo continuam **pendentes**. Um endereço `*.vercel.app` basta; o domínio não é necessário.
- **Folga pequena no LCP** (2,3–2,4 s × meta 2,5 s em laboratório). Candidatos se piorar: reduzir o runtime carregado na página pública, avaliar Cache Components/PPR e medir em campo antes de otimizar.
- **Flood de endereços inexistentes** gera regenerações ISR (custo) e **`/api/vitals` sem rate limit**: firewall/rate limit antes do lançamento aberto (Sprint 9).
- **Denúncia e moderação por página** não existem; a suspensão hoje é por workspace e manual (runbook).
- **Sentry, monitor de uptime e dashboards** não provisionados (logs estruturados prontos).
- Suspensão e exclusão de workspace feitas fora do app dependem do fallback de 60 s para sair do cache.
- Editor mínimo de links/redes é provisório: visibilidade, duplicar, autosave e outros tipos de bloco ficam para a Sprint 4.
- Avatar continua como iniciais (upload na Sprint 5).
- Pendências herdadas: teste de usabilidade com cinco pessoas, SMTP, CAPTCHA do Auth, staging.

## Perguntas para o founder

1. Confirma o redirect do endereço antigo por 90 dias (UX-020) e o mesmo 404 para página não publicada (UX-021)?
2. 10 versões retidas por página estão adequadas (UX-023)?
3. Aprova provisionar staging (Supabase Free + Vercel com URL `*.vercel.app`) para medir o renderer em CDN real antes do domínio?
4. O selo "Criado com Projeto LNK" nos planos sem `remove_badge` está aprovado (UX-025)?

## Implicações para a Sprint 4

- O editor de blocos substitui `LinkListEditor`/`SocialLinksForm` e estende, juntos: `private.validate_profile_draft`, `draft-content.ts`, `document.ts` (subir `schemaVersion` se a forma mudar), o renderer e os dois conjuntos de testes.
- Autosave deve usar `draft_revision` (já existe) e tratar `conflict`; a publicação já exige a revisão revisada (`LK030`).
- Visibilidade de bloco já existe no modelo (`visible`) e é respeitada pelo snapshot e pela prévia.
- Toda nova rota de nível superior continua exigindo entrada em `reserved_slugs` (migração + lista TS).

## Resultado do último check registrado

```text
npm audit: 0 vulnerabilities
lint: aprovado, 0 warnings
typecheck: aprovado
test: 12 arquivos, 127 testes aprovados
test:db: 11 arquivos, 231 asserções aprovadas
build: aprovado, 33 rotas + Proxy
```
