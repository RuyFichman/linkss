# Mapa inicial de dados pessoais

| Categoria | Exemplos | Finalidade | Retenção inicial |
|---|---|---|---|
| Conta | e-mail, nome, identificadores de auth | acesso e comunicação operacional | vida da conta + prazo legal/segurança definido |
| Workspace | membros, papéis, convites | colaboração e autorização | vida do workspace |
| Perfil público | nome, avatar, bio, links | publicação solicitada pelo cliente | até remoção/despublicação e cache expirar |
| Leads | campos escolhidos pelo cliente | encaminhar contato ao controlador do perfil | 90 dias (provisório), exportável; ver Sprint 5 abaixo |
| Analytics | categoria de origem (nunca a URL ou o host do referrer), UTM, classe de aparelho, país, hash diário do visitante | medir desempenho | bruto 7 dias; agregados 100 dias, visíveis conforme o plano; ver Sprint 6 abaixo |
| Cobrança | IDs do provedor, status da assinatura, valor, datas e link do recibo; **nunca** cartão, CPF/CNPJ ou endereço | assinatura e obrigações legais | vida da conta; prazo fiscal em aberto (ver Sprint 8 abaixo) |
| Segurança | IP truncado/hash quando necessário, logs e auditoria | fraude, abuso e incidentes | janela curta baseada em risco |
| Suporte | mensagens e anexos | atendimento | prazo publicado e minimizado |
| Lista de espera | nome, e-mail, WhatsApp opcional, segmento, quantidade de perfis, ferramenta atual, faixa de preço, interesse no piloto, consentimento, UTM/referrer | recrutar pesquisa/piloto e validar ICP, mensagem e preço | pesquisa e piloto; revisão e exclusão de cadastros inativos em até 12 meses |

## Stores implementados na Sprint 2

Todos no Postgres do Supabase (mesmo projeto por ambiente). Nenhum novo operador/subprocessador foi adicionado: o Supabase já constava da ADR 0002. O envio de e-mails de autenticação em ambientes hospedados exigirá SMTP próprio (candidato: Resend), que **ainda não** foi contratado e precisará de atualização deste mapa antes do uso.

| Store / tabela | Dados pessoais | Finalidade | Base / owner | Retenção e exclusão |
|---|---|---|---|---|
| `auth.users` (Supabase Auth) | e-mail, hash de senha, `display_name` informado no cadastro, datas de confirmação/login, IP de sessões nos logs do Auth | autenticação, verificação e recuperação | execução do contrato / founder | vida da conta; exclusão de conta na Sprint 9 remove a linha (cascateia `user_accounts` e memberships) |
| `public.user_accounts` | nome de exibição, locale | personalizar a interface | execução do contrato | vida da conta; `deleted_at` + `purge_after` (30 dias) antes da remoção definitiva |
| `public.workspaces` | nome da conta (pode identificar a agência), `created_by` | tenancy e colaboração | execução do contrato | soft delete com `purge_after = deleted_at + 30 dias`; workspace pessoal termina junto com a conta |
| `public.workspace_memberships` | vínculo pessoa ↔ workspace, papel, quem convidou, datas | autorização | execução do contrato | registro revogado mantido enquanto o workspace existir (histórico de acesso); removido com o workspace ou a conta |
| `public.profiles` | rascunho: título, bio, avatar (chave de storage), redes sociais e links (URLs escolhidas pelo cliente, podem conter telefone/e-mail em `tel:`/`mailto:`) | página do cliente | execução do contrato | soft delete com `purge_after = deleted_at + 30 dias` |
| `public.slug_history` | endereço liberado, página e workspace de origem, quem liberou | impedir sequestro/impersonação de endereços recém-usados; suporte | legítimo interesse (segurança) | manter ao menos até `hold_until` (90 dias) + 1 ano; purge na Sprint 9 |
| `public.audit_events` | id do ator, ação, alvo, metadados mínimos (método, correlation id, slug antigo/novo, papéis) — **nunca** e-mail completo, token, senha, cookie ou IP | trilha de segurança e investigação | legítimo interesse / obrigação de segurança | 1 ano (provisório); purge pelo job da Sprint 9 executado como `postgres`; append-only para todos os papéis de cliente |
| Logs estruturados da aplicação | correlation id, evento, resultado, código de erro; e-mails mascarados e chaves sensíveis descartadas | operação e diagnóstico | legítimo interesse | conforme retenção do provedor de logs (Vercel/Sentry, a definir antes do piloto) |

## Stores adicionados na Sprint 3

Nenhum novo operador/subprocessador. A página pública é conteúdo que o cliente escolheu publicar; ela passa a ficar em cache (ISR/CDN da Vercel quando provisionada).

| Store | Dados pessoais | Finalidade | Base / owner | Retenção e exclusão |
|---|---|---|---|---|
| `public.profile_publications` | cópia imutável do conteúdo publicado (título, bio, avatar, redes, links visíveis) e `published_by` | servir a página pública e permitir rollback | execução do contrato | últimas 10 versões por página; apagadas junto com a página no purge (cascata); despublicar não apaga versões |
| Cache ISR/CDN da página e da imagem OG | o mesmo conteúdo público | desempenho | execução do contrato | invalidado ao publicar, restaurar, tirar do ar, trocar endereço ou excluir; senão expira em 60 s |
| Logs `web_vital` (`/api/vitals`) | nenhum: nome da métrica, valor, classificação, tipo de navegação, rota fixa `public_page` (sem URL, slug, id, user agent ou IP) | desempenho do renderer | legítimo interesse | retenção do provedor de logs |
| Logs `request.error`, `public_page.*`, `publishing.*` | template da rota, resultado, versão, duração, correlation id — nunca caminho concreto, cabeçalhos ou cookies | operação | legítimo interesse | retenção do provedor de logs |

Exclusão da página remove o conteúdo público imediatamente (404 após a invalidação); o conteúdo continua nas tabelas até o purge, como na Sprint 2. Links de terceiros e caches externos (prévias já geradas pelo WhatsApp/Instagram) estão fora do nosso controle e devem ser mencionados na política de privacidade.

## Dados adicionados na Sprint 4 (editor por blocos)

Nenhum novo operador/subprocessador nem novo store: os blocos vivem em `profiles.blocks` (rascunho) e em `profile_publications.document` (snapshots), já mapeados acima.

| Dado | Onde | Finalidade | Base / owner | Retenção e exclusão |
|---|---|---|---|---|
| Número de WhatsApp (dígitos E.164) e mensagem pronta do bloco WhatsApp | rascunho e snapshots | o cliente escolhe publicar um contato comercial | execução do contrato; owner: o workspace | segue o ciclo do rascunho e das 10 versões publicadas; apagado no purge da página. Pode ser número pessoal do profissional: a política de privacidade deve dizer que é conteúdo público escolhido pelo cliente |
| Textos livres, links, e-mails (`mailto:`) e telefones (`tel:`) nos blocos | rascunho e snapshots | conteúdo da página | execução do contrato | idem |
| Coluna legada `profiles.social_links` | rascunho | não é mais gravada pela aplicação (as redes viraram bloco `social`) | — | mantida até limpeza aprovada pelo founder; apagada no purge da página |
| Logs `editor.save` / `editor.load_latest` | logs | operação do autosave | legítimo interesse | só resultado, duração e correlation id — **nunca** conteúdo de bloco, números ou e-mails |

## Dados adicionados na Sprint 5 (mídia, Pix, formulário)

Nenhum novo operador/subprocessador: as imagens ficam no Supabase Storage do mesmo projeto. Vídeo e música são incorporados de YouTube, Vimeo e Spotify **só depois do clique do visitante**; nesse momento o provedor recebe dados da visita (IP, cabeçalhos e a origem do site), o que deve constar na política de privacidade.

| Dado | Onde | Finalidade | Base / owner | Retenção e exclusão |
|---|---|---|---|---|
| Imagens enviadas (avatar e blocos de imagem): podem mostrar rostos, lugares e marcas | bucket público `media` (variantes WebP) + `public.media_assets` (dimensões, tamanho, quem enviou) | conteúdo da página do cliente | execução do contrato; owner: o workspace | enquanto o rascunho ou uma das 10 versões publicadas usar; depois vira órfã e é apagada pelo job de limpeza (24 h de carência). Página excluída: apagadas depois do `purge_after`. **Metadados EXIF/GPS são removidos antes de guardar; o arquivo original não é guardado** |
| Chave Pix (CPF, CNPJ, celular, e-mail ou chave aleatória) e link de pagamento | rascunho e snapshots | o cliente escolhe publicar um meio de pagamento | execução do contrato | ciclo do rascunho e das versões publicadas. CPF, celular e e-mail são dados pessoais do próprio cliente, publicados por escolha dele (o editor avisa e sugere chave aleatória) |
| Leads: nome, e-mail, telefone e mensagem digitados por **visitantes** | `public.form_leads` | encaminhar o contato ao dono da página | consentimento registrado por envio (texto exato, versão e horário), quando o dono o exige; **o dono da página é o controlador, o produto é o operador** | 90 dias (provisório): depois disso o lead some da leitura na hora e é apagado no próximo envio à página ou pelo purge. O dono exclui um a um e exporta em CSV (ambos auditados). Apagados em cascata com a página ou o workspace |
| Hash do visitante para o limite de envios | `public.form_submission_hits` | impedir spam | legítimo interesse (segurança) | HMAC diário do IP com segredo do servidor; nunca o IP; apagado em até 24 h |
| Eventos de auditoria `lead.deleted` / `lead.exported` | `public.audit_events` | trilha de quem apagou ou levou dados | legítimo interesse | só a contagem e a página, nunca o conteúdo do lead; 1 ano (provisório) |
| Logs `media.upload`, `media.cleanup`, `lead.submit`, `lead.delete`, `lead.export` | logs | operação | legítimo interesse | resultado, tamanhos, duração e correlation id — **nunca** nome de arquivo, conteúdo, chave Pix ou dados de lead |

Exportação e exclusão de conta (Sprint 9) precisam alcançar: `media_assets` + objetos do bucket (pelo job de limpeza, antes de apagar a página: a FK é `restrict`), `form_leads`, `form_submission_hits`. O segredo de assinatura de uploads fica no Supabase Vault (`media_signing_secret`) e não é dado pessoal.

## Dados adicionados na Sprint 6 (analytics do cliente)

Primeiros dados sobre **visitantes que nunca se cadastraram**. Decisão: ADR 0011. Nenhum novo operador/subprocessador: tudo fica no Postgres do mesmo projeto Supabase; a rota roda na Vercel, que já era o host da aplicação.

**Papéis:** o dono da página é o **controlador** dos dados de visita da sua página (ele decide publicar a página e usar os números); o produto é o **operador**. O produto não usa esses dados para publicidade nem os cruza entre páginas. O termo de tratamento e o aviso de privacidade definitivos são da Sprint 9 e da revisão jurídica.

**O que nunca é guardado:** endereço IP, user agent, endereço completo ou host do referrer, URL da página, cookie ou identificador persistente no navegador, relógio do cliente. IP e user agent entram só no cálculo dos hashes e na classificação (aparelho, robô) dentro da requisição e são descartados.

### `public.analytics_events` (bruto)

Base legal proposta: legítimo interesse do controlador em medir o uso da própria página, com dados minimizados e de curta duração (a confirmar na revisão jurídica). Retenção: **7 dias completos mais o dia em curso**; apagado pelo job diário. Página ou workspace excluídos: cascata.

| Campo | Conteúdo | Finalidade |
|---|---|---|
| `profile_id`, `workspace_id` | página e conta donas do evento | isolamento entre tenants; agregação |
| `event_id` | UUID gerado no navegador do visitante para aquele evento (não identifica a pessoa nem o aparelho; um novo a cada evento) | deduplicar retries |
| `occurred_at`, `day` | horário de chegada no servidor e dia no fuso de relatório | janelas, limites e agregação |
| `event_type` | um de nove tipos (visita, cliques por tipo de bloco, envio de formulário, selo) | contagem |
| `block_id` | id do bloco da publicação no ar | ranking de blocos |
| `visitor_hash` | 32 caracteres: HMAC diário com sal do servidor de (dia, endereço da página, IP) e de (dia, endereço da página, IP, user agent). Muda todo dia e é diferente em cada página | regra de visita (30 min) e limite por endereço. Pseudônimo de vida curta: sem o sal não é reversível; com o sal, só por força bruta sobre os IPs do dia |
| `source` | uma de 12 categorias (Instagram, WhatsApp, Google, direto, outros…) | origem do tráfego |
| `device` | celular, tablet, computador ou não identificado | aparelhos |
| `country` | código de país de duas letras (do cabeçalho da hospedagem) ou `ZZ` | países |
| `utm_source`, `utm_medium`, `utm_campaign` | valores do link de campanha do próprio dono, restritos a `[a-z0-9_.-]` e 40 caracteres | campanhas |

O evento `form_submit` não tem hash, origem nem nada do que foi digitado: só a página, o bloco e o horário.

### `public.analytics_daily` (agregados)

| Campo | Conteúdo |
|---|---|
| `profile_id`, `workspace_id`, `day` | página, conta e dia de relatório |
| `dimension`, `key`, `event_type`, `count` | total do dia, ou por bloco, origem, combinação de UTM, aparelho ou país, e a contagem |

Não contém hash nem linha por visitante. Uma contagem muito baixa por país ou campanha pode, em tese, corresponder a uma pessoa; o dado continua sendo "uma visita do país X", sem ligação com identidade. Retenção: **100 dias** (provisório); o que cada conta **vê** é o entitlement `analytics_days` do plano (7 ou 90 dias). Página ou workspace excluídos: cascata.

### Outros

| Dado | Onde | Finalidade | Retenção |
|---|---|---|---|
| Hash do endereço para o limite entre páginas (`client_hash`): HMAC diário de (dia, IP), sem página, conta nem evento | `public.analytics_rate_hits` | impedir que um endereço espalhe um flood por muitas páginas | 2 dias |
| Marca d'água da agregação e configurações (fuso, início da contagem, teto de capacidade) | `analytics_day_status`, `analytics_settings` | operação | sem dado pessoal |
| Evento de auditoria `analytics.exported` (página, janela, linhas) | `public.audit_events` | trilha de quem exportou | 1 ano (provisório) |
| Logs `analytics.ingest`, `analytics.maintenance`, `analytics.export` | logs | operação | resultado e contagens — **nunca** o payload, o hash, o referrer, o IP ou o user agent |
| Segredo de assinatura `analytics_signing_secret` (Vault) e `VISITOR_HASH_SALT` (servidor) | Vault / variáveis de ambiente | atestar lotes; salgar os hashes | não são dados pessoais; rotação em `docs/runbooks/ANALYTICS.md` |

**Exportação e exclusão (Sprint 9):**

- Exportação da conta: incluir `analytics_daily` das páginas dos workspaces da pessoa (só agregados).
- Exclusão de página ou conta: `analytics_events` e `analytics_daily` saem em cascata com a página; nada mais precisa ser feito.
- Pedido de um **visitante** (titular): não há como localizar as linhas de uma pessoa (não guardamos IP nem identificador, e o hash muda todo dia e depende de um sal). A resposta é a política: os registros detalhados somem em 7 dias e os agregados não identificam ninguém. Isso precisa constar do aviso de privacidade definitivo.

### Purge planejado (documentado, não agendado)

O job da Sprint 9 deverá, em transação e com trilha própria:

0. rodar a limpeza de mídia (`POST /api/jobs/media-cleanup`) até não restar asset das páginas vencidas, e apagar `form_leads` com `purge_after < now()`;
1. apagar `profiles` com `purge_after < now()` (falha enquanto a página ainda tiver `media_assets`);
2. apagar `workspaces` com `purge_after < now()` (cascateia memberships e páginas remanescentes);
3. apagar `user_accounts` com `purge_after < now()` e a respectiva linha em `auth.users` via Admin API;
4. apagar `audit_events` com mais de 1 ano e `slug_history` com `hold_until` há mais de 1 ano.

Índices parciais em `purge_after` e `created_at` já existem para esse job.

O purge de analytics **já está agendado** (Sprint 6): o job diário `/api/jobs/analytics` apaga eventos brutos com mais de 7 dias, agregados com mais de 100 dias e contadores de limite com mais de 2 dias. Apagar a página no passo 1 leva junto, em cascata, os eventos e agregados dela.

## Dados adicionados na Sprint 7, parte 1 (convites e operação de várias páginas)

### `public.workspace_invitations`

O e-mail convidado é dado pessoal de **alguém que talvez nunca crie conta**. Controlador: o produto (gestão de acesso à conta do cliente). Base proposta: execução do contrato com a conta que convida e legítimo interesse em controlar o acesso; a confirmar na revisão jurídica.

| Campo | Conteúdo | Finalidade | Retenção |
|---|---|---|---|
| `email` | Endereço convidado, normalizado (minúsculas, sem espaços) | Conferir que quem aceita é a pessoa convidada; mostrar o convite a quem administra a conta | Até 30 dias depois de o convite terminar (aceito, cancelado ou expirado) |
| `role` | `admin` ou `editor` | Papel concedido na aceitação | Idem |
| `token_hash` | SHA-256 do token. O token nunca é guardado | Localizar o convite a partir do link | Idem |
| `invited_by`, `revoked_by`, `accepted_by` | Ids de usuários (ficam nulos se a pessoa for excluída) | Mostrar quem convidou; trilha | Idem |
| `created_at`, `expires_at`, `revoked_at`, `accepted_at` | Datas | Validade e estado | Idem |

- **Quem lê:** proprietários e administradores da conta (RLS), sem a coluna `token_hash`. Editores, outras contas e `anon` não leem nada. A pessoa convidada vê só o nome da conta, o papel e o nome de quem convidou, e só com um convite válido para o e-mail dela.
- **Exclusão:** convites terminados há mais de 30 dias são apagados quando a conta cria o convite seguinte. **Purge agendado para contas que não convidam mais: pendente (Sprint 9)**, junto com os demais purges.
- **Exportação e exclusão de conta (Sprint 9):** alcançar por `email` (pedido de um convidado sem conta), por `invited_by` e `accepted_by` (pedido de um usuário) e por `workspace_id` (exclusão da conta; já em cascata).
- **Trilha de auditoria:** `invitation.created`, `invitation.revoked` e `invitation.accepted` guardam papel e ids, **nunca** o endereço nem algo derivado do token.
- **Nenhum e-mail é enviado** pelo produto: nenhum subprocessador novo.

### E-mail de membros na tela "Membros"

`list_workspace_members` lê `auth.users.email` e o devolve **só** a proprietários e administradores da mesma conta (e a cada pessoa, o próprio). Editores veem nome e papel. Finalidade: identificar quem tem acesso. Nada novo é guardado.

### Cookie `lnk_after_confirm`

Definido só quando alguém se cadastra a partir de um link de convite: guarda o caminho do convite por 1 hora, `HttpOnly`, `SameSite=Lax`, restrito a `/auth`. Finalidade: voltar ao convite depois da confirmação de e-mail no mesmo aparelho. Não identifica a pessoa e não é lido por nenhuma outra rota.

### Outros

- `profiles.duplicated_from`: id da página de origem de uma cópia. Não é dado pessoal.
- `media_asset_shares`: quais páginas podem usar uma imagem de outra página da mesma conta. Não é dado pessoal. As imagens em si seguem o que já está descrito na Sprint 5; uma imagem compartilhada só é apagada quando nenhuma página a usa.
- **Duplicar copia dados que podem ser pessoais** (chave Pix, número de WhatsApp) para outra página da mesma conta. Não há novo destinatário: os dois rascunhos pertencem à mesma conta.

## Regras

- Não coletar dado sem finalidade e owner.
- Não guardar cartão; usar token/ID do provedor.
- Não usar analytics do visitante para advertising por padrão.
- Separar analytics do cliente de telemetria interna.
- Permitir exportação e exclusão; registrar exceções legais.
- Formalizar controladores/operadores e transferência internacional antes do beta pago.

## Dados adicionados na Sprint 7, parte 2 (links de relatório)

Um link de relatório é uma **divulgação de dados da conta a um terceiro escolhido pela própria conta** (em geral, o cliente de uma agência). O que é divulgado são totais de uma página; nenhum dado de visitante existe nos agregados.

### `report_links`

| Campo | Conteúdo | Dado pessoal? | Quem lê |
|---|---|---|---|
| `id`, `workspace_id`, `profile_id` | Identificadores da conta e da página | não | proprietário e administrador da conta |
| `token_hash` | SHA-256 do token; o token não é guardado | não | ninguém pela API |
| `period_days`, `expires_at`, `created_at`, `revoked_at` | Período, validade e datas | não | proprietário e administrador |
| `label` | Anotação livre de quem criou (até 80 caracteres); pode conter o nome de um cliente | possivelmente | proprietário e administrador; **não** aparece no relatório nem na trilha de auditoria |
| `created_by`, `revoked_by` | Membro que criou e que cancelou | sim (membro) | proprietário e administrador |

- **Finalidade:** permitir que a conta preste contas de uma página a quem não tem acesso ao produto. **Base legal proposta:** execução do contrato com a conta; depende da revisão jurídica já pendente.
- **Retenção:** enquanto o link estiver ativo e por 90 dias depois de expirar ou ser cancelado (provisório); o expurgo acontece na criação seguinte de link na conta, e o expurgo agendado fica para a Sprint 9. A exclusão da página ou da conta apaga as linhas pela chave estrangeira.
- **Nenhum registro de leitura:** não guardamos quem abriu, quando, nem quantas vezes.
- **Exportação e exclusão (Sprint 9):** a exportação da conta inclui as linhas, sem `token_hash`; a exclusão já as alcança.

### `report_lookup_failures`

`client_hash` (hash diário do endereço de quem tentou um link inexistente, com segredo do servidor; nunca o endereço) e `created_at`. Sem token, sem página. Apagado depois de 24 horas, na falha seguinte. Finalidade: reduzir tentativas em massa.

### O que o relatório mostra a quem tem o link

Nome da conta, nome e endereço público da página, período, visitas, resultados e a taxa, a série por dia, origens por categoria e os blocos com o texto que já é público na página. Não mostra: identificadores, plano, membros, outras páginas, contatos recebidos, valores de UTM, aparelhos, países, rascunho, nem a anotação do link. Lista completa no ADR 0013.

## Dados adicionados na Sprint 8, parte 1 (planos, assinatura e cobrança)

Decisão: ADR 0014. **Novo subprocessador: Stripe** (processamento de pagamentos e assinatura), com tratamento fora do Brasil. Ele só passa a receber dados quando o founder abrir a conta e ligar o modo de cobrança; até lá (modo `off`) nada sai do produto. **Antes de qualquer cobrança real:** contrato/DPA com a Stripe, menção na política de privacidade e base para a transferência internacional (lista para os revisores no ADR 0014).

**O que o produto envia à Stripe:** o nome da conta (workspace) e o id da conta, como metadado do cliente e da assinatura; o plano escolhido (nome do produto, valor, intervalo); os endereços de retorno. **O que a pessoa digita na página da Stripe** (e-mail, nome, cartão e, se a Stripe pedir, CPF/CNPJ e endereço) vai direto para a Stripe: o produto não recebe, não pede e não guarda.

| Store / tabela | Conteúdo | Dado pessoal? | Finalidade | Quem lê | Retenção |
|---|---|---|---|---|---|
| `plan_prices` | plano, intervalo, valor em centavos, moeda | não | catálogo de preços | quem tem sessão | permanente |
| `billing_customers` | conta → id do cliente na Stripe, quem iniciou (`created_by`), data | identificador indireto (liga a conta a um pagador na Stripe) | saber de quem é um evento | o proprietário | vida da conta (cascata) |
| `billing_subscriptions` | ids da assinatura e do cliente na Stripe, plano, intervalo, valor, situação, fim do período, cancelamento agendado, prazo de regularização, plano mantido até o fim do período, quando foi lido | não identifica uma pessoa; descreve a relação comercial da conta | conceder o plano e explicar a situação | proprietário e administrador | vida da conta (cascata) |
| `billing_invoices` | id da fatura na Stripe, valor, moeda, situação, datas, **link do recibo hospedado pela Stripe** | o recibo, na Stripe, tem os dados do pagador; aqui só o link | histórico de pagamentos | o proprietário | vida da conta (cascata). **Em aberto:** obrigação de guarda fiscal × exclusão da conta |
| `billing_events` | id do evento na Stripe, conta, motivo, desfecho, datas. **Nunca o conteúdo do evento** | não | idempotência do webhook e diagnóstico | nenhum papel de cliente | 90 dias (expurgo pelo job diário) |
| `audit_events` (`billing.*`) | quem iniciou checkout ou pediu mudança; de/para de situação e de plano; motivo | id do ator, como nas demais ações | trilha de mudanças de plano | proprietário e administrador | 1 ano (provisório) |
| Vault `billing_signing_secret`; variáveis `BILLING_SIGNING_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | segredos | não | atestar retratos; falar com a Stripe; conferir webhooks | servidor | rotação em `docs/runbooks/BILLING.md` |
| Logs `billing.webhook`, `billing.maintenance`, `billing.checkout`, `billing.cancel`, `billing.resume`, `billing.change_plan`, `billing.self_service` | evento, tópico, desfecho, duração, correlation id | não: **nunca** conteúdo do evento, assinatura, id do provedor, valor, e-mail ou documento | operação | retenção do provedor de logs |

- **CPF/CNPJ:** o produto não coleta. Se a Stripe exigir do pagador, o dado fica na Stripe, sob o contrato dela com o founder. Se um dia o produto precisar dele (nota fiscal), é uma coleta nova: finalidade, base e retenção têm de ser definidas antes.
- **Exportação e exclusão (Sprint 9):** a exportação da conta deve incluir `billing_subscriptions` e `billing_invoices` (sem os ids internos do provedor, se a revisão assim decidir). A exclusão de uma conta com assinatura em curso é **recusada** até o cancelamento (`LK102`); a exclusão de conta do titular precisa cancelar na Stripe e só depois expurgar. O que fica na Stripe (cliente, faturas, recibos) segue a retenção da Stripe e as obrigações fiscais do founder: **exceção legal a registrar** depois da revisão contábil.
- **Rebaixamento, falta de pagamento e cancelamento não apagam dado nenhum** do cliente.

## Dados adicionados na Sprint 9 (aceite, pedidos de privacidade e denúncias)

Decisão: ADR 0015. Verificado só no stack local (pgTAP `180-sprint9-privacy-moderation`). **Nenhum subprocessador novo.** As retenções abaixo são propostas técnicas e todas dependem da revisão jurídica (`docs/legal/REVISAO_JURIDICA.md`); as que estavam "não definidas" ganharam prazo provisório e expurgo agendado em 11/10/2026 (seção "Sprint 9, continuação").

| Store / tabela | Conteúdo | Dado pessoal? | Finalidade | Quem lê | Retenção |
|---|---|---|---|---|---|
| `legal_documents` | tipo (termos, privacidade, cookies), versão, texto, SHA-256, situação | não | texto exato oferecido para aceite | texto ativo: qualquer pessoa, pela RPC `get_legal_status`; rascunho e aposentado: nenhum papel de cliente | permanente (prova do texto aceito) |
| `legal_acceptances` | usuário, documento, hash do texto, data | sim (id do usuário) | provar qual texto foi aceito, por quem e quando | a própria pessoa | vida da conta (cascata de `auth.users`). **Em aberto:** guardar a prova depois da exclusão |
| `privacy_requests` | usuário, tipo (exclusão, acesso), situação, motivo codificado, referência do dossiê, quem analisou | sim (id do usuário; sem FK, sobrevive à exclusão) | atender e provar o atendimento de pedidos do titular | a própria pessoa; a fila, só o administrador da plataforma pela RPC | **não definida** |
| `privacy_request_events` | histórico de transições do pedido (append-only) | id do ator | trilha do atendimento | a própria pessoa | segue o pedido |
| `platform_admins` | usuários que moderam e atendem pedidos | sim (id do usuário) | autorização da fila administrativa | nenhum papel de cliente; provisionado por SQL | enquanto a pessoa exercer a função |
| `moderation_reports` | página, conta, endereço, motivo, detalhe livre de até 500 caracteres, hash diário de quem denunciou, situação, análise | o detalhe pode conter dado pessoal de terceiros; o hash é pseudônimo; **não há contato do denunciante** | apurar abuso e limitar denúncias repetidas | só o administrador da plataforma, pela RPC | **não definida** |
| `profiles.moderation_status` | `active` ou `suspended` | não | tirar do ar uma página denunciada | membros da conta (na linha da página) | vida da página |
| `audit_events` (`legal.*`, `privacy.*`, `moderation.*`) | aceite (versões e hashes), exportações, pedidos, análises, suspensão e reativação com motivo | id do ator; o motivo da moderação é texto livre do administrador | trilha | como as demais ações | 1 ano (provisório) |
| Vault `moderation_signing_secret`; variável `MODERATION_SIGNING_SECRET` | segredo | não | o banco só aceita denúncia assinada pelo servidor | servidor | rotação: trocar os dois juntos |

### Exportação e exclusão por store (estado em 09/10/2026)

"JSON pessoal" é `export_my_data()`; "JSON da conta" é `export_workspace_data()` (só o proprietário); as duas saem por `POST /app/conta/dados/exportar`, com limite de 8 MiB. **A coluna "Exclusão hoje" descreve 09/10/2026.** Desde 11/10/2026 a exclusão de conta é executada pelo administrador da plataforma e os prazos têm expurgo agendado: ver "Sprint 9, continuação" no fim deste arquivo.

| Store | Exportação | Exclusão hoje |
|---|---|---|
| Supabase Auth (`auth.users`) | JSON pessoal: id, e-mail, datas. Nunca credenciais | manual, por último; o pedido só pode ser concluído depois que a linha sumir (`LK114`) |
| `user_accounts`, `workspace_memberships` | JSON pessoal (as próprias) e JSON da conta (todas as da conta) | manual |
| `workspaces`, `profiles` (rascunho), `profile_publications`, `slug_history` | JSON da conta | manual; `soft_delete_workspace` recusa conta com assinatura em curso |
| `media_assets`, `media_asset_shares` | JSON da conta: só o inventário | manual |
| Storage (bucket `media`) | **não exportado**: os arquivos dependem do pedido de pacote completo | manual; o job de limpeza só remove órfãos |
| `form_leads` | JSON da conta (além do CSV por página) | por lead, na tela de contatos; 90 dias provisórios, sem expurgo agendado |
| `analytics_daily` | JSON da conta | manual; 100 dias pelo job diário |
| `analytics_events`, `analytics_rate_hits`, `form_submission_hits` | **exceção:** não exportados (hashes de visitante, sem identificador que localize uma pessoa) | expiram sozinhos (7 dias; 2 dias) |
| `report_links` | JSON da conta, sem o hash do token | manual |
| `report_lookup_failures` | **exceção:** não exportado (hash de endereço) | expira em 24 horas |
| `workspace_invitations` | JSON pessoal (enviados, recebidos, aceitos) e JSON da conta, sem o hash do token | manual |
| `billing_customers`, `billing_subscriptions`, `billing_invoices`, `billing_events` | JSON da conta, **com** os ids do provedor (decisão da revisão pendente) | manual; cancelar no provedor antes. O que fica na Stripe é exceção a registrar |
| `audit_events` | JSON pessoal (ações da pessoa) e JSON da conta | **exceção proposta:** mantido 1 ano |
| `legal_acceptances`, `privacy_requests` | JSON pessoal | aceites caem com `auth.users`; pedidos ficam |
| `moderation_reports` | **não exportado** (a conta denunciada não lê denúncias) | manual |
| `waitlist_signups` | JSON pessoal, pelo e-mail da conta | manual |
| Logs da Vercel e do Supabase, cópias em cache e prévias de link de terceiros | **não exportados** | retenção do fornecedor, não confirmada |

## Dados adicionados na Sprint 8, parte 2 (domínio próprio e pixels)

Decisões: ADR 0016 e ADR 0017. **Fluxos novos para fora do produto, ainda não ligados em nenhum ambiente hospedado:**

- **Vercel (API de domínios):** quando o ambiente tiver `VERCEL_API_TOKEN`, o produto envia à Vercel o **nome do domínio** que o cliente comprovou. A Vercel já é o provedor de hospedagem; o dado novo é a lista de domínios dos clientes.
- **Resolvedores DNS públicos (Cloudflare `1.1.1.1`, Google `8.8.8.8`):** a cada verificação o servidor consulta o TXT `_linkfav.<domínio>`. Eles recebem o nome consultado e o endereço do servidor; nenhum dado de pessoa.
- **Meta e Google (pixels):** o **navegador do visitante**, e só depois do aceite, carrega as bibliotecas desses fornecedores e lhes envia a visita (endereço IP, navegador, URL, cookies do fornecedor), na conta do **dono da página**. O produto não recebe nem guarda esses dados. Tratamento fora do Brasil. **Antes de liberar para clientes:** revisão jurídica dos papéis (dono da página × produto), do texto do aviso e da menção nos Termos e na Política de Privacidade (lista no ADR 0017).

| Store / tabela | Conteúdo | Dado pessoal? | Finalidade | Quem lê | Retenção |
|---|---|---|---|---|---|
| `profile_domains` | conta, página, nome do domínio, desafio (público, vai para o DNS), situação, roteamento, quem registrou (`created_by`), datas | o nome do domínio pode identificar uma pessoa (ex.: `joaosilva.com.br`); `created_by` é identificador de usuário | abrir a página no endereço do cliente e provar o controle | membros da conta | vida da página (cascata); a linha é apagada ao remover o domínio |
| `profile_pixels` | conta, página, ID do Meta Pixel, ID de medição do Google Analytics, quem alterou, data | identificadores de contas de anúncios e medição do cliente; `updated_by` é identificador de usuário | carregar as ferramentas do cliente na página pública | membros da conta; a página pública recebe os dois identificadores | vida da página (cascata); a linha é apagada ao limpar os dois códigos |
| `audit_events` (ações novas) | `domain.claimed`, `domain.verified`, `domain.lapsed`, `domain.removed` com o **nome do domínio**; `pixels.updated` com quais ferramentas estão ligadas (nunca os identificadores) | o nome do domínio, como acima | trilha de mudanças sensíveis | proprietário e administrador | a da trilha (1 ano, provisória) |
| `plan_entitlements` (`tracking_pixels`) | qual plano inclui pixels | não | catálogo | quem tem sessão | permanente |
| Navegador do visitante: `localStorage` `lnk_pixel_consent:<endereço da página>` | a escolha (aceito ou recusado) e os identificadores para os quais ela foi dada | não identifica o visitante; fica só no aparelho dele | lembrar a escolha e não perguntar a cada visita | só a própria página | até o visitante limpar os dados do navegador; nova pergunta se os identificadores mudarem |

**O que não é guardado:** o conteúdo do registro TXT além dos valores no formato do desafio; a resposta da Vercel; quem aceitou ou recusou o aviso; qualquer dado que os pixels enviam.

**Exportação e exclusão:** `profile_domains` e `profile_pixels` **ainda não entram** em `export_workspace_data` (pendência registrada no backlog). Na exclusão de uma página ou conta as duas tabelas saem por cascata; o domínio anexado ao projeto na Vercel **não** é removido por essa cascata e precisa entrar no procedimento de exclusão (Sprint 9).

## Backups do banco (desde 10/10/2026)

O plano Free do Supabase não tem backup gerenciado; os backups são feitos pelo founder com `npm run db:backup` (`docs/runbooks/BACKUP.md`).

| Store | Conteúdo | Dado pessoal? | Finalidade | Quem lê | Retenção |
|---|---|---|---|---|---|
| Pasta `backups/` no computador do founder (ignorada pelo Git) e a cópia que ele guardar fora da máquina | cópia completa de `public`, `auth` e `storage` (contas com e-mail e hash de senha, páginas, contatos de formulários, auditoria, cobrança) e os arquivos de mídia | **sim, tudo o que o banco tem** | recuperar o serviço depois de perda ou erro | só o founder | sugestão do runbook: quatro semanais e os de antes de migrações dos últimos 30 dias. **Sem expurgo automático** |

**Exclusão:** um dado apagado na produção continua nos backups até eles vencerem. Isso precisa constar da resposta a um pedido de exclusão e entrar no procedimento de exclusão quando ele for escrito (Sprint 9). O local da cópia externa é uma decisão do founder ainda não registrada; se for um serviço de nuvem, ele passa a ser um subprocessador.

## Sprint 9, continuação (11/10/2026): CAPTCHA, limites, expurgo agendado e exclusão de conta

Decisão: ADR 0018. Verificado só no stack local; **nada disto está ligado em produção** (o CAPTCHA depende de passos do founder; a migração não foi aplicada).

**Novo subprocessador, quando o CAPTCHA for ligado: Cloudflare (Turnstile).** Nas telas de cadastro, login, reenvio de confirmação e recuperação de senha, o **navegador da pessoa** carrega o Turnstile, que recebe o endereço IP e sinais do navegador para decidir se é uma pessoa. O Supabase Auth confere o resultado com a Cloudflare. O produto não recebe nem guarda esses dados; só repassa o token. Tratamento fora do Brasil. **Antes de ligar:** menção no aviso de privacidade (revisão jurídica). Páginas públicas, relatórios e o painel não carregam o Turnstile.

**Limites por instância** (`lib/security/rate-limit.ts`): o endereço IP é usado, como hash truncado, como chave de um contador **na memória** da instância, por até 1 minuto. Não é gravado em banco nem em log.

**Nenhum dado novo é guardado.** O que muda é que os prazos abaixo passam a ser cumpridos por um job diário (`/api/jobs/retention`), e não mais "na próxima escrita".

| Dado | Prazo | Situação do prazo |
|---|---|---|
| `form_leads` | 90 dias | provisório desde a Sprint 5 |
| `form_submission_hits`, `report_lookup_failures` | 1 dia | definido |
| `workspace_invitations` terminados | 30 dias depois do fim | definido (Sprint 7) |
| `report_links` terminados | 90 dias depois do fim | provisório (Sprint 7) |
| `moderation_reports` decididas; ou nunca decididas, de página que não existe mais | 180 dias | **novo, provisório** (antes: não definido) |
| `privacy_requests` encerrados e `privacy_request_events` | 5 anos | **novo, provisório** (antes: não definido) |
| `audit_events` | 1 ano | provisório desde a Sprint 2 |
| `slug_history` | 1 ano depois do fim da reserva | definido (Sprint 2) |
| `profiles` e `workspaces` excluídos | 30 dias depois da exclusão, depois que as imagens saíram do bucket | definido (Sprint 2) |

`user_accounts.purge_after` continua sem uso: uma conta de acesso só é apagada pela exclusão de conta abaixo.

### Exclusão de conta (substitui a coluna "Exclusão hoje" da tabela de 09/10/2026)

A exclusão deixou de ser manual store a store: um administrador da plataforma a executa pela fila, para um pedido em análise (`docs/runbooks/ACCOUNT_DELETION.md`). **Nunca executada em produção.**

| Store | O que a exclusão de conta faz |
|---|---|
| Supabase Auth (`auth.users`), `user_accounts`, `legal_acceptances`, `platform_admins` | apagados (cascata da linha do Auth) |
| `workspaces` em que a pessoa é proprietária, com `workspace_memberships`, `profiles`, `profile_publications`, `form_leads`, `analytics_events`, `analytics_daily`, `report_links`, `workspace_invitations` enviados, `profile_domains`, `profile_pixels`, `media_asset_shares`, `billing_customers`, `billing_subscriptions`, `billing_invoices` | apagados (cascata da conta) |
| `media_assets` e arquivos do bucket `media` dessas contas | apagados antes das linhas, pelo job de limpeza |
| `workspace_invitations` endereçados ao e-mail da pessoa; `waitlist_signups` com o e-mail dela | apagados |
| `workspace_memberships` em contas de outras pessoas | apagados; o conteúdo fica com a conta |
| Cache das páginas públicas | invalidado na hora |
| Domínio anexado na Vercel | desanexado pelo adaptador (não verificado contra a Vercel real) |
| `privacy_requests`, `privacy_request_events` | **ficam** 5 anos: prova do atendimento; contêm o identificador do usuário e a referência do dossiê, nunca o e-mail |
| `audit_events`, `slug_history` | **ficam** pelo prazo próprio; a pessoa aparece só como identificador que não leva mais a ninguém |
| `moderation_reports` sobre páginas dela | **ficam** pelo prazo das denúncias |
| `billing_events` | ficam até o expurgo do job de cobrança (90 dias); não contêm dado pessoal |
| Stripe (cliente, faturas, recibos) | **fica** na Stripe: exceção por obrigação fiscal, a confirmar na revisão contábil |
| Backups | **ficam** até vencer; restaurar um backup anterior exige refazer a exclusão |
| Logs da Vercel e do Supabase | prazo do fornecedor |

**Bloqueios:** assinatura que não terminou e conta com outros membros impedem a exclusão até serem resolvidos pelo operador (runbook, passo 2).

**Pendente:** revisão jurídica dos prazos novos e da resposta ao titular; exportação dos arquivos de mídia; domínios e pixels na exportação da conta; aviso por e-mail ao titular (não há e-mail transacional).

## Sprint 9, parte 3 (11/10/2026): suspensão, contestação e monitor

Decisão: ADR 0019. Verificado só no stack local; a migração não foi aplicada em produção. **Nenhum subprocessador novo:** o monitor roda no GitHub Actions, que já era usado para a integração contínua, e só lê contagens.

| Store / tabela | Conteúdo | Dado pessoal? | Finalidade | Quem lê | Retenção |
|---|---|---|---|---|---|
| `moderation_suspensions` | página, conta, categoria do motivo, quando foi suspensa e quando voltou | não | dizer ao dono por que a página saiu do ar | membros da conta, pela função `get_page_moderation`; administrador da plataforma | vida da página (cascata). **Sem expurgo próprio** para suspensões já encerradas |
| `moderation_appeals` | texto livre da contestação (até 1.000 caracteres), quem enviou, situação, resposta escrita pelo administrador (até 500), quem decidiu, datas | **sim**: texto livre de um membro da conta, que pode citar pessoas; identificadores de quem enviou e de quem decidiu | permitir a defesa do dono da página e registrar a resposta | proprietário e administrador da conta (o texto); editores (só situação e resposta); administrador da plataforma | vida da página (cascata). **Sem expurgo próprio** |
| `job_runs` | nome do job, horário e resultado da última execução | não | alertar quando um job para | só a função de status (papel de serviço) | uma linha por job, sobrescrita |
| `audit_events` (ações novas) | `moderation.appealed`, `moderation.appeal_decided`, com o identificador da contestação; **nunca o texto** | id do ator | trilha | proprietário e administrador | a da trilha (1 ano, provisória) |
| Logs `moderation.appeal`, `ops.status` | desfecho; nomes das verificações que falharam | não | operação | retenção do provedor de logs |
| Log público do workflow *Monitor* no GitHub | a resposta de `/api/ops/status`: contagens, durações e códigos de motivo | não (a rota não devolve e-mail, endereço de página nem identificador) | alerta | **qualquer pessoa** (o repositório é público) | retenção do GitHub Actions (90 dias por padrão) |

**Exportação e exclusão:** suspensões e contestações **não entram** em `export_workspace_data` (pendência). Na exclusão de página ou de conta saem por cascata; `created_by` e `decided_by` ficam nulos se a pessoa for excluída.
