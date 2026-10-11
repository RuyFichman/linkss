# Runbook — limites de requisição

**Owner:** founder técnico. **Decisão:** ADR 0018. **Estado em 11/10/2026:** a camada da aplicação está no código e testada; **a regra do firewall da Vercel ainda não foi criada**.

Há três camadas, da mais externa para a mais interna:

| Camada | Onde fica | O que conta | Vale entre instâncias? |
|---|---|---|---|
| Firewall da Vercel | painel da Vercel (não está no repositório) | requisições por endereço IP, antes de chegar à aplicação | sim, por região |
| Aplicação | `apps/web/src/lib/security/rate-limit.ts` | requisições por endereço e por rota, na memória de cada instância | **não** |
| Banco | funções do Postgres (leads, eventos, relatórios, denúncias, convites, checkout) | por página, por visitante e por conta | sim |

## 1. Criar a regra do firewall (uma vez)

O plano Hobby permite **uma** regra de limite de taxa por projeto, com chave por IP e janela de 10 s a 10 min. Por isso a regra é uma só, para tudo o que não é arquivo estático.

1. Vercel → projeto → **Firewall** → **Configure** → **+ New Rule**.
2. Nome: `limite geral por endereço`.
3. **If:** *Request Path* → *Does not start with* → `/_next/`.
4. **Then:** *Rate Limit* → *Fixed Window* → janela **60 s**, limite **300** requisições, chave **IP**.
5. Ação ao exceder: comece com **Log**. Salve, **Review Changes**, **Publish**.
6. Depois de alguns dias, veja em *Firewall* quantos endereços a regra marcou. Se forem só robôs, troque a ação para **Default (429)** e publique de novo.

Por que 300 por minuto: uma visita a uma página pública faz de 3 a 5 requisições fora de `/_next/`; no Brasil muitos celulares saem pela mesma operadora com o mesmo endereço (CGNAT), então um limite baixo bloquearia visitantes reais de uma página popular. **O número é um ponto de partida, não uma medição.**

O plano Hobby inclui 1.000.000 de requisições permitidas por mês nessa regra; acima disso, ver o preço na página da Vercel antes de manter a regra ligada.

## 2. Limites da aplicação (por instância)

| Rota | Limite por endereço por minuto | Resposta ao exceder |
|---|---|---|
| `POST /api/events` | 120 | 204, evento descartado (log `analytics.ingest` com `outcome=rate_limited`) |
| `POST /api/vitals` | 60 | 204, descartado |
| `POST /api/media` | 30 | 429 (log `media.upload` com `outcome=rate_limited`) |
| `/r/<token>` | 60 | o mesmo 404 de um link inexistente (log `report.read` com `outcome=rate_limited`) |
| envio de formulário público | 20 | a mensagem de "muitas tentativas" do próprio formulário (log `lead.submit`) |
| denúncia pública | 10 | a resposta neutra "recebido", sem gravar |

Para mudar um limite: `RATE_LIMITS` no arquivo acima, com deploy. **Estes contadores não são um limite global:** cada instância tem os seus e um início a frio os zera. Servem para cortar o caso comum (um endereço insistindo numa instância quente) sem custo; quem segura um ataque distribuído é a regra do firewall.

A página pública (`/<endereço>` e os domínios próprios) **não tem limite na aplicação**, de propósito: passar por código a cada visita tiraria a página do cache. Ela depende só do firewall.

## 3. Sintomas e o que fazer

- **Visitantes reais recebendo 429 numa página popular:** a regra do firewall está baixa para aquele público. Subir o limite ou voltar a ação para *Log*.
- **`rate_limited` em alta em `analytics.ingest` ou `lead.submit` vindo de muitos endereços:** ataque distribuído; a aplicação não segura. No firewall, baixar o limite da regra temporariamente ou ligar o *Attack Challenge Mode*.
- **Uploads recusados com 429 para um cliente legítimo:** improvável (30 por minuto); conferir se há automação na conta dele.
- **Um endereço específico abusando:** *Firewall* → *IP Blocking* (as regras de bloqueio não contam no limite de uma regra de taxa).

## 4. O que continua sem limite na borda

Server Actions do painel (convites, verificação de domínio, checkout) têm só os limites do banco. `/api/billing/webhook` não tem lista de IPs da Stripe. Cadastro e login têm os limites do Supabase Auth e o CAPTCHA (ADR 0018).
