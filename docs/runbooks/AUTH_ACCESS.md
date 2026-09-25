# Runbook — acesso e autenticação

**Owner:** founder técnico. **Ferramentas:** dashboard do Supabase (Auth → Users, Logs), logs da aplicação filtrados por `event` e `correlationId`, tabela `audit_events`.

Regras gerais:

- Nunca pedir senha, link recebido por e-mail ou código ao usuário. Nunca colar tokens em tickets ou chats.
- Não confirmar a terceiros se um e-mail tem conta. Responder somente ao dono do e-mail, pelo próprio e-mail.
- Toda ação administrativa manual deve ser anotada no ticket com data, motivo e quem executou.

## 1. Pessoa não consegue entrar

1. Peça somente o e-mail e o horário aproximado da tentativa. Não peça a senha.
2. No Supabase (Auth → Users), confira se o usuário existe e se `email_confirmed_at` está preenchido.
   - Não confirmado → orientar a usar **/confirmar-email** para reenviar o link (seção 2).
   - Confirmado → orientar **/recuperar-acesso**.
3. Verifique nos logs `auth.sign_in` com `outcome`:
   - `rate-limited`: aguardar a janela (5 min) e checar se o IP está sendo usado por várias contas (possível abuso).
   - `unavailable`: incidente do Auth → seguir `INCIDENT.md` (P1).
4. Se o usuário existe, entra, mas não vê páginas: consultar `workspace_memberships` pelo `user_id`. Sem workspace pessoal → procurar `identity.personal_workspace_failed`; o próximo acesso a `/app` reexecuta `ensure_personal_workspace()`. Se persistir, abrir incidente (não criar linhas manualmente sem registrar).

## 2. E-mail de verificação ou recuperação não chegou

1. Confirmar caixa de spam e o endereço digitado (sem revelar existência de conta a terceiros).
2. Local: abrir o Mailpit (`http://127.0.0.1:54324`).
3. Hospedado: Auth → Logs, procurar envio para o usuário; verificar limites de envio do SMTP e do projeto.
4. Links expiram em 1 hora e valem uma vez. Logs `auth.email_link` com `rejected` em sequência podem indicar que um scanner corporativo abriu o link antes da pessoa: pedir novo link e, se recorrente, priorizar a página de confirmação com botão (ADR 0005).
5. Sem SMTP próprio configurado, projetos hospedados podem não enviar os templates `token_hash` — ver checklist em `docs/ENVIRONMENTS.md`.

## 3. Suspeita de tomada de conta

1. Classificar como P1 (P0 se houver vazamento ou alteração de páginas de terceiros).
2. Consultar `audit_events` do usuário (`actor_user_id`) e dos workspaces em que é owner/admin: `auth.sign_in`, `auth.password_reset_completed`, `profile.slug_changed`, `membership.role_changed`, `profile.deleted`.
3. Conter: no dashboard, encerrar as sessões do usuário ("Sign out user"/revogar refresh tokens) e, se necessário, banir temporariamente. Lembrar que access tokens já emitidos valem até expirar (`jwt_expiry` = 1 h).
4. Orientar o dono legítimo a redefinir a senha por **/recuperar-acesso** (a redefinição encerra todas as sessões).
5. Reverter mudanças feitas pelo invasor com base na trilha (ex.: slug alterado pode ser retomado pelo mesmo workspace durante os 90 dias de retenção).
6. Registrar linha do tempo; avaliar obrigações LGPD com assessoria.

## 4. Chave vazada

| Chave | Impacto | Ação imediata |
|---|---|---|
| `SUPABASE_SECRET_KEY` / service role | acesso total ao banco, ignora RLS | P0. Rotacionar no dashboard (API Keys), atualizar o segredo no ambiente, redeploy, revisar logs do período e `audit_events`. |
| Publishable key | pública por desenho; RLS protege os dados | Rotacionar apenas se houver abuso de volume; conferir rate limits. |
| JWT signing key | forja de sessões | P0. Rotacionar signing keys no Supabase, invalidar sessões, revisar acessos. |
| SMTP/Resend | envio de phishing em nome do produto | Revogar no provedor, trocar credencial no Auth, revisar envios. |

Depois de qualquer rotação: confirmar `npm run check`/deploy, testar cadastro → confirmação → login em staging e registrar no incidente.
