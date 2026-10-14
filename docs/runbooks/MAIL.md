# Runbook — e-mail (Resend)

**Owner:** founder técnico. **Decisão:** ADR 0021. **Ensaio local:** `apps/web/scripts/mail-lifecycle.mjs`.

**Estado em 14/10/2026:** código pronto e verificado só no stack local, contra um substituto da API da Resend e o Mailpit local. **Não existe conta na Resend, o domínio não está verificado, a migração `202610140001` não está aplicada em produção e nenhum e-mail foi enviado a ninguém.**

## O que sai por e-mail

| Aviso | Para quem | Quando |
|---|---|---|
| Novo contato num formulário | proprietários e administradores que não desligaram; no máximo um por página, por pessoa e por hora | logo depois do envio do formulário |
| Página suspensa | proprietários e administradores | logo depois da suspensão |
| Contestação respondida | proprietários, administradores e quem enviou | logo depois da resposta |
| Pagamento que falhou | proprietário | logo depois do webhook ou do job da cobrança |
| Assinatura anual renova em até 7 dias | proprietário | no job diário |
| Confirmação de cadastro, recuperação de senha, troca de e-mail | a pessoa | pelo Supabase Auth, via SMTP da Resend |

O e-mail de contato **nunca traz o que o visitante escreveu**: manda a pessoa para o painel.

## 1. Ligar (uma vez)

1. **Conta na Resend** (decisão do founder em 11/10/2026). Anote o plano e os limites de envio por dia e por mês.
2. **Domínio:** em *Domains*, adicione `linkfav.com` e publique no DNS os registros que a Resend mostrar (SPF e DKIM; acrescente um DMARC, mesmo que só `p=none`, para começar). Espere aparecer *Verified*.
3. **Chave:** em *API Keys*, crie uma chave **só de envio** (*Sending access*) restrita ao domínio. Ela aparece uma vez.
4. **Vercel** (Production): `RESEND_API_KEY` (*Sensitive*), `MAIL_FROM` = `Linkfav <avisos@linkfav.com>`, e opcionalmente `MAIL_REPLY_TO`; sem ela as respostas vão para `SUPPORT_EMAIL`, e sem nenhuma das duas o e-mail diz que respostas não são lidas. Novo deploy.
5. **Supabase → Authentication → Emails → SMTP Settings:** ligar *Custom SMTP*; remetente `avisos@linkfav.com`, nome `Linkfav`; host `smtp.resend.com`, porta `465`, usuário `resend`, senha = uma chave da Resend (pode ser outra, também só de envio).
6. **Supabase → Authentication → Emails → Templates:** colar os três modelos de `supabase/templates/` (*Confirm signup*, *Reset password*, *Change email address*). **O de confirmação é o que faz o convite funcionar em outro aparelho.**
7. **Supabase → Authentication → URL Configuration:** *Site URL* `https://linkfav.com`; em *Redirect URLs*, `https://linkfav.com/auth/confirm**` (com os dois asteriscos, por causa do `?next=`).
8. Aplicar a migração (`docs/ENVIRONMENTS.md`, "Passos de deploy do e-mail").
9. Conferir (§3).

**Ordem:** os passos 1 a 3 primeiro. O 4 sem o 2 faz a Resend recusar tudo (`mail:failed`). O 5 sem o 2 deixa ninguém receber a confirmação de cadastro: **ninguém consegue se cadastrar**. O 6 sem o 5 não é aceito pelo Supabase.

## 2. Stripe também manda e-mail

A Stripe pode avisar pagamento que falhou e mandar recibo. Com os dois ligados, o proprietário recebe dois avisos da mesma falha. Decisão do founder: deixar só o nosso (Stripe → *Settings* → *Customer emails*: desligar *failed payments*) ou os dois. Os recibos da Stripe continuam úteis: o produto não manda recibo.

## 3. Conferir depois de ligar

1. Abra uma página sua com formulário numa janela anônima, preencha e envie. Em até um minuto chega "Novo contato na página …".
2. Na Resend, *Emails*: o envio aparece com a etiqueta `kind: new_lead`.
3. Cadastre uma conta de teste: a confirmação chega com o remetente `avisos@linkfav.com`.
4. Rode o job à mão: `curl -s -X POST https://linkfav.com/api/jobs/mail -H "Authorization: Bearer $CRON_SECRET"` → `{"ok":true,"outcome":"ok",...}`.

## 4. Alertas e resposta

| Verificação / log | O que significa | Sev. | O que fazer |
|---|---|---|---|
| `mail:overdue` | há mensagens vencidas há mais de 1 h que ninguém enviou, com o e-mail ligado | P1 | o envio parou: ver `mail.drain_failed` e `mail.maintenance` nos logs; conferir `RESEND_API_KEY` e `SUPABASE_SECRET_KEY`; rodar o job à mão |
| `mail:failed` (diário) | mensagens desistiram nas últimas 24 h | P2 | consulta abaixo; `rejected:*` é recusa da Resend (domínio, remetente, endereço inválido); `unavailable` cinco vezes é a Resend fora |
| `job:mail` | o job diário não roda há mais de 36 h | P2 | `JOBS.md` |
| `mail.maintenance` com `reason` | o e-mail está desligado neste ambiente, e por quê (`missing_api_key`, `invalid_from`...) | P2 se devia estar ligado | corrigir a variável e novo deploy |

```sql
-- O que desistiu e por quê (sem endereço: a tabela não guarda).
select kind, last_error, count(*) from public.mail_outbox
where status = 'failed' and finished_at > now() - interval '1 day' group by 1, 2 order by 3 desc;
-- O que está esperando.
select kind, status, attempts, count(*) from public.mail_outbox where status in ('pending', 'sending') group by 1, 2, 3;
```

Para mandar de novo uma mensagem que desistiu, depois de corrigir a causa: `update public.mail_outbox set status = 'pending', attempts = 0, next_attempt_at = now(), finished_at = null, last_error = null where id = '<id>' and expires_at > now();` e rodar o job.

## 5. Trocar a chave

Crie a chave nova na Resend, troque `RESEND_API_KEY` na Vercel, faça o deploy e só então apague a antiga. Mensagens que falharem no meio voltam sozinhas (até cinco tentativas). Para o SMTP do Supabase, troque a senha no passo 5 da §1.

## 6. Desligar

Apague `RESEND_API_KEY` na Vercel e faça o deploy. As mensagens ficam na fila e vencem; nada dá erro para ninguém. **O SMTP do Supabase continua usando a Resend**: desligá-lo volta para o remetente padrão do Supabase, limitado e sem os modelos próprios.

## 7. Privacidade

A Resend é um subprocessador nos Estados Unidos (`docs/DATA_MAP.md`). Ela recebe o endereço e o nome de quem recebe, o título da página e, numa contestação, a resposta da moderação. Pedido de exclusão: as mensagens da pessoa somem com a conta; o que ficou nos registros da Resend segue a retenção dela (anotar no dossiê, `ACCOUNT_DELETION.md`).
