# Mapa inicial de dados pessoais

| Categoria | Exemplos | Finalidade | Retenção inicial |
|---|---|---|---|
| Conta | e-mail, nome, identificadores de auth | acesso e comunicação operacional | vida da conta + prazo legal/segurança definido |
| Workspace | membros, papéis, convites | colaboração e autorização | vida do workspace |
| Perfil público | nome, avatar, bio, links | publicação solicitada pelo cliente | até remoção/despublicação e cache expirar |
| Leads | campos escolhidos pelo cliente | encaminhar contato ao controlador do perfil | 90 dias (provisório), exportável; ver Sprint 5 abaixo |
| Analytics | categoria de origem (nunca a URL ou o host do referrer), UTM, classe de aparelho, país, hash diário do visitante | medir desempenho | bruto 7 dias; agregados 100 dias, visíveis conforme o plano; ver Sprint 6 abaixo |
| Cobrança | IDs do provedor, status, faturas | assinatura e obrigações legais | prazo fiscal/contratual aplicável |
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
