# Backlog executável

Convenção: `P0` bloqueia o MVP; `P1` pode ter versão simples; `P2` fica após lançamento. Ordem reflete dependências, não estimativa.

## Fechamento do piloto — revisão de 27/10/2026

Conciliação com os adendos de 14/10 de `docs/SPRINT_9_REPORT.md`; não é uma nova auditoria da produção. A Sprint 9 continua parcial e o piloto ainda não começou.

- [x] SMTP/Resend, DNS, modelos do Auth e domínio `linkfav.com` configurados em 14/10; recuperação de senha e aviso de novo contato recebidos pelo founder.
- [x] Primeiro backup de produção com mídia e conferência de restauração `PASS`, em 14/10. A cópia externa, o agendamento e a restauração completa num projeto hospedado continuam pendentes.
- [x] Migrações de 11/10, 13/10 e de e-mail de 14/10 aplicadas em produção, conforme o relatório.
- [x] Exportação individual das variantes WebP em *Meus dados → Baixar imagens desta conta*: implementada e verificada localmente (adendo de 27/10 do relatório). Pacote único continua pelo atendimento manual.
- [x] Atualização de segurança: Next e `eslint-config-next` 16.4.1, com correções compatíveis das ferramentas de desenvolvimento no lockfile; `npm audit` sem achados em 27/10. O build com 16.4.0 havia parado por alerta crítico.
- [ ] Publicar estas alterações e conferir em produção o download de uma imagem do proprietário, a recusa a outro membro e os erros de arquivo ausente. A correção de segurança também só passa a proteger a produção depois do deploy.
- [ ] Código ainda pendente: transferência de propriedade; aviso ao titular sobre pedido de privacidade; aviso/contestação de suspensão da conta inteira; limites de Server Actions sensíveis; identificação dos convidados no funil.
- [ ] Configuração externa: Turnstile, firewall, monitor completo (`OPS_STATUS_SECRET`), confirmação dos crons, backup externo/agendado e `SUPPORT_EMAIL`.
- [ ] Decisão/validação do founder: cobrança `off` ou `live` (último registro: `sandbox`), cenários restantes contra a Stripe, QA em aparelhos reais e revisão jurídica, incluindo Resend/DPA e documentos ativos.

## Sprint 1 — protótipo

- [x] Identidade visual solicitada em 27/10/2026: logo vetorial Linkfav, versão para fundo escuro, PNGs transparentes e favicon SVG/ICO/Apple, aplicados na home, landings, autenticação e painel. Arquivos e uso em `docs/BRAND_IDENTITY.md`; deploy e aprovação visual do founder pendentes.

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
- [x] P0 Escolher e configurar SMTP para e-mails de Auth: Resend escolhida em 11/10 e configurada em produção em 14/10, com DNS, SMTP, modelos e mapa de dados (ADR 0021; adendo de 14/10 do relatório da Sprint 9). Contrato/DPA e revisão jurídica seguem bloqueantes na seção de e-mail.
- [ ] P1 Ativar CAPTCHA (Turnstile) no Auth antes do piloto externo. O formulário já envia o token quando o ambiente tem a chave (ADR 0018, 11/10/2026); **falta o founder criar o widget na Cloudflare, pôr a chave na Vercel e ligar no Supabase, nessa ordem** (`docs/ENVIRONMENTS.md`).

## Sprint 3 — página pública

Verificado localmente (pgTAP + `next start` de produção + Lighthouse); nada provisionado. Relatório: `docs/SPRINT_3_REPORT.md`.

- [x] P0 Criar modelo de snapshot publicado.
- [x] P0 Implementar renderer público por slug.
- [x] P0 Publicar, invalidar cache e restaurar snapshot anterior.
- [x] P0 Adicionar metadados/OG/canonical e estados 404/suspenso.
- [x] P1 Instrumentar Web Vitals e erros (logs estruturados; Sentry/dashboards dependem de provisionamento).
- [ ] P0 Medir em staging (CDN real): publicação visível em ≤ 30 s, LCP/CLS de campo e prévia OG no WhatsApp/Instagram — parcial em 2026-10-02 (`docs/SPRINT_5_REPORT.md`, "Verificações no staging depois da correção"): publicação visível em ~5 s e prévia OG conferida nos dois apps; os logs `web_vital` ficaram dentro da meta, mas só com acessos do founder e Lighthouse. Falta LCP/CLS de visitantes reais.
- [x] P0 Trocar `NEXT_PUBLIC_APP_URL` e o Auth para o domínio comprado: URL pública conferida em 10/10; Site URL e Redirect URLs do Auth configuradas para `https://linkfav.com` em 14/10, conforme relato/captura do founder e recuperação de senha recebida (relatório da Sprint 9, "e-mail ligado em produção").
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
- [x] P1 Aviso ao dono da página quando chega um contato: ADR 0021, Resend ligada e aviso recebido pelo founder em produção em 14/10 (relatório da Sprint 9). Entrega para usuários externos depende da revisão jurídica.
- [ ] P1 Imagem Open Graph com o tema e a foto da página.
- [ ] P2 CAPTCHA no formulário público e limite global por IP (Sprint 9). Limite por instância no envio desde 11/10/2026; CAPTCHA no formulário não feito; o limite global é a regra do firewall.
- [x] P2 Purge agendado de leads vencidos e de `form_submission_hits` (job `/api/jobs/retention`, 11/10/2026). Código, testes e runbook prontos em 11/10/2026 (ADR 0018), verificados só no stack local. Migrações aplicadas em produção em 14/10/2026.

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
- [x] P0 Fechar a Sprint 7 em staging (feito: migrações aplicadas e merge; verificada em produção em 14/10/2026; adendo em `docs/SPRINT_7_REPORT.md`): `supabase db push` das duas migrações da parte 2 (`202610060003`, `202610060004`), enviar a branch, abrir e fazer o merge do PR, pôr a conta de teste no plano Agência por SQL e conferir um link de relatório de ponta a ponta (passos em `docs/ENVIRONMENTS.md`).
- [x] P2 Link de relatório (corrigido em 14/10/2026: o formulário só mostra o link criado enquanto ele está ativo na lista): depois de cancelar um link recém-criado, esconder a caixa "Link do relatório" e o aviso "Link criado", que continuam mostrando um endereço que já não abre (visto em produção em 14/10/2026).
- [x] P2 Diálogo de confirmação (corrigido em 15/10/2026, `ConfirmDialog`): depois de arquivar, o diálogo aberto trocava o título para "Desarquivar esta página?" com "Página arquivada.", e a abertura seguinte mostrava o resultado antigo em vez de pedir para desarquivar (visto em produção em 15/10/2026; regressão em `apps/web/scripts/archive-dialog.mjs`).
- [ ] P1 Limite global (firewall/rate limit) na frente de `/r/` e da RPC do relatório (Sprint 9). `/r/` ganhou limite por instância em 11/10/2026; a RPC chamada direto e o limite global seguem dependendo do firewall.
- [x] P1 Expurgo agendado de links de relatório terminados há mais de 90 dias e dos contadores de tentativas (job `/api/jobs/retention`, 11/10/2026). Código, testes e runbook prontos em 11/10/2026 (ADR 0018), verificados só no stack local.
- [x] P1 Incluir `report_links` na exportação e na exclusão de conta (exportação na Sprint 9; exclusão em 11/10/2026, por cascata da conta).
- [ ] P2 Conferir no celular real e imprimir o relatório do cliente (nesta sprint: larguras de 360 a 768 px por medição para as telas da conta; o relatório só em desktop, com as regras de impressão presentes na folha de estilo).
- [ ] P2 Página 404 do relatório sem JavaScript fica em branco (o framework renderiza o estado no cliente); avaliar uma resposta estática.
- [ ] P2 Relatório com intervalo fixo de datas ("setembro") e campanha (UTM), se as agências do piloto pedirem.
- [ ] P1 Lembrar a última conta usada em `/app` — cortado na parte 1 (UX-060).
- [x] P1 Levar o convite no modelo de e-mail de confirmação do Auth, para o cadastro por convite funcionar em outro aparelho (14/10/2026, ADR 0012 adendo; verificado localmente de ponta a ponta). SMTP e modelos configurados em produção em 14/10; **aceitação em outro aparelho ainda não verificada em produção**.
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
- [x] P1 Integrações Meta Pixel e GA sem scripts arbitrários (parte 2; ADR 0017). Consentimento antes de carregar; caminho "Aceitar" exercitado num navegador em 11/10/2026, com as bibliotecas reais e identificadores de ninguém, sem violação de CSP. **Falta conferir a chegada de um evento numa conta real da Meta e do Google.**
- [ ] P0 Decidir o plano da Vercel para domínios de clientes (o Hobby não cobre uso comercial nem muitos domínios por projeto) antes de oferecer o recurso.
- [ ] P0 Conferir a parte 2 em produção (PR #29 mergeado e migrações aplicadas em 10/10/2026; passos em `docs/ENVIRONMENTS.md`, "Passos de deploy da Sprint 8, parte 2") com um subdomínio de teste e IDs reais de Meta e Google; **comparar a Vercel real com o emulador** e conferir no console que as bibliotecas carregam sem violação de CSP.
- [ ] P0 Revisão jurídica do aviso de consentimento e dos papéis no uso de pixels (lista no ADR 0017), junto com as minutas de `docs/legal/`.
- [x] P1 Reverificação agendada dos domínios (job diário `/api/jobs/domains`; sete dias seguidos sem a prova desligam o domínio): código de 11/10/2026, verificado só no stack local; migração `202610110005` aplicada em produção em 14/10/2026. Falta confirmar o prazo de sete dias e avisar o dono por e-mail (depende do SMTP).
- [x] P1 Incluir `profile_domains` e `profile_pixels` em `export_workspace_data` (11/10/2026, com suspensões e contestações); na exclusão de conta o domínio é desanexado pelo procedimento de 11/10/2026 (ADR 0018). Verificado só no stack local.
- [ ] P1 Limite global nas verificações de domínio e em `/d/<host>` (Sprint 9).
- [ ] P2 Eventos de conversão nos pixels (lead, WhatsApp, Pix), registro de consentimento e Google Consent Mode.
- [ ] P2 Invalidar o cache só do domínio da página publicada (hoje toda publicação derruba todas as cópias em domínio próprio).
- [ ] P2 Conferir no navegador o que a parte 2 só cobriu por HTTP: seções da aba *Página*, página num domínio próprio, celular e leitor de tela.
- [x] P1 Trocar do mensal para o anual numa assinatura em curso (13/10/2026, UX-094; ADR 0014, adendo): vale na hora, com o desconto da parte do mês já paga. Verificado só contra o emulador; **nunca contra a Stripe**.
- [ ] P2 Trocar do anual para o mensal no meio do ano pago: não oferecido (a tela ensina a cancelar a renovação e assinar o mensal no fim do período). Fazer direito exige agendamento no provedor; avaliar se o piloto pedir.
- [x] P1 Aviso por e-mail de pagamento que falhou e de renovação anual (14/10/2026, ADR 0021). Verificado só contra um substituto da Resend.
- [ ] P1 **Founder:** decidir se os e-mails de falha de pagamento da própria Stripe ficam ligados junto com os nossos (`docs/runbooks/MAIL.md` §2).
- [x] P1 Plano de migração para mudança de preço com assinaturas em curso (13/10/2026): preços aposentados continuam concedendo o plano a quem assinou por eles; procedimento em `docs/runbooks/PRICE_CHANGE.md`. Verificado só no stack local; nenhum preço foi mudado até hoje.
- [ ] P1 Decidir se assinantes antigos são levados ao preço novo (UX-096) e, se forem, construir o aviso e o reajuste: depende do SMTP e da revisão jurídica. Hoje continuam no valor antigo, sem prazo.
- [ ] P1 Limite global e lista de IPs da Stripe na frente de `/api/billing/webhook` (Sprint 9).
- [x] P1 Tabelas de cobrança na exportação da conta (já estavam desde a Sprint 9; conferido por teste em 13/10/2026, com o motivo do cancelamento acrescentado); na exclusão da conta do titular, a assinatura é encerrada no provedor antes do expurgo (13/10/2026, sem reembolso automático). Verificado só contra o emulador.
- [ ] P2 Reembolso automático da segunda assinatura paga por engano (hoje o cancelamento é automático e o reembolso é manual).
- [ ] P2 Conferir no navegador o que a parte 1 só cobriu por teste ou HTTP: diálogo "Manter a assinatura", telas como administrador e editor, aplicação contra banco sem a migração, celular real e leitor de tela.

## Sprint 9 — hardening

Estado em `docs/SPRINT_9_REPORT.md`: a sprint **não está concluída**. Os P0 seguem abertos; as partes feitas estão marcadas abaixo de cada um.

- [ ] P0 Exportação/exclusão e aceites versionados.
  - [x] Aceite versionado com histórico (ADR 0015); nenhum texto ativo até a revisão do advogado.
  - [x] Exportação JSON da pessoa e da conta (só proprietário), com inventário por store em `docs/DATA_MAP.md`.
  - [x] Pedido de exclusão e de acesso com estados, fila administrativa e auditoria.
  - [x] Execução da exclusão de conta pela fila do administrador, com runbook (`docs/runbooks/ACCOUNT_DELETION.md`) e ensaio local (`scripts/account-erasure.mjs`, 18 verificações) em 11/10/2026. **Nunca executada em produção.**
  - [x] Download individual das variantes WebP prontas da conta, apenas pelo proprietário (27/10/2026; verificação local; produção pendente). Inventário no JSON, sem originais; pacote único e arquivos ausentes/incompletos continuam pela solicitação manual.
  - [ ] Transferência de propriedade de conta com outros membros; aviso por e-mail ao titular sobre pedido de privacidade.
  - [ ] Minutas em `docs/legal/` revisadas pelo advogado e ativadas.
- [ ] P0 Denúncia, moderação, suspensão e auditoria.
  - [x] Denúncia pública, fila, suspensão e reativação por página, auditadas.
  - [x] Aviso ao dono da página suspensa (dentro do produto) e canal de contestação: código de 11/10/2026 (ADR 0019), verificado só no stack local; runbook `docs/runbooks/MODERATION.md`. A retenção das denúncias foi definida como 180 dias (provisório) e entrou no expurgo em 11/10/2026.
  - [x] Aviso de suspensão e de resposta à contestação **por e-mail** (14/10/2026, ADR 0021). Verificado só contra um substituto da Resend.
  - [ ] Aviso e contestação para suspensão de conta inteira; expurgo próprio de suspensões e contestações; segunda pessoa para julgar contestações.
- [ ] P0 Headers, CSP, rate limits e revisão de autorização.
  - [x] Headers de segurança e CSP (ainda com `unsafe-inline`); leitura limitada do corpo em `/api/events` e `/api/vitals`; origem com esquema nas rotas com sessão.
  - [x] Limite por instância nas rotas públicas, CAPTCHA nos formulários de acesso (desligado até ser configurado) e expurgo agendado: código de 11/10/2026 (ADR 0018), verificado só no stack local.
  - [ ] **Founder:** criar a regra do firewall da Vercel (`docs/runbooks/RATE_LIMITS.md`), ligar o Turnstile (`docs/ENVIRONMENTS.md`, "Sprint 9, continuação"). As migrações `202610110001` e `202610110002` foram aplicadas em produção em 14/10/2026, depois de um backup conferido.
  - [ ] Confirmar os prazos provisórios novos (denúncias 180 dias; pedidos de privacidade 5 anos) e os limites (300/min na regra; seis limites por rota).
- [ ] P0 Backup/restauração e runbooks.
  - [x] Runbooks de jobs, monitor e moderação (`JOBS.md`, `MONITORING.md`, `MODERATION.md`) e primeiro mecanismo de alerta (workflow *Monitor* + `/api/ops/status`): código de 11/10/2026 (ADR 0019), verificado só no stack local.
  - [ ] **Founder:** criar `OPS_STATUS_SECRET` na Vercel e no GitHub (`docs/runbooks/MONITORING.md` §1). As migrações `202610110003` e `202610110004` foram aplicadas em produção em 14/10/2026. Até lá o monitor só confere que o site responde.
  - [x] Tempo máximo de resposta da aplicação, da home, da página de situação e da página pública de teste no monitor, e alerta quando `/status` acusa instabilidade (13/10/2026, ADR 0020). Medido de hora em hora, de fora do Brasil: é disponibilidade e lentidão grosseira, **não taxa de erro**.
  - [ ] **Founder:** decidir o serviço que lê os logs e o plano da Vercel que os envia (o *log drain* não existe no Hobby). Sem isso continuam sem alerta: taxa de erro e latência por requisição do renderer, uploads, formulários e Auth, Web Vitals e webhook que não chega.
  - [x] Backup lógico (`npm run db:backup`: banco, contas, histórico de migrações e mídia) e ensaio de restauração (`npm run db:restore-check`), aprovados com o banco local em 10/10/2026; runbook `docs/runbooks/BACKUP.md`.
  - [x] **Primeiro backup de produção e conferência da restauração:** feitos em 14/10 (`backups/20261014T201546Z-production`, `PASS`; 67 tabelas e 15 de 15 arquivos de mídia). Evidência no adendo do relatório da Sprint 9.
  - [ ] Copiar o backup para fora desta máquina e registrar o destino e o controle de acesso.
  - [ ] Ensaiar a restauração num projeto Supabase novo, incluindo mídia, segredos do Vault e Auth.
  - [ ] Agendar o backup (hoje é manual) e definir onde a cópia externa fica.
- [ ] P0 QA mobile/cross-browser e acessibilidade prioritária. **Parcial:** passagem automática em 11/10/2026 (`scripts/mobile-a11y.mjs`: 12 telas em 390 e 320 px, regras WCAG 2.2 A/AA do axe-core, tamanho de alvo, `/aceite` com textos ativos), sem pendências depois de aumentar duas caixas de seleção. **Falta:** aparelho real (iOS e Android), outros navegadores, leitor de tela e teclado.

## E-mail transacional (14/10/2026)

Código de 14/10/2026 (ADR 0021), verificado localmente contra um substituto da API da Resend e o Mailpit e **ligado em produção em 14/10**: recuperação de senha e aviso de novo contato recebidos em endereços do founder. Os demais cenários de entrega continuam pendentes.

- [x] P0 Fila de avisos no banco, envio pela Resend atrás de um adaptador, job diário de reserva, alertas no monitor.
- [x] P1 E-mail de novo contato para o dono da página (sem o conteúdo do contato; um por hora; pode ser desligado).
- [x] P1 E-mail de suspensão e de resposta à contestação.
- [x] P1 E-mail de pagamento que falhou e lembrete de renovação anual.
- [x] P1 Convite que funciona em outro aparelho.
- [x] P0 **Founder:** conta na Resend, domínio `linkfav.com` verificado (SPF, DKIM, DMARC), chave só de envio, variáveis na Vercel, SMTP e modelos no Supabase, *Redirect URL* com `**` (`docs/runbooks/MAIL.md` §1): feito em 14/10/2026; recuperação de senha e aviso de novo contato chegaram (relato do founder).
- [ ] P0 **Founder:** contrato/DPA com a Resend, menção no aviso de privacidade e revisão jurídica da transferência internacional. Até lá, e-mail só para endereços do próprio founder.
- [ ] P2 Conferir em produção os avisos que ainda não saíram (suspensão, contestação, pagamento falhou, renovação anual) e o convite aceito em outro aparelho.
- [x] P0 **Founder:** aplicar a migração `202610140001`: aplicada em produção em 14/10/2026, antes do merge e sem backup novo (decisão do founder; o backup conferido da mesma tarde é o mais recente).
- [ ] P0 Revisão jurídica: Resend como subprocessador, transferência internacional, menção na política de privacidade.
- [ ] P1 Primeiro envio real: conferir entrega, caixa de spam e aparência no Gmail e no Outlook, no celular.
- [ ] P2 Mandar o próprio convite por e-mail (a UX-055, confirmada, diz que não; rever se o piloto pedir).

## Espanha: home em espanhol (30/10/2026)

As primeiras campanhas serão na Espanha (decisão do founder em 30/10/2026; ADR 0022). Preços definidos pelo founder: Pro 4 €/mês ou 39 €/ano; Agência 10 €/mês ou 99 €/ano.

- [x] P0 Home em espanhol em `/es`, com os preços em euro, `hreflang` e link entre as duas versões no rodapé. Verificado só localmente.
- [x] P0 Cadastro em espanhol (`/cadastro?idioma=es`) e idioma gravado na conta (`user_accounts.locale`, migração `202610300001`).
- [ ] P0 **Founder:** aplicar a migração `202610300001` depois de um backup conferido (`docs/ENVIRONMENTS.md`, "Passos de deploy da home em espanhol").
- [ ] P0 **Bloqueia campanhas:** cobrança em euro. Hoje a home mostra euros e o checkout cobra reais. Decidir como uma conta ganha o mercado, como `plan_prices` guarda duas moedas, se a conta Stripe brasileira vende em euro e o IVA de serviço digital na UE.
- [ ] P0 **Bloqueia campanhas:** aviso de privacidade e termos para a UE (RGPD), em espanhol, com revisão jurídica.
- [x] P1 E-mails de confirmação, recuperação e troca de e-mail em espanhol (modelos do Supabase com `.Data.locale`) e avisos da Resend no idioma de quem recebe (migração `202610300003`). Verificado só localmente; os e-mails não foram abertos no Mailpit.
- [x] P1 Área da conta, entrar, recuperar acesso e ajuda (`/es/ajuda`) em espanhol, lendo `user_accounts.locale`, `?idioma=` ou o cookie `lnk_locale` (adendo da ADR 0022). Verificado só localmente.
- [x] P2 Trocar o idioma da conta em *Meus dados*; idioma por página pública (`profiles.locale`, migração `202610300002`, aba Página do editor). Verificado só localmente.
- [ ] P0 **Founder:** aplicar as migrações `202610300002` e `202610300003` e colar os modelos de e-mail bilíngues no Supabase (`docs/ENVIRONMENTS.md`, "Passos de deploy do app e dos e-mails em espanhol").
- [ ] P2 Traduzir o que ficou em português: administração, textos legais, `/denunciar`, `/aceite`, `/cookies`, landings da lista de espera, erros de `/[slug]` e `/r`, CSVs, alguns modelos do editor e a tela de exportar imagens.

## Sprint 10 — piloto privado (preparação)

A preparação em código começou em 13/10/2026 (`docs/SPRINT_9_REPORT.md`, ADR 0020); as migrações foram aplicadas em produção em 14/10. **A sprint não começou:** ninguém foi convidado. Primeiro backup conferido e SMTP já foram feitos; faltam os demais bloqueios listados no fechamento do piloto acima, incluindo revisão jurídica e decisão sobre o modo da cobrança.

- [x] P0 Funil de produto e coortes de ativação (`/app/administracao/produto`, só administradores da plataforma), calculado do que o produto já registra. Mede o gate de 60% e a mediana do tempo até publicar.
- [x] P0 Central curta de ajuda (`/ajuda`) com *Ajuda* no menu da conta.
- [ ] P0 **Founder:** definir o endereço de suporte e configurar `SUPPORT_EMAIL`. Sem ele a página diz que o atendimento do piloto é com quem enviou o convite.
- [x] P1 Primeiros passos na lista de páginas, até a primeira publicação (UX-097).
- [x] P1 Página de preços (`/precos`), com valores só com a cobrança real ligada (UX-099).
- [x] P1 Página de situação (`/status`), servida pela própria aplicação (UX-100). Uma página hospedada fora, com histórico, fica para a Sprint 12 e é decisão de fornecedor.
- [x] P1 Cancelamento com motivo opcional (UX-095), com os motivos na tela do funil.
- [x] P0 **Founder:** aplicar a migração `202610130001` depois de um backup conferido, junto com as pendentes de 11/10: aplicadas em produção em 14/10/2026 (backup `20261014T201546Z-production`, conferido com `PASS`).
- [ ] P0 Conferir contra a Stripe (área restrita) o que só rodou no emulador: troca para o anual (a fatura proporcional é a da Stripe), cancelamento com motivo e exclusão de conta com assinatura em curso.
- [ ] P1 Guardar quem foi convidado para o piloto: hoje o funil conta todas as contas criadas no período, e o gate fala de convidados.
- [ ] P1 Onde as pessoas desistem **dentro** de uma tela (editor, cadastro): o funil mostra até que etapa cada conta chegou, não o que aconteceu no caminho. Exige telemetria de produto, não construída.
- [ ] P1 Rever as respostas de `/ajuda` a cada mudança de tela ou de regra, e incluir domínio próprio e pixels quando tiverem rodado em produção.
- [x] P2 Acessibilidade da home, achada ao passar o axe-core em 13/10/2026 e corrigida em 14/10/2026 (texto de exemplo com `--home-muted`; faixa com `tabIndex=0` e nome pelo título; axe-core sem achados em 390 e 1024 px, build de produção local): contraste do texto de exemplo do endereço (`.home-claim-address span`) e a faixa de modelos (`.home-rail`) que rola e não recebe foco do teclado.
- [ ] P2 Conferir as telas novas em aparelho real, outros navegadores, leitor de tela e teclado (a passagem de 13/10/2026 é automática, em Chrome).
- [ ] Convite progressivo de 10 pessoas, onboarding assistido, registro estruturado de problemas, linha de base de performance e custo por perfil: dependem do piloto existir.

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
- [ ] Confirmar decisões provisórias UX-102 a UX-105 (avisos por e-mail, para quem e quando; convite em outro aparelho).
- [ ] Confirmar decisões provisórias UX-094 a UX-101 (troca para o anual e a recusa da volta, motivo do cancelamento, preço antigo mantido, primeiros passos, central de ajuda, página de preços, página de situação, definição de ativação no funil).
- [x] `npm audit`: em 27/10/2026, zero achados após Next/`eslint-config-next` 16.4.1 e correções compatíveis no lockfile (Vitest/Vite/Zod e dependências). Substitui os avisos históricos de 06/10 e 09/10. Rever nas próximas atualizações; deploy ainda pendente.
- [ ] Rate limit global e firewall na frente de `/api/events` (Sprint 9). Limite por instância desde 11/10/2026; o global é a regra do firewall, ainda não criada.
- [ ] Contratar revisão jurídica/contábil antes do beta pago. A lista do que ela precisa resolver para a cobrança está no ADR 0014 ("For the legal and accounting review").
