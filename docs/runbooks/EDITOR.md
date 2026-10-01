# Runbook — editor por blocos e autosave

**Owner:** founder técnico. **Ferramentas:** logs da aplicação filtrados por `event` (`editor.save`, `editor.load_latest`, `publishing.*`); tabelas `profiles` (`blocks`, `draft_revision`, `updated_at`) e `profile_publications`; `docs/adr/0008-block-model-and-editor.md`.

Regras gerais:

- Nunca editar `profiles.blocks` à mão em produção sem ticket: o validador `private.validate_profile_draft` recusa conteúdo fora do contrato, e qualquer escrita incrementa `draft_revision` (as abas abertas passam a ver conflito).
- Nunca registrar no ticket o conteúdo dos blocos, telefones ou e-mails da página; use o id da página.

## 1. "Minhas alterações não foram salvas"

1. Pergunte qual status o editor mostrava. Há cinco textos possíveis: "Salvo", "Salvando…", "Alterações não salvas", "Não salvo: corrija os campos destacados", "Não foi possível salvar", além do aviso de conflito.
2. **"Não salvo: corrija os campos destacados"**: um bloco tem campo inválido (link recusado, telefone incompleto, bloco novo vazio). Nada é enviado até corrigir ou excluir o bloco. Páginas criadas antes da Sprint 4 podem ter links que a política atual recusa (por exemplo host sem ponto); o bloco aparece com o selo "Precisa de ajuste".
3. **"Não foi possível salvar"**: procure `editor.save` da sessão.
   - `unauthenticated`: sessão expirou. A pessoa entra de novo em outra aba e clica **Tentar novamente**; a cópia local continua na aba original.
   - `forbidden` / `not_found`: perdeu o papel no workspace, workspace suspenso ou página excluída. Confirme em `workspace_memberships` / `workspaces.status` / `profiles.deleted_at`.
   - `validation`: o servidor recusou o conteúdo. Se a UI mostrava tudo válido, é divergência entre `modules/blocks` e o SQL: abra bug P2 com o id da página.
   - `unavailable` ou nenhum log: banco ou servidor fora. Veja `/api/health` e o status do Supabase; o editor tenta três vezes (1 s, 2 s, 4 s) e depois espera **Tentar novamente**.
4. Se a pessoa fechou a aba ignorando o aviso de saída, o que não foi confirmado pelo servidor se perdeu; o rascunho no banco é o último "Salvo".

## 2. Conflito entre duas abas (ou duas pessoas)

1. O editor mostra "Esta página foi alterada em outro lugar" quando outra aba/pessoa salvou depois da última leitura (`draft_revision` mudou).
2. Oriente: **Carregar a versão mais recente** descarta as alterações desta aba; **Manter as minhas alterações** substitui a versão salva em outro lugar. As duas pedem confirmação. Nada é sobrescrito sem escolha.
3. Não há mesclagem automática nem histórico do rascunho (só das publicações). Se a pessoa escolheu errado e o conteúdo perdido estava publicado, dá para recuperá-lo lendo a versão publicada em "Versões publicadas".
4. Muitos conflitos na mesma conta indicam edição simultânea por vários membros; edição colaborativa em tempo real está fora do escopo pré-lançamento (AGENTS.md §18).

## 3. Link malicioso publicado (phishing, malware, golpe)

1. Esquemas perigosos (`javascript:`, `data:` etc.) não entram: são recusados na UI, no servidor e no banco. O caso real será um destino `https` legítimo tecnicamente, mas malicioso.
2. Até existir moderação (Sprint 9): identifique a página pelo endereço, confirme o conteúdo no snapshot no ar (`profile_publications.document`) e tire do ar pelo fluxo do `PUBLIC_PAGE.md` §4 (suspensão do workspace ou despublicação pela conta do cliente, com registro no ticket).
3. Se o domínio malicioso aparecer em várias contas, registre para a futura lista de bloqueio de domínios (pendente).
4. Hosts com acento aparecem em punycode (`xn--`) no editor; um host em punycode imitando uma marca é sinal forte de homógrafo.

## 4. Página publicada antes da Sprint 4 aparece diferente

Snapshots da versão 1 continuam sendo servidos: as redes sociais do cabeçalho viram um bloco social logo abaixo da bio (mesma posição visual). Links que a política nova recusa (host sem ponto, por exemplo) deixam de aparecer na página até a pessoa corrigir e publicar de novo.

## 5. Rollback da aplicação para antes da Sprint 4

Não suportado sem preparação (ADR 0008): o renderer da Sprint 3 não lê documentos da versão 2 e o formulário antigo regravaria só os blocos de link. Se for inevitável, faça o rollback só depois de restaurar em cada página uma versão publicada na versão 1 — ou prefira corrigir para frente.
