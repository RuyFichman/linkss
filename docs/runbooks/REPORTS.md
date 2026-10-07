# Runbook — painel da conta e links de relatório

**Owner:** founder técnico. **Ferramentas:** logs filtrados por `event` (`report.read`, `reports.create_link`, `reports.revoke_link`, `analytics.workspace_export`); tabelas `report_links` e `report_lookup_failures`; trilha `audit_events` (`report_link.created`, `report_link.revoked`); `docs/adr/0013-consolidated-analytics-and-report-links.md`.

Regras gerais:

- **Ninguém recupera o endereço de um link.** Só o hash do token é guardado. Link perdido: cancelar e criar outro.
- Nunca pedir que alguém cole um link de relatório em ticket ou chat aberto: o link é a credencial. Para identificar um link, use a anotação, a página e a data de criação.
- O relatório público responde o mesmo "Relatório não disponível" para todo motivo. O motivo se descobre pela conta (tela de resultados da página) ou pelo banco, nunca pela página pública.
- Os números do relatório são os do painel da página para os mesmos dias. Se o painel está errado, o problema é do analytics: `ANALYTICS.md`.

## 1. "O cliente diz que o link do relatório não abre"

1. Peça a quem criou o link que abra *Resultados* da página e veja a lista "Links criados". A situação está em palavras: **Ativo**, **Expirado em**, **Cancelado em**.
2. Expirado ou cancelado: criar outro link e enviar. Não há como reativar.
3. Ativo, mas não abre:
   - o endereço foi cortado ao copiar (tem de terminar com 43 caracteres depois de `/r/`). Reenviar;
   - a página foi excluída, ou a conta está suspensa;
   - o plano da conta deixou de incluir relatórios compartilháveis (a tela mostra o aviso "os links abaixo não abrem");
   - o endereço de quem abre fez muitas tentativas erradas nos últimos 10 minutos (20). Esperar 10 minutos.
4. Nada disso: procure `report.read` com `outcome=error` no log. Se houver, o banco não respondeu (`errorCode`); `PGRST202` significa migração da Sprint 7 não aplicada no ambiente.
5. Conferência no banco, sem o token:

```sql
select l.id, l.label, l.period_days, l.created_at, l.expires_at, l.revoked_at, p.deleted_at as page_deleted, w.status, w.plan_id
from public.report_links l
join public.profiles p on p.id = l.profile_id
join public.workspaces w on w.id = l.workspace_id
where l.profile_id = '<id da página>'
order by l.created_at desc;
```

## 2. "Um link precisa ser derrubado agora"

1. Caminho normal: proprietário ou administrador abre *Resultados* da página → "Cancelar link". Vale na requisição seguinte; não há cache.
2. Sem acesso de quem pode cancelar (ou sem saber qual link vazou): cancele todos os ativos da página pelo banco e avise a conta.

```sql
update public.report_links set revoked_at = now()
where profile_id = '<id da página>' and revoked_at is null and expires_at > now();
```

3. Para tirar todos os relatórios de uma conta do ar de uma vez, suspender a conta também funciona (`workspaces.status = 'suspended'`), mas isso congela a conta inteira: use só em incidente.
4. Confirme abrindo o link numa janela anônima: "Relatório não disponível".
5. Registre o que foi feito. O cancelamento pelo banco não passa pela trilha de auditoria.

## 3. "Os números da conta não batem com os de uma página"

O painel da conta e o da página leem as mesmas linhas e usam os mesmos cálculos; diferença real é defeito.

1. Confira se os dois estão no **mesmo período**. O painel da conta e o da página incluem hoje; o **relatório do cliente termina ontem** (só dias completos), então 30 dias de um não são os 30 dias do outro.
2. O painel da conta não soma páginas **excluídas**. Página arquivada ou fora do ar entra no total e só vira linha se teve visitas no período.
3. Compare no banco, como um membro da conta (troque os ids e as datas):

```sql
select set_config('request.jwt.claims', json_build_object('sub', '<id do usuário>', 'role', 'authenticated')::text, true);
select (select sum((d ->> 'count')::int) from jsonb_array_elements(public.get_workspace_analytics('<conta>', '<de>', '<até>') -> 'days') d where d ->> 'event_type' = 'page_view') as conta,
  (select sum((select sum((d ->> 'count')::int) from jsonb_array_elements(public.get_profile_analytics(p.id, '<de>', '<até>') -> 'days') d where d ->> 'event_type' = 'page_view'))
   from public.profiles p where p.workspace_id = '<conta>' and p.deleted_at is null) as soma_das_paginas;
```

4. Se os dois números diferirem, guarde o resultado e trate como incidente de dados (`INCIDENT.md`). O teste `160-reports.test.sql` cobre essa igualdade; uma diferença em produção indica linha de `analytics_daily` sem página correspondente ou mudança de função sem o teste.

## 4. Muitas tentativas de links inexistentes

Sinal: muitos `report.read` com `unavailable`, ou `select count(*) from public.report_lookup_failures where created_at > now() - interval '10 minutes'` perto de 5.000.

1. Adivinhar um token é inviável (256 bits). O risco é custo de banco, não vazamento.
2. O limite por endereço já bloqueia cada origem depois de 20 falhas. Se o volume vier de muitas origens ou direto na API, a contenção é o firewall da hospedagem na frente de `/r/` (Sprint 9; até lá, regra manual no painel da Vercel).
3. A tabela se limpa sozinha (24 horas). Não apagar à mão durante o ataque: isso reabre a janela de quem estava bloqueado.

## 5. Exportação do painel da conta falha

`analytics.workspace_export` com `forbidden` ou `not_found`: a pessoa perdeu o acesso à conta. `unavailable`: banco ou auditoria indisponível; o arquivo não é entregue sem o registro de auditoria. Tentar de novo; persistindo, `INCIDENT.md`.
