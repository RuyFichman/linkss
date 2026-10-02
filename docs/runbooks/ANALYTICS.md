# Runbook — analytics do cliente (resultados das páginas)

**Owner:** founder técnico. **Ferramentas:** logs filtrados por `event` (`analytics.ingest`, `analytics.maintenance`, `analytics.export`); tabelas `analytics_events`, `analytics_daily`, `analytics_day_status`, `analytics_rate_hits`, `analytics_settings`; `docs/adr/0011-customer-analytics.md`; `docs/OBSERVABILITY.md` (limiares).

Regras gerais:

- Nunca apagar ou editar linhas de `analytics_daily` à mão para "corrigir" um número: os agregados são reconstruídos a partir do bruto (§4) enquanto ele existir, e depois disso não há como recalcular.
- Nunca copiar `visitor_hash` ou `client_hash` para ticket, chat ou log. Não identificam ninguém sozinhos, mas não têm por que sair do banco.
- Os logs não têm o conteúdo dos eventos, só resultado e contagens.
- A página pública nunca depende do analytics. Se a página não abre, o problema é outro: `PUBLIC_PAGE.md`.
- Os números são estimativas (quem bloqueia scripts não é contado; o dono sem sessão é contado). Diferenças pequenas em relação a outras ferramentas são esperadas.

## 1. "Os números pararam de atualizar"

1. **O painel mostra "Resultados ainda não disponíveis"?** A contagem não está ativa no ambiente. Confira, nesta ordem:
   - a migração `202610020002_customer_analytics` aplicada (`npx supabase migration list`);
   - o segredo no Vault: `select count(*) from vault.secrets where name = 'analytics_signing_secret';` deve devolver 1 (nunca imprima o valor);
   - `ANALYTICS_SIGNING_SECRET` no ambiente da Vercel, **com o mesmo valor**, e um deploy feito depois de criar a variável.
2. Procure `analytics.ingest` no período:
   - `not_deployed`: migração não aplicada. `not_configured`: falta o segredo (no servidor ou no Vault). `forbidden`: os dois segredos são diferentes.
   - `unavailable`: o banco não respondeu em 2 s. Veja `/api/health` e o status do Supabase. Os lotes desse período foram perdidos; não há fila.
   - `shedding`: §3.
   - `rate_limited` em quase tudo para uma página: §2.
   - Só `signed_in` ou `automated`: quem está testando está com a conta aberta no mesmo navegador (não conta, de propósito) ou usando uma ferramenta automática. Teste numa guia anônima do celular.
   - Nenhum log: a requisição não chega. Abra a página publicada e veja, na aba de rede, se `POST /api/events` sai e responde 204. Bloqueadores de anúncio podem barrar a requisição: é esperado e não é erro.
3. **Hoje aparece, os dias anteriores não** (ou o painel avisa "consolidação diária atrasada"): o job diário não rodou. Procure `analytics.maintenance`:
   - sem log há mais de 36 h: confira o cron em *Vercel → Settings → Cron Jobs* (`/api/jobs/analytics`, 04:00 UTC) e se `CRON_SECRET` existe no ambiente;
   - `unauthorized` / `not_configured`: `CRON_SECRET` ou `SUPABASE_SECRET_KEY` ausente ou trocado;
   - rode à mão: `curl -X POST https://<host>/api/jobs/analytics -H "Authorization: Bearer <CRON_SECRET>"`. A resposta traz `aggregatedDays`, `purgedEvents`, `pendingDays` e `lastFinalDay`. Se `pendingDays` > 0, repita até zerar (cada execução fecha até 10 dias).
   - Enquanto o job está parado nada se perde: os dias não fechados são lidos do bruto, e o bruto só é apagado depois de agregado. O risco é o bruto crescer (§3).
4. **Um bloco novo não conta cliques:** os cliques só valem para blocos da versão **publicada**. Confira se a página foi publicada depois de adicionar o bloco.
5. **`hashed=false` nos logs em produção:** `VISITOR_HASH_SALT` ausente ou o proxy não está passando o IP. As visitas continuam sendo contadas, mas sem a regra dos 30 minutos (cada recarga conta) e com um limite único por página.

## 2. "Os números de uma página parecem inflados"

1. Defesas atuais: uma visita por visitante a cada 30 minutos; 60 eventos por endereço por página a cada 10 minutos; 200 por janela de 10 minutos e 2.000 por dia por endereço em todas as páginas; 2.000 eventos por página por hora; robôs conhecidos e prévias de link descartados. **Não há limite global nem firewall na frente da rota** (Sprint 9).
2. Sinais: `analytics.ingest` com `rateLimited` alto; no painel, um país, uma origem ou um horário fora do padrão da página.
3. Olhe a forma do tráfego do dia, sem tocar em hashes:

   ```sql
   select date_trunc('hour', occurred_at) as hora, event_type, source, country, count(*)
   from public.analytics_events
   where profile_id = '<id da página>' and day = private.analytics_today()
   group by 1, 2, 3, 4 order by 1, 5 desc;
   ```

   Visitas concentradas numa hora, de um país improvável e sem nenhum clique indicam tráfego automático com user agent de navegador.
4. O que dá para fazer hoje: explicar ao cliente que os números são estimativas e que tráfego automático com cara de navegador passa pelo filtro até bater nos limites. O teto do dano é o limite por página (48 mil eventos por dia).
5. Remover eventos falsos de um dia que ainda tem bruto (até 7 dias atrás): apague as linhas de `analytics_events` identificadas pelo padrão (hora, país, origem), **anote no ticket a contagem e o critério**, e re-agregue o dia (§4). É uma alteração manual de dados do cliente: precisa de aprovação do founder.
6. Se o ataque vier de muitas origens e persistir, registre para a Sprint 9 (limite global e firewall) e acompanhe a capacidade (§3).

## 3. "A tabela de eventos está crescendo" / `shedding` nos logs

1. Tamanho e contagem:

   ```sql
   select pg_size_pretty(pg_total_relation_size('public.analytics_events')) as tamanho,
          (select reltuples::bigint from pg_class where oid = 'public.analytics_events'::regclass) as linhas_estimadas,
          (select max_raw_events from public.analytics_settings) as teto;
   select day, count(*) from public.analytics_events group by day order by day;
   ```

2. **Dias antigos (mais de 8) ainda presentes:** o job não está fechando ou apagando. Rode-o à mão (§1.3) até `pendingDays` = 0 e `purgedEvents` < 50000. Cada execução apaga até 50.000 eventos.
3. **Só dias recentes, mas volume alto:** tráfego real ou flood. Veja quais páginas concentram o volume (`group by profile_id`) e siga o §2.
4. **`shedding`:** a ingestão está descartando **tudo**, inclusive eventos legítimos, porque a tabela chegou ao teto (`max_raw_events`, 500 mil por padrão, ≈ 165 MB). Incidente P1 para os números (a página pública não é afetada):
   - rode o job até o purge terminar;
   - o teto usa a estimativa do planejador; depois de um purge grande, atualize-a: `analyze public.analytics_events;`
   - se o volume é legítimo, é o sinal de upgrade de `docs/SUPABASE_CAPACITY.md`. Subir o teto (`update public.analytics_settings set max_raw_events = …`) só com espaço conferido no banco e registro no ticket.
5. Banco em 60% da cota: política de upgrade em `docs/SUPABASE_CAPACITY.md`.

## 4. Re-agregar um dia

Quando: depois de remover eventos falsos (§2.5) ou se um agregado parecer incompleto.

1. Só é possível enquanto o bruto do dia existe: de 7 dias atrás até hoje.
2. `curl -X POST "https://<host>/api/jobs/analytics?day=AAAA-MM-DD" -H "Authorization: Bearer <CRON_SECRET>"`. Resposta `{"ok":true,"aggregatedDays":1,...}`.
3. `400 invalid`: a data está malformada, no futuro ou é mais antiga que o bruto. Para um dia já apagado **não há como recalcular**: o agregado guardado é o registro definitivo.
4. A operação substitui as linhas do dia para todas as páginas e pode ser repetida: o resultado é o mesmo.
5. Confira: `select dimension, key, event_type, count from public.analytics_daily where profile_id = '<id>' and day = '<dia>' order by 1, 2, 3;`

## 5. Rotação de segredos

- **`ANALYTICS_SIGNING_SECRET` / `analytics_signing_secret`:** gere um valor novo, atualize o Vault (`vault.update_secret`) e a variável da Vercel, e faça redeploy. Entre a troca no Vault e o deploy, os lotes são recusados (`forbidden`) e perdidos. Nada mais é afetado.
- **`VISITOR_HASH_SALT`:** também é usado pelo limite de envios de formulário. Trocar zera, para o dia em curso, a regra de visita e os baldes de limite (uma pessoa que já visitou hoje conta de novo). Os dados já guardados não mudam.

## 6. Pedido de um visitante sobre os próprios dados

Não há como localizar as linhas de uma pessoa: não guardamos IP nem identificador no navegador, e o hash muda todo dia e depende de um sal. Responda com a política (`docs/DATA_MAP.md`, Sprint 6): os registros detalhados são apagados em 7 dias e os totais não identificam ninguém. O controlador é o dono da página; encaminhe o pedido a ele e registre data e página.

## 7. Rollback da aplicação para antes da Sprint 6

Suportado. A página pública volta a não ter coletor; o painel e as rotas de analytics deixam de existir; o banco fica como está. O cron de analytics sai com o deploy antigo, então o bruto para de ser apagado até o novo deploy (o job retoma de onde parou).
