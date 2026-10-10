# Relatório da Sprint 9 — segurança, LGPD, abuso e prontidão operacional

**Data:** 09/10/2026. **Branch:** `codex/sprint-9-private-mvp`, criada de `4a09b21` (o conteúdo da PR #25, já em `main`). **Estado: sprint parcial; o gate do MVP privado não está liberado.**

A sprint foi feita em duas sessões. A primeira (Codex) escreveu o código, as migrações, o teste de banco e as minutas, e parou sem acesso ao banco local: as migrações nunca tinham sido aplicadas. A segunda (Claude Code) aplicou as migrações no stack local, corrigiu o que os testes de banco revelaram, regenerou os tipos, conferiu no navegador e reescreveu este relatório, que antes citava documentos que não tinham sido alterados.

Nada foi aplicado em staging ou produção: nenhuma migração, segredo, configuração de borda ou texto jurídico.

## Objetivo e resultado

O objetivo de `PLANO_DE_EXECUCAO.md` é transformar o produto funcional em um MVP privado operável. Esta entrega põe no repositório: aceite versionado, exportação JSON, pedidos auditáveis de acesso e de exclusão, denúncia pública, fila de moderação com suspensão e reativação por página, headers de segurança com CSP, leitura limitada do corpo nos endpoints anônimos, a atualização do Next para 16.4.0 e as minutas jurídicas para revisão.

**Não foram feitos:** backup e restauração, runbooks novos, alertas, limites globais na borda, QA em Edge e em celular, revisão de acessibilidade, seed/demo e documentação de suporte. A exclusão de conta é só um pedido registrado: a execução é manual e não tem procedimento escrito.

## Decisões

- **ADR 0015.** Textos jurídicos ficam em `legal_documents`, com uma versão ativa por tipo, corpo imutável depois de ativado e SHA-256 calculado pelo Postgres. Nenhuma minuta entra no seed nem é ativada por migração desta sprint. Termos e Aviso de Privacidade ativos exigem aceite explícito de quem tem sessão; uma versão nova exige novo aceite. A política de cookies é só informativa. Ativar apenas um dos dois textos bloqueia a área autenticada até o operador corrigir.
- **Exportação pessoal separada da exportação da conta.** Só o proprietário baixa o JSON da conta (rascunhos, publicações, leads, agregados, convites, links de relatório, cobrança). Hashes de visitante, hashes de token e arquivos de mídia ficam fora. Limite de 8 MiB por download.
- **Exclusão é pedido, não expurgo.** Assinatura em curso ou outras pessoas numa conta que a pessoa administra põem o pedido em `needs_action`. A fila administrativa registra cada transição e não deixa concluir uma exclusão enquanto a linha de `auth.users` existir. Nenhum prazo legal de guarda foi inventado.
- **Denúncia anônima com resposta neutra.** Página inexistente, denúncia repetida e limite atingido recebem a mesma confirmação. O banco só aceita denúncia assinada pelo servidor (HMAC conferido contra o Vault). Limites: 3 por endereço e 30 por página a cada 24 horas.
- **Administrador da plataforma fora da aplicação.** `platform_admins` é preenchida por SQL; nenhum papel de conta suspende ou reativa página.
- **Filas administrativas só por RPC** (decisão da segunda sessão). `moderation_reports` não tem leitura por nenhum papel de cliente, e `privacy_requests` só mostra as linhas da própria pessoa. Assim nenhum papel de cliente precisa executar funções do schema `private`, e as regras de `010-structure` continuam valendo.
- **CSP com `unsafe-inline`** para scripts e estilos, porque o App Router emite scripts inline e o tema usa estilos inline. Uma política com nonce tornaria dinâmica a página pública em cache e precisa de desenho próprio. O CSP atual bloqueia objetos, frames fora da lista de embeds, atributos de evento e envio de formulário para outra origem; não é defesa completa contra XSS.

## Correções feitas na segunda sessão

| Problema encontrado | Correção |
|---|---|
| `202610090004_legal_privacy` não aplicava: a coluna gerada `body_sha256` chamava `convert_to`, que não é imutável (`42P17`) | função `private.text_sha256` marcada `immutable`, usada pela coluna |
| `anon` recebia `select` em `legal_documents`, contra a regra "anon não tem privilégio de tabela em `public`" | concessão removida; visitante lê o texto ativo pela RPC `get_legal_status` |
| quatro funções novas de `private` ficavam executáveis por `authenticated` e três por `anon` | `revoke` explícito; as políticas deixaram de chamar `private.is_platform_admin` |
| o teste 180 esperava `LK115` de uma usuária que nem tem permissão de escrita na tabela, e lia a fila direto da tabela como administrador | o teste passa a provar a imutabilidade como operador e usa as RPCs da fila |
| `010-structure` não conhecia as duas RPCs anônimas novas | lista atualizada: `get_legal_status` e `submit_moderation_report` |
| chamadas de RPC com `as never` porque os tipos não existiam | tipos regenerados (`npm run db:types`) e casts removidos |

## Critérios de aceite

| Critério | Estado | Evidência e pendência |
|---|---|---|
| Termos, Privacidade e Cookies com aceite versionado | **Implementado e verificado no banco local; textos não aprovados** | `docs/legal/`, migração `202610090004`, `/aceite`, `/termos`, `/privacidade`, `/cookies`; pgTAP 180 (aceite, repetição, hash errado, versão nova, histórico, outra conta). A tela `/aceite` não foi exercitada no navegador. Nenhuma versão ativa. |
| Exportação e exclusão percorrem todos os stores ou registram exceção | **Parcial** | exportação e pedidos verificados por pgTAP 180 (outra conta, editor, anônimo, repetição). Inventário por store em `docs/DATA_MAP.md`. Faltam: execução da exclusão, exportação dos arquivos de mídia, retenções aprovadas. As telas não foram exercitadas no navegador com sessão. |
| Rate limits, enumeração, CSRF/XSS/SQLi, autorização/RLS, headers/CSP | **Parcial** | headers e CSP em todas as respostas (Vitest `security.test.ts`; conferidos por `curl` e no Chrome). Leitura limitada em `/api/events` e `/api/vitals`. Revisão transversal em `docs/THREAT_MODEL.md`. **Sem limite global na borda**, sem CAPTCHA. |
| Nenhuma vulnerabilidade crítica/alta conhecida | **Não atendido** | `npm audit --omit=dev`: zero. `npm audit` completo: 5 avisos altos na cadeia de desenvolvimento `eslint-config-next → braces`, sem correção publicada. |
| Denúncia, fila, investigação, suspensão e reativação auditadas | **Implementado e verificado localmente** | pgTAP 180 (sem assinatura, página inexistente, repetida, dono tentando suspender, suspensão, reativação). Uma denúncia enviada pelo Chrome chegou à tabela e à auditoria. A fila administrativa não foi exercitada no navegador. Faltam aviso ao dono e contestação. |
| Backup restaurado em ambiente isolado | **Não iniciado** | nenhum procedimento escrito, nenhuma restauração feita. |
| Runbooks de renderer, jobs e webhooks; alertas com responsável, limiar e ação | **Não iniciado** | nenhum arquivo em `docs/runbooks/` nem `docs/OBSERVABILITY.md` mudou nesta sprint. |
| Smoke em Chrome, Edge e Safari móvel; acessibilidade prioritária | **Não atendido** | só Chrome de desktop, sem sessão: página pública, `/denunciar`, `/termos`, `/cookies`, `/privacidade`, `/entrar`. Edge, celular e leitor de tela não testados. |
| Seed/demo e documentação de suporte | **Não iniciado** | `supabase/seed.sql` não mudou. |

## Entregáveis para revisão

| Área | Arquivos / rotas |
|---|---|
| Jurídico | `docs/legal/{TERMOS_DE_USO_MINUTA,AVISO_DE_PRIVACIDADE_MINUTA,COOKIES_MINUTA,REVISAO_JURIDICA}.md`; `/termos`, `/privacidade`, `/cookies` |
| Aceite e privacidade | `apps/web/src/modules/legal/`, `apps/web/src/modules/privacy/`, `/aceite`, `/app/conta/dados`, `/app/administracao/privacidade`; migrações `202610090003` e `202610090004` |
| Moderação | `apps/web/src/modules/moderation/`, `/denunciar`, `/app/administracao/denuncias`; migração `202610090005` |
| Segurança | `apps/web/next.config.ts`, `apps/web/src/lib/security/`, `apps/web/src/lib/same-origin.ts`, `/api/events`, `/api/vitals`, `docs/THREAT_MODEL.md` |
| Dados e deploy | `docs/DATA_MAP.md` (stores novos e inventário de exportação/exclusão), `docs/ENVIRONMENTS.md` ("Passos de deploy da Sprint 9"), `docs/adr/0015-legal-privacy-and-moderation.md` |
| Testes | `supabase/tests/database/180-sprint9-privacy-moderation.test.sql`, `010-structure.test.sql`, `security.test.ts`, `moderation/contract.test.ts` |

## Verificação realizada (09/10/2026, stack local)

- `npm run check`: **passou**. Lint sem avisos; TypeScript sem erros; Vitest **1.144 testes em 41 arquivos**; build de produção concluído com as rotas novas.
- `npx supabase test db`: **1.156 asserções em 20 arquivos, todas aprovadas**, com as três migrações aplicadas por `supabase migration up`. O arquivo 180 tem 40 asserções.
- `npx supabase db lint --level warning`: um aviso, anterior a esta sprint (`private.billing_text_is_timestamp`, da Sprint 8).
- Build de produção servido em `localhost:3100`: as dez rotas novas e alteradas responderam (200, ou 307 para o login nas que pedem sessão); os cinco headers presentes na página pública, que manteve `s-maxage=60`.
- Chrome de desktop: a página pública `precisao-analytics` renderizou e hidratou, sem violação de CSP no console. Uma denúncia enviada por `/denunciar` foi gravada com hash de endereço e evento de auditoria. A linha de teste e o segredo temporário do Vault local foram removidos depois.
- **Não verificado em 09/10:** o carregamento do embed depois do clique sob o CSP; as telas com sessão; o editor e o upload de imagem sob o CSP; qualquer coisa em staging. Os três primeiros foram cobertos na estabilização abaixo.

## Estabilização (10/10/2026, stack local, depois do merge do PR #26)

Revisão do código da sprint e verificação em navegador (Chrome via Playwright, build de produção em `localhost:3100`, contas descartáveis `qa-s9-*@example.test`, removidas ao final). Defeitos encontrados e corrigidos:

- **Horários no fuso do servidor.** *Meus dados* e as duas filas usavam `toLocaleString` sem fuso; na Vercel sairiam em UTC, três horas à frente. Passaram a usar `formatDateTime` (horário de São Paulo).
- **Publicar página suspensa pedia para tentar de novo.** O erro `LK113` caía em "Não foi possível publicar agora". Agora o dono lê que a página foi suspensa pela moderação.
- **Denúncia recusada aparecia como recebida.** Uma resposta `invalid` do banco (carga recusada, relógio fora da janela de 5 minutos) levava à confirmação. Agora só `received` confirma; o resto mostra canal indisponível.
- **Um só texto jurídico ativo travava `/app`.** O portão exigia aceite com apenas Termos ou apenas Privacidade ativo, mas `/aceite` só registra os dois juntos. O portão (`modules/legal/gate.ts`, com teste) agora fecha apenas com os dois ativos.

Verificado no navegador, 27 verificações aprovadas: `/app` sem redirecionar para `/aceite` (nenhum texto ativo); *Meus dados* a 390 px sem rolagem horizontal; download do JSON pessoal (sem campo de credencial) e do JSON da conta; pedidos de acesso e de exclusão no histórico, sem duplicar e sem apagar nada; filas vistas pelo administrador da plataforma e tela de "não encontrada" para conta comum; suspensão pela fila, estado suspenso na página pública logo depois, mensagem ao dono ao publicar e reativação; página pública com o player do YouTube aberto pelo clique, sem violação de CSP. A regressão do editor móvel (`scripts/editor-mobile.mjs`, 45 verificações, inclui envio de imagem) passou sob o CSP.

- `npm run check`: **passou**; Vitest **1.148 testes em 42 arquivos**.
- **Continua não verificado:** `/aceite` com textos ativos (ativá-los no banco local prenderia as contas de teste do fundador; o fluxo tem só pgTAP); envio de denúncia pelo formulário nesta rodada (a denúncia da fila foi inserida por SQL; o envio foi verificado em 09/10); Vimeo e Spotify; Edge, celular real e staging.
- **Observações sem correção:** as filas respondem 200 com a tela de "não encontrada" para quem não é administrador (o `loading.tsx` de `/app` inicia a resposta antes), sem expor dados; sem `VISITOR_HASH_SALT` ou sem endereço do visitante, todas as denúncias compartilham o limite de 3 por dia; se a consulta dos textos jurídicos falhar por outro motivo que não a migração ausente, `/app` mostra erro em vez de abrir sem checar o aceite.

## Segurança, privacidade, acessibilidade, desempenho e operação

- **Risco de regressão do CSP.** Ele vale para todas as páginas e só foi conferido em parte. O primeiro passo de deploy em `docs/ENVIRONMENTS.md` é conferir página pública, editor e login no navegador.
- **`/privacidade` deixou de ser estática:** consulta o banco a cada visita para saber se há texto ativo. Sem a migração, mostra o aviso provisório; com o banco fora do ar, responde erro.
- **Página suspensa:** `get_public_page` responde `suspended` e a publicação é recusada. O envio de formulário e a ingestão de eventos por chamada direta à RPC não consultam `moderation_status`.
- **Limite por endereço da denúncia:** sem cabeçalho de endereço, todas as denúncias caem no mesmo hash `direct` e dividem o limite de 3 por dia.
- **Exportação grande:** a conta que passar de 8 MiB recebe 413 e depende do pedido manual, que não tem procedimento.
- **Acessibilidade:** os formulários novos têm rótulos e mensagens com `role`; não houve inspeção por teclado nem por leitor de tela.
- **Desempenho:** nenhuma medição nova de LCP ou CLS. A página pública ganhou um link de rodapé "Denunciar esta página".

## Lacunas e continuação recomendada

1. Conferir o CSP em staging depois do merge (página pública com embed, editor com upload, login) e seguir os passos de deploy.
2. Exercitar com sessão `/aceite`, *Meus dados* e as duas filas, em Chrome, Edge e um celular.
3. Escrever e ensaiar a execução da exclusão de conta, store a store, e o pacote de mídia.
4. Backup e restauração em ambiente isolado; runbooks de renderer, jobs e webhooks; alertas.
5. Limites globais na borda, CAPTCHA e expurgos agendados (leads, convites, links de relatório, denúncias, pedidos).
6. Aviso ao dono da página suspensa e canal de contestação.
7. Revisão do advogado sobre as minutas e a pauta em `docs/legal/REVISAO_JURIDICA.md`; só então ativar os textos.

## Backlog

`BACKLOG.md`: os cinco P0 da Sprint 9 seguem abertos, com as partes concluídas marcadas abaixo de cada um. A atualização do Next para 16.4.0 (item da Sprint 8) foi marcada como feita.
