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

## Requisitos antes do MVP privado

- headers de segurança e CSP;
- RLS em todas as tabelas expostas — **feito para as tabelas da Sprint 2**;
- testes de isolamento por workspace — **feito (pgTAP + Vitest)**;
- rate limits para auth, formulário, upload e ingestão — Auth configurado localmente; demais pendentes;
- CAPTCHA no Auth para fechar a enumeração direta pela API;
- trilha para publicação, domínio, papéis e suspensão — papéis/slug/exclusão feitos; publicação preparada;
- backup e restauração testados;
- processo de denúncia e contato de segurança.
