# Backlog executável

Convenção: `P0` bloqueia o MVP; `P1` pode ter versão simples; `P2` fica após lançamento. Ordem reflete dependências, não estimativa.

## Sprint 1 — protótipo

- [ ] P0 Mapear cadastro → publicar → analytics.
- [ ] P0 Mapear agência → perfil → duplicar → relatório.
- [ ] P0 Criar wireframes mobile/desktop e protótipo clicável.
- [ ] P0 Definir tokens visuais e estados de interface.
- [ ] P1 Criar cinco templates conceituais.
- [ ] P1 Publicar landing page de lista de espera.
- [ ] P1 Testar o protótipo com cinco pessoas.

## Sprint 2 — identidade e tenancy

- [ ] P0 Criar migrações de users/workspaces/memberships/profiles.
- [ ] P0 Implementar RLS e testes de isolamento.
- [ ] P0 Implementar auth, verificação e recuperação.
- [ ] P0 Criar workspace individual no onboarding.
- [ ] P0 Reservar, normalizar e validar slugs.
- [ ] P1 Registrar auditoria de ações sensíveis.

## Sprint 3 — página pública

- [ ] P0 Criar modelo de snapshot publicado.
- [ ] P0 Implementar renderer público por slug.
- [ ] P0 Publicar, invalidar cache e restaurar snapshot anterior.
- [ ] P0 Adicionar metadados/OG/canonical e estados 404/suspenso.
- [ ] P1 Instrumentar Web Vitals e erros.

## Sprint 4 — editor

- [ ] P0 CRUD, ordem, duplicação e visibilidade de blocos.
- [ ] P0 Blocos link, texto, social, WhatsApp e separador.
- [ ] P0 Autosave seguro e preview mobile.
- [ ] P0 Validar URLs e bloquear esquemas perigosos.
- [ ] P1 Undo de exclusão recente.

## Sprint 5 — visual e mídia

- [ ] P0 Implementar `StorageAdapter` e quota.
- [ ] P0 Upload/otimização/remoção de imagens.
- [ ] P0 Blocos imagem, embed, Pix e formulário.
- [ ] P0 Temas e aplicação de template sem perda de conteúdo.
- [ ] P1 Sanitização/allowlist de provedores de embed.

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

- [ ] Selecionar nome público após busca de marca, domínio e redes.
- [ ] Comparar gateway por recorrência, Pix, cartão, webhooks, split, chargeback e conciliação.
- [ ] Definir momento de mover mídia para R2 com base em custo real.
- [ ] Definir datastore analítico após medir eventos/dia e custo no Postgres.
- [ ] Contratar revisão jurídica/contábil antes do beta pago.
