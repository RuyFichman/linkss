# Runbook — exclusão de conta a pedido do titular

**Owner:** founder (administrador da plataforma). **Decisão:** ADR 0018 (e ADR 0015 para a fila). **Tela:** `/app/administracao/privacidade`. **Ensaio local:** `apps/web/scripts/account-erasure.mjs`.

**Estado em 11/10/2026:** ensaiado só no stack local (18 verificações, com arquivos reais no bucket local). **Nunca executado em produção, e nunca com um domínio anexado na Vercel nem com uma assinatura na Stripe.** O texto de resposta ao titular abaixo é uma minuta que precisa da revisão jurídica.

**A exclusão é definitiva.** Depois do último passo não há botão de desfazer; só um backup traz os dados de volta.

## 1. Antes de tudo: quem pediu é o dono da conta?

O pedido nasce na tela *Meus dados* da própria pessoa, com sessão iniciada, então em regra a identidade já está comprovada pelo acesso. Desconfie e peça confirmação pelo e-mail da conta quando: o pedido chegou por outro canal (e-mail, rede social); a conta mudou de senha ou de e-mail há pouco; alguém diz ser dono de uma conta de agência com outros membros.

Abra um dossiê fora do produto (pasta ou planilha de acesso restrito) com uma referência curta, por exemplo `EXC-2026-001`, e anote ali o que foi conferido. **A referência vai no campo de evidência; dados pessoais, não.**

## 2. Resolver o que bloqueia

Na fila, o pedido já mostra o motivo quando há bloqueio. Marque **Aguardando providência** e resolva:

| Bloqueio | Como resolver |
|---|---|
| **Assinatura em curso** numa conta da pessoa | A pessoa cancela em *Plano*; a assinatura só termina no fim do período pago. Para excluir antes, cancele **imediatamente** no painel da Stripe (*Customers* → assinatura → *Cancel immediately*) e espere o webhook ou o job diário marcar a assinatura como encerrada. Reembolso é decisão do founder. |
| **Conta com outros membros** | A pessoa (ou você, com a concordância dela registrada no dossiê) remove os outros membros em *Membros*. Não existe transferência de propriedade: se os outros precisam do conteúdo, eles exportam ou recriam antes. |

Uma conta em que a pessoa é só **membro** (não proprietária) não bloqueia nada: o conteúdo fica com a conta e o acesso dela some.

## 3. Avisar o que vai acontecer

Antes de executar, confirme com a pessoa (o produto ainda não envia e-mail; use o seu):

- as páginas saem do ar na hora e os endereços ficam reservados por 90 dias;
- contatos recebidos, resultados, imagens e links de relatório são apagados; se ela quer uma cópia, a exportação está em *Meus dados* (**as imagens não vão na exportação**);
- não dá para desfazer.

## 4. Executar

1. Faça e confira um backup (`BACKUP.md`). É a única volta atrás em caso de engano.
2. Na fila, marque o pedido como **Em análise**.
3. No quadro vermelho *Executar a exclusão*: preencha a referência do dossiê, digite `EXCLUIR` e confirme.
4. Leia a mensagem no topo da tela:

| Mensagem | O que aconteceu | O que fazer |
|---|---|---|
| Conta excluída | tudo foi apagado e o pedido foi concluído | passo 5 |
| Ainda há imagens sendo removidas | as páginas já saíram do ar; nada foi apagado | executar de novo em alguns minutos |
| Um domínio próprio não pôde ser desanexado | as páginas já saíram do ar; nada foi apagado | conferir o token da Vercel (`DOMAINS.md`) e executar de novo |
| A limpeza de imagens não está configurada | falta `SUPABASE_SECRET_KEY` no ambiente | corrigir a variável, novo deploy, executar de novo |
| Assinatura em curso / outros membros | nada foi feito | passo 2 |
| O pedido precisa estar em análise | nada foi apagado; ou a pessoa criou uma página depois do início | marcar *Em análise* e executar de novo |

Executar de novo é sempre seguro: cada etapa confere tudo outra vez.

## 5. Depois

1. **Stripe:** o cliente e as faturas continuam lá (obrigação fiscal do founder). Não apague sem orientação contábil. Anote no dossiê.
2. **Vercel:** se a pessoa tinha domínio próprio, confira em *Domains* que ele saiu do projeto.
3. **Backups:** os dados continuam nos backups anteriores até eles vencerem. Anote no dossiê a data do backup mais antigo guardado; **se um backup anterior for restaurado, a exclusão precisa ser refeita**.
4. **Responder ao titular** (minuta, sujeita à revisão jurídica):

> Sua conta no Linkfav e os dados ligados a ela foram excluídos em DD/MM/AAAA. Suas páginas estão fora do ar e os endereços ficam reservados por 90 dias. Ficam guardados, pelo prazo indicado: o registro deste pedido, sem o seu e-mail (5 anos); registros de segurança que citam apenas um identificador interno que não leva mais a você (1 ano); cópias de segurança do banco, apagadas em até XX dias; e, se você assinou um plano, os dados de pagamento mantidos pela Stripe para obrigações fiscais. Cópias feitas por terceiros (prévias de link em redes sociais, buscadores) estão fora do nosso controle.

## O que é apagado e o que fica

| Dado | Destino |
|---|---|
| Conta de acesso (e-mail, senha, sessões), nome de exibição, aceites dos termos | apagado |
| Contas (workspaces) em que a pessoa é proprietária: páginas, versões publicadas, contatos, resultados, links de relatório, convites enviados, domínios, pixels, linhas de cobrança | apagado |
| Imagens dessas páginas no bucket | apagado antes das linhas |
| Convites enviados **para** o e-mail dela; inscrição na lista de espera | apagado |
| Vínculo com contas de outras pessoas | apagado; o conteúdo fica com a conta |
| Pedido de privacidade e histórico | **fica** 5 anos (prova do atendimento; sem e-mail) |
| Trilha de auditoria e reservas de endereço | **ficam** pelo prazo próprio (1 ano; 90 dias + 1 ano), só com identificador interno |
| Denúncias sobre páginas dela | **ficam** pelo prazo das denúncias (180 dias) |
| Cliente e faturas na Stripe | **ficam** na Stripe |
| Backups | **ficam** até vencer |
| Logs da Vercel e do Supabase | prazo do fornecedor; não contêm e-mail nem conteúdo |

## Ensaiar no computador

Com o stack local no ar, `SUPABASE_SECRET_KEY` e `CRON_SECRET` no `apps/web/.env.local` e a aplicação compilada rodando na porta 3100:

```bash
cd apps/web
node scripts/account-erasure.mjs            # cria contas descartáveis, executa pela tela, confere banco e bucket
node scripts/account-erasure.mjs --cleanup  # remove sobras de uma execução interrompida
```

O script recusa qualquer banco ou aplicação que não seja local.
