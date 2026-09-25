# Plano de Execução — do zero ao mercado

**Versão:** 1.0  
**Data:** 25/09/2026  
**Mercado inicial:** Brasil, sujeito a revisão por evidências  
**ICP provisório:** agências e social media managers  
**Cadência:** sprints de duas semanas, exceto Sprint 0  
**Horizonte até lançamento público:** 25 semanas  

## 1. Resultado esperado

Ao fim deste plano teremos um SaaS em produção que permite a um profissional ou agência:

1. Criar conta e workspace.
2. Montar e publicar uma bio page em menos de 10 minutos.
3. Usar links, texto, imagem, vídeo, redes sociais, WhatsApp, Pix/link de pagamento e formulário.
4. Personalizar a página e visualizar o resultado antes de publicar.
5. Acompanhar visitas, cliques, origem e ações de valor.
6. Gerenciar vários perfis, duplicar templates e compartilhar relatórios.
7. Assinar os planos Pro ou Agência em reais.
8. Usar domínio próprio e pixels nos planos habilitados.

O lançamento público não encerra o trabalho: ele inaugura o ciclo contínuo de retenção, crescimento e descoberta do nicho com maior aderência.

## 2. Premissas de planejamento

- Execução por um founder técnico, com apoio pontual de design, jurídico e contabilidade.
- MVP web responsivo; não haverá aplicativos nativos.
- O produto não custodiará dinheiro nem terá checkout próprio no MVP.
- Os valores de R$ 14,90 e R$ 57,90 são hipóteses comerciais, não compromissos permanentes.
- O MVP será construído antes da validação paga, mas terá telemetria desde o primeiro usuário.
- Feedback pode mudar o ICP, a mensagem e o preço sem exigir reescrever o núcleo da plataforma.
- Cada sprint deve produzir software demonstrável em ambiente de staging.

## 3. Estratégia de entrega

| Fase | Sprints | Duração | Saída principal |
|---|---:|---:|---|
| 0. Preparação | 0 | 1 semana | Escopo, arquitetura, identidade provisória e operação de engenharia |
| 1. Descoberta e protótipo | 1 | 2 semanas | Fluxos testáveis e decisões de UX |
| 2. Núcleo do MVP | 2–9 | 16 semanas | Produto completo em staging e MVP privado seguro |
| 3. MVP privado | 10 | 2 semanas | Usuários reais e correções críticas |
| 4. Beta pago | 11 | 2 semanas | Cobrança real e evidência de disposição a pagar |
| 5. Lançamento | 12 | 2 semanas | Produto público, suporte e aquisição inicial |
| 6. Crescimento | 13–16 | 8 semanas | Retenção, aquisição e aprofundamento do diferencial |

## 4. Princípios técnicos

### Arquitetura recomendada

Começar como um **monólito modular web**, com banco relacional e serviços gerenciados. Separar serviços só quando escala, segurança ou ritmo de entrega justificarem.

Componentes lógicos:

- **Aplicação de gestão:** autenticação, workspaces, editor, configurações e cobrança.
- **Renderer público:** entrega páginas publicadas rapidamente e sem depender do estado do editor.
- **Banco transacional:** usuários, workspaces, perfis, blocos, temas, planos e permissões.
- **Pipeline de eventos:** recebe visitas e cliques de forma assíncrona e tolerante a falhas.
- **Armazenamento de mídia:** imagens otimizadas, limites e remoção segura.
- **Jobs:** publicação, agregação de analytics, e-mail, domínio e limpeza de dados.
- **Administração:** denúncias, suspensão, auditoria e suporte.

### Decisões estruturais que precisam existir desde o início

- Todo perfil pertence a um workspace, mesmo no plano individual.
- Permissões são verificadas no servidor, nunca apenas na interface.
- Conteúdo editável e versão publicada são estados distintos.
- A página pública lê um snapshot publicado e cacheável.
- Eventos de analytics não bloqueiam a navegação do visitante.
- Recursos pagos são controlados por entitlements, não por condicionais espalhadas.
- Slugs e domínios têm unicidade, normalização e histórico mínimo para suporte.
- Exclusão de conta, retenção e exportação são requisitos de produto.

## 5. Definition of Ready

Uma história só entra em desenvolvimento quando possui:

- problema e usuário identificados;
- fluxo ou comportamento esperado;
- critérios de aceite observáveis;
- estados de carregamento, vazio e erro definidos;
- eventos de produto/analytics necessários;
- dependências e riscos conhecidos;
- texto de interface provisório disponível.

## 6. Definition of Done

Uma entrega só é considerada pronta quando:

- critérios de aceite foram atendidos;
- revisão de código e testes automatizados relevantes passaram;
- autorização, validação de entrada e tratamento de erro foram verificados;
- interface funciona nos breakpoints mobile e desktop definidos;
- acessibilidade básica por teclado, foco, contraste e rótulos foi conferida;
- telemetria, logs e alertas necessários foram incluídos;
- documentação operacional foi atualizada;
- funcionalidade foi demonstrada em staging;
- não há defeito crítico ou alto conhecido sem decisão explícita.

## 7. Plano detalhado de sprints

## Fase 0 — Preparação

### Sprint 0 — Fundamentos do produto e da engenharia

**Duração:** 1 semana.

**Objetivo:** remover ambiguidades que fariam o MVP ser refeito.

**Entregáveis:**

- Nome provisório e critérios para pesquisa de marca/domínio.
- Product brief de uma página e mapa dos principais fluxos.
- Backlog priorizado em Must / Should / Later.
- Repositório, convenções, branches, revisão e templates de issue/PR.
- Ambientes local, preview, staging e produção definidos.
- CI com lint, typecheck, testes e build.
- Registro de decisões arquiteturais: stack, autenticação, banco, mídia, e-mail, pagamentos e hospedagem.
- Modelo inicial de ameaças e mapa de dados pessoais.
- Painel mínimo de erros, logs e uptime.

**Critérios de aceite:**

- Um commit pode chegar a staging de forma repetível.
- Segredos não ficam no repositório e estão separados por ambiente.
- É possível reverter um deploy sem alterar manualmente o banco.
- Backlog do MVP cabe nas fronteiras definidas no plano de negócio.
- Há owner e resposta esperada para incidente, abuso e indisponibilidade.

**Gate:** arquitetura suporta workspaces e publicação desacoplada sem serviços prematuros.

## Fase 1 — Descoberta e protótipo

### Sprint 1 — Fluxos, protótipo e linguagem do produto

**Objetivo:** definir a experiência antes de implementar o editor inteiro.

**Entregáveis:**

- Jornada cadastro → criação → edição → publicação → analytics.
- Jornada agência → novo perfil → duplicar template → relatório.
- Wireframes mobile e desktop.
- Protótipo clicável de alta fidelidade dos fluxos críticos.
- Design tokens mínimos: cor, tipografia, espaçamento, raio, sombra e estados.
- Cinco templates provisórios orientados a casos distintos.
- Landing page de lista de espera com ICP ainda aberto.
- Roteiro para conversas qualitativas realizadas em paralelo, sem travar o build.

**Critérios de aceite:**

- Cinco pessoas conseguem publicar uma página no protótipo sem instrução verbal.
- Pelo menos quatro completam a tarefa em menos de 10 minutos.
- O protótipo contém estados vazio, erro, salvando, salvo, preview e publicado.
- A mensagem não afirma que o produto é exclusivo para agências.

**Gate:** fluxos críticos entendíveis; mudanças estruturais acontecem aqui, não depois do editor pronto.

## Fase 2 — Núcleo do MVP

### Sprint 2 — Identidade, workspaces e modelo multi-tenant

**Objetivo:** criar a fundação segura para usuários individuais e equipes.

**Entregáveis:**

- Cadastro, login, logout, verificação e recuperação de acesso.
- Criação automática do workspace individual.
- Modelos de usuário, workspace, membership, perfil e entitlement.
- Perfil básico com nome, slug, bio, avatar e estado draft/published.
- Navegação autenticada, onboarding e empty states.
- Auditoria mínima para login, publicação, troca de slug e alteração de papel.

**Critérios de aceite:**

- Um usuário não acessa dados de outro workspace manipulando URL ou payload.
- Slugs inválidos, reservados e duplicados são rejeitados com mensagem clara.
- Recuperação de acesso expira e não revela se um e-mail existe.
- Exclusão lógica e política de retenção estão representadas no modelo.
- Testes cobrem isolamento entre tenants e principais fluxos de autenticação.

### Sprint 3 — Renderer público e publicação

**Objetivo:** colocar a primeira página real no ar.

**Entregáveis:**

- Rota pública por slug.
- Snapshot de publicação e invalidação de cache.
- Cabeçalho com avatar, nome, bio e ícones sociais.
- Bloco de link básico.
- Título, descrição, canonical e preview Open Graph.
- Página 404, perfil suspenso e conteúdo não publicado.
- Instrumentação de performance e erros do renderer.

**Critérios de aceite:**

- Alterações em draft não afetam a página até a publicação.
- Publicar torna a versão nova visível em até 30 segundos.
- Rollback restaura a última versão publicada funcional.
- Meta inicial em teste controlado: LCP ≤ 2,5 s e CLS ≤ 0,1 em mobile.
- HTML principal é utilizável mesmo se o script de analytics falhar.

### Sprint 4 — Editor por blocos

**Objetivo:** permitir que o usuário construa a página sem código.

**Entregáveis:**

- Criar, editar, ordenar, duplicar, ativar/desativar e excluir blocos.
- Blocos de link, texto, redes sociais, WhatsApp e separador.
- Validação e normalização de URLs.
- Autosave com indicação de estado e recuperação de conflito simples.
- Preview mobile persistente.
- Confirmação e opção de desfazer para ações destrutivas recentes.

**Critérios de aceite:**

- Ordem do editor é igual à ordem publicada.
- Falha de salvamento é visível e não produz falso estado de sucesso.
- URLs perigosas ou esquemas não permitidos são bloqueados.
- Edição funciona por teclado e em viewport móvel.
- Um usuário novo cria e publica cinco blocos em menos de 10 minutos.

### Sprint 5 — Mídia, embeds e personalização

**Objetivo:** alcançar qualidade visual suficiente para substituir a solução atual do cliente.

**Entregáveis:**

- Upload, recorte e remoção de imagem.
- Blocos de imagem, vídeo/embed, Pix/link de pagamento e formulário simples.
- Tema: paleta, fonte, fundo, botões, espaçamento e cantos.
- Galeria de cinco templates aplicáveis sem perder conteúdo.
- Otimização de imagens e limites de arquivo.
- Sanitização e allowlist para embeds.

**Critérios de aceite:**

- Imagens são entregues em tamanho e formato adequados ao dispositivo.
- Arquivos inválidos ou acima do limite não são armazenados.
- Trocar template não apaga blocos nem configurações essenciais.
- Embeds arbitrários e scripts fornecidos pelo usuário não são executados.
- Formulário possui prevenção básica de spam e consentimento configurável.

### Sprint 6 — Analytics e prova de resultado

**Objetivo:** entregar o primeiro diferencial mensurável.

**Entregáveis:**

- Eventos de page view, clique em bloco, social, WhatsApp, Pix e envio de formulário.
- Captura de referrer, UTM, dispositivo e país/região em granularidade compatível com privacidade.
- Agregação diária e painel por período.
- Funil visita → ação de valor.
- Ranking de blocos e origem do tráfego.
- Exclusão razoável de bots e do tráfego de preview/admin.
- Exportação CSV inicial.

**Critérios de aceite:**

- Analytics nunca impede a abertura do destino clicado.
- Eventos duplicados por retry possuem deduplicação definida.
- Dashboard distingue “sem dados” de “zero”.
- Fuso horário e janela de datas são consistentes.
- Em teste controlado, totais agregados ficam dentro de 5% do conjunto de eventos válidos.
- Não é exibido dado pessoal de visitante sem base e propósito definidos.

### Sprint 7 — Multi-perfil e operação de agência

**Objetivo:** transformar o produto individual em ferramenta de operação.

**Entregáveis:**

- Lista, busca, criação e arquivamento de múltiplos perfis.
- Duplicação de perfil/template.
- Convites e papéis Owner, Admin e Editor.
- Troca de contexto de workspace.
- Dashboard consolidado básico.
- Link de relatório somente leitura com expiração/revogação.

**Critérios de aceite:**

- Permissões são aplicadas no servidor para cada ação sensível.
- Um template duplicado não compartilha conteúdo mutável com o original.
- Convites expiram, podem ser revogados e não concedem acesso ao workspace errado.
- Relatório compartilhado não expõe configurações internas nem dados de outros perfis.
- Agência consegue criar o décimo perfil sem degradação perceptível do fluxo.

### Sprint 8 — Planos, cobrança, domínio e pixels

**Objetivo:** deixar o MVP comercializável.

**Entregáveis:**

- Entitlements para Free, Pro e Agência.
- Checkout de assinatura mensal e anual em reais via provedor escolhido.
- Webhooks idempotentes, status da assinatura, falha de pagamento e cancelamento.
- Área de cobrança e histórico mínimo.
- Domínio próprio com verificação DNS e certificado automático.
- Meta Pixel e Google Analytics/Tag configuráveis sem aceitar scripts arbitrários.
- Selo do produto conforme o plano.

**Critérios de aceite:**

- Preços exibidos: R$ 14,90/mês ou R$ 149/ano; R$ 57,90/mês ou R$ 579/ano.
- Repetir um webhook não duplica assinatura nem cobrança.
- Downgrade preserva dados e comunica quais recursos ficarão bloqueados.
- Falha de pagamento tem período de tolerância definido e recuperável.
- Domínio só é associado após prova de controle e não pode ser sequestrado por outro usuário.
- Pixels respeitam configuração de consentimento e política publicada.

### Sprint 9 — Segurança, LGPD, abuso e prontidão operacional

**Objetivo:** converter o produto funcional em MVP privado operável.

**Entregáveis:**

- Termos, privacidade, cookies e aceite versionado em versão revisável.
- Exportação e solicitação de exclusão de conta/dados.
- Rate limits, proteção contra enumeração, CSRF/XSS/SQLi conforme arquitetura.
- Denúncia pública, fila administrativa, suspensão e motivo auditável.
- Backups, teste de restauração e runbooks de incidentes.
- Alertas de erro, latência, jobs, webhooks, certificado e disponibilidade.
- QA cross-browser/mobile e correções de acessibilidade prioritárias.
- Seed/demo e documentação de suporte.

**Critérios de aceite:**

- Nenhuma vulnerabilidade crítica ou alta conhecida permanece aberta.
- Backup é restaurado com sucesso em ambiente isolado.
- Exclusão/exportação percorre todos os stores mapeados ou registra exceção explícita.
- Um perfil denunciado pode ser investigado, suspenso e reativado com trilha de auditoria.
- Runbook permite diagnosticar renderer indisponível, fila atrasada e webhook falhando.
- Smoke tests passam em Chrome, Edge e Safari móvel ou equivalente de teste.

**Gate do MVP:** todos os fluxos P0 passam; produto pode receber usuários convidados sem acompanhamento constante do desenvolvedor.

## Fase 3 — MVP privado

### Sprint 10 — Piloto privado e estabilização

**Objetivo:** observar comportamento real antes de abrir cobrança e aquisição.

**Entregáveis:**

- Convite progressivo de 10 usuários, buscando variedade de perfis.
- Onboarding assistido e registro estruturado de problemas.
- Funil de produto e coortes básicas.
- Correção de defeitos P0/P1 e dos maiores bloqueios de ativação.
- Central curta de ajuda e contato de suporte.
- Linha de base de performance, custo por perfil e volume de eventos.

**Critérios de aceite:**

- Pelo menos 8 convidados criam uma página e 6 publicam.
- Mediana do tempo até publicação inferior a 10 minutos.
- Pelo menos 5 páginas geram uma ação de valor real.
- Zero perda conhecida de conteúdo publicado.
- Não há incidente crítico sem causa e correção documentadas.

**Gate:** ativação ≥ 60% entre convidados; se não ocorrer, Sprint 11 vira sprint de correção de ativação antes da cobrança.

## Fase 4 — Beta pago

### Sprint 11 — Primeira receita e validação comercial

**Objetivo:** comprovar que alguém paga pelo produto e continua usando-o.

**Entregáveis:**

- Oferta de founder plan sem desconto vitalício irrestrito.
- Migração de pilotos para Free, Pro ou Agência.
- Landing page pública, pricing, FAQ e fluxo de compra.
- Onboarding por segmento e mensagens transacionais.
- Processo de cancelamento com motivo e recuperação ética.
- Primeiro estudo de caso autorizado.
- Painel semanal de aquisição, ativação, receita e churn.

**Critérios de aceite:**

- Pelo menos 5 clientes pagantes, dos quais 2 no plano Agência, ou receita equivalente.
- Checkout, renovação, cancelamento e reembolso testados ponta a ponta.
- 80% dos pagantes permanecem ativos ao fim da sprint.
- Suporte responde no prazo prometido.
- Motivos de não compra e cancelamento estão categorizados.

**Gate:** evidência de disposição a pagar. Se houver uso sem compra, revisar proposta/preço antes de ampliar aquisição.

## Fase 5 — Lançamento público

### Sprint 12 — Go-to-market e abertura controlada

**Objetivo:** abrir o produto com capacidade de observar, atender e corrigir.

**Entregáveis:**

- Site público, páginas de produto, pricing, termos e status page.
- Tour/onboarding self-service e e-mails essenciais.
- Biblioteca inicial de templates e exemplos públicos autorizados.
- Conteúdo de lançamento e kit de demonstração.
- Lista founder-led de 100 potenciais parceiros e cadência de contato.
- Programa simples de indicação, inicialmente por crédito manual rastreável.
- Dashboard diário de saúde técnica e comercial.
- Calendário de plantão e rollback para a semana de lançamento.

**Critérios de aceite:**

- Novo usuário conclui cadastro, publicação e upgrade sem intervenção.
- Taxa de erro dos fluxos críticos permanece abaixo do limite definido no dashboard.
- Páginas públicas mantêm os objetivos de performance sob carga prevista.
- Toda mensagem de marketing corresponde a uma funcionalidade disponível.
- Há resposta preparada para cobrança, abuso, privacidade e indisponibilidade.

**Gate de lançamento:** sem P0 aberto, cobrança reconciliada, suporte operável e métricas confiáveis.

## Fase 6 — Crescimento orientado por evidências

### Sprint 13 — Ativação e onboarding

**Objetivo:** aumentar a parcela de cadastros que publica e gera valor.

**Candidatos, escolhidos pelos dados:** templates por intenção, importação de links, checklist, demo data, melhoria do editor e recomendações de CTA.

**Critérios de sucesso:** ativação em 24 horas ≥ 50% e redução de pelo menos 20% no maior abandono do funil.

### Sprint 14 — Retenção e prova de ROI

**Objetivo:** fazer analytics mudar comportamento e reduzir churn.

**Candidatos:** relatório mensal automático, metas por CTA, comparação de períodos, alertas de queda, sugestões baseadas em regras e branding do relatório.

**Critérios de sucesso:** pelo menos 40% dos pagantes consultam ou compartilham analytics no mês; retenção de logos pagos em 90 dias caminha para ≥ 80%.

### Sprint 15 — Aquisição e loop de parceiros

**Objetivo:** encontrar um canal repetível.

**Candidatos:** indicação automatizada, afiliados selecionados, landing pages por profissão, galeria de templates, cases, comparativos e onboarding de agência.

**Critérios de sucesso:** um canal gera pelo menos 20 clientes qualificados com CAC mensurável e payback projetado abaixo de quatro meses.

### Sprint 16 — Expansão ou verticalização

**Objetivo:** decidir onde concentrar o próximo trimestre.

**Trabalho:** analisar coortes por segmento, ARPA, ativação, retenção, ações de valor e custo de suporte; entrevistar os melhores e piores clientes; escolher entre aprofundar agências, verticalizar outro nicho ou preparar expansão geográfica.

**Critérios de sucesso:** decisão registrada com evidências, segmento prioritário, proposta revisada e metas do próximo trimestre.

## 8. Dependências críticas

| Dependência | Necessária até | Plano de contingência |
|---|---|---|
| Nome e domínio provisórios | Sprint 0 | Usar codinome e domínio técnico até pesquisa de marca |
| Provedor de autenticação/e-mail | Sprint 2 | Abstrair pontos de integração e limitar e-mails no piloto |
| Armazenamento e otimização de mídia | Sprint 5 | Imagens com limites rígidos e transformação assíncrona |
| Pipeline de eventos | Sprint 6 | Começar com ingestão própria simples e agregação em jobs |
| Gateway de assinatura no Brasil | Sprint 8 | Escolher por recorrência, Pix/cartão, webhooks e conciliação; manter adapter |
| Automação de SSL/domínios | Sprint 8 | Beta com subdomínio; liberar domínio próprio gradualmente |
| Revisão jurídica/contábil | Sprint 9 | Documentos provisórios no privado; não abrir beta pago sem revisão mínima |
| Usuários piloto | Sprint 10 | Recrutamento começa na Sprint 1, não na Sprint 10 |

## 9. Priorização e controle de escopo

### P0 — bloqueia lançamento

- autenticação e isolamento de workspaces;
- editor e renderer confiáveis;
- publicação e rollback;
- analytics essenciais;
- multi-perfil;
- cobrança e entitlements;
- denúncia, suspensão, privacidade e backups.

### P1 — importante, mas pode ter versão simples

- domínio próprio;
- pixels;
- formulário;
- relatório compartilhável;
- templates e duplicação;
- colaboração com três papéis.

### P2 — depois do lançamento

- white-label completo;
- API pública/MCP;
- checkout nativo;
- automações avançadas;
- IA generativa;
- marketplace;
- CRM ou e-mail marketing completos;
- aplicativos nativos.

Regra: um item novo só entra antes do lançamento se substituir outro de tamanho semelhante ou corrigir risco de segurança, legal, cobrança ou ativação.

## 10. Métricas por fase

| Fase | Métrica dominante | Sinal esperado |
|---|---|---|
| Protótipo | Compreensão | 4/5 publicam sem ajuda e em menos de 10 min |
| Núcleo | Confiabilidade | Fluxos P0 automatizados; sem isolamento quebrado |
| Privado | Ativação | ≥ 60% dos convidados publicam |
| Beta pago | Disposição a pagar | 5 pagantes, incluindo 2 agências ou receita equivalente |
| Lançamento | Self-service | Cadastro → publicação → upgrade sem intervenção |
| Crescimento | Retenção e CAC | retenção 90d ≥ 80%; payback < 4 meses |

### North Star

**Perfis publicados que geraram ao menos uma ação de valor nos últimos 30 dias.**

Métricas de apoio: perfis publicados, ações por perfil, ativação em 24 horas, conversão Free → pago, MRR, churn de receita/logos, ARPA, margem, tickets de suporte e custo por perfil ativo.

## 11. Rotina operacional de cada sprint

- **Dia 1:** objetivo, escopo, riscos e definição da demo.
- **Diariamente:** revisão curta de bloqueios e métricas técnicas.
- **Meio da sprint:** demo interna do caminho crítico; cortar escopo antes de comprometer qualidade.
- **Penúltimo dia:** QA, segurança, migração, documentação e preparação de rollback.
- **Último dia:** demo em staging, retrospectiva, métricas e decisão do gate.
- **Após deploy:** acompanhar erros, performance e comportamento; registrar aprendizados no backlog.

Reservar aproximadamente 20% da capacidade para testes, correções, observabilidade, documentação e débito técnico. Em sprints de piloto/lançamento, elevar a reserva para 30–40%.

## 12. Registro de riscos do cronograma

| Risco | Sinal antecipado | Resposta |
|---|---|---|
| Editor consome várias sprints | Reordenação/autosave instáveis na Sprint 4 | Cortar layouts avançados e manter blocos em coluna única |
| Analytics perde confiança | Diferença > 5% em teste controlado | Congelar novos gráficos e corrigir ingestão/deduplicação |
| Multi-tenant inseguro | Regras duplicadas e testes frágeis | Centralizar autorização e aumentar testes de isolamento |
| Domínios atrasam beta | SSL/DNS depende de operação manual | Beta inicial em subdomínio; domínio liberado por coorte |
| Cobrança brasileira limita recorrência | Webhooks/conciliação incompletos | Trocar adapter/provedor sem alterar entitlements |
| Founder sobrecarregado | Suporte interrompe desenvolvimento | Convites em lotes, help center e horários definidos |
| ICP provisório não responde | Poucos pilotos qualificados | Recrutar também criadores/autônomos e comparar coortes |
| Preço baixo inviabiliza suporte | Muitos tickets por conta de R$ 14,90 | Simplificar onboarding, limitar suporte no Pro e testar preço |

## 13. Checklist de lançamento público

### Produto

- Cadastro, publicação, edição, analytics e cobrança passam em smoke test.
- Limites dos planos são coerentes no site, checkout, app e backend.
- Downgrade, cancelamento, inadimplência, exportação e exclusão funcionam.

### Técnico

- Migrações testadas, backup restaurado e rollback ensaiado.
- Alertas têm destinatário e runbook.
- Capacidade e limites de rate foram testados no cenário esperado.
- Dependências, licenças e segredos foram auditados.

### Segurança e legal

- Sem vulnerabilidade crítica/alta conhecida.
- Termos, privacidade, cookies, conteúdo e reembolso publicados.
- Denúncia e resposta a incidentes testadas.
- Marca pesquisada e risco aceito formalmente.

### Comercial e suporte

- Pricing, FAQ, onboarding, e-mails e cancelamento revisados.
- Respostas para as dez objeções principais documentadas.
- Suporte, SLA prometido e plantão da primeira semana definidos.
- Dashboard de lançamento mostra aquisição, ativação, receita, erros e churn.

## 14. Resultado da primeira etapa

O trabalho começa pela Sprint 0. Ao final dela, devem existir o repositório inicial, decisões técnicas registradas, ambientes, pipeline de entrega, backlog executável e protótipo planejado para a Sprint 1. O escopo de construção permanece deliberadamente estreito: lançar uma base confiável, medir uso real e só então expandir.
