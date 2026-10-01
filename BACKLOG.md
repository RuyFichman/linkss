# Backlog executável

Convenção: `P0` bloqueia o MVP; `P1` pode ter versão simples; `P2` fica após lançamento. Ordem reflete dependências, não estimativa.

## Sprint 1 — protótipo

- [x] P0 Mapear cadastro → publicar → analytics.
- [x] P0 Mapear agência → perfil → duplicar → relatório.
- [x] P0 Criar wireframes mobile/desktop e protótipo clicável.
- [x] P0 Definir tokens visuais e estados de interface.
- [x] P1 Criar cinco templates conceituais.
- [x] P1 Implementar landing page e lista de espera (deploy externo permanece pendente).
- [ ] P1 Testar o protótipo com cinco pessoas.

## Sprint 2 — identidade e tenancy

Verificado no stack Supabase local (pgTAP + navegador); nada foi aplicado em projeto hospedado.

- [x] P0 Criar migrações de users/workspaces/memberships/profiles.
- [x] P0 Implementar RLS e testes de isolamento.
- [x] P0 Implementar auth, verificação e recuperação.
- [x] P0 Criar workspace individual no onboarding.
- [x] P0 Reservar, normalizar e validar slugs.
- [x] P1 Registrar auditoria de ações sensíveis (`profile.published` preparado para a Sprint 3).
- [ ] P0 Provisionar staging (Supabase + Vercel), aplicar migrações e configurar Auth conforme `docs/ENVIRONMENTS.md` — parcial: projeto Supabase criado, migrações aplicadas e deploy na Vercel no ar (`https://linkss-black.vercel.app`) em 2026-10-01; faltam o checklist de Auth e um teste de cadastro → publicação no ambiente hospedado.
- [ ] P0 Escolher e contratar SMTP para e-mails de Auth (ADR `MailAdapter`) e atualizar o mapa de dados.
- [ ] P1 Ativar CAPTCHA (Turnstile) no Auth antes do piloto externo.

## Sprint 3 — página pública

Verificado localmente (pgTAP + `next start` de produção + Lighthouse); nada provisionado. Relatório: `docs/SPRINT_3_REPORT.md`.

- [x] P0 Criar modelo de snapshot publicado.
- [x] P0 Implementar renderer público por slug.
- [x] P0 Publicar, invalidar cache e restaurar snapshot anterior.
- [x] P0 Adicionar metadados/OG/canonical e estados 404/suspenso.
- [x] P1 Instrumentar Web Vitals e erros (logs estruturados; Sentry/dashboards dependem de provisionamento).
- [ ] P0 Medir em staging (CDN real): publicação visível em ≤ 30 s, LCP/CLS de campo e prévia OG no WhatsApp/Instagram — staging já existe (`https://linkss-black.vercel.app`); a medição ainda não foi feita.
- [ ] P0 Trocar `NEXT_PUBLIC_APP_URL` e o Auth para o domínio comprado (checklist em `docs/ENVIRONMENTS.md`).
- [ ] P1 Rate limit/firewall para `/api/vitals` e para flood de endereços inexistentes no renderer (Sprint 9).

## Sprint 4 — editor

- [x] P0 CRUD, ordem, duplicação e visibilidade de blocos.
- [x] P0 Blocos link, texto, social, WhatsApp e separador.
- [x] P0 Autosave seguro e preview mobile.
- [x] P0 Validar URLs e bloquear esquemas perigosos.
- [x] P1 Undo de exclusão recente.
- [ ] P1 Validar com usuários reais (AC5: cinco blocos em < 10 min) — só proxy interno feito; depende das sessões de `docs/research/USABILITY_TEST_PLAN.md`.
- [ ] P2 Arrastar e soltar para reordenar (alternativa por botões já existe; UX-029).
- [ ] P2 Limpeza da coluna legada `profiles.social_links` (precisa de aprovação do founder).

## Sprint 5 — visual e mídia

Verificado no stack local (pgTAP + Vitest + navegador + Lighthouse em `next start`); nada aplicado em staging. Relatório: `docs/SPRINT_5_REPORT.md`.

- [x] P0 Implementar `StorageAdapter` e quota.
- [x] P0 Upload/otimização/remoção de imagens.
- [x] P0 Blocos imagem, embed, Pix e formulário.
- [x] P0 Temas e aplicação de template sem perda de conteúdo.
- [x] P1 Sanitização/allowlist de provedores de embed.
- [ ] P0 Aplicar a Sprint 5 em staging: `supabase db push`, segredo no Vault, variáveis na Vercel (passos em `docs/ENVIRONMENTS.md`) e medir LCP/CLS de campo numa página com imagens.
- [ ] P0 Agendar a limpeza de mídia órfã (`POST /api/jobs/media-cleanup`); hoje só roda à mão.
- [ ] P1 Pix "copia e cola" (BR Code) e QR code — cortados nesta sprint (ADR 0010).
- [ ] P1 Imagem de fundo no tema — cortada nesta sprint.
- [ ] P1 Aviso ao dono da página quando chega um contato (depende do SMTP).
- [ ] P1 Imagem Open Graph com o tema e a foto da página.
- [ ] P2 CAPTCHA no formulário público e limite global por IP (Sprint 9).
- [ ] P2 Purge agendado de leads vencidos e de `form_submission_hits` (Sprint 9; hoje acontece no envio seguinte à página).

## Sprint 6 — analytics

- [ ] P0 Definir taxonomia e contrato de eventos.
- [ ] P0 Ingestão não bloqueante, deduplicação e rate limit.
- [ ] P0 Retenção bruta de 7 dias e agregação diária.
- [ ] P0 Dashboard de visitas, ações, origem e blocos.
- [ ] P1 Filtros de bot/admin/preview e exportação CSV.

## Sprint 7 — agência

- [ ] P0 Gerenciar, buscar, arquivar e duplicar perfis.
- [ ] P0 Convites e papéis Owner/Admin/Editor.
- [ ] P0 Dashboard consolidado.
- [ ] P1 Relatório público revogável e com expiração.

## Sprint 8 — comercialização

- [ ] P0 Registrar ADR do provedor de pagamento.
- [ ] P0 Implementar `PaymentsAdapter` e webhooks idempotentes.
- [ ] P0 Criar planos/entitlements e estados de assinatura.
- [ ] P1 Domínio próprio com prova de controle.
- [ ] P1 Integrações Meta Pixel e GA sem scripts arbitrários.

## Sprint 9 — hardening

- [ ] P0 Exportação/exclusão e aceites versionados.
- [ ] P0 Denúncia, moderação, suspensão e auditoria.
- [ ] P0 Headers, CSP, rate limits e revisão de autorização.
- [ ] P0 Backup/restauração e runbooks.
- [ ] P0 QA mobile/cross-browser e acessibilidade prioritária.

## Débito/decisões abertas

- [ ] Rate limit próprio para Server Actions sensíveis (além dos limites do Supabase Auth) — Sprint 9.
- [ ] Confirmar decisões provisórias UX-013 a UX-019 (retenção de slug, papéis, limites).

- [ ] Selecionar nome público após busca de marca, domínio e redes.
- [ ] Comparar gateway por recorrência, Pix, cartão, webhooks, split, chargeback e conciliação.
- [ ] Definir momento de mover mídia para R2 com base em custo real (o `StorageAdapter` e a URL base configurável já existem; ADR 0009).
- [ ] Confirmar decisões provisórias UX-033 a UX-042 (limites de imagem, cotas, tema, modelos, Pix sem QR, retenção de leads).
- [ ] Definir datastore analítico após medir eventos/dia e custo no Postgres.
- [ ] Contratar revisão jurídica/contábil antes do beta pago.
