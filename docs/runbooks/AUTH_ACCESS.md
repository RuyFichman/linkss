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
6. **"Clicou no link e caiu em Entrar com o aviso de que o e-mail provavelmente já foi confirmado"** (`/entrar?email=confirmado`; log `auth.email_link` com `type: code` e `outcome: rejected`). Isso só acontece com os templates padrão (fluxo PKCE). O Supabase já confirmou o e-mail no `/verify`, mas a troca do código pela sessão falhou. Há duas causas:
   - `bad_code_verifier`: outro cadastro ou reenvio no mesmo navegador trocou o cookie. Visto no staging em 02/10/2026.
   - O link foi aberto em outro navegador ou aparelho.

   Orientar a pessoa a entrar com e-mail e senha. Se o login responder "e-mail não confirmado", ela pede novo link pela tela. A correção definitiva é SMTP próprio com templates `token_hash`, que não dependem de cookie.

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

## 5. Alguém não consegue aceitar um convite

Nunca peça o link nem o token por um canal aberto: quem tem o link e o e-mail certo entra na conta.

1. **O que a pessoa vê?**
   - *"Este convite não é válido"*: o link expirou (7 dias), foi cancelado, já foi usado ou foi substituído por um convite mais novo para o mesmo e-mail. Peça a quem administra a conta que crie outro em *Membros → Convidar pessoa*. Um link perdido não é recuperável: só o hash é guardado.
   - *"Este convite é para outro e-mail"*: a pessoa entrou com uma conta diferente da convidada. Ela deve sair e entrar (ou se cadastrar) com o e-mail convidado, ou a conta deve convidar o e-mail que ela usa.
   - *"Esta conta está sem lugares livres"*: o plano mudou ou alguém entrou por outro caminho depois do convite. Quem administra remove alguém ou cancela outro convite; o mesmo link volta a funcionar enquanto não expirar.
   - *Tela de login*: normal para quem não tem sessão; depois de entrar, o convite abre sozinho. Quem **se cadastra** volta ao convite depois de confirmar o e-mail só no mesmo aparelho; em outro, basta abrir o link de novo.
2. **Conferir no banco** (somente leitura), pelo e-mail convidado e pela conta:
   ```sql
   select id, role, created_at, expires_at, revoked_at, accepted_at
   from public.workspace_invitations
   where workspace_id = '<conta>' and email = lower('<e-mail>')
   order by created_at desc;
   ```
   `expires_at` no passado, `revoked_at` ou `accepted_at` preenchido explicam o estado genérico.
3. **A pessoa confirmou o e-mail?** Sem confirmação não há sessão (ver seção 2).
4. **Logs:** `members.accept_invitation` com `outcome` `invalid`, `wrong_account`, `limit_reached` ou `unavailable`. O log não tem e-mail nem token; use o horário e o `correlationId`.
5. `outcome=not_deployed` ou tela "ainda não disponível": a migração da Sprint 7 não foi aplicada nesse ambiente.

## 6. Um membro está com o acesso errado

1. **Ver a participação atual** (o que vale é o banco, relido a cada requisição):
   ```sql
   select m.id, m.role, m.status, m.accepted_at, m.revoked_at
   from public.workspace_memberships m
   where m.workspace_id = '<conta>' and m.user_id = '<usuário>';
   ```
2. **Corrigir pela interface**, em *Membros*: alterar papel ou remover. Só proprietário promove a proprietário; administrador não mexe em proprietário. A mudança vale na requisição seguinte da pessoa; não é preciso derrubar a sessão dela.
3. **"A conta precisa de pelo menos um proprietário"** (`LK020`): torne outra pessoa proprietária antes de rebaixar ou remover a atual.
4. **Quem mudou?** A trilha da conta tem `membership.role_changed` (de/para), `membership.removed` e `invitation.accepted` (papel e participação), com autor e horário:
   ```sql
   select created_at, action, actor_user_id, target_id, metadata
   from public.audit_events
   where workspace_id = '<conta>' and (action::text like 'membership.%' or action::text like 'invitation.%')
   order by created_at desc limit 50;
   ```
5. **Suspeita de acesso indevido** (alguém entrou com um link que não era dele): o convite só é aceito pelo e-mail convidado; confira `accepted_by` no convite e trate como tomada de conta do e-mail (seção 3). Remova a participação e cancele os convites pendentes.
6. **Nunca** altere `workspace_memberships` direto em produção para "resolver rápido": as RPCs escrevem a trilha e aplicam a regra do último proprietário.
