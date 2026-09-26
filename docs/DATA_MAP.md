# Mapa inicial de dados pessoais

| Categoria | Exemplos | Finalidade | Retenção inicial |
|---|---|---|---|
| Conta | e-mail, nome, identificadores de auth | acesso e comunicação operacional | vida da conta + prazo legal/segurança definido |
| Workspace | membros, papéis, convites | colaboração e autorização | vida do workspace |
| Perfil público | nome, avatar, bio, links | publicação solicitada pelo cliente | até remoção/despublicação e cache expirar |
| Leads | campos escolhidos pelo cliente | encaminhar contato ao controlador do perfil | configurável; padrão curto e exportável |
| Analytics | URL/referrer, UTM, dispositivo, região aproximada | medir desempenho | bruto 7 dias; agregados conforme plano/política |
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
| `public.profiles` | título, bio e, futuramente, avatar (chave de storage) — conteúdo que o cliente decide publicar | página do cliente | execução do contrato | soft delete com `purge_after = deleted_at + 30 dias`; publicação pública só a partir da Sprint 3 |
| `public.slug_history` | endereço liberado, página e workspace de origem, quem liberou | impedir sequestro/impersonação de endereços recém-usados; suporte | legítimo interesse (segurança) | manter ao menos até `hold_until` (90 dias) + 1 ano; purge na Sprint 9 |
| `public.audit_events` | id do ator, ação, alvo, metadados mínimos (método, correlation id, slug antigo/novo, papéis) — **nunca** e-mail completo, token, senha, cookie ou IP | trilha de segurança e investigação | legítimo interesse / obrigação de segurança | 1 ano (provisório); purge pelo job da Sprint 9 executado como `postgres`; append-only para todos os papéis de cliente |
| Logs estruturados da aplicação | correlation id, evento, resultado, código de erro; e-mails mascarados e chaves sensíveis descartadas | operação e diagnóstico | legítimo interesse | conforme retenção do provedor de logs (Vercel/Sentry, a definir antes do piloto) |

### Purge planejado (documentado, não agendado)

O job da Sprint 9 deverá, em transação e com trilha própria:

1. apagar `profiles` com `purge_after < now()`;
2. apagar `workspaces` com `purge_after < now()` (cascateia memberships e páginas remanescentes);
3. apagar `user_accounts` com `purge_after < now()` e a respectiva linha em `auth.users` via Admin API;
4. apagar `audit_events` com mais de 1 ano e `slug_history` com `hold_until` há mais de 1 ano.

Índices parciais em `purge_after` e `created_at` já existem para esse job.

## Regras

- Não coletar dado sem finalidade e owner.
- Não guardar cartão; usar token/ID do provedor.
- Não usar analytics do visitante para advertising por padrão.
- Separar analytics do cliente de telemetria interna.
- Permitir exportação e exclusão; registrar exceções legais.
- Formalizar controladores/operadores e transferência internacional antes do beta pago.
