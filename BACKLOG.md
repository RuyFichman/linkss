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
- [ ] P0 Provisionar staging (Supabase + Vercel), aplicar migrações e configurar Auth conforme `docs/ENVIRONMENTS.md` — parcial: projeto Supabase criado, migrações aplicadas e deploy na Vercel no ar (`https://linkss-black.vercel.app`) em 2026-10-01; o founder fez cadastro → publicação no ambiente hospedado em 2026-10-02; falta o checklist de Auth.
- [ ] P0 Escolher e contratar SMTP para e-mails de Auth (ADR `MailAdapter`) e atualizar o mapa de dados. **Escolhido pelo founder em 11/10/2026: Resend.** Falta criar a conta, os registros DNS (SPF/DKIM), configurar no Supabase Auth e atualizar o mapa de dados.
- [ ] P1 Ativar CAPTCHA (Turnstile) no Auth antes do piloto externo. O formulário já envia o token quando o ambiente tem a chave (ADR 0018, 11/10/2026); **falta o founder criar o widget na Cloudflare, pôr a chave na Vercel e ligar no Supabase, nessa ordem** (`docs/ENVIRONMENTS.md`).

## Sprint 3 — página pública

Verificado localmente (pgTAP + `next start` de produção + Lighthouse); nada provisionado. Relatório: `docs/SPRINT_3_REPORT.md`.

- [x] P0 Criar modelo de snapshot publicado.
- [x] P0 Implementar renderer público por slug.
- [x] P0 Publicar, invalidar cache e restaurar snapshot anterior.
- [x] P0 Adicionar metadados/OG/canonical e estados 404/suspenso.
- [x] P1 Instrumentar Web Vitals e erros (logs estruturados; Sentry/dashboards dependem de provisionamento).
- [ ] P0 Medir em staging (CDN real): publicação visível em ≤ 30 s, LCP/CLS de campo e prévia OG no WhatsApp/Instagram — parcial em 2026-10-02 (`docs/SPRINT_5_REPORT.md`, "Verificações no staging depois da correção"): publicação visível em ~5 s e prévia OG conferida nos dois apps; os logs `web_vital` ficaram dentro da meta, mas só com acessos do founder e Lighthouse. Falta LCP/CLS de visitantes reais.
- [ ] P0 Trocar `NEXT_PUBLIC_APP_URL` e o Auth para o domínio comprado (checklist em `docs/ENVIRONMENTS.md`). `NEXT_PUBLIC_APP_URL` já é `https://linkfav.com` (conferido em 10/10/2026); **falta confirmar Site URL e Redirect URL do Auth**, que nesse dia ainda apontavam para `linkss-black.vercel.app`.
- [ ] P1 Rate limit/firewall para `/api/vitals` e para flood de endereços inexistentes no renderer (Sprint 9). `/api/vitals` ganhou limite por instância em 11/10/2026; **o renderer depende da regra do firewall da Vercel, ainda não criada** (`docs/runbooks/RATE_LIMITS.md`).

## Sprint 4 — editor

- [x] P0 CRUD, ordem, duplicação e visibilidade de blocos.
- [x] P0 Blocos link, texto, social, WhatsApp e separador.
- [x] P0 Autosave seguro e preview mobile.
- [x] P0 Validar URLs e bloquear esquemas perigosos.
- [x] P1 Undo de exclusão recente.
- [x] P1 Melhorar a edição no celular (pedido do founder em 09/10/2026, UX-085): navegação inferior, formulários em tela cheia, prévia preservando o formulário e ajuste ao teclado; revisão em `docs/ux/MOBILE_EDITOR_REVIEW.md`.
- [ ] P1 Conferir a UX-085 em iOS/Android reais e navegadores embutidos; validar novamente em staging. O primeiro uso no iPhone após a PR #24 revelou o editor preso na área reduzida pelo teclado ao tocar em Concluir; a correção precisa de reteste no aparelho.
- [ ] P1 Validar com usuários reais (AC5: cinco blocos em < 10 min) — só proxy interno feito; depende das sessões de `docs/research/USABILITY_TEST_PLAN.md`.
- [ ] P2 Arrastar e soltar para reordenar (alternativa por botões já existe; UX-029).
- [ ] P2 Limpeza da coluna legada `profiles.social_links` (precisa de aprovação do founder).

## Sprint 5 — visual e mídia

Verificado no stack local (pgTAP + Vitest + navegador + Lighthouse em `next start`); aplicado em staging em 2026-10-02. Relatório: `docs/SPRINT_5_REPORT.md`.

- [x] P0 Implementar `StorageAdapter` e quota.
- [x] P0 Upload/otimização/remoção de imagens.
- [x] P0 Blocos imagem, embed, Pix e formulário.
- [x] P0 Temas e aplicação de template sem perda de conteúdo.
- [x] P1 Sanitização/allowlist de provedores de embed.
- [x] P0 Aplicar a Sprint 5 em staging: `supabase db push`, segredo no Vault e variáveis na Vercel, em 2026-10-02 (a medição de campo segue no item da Sprint 3).
- [x] P0 Agendar a limpeza de mídia órfã: Vercel Cron diário (`GET /api/jobs/media-cleanup`, `apps/web/vercel.json`), em 02/10/2026.
- [ ] P1 Pix "copia e cola" (BR Code) e QR code — cortados nesta sprint (ADR 0010).
- [ ] P1 Imagem de fundo no tema — cortada nesta sprint.
- [ ] P1 Aviso ao dono da página quando chega um contato (depende do SMTP).
- [ ] P1 Imagem Open Graph com o tema e a foto da página.
- [ ] P2 CAPTCHA no formulário público e limite global por IP (Sprint 9). Limite por instância no envio desde 11/10/2026; CAPTCHA no formulário não feito; o limite global é a regra do firewall.
- [x] P2 Purge agendado de leads vencidos e de `form_submission_hits` (job `/api/jobs/retention`, 11/10/2026). Código, testes e runbook prontos em 11/10/2026 (ADR 0018), verificados só no stack local. **Migração não aplicada em produção.**

## Sprint 6 — analytics

Verificado no stack local (pgTAP + Vitest + navegador + teste de precisão + Lighthouse em `next start`); mergeada em `main` (PR #16, 02/10/2026) e **aplicada em staging, confirmada pelo founder em 06/10/2026**. Relatório: `docs/SPRINT_6_REPORT.md`.

- [x] P0 Definir taxonomia e contrato de eventos (ADR 0011).
- [x] P0 Ingestão não bloqueante, deduplicação e rate limit.
- [x] P0 Retenção bruta de 7 dias e agregação diária.
- [x] P0 Dashboard de visitas, ações, origem e blocos.
- [x] P1 Filtros de bot/admin/preview e exportação CSV.
- [x] P0 Aplicar a Sprint 6 em staging: `supabase db push`, segredo `analytics_signing_secret` no Vault, `ANALYTICS_SIGNING_SECRET` na Vercel e merge (passos em `docs/ENVIRONMENTS.md`). Em 06/10/2026 o job manual respondeu `ok` e o founder relatou visita e clique aparecendo em *Resultados*.
- [ ] P1 Conferir a primeira execução agendada do cron de analytics com sucesso (log `analytics.maintenance` com `outcome=ok` e `lastFinalDay` preenchido) e os dois crons em *Vercel → Settings → Cron Jobs*.
- [ ] P1 Região (UF) das visitas — cortada nesta sprint (primeiro item da lista de cortes).
- [ ] P1 Abrir o CSV exportado numa planilha (Excel/Google Sheets) e conferir acentos e colunas — só o conteúdo foi conferido.
- [ ] P1 Medir em campo a perda de eventos em navegadores embutidos (Instagram, TikTok, WhatsApp).
- [ ] P2 Clique em imagem (o bloco de imagem ainda não tem link).
- [ ] P2 Rever os limites de ingestão com tráfego real (60 por endereço por página em 10 min pode ser baixo para páginas populares atrás de CGNAT).

## Sprint 7 — agência

**Concluída no stack local em 06/10/2026** (pgTAP + Vitest + navegador), na branch `feat/sprint-7-agency`. Em staging: as migrações da parte 1 foram aplicadas pelo founder; as da parte 2 e o merge estão pendentes. Relatório: `docs/SPRINT_7_REPORT.md`.

- [x] P0 Gerenciar, buscar, arquivar e duplicar perfis (ADR 0012).
- [x] P0 Convites e papéis Owner/Admin/Editor (ADR 0012).
- [x] P0 Dashboard consolidado, com exportação CSV (ADR 0013).
- [x] P1 Relatório público revogável e com expiração (ADR 0013).
- [x] P0 Medir a criação da décima página e a lista com 1, 10 e 50 páginas (AC5; `apps/web/scripts/agency-scale.mjs`).
- [ ] P0 Fechar a Sprint 7 em staging: `supabase db push` das duas migrações da parte 2 (`202610060003`, `202610060004`), enviar a branch, abrir e fazer o merge do PR, pôr a conta de teste no plano Agência por SQL e conferir um link de relatório de ponta a ponta (passos em `docs/ENVIRONMENTS.md`).
- [ ] P1 Limite global (firewall/rate limit) na frente de `/r/` e da RPC do relatório (Sprint 9). `/r/` ganhou limite por instância em 11/10/2026; a RPC chamada direto e o limite global seguem dependendo do firewall.
- [x] P1 Expurgo agendado de links de relatório terminados há mais de 90 dias e dos contadores de tentativas (job `/api/jobs/retention`, 11/10/2026). Código, testes e runbook prontos em 11/10/2026 (ADR 0018), verificados só no stack local.
- [x] P1 Incluir `report_links` na exportação e na exclusão de conta (exportação na Sprint 9; exclusão em 11/10/2026, por cascata da conta).
- [ ] P2 Conferir no celular real e imprimir o relatório do cliente (nesta sprint: larguras de 360 a 768 px por medição para as telas da conta; o relatório só em desktop, com as regras de impressão presentes na folha de estilo).
- [ ] P2 Página 404 do relatório sem JavaScript fica em branco (o framework renderiza o estado no cliente); avaliar uma resposta estática.
- [ ] P2 Relatório com intervalo fixo de datas ("setembro") e campanha (UTM), se as agências do piloto pedirem.
- [ ] P1 Lembrar a última conta usada em `/app` — cortado na parte 1 (UX-060).
- [ ] P1 Levar o `next` do convite no modelo de e-mail de confirmação do Auth, para o cadastro por convite funcionar em outro aparelho (hoje só no mesmo, por cookie).
- [ ] P2 Expurgo agendado de convites terminados há mais de 30 dias e limite global nas ações de convite (Sprint 9). Expurgo feito em 11/10/2026 (job `/api/jobs/retention`); **limite global nas ações de convite não feito**.
- [ ] P2 Verificar no navegador o que a parte 1 só cobriu por teste: cadastro novo a partir de convite, alterar papel e sair pela interface, aplicação contra banco sem a migração, leitor de tela.

## Sprint 8 — comercialização

**Parte 1 (planos, assinatura e cobrança) concluída no stack local em 09/10/2026**, na branch `feat/sprint-8-billing`, contra um emulador local da API da Stripe. **Em 10/10/2026 o founder aplicou as migrações em produção e rodou a cobrança contra a área restrita da Stripe: assinar, recibo, mudar de plano, portal, cancelar e desfazer funcionaram como o emulador previa.** **Parte 2 (domínio próprio e pixels) concluída no stack local em 10/10/2026**, na branch `feat/sprint-8-domains-pixels`, contra um resolvedor DNS de teste e um emulador da API da Vercel. PR #29 mergeado e migrações aplicadas em produção em 10/10/2026. **Nada rodou contra a Vercel, com um domínio real, nem contra a Meta ou o Google.** Relatório: `docs/SPRINT_8_REPORT.md`.

- [x] P0 Registrar ADR do provedor de pagamento (ADR 0014; Stripe, decisão do founder em 09/10/2026).
- [x] P0 Implementar `PaymentsAdapter` e webhooks idempotentes (adapter da Stripe por `fetch` e fake; verificado contra o emulador, **não** contra a Stripe).
- [x] P0 Criar planos/entitlements e estados de assinatura (catálogo de preços, máquina de estados, tolerância de 7 dias, regras de rebaixamento).
- [x] P0 Área de cobrança, tela de planos, confirmação de cancelamento/mudança e pontos de entrada nas telas de limite.
- [x] P0 Abrir a conta Stripe em modo de teste e aplicar a parte 1 (feito pelo founder em 10/10/2026, no ambiente que passou a ser produção): assinar, recibo, mudar de plano, portal, cancelar e desfazer funcionaram como o emulador previa.
- [ ] P0 Conferir contra a Stripe o que faltou: pagamento que falha, prazo de 7 dias, contestação, reembolso e o job diário.
- [ ] P0 Antes de convidar gente de fora: decidir entre `BILLING_MODE=off` e `live` (hoje `sandbox` em produção: quem assina não paga) e trocar o nome público da conta Stripe para "Linkfav".
- [x] P0 Atualizar o Next para 16.4.0 (`npm audit`: aviso alto novo em `next` 16.0.0–16.3.7, de produção). Feito junto com a Sprint 9, não em PR próprio; `npm audit --omit=dev` sem achados em 09/10/2026.
- [x] P1 Domínio próprio com prova de controle (parte 2; ADR 0016). Verificado no local; **certificado automático não observado**.
- [x] P1 Integrações Meta Pixel e GA sem scripts arbitrários (parte 2; ADR 0017). Consentimento antes de carregar; **caminho "Aceitar" não exercitado num navegador**.
- [ ] P0 Decidir o plano da Vercel para domínios de clientes (o Hobby não cobre uso comercial nem muitos domínios por projeto) antes de oferecer o recurso.
- [ ] P0 Conferir a parte 2 em produção (PR #29 mergeado e migrações aplicadas em 10/10/2026; passos em `docs/ENVIRONMENTS.md`, "Passos de deploy da Sprint 8, parte 2") com um subdomínio de teste e IDs reais de Meta e Google; **comparar a Vercel real com o emulador** e conferir no console que as bibliotecas carregam sem violação de CSP.
- [ ] P0 Revisão jurídica do aviso de consentimento e dos papéis no uso de pixels (lista no ADR 0017), junto com as minutas de `docs/legal/`.
- [ ] P1 Reverificação agendada dos domínios (job diário: domínio sem prova no DNS perde a situação e é desanexado no provedor).
- [ ] P1 Incluir `profile_domains` e `profile_pixels` em `export_workspace_data`; na exclusão, desanexar o domínio no provedor (Sprint 9).
- [ ] P1 Limite global nas verificações de domínio e em `/d/<host>` (Sprint 9).
- [ ] P2 Eventos de conversão nos pixels (lead, WhatsApp, Pix), registro de consentimento e Google Consent Mode.
- [ ] P2 Invalidar o cache só do domínio da página publicada (hoje toda publicação derruba todas as cópias em domínio próprio).
- [ ] P2 Conferir no navegador o que a parte 2 só cobriu por HTTP: seções da aba *Página*, página num domínio próprio, celular e leitor de tela.
- [ ] P1 Trocar entre mensal e anual numa assinatura em curso — cortado na parte 1 (UX-079).
- [ ] P1 Aviso por e-mail de pagamento que falhou e de renovação (depende do SMTP; hoje só na tela, e pelos e-mails da própria Stripe se forem ligados).
- [ ] P1 Plano de migração para mudança de preço com assinaturas em curso (hoje o valor antigo viraria `price_mismatch`).
- [ ] P1 Limite global e lista de IPs da Stripe na frente de `/api/billing/webhook` (Sprint 9).
- [ ] P1 Incluir as tabelas de cobrança na exportação da conta; na exclusão da conta do titular, cancelar no provedor antes do expurgo (Sprint 9).
- [ ] P2 Reembolso automático da segunda assinatura paga por engano (hoje o cancelamento é automático e o reembolso é manual).
- [ ] P2 Conferir no navegador o que a parte 1 só cobriu por teste ou HTTP: diálogo "Manter a assinatura", telas como administrador e editor, aplicação contra banco sem a migração, celular real e leitor de tela.

## Sprint 9 — hardening

Estado em `docs/SPRINT_9_REPORT.md`: a sprint **não está concluída**. Os P0 seguem abertos; as partes feitas estão marcadas abaixo de cada um.

- [ ] P0 Exportação/exclusão e aceites versionados.
  - [x] Aceite versionado com histórico (ADR 0015); nenhum texto ativo até a revisão do advogado.
  - [x] Exportação JSON da pessoa e da conta (só proprietário), com inventário por store em `docs/DATA_MAP.md`.
  - [x] Pedido de exclusão e de acesso com estados, fila administrativa e auditoria.
  - [x] Execução da exclusão de conta pela fila do administrador, com runbook (`docs/runbooks/ACCOUNT_DELETION.md`) e ensaio local (`scripts/account-erasure.mjs`, 18 verificações) em 11/10/2026. **Nunca executada em produção.**
  - [ ] Exportação dos arquivos de mídia; transferência de propriedade de conta com outros membros; aviso por e-mail ao titular.
  - [ ] Minutas em `docs/legal/` revisadas pelo advogado e ativadas.
- [ ] P0 Denúncia, moderação, suspensão e auditoria.
  - [x] Denúncia pública, fila, suspensão e reativação por página, auditadas.
  - [x] Aviso ao dono da página suspensa (dentro do produto) e canal de contestação: código de 11/10/2026 (ADR 0019), verificado só no stack local; runbook `docs/runbooks/MODERATION.md`. A retenção das denúncias foi definida como 180 dias (provisório) e entrou no expurgo em 11/10/2026.
  - [ ] Aviso de suspensão e de resposta **por e-mail** (depende do SMTP); aviso e contestação para suspensão de conta inteira; expurgo próprio e exportação de suspensões e contestações; segunda pessoa para julgar contestações.
- [ ] P0 Headers, CSP, rate limits e revisão de autorização.
  - [x] Headers de segurança e CSP (ainda com `unsafe-inline`); leitura limitada do corpo em `/api/events` e `/api/vitals`; origem com esquema nas rotas com sessão.
  - [x] Limite por instância nas rotas públicas, CAPTCHA nos formulários de acesso (desligado até ser configurado) e expurgo agendado: código de 11/10/2026 (ADR 0018), verificado só no stack local.
  - [ ] **Founder:** criar a regra do firewall da Vercel (`docs/runbooks/RATE_LIMITS.md`), ligar o Turnstile e aplicar as migrações `202610110001` e `202610110002` depois de um backup conferido (`docs/ENVIRONMENTS.md`, "Sprint 9, continuação").
  - [ ] Confirmar os prazos provisórios novos (denúncias 180 dias; pedidos de privacidade 5 anos) e os limites (300/min na regra; seis limites por rota).
- [ ] P0 Backup/restauração e runbooks.
  - [x] Runbooks de jobs, monitor e moderação (`JOBS.md`, `MONITORING.md`, `MODERATION.md`) e primeiro mecanismo de alerta (workflow *Monitor* + `/api/ops/status`): código de 11/10/2026 (ADR 0019), verificado só no stack local.
  - [ ] **Founder:** aplicar as migrações `202610110003` e `202610110004` e criar `OPS_STATUS_SECRET` na Vercel e no GitHub (`docs/runbooks/MONITORING.md` §1). Até lá o monitor só confere que o site responde.
  - [ ] Alertas para taxa de erro e latência do renderer, uploads, formulários, Auth e webhook que não chega (dependem de contratar um serviço que leia logs).
  - [x] Backup lógico (`npm run db:backup`: banco, contas, histórico de migrações e mídia) e ensaio de restauração (`npm run db:restore-check`), aprovados com o banco local em 10/10/2026; runbook `docs/runbooks/BACKUP.md`.
  - [ ] **Primeiro backup de produção** e ensaio dele (a CLI precisa estar logada na conta dona do projeto) e cópia para fora da máquina.
  - [ ] Ensaiar a restauração num projeto Supabase novo, incluindo mídia, segredos do Vault e Auth.
  - [ ] Agendar o backup (hoje é manual) e definir onde a cópia externa fica.
- [ ] P0 QA mobile/cross-browser e acessibilidade prioritária. Não iniciado (só uma checagem no Chrome de desktop).

## Débito/decisões abertas

- [ ] Rate limit próprio para Server Actions sensíveis (além dos limites do Supabase Auth) — Sprint 9.
- [ ] Confirmar decisões provisórias UX-013 a UX-018 (retenção de slug, papéis, limites). A UX-019 foi confirmada em 06/10/2026.

- [ ] Selecionar nome público após busca de marca, domínio e redes.
- [x] Escolher o gateway: Stripe, decisão do founder em 09/10/2026 (ADR 0014). A comparação com provedores brasileiros **não** foi refeita com documentação atual; se Pix recorrente virar requisito da nossa cobrança, ela precisa ser feita (conta Stripe brasileira não tem Pix em assinatura).
- [ ] Definir momento de mover mídia para R2 com base em custo real (o `StorageAdapter` e a URL base configurável já existem; ADR 0009).
- [ ] Confirmar decisões provisórias UX-033 a UX-042 (limites de imagem, cotas, tema, modelos, Pix sem QR, retenção de leads).
- [ ] Definir datastore analítico após medir eventos/dia e custo no Postgres (custo por evento medido na Sprint 6: 329 bytes; falta o volume real).
- [ ] Confirmar decisões provisórias UX-043 a UX-050 (o que conta como resultado, regra de visita, fuso, períodos, limites e retenção, exclusões, exportação).
- [x] Confirmar UX-019 e UX-051 a UX-059 (arquivamento, o que a duplicação copia, validade e regra de e-mail do convite, convite sem envio de e-mail, lugares, tela Membros, lista de páginas): confirmadas pelo founder em 06/10/2026.
- [ ] Decidir a UX-060 (lembrar a última conta usada em `/app`, cortado na parte 1).
- [ ] Confirmar decisões provisórias UX-061 a UX-071 (painel da conta, relatório do cliente, validade e papéis dos links, sem registro de abertura) e os limites do ADR 0013 (5 links ativos por página, 30 criações por dia, retenção de 90 dias).
- [x] Rebaixamento para relatórios, páginas, pessoas e convites: decidido na Sprint 8, parte 1 (ADR 0014, UX-077): nada é removido, só o que é novo é recusado, nada mais é bloqueado, e a tela lista o impacto com os números da conta antes de confirmar. **Provisório — founder confirmar.**
- [ ] Confirmar decisões provisórias UX-074 a UX-084 (tela de planos, papéis na cobrança, tolerância de 7 dias, rebaixamento, quando cada mudança vale, retorno do checkout, link nas telas de limite, ambiente de teste e home, plano manual, chargeback e reembolso).
- [ ] `npm audit`: 5 avisos altos em ferramentas de desenvolvimento (`eslint-config-next` → `braces`), sem correção compatível em 06/10/2026; rever a cada atualização do Next. Em 09/10/2026 apareceu um sexto, **de produção**, no próprio `next` (item na Sprint 8).
- [ ] Rate limit global e firewall na frente de `/api/events` (Sprint 9). Limite por instância desde 11/10/2026; o global é a regra do firewall, ainda não criada.
- [ ] Contratar revisão jurídica/contábil antes do beta pago. A lista do que ela precisa resolver para a cobrança está no ADR 0014 ("For the legal and accounting review").
