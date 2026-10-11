# Runbook — expurgo agendado

**Owner:** founder técnico. **Decisão:** ADR 0018. **Rota:** `/api/jobs/retention` (Vercel Cron, 07:00 UTC, todo dia; `POST` para execução manual). **Função:** `public.run_retention_maintenance`. **Estado em 11/10/2026:** verificado só no stack local; a migração `202610110002` ainda não foi aplicada em produção.

## O que o job apaga

| Dado | Quando |
|---|---|
| Contatos de formulário | 90 dias depois do envio |
| Contadores de limite (formulário, relatório) | depois de 1 dia |
| Convites terminados (aceitos, cancelados ou vencidos) | 30 dias depois de terminarem |
| Links de relatório terminados | 90 dias depois de terminarem |
| Denúncias já decididas | 180 dias depois da decisão |
| Denúncias nunca decididas, de página que não existe mais | 180 dias depois de recebidas |
| Pedidos de privacidade encerrados, com o histórico | 5 anos depois de encerrados |
| Trilha de auditoria | depois de 1 ano |
| Reservas de endereço | 1 ano depois do fim da reserva |
| Páginas excluídas | 30 dias depois da exclusão, quando as imagens já saíram do bucket |
| Contas (workspaces) excluídas | 30 dias depois da exclusão, sem imagem no bucket e sem assinatura em curso |

**Os prazos de 180 dias e de 5 anos são propostas técnicas de 11/10/2026**, pendentes da revisão jurídica. Mudar um prazo é uma migração (as funções `private.*_retention`).

**Não apaga:** denúncia aberta sobre página que existe; nada de quem está dentro do prazo; contas de acesso (`auth.users`), que só saem pela exclusão de conta (`ACCOUNT_DELETION.md`). Eventos brutos e agregados de analytics continuam com o job de analytics; o registro de eventos de cobrança, com o job de cobrança.

**Alertas:** `job:retention` e `retention:backlog` no monitor (`MONITORING.md`); os outros jobs estão em `JOBS.md`.

## Conferir que rodou

Log `retention.maintenance`, uma vez por dia:

- `outcome=ok`: tudo o que venceu saiu. Os campos dizem quantas linhas de cada tipo.
- `outcome=partial`: há página ou conta vencida que não pôde sair (`pendingProfiles`, `pendingWorkspaces`). Normal por um dia: o job de mídia (06:00 UTC) apaga até 500 imagens por execução. **Se repetir por três dias, ver §"Página vencida que não sai".**
- `not_configured` (503): falta `CRON_SECRET` (32+ caracteres) ou `SUPABASE_SECRET_KEY` na Vercel.
- `not_deployed` (503): a migração não foi aplicada.
- `unauthorized` (401): alguém chamou sem o segredo; se for o cron, o `CRON_SECRET` da Vercel mudou sem novo deploy.

Execução manual (o segredo vem do ambiente, nunca colado em chat ou histórico):

```bash
curl -s -X POST https://linkfav.com/api/jobs/retention -H "Authorization: Bearer $CRON_SECRET"
```

## Página vencida que não sai

O job só remove uma página depois que as imagens dela saíram do bucket. Se `pendingProfiles` não zera:

1. Ver o log `media.cleanup` do mesmo dia: `failed > 0` indica falha do Storage ao remover arquivos.
2. Rodar o job de mídia à mão (`POST /api/jobs/media-cleanup`) e depois o de expurgo.
3. Se uma conta excluída tem assinatura que não terminou, ela espera: conferir em *Plano* e na Stripe (`BILLING.md`).

## Riscos

- **O expurgo é definitivo.** Só um backup traz de volta, e restaurar um backup devolve também o que outros pediram para apagar (`BACKUP.md`). Fazer e conferir um backup antes de aplicar a migração.
- Um prazo mais curto numa migração futura apaga na execução seguinte tudo o que já passou do novo prazo. Revisar com o founder antes.
- O job é limitado a 1.000 linhas por tipo por execução: depois de um longo período parado, leva alguns dias para zerar o acumulado.
