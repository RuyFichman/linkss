# Runbook — imagens, armazenamento e limpeza de mídia

**Owner:** founder técnico. **Ferramentas:** logs filtrados por `event` (`media.upload`, `media.cleanup`); tabela `media_assets`; bucket `media` no painel do Supabase (Storage); `docs/adr/0009-media-and-storage-adapter.md`.

Regras gerais:

- Nunca apagar ou alterar linhas de `storage.objects` por SQL: o Storage do Supabase não remove o arquivo e o estado fica inconsistente. Arquivos saem pelo job de limpeza ou pelo painel/API do Storage.
- Nunca apagar linhas de `media_assets` à mão: quem apaga é `finish_media_cleanup`, depois que os arquivos saíram.
- Nunca registrar no ticket o conteúdo da imagem nem o nome do arquivo do cliente; use o id da página e o id da mídia (o prefixo da URL: `/media/<id>/<largura>.webp`).
- O arquivo original não existe em lugar nenhum: só as variantes WebP re-codificadas, sem metadados.

## 1. Imagem imprópria, ilegal ou de terceiros publicada

Ainda **não há denúncia nem moderação no produto** (Sprint 9). A resposta é manual.

1. Identifique a página pelo endereço e a mídia pela URL da imagem (`<id>` do caminho). Confirme em `media_assets` a página e o workspace.
2. **Tirar a página do ar:** siga `PUBLIC_PAGE.md` §4 (suspensão do workspace ou despublicação). Isso remove a página, **mas o arquivo continua acessível pela URL direta**, porque o bucket é público e o CDN guarda cópia.
3. **Remover o arquivo (casos graves):** no painel do Supabase, Storage → bucket `media` → pasta `<id>` → apagar as variantes. A URL deixa de responder quando o cache do CDN expirar (as variantes são servidas com cache longo); para conteúdo ilegal, peça a purga ao suporte do Supabase e registre o horário.
4. A linha em `media_assets` fica apontando para arquivos que não existem: a página (se voltar ao ar) mostra a imagem quebrada até o cliente trocá-la. É o resultado esperado; não "conserte" a linha.
5. Registre no ticket: quem pediu, o que foi removido, quando, e se houve notificação ao cliente. Avalie obrigações legais (`INCIDENT.md` item 8).
6. Chave Pix ou link de pagamento usados em golpe seguem o mesmo fluxo de `PUBLIC_PAGE.md` §4: o produto não verifica o titular da chave.

## 2. "Não consigo enviar a imagem"

Peça a mensagem exata; cada recusa tem um texto próprio. Depois procure `media.upload` da sessão.

| `outcome` | O que é | O que fazer |
|---|---|---|
| `unsupported`, `animated`, `too_large`, `too_many_pixels`, `too_small`, `bad_aspect`, `undecodable`, `empty` | o arquivo foi recusado pela política (formato pelos bytes: só JPEG, PNG e WebP sem animação; até 15 MB e 4.096 px por lado; proporção entre 1:3 e 3:1) | orientar a exportar como JPEG ou PNG (HEIC, GIF, SVG, AVIF e PDF não são aceitos). Muitas recusas sem passar pela tela indicam requisição forjada |
| `quota` | o workspace atingiu `storage_mb` do plano | ver §3 |
| `rate_limited` | mais de 60 envios do workspace em 1 hora | esperar; se for uso legítimo recorrente, registrar para rever o limite |
| `forbidden`, `not_found` | sem papel na conta, workspace suspenso, página excluída | conferir `workspace_memberships`, `workspaces.status`, `profiles.deleted_at` |
| `unauthenticated` | sessão expirou | entrar de novo; o editor mantém o resto do rascunho |
| `unavailable` | Storage ou banco fora, **ou segredo de assinatura ausente/divergente** | ver §4 |

A imagem enviada mas não usada (a pessoa fechou o recorte, trocou de ideia) não é erro: vira órfã e sai na limpeza.

## 3. Cota de armazenamento atingida

1. O editor mostra o uso em "Armazenamento" e a mensagem de cota no envio. A conta considera o que está em uso (rascunho ou alguma das 10 versões publicadas) mais o que foi enviado há menos de 24 h.
2. Trocar uma imagem **não libera espaço na hora**: a anterior continua contando enquanto uma versão publicada retida a usar. Espaço volta quando a versão sai das 10 retidas e a limpeza roda.
3. Confira se a limpeza está rodando (§5). Sem ela, órfãos com mais de 24 h já não contam na cota do cliente, mas ocupam o projeto.
4. Se o uso é legítimo, a saída é o plano (o limite vem do entitlement `storage_mb`, nunca de alteração manual por conta).
5. Cota do **projeto** Supabase em 60%: seguir a política de upgrade de `docs/SUPABASE_CAPACITY.md`.

## 4. Todos os envios falham com "indisponível"

1. `/api/health` e status do Supabase (Storage é um serviço separado do banco).
2. Segredo de assinatura: a aplicação usa `MEDIA_SIGNING_SECRET` e o banco lê `media_signing_secret` no Vault. Se um dos dois falta ou eles diferem, **todo** envio falha (o registro é recusado com `LK060`). Confirme que a variável existe no ambiente da Vercel e que `select count(*) from vault.secrets where name = 'media_signing_secret';` devolve 1. Nunca imprima o valor.
3. Rotação do segredo: gere um valor novo, atualize o Vault (`vault.update_secret`) e a variável da Vercel, e faça redeploy. Envios em andamento durante a troca falham e podem ser repetidos; imagens já enviadas não são afetadas.
4. Imagens antigas continuam sendo servidas mesmo com o envio fora: a página pública não depende da aplicação para carregar a mídia.

## 5. Limpeza de órfãos

O que é órfã: mídia `ready` sem referência no rascunho nem nas publicações retidas da página há mais de 24 h; envio que não terminou (`pending`/`failed`) há mais de 1 h; mídia de página já excluída.

1. Rodar: `curl -X POST https://<host>/api/jobs/media-cleanup -H "Authorization: Bearer <CRON_SECRET>"`. Resposta: `{"ok":true,"claimed":n,"removedObjects":n,"finished":n,"failed":n}`. Cada chamada trata até 50 mídias; repita enquanto `claimed` for 50.
2. É seguro repetir: a mídia é marcada `deleting`, os arquivos são removidos pelo Storage e só então a linha é apagada. Uma execução interrompida é retomada pela seguinte.
3. `503 not_configured`: falta `CRON_SECRET` (mínimo 32 caracteres) ou `SUPABASE_SECRET_KEY` no ambiente. `401`: segredo errado.
4. `failed` > 0: o Storage recusou a remoção; a mídia fica `deleting` e a próxima execução tenta de novo. Duas execuções seguidas com falha → abrir incidente P2.
5. **Agendador decidido: Vercel Cron, uma vez por dia (ADR 0009), ainda não implementado.** Até ele entrar, rodar à mão uma vez por semana no staging. Depois de implementado, as execuções aparecem em *Vercel → Settings → Cron Jobs* e nos logs `media.cleanup`. Se o cron parar, a chamada manual acima continua valendo.
6. A limpeza nunca remove mídia usada por uma versão publicada retida: restaurar uma versão antiga continua mostrando as imagens dela. Se uma imagem de versão retida sumir, é bug P1: guarde o id da mídia e os logs `media.cleanup` do período.

## 6. Rollback da aplicação para antes da Sprint 5

Suportado para a página pública: o renderer antigo ignora o tema e os blocos que não conhece. O editor antigo, ao salvar, grava só os blocos que conhece: os blocos novos saem do rascunho (as versões publicadas não mudam). Prefira corrigir para frente; se o rollback for inevitável, avise os clientes para não editar até a correção.
