# Runbook — página pública e publicação

**Owner:** founder técnico. **Ferramentas:** logs da aplicação filtrados por `event`; cabeçalho `x-nextjs-cache`; tabelas `profiles`, `profile_publications`, `audit_events`; dashboard da Vercel (quando provisionada).

Regras gerais:

- Nunca editar `profile_publications` à mão (é imutável por design). Para mudar o que está no ar, publicar, restaurar ou tirar do ar pelo app, ou pelas RPCs com a sessão de um membro.
- Toda ação manual fica registrada no ticket com data, motivo e quem executou.

## 1. "Publiquei e a página não mudou"

1. Confirme no app o estado do painel **Publicação** e a versão marcada **No ar**.
2. `curl -sI https://<dominio>/<endereco>`: `x-nextjs-cache: HIT` com conteúdo antigo por mais de 60 s indica que a invalidação falhou. Procure `publishing.publish` com `outcome=ok` e a versão esperada.
3. O conteúdo novo aparece no máximo 60 s após a última visita (fallback). Se continuar antigo, faça um novo deploy (limpa o cache) e abra incidente.
4. Prévias no WhatsApp/Instagram usam o cache deles. Não conseguimos forçar a atualização.

## 2. Página publicada com erro ou conteúdo errado (rollback)

1. No app: **Versões publicadas → Restaurar** na última versão boa. Ela vai ao ar na hora; o rascunho não muda.
2. Sem acesso ao app: a pessoa responsável (owner/admin/editor) faz isso na conta dela. O suporte não publica em nome do cliente.
3. Confirme em `audit_events` (`profile.publication_restored`) e na página.

## 3. Páginas novas com erro 500 ("Não foi possível carregar esta página")

1. Procure `public_page.lookup_failed` e `request.error` com `routePath=/[slug]`.
2. Timeout (`durationMs ≈ 4000`) ou erro de conexão indica banco ou API do Supabase indisponível. Siga `INCIDENT.md` (P1). Páginas já em cache continuam no ar (`STALE`) durante a falha.
3. `public_page.invalid_document` indica bug de contrato entre o snapshot e o renderer (P1). Restaure a versão anterior da página afetada e corrija o código.

## 4. Denúncia de phishing/impersonação (até existir a moderação da Sprint 9)

1. Registre a denúncia com o endereço e evidências. Não contate o dono da página por canais sugeridos na denúncia.
2. Se confirmado, suspenda o workspace (`update public.workspaces set status = 'suspended' where id = …`, executado como `postgres` e anotado no ticket). A página passa a mostrar "Página indisponível" em no máximo 60 s. Para efeito imediato, faça um novo deploy.
3. Suspensão bloqueia também edição e publicação. A reversão é `status = 'active'`.
4. Moderação por página e fluxo de denúncia público são requisitos antes do lançamento aberto (`docs/THREAT_MODEL.md`).

## 5. Endereço antigo ainda abre a página

É esperado: por 90 dias após uma troca de endereço, o endereço antigo redireciona (307) para o novo enquanto a página estiver publicada (UX-020). Tirar a página do ar ou excluí-la encerra o redirecionamento.

## 6. Web Vitals ruins

1. Agrupe `web_vital` por `name` nas últimas 24 h. A meta é LCP p75 ≤ 2,5 s e CLS p75 ≤ 0,1.
2. Compare com o deploy anterior. Regressões de bundle aparecem primeiro em FCP/LCP.
3. Medição de laboratório: Lighthouse mobile. Em máquinas com antivírus que injeta scripts em HTTP, bloqueie o domínio do antivírus na medição (ver `docs/SPRINT_3_REPORT.md`).
