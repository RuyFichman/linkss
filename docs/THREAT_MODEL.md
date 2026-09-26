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

## Requisitos antes do MVP privado

- headers de segurança e CSP;
- RLS em todas as tabelas expostas — **feito para as tabelas da Sprint 2**;
- testes de isolamento por workspace — **feito (pgTAP + Vitest)**;
- rate limits para auth, formulário, upload e ingestão — Auth configurado localmente; demais pendentes;
- CAPTCHA no Auth para fechar a enumeração direta pela API;
- trilha para publicação, domínio, papéis e suspensão — papéis/slug/exclusão/publicação/restauração/despublicação feitos; domínio e suspensão pendentes;
- backup e restauração testados;
- processo de denúncia e contato de segurança.
