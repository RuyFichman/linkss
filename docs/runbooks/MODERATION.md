# Runbook — denúncias, suspensão e contestação

**Owner:** founder (administrador da plataforma). **Decisões:** ADR 0015 e ADR 0019. **Tela:** `/app/administracao/denuncias`. **Alertas:** `queue:moderation_reports` e `queue:moderation_appeals` (`MONITORING.md`).

**Estado em 11/10/2026:** verificado só no stack local (`apps/web/scripts/moderation-appeal.mjs`, 20 verificações). Os prazos e os textos abaixo são propostas, pendentes da revisão jurídica.

## 1. Analisar uma denúncia (até 72 horas)

1. Abra a página denunciada numa janela anônima. Guarde uma captura de tela fora do produto se for suspender.
2. Marque **Em análise** com uma justificativa curta.
3. Decida:
   - **Sem fundamento:** *Descartar*, com a razão.
   - **Procede e é grave** (golpe, imitação, conteúdo ilegal, dados pessoais de terceiros): **Suspender página**, a partir da própria denúncia. É a denúncia que define o motivo mostrado ao dono.
   - **Procede e é leve:** hoje não há como pedir um ajuste sem suspender. Avalie se a suspensão é proporcional.
4. Depois de suspender, marque a denúncia como **resolvida**.

A justificativa que você escreve **não é mostrada ao dono da página** (fica na trilha de auditoria); pode citar o que foi visto. Não escreva nela dados de quem denunciou.

## 2. O que o dono da página vê

- Um aviso vermelho em todas as telas da conta: a página foi suspensa e está fora do ar, com o link "Ver o motivo e contestar".
- Na tela da suspensão: o **motivo em categoria** (golpe, imitação, conteúdo ilegal, spam, dados pessoais, regras de uso), a data, que nada foi apagado e que o rascunho pode ser editado.
- **O produto não envia e-mail.** O dono só fica sabendo quando abre o painel. Se a conta tiver um contato conhecido e o caso for sensível, avise por fora.
- Quem abre o endereço público vê "página indisponível".

Uma suspensão feita **sem** partir de uma denúncia aparece para o dono com o motivo genérico "Descumprimento das regras de uso".

## 3. Responder uma contestação (até 72 horas)

As contestações aparecem no topo da fila. Só o proprietário e os administradores da conta podem enviar; uma por vez, no máximo três por suspensão.

1. Leia o que o dono escreveu e abra a prévia da página (ele pode ter corrigido o rascunho; a versão que voltará ao ar é a **última publicada**, não o rascunho).
2. Escreva a **resposta ao dono da página**: ela é mostrada a ele. Seja específico e não cite quem denunciou.
3. **Aceitar e reativar a página** ou **Não aceitar**.

- Aceitar põe de volta no ar a versão publicada antes da suspensão. Se o problema estava nela, peça na resposta que o dono corrija e publique de novo, ou não aceite ainda.
- Uma decisão não pode ser desfeita. Depois de não aceitar, o dono pode enviar outra contestação (até o limite). Depois de aceitar por engano, suspenda de novo.
- Reativar pela fila de denúncias também encerra a contestação pendente, como aceita, **sem resposta escrita**.

## 4. Casos que saem do roteiro

- **Ordem judicial ou pedido de autoridade:** não decida sozinho. Guarde o documento, suspenda se a ordem mandar e procure o advogado.
- **Conta inteira abusiva:** não há suspensão de conta pela tela. `update public.workspaces set status = 'suspended' where id = '<conta>';` no SQL Editor, com registro no dossiê. **O aviso e a contestação desta página não cobrem a suspensão de conta.**
- **O dono esgotou as três contestações:** a página continua suspensa; ele pode excluí-la. Reative pela fila de denúncias se mudar de ideia.
- **Você é o autor da suspensão e da resposta:** hoje não há segunda pessoa. Registre no dossiê por que manteve a decisão.

## 5. Sinais

- Log `moderation.appeal` (`sent`, `invalid`, `forbidden`, `not_suspended`, `already_open`, `limit_reached`, `unavailable`): `unavailable` repetido → o dono não está conseguindo contestar (P2).
- Auditoria: `moderation.suspended`, `moderation.appealed`, `moderation.appeal_decided`, `moderation.reactivated`.
