# Runbook — domínio próprio e pixels

**Owner:** founder técnico. **Ferramentas:** logs filtrados por `event` (`domains.claim`, `domains.verify`, `domains.remove`, `pixels.set`, `public_page.resolved` com `via=domain`, `public_page.domain_lookup_failed`); tabelas `profile_domains` e `profile_pixels`; trilha `audit_events` (`domain.claimed`, `domain.verified`, `domain.lapsed`, `domain.removed`, `pixels.updated`); painel de domínios do projeto na Vercel; `docs/adr/0016-custom-domains.md` e `docs/adr/0017-pixels-and-consent.md`.

**Estado:** verificado só no stack local, contra um resolvedor DNS e um emulador da API da Vercel. Nada aqui foi exercitado com um domínio real. Na primeira ocorrência real, anote o que diferiu e corrija este arquivo.

Regras gerais:

- **Ninguém "libera" um domínio por pedido.** Um domínio só passa a abrir uma página pela comprovação no DNS. Não mude `status` para `active` por SQL: quem controla o DNS consegue comprovar sozinho, e quem não controla não deve conseguir de jeito nenhum.
- O registro de comprovação é público (está no DNS); pode ser citado num atendimento. O token da Vercel nunca.
- Os logs da aplicação não trazem o nome do domínio. Para achar um domínio, use a trilha de auditoria ou a tabela.
- Um domínio que responde 404 nunca mostra o motivo ao visitante. O motivo se descobre pela tela da página (aba *Página* do editor) ou pelo banco.

## 1. "Meu domínio não abre a página"

1. Peça para abrir o editor da página, aba *Página*, seção *Domínio próprio*. A situação está em palavras:
   - **Aguardando comprovação:** falta o registro TXT (§2).
   - **Comprovado**, etapa 2 na tela: falta apontar o domínio (§3).
   - **Domínio no ar:** o produto considera tudo certo; veja o passo 3 abaixo.
   - **Perdido:** outra conta comprovou o controle (§4).
   - Aviso "o plano não inclui mais domínio próprio": o plano caiu; volta sozinho quando o plano voltar.
2. A página precisa estar publicada, não arquivada e não suspensa: o domínio abre exatamente o que o endereço do produto abre.
3. "No ar" e mesmo assim não abre:
   - certificado ainda sendo emitido (minutos depois de apontar o DNS). Conferir no painel da Vercel, em *Domains*;
   - o DNS foi alterado depois da última verificação. Pedir para tocar em *Verificar de novo*;
   - cache: uma mudança leva até 60 segundos para aparecer.
4. Conferência no banco:

```sql
select d.hostname, d.status, d.routing, d.verified_at, d.last_checked_at, p.slug, p.live_publication_id is not null as no_ar,
       p.moderation_status, w.plan_id, w.status as conta
from public.profile_domains d
join public.profiles p on p.id = d.profile_id
join public.workspaces w on w.id = d.workspace_id
where d.hostname = '<domínio>';

select state, canonical_slug from public.get_public_page_by_domain('<domínio>');
```

## 2. "Criei o registro TXT e a verificação não encontra"

1. Confira de fora: `nslookup -type=TXT _linkfav.<domínio> 1.1.1.1` (ou `dig TXT _linkfav.<domínio> @1.1.1.1`). O valor tem de ser exatamente o da tela, começando por `linkfav-verify=`.
2. Erros comuns: o painel de DNS acrescenta o domínio sozinho e o nome fica `_linkfav.www.loja.com.br.loja.com.br`; aspas a mais; registro criado em outra zona; propagação ainda em curso.
3. Log `domains.verify` com `outcome=dns_unavailable`: o servidor não conseguiu consultar o DNS (resolvedores públicos fora do ar ou saída de rede bloqueada). Tentar de novo; se persistir, P2.
4. Log com `outcome=not_configured`: falta `DOMAINS_SIGNING_SECRET` no ambiente ou o valor difere do segredo `domains_signing_secret` do Vault (o banco recusa a assinatura). Conferir os dois valores (§6).

## 3. "Está comprovado, mas pede para apontar o domínio"

1. A tela mostra o registro que a Vercel recomenda (CNAME para subdomínio, A para o domínio sem `www`). Criar no mesmo painel de DNS e tocar em *Verificar de novo*.
2. "O provedor de hospedagem ainda não informou o registro": a Vercel não respondeu. Log `domains.verify` com `providerFailed=true`. Conferir o token (`VERCEL_API_TOKEN`), o projeto (`VERCEL_PROJECT_ID`) e, em projeto de time, `VERCEL_TEAM_ID`.
3. "O provedor recusou este domínio": o domínio está em outro projeto ou conta da Vercel. O dono precisa removê-lo de lá.
4. "A ativação automática não está disponível neste ambiente": o ambiente não tem as variáveis da Vercel. O domínio pode ser acrescentado à mão no painel do projeto; a comprovação no banco já vale.
5. Domínio sem `www` em registrador que não aceita A/ALIAS na raiz: orientar a usar `www` (cada endereço é um registro separado no produto).

## 4. "Meu domínio aparece como Perdido"

Outra conta comprovou o controle do mesmo domínio **e** o registro TXT desta página não estava mais no DNS naquele momento. A trilha mostra quando: `audit_events` com `action = 'domain.lapsed'` na conta que perdeu.

1. Se o domínio é mesmo da pessoa: remover o domínio na tela, registrar de novo, criar o novo registro TXT, apagar do DNS qualquer outro `linkfav-verify=` e verificar. Com só o registro dela no DNS, o domínio volta.
2. Se houver disputa de boa-fé entre duas contas, quem controla o DNS decide; não arbitre por SQL.
3. Suspeita de abuso (alguém com acesso indevido ao DNS do cliente): o problema está no registrador do cliente. Suspender a página que passou a responder pelo domínio, se o conteúdo for abusivo, pelo fluxo de moderação.

## 5. Remover um domínio à força (abuso, pedido do titular do domínio)

1. Preferir a suspensão da página (`/app/administracao/denuncias`): o domínio passa a mostrar "página indisponível".
2. Para desligar só o domínio, como administrador do banco:

```sql
delete from public.profile_domains where hostname = '<domínio>' returning id, workspace_id, profile_id, status;
```

   Depois, remover o domínio do projeto na Vercel (*Domains*) e registrar o motivo. A trilha `audit_events` não registra este `delete` direto: anote no ticket.
3. O cache da página no domínio expira em até 60 segundos.

## 6. Segredo de assinatura e token da Vercel

- `DOMAINS_SIGNING_SECRET` (Vercel) e `domains_signing_secret` (Vault) têm de ser iguais. Para trocar: gerar um valor novo, atualizar o Vault (`select vault.update_secret((select id from vault.secrets where name = 'domains_signing_secret'), '<novo>');`), atualizar a variável e fazer novo deploy. Entre um passo e outro as verificações respondem "não disponível"; domínios já ativos continuam no ar.
- Token da Vercel vazado: revogar no painel da Vercel, criar outro, atualizar `VERCEL_API_TOKEN`, novo deploy. Conferir em *Domains* se nenhum domínio estranho foi acrescentado ao projeto. Nenhum domínio abre página sem linha ativa no banco, então um domínio acrescentado só na Vercel responde 404.

## 7. Pixels

- **"O pixel não dispara":** o visitante precisa tocar em *Aceitar* no aviso. Em janela anônima: abrir a página, aceitar, e ver no painel da Meta (Test Events) ou do Google (Tempo real). Sem aceite, nada é enviado, por decisão do produto (ADR 0017).
- **"Os números do pixel são menores que os de Resultados":** esperado; só conta quem aceitou.
- **Código recusado:** Meta Pixel é só número (10 a 20 dígitos); Google Analytics começa com `G-`. Código `GTM-` (Tag Manager) e `UA-` não são aceitos.
- **Violação de CSP no console de uma página com pixel:** a lista de origens em `apps/web/src/lib/security/response-headers.ts` pode estar incompleta para a biblioteca do fornecedor. Anotar a origem bloqueada e abrir correção; não afrouxar a política das outras rotas.
- **Desligar os pixels de uma página (abuso ou pedido):** `delete from public.profile_pixels where profile_id = '<id>';` e aguardar 60 segundos, ou suspender a página.
- **Plano caiu:** os códigos ficam guardados e deixam de ser carregados; voltam com o plano.

## 8. Verificação local

`node scripts/domains-lifecycle.mjs` em `apps/web` (depois de `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100 npm run build --workspace=@lnk/web`) sobe um resolvedor DNS de teste, um emulador da API da Vercel e a aplicação, e percorre o ciclo de vida. `--serve` deixa no ar; `--cleanup` remove as contas `qa-domains-*@example.test`. Detalhes no cabeçalho do arquivo.

## Reverificação diária (desde 11/10/2026)

Verificado só no stack local; a migração `202610110005` ainda não foi aplicada em produção.

O job `/api/jobs/domains` (08:00 UTC) lê de novo o registro TXT de comprovação de cada domínio ativo. Log `domains.recheck` com contagens (`checked`, `found`, `missing`, `lapsed`, `dnsUnavailable`, `failed`), **nunca o nome do domínio**. Alerta: `job:domains` no monitor (`MONITORING.md`).

- **Sete dias seguidos sem o registro** desligam o domínio da página (situação "desligado", motivo reverificação). O hostname é desanexado na Vercel, se houver provedor configurado.
- **Dia em que o DNS não pôde ser consultado não conta** (`dnsUnavailable`): nem a favor, nem contra.
- Desde a primeira ausência, a tela do domínio avisa o dono de quantos dias faltam. **Não há e-mail.**

**"Meu domínio parou de abrir a página."** Abra a seção *Domínio* da página: se diz que o registro TXT ficou sete dias fora do DNS, o dono recria o registro `_linkfav.<domínio>` com o valor mostrado e toca em **Verificar**. O domínio volta na hora (o certificado já existia).

**`lapsed > 0` no log sem reclamação:** normal para domínios abandonados. Muitos de uma vez → suspeitar dos resolvedores (o job deveria ter contado `dnsUnavailable`, não `missing`); conferir `dig TXT _linkfav.<domínio> @1.1.1.1` para um deles antes de qualquer outra coisa. Para reativar à mão, o caminho é o mesmo do dono: Verificar.

**Ambiente sem `DOMAINS_SIGNING_SECRET`:** o job responde `{"ok":true,"skipped":"domains_off"}`, o que conta como execução boa.
